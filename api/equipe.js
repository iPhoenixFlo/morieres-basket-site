/**
 * api/equipe.js
 * ---------------------------------------------------------------
 * Récupère le calendrier, les résultats et le classement d'une équipe
 * du Morières Basket Club depuis l'API publique FFBB (Directus),
 * et renvoie un JSON prêt à afficher.
 *
 * Appel :
 *   /api/equipe?id=200000005350777          -> U18 masculins
 *   /api/equipe?id=...&debug=1              -> ajoute les données brutes
 *
 * Cache : 30 min sur le CDN Vercel, plus 24 h de "stale-while-revalidate".
 * Concrètement, si la FFBB tombe, le CDN continue de servir la dernière
 * version valide pendant 24 h au lieu de renvoyer une erreur.
 * ---------------------------------------------------------------
 */

const FFBB_API = "https://api.ffbb.com";

// Code organisme du club dans FBI. Sert à savoir, sur chaque rencontre,
// laquelle des deux équipes est la nôtre.
const CLUB_CODE = process.env.MBC_CLUB_CODE || "SUD0084026";

// Règle de mise en avant décidée par le bureau.
// La clé est cherchée dans le nom de l'adversaire, sans accent ni casse.
const MISES_EN_AVANT = [
  { motif: "arlesien", label: "Derby", style: "or" },
  { motif: "arles", label: "Derby", style: "or" },
  { motif: "salonais", label: "Affiche", style: "normal" },
  { motif: "psb", label: "Affiche", style: "normal" },
  { motif: "pontet", label: "Affiche", style: "normal" },
  { motif: "avignon", label: "Affiche", style: "normal" },
];

// Cache mémoire, utile quand la fonction reste chaude entre deux appels.
// Ne remplace pas le cache CDN, il le complète.
const memo = new Map();
const MEMO_MS = 15 * 60 * 1000;

/* ---------------------------------------------------------------
   Authentification
   L'API expose ses jetons de lecture sur un endpoint public.
   On les récupère une fois, puis on les garde en mémoire.
   Un jeton peut aussi être forcé par variable d'environnement.
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

/**
 * Cherche un jeton dans l'objet de configuration.
 * Les noms de champs FFBB ne sont pas documentés, donc on procède
 * en deux passes :
 *   1. les clés qui contiennent token / key / bearer / auth / secret,
 *      en écartant ce qui touche à Meilisearch (autre service) ;
 *   2. à défaut, toute chaîne qui ressemble à un JWT.
 * Directus accepte aussi bien des jetons statiques (chaîne aléatoire)
 * que des JWT, d'où la première passe volontairement large.
 */
function listerCandidats(config) {
  const candidats = [];

  (function parcourir(noeud, chemin, profondeur) {
    if (profondeur > 8 || noeud == null) return;

    if (typeof noeud === "string") {
      const cle = chemin[chemin.length - 1] || "";
      const cheminTexte = chemin.join(".");
      const meili = /meili/i.test(cheminTexte);
      const nomParlant = /token|key|bearer|auth|secret/i.test(cle);
      const jwt = /^ey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./.test(noeud);
      const longueurOk = noeud.length >= 16 && noeud.length <= 3000;
      const pasUneUrl = !/^https?:\/\//i.test(noeud);
      const pasUneDate = !/^\d{4}-\d{2}-\d{2}T/.test(noeud);

      if (longueurOk && pasUneUrl && pasUneDate && (jwt || nomParlant)) {
        candidats.push({
          chemin: cheminTexte,
          valeur: noeud,
          // plus le score est bas, meilleur est le candidat
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
      for (const [k, v] of Object.entries(noeud)) {
        parcourir(v, [...chemin, k], profondeur + 1);
      }
    }
  })(config, [], 0);

  candidats.sort((a, b) => a.score - b.score);
  return candidats;
}

function trouverJeton(config) {
  const c = listerCandidats(config);
  return c.length ? c[0].valeur : null;
}

/* ---------------------------------------------------------------
   Appels Directus
   --------------------------------------------------------------- */
async function directus(chemin, params) {
  const jeton = await getJeton();
  const url = `${FFBB_API}${chemin}?${params}`;

  const r = await fetch(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${jeton}` },
  });

  if (r.status === 401 || r.status === 403) {
    // jeton périmé : on le jette et on retente une fois
    jetonCache = null;
    const jeton2 = await getJeton();
    const r2 = await fetch(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${jeton2}` },
    });
    if (!r2.ok) throw new Error(`FFBB HTTP ${r2.status} sur ${chemin}`);
    return (await r2.json()).data;
  }

  if (!r.ok) throw new Error(`FFBB HTTP ${r.status} sur ${chemin}`);
  return (await r.json()).data;
}

