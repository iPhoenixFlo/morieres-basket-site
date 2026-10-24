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

/* ---------------------------------------------------------------
   Accès à la FFBB, résistant au pare-feu
   ---------------------------------------------------------------
   Depuis octobre 2026, api.ffbb.com est derrière un pare-feu CDN qui
   renvoie 403 aux clients sans User-Agent reconnu. Deux parades :
   un User-Agent accepté, et un repli sur l'origine bo.ffbb.com.
   L'origine qui a fonctionné est mémorisée pour les appels suivants.
   --------------------------------------------------------------- */
import { lireCacheFfbb, ageMinutes } from "./_db.js";

/* "direct" = on interroge la FFBB pour de vrai. Réservé au collecteur qui
   tourne sur une connexion ordinaire. Partout ailleurs, et donc sur
   l'hébergeur, on lit ce que le collecteur a déposé. */
const MODE_DIRECT = process.env.FFBB_MODE === "direct";

const FFBB_UA = process.env.FFBB_USER_AGENT || "okhttp/4.12.0";

const FFBB_ORIGINES = [
  process.env.FFBB_API_BASE,
  "https://api.ffbb.com",
  "https://bo.ffbb.com",
  "https://bo.ffbb.app",
].filter(Boolean);

let origineOk = null;

/* Depuis le 19 octobre 2026, le pare-feu de la FFBB refuse les requêtes
   venant des hébergeurs. Insister est contre-productif : un pare-feu
   interprète les tentatives répétées comme un comportement abusif et peut
   prolonger le bannissement. Après un refus sur toutes les origines, on
   s'interdit donc tout nouvel appel pendant FFBB_PAUSE_MINUTES, et on sert
   la dernière copie connue en attendant. */
const FFBB_PAUSE_MS = Number(process.env.FFBB_PAUSE_MINUTES || 360) * 60000;
let bloqueeJusqua = 0;

async function ffbbFetch(chemin, entetes = {}) {
  if (bloqueeJusqua > Date.now()) {
    const minutes = Math.ceil((bloqueeJusqua - Date.now()) / 60000);
    throw new Error(`FFBB bloquée (pare-feu). Prochaine tentative dans ${minutes} min.`);
  }

  const tete = { Accept: "application/json", "User-Agent": FFBB_UA, ...entetes };
  const ordre = origineOk ? [origineOk, ...FFBB_ORIGINES.filter((o) => o !== origineOk)] : FFBB_ORIGINES;

  let dernier = null;
  let refuse = false;
  for (const origine of ordre) {
    let r;
    try {
      r = await fetch(origine + chemin, { headers: tete });
    } catch (e) {
      dernier = `${origine} injoignable : ${e.message}`;
      continue;
    }
    // 403 = pare-feu, on essaie l'origine suivante.
    // 401 = jeton périmé, l'appelant s'en occupe, on ne change pas d'origine.
    if (r.status === 403) { refuse = true; dernier = `${origine} refusé (403)`; continue; }
    origineOk = origine;
    return r;
  }

  if (refuse) bloqueeJusqua = Date.now() + FFBB_PAUSE_MS;
  throw new Error(`FFBB inaccessible. ${dernier || "aucune origine n'a répondu"}`);
}



// Identifiant Directus du club dans la base FFBB.
// Vu dans /api/equipe : idOrganisme.code vaut SUD0084026.
const CLUB_CODE = process.env.MBC_CLUB_CODE || "SUD0084026";

// Ordre d'affichage souhaité, du plus jeune au plus âgé.
// Sert à trier une liste qui arrive dans un ordre quelconque.
const ORDRE_CATEGORIES = [
  "BB", "U7", "U9", "U11", "U13", "U15", "U17", "U18", "U20", "SE", "LOISIR",
];

const memo = new Map();
const MEMO_MS = 15 * 60 * 1000;

/* ---------------------------------------------------------------
   Authentification, identique à api/equipe.js
   --------------------------------------------------------------- */
let jetonCache = null;

