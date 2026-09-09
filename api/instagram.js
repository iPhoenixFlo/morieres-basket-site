/**
 * api/instagram.js
 * ---------------------------------------------------------------
 * Récupère les dernières publications du compte Instagram du club
 * via l'API officielle Meta "Instagram API with Instagram Login".
 *
 * Pas de scraping, pas de blocage d'adresse IP : l'authentification
 * se fait par jeton, donc la fonction marche depuis n'importe où.
 *
 * Variables d'environnement attendues sur Vercel :
 *   IG_APP_ID      identifiant de l'app Instagram
 *   IG_APP_SECRET  clé secrète Instagram (jamais côté navigateur)
 *   IG_TOKEN       jeton généré depuis Meta for Developers
 *
 * Appels :
 *   /api/instagram             -> 6 derniers posts
 *   /api/instagram?n=3         -> 3 derniers posts
 *   /api/instagram?debug=1     -> ajoute l'état du jeton
 *   /api/instagram?token=1     -> affiche uniquement l'état du jeton
 *
 * À SAVOIR SUR LE JETON
 *   Le jeton généré dans l'interface Meta dure 1 heure. Au premier
 *   appel, la fonction l'échange contre un jeton de 60 jours et le
 *   garde en mémoire. Elle le renouvelle ensuite automatiquement
 *   dès qu'il a plus de 24 h et moins de 50 jours.
 *
 *   Limite à connaître : la mémoire d'une fonction serverless ne
 *   survit pas indéfiniment. Si le projet reste sans trafic pendant
 *   très longtemps, le jeton en mémoire est perdu et la fonction
 *   repart de IG_TOKEN. C'est pourquoi elle affiche, quand un jeton
 *   long est obtenu, un message invitant à le recopier dans la
 *   variable d'environnement. Une fois IG_TOKEN remplacé par un
 *   jeton longue durée, le renouvellement tient tout seul tant que
 *   le site reçoit un peu de trafic.
 * ---------------------------------------------------------------
 */

const GRAPH = "https://graph.instagram.com";

const CACHE_CDN = 1800;        // 30 min
const CACHE_PERIME = 172800;   // 48 h de secours

const memo = new Map();
const MEMO_MS = 15 * 60 * 1000;

// Jeton courant, conservé tant que la fonction reste chaude.
let jeton = {
  valeur: null,
  expire: 0,        // horodatage d'expiration
  longueDuree: false,
};

/* ---------------------------------------------------------------
   Gestion du jeton
   --------------------------------------------------------------- */
async function appelGraph(chemin, params) {
  const url = `${GRAPH}${chemin}?${new URLSearchParams(params)}`;
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  const json = await r.json().catch(() => null);

  if (!r.ok || json?.error) {
    const e = json?.error;
    const message = e
      ? `${e.message} (type ${e.type}, code ${e.code})`
      : `HTTP ${r.status}`;
    throw new Error(message);
  }
  return json;
}

/** Échange un jeton court (1 h) contre un jeton longue durée (60 j). */
async function echangerJeton(court) {
  const json = await appelGraph("/access_token", {
    grant_type: "ig_exchange_token",
    client_secret: process.env.IG_APP_SECRET,
    access_token: court,
  });
  return {
    valeur: json.access_token,
    expire: Date.now() + (json.expires_in || 5184000) * 1000,
    longueDuree: true,
  };
}

/** Prolonge un jeton longue durée pour 60 jours de plus. */
async function renouvelerJeton(long) {
  const json = await appelGraph("/refresh_access_token", {
    grant_type: "ig_refresh_token",
    access_token: long,
  });
  return {
    valeur: json.access_token,
    expire: Date.now() + (json.expires_in || 5184000) * 1000,
    longueDuree: true,
  };
}