/* ---------------------------------------------------------------
   Récupération
   Deux appels : l'engagement de l'équipe, puis sa poule.
   --------------------------------------------------------------- */
const CHAMPS_ENGAGEMENT = [
  "id",
  "nom",
  "numeroEquipe",
  "idPoule.id",
  "idPoule.nom",
  "idCompetition.id",
  "idCompetition.nom",
  "idCompetition.code",
  "idCompetition.categorie.code",
  "idCompetition.saison.id",
  "idOrganisme.code",
  "idOrganisme.nom",
];

const CHAMPS_POULE = [
  "id",
  "nom",
  "rencontres.id",
  "rencontres.numero",
  "rencontres.numeroJournee",
  "rencontres.date_rencontre",
  "rencontres.joue",
  "rencontres.nomEquipe1",
  "rencontres.nomEquipe2",
  "rencontres.resultatEquipe1",
  "rencontres.resultatEquipe2",
  "rencontres.idEngagementEquipe1.id",
  "rencontres.idEngagementEquipe1.idOrganisme.code",
  "rencontres.idEngagementEquipe2.id",
  "rencontres.idEngagementEquipe2.idOrganisme.code",
  "rencontres.idOrganismeEquipe1.logo.id",
  "rencontres.idOrganismeEquipe2.logo.id",
  "rencontres.salle.libelle",
  "rencontres.salle.commune.libelle",
  "classements.position",
  "classements.points",
  "classements.matchJoues",
  "classements.gagnes",
  "classements.perdus",
  "classements.idEngagement.id",
  "classements.idEngagement.nom",
  "classements.idEngagement.idOrganisme.code",
];

function queryString(champs, deep) {
  const p = new URLSearchParams();
  champs.forEach((c) => p.append("fields[]", c));
  if (deep) p.append("deep", JSON.stringify(deep));
  return p.toString();
}

async function chargerEquipe(engagementId) {
  const engagement = await directus(
    `/items/ffbbserver_engagements/${encodeURIComponent(engagementId)}`,
    queryString(CHAMPS_ENGAGEMENT)
  );

  const pouleId = engagement?.idPoule?.id;
  if (!pouleId) throw new Error("Cette équipe n'a pas de poule rattachée");

  const poule = await directus(
    `/items/ffbbserver_poules/${encodeURIComponent(pouleId)}`,
    queryString(CHAMPS_POULE, {
      rencontres: { _limit: 200, _sort: ["date_rencontre"] },
      classements: { _limit: 50, _sort: ["position"] },
    })
  );

  return { engagement, poule };
}

/* ---------------------------------------------------------------
   Mise en forme
   --------------------------------------------------------------- */