async function getJeton() {
  if (process.env.FFBB_TOKEN) return process.env.FFBB_TOKEN;
  if (jetonCache && jetonCache.expire > Date.now()) return jetonCache.valeur;

  const r = await ffbbFetch("/items/configuration");
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
  const cheminComplet = `${chemin}?${params}`;

  let r = await ffbbFetch(cheminComplet, { Authorization: `Bearer ${jeton}` });
  if (r.status === 401) {
    jetonCache = null;
    r = await ffbbFetch(cheminComplet, { Authorization: `Bearer ${await getJeton()}` });
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
      // Une même équipe peut être engagée en championnat ET en coupe.
      // Les deux engagements sont distincts chez la FFBB, avec leur
      // propre poule : il ne faut surtout pas les confondre.
      const estCoupe = (e?.idCompetition?.typeCompetition || "").toUpperCase() === "COUPE";
      return {
        type: estCoupe ? "coupe" : "championnat",
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
        g.type === eq.type &&
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
    if (g.type === "coupe") continue;   // la coupe ne crée pas une équipe de plus
    const k = `${g.categorie}|${g.sexe || ""}`;
    effectifs[k] = (effectifs[k] || 0) + 1;
  }
  // Une équipe engagée UNIQUEMENT en coupe doit quand même être comptée,
  // sinon elle n'apparaîtrait nulle part tant que son championnat
  // n'est pas publié par le comité.
  for (const g of groupes) {
    if (g.type !== "coupe") continue;
    const k = `${g.categorie}|${g.sexe || ""}`;
    const dejaEnChampionnat = groupes.some(
      (x) => x.type === "championnat" && x.categorie === g.categorie &&
             x.sexe === g.sexe && (x.numeroEquipe || "") === (g.numeroEquipe || "")
    );
    if (!dejaEnChampionnat) effectifs[k] = (effectifs[k] || 0) + 1;
  }
  groupes.forEach((g) => {
    g.numerote = effectifs[`${g.categorie}|${g.sexe || ""}`] > 1;
  });

  /* Une équipe = une catégorie, un sexe, un numéro.
     Elle porte son championnat et, s'il existe, sa coupe. */
  const parEquipe = [];
  for (const g of groupes) {
    const cle = `${g.categorie}|${g.sexe || ""}|${g.numeroEquipe || ""}`;
    let eq = parEquipe.find((x) => x.cle === cle);
    if (!eq) { eq = { cle, championnat: null, coupe: null, modele: g }; parEquipe.push(eq); }
    if (g.type === "coupe") eq.coupe = g;
    else { eq.championnat = g; eq.modele = g; }
  }

  return {
    club: {
      id: club.id,
      code: club.code,
      nom: club.nom,
      logo: logoUrl(club?.logo?.id, 256),
    },
    saison: equipes.length ? equipes[0].saisonLibelle || equipes[0].saison : null,
    nombreEquipes: parEquipe.length,
    nombreCoupes: parEquipe.filter((x) => x.coupe).length,
    equipes: parEquipe.map(({ championnat, coupe, modele }) => {
      const g = championnat || coupe;   // une équipe peut n'avoir que sa coupe
      return {
        id: g.id,
        libelle: libelleAffichage(modele),
        categorie: g.categorie,
        sexe: g.sexe,
        niveau: g.niveau,
        competition: g.competition,
        code: g.code,
        poule: g.poule,
        pouleId: g.pouleId,
        phase: g.phaseCourante,
        nbPhases: g.phases.length,
        enChampionnat: !!championnat,
        urlDonnees: `/api/equipe?id=${g.id}`,
        // Engagement en coupe, avec sa propre poule et ses propres matchs
        coupe: coupe ? {
          id: coupe.id,
          competition: coupe.competition,
          poule: coupe.poule,
          pouleId: coupe.pouleId,
          urlDonnees: `/api/equipe?id=${coupe.id}`,
        } : null,
      };
    }),
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

  /* Sur l'hébergeur, on ne contacte plus la FFBB : son pare-feu refuse les
     requêtes venant des datacenters depuis le 19 octobre 2026. On sert ce
     que le collecteur a déposé depuis une connexion ordinaire.
     Le mode direct ne sert qu'au collecteur lui-même, qui tourne sur une
     machine à connexion résidentielle. */
  /* Le collecteur ne ramène que la saison en cours, celle dont le site a
     besoin. Les autres variantes continuent d'interroger la FFBB : mieux
     vaut un échec franc que de leur servir la saison courante en se faisant
     passer pour autre chose. */
  const variantePrincipale = !options.toutes && !options.saison;

  if (!MODE_DIRECT && variantePrincipale) {
    try {
      const entree = await lireCacheFfbb("club");
      if (entree) {
        const age = ageMinutes(entree.maj);
        res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=86400");
        res.setHeader("X-MBC-Cache", "collecte");
        res.setHeader("X-MBC-Age-Minutes", String(age ?? ""));
        res.status(200).json({ ...entree.charge, collecteLe: entree.collecteLe, ageMinutes: age });
        return;
      }
      /* Cache encore vide : on continue vers la FFBB. Ça couvre la période
         d'installation, où le collecteur n'a pas encore tourné. La pause
         après 403 nous empêche d'insister pour rien. */
    } catch (e) {
      // Supabase indisponible n'est pas une raison de ne rien afficher.
      console.error("cache FFBB illisible, repli sur la FFBB :", e.message);
    }
  }

  const enMemoire = memo.get(cle);
  if (enMemoire && Date.now() - enMemoire.t < MEMO_MS && !debug) {
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
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

    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    res.setHeader("X-MBC-Cache", "frais");
    res.status(200).json(data);
  } catch (e) {
    if (enMemoire) {
      // Pendant un blocage FFBB, le CDN garde la copie périmée plus longtemps :
      // moins d'appels partis vers un pare-feu qui les refuse de toute façon.
      res.setHeader("Cache-Control", "public, s-maxage=1800");
      res.setHeader("X-MBC-Cache", "perime");
      res.status(200).json({ ...enMemoire.data, perime: true, erreur: e.message });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ erreur: "FFBB injoignable", detail: e.message });
  }
}