async function getJeton() {
  const depart = process.env.IG_TOKEN;
  if (!depart) throw new Error("Variable IG_TOKEN absente");

  // Jeton long encore valide et pas près d'expirer : on le garde.
  const dixJours = 10 * 24 * 3600 * 1000;
  if (jeton.valeur && jeton.longueDuree && jeton.expire - Date.now() > dixJours) {
    return jeton;
  }

  // Jeton long qui approche de sa fin : on le prolonge.
  if (jeton.valeur && jeton.longueDuree) {
    try {
      jeton = await renouvelerJeton(jeton.valeur);
      return jeton;
    } catch (e) {
      // Le renouvellement a échoué, on repart du jeton d'origine.
    }
  }

  // Premier appel, ou mémoire perdue : on part de IG_TOKEN.
  // Si c'est déjà un jeton long, l'échange échoue et on le prolonge.
  try {
    jeton = await echangerJeton(depart);
    jeton.nouveau = true;
  } catch (e) {
    try {
      jeton = await renouvelerJeton(depart);
      jeton.nouveau = true;
    } catch (e2) {
      // Ni échangeable ni renouvelable : on l'utilise tel quel.
      jeton = { valeur: depart, expire: Date.now() + 3600 * 1000, longueDuree: false };
    }
  }
  return jeton;
}

/* ---------------------------------------------------------------
   Mise en forme
   --------------------------------------------------------------- */
const MOIS = ["janv.","févr.","mars","avr.","mai","juin","juil.","août","sept.","oct.","nov.","déc."];

function formaterDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const p = new Intl.DateTimeFormat("fr-FR", {
    weekday: "short", day: "numeric", month: "numeric", year: "numeric",
    timeZone: "Europe/Paris",
  }).formatToParts(d).reduce((o, x) => ((o[x.type] = x.value), o), {});
  const num = String(parseInt(p.day, 10));
  const mois = MOIS[parseInt(p.month, 10) - 1];
  return {
    iso: d.toISOString(),
    jour: p.weekday,
    num,
    mois,
    annee: p.year,
    texte: `${num} ${mois} ${p.year}`,
    court: `${num} ${mois}`,
  };
}

/* Plage Unicode des émojis et symboles décoratifs, utilisée pour
   nettoyer les titres. Le texte, lui, garde ses émojis. */
const EMOJIS = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}\u{20E3}]/gu;

/** Retire émojis et séparateurs en début et en fin, pas au milieu.
 *  Renvoie une chaîne vide si la ligne n'était que décorative. */
function nettoyerTitre(t) {
  let s = (t || "").trim();
  const bords = "(?:" + EMOJIS.source + "|[\\s|·\\-–—•*_=~]){1,16}";
  s = s.replace(new RegExp("^" + bords, "u"), "");
  s = s.replace(new RegExp(bords + "$", "u"), "");
  s = s.replace(/\s{2,}/g, " ").trim();
  return s;
}

