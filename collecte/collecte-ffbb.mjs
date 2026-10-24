#!/usr/bin/env node
/**
 * collecte-ffbb.mjs
 * ---------------------------------------------------------------
 * Va chercher les données FFBB et les dépose sur le site.
 *
 * À faire tourner sur une machine à connexion ordinaire. Depuis le
 * 19 octobre 2026, le pare-feu de la FFBB refuse les requêtes venant des
 * hébergeurs : Vercel ne peut plus interroger la fédération lui-même.
 *
 * Ce script ne duplique aucune logique métier. Il réutilise les mêmes
 * fichiers api/club.js et api/equipe.js que le site, en les basculant en
 * mode direct. Une correction faite pour le site profite donc au
 * collecteur sans rien recopier.
 *
 * Usage :
 *   node collecte-ffbb.mjs            dépose sur le site
 *   node collecte-ffbb.mjs --essai    affiche sans rien déposer
 *   node collecte-ffbb.mjs --json     écrit aussi les charges sur le disque
 * ---------------------------------------------------------------
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ICI = dirname(fileURLToPath(import.meta.url));

/* --- Configuration ------------------------------------------------- */

/* Un .env posé à côté du script évite d'avoir à exporter les variables
   dans le planificateur, qui ne lit pas le profil du shell. */
function chargerEnv() {
  const chemin = resolve(ICI, ".env");
  if (!existsSync(chemin)) return;
  for (const ligne of readFileSync(chemin, "utf8").split(/\r?\n/)) {
    const m = ligne.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || ligne.trimStart().startsWith("#")) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
chargerEnv();

/* Indispensable : c'est ce qui dit aux handlers d'interroger la FFBB
   pour de vrai au lieu de lire le cache. */
process.env.FFBB_MODE = "direct";

const ESSAI = process.argv.includes("--essai");
const ECRIRE_JSON = process.argv.includes("--json");
const URL_DEPOT = (process.env.MBC_INGEST_URL || "https://api.morieres-basket.club/api/ingest").trim();
const CLE_DEPOT = (process.env.FFBB_INGEST_CLE || "").trim();
const PAUSE_MS = Number(process.env.FFBB_PAUSE_ENTRE_APPELS || 900);

/* --- Utilitaires ---------------------------------------------------- */

const horo = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const log = (...a) => console.log(`[${horo()}]`, ...a);
const dors = (ms) => new Promise((r) => setTimeout(r, ms));

/* Les handlers sont écrits pour Vercel. On leur présente un req et un res
   minimalistes, et on récupère ce qu'ils auraient renvoyé. */
function fausseRequete(query = {}) {
  const sortie = { code: 0, data: null, entetes: {} };
  const res = {
    setHeader(k, v) { sortie.entetes[String(k).toLowerCase()] = v; return this; },
    status(c) { sortie.code = c; return this; },
    json(j) { sortie.data = j; return this; },
    end() { return this; },
  };
  return { req: { query, method: "GET", headers: {}, body: null }, res, sortie };
}

async function appeler(handler, query, quoi) {
  const { req, res, sortie } = fausseRequete(query);
  await handler(req, res);
  if (sortie.code !== 200 || !sortie.data) {
    throw new Error(`${quoi} : code ${sortie.code} ${JSON.stringify(sortie.data || {}).slice(0, 300)}`);
  }
  if (sortie.data.erreur) {
    throw new Error(`${quoi} : ${sortie.data.erreur} ${sortie.data.detail || ""}`);
  }
  return sortie.data;
}

/* --- Collecte ------------------------------------------------------- */

async function collecter() {
  const club = (await import("../api/club.js")).default;
  const equipe = (await import("../api/equipe.js")).default;

  log("lecture des engagements du club");
  const charge = await appeler(club, {}, "club");

  const equipes = Array.isArray(charge.equipes) ? charge.equipes : [];
  if (!equipes.length) throw new Error("club : aucune équipe renvoyée, collecte abandonnée");
  log(`${equipes.length} équipe(s), ${charge.nombreCoupes || 0} en coupe`);

  /* Championnat et coupe sont deux engagements distincts, chacun avec sa
     poule. Il faut les deux, sans doublon quand ils se confondent. */
  const aCollecter = [];
  for (const eq of equipes) {
    for (const id of [eq.id, eq.coupe?.id].filter(Boolean)) {
      if (!aCollecter.some((x) => String(x.id) === String(id))) {
        aCollecter.push({ id: String(id), libelle: eq.libelle });
      }
    }
  }

  const entrees = [{ cle: "club", charge }];
  const echecs = [];

  /* Séquentiel et espacé : un pare-feu qui voit arriver sept requêtes
     simultanées depuis la même adresse a tôt fait d'y voir un robot. */
  for (const { id, libelle } of aCollecter) {
    await dors(PAUSE_MS);
    try {
      const d = await appeler(equipe, { id }, `equipe ${libelle}`);
      const n = Array.isArray(d.calendrier) ? d.calendrier.length : 0;
      log(`  ${libelle.padEnd(20)} ${String(n).padStart(2)} rencontre(s)`);
      entrees.push({ cle: `equipe:${id}`, charge: d });
    } catch (e) {
      log(`  ${libelle.padEnd(20)} ECHEC : ${e.message}`);
      echecs.push({ libelle, id, erreur: e.message });
    }
  }

  return { entrees, echecs, equipes: aCollecter.length };
}

/* --- Dépôt ---------------------------------------------------------- */

async function deposer(entrees) {
  if (!CLE_DEPOT) throw new Error("FFBB_INGEST_CLE absente : renseigner le fichier .env");

  const r = await fetch(URL_DEPOT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-mbc-cle": CLE_DEPOT },
    body: JSON.stringify({ collecteLe: new Date().toISOString(), entrees }),
  });

  const texte = await r.text();
  let reponse = null;
  try { reponse = JSON.parse(texte); } catch { /* pas du JSON */ }

  if (!r.ok) throw new Error(`dépôt refusé (HTTP ${r.status}) : ${texte.slice(0, 300)}`);
  return reponse || {};
}

/* --- Programme principal -------------------------------------------- */

try {
  const { entrees, echecs, equipes } = await collecter();

  if (ECRIRE_JSON) {
    for (const e of entrees) {
      const nom = resolve(ICI, `${e.cle.replace(/[^0-9A-Za-z_-]/g, "_")}.json`);
      writeFileSync(nom, JSON.stringify(e.charge, null, 2));
    }
    log(`charges écrites dans ${ICI}`);
  }

  if (ESSAI) {
    log(`essai : ${entrees.length} entrée(s) prêtes, rien n'a été déposé`);
  } else {
    const rep = await deposer(entrees);
    log(`déposé : ${rep.deposees ?? "?"} entrée(s)${rep.refusees ? `, ${rep.refusees} refusée(s)` : ""}`);
    if (rep.detail) log("refus :", JSON.stringify(rep.detail));
  }

  /* Une équipe manquante n'annule pas la collecte des autres, mais le
     planificateur doit pouvoir s'en apercevoir. */
  if (echecs.length) {
    log(`${echecs.length} équipe(s) sur ${equipes} n'ont pas pu être collectées`);
    process.exit(2);
  }
  log("collecte terminée");
  process.exit(0);
} catch (e) {
  log("ECHEC :", e.message);
  if (/403/.test(e.message)) {
    log("Un 403 depuis cette machine signifie que le pare-feu FFBB bloque");
    log("aussi cette connexion. Essayer depuis un autre réseau, ou attendre.");
  }
  process.exit(1);
}
