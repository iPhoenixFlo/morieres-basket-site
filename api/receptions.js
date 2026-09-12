/**
 * api/receptions.js
 * ---------------------------------------------------------------
 * Renvoie les prochaines rencontres À DOMICILE de TOUTES les équipes
 * du club, fusionnées et triées par date.
 *
 * S'appuie sur les deux fonctions existantes plutôt que de refaire
 * les appels FFBB : /api/club pour découvrir les équipes engagées,
 * puis /api/equipe pour chacune. Elles ont leur propre cache, donc
 * l'agrégation coûte peu.
 *
 * Appels :
 *   /api/receptions                 -> 8 prochaines réceptions, 60 jours
 *   /api/receptions?jours=21        -> uniquement les 3 prochaines semaines
 *   /api/receptions?max=5           -> 5 réceptions au maximum
 *   /api/receptions?tout=1          -> aucune limite de nombre ni de date
 *   /api/receptions?debug=1         -> ajoute le détail par équipe
 *
 * Cache : 30 min sur le CDN. Court volontairement, car en septembre
 * les calendriers départementaux arrivent au fil des jours.
 * ---------------------------------------------------------------
 */

const CACHE_CDN = 1800;        // 30 min
const CACHE_PERIME = 86400;    // 24 h de secours

const memo = new Map();
const MEMO_MS = 10 * 60 * 1000;

/** Libellé court de compétition, pour tenir sur un billet. */
function competitionCourte(eq) {
  const code = (eq.code || "").toUpperCase();
  const cat = (eq.categorie || "").toUpperCase();

  if (/^RM/.test(code)) return `Régionale masculine ${cat}`;
  if (/^RF/.test(code)) return `Régionale féminine ${cat}`;
  if (/^PRM/.test(code)) return "Pré-régionale masculine";
  if (/^PRF/.test(code)) return "Pré-régionale féminine";
  if (/^DM/.test(code)) return `Départementale masculine ${cat}`;
  if (/^DF/.test(code)) return `Départementale féminine ${cat}`;
  return eq.competition || "Championnat";
}

async function json(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} sur ${url}`);
  return r.json();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const tout = req.query?.tout === "1";
  const jours = tout ? 3650 : Math.min(Math.max(parseInt(req.query?.jours, 10) || 60, 1), 3650);
  const max = tout ? 200 : Math.min(Math.max(parseInt(req.query?.max, 10) || 8, 1), 50);
  const debug = req.query?.debug === "1";

  // Adresse de nos propres fonctions.
  // Fixée en dur volontairement : derrière un sous-domaine personnalisé,
  // les en-têtes x-forwarded-host peuvent renvoyer un hôte inattendu
  // et l'appel interne partirait dans le vide.
  const BASE = process.env.MBC_API_BASE || "https://api.morieres-basket.club";

  const cle = `rec:${jours}:${max}`;
  const enMemoire = memo.get(cle);
  if (enMemoire && Date.now() - enMemoire.t < MEMO_MS && !debug) {
    res.setHeader("Cache-Control", `public, s-maxage=${CACHE_CDN}, stale-while-revalidate=${CACHE_PERIME}`);
    res.setHeader("X-MBC-Cache", "memoire");
    res.status(200).json(enMemoire.data);
    return;
  }

  try {
    const club = await json(`${BASE}/api/club`);
    const equipes = Array.isArray(club?.equipes) ? club.equipes : [];
    if (!equipes.length) throw new Error("Aucune équipe engagée renvoyée par /api/club");

    // Une requête par équipe, en parallèle. Une équipe en échec
    // ne doit pas faire tomber tout le bloc.
    const resultats = await Promise.all(
      equipes.map(async (eq) => {
        try {
          const d = await json(`${BASE}/api/equipe?id=${encodeURIComponent(eq.id)}`);
          return { eq, d, erreur: null };
        } catch (e) {
          return { eq, d: null, erreur: e.message };
        }
      })
    );

    const limite = Date.now() + jours * 86400000;
    const receptions = [];
    const parEquipe = [];

    for (const { eq, d, erreur } of resultats) {
      const n = d?.receptions?.length || 0;
      parEquipe.push({ equipe: eq.libelle, id: eq.id, receptions: n, erreur });
      if (!d?.receptions) continue;

      for (const m of d.receptions) {
        if (m.joue) continue;
        const t = m.date?.timestamp;
        if (t && t > limite) continue;
        receptions.push({
          ...m,
          equipe: eq.libelle,
          equipeId: eq.id,
          categorie: eq.categorie,
          niveau: eq.niveau,
          competition: eq.competition,
          competitionCourte: competitionCourte(eq),
          poule: eq.poule,
        });
      }
    }

    receptions.sort((a, b) => (a.date?.timestamp || 0) - (b.date?.timestamp || 0));

    // Un seul billet doré affiché à la fois, toutes équipes confondues :
    // le premier derby à venir garde sa mise en avant, les suivants non.
    let doreUtilise = false;
    for (const m of receptions) {
      if (m.miseEnAvant?.style === "or") {
        if (doreUtilise) m.miseEnAvant = { ...m.miseEnAvant, style: "normal" };
        else doreUtilise = true;
      }
    }

    const data = {
      club: club.club || null,
      saison: club.saison || null,
      equipesEngagees: equipes.length,
      receptionsTotal: receptions.length,
      fenetre: tout ? "toutes" : `${jours} jours`,
      receptions: receptions.slice(0, max),
      majLe: new Date().toISOString(),
    };
    if (debug) {
      data._parEquipe = parEquipe;
      data._base = BASE;
      data._entetes = {
        host: req.headers.host || null,
        forwardedHost: req.headers["x-forwarded-host"] || null,
        forwardedProto: req.headers["x-forwarded-proto"] || null,
      };
    }

    memo.set(cle, { t: Date.now(), data });

    res.setHeader("Cache-Control", `public, s-maxage=${CACHE_CDN}, stale-while-revalidate=${CACHE_PERIME}`);
    res.setHeader("X-MBC-Cache", "frais");
    res.status(200).json(data);
  } catch (e) {
    if (enMemoire) {
      res.setHeader("Cache-Control", "public, s-maxage=300");
      res.setHeader("X-MBC-Cache", "perime");
      res.status(200).json({ ...enMemoire.data, perime: true, erreur: e.message });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({
      erreur: "Agrégation impossible",
      detail: e.message,
      base: BASE,
      aide: "Vérifier que " + BASE + "/api/club répond. Sinon, définir MBC_API_BASE dans les variables d'environnement Vercel.",
    });
  }
}