/** Retire le bloc de hashtags, généralement en fin de légende. */
function retirerHashtags(t) {
  if (!t) return "";
  return t
    .split("\n")
    // une ligne composée uniquement de hashtags saute entièrement
    .filter((l) => !/^\s*(#[^\s#]+[\s,]*){2,}$/.test(l.trim()))
    .join("\n")
    // hashtags isolés en fin de texte
    .replace(/(?:\s*#[^\s#]+){2,}\s*$/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Première ligne de la légende en titre, le reste en texte.
 * Le titre est nettoyé de ses émojis, le texte de ses hashtags.
 */
function decouperLegende(legende) {
  const brut = (legende || "").replace(/\r/g, "").trim();
  if (!brut) return { titre: "Publication", texte: "", legende: "" };

  const lignes = brut.split("\n").map((l) => l.trim()).filter(Boolean);
  let titre = lignes[0] || "Publication";
  let reste = lignes.slice(1).join("\n").trim();

  if (titre.length > 90) {
    const coupe = titre.match(/^(.{20,90}?[.!?])\s+(.*)$/s);
    if (coupe) {
      reste = (coupe[2] + (reste ? "\n" + reste : "")).trim();
      titre = coupe[1];
    } else {
      reste = (titre.slice(80) + (reste ? "\n" + reste : "")).trim();
      titre = titre.slice(0, 80).trim() + "...";
    }
  }

  let propre = nettoyerTitre(titre);

  // Ligne purement décorative : on prend la ligne suivante comme titre.
  if (!propre && lignes.length > 1) {
    propre = nettoyerTitre(lignes[1]);
    reste = lignes.slice(2).join("\n").trim();
  }

  return {
    titre: propre || "Publication",
    texte: retirerHashtags(reste),
    legende: brut,
  };
}

/**
 * Les URL d'images renvoyées par Meta sont signées et expirent.
 * Elles passent donc par notre proxy, qui les récupère au moment
 * de l'affichage. Même principe que le proxy de Mauguio.
 */
function proxyImage(url) {
  return url ? `/api/instagram-image?url=${encodeURIComponent(url)}` : null;
}

function transformer(compte, medias) {
  const posts = (medias || []).map((m) => {
    const d = decouperLegende(m.caption);
    const source = m.media_type === "VIDEO" ? (m.thumbnail_url || m.media_url) : m.media_url;
    return {
      id: m.id,
      lien: m.permalink || null,
      image: proxyImage(source),
      imageSource: source || null,
      titre: d.titre,
      texte: d.texte,
      legende: d.legende,
      alt: d.titre,
      date: formaterDate(m.timestamp),
      video: m.media_type === "VIDEO",
      carrousel: m.media_type === "CAROUSEL_ALBUM",
    };
  });

  return {
    compte: {
      pseudo: compte?.username || null,
      nom: compte?.name || null,
      publications: compte?.media_count ?? null,
      abonnes: compte?.followers_count ?? null,
      lien: compte?.username ? `https://www.instagram.com/${compte.username}/` : null,
    },
    posts,
    majLe: new Date().toISOString(),
  };
}

/* ---------------------------------------------------------------
   Handler
   --------------------------------------------------------------- */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const n = Math.min(Math.max(parseInt(req.query?.n, 10) || 6, 1), 25);
  const debug = req.query?.debug === "1";
  const infoJeton = req.query?.token === "1";

  // Mode jeton : sert à récupérer le jeton longue durée pour le
  // recopier dans les variables d'environnement.
  if (infoJeton) {
    try {
      const j = await getJeton();
      const jours = Math.round((j.expire - Date.now()) / 86400000);
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json({
        longueDuree: j.longueDuree,
        expireDans: `${jours} jours`,
        expireLe: new Date(j.expire).toISOString(),
        jeton: j.valeur,
        aFaire: j.longueDuree
          ? "Recopier ce jeton dans la variable IG_TOKEN sur Vercel, puis redéployer. Une seule fois."
          : "Le jeton n'a pas pu être converti en longue durée. Vérifier IG_APP_SECRET.",
      });
    } catch (e) {
      res.status(502).json({ erreur: e.message });
    }
    return;
  }

  const cle = `ig:${n}`;
  const enMemoire = memo.get(cle);
  if (enMemoire && Date.now() - enMemoire.t < MEMO_MS && !debug) {
    res.setHeader("Cache-Control", `public, s-maxage=${CACHE_CDN}, stale-while-revalidate=${CACHE_PERIME}`);
    res.setHeader("X-MBC-Cache", "memoire");
    res.status(200).json(enMemoire.data);
    return;
  }

  try {
    const j = await getJeton();

    const compte = await appelGraph("/me", {
      fields: "id,username,name,media_count,followers_count",
      access_token: j.valeur,
    }).catch(async () => {
      // followers_count n'est pas toujours accessible, on réessaie sans.
      return appelGraph("/me", {
        fields: "id,username,media_count",
        access_token: j.valeur,
      });
    });

    const medias = await appelGraph("/me/media", {
      fields: "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp",
      limit: String(n),
      access_token: j.valeur,
    });

    const data = transformer(compte, medias?.data);
    if (!data.posts.length) throw new Error("Aucune publication renvoyée");

    if (debug) {
      data._jeton = {
        longueDuree: j.longueDuree,
        expireDans: Math.round((j.expire - Date.now()) / 86400000) + " jours",
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
      erreur: "Instagram injoignable",
      detail: e.message,
      aide: "Si le message parle de jeton expiré ou invalide, régénérer un jeton dans Meta for Developers et remplacer IG_TOKEN sur Vercel.",
    });
  }
}
