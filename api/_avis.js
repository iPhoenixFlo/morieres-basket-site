/**
 * api/avis.js
 * ---------------------------------------------------------------
 *   GET /api/avis
 *     -> liste des stages, pour le menu de la page /avis-stage
 *
 *   POST /api/avis
 *     -> enregistre l'avis d'une famille après un stage
 *
 *   GET /api/avis?export=1&cle=SECRET[&stage=ID]
 *     -> toutes les réponses en CSV (ouvrable dans Excel).
 *        Protégée par STAGES_CLE_EXPORT, la même clé que l'export
 *        des inscrits.
 * ---------------------------------------------------------------
 */
import { STAGES, trouverStage } from "./_config-stages.js";
import { creerAvis, listerAvis } from "./_db.js";

const nettoyer = (v, max = 120) => String(v ?? "").replace(/[<>]/g, "").trim().slice(0, max);
const entier = (v, min, max) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : null; };
const parmi = (v, liste) => (liste.includes(v) ? v : null);

const NIVEAUX = { facile: "Trop facile", adapte: "Adapté", difficile: "Trop difficile" };
const HORAIRES = { ok: "Ça nous convient", plus_tot: "Plus tôt", plus_tard: "Plus tard", plus_court: "Journées plus courtes" };
const FORMATS = { semaine: "Semaine complète", carte: "Jours à la carte", demi: "Demi-journées" };
const TARIFS = { abordable: "Abordable", juste: "Juste", cher: "Trop cher" };
const VACANCES = { noel: "Noël (si négocié)", fevrier: "Février", paques: "Pâques", ete: "Été (si négocié)" };

function csv(lignes) {
  const echap = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return "﻿" + lignes.map((l) => l.map(echap).join(";")).join("\r\n");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  // ---------- export pour le bureau ----------
  if (req.method === "GET" && req.query?.export) {
    const cle = process.env.STAGES_CLE_EXPORT;
    if (!cle || req.query.cle !== cle) { res.status(403).json({ erreur: "Accès refusé" }); return; }
    try {
      const stage = nettoyer(req.query.stage, 60) || null;
      const avis = await listerAvis(stage);
      const lignes = [["Date", "Stage", "Enfant", "Note globale", "Encadrement", "Niveau",
        "Horaires", "Format souhaité", "Tarif", "Prochaines vacances", "À améliorer"]];
      for (const a of avis) {
        lignes.push([
          new Date(a.cree_le).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }),
          trouverStage(a.stage_id)?.titre || a.stage_id, a.prenom || "", a.note, a.encadrement ?? "",
          NIVEAUX[a.niveau] || "", HORAIRES[a.horaires] || "", FORMATS[a.format] || "", TARIFS[a.tarif] || "",
          (a.vacances || []).map((v) => VACANCES[v] || v).join(", "), a.ameliorer || "",
        ]);
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="avis-stages${stage ? "-" + stage : ""}.csv"`);
      res.status(200).send(csv(lignes));
    } catch (e) {
      res.status(500).json({ erreur: "Export impossible pour le moment." });
    }
    return;
  }

  // ---------- liste des stages pour la page ----------
  if (req.method === "GET") {
    res.status(200).json({
      stages: STAGES.map((s) => ({
        id: s.id, titre: s.titre, periode: s.periode, encadrant: s.encadrant, horaires: s.horaires,
      })),
    });
    return;
  }

  if (req.method !== "POST") { res.status(405).json({ erreur: "Méthode non autorisée" }); return; }

  // ---------- enregistrement d'un avis ----------
  const b = req.body || {};

  // Champ piège invisible : un humain ne le remplit jamais.
  if (nettoyer(b.site)) { res.status(200).json({ ok: true }); return; }

  const erreurs = [];
  const stage = trouverStage(nettoyer(b.stage, 60));
  if (!stage) erreurs.push("Choisissez le stage auquel votre enfant a participé.");
  const note = entier(b.note, 1, 5);
  if (!note) erreurs.push("Donnez une note globale au stage.");
  if (erreurs.length) { res.status(400).json({ erreurs }); return; }

  const vacances = Array.isArray(b.vacances)
    ? [...new Set(b.vacances)].filter((v) => v in VACANCES)
    : [];

  try {
    await creerAvis({
      stage_id: stage.id,
      prenom: nettoyer(b.prenom, 40) || null,
      note,
      encadrement: entier(b.encadrement, 1, 5),
      niveau: parmi(b.niveau, Object.keys(NIVEAUX)),
      horaires: parmi(b.horaires, Object.keys(HORAIRES)),
      format: parmi(b.format, Object.keys(FORMATS)),
      tarif: parmi(b.tarif, Object.keys(TARIFS)),
      vacances,
      ameliorer: nettoyer(b.ameliorer, 1500) || null,
    });
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ erreurs: ["Votre avis n'a pas pu être enregistré. Réessayez dans quelques minutes."] });
  }
}
