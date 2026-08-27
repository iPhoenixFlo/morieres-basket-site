/**
 * api/club.js
 * ---------------------------------------------------------------
 * Liste toutes les équipes engagées du Morières Basket Club
 * pour la saison en cours, depuis l'API publique FFBB (Directus).
 *
 * Sert de point d'entrée : plus besoin de connaître les identifiants
 * d'équipe à l'avance. La page appelle /api/club, découvre les équipes,
 * puis appelle /api/equipe?id=... pour celles qu'elle veut afficher.
 *
 * Appels :
 *   /api/club                  -> les équipes de la saison en cours
 *   /api/club?saison=1037      -> une saison précise
 *   /api/club?toutes=1         -> toutes saisons confondues
 *   /api/club?debug=1          -> ajoute la réponse brute
 *
 * Cache : 6 h sur le CDN Vercel. La liste des équipes bouge quelques
 * fois par an, inutile d'interroger la FFBB plus souvent.
 * ---------------------------------------------------------------
 */

const FFBB_API = "https://api.ffbb.com";

// Identifiant Directus du club dans la base FFBB.
// Vu dans /api/equipe : idOrganisme.code vaut SUD0084026.
const CLUB_CODE = process.env.MBC_CLUB_CODE || "SUD0084026";

// Ordre d'affichage souhaité, du plus jeune au plus âgé.
// Sert à trier une liste qui arrive dans un ordre quelconque.
const ORDRE_CATEGORIES = [
  "BB", "U7", "U9", "U11", "U13", "U15", "U17", "U18", "U20", "SE", "LOISIR",
];

const memo = new Map();
const MEMO_MS = 60 * 60 * 1000;

/* ---------------------------------------------------------------
   Authentification, identique à api/equipe.js
   --------------------------------------------------------------- */
let jetonCache = null;

