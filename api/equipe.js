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
 * Parcourt l'objet de configuration à la recherche d'une chaîne
 * qui ressemble à un JWT. Les noms de champs FFBB ne sont pas
 * documentés et peuvent changer, donc on cherche par forme
 * plutôt que par nom.
 */
function trouverJeton(noeud, profondeur = 0) {
  if (profondeur > 6 || noeud == null) return null;

  if (typeof noeud === "string") {
    return /^ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./.test(noeud) ? noeud : null;
  }
  if (Array.isArray(noeud)) {
    for (const v of noeud) {
      const trouve = trouverJeton(v, profondeur + 1);
      if (trouve) return trouve;
    }
    return null;
  }
  if (typeof noeud === "object") {
    // on regarde d'abord les clés qui sentent le jeton
    const cles = Object.keys(noeud).sort((a, b) => {
      const score = (k) => (/token|jwt|bearer|api|key/i.test(k) ? 0 : 1);
      return score(a) - score(b);
    });
    for (const k of cles) {
      if (/meili/i.test(k)) continue; // le jeton Meilisearch ne sert pas ici
      const trouve = trouverJeton(noeud[k], profondeur + 1);
      if (trouve) return trouve;
    }
  }
  return null;
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
      equipesDansLaPoule: classement.length || null,
      premierMatch: matchs[0]?.date || null,
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

/* ---------------------------------------------------------------
   Handler
   --------------------------------------------------------------- */
export default async function handler(req, res) {
  const id = (req.query?.id || "").toString().trim();
  const debug = req.query?.debug === "1";

  res.setHeader("Access-Control-Allow-Origin", "*");

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
