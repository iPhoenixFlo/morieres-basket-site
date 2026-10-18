/**
 * api/coupes.js
 * ---------------------------------------------------------------
 * Tout ce qui concerne les coupes et trophées du club, équipe par
 * équipe : prochaines rencontres, derniers résultats, classement de
 * poule quand la FFBB en publie un.
 *
 * S'appuie sur /api/club (qui expose désormais l'engagement en coupe
 * de chaque équipe) puis sur /api/equipe pour chacun.
 *
 * Appels :
 *   /api/coupes              -> toutes les équipes engagées en coupe
 *   /api/coupes?debug=1      -> ajoute le détail par équipe
 * ---------------------------------------------------------------
 */

const CACHE_CDN = 900;        // 15 min
const CACHE_PERIME = 86400;

const memo = new Map();
const MEMO_MS = 5 * 60 * 1000;

async function json(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} sur ${url}`);
  return r.json();
}

/* Les compétitions de coupe portent des noms à rallonge.
   "Coupe de Vaucluse Jean Bellucci U13 Masculins" devient
   "Coupe de Vaucluse Jean Bellucci" pour le titre de la page,
   la catégorie étant déjà portée par l'équipe. */
function nomCompetition(nom) {
  return String(nom || "")
    .replace(/\s+(U\d+|Séniors|Seniors)\s+(Masculins?|Féminines?)\s*$/i, "")
    .replace(/\s+(Masculins?|Féminines?)\s*$/i, "")
    .trim();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const debug = req.query?.debug === "1";
  const BASE = process.env.MBC_API_BASE || "https://api.morieres-basket.club";

  const enMemoire = memo.get("coupes");
  if (enMemoire && Date.now() - enMemoire.t < MEMO_MS && !debug) {
    res.setHeader("Cache-Control", `public, s-maxage=${CACHE_CDN}, stale-while-revalidate=${CACHE_PERIME}`);
    res.status(200).json(enMemoire.data);
    return;
  }

  try {
    const club = await json(`${BASE}/api/club`);
    const toutes = Array.isArray(club?.equipes) ? club.equipes : [];
    const engagees = toutes.filter((e) => e.coupe?.id);

    const resultats = await Promise.all(
      engagees.map(async (eq) => {
        try {
          return { eq, d: await json(`${BASE}/api/equipe?id=${encodeURIComponent(eq.coupe.id)}`), erreur: null };
        } catch (e) {
          return { eq, d: null, erreur: e.message };
        }
      })
    );

    const maintenant = Date.now();
    const equipes = [];
    const parEquipe = [];

    for (const { eq, d, erreur } of resultats) {
      parEquipe.push({ equipe: eq.libelle, matchs: d?.calendrier?.length || 0, erreur });
      const calendrier = d?.calendrier || [];

      const joues = calendrier
        .filter((m) => m.joue && m.score)
        .sort((a, b) => (b.date?.timestamp || 0) - (a.date?.timestamp || 0));

      const aVenir = calendrier
        .filter((m) => !m.joue && (m.date?.timestamp || 0) >= maintenant)
        .sort((a, b) => (a.date?.timestamp || 0) - (b.date?.timestamp || 0));

      equipes.push({
        libelle: eq.libelle,
        categorie: eq.categorie,
        sexe: eq.sexe,
        competition: eq.coupe.competition,
        competitionCourte: nomCompetition(eq.coupe.competition),
        poule: eq.coupe.poule,
        pageEquipe: eq.categorie === "SE" ? "seniors" : null,
        prochain: aVenir[0] || null,
        suivants: aVenir.slice(1, 3),
        derniers: joues.slice(0, 3),
        bilan: {
          v: joues.filter((m) => m.resultat === "V").length,
          d: joues.filter((m) => m.resultat === "D").length,
        },
        classement: Array.isArray(d?.classement) && d.classement.length ? d.classement : null,
      });
    }

    // Les équipes qui jouent le plus tôt remontent en tête
    equipes.sort((a, b) => {
      const ta = a.prochain?.date?.timestamp ?? Infinity;
      const tb = b.prochain?.date?.timestamp ?? Infinity;
      return ta - tb;
    });

    const tousProchains = equipes
      .filter((e) => e.prochain)
      .map((e) => ({ ...e.prochain, equipe: e.libelle, competition: e.competitionCourte }));

    const data = {
      saison: club.saison || null,
      competition: equipes.length ? equipes[0].competitionCourte : null,
      nombreEquipes: equipes.length,
      prochainesRencontres: tousProchains.slice(0, 6),
      receptions: tousProchains.filter((m) => m.domicile).slice(0, 6),
      bilanClub: {
        v: equipes.reduce((n, e) => n + e.bilan.v, 0),
        d: equipes.reduce((n, e) => n + e.bilan.d, 0),
      },
      equipes,
      majLe: new Date().toISOString(),
    };
    if (debug) data._parEquipe = parEquipe;

    memo.set("coupes", { t: Date.now(), data });
    res.setHeader("Cache-Control", `public, s-maxage=${CACHE_CDN}, stale-while-revalidate=${CACHE_PERIME}`);
    res.status(200).json(data);
  } catch (e) {
    if (enMemoire) {
      res.setHeader("Cache-Control", "public, s-maxage=300");
      res.status(200).json({ ...enMemoire.data, perime: true, erreur: e.message });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ erreur: "Coupes indisponibles", detail: e.message });
  }
}
