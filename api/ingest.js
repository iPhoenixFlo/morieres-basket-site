/**
 * api/ingest.js
 * ---------------------------------------------------------------
 * Point de dépôt des données FFBB collectées depuis une connexion
 * ordinaire. Seul le collecteur appelle cette route, avec sa clé.
 *
 * La clé de dépôt est volontairement distincte de la clé Supabase :
 * celle-ci ne permet que de remplacer des données FFBB publiques, alors
 * que la clé Supabase donnerait aussi accès aux inscriptions aux stages,
 * donc à des données personnelles d'enfants. Le collecteur tourne sur une
 * machine de magasin, il n'a aucune raison de détenir la seconde.
 *
 * Appel :
 *   POST /api/ingest
 *   en-tête   x-mbc-cle: <FFBB_INGEST_CLE>
 *   corps     { "collecteLe": "...", "entrees": [ { "cle": "club", "charge": {...} }, ... ] }
 *
 *   GET /api/ingest   -> état du cache (clés présentes et âge), sans la clé
 * ---------------------------------------------------------------
 */

import { lireCacheFfbb, deposerCacheFfbb, ageMinutes } from "./_db.js";

const CLES_ATTENDUES = /^(club|equipe:[0-9A-Za-z_-]{1,64})$/;
const MAX_ENTREES = 40;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  /* Lecture d'état : pratique pour vérifier d'un coup d'œil si la
     collecte tourne encore. Ne révèle aucune donnée sensible. */
  if (req.method === "GET") {
    try {
      const club = await lireCacheFfbb("club");
      if (!club) {
        res.status(200).json({ cache: "vide", message: "Aucune collecte n'a encore été déposée." });
        return;
      }
      const equipes = Array.isArray(club.charge?.equipes) ? club.charge.equipes : [];
      const details = [];
      for (const eq of equipes) {
        for (const id of [eq.id, eq.coupe?.id].filter(Boolean)) {
          if (details.some((d) => d.id === id)) continue;
          const e = await lireCacheFfbb(`equipe:${id}`);
          details.push({ equipe: eq.libelle, id, present: !!e, ageMinutes: e ? ageMinutes(e.maj) : null });
        }
      }
      const manquants = details.filter((d) => !d.present).length;
      res.status(200).json({
        cache: "présent",
        clubAgeMinutes: ageMinutes(club.maj),
        clubCollecteLe: club.collecteLe,
        engagements: details.length,
        manquants,
        etat: manquants === 0 ? "complet" : "incomplet",
        details,
      });
    } catch (e) {
      res.status(500).json({ erreur: "Lecture impossible", detail: e.message });
    }
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ erreur: "Méthode non autorisée" });
    return;
  }

  const attendue = process.env.FFBB_INGEST_CLE;
  if (!attendue) {
    res.status(500).json({ erreur: "FFBB_INGEST_CLE absente des variables d'environnement" });
    return;
  }

  const fournie = req.headers["x-mbc-cle"];
  if (!fournie || String(fournie) !== attendue) {
    res.status(401).json({ erreur: "Clé de dépôt invalide" });
    return;
  }

  /* Vercel analyse le JSON tout seul, mais pas toujours : selon le
     Content-Type reçu, req.body peut arriver en texte brut. */
  let corps = req.body;
  if (typeof corps === "string") {
    try { corps = JSON.parse(corps); }
    catch { res.status(400).json({ erreur: "Corps JSON illisible" }); return; }
  }

  const entrees = Array.isArray(corps?.entrees) ? corps.entrees : null;
  if (!entrees || !entrees.length) {
    res.status(400).json({ erreur: "Aucune entrée à déposer" });
    return;
  }
  if (entrees.length > MAX_ENTREES) {
    res.status(400).json({ erreur: `Trop d'entrées (${entrees.length}, maximum ${MAX_ENTREES})` });
    return;
  }

  const collecteLe = typeof corps.collecteLe === "string" ? corps.collecteLe : new Date().toISOString();
  const deposees = [];
  const refusees = [];

  for (const e of entrees) {
    const cle = String(e?.cle || "").trim();

    if (!CLES_ATTENDUES.test(cle)) {
      refusees.push({ cle, raison: "clé hors format attendu" });
      continue;
    }
    /* Garde-fou : une charge vide effacerait un affichage qui marche.
       Mieux vaut des données d'hier qu'une page blanche. */
    if (!e.charge || typeof e.charge !== "object") {
      refusees.push({ cle, raison: "charge absente ou non structurée" });
      continue;
    }
    if (cle === "club" && !Array.isArray(e.charge.equipes)) {
      refusees.push({ cle, raison: "charge club sans tableau equipes" });
      continue;
    }
    if (cle.startsWith("equipe:") && !Array.isArray(e.charge.calendrier)) {
      refusees.push({ cle, raison: "charge équipe sans tableau calendrier" });
      continue;
    }

    try {
      await deposerCacheFfbb(cle, e.charge, collecteLe);
      deposees.push(cle);
    } catch (err) {
      refusees.push({ cle, raison: err.message });
    }
  }

  const code = deposees.length ? 200 : 400;
  res.status(code).json({
    deposees: deposees.length,
    refusees: refusees.length,
    cles: deposees,
    detail: refusees.length ? refusees : undefined,
    collecteLe,
  });
}