const sansAccent = (s) =>
  (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function miseEnAvant(nomAdversaire) {
  const n = sansAccent(nomAdversaire);
  for (const regle of MISES_EN_AVANT) {
    if (n.includes(regle.motif)) return { label: regle.label, style: regle.style };
  }
  return null;
}

const MOIS_COURT = ["janv.","févr.","mars","avr.","mai","juin","juil.","août","sept.","oct.","nov.","déc."];
const JOUR_COURT = ["dim.","lun.","mar.","mer.","jeu.","ven.","sam."];

/**
 * L'API FFBB renvoie des dates sans fuseau, du type "2026-09-13T09:00:00".
 * Vercel tourne en UTC : si on laisse Date les interpréter puis qu'on
 * reformate en heure de Paris, on décale tout de 1 ou 2 heures.
 * On lit donc les composants tels quels et on ne convertit rien.
 * Les dates qui portent un fuseau explicite (Z ou +02:00) sont, elles,
 * converties normalement vers l'heure de Paris.
 */
function formaterDate(iso) {
  if (!iso) return null;
  const brut = String(iso).trim();

  const naive = brut.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  const aUnFuseau = /(Z|[+-]\d{2}:?\d{2})$/.test(brut);

  if (naive && !aUnFuseau) {
    const [, a, m, j, h, min] = naive.map(Number);
    // Date UTC construite avec les mêmes composants : sert uniquement
    // à connaître le jour de la semaine, sans aucune conversion.
    const ref = new Date(Date.UTC(a, m - 1, j, h, min));
    return {
      iso: brut,
      jour: JOUR_COURT[ref.getUTCDay()],
      num: String(j),
      mois: MOIS_COURT[m - 1],
      heure: `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`,
      timestamp: Date.UTC(a, m - 1, j, h, min),
    };
  }

  const d = new Date(brut);
  if (isNaN(d)) return null;
  const p = new Intl.DateTimeFormat("fr-FR", {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Paris",
  }).formatToParts(d).reduce((o, x) => ((o[x.type] = x.value), o), {});
  return {
    iso: d.toISOString(),
    jour: p.weekday,
    num: p.day,
    mois: p.month,
    heure: `${p.hour}:${p.minute}`,
    timestamp: d.getTime(),
  };
}

function logoUrl(id) {
  return id ? `${FFBB_API}/assets/${id}?width=96&height=96&fit=inside&format=webp` : null;
}

function transformer(engagement, poule) {
  const rencontres = Array.isArray(poule?.rencontres) ? poule.rencontres : [];

  // On ne garde que les rencontres qui concernent le club
  const nos = rencontres.filter((r) => {
    const c1 = r?.idEngagementEquipe1?.idOrganisme?.code;
    const c2 = r?.idEngagementEquipe2?.idOrganisme?.code;
    return c1 === CLUB_CODE || c2 === CLUB_CODE;
  });

  const matchs = nos.map((r) => {
    const nousSommes1 = r?.idEngagementEquipe1?.idOrganisme?.code === CLUB_CODE;
    const domicile = nousSommes1;

    const adversaire = nousSommes1 ? r.nomEquipe2 : r.nomEquipe1;
    const logoAdv = logoUrl(
      nousSommes1 ? r?.idOrganismeEquipe2?.logo?.id : r?.idOrganismeEquipe1?.logo?.id
    );

    const notreScore = nousSommes1 ? r.resultatEquipe1 : r.resultatEquipe2;
    const sonScore = nousSommes1 ? r.resultatEquipe2 : r.resultatEquipe1;
    const joue = !!r.joue && notreScore != null && sonScore != null;
    const dateFmt = formaterDate(r.date_rencontre);

    return {
      id: r.id,
      journee: r.numeroJournee ?? null,
      date: dateFmt,
      domicile,
      adversaire: adversaire || "Adversaire à confirmer",
      logoAdversaire: logoAdv,
      salle: r?.salle?.libelle || null,
      commune: r?.salle?.commune?.libelle || null,
      joue,
      // en attente = la date est passée mais la feuille n'est pas encore remontée
      enAttenteFeuille: !joue && dateFmt ? dateFmt.timestamp < Date.now() : false,
      score: joue ? { nous: notreScore, eux: sonScore, texte: `${notreScore}-${sonScore}` } : null,
      resultat: joue ? (notreScore > sonScore ? "V" : notreScore < sonScore ? "D" : "N") : null,
      miseEnAvant: domicile ? miseEnAvant(adversaire) : null,
    };
  });

  const joues = matchs.filter((m) => m.joue);
  const aVenir = matchs.filter((m) => !m.joue);
  const receptions = aVenir.filter((m) => m.domicile);

  // Un seul billet doré affiché à la fois : le prochain derby à venir.
  let doreUtilise = false;
  for (const m of receptions) {
    if (m.miseEnAvant?.style === "or") {
      if (doreUtilise) m.miseEnAvant = { ...m.miseEnAvant, style: "normal" };
      else doreUtilise = true;
    }
  }

  // Classement
  const classement = (Array.isArray(poule?.classements) ? poule.classements : [])
    .map((c) => ({
      position: c.position ?? null,
      equipe: c?.idEngagement?.nom || "",
      points: c.points ?? null,
      joues: c.matchJoues ?? null,
      gagnes: c.gagnes ?? null,
      perdus: c.perdus ?? null,
      nous: c?.idEngagement?.idOrganisme?.code === CLUB_CODE,
    }))
    .sort((a, b) => (a.position ?? 99) - (b.position ?? 99));

  const nousAuClassement = classement.find((c) => c.nous) || null;

  // Avant la première journée, le classement est vide.
  // On compte alors les équipes distinctes présentes dans les rencontres
  // de la poule, sinon la carte "Équipes" resterait vide toute la pré-saison.
  const equipesPoule = new Set();
  for (const r of rencontres) {
    const c1 = r?.idEngagementEquipe1?.idOrganisme?.code;
    const c2 = r?.idEngagementEquipe2?.idOrganisme?.code;
    if (c1) equipesPoule.add(c1);
    if (c2) equipesPoule.add(c2);
  }
  const nbEquipes = classement.length || equipesPoule.size || null;

  // État de la saison, c'est lui qui pilote l'affichage de la page
  let etat = "avant-saison";
  if (joues.length > 0 && aVenir.length > 0) etat = "en-cours";
  else if (joues.length > 0 && aVenir.length === 0) etat = "terminee";

  // Série en cours, calculée sur les derniers matchs joués
  let serie = null;
  if (joues.length) {
    const ordre = [...joues].reverse();
    const type = ordre[0].resultat;
    let n = 0;
    for (const m of ordre) {
      if (m.resultat === type) n++;
      else break;
    }
    serie = { type, nombre: n, texte: `${n} ${type}` };
  }

  return {
    equipe: {
      id: engagement.id,
      nom: engagement.nom || null,
      competition: engagement?.idCompetition?.nom || null,
      code: engagement?.idCompetition?.code || null,
      categorie: engagement?.idCompetition?.categorie?.code || null,
      poule: poule?.nom || null,
      pouleId: poule?.id || null,
    },
    etat,
    resume: {
      journees: matchs.length,
      joues: joues.length,
      aDomicile: matchs.filter((m) => m.domicile).length,
      equipesDansLaPoule: nbEquipes,
      premierMatch: (aVenir[0] || matchs[0])?.date || null,
      prochaineReception: receptions[0] || null,
      position: nousAuClassement?.position ?? null,
      bilan: nousAuClassement
        ? { v: nousAuClassement.gagnes, d: nousAuClassement.perdus }
        : null,
      serie,
    },
    receptions,        // pour le carrousel de billets
    prochains: aVenir, // domicile et extérieur
    derniers: joues.slice(-6).reverse(),
    calendrier: matchs,
    classement,
    majLe: new Date().toISOString(),
  };
}

/**
 * Décrit la forme d'un objet sans révéler les valeurs.
 * Utilisé uniquement par le mode diagnostic.
 */
function squelette(noeud, profondeur = 0) {
  if (profondeur > 4 || noeud == null) return typeof noeud;
  if (typeof noeud === "string") return `string(${noeud.length})`;
  if (typeof noeud !== "object") return typeof noeud;
  if (Array.isArray(noeud)) {
    return noeud.length ? [squelette(noeud[0], profondeur + 1), `... ${noeud.length} éléments`] : [];
  }
  const o = {};
  for (const [k, v] of Object.entries(noeud)) o[k] = squelette(v, profondeur + 1);
  return o;
}

/* ---------------------------------------------------------------
   Handler
   --------------------------------------------------------------- */
export default async function handler(req, res) {
  const id = (req.query?.id || "").toString().trim();
  const debug = req.query?.debug === "1";

  res.setHeader("Access-Control-Allow-Origin", "*");

  // Mode diagnostic : /api/equipe?config=1
  // Renvoie la structure de /items/configuration et les candidats jetons
  // détectés, avec les valeurs masquées. Sert à régler l'authentification
  // sans jamais exposer un secret en clair.
  if (req.query?.config === "1") {
    try {
      const r = await fetch(`${FFBB_API}/items/configuration`, {
        headers: { Accept: "application/json" },
      });
      const texte = await r.text();
      let config = null;
      try { config = JSON.parse(texte); } catch { /* pas du JSON */ }

      if (!config) {
        res.status(200).json({
          http: r.status,
          typeContenu: r.headers.get("content-type"),
          apercu: texte.slice(0, 600),
        });
        return;
      }

      const candidats = listerCandidats(config).map((c) => ({
        chemin: c.chemin,
        score: c.score,
        longueur: c.valeur.length,
        debut: c.valeur.slice(0, 6),
        fin: c.valeur.slice(-4),
      }));

      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({
        http: r.status,
        clesRacine: Object.keys(config?.data ?? config ?? {}),
        candidats,
        // structure sans les valeurs, pour repérer où se cache le jeton
        squelette: squelette(config?.data ?? config),
      });
    } catch (e) {
      res.status(200).json({ erreur: e.message });
    }
    return;
  }

  if (!id || !/^\d+$/.test(id)) {
    res.status(400).json({ erreur: "Paramètre id manquant ou invalide" });
    return;
  }

  const cle = `equipe:${id}`;
  const enMemoire = memo.get(cle);
  if (enMemoire && Date.now() - enMemoire.t < MEMO_MS && !debug) {
    res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=86400");
    res.setHeader("X-MBC-Cache", "memoire");
    res.status(200).json(enMemoire.data);
    return;
  }

  try {
    const { engagement, poule } = await chargerEquipe(id);
    const data = transformer(engagement, poule);
    if (debug) data._brut = { engagement, poule };

    memo.set(cle, { t: Date.now(), data });

    res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=86400");
    res.setHeader("X-MBC-Cache", "frais");
    res.status(200).json(data);
  } catch (e) {
    // Filet de sécurité : si on a une version en mémoire, on la sert
    // plutôt que de casser la page, même si elle est périmée.
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
