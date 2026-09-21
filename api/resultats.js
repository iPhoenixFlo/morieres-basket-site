/**
 * api/resultats.js
 * ---------------------------------------------------------------
 * Renvoie les résultats du DERNIER WEEK-END joué, toutes équipes
 * du club confondues.
 *
 * Même principe que /api/receptions : on découvre les équipes via
 * /api/club, puis on interroge /api/equipe pour chacune.
 *
 * "Dernier week-end" : on repère la date du match joué le plus
 * récent, tous clubs confondus, et on garde tous les matchs joués
 * dans les 3 jours qui précèdent. Un visiteur qui arrive le
 * mercredi voit donc encore les scores du samedi et du dimanche.
 *
 * Appels :
 *   /api/resultats             -> résultats du dernier week-end
 *   /api/resultats?debug=1     -> ajoute le détail par équipe
 * ---------------------------------------------------------------
 */

const CACHE_CDN = 900;          // 15 min : les scores tombent le soir même
const CACHE_PERIME = 86400;

const memo = new Map();
const MEMO_MS = 5 * 60 * 1000;

const FENETRE_WEEKEND = 3 * 86400000;   // 3 jours avant le dernier match
const ANCIENNETE_MAX = 10 * 86400000;   // au-delà de 10 jours, plus de "week-end"

async function json(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} sur ${url}`);
  return r.json();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const debug = req.query?.debug === "1";
  const BASE = process.env.MBC_API_BASE || "https://api.morieres-basket.club";

  const enMemoire = memo.get("res");
  if (enMemoire && Date.now() - enMemoire.t < MEMO_MS && !debug) {
    res.setHeader("Cache-Control", `public, s-maxage=${CACHE_CDN}, stale-while-revalidate=${CACHE_PERIME}`);
    res.status(200).json(enMemoire.data);
    return;
  }

  try {
    const club = await json(`${BASE}/api/club`);
    const equipes = Array.isArray(club?.equipes) ? club.equipes : [];
    if (!equipes.length) throw new Error("Aucune équipe renvoyée par /api/club");

    const resultats = await Promise.all(
      equipes.map(async (eq) => {
        try {
          return { eq, d: await json(`${BASE}/api/equipe?id=${encodeURIComponent(eq.id)}`), erreur: null };
        } catch (e) {
          return { eq, d: null, erreur: e.message };
        }
      })
    );

    // Tous les matchs joués, toutes équipes confondues
    const joues = [];
    const parEquipe = [];
    for (const { eq, d, erreur } of resultats) {
      const liste = (d?.calendrier || []).filter((m) => m.joue || m.enAttenteFeuille);
      parEquipe.push({ equipe: eq.libelle, joues: liste.length, erreur });
      for (const m of liste) {
        if (!m.date?.timestamp) continue;
        joues.push({
          ...m,
          equipe: eq.libelle,
          equipeId: eq.id,
          categorie: eq.categorie,
          competition: eq.competition,
        });
      }
    }

    // Le dernier week-end : autour du match joué le plus récent
    const maintenant = Date.now();
    const recents = joues.filter((m) => m.date.timestamp <= maintenant);
    let weekend = [];
    let dernier = null;

    if (recents.length) {
      dernier = Math.max(...recents.map((m) => m.date.timestamp));
      if (maintenant - dernier <= ANCIENNETE_MAX) {
        weekend = recents
          .filter((m) => dernier - m.date.timestamp <= FENETRE_WEEKEND)
          .sort((a, b) => b.date.timestamp - a.date.timestamp);
      }
    }

    const victoires = weekend.filter((m) => m.resultat === "V");

    const data = {
      saison: club.saison || null,
      equipesEngagees: equipes.length,
      weekend: dernier ? new Date(dernier).toISOString() : null,
      nombre: weekend.length,
      victoires: victoires.length,
      defaites: weekend.filter((m) => m.resultat === "D").length,
      enAttente: weekend.filter((m) => m.enAttenteFeuille).length,
      resultats: weekend,
      majLe: new Date().toISOString(),
    };
    if (debug) data._parEquipe = parEquipe;

    memo.set("res", { t: Date.now(), data });
    res.setHeader("Cache-Control", `public, s-maxage=${CACHE_CDN}, stale-while-revalidate=${CACHE_PERIME}`);
    res.status(200).json(data);
  } catch (e) {
    if (enMemoire) {
      res.setHeader("Cache-Control", "public, s-maxage=300");
      res.status(200).json({ ...enMemoire.data, perime: true, erreur: e.message });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ erreur: "Agrégation impossible", detail: e.message });
  }
}
