/**
 * api/stages.js
 * ---------------------------------------------------------------
 *   GET /api/stages
 *     -> stages ouverts avec les places restantes par jour
 *
 *   GET /api/stages?export=ID_DU_STAGE&cle=SECRET
 *     -> liste CSV des inscrits payés, pour les encadrants.
 *        Protégée par STAGES_CLE_EXPORT (variable d'environnement).
 *
 *   GET /api/stages?purge=1
 *     -> tâche quotidienne Vercel Cron : purge RGPD, et maintient
 *        le projet Supabase éveillé (le plan gratuit se met en pause
 *        après 7 jours sans activité). Protégée par CRON_SECRET.
 * ---------------------------------------------------------------
 */
import { STAGES, trouverStage } from "./_config-stages.js";
import { placesPrises, listerPayees, purger } from "./_db.js";

const JOURS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

function libelleJour(iso) {
  const d = new Date(iso + "T12:00:00Z");
  return `${JOURS[d.getUTCDay()]} ${d.getUTCDate()} ${MOIS[d.getUTCMonth()]}`;
}

function csv(lignes) {
  const echap = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return "\uFEFF" + lignes.map((l) => l.map(echap).join(";")).join("\r\n");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  // ---------- tâche quotidienne ----------
  if (req.query?.purge) {
    const attendu = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
    if (!attendu || req.headers?.authorization !== attendu) { res.status(403).json({ erreur: "Accès refusé" }); return; }
    try {
      const n = await purger();
      res.status(200).json({ ok: true, supprimees: Number(n) || 0 });
    } catch (e) { res.status(502).json({ erreur: e.message }); }
    return;
  }

  // ---------- export des inscrits ----------
  if (req.query?.export) {
    if (!process.env.STAGES_CLE_EXPORT || req.query.cle !== process.env.STAGES_CLE_EXPORT) {
      res.status(403).json({ erreur: "Accès refusé" });
      return;
    }
    const stage = trouverStage(req.query.export);
    if (!stage) { res.status(404).json({ erreur: "Stage inconnu" }); return; }

    const inscrits = await listerPayees(stage.id);
    const lignes = [["Prénom", "Nom", "Naissance", "Jours", "Parent", "Téléphone", "E-mail",
                     "Allergies", "Photo", "Sortie seul", "Montant", "Paiement"]];
    for (const i of inscrits) {
      lignes.push([i.enfant.prenom, i.enfant.nom, i.enfant.naissance,
        i.jours.map(libelleJour).join(", "), `${i.parent.prenom} ${i.parent.nom}`,
        i.parent.tel, i.parent.email, i.sante?.allergies || "",
        i.autorisations?.photo ? "oui" : "non", i.autorisations?.sortie ? "oui" : "non",
        `${i.montant} €`, i.paiement]);
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="inscrits-${stage.id}.csv"`);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(csv(lignes));
    return;
  }

  // ---------- liste publique ----------
  try {
    const ouverts = STAGES.filter((s) => s.ouvert);
    const data = [];
    for (const s of ouverts) {
      const prisesParJour = await placesPrises(s.id);
      const jours = [];
      for (const j of s.jours) {
        const prises = prisesParJour[j] || 0;
        jours.push({
          date: j,
          libelle: libelleJour(j),
          restantes: Math.max(0, s.capaciteParJour - prises),
          capacite: s.capaciteParJour,
        });
      }
      const { anneesNaissance, ...publicStage } = s;
      data.push({ ...publicStage, jours, complet: jours.every((j) => j.restantes === 0) });
    }
    // Rafraîchi souvent : les places bougent pendant les inscriptions
    res.setHeader("Cache-Control", "public, s-maxage=20, stale-while-revalidate=60");
    res.status(200).json({ stages: data, majLe: new Date().toISOString() });
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ erreur: "Stages indisponibles", detail: e.message });
  }
}