async function getJeton() {
  if (process.env.FFBB_TOKEN) return process.env.FFBB_TOKEN;
  if (jetonCache && jetonCache.expire > Date.now()) return jetonCache.valeur;

  const r = await fetch(`${FFBB_API}/items/configuration`, {
    headers: { Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`Configuration FFBB indisponible (HTTP ${r.status})`);

  const config = await r.json();
  const jeton = trouverJeton(config);
  if (!jeton) throw new Error("Aucun jeton trouvé dans /items/configuration");

  jetonCache = { valeur: jeton, expire: Date.now() + 6 * 60 * 60 * 1000 };
  return jeton;
}

function trouverJeton(config) {
  const candidats = [];
  (function parcourir(noeud, chemin, profondeur) {
    if (profondeur > 8 || noeud == null) return;
    if (typeof noeud === "string") {
      const cle = chemin[chemin.length - 1] || "";
      const meili = /meili/i.test(chemin.join("."));
      const nomParlant = /token|key|bearer|auth|secret/i.test(cle);
      const jwt = /^ey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./.test(noeud);
      const longueurOk = noeud.length >= 16 && noeud.length <= 3000;
      const pasUneUrl = !/^https?:\/\//i.test(noeud);
      const pasUneDate = !/^\d{4}-\d{2}-\d{2}T/.test(noeud);
      if (longueurOk && pasUneUrl && pasUneDate && (jwt || nomParlant)) {
        candidats.push({
          valeur: noeud,
          score: (jwt ? 0 : 2) + (nomParlant ? 0 : 1) + (meili ? 4 : 0),
        });
      }
      return;
    }
    if (Array.isArray(noeud)) {
      noeud.forEach((v, i) => parcourir(v, [...chemin, String(i)], profondeur + 1));
      return;
    }
    if (typeof noeud === "object") {
      for (const [k, v] of Object.entries(noeud)) parcourir(v, [...chemin, k], profondeur + 1);
    }
  })(config, [], 0);
  candidats.sort((a, b) => a.score - b.score);
  return candidats.length ? candidats[0].valeur : null;
}

async function directus(chemin, params) {
  const jeton = await getJeton();
  const url = `${FFBB_API}${chemin}?${params}`;
  const entetes = (j) => ({ Accept: "application/json", Authorization: `Bearer ${j}` });

  let r = await fetch(url, { headers: entetes(jeton) });
  if (r.status === 401 || r.status === 403) {
    jetonCache = null;
    r = await fetch(url, { headers: entetes(await getJeton()) });
  }
  if (!r.ok) throw new Error(`FFBB HTTP ${r.status} sur ${chemin}`);
  return (await r.json()).data;
}

/* ---------------------------------------------------------------
   Récupération du club et de ses engagements
   --------------------------------------------------------------- */
const CHAMPS = [
  "id",
  "code",
  "nom",
  "logo.id",
  "engagements.id",
  "engagements.nom",
  "engagements.numeroEquipe",
  "engagements.idPoule.id",
  "engagements.idPoule.nom",
  "engagements.idCompetition.id",
  "engagements.idCompetition.nom",
  "engagements.idCompetition.code",
  "engagements.idCompetition.typeCompetition",
  "engagements.idCompetition.sexe",
  "engagements.idCompetition.categorie.code",
  "engagements.idCompetition.categorie.ordre",
  "engagements.idCompetition.saison.id",
  "engagements.idCompetition.saison.actif",
  "engagements.idCompetition.saison.libelle",
  // permet de distinguer la phase 1 de la phase 2
  "engagements.idCompetition.idCompetitionPere.id",
  "engagements.idCompetition.idCompetitionPere.nom",
];

function queryString() {
  const p = new URLSearchParams();
  CHAMPS.forEach((c) => p.append("fields[]", c));
  p.append("deep", JSON.stringify({ engagements: { _limit: 200 } }));
  return p.toString();
}

/**
 * Le club est cherché par son code (SUD0084026) et non par son id
 * numérique, car c'est la seule référence stable dont on dispose.
 */
async function chargerClub() {
  const p = new URLSearchParams();
  CHAMPS.forEach((c) => p.append("fields[]", c));
  p.append("deep", JSON.stringify({ engagements: { _limit: 200 } }));
  p.append("filter", JSON.stringify({ code: { _eq: CLUB_CODE } }));
  p.append("limit", "1");

  const liste = await directus("/items/ffbbserver_organismes", p.toString());
  const club = Array.isArray(liste) ? liste[0] : liste;
  if (!club) throw new Error(`Club ${CLUB_CODE} introuvable`);
  return club;
}

/* ---------------------------------------------------------------
   Mise en forme
   --------------------------------------------------------------- */
const sansAccent = (s) =>
  (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Déduit la catégorie d'affichage à partir du code de compétition
 * quand le champ categorie n'est pas renseigné.
 * Exemples de codes : RMU18-2, DMU13-1, PNM, DF, SE.
 */
function deduireCategorie(engagement) {
  const cat = engagement?.idCompetition?.categorie?.code;
  if (cat) return cat.toUpperCase();

  const code = (engagement?.idCompetition?.code || "").toUpperCase();
  const m = code.match(/U\d{1,2}/);
  if (m) return m[0];
  if (/SE|SENIOR|PN|PR|NM|NF/.test(code)) return "SE";
  return "AUTRE";
}

function deduireSexe(engagement) {
  const src = sansAccent(
    (engagement?.idCompetition?.code || "") + " " + (engagement?.idCompetition?.nom || "")
  );
  if (/feminin|\bdf|\brf|\bnf|\bpf/.test(src)) return "F";
  if (/masculin|\bdm|\brm|\bnm|\bpm/.test(src)) return "M";
  return null;
}

function niveau(engagement) {
  const t = (engagement?.idCompetition?.typeCompetition || "").toUpperCase();
  const code = (engagement?.idCompetition?.code || "").toUpperCase();
  if (/^N/.test(code) || t === "NAT") return "national";
  if (/^R/.test(code)) return "regional";
  if (/^P/.test(code)) return "pre-regional";
  if (/^D/.test(code)) return "departemental";
  return "autre";
}

function logoUrl(id, taille) {
  return id
    ? `${FFBB_API}/assets/${id}?width=${taille}&height=${taille}&fit=inside&format=webp`
    : null;
}

function transformer(club, options) {
  const engagements = Array.isArray(club?.engagements) ? club.engagements : [];

  const equipes = engagements
    .filter((e) => {
      if (options.toutes) return true;
      if (options.saison) return String(e?.idCompetition?.saison?.id) === String(options.saison);
      // par défaut : la saison marquée active par la FFBB
      return e?.idCompetition?.saison?.actif === true;
    })
    .map((e) => {
      const phase2 = !!e?.idCompetition?.idCompetitionPere?.id;
      const categorie = deduireCategorie(e);
      return {
        id: e.id,                          // à passer à /api/equipe?id=
        nom: e.nom || null,
        numeroEquipe: e.numeroEquipe || null,
        categorie,
        sexe: deduireSexe(e),
        niveau: niveau(e),
        competition: e?.idCompetition?.nom || null,
        code: e?.idCompetition?.code || null,
        competitionId: e?.idCompetition?.id || null,
        poule: e?.idPoule?.nom || null,
        pouleId: e?.idPoule?.id || null,
        saison: e?.idCompetition?.saison?.id || null,
        saisonLibelle: e?.idCompetition?.saison?.libelle || null,
        phase: phase2 ? 2 : 1,
        phaseParente: phase2 ? e.idCompetition.idCompetitionPere.id : null,
        // ordre d'affichage, du plus jeune au plus âgé
        rang: (() => {
          const i = ORDRE_CATEGORIES.indexOf(categorie);
          return i === -1 ? 99 : i;
        })(),
      };
    })
    .sort((a, b) => a.rang - b.rang || (a.numeroEquipe || "").localeCompare(b.numeroEquipe || ""));

  // Une équipe peut avoir deux engagements dans la saison
  // (phase 1 et phase 2). On regroupe pour ne pas la lister deux fois.
  const groupes = [];
  for (const eq of equipes) {
    const jumelle = groupes.find(
      (g) =>
        g.categorie === eq.categorie &&
        g.sexe === eq.sexe &&
        (g.numeroEquipe || "") === (eq.numeroEquipe || "")
    );
    if (jumelle) {
      jumelle.phases.push(eq);
      // l'engagement de phase 2 devient le courant dès qu'il existe
      if (eq.phase > jumelle.phaseCourante) {
        jumelle.phaseCourante = eq.phase;
        jumelle.id = eq.id;
        jumelle.poule = eq.poule;
        jumelle.pouleId = eq.pouleId;
        jumelle.competition = eq.competition;
        jumelle.code = eq.code;
      }
    } else {
      groupes.push({ ...eq, phaseCourante: eq.phase, phases: [eq], numerote: false });
    }
  }

  // Numérotation : si une catégorie compte plusieurs équipes,
  // on les numérote toutes, sinon aucune. Évite le mélange
  // "U13" et "U13-2" dans la même liste.
  const effectifs = {};
  for (const g of groupes) {
    const k = `${g.categorie}|${g.sexe || ""}`;
    effectifs[k] = (effectifs[k] || 0) + 1;
  }
  groupes.forEach((g) => {
    g.numerote = effectifs[`${g.categorie}|${g.sexe || ""}`] > 1;
  });

  return {
    club: {
      id: club.id,
      code: club.code,
      nom: club.nom,
      logo: logoUrl(club?.logo?.id, 256),
    },
    saison: equipes.length ? equipes[0].saisonLibelle || equipes[0].saison : null,
    nombreEquipes: groupes.length,
    equipes: groupes.map((g) => ({
      id: g.id,
      libelle: libelleAffichage(g),
      categorie: g.categorie,
      sexe: g.sexe,
      niveau: g.niveau,
      competition: g.competition,
      code: g.code,
      poule: g.poule,
      pouleId: g.pouleId,
      phase: g.phaseCourante,
      nbPhases: g.phases.length,
      urlDonnees: `/api/equipe?id=${g.id}`,
    })),
    majLe: new Date().toISOString(),
  };
}

/**
 * Fabrique un libellé court pour l'affichage sur le site.
 * Exemples : "U18 Masculins", "U13-2", "Séniors Masculins".
 */
function libelleAffichage(g) {
  const base = g.categorie === "SE" ? "Séniors" : g.categorie;
  const numero = g.numerote && g.numeroEquipe ? `-${g.numeroEquipe}` : "";
  const sexe = g.sexe === "F" ? " Féminines" : g.sexe === "M" ? " Masculins" : "";
  return `${base}${numero}${sexe}`.trim();
}

/* ---------------------------------------------------------------
   Handler
   --------------------------------------------------------------- */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const options = {
    saison: (req.query?.saison || "").toString().trim() || null,
    toutes: req.query?.toutes === "1",
  };
  const debug = req.query?.debug === "1";

  const cle = `club:${CLUB_CODE}:${options.saison || (options.toutes ? "toutes" : "active")}`;
  const enMemoire = memo.get(cle);
  if (enMemoire && Date.now() - enMemoire.t < MEMO_MS && !debug) {
    res.setHeader("Cache-Control", "public, s-maxage=21600, stale-while-revalidate=86400");
    res.setHeader("X-MBC-Cache", "memoire");
    res.status(200).json(enMemoire.data);
    return;
  }

  try {
    const club = await chargerClub();
    const data = transformer(club, options);

    // Filet : si la saison active ne renvoie rien, on retente sans filtre
    // pour ne pas afficher une page vide en intersaison.
    if (!data.equipes.length && !options.toutes && !options.saison) {
      const secours = transformer(club, { toutes: true });
      if (secours.equipes.length) {
        secours.note = "Aucune équipe sur la saison active, toutes saisons affichées";
        if (debug) secours._brut = club;
        memo.set(cle, { t: Date.now(), data: secours });
        res.setHeader("Cache-Control", "public, s-maxage=3600");
        res.status(200).json(secours);
        return;
      }
    }

    if (debug) data._brut = club;
    memo.set(cle, { t: Date.now(), data });

    res.setHeader("Cache-Control", "public, s-maxage=21600, stale-while-revalidate=86400");
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
    res.status(502).json({ erreur: "FFBB injoignable", detail: e.message });
  }
}
