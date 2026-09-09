/**
 * api/instagram.js
 * ---------------------------------------------------------------
 * Récupère les dernières publications du compte Instagram public
 * du club, sans jeton et sans compte professionnel.
 *
 * Méthode : endpoint web public d'Instagram, celui qu'utilise le
 * site instagram.com lui-même. Aucun identifiant nécessaire tant
 * que le compte est public.
 *
 * Appels :
 *   /api/instagram              -> 6 derniers posts
 *   /api/instagram?n=3          -> 3 derniers posts
 *   /api/instagram?debug=1      -> ajoute le diagnostic
 *
 * ATTENTION, à lire avant de déployer :
 *   - Cette approche est contraire aux conditions de Meta, qui
 *     interdisent la collecte automatisée. Décision du club.
 *   - Instagram bloque massivement les adresses IP de datacenter,
 *     et Vercel en est un. Prévoir que ça tombe.
 *   - En cas de blocage, renseigner la variable d'environnement
 *     IG_SESSION_ID avec le cookie sessionid d'un compte dédié
 *     (surtout pas le compte principal du club).
 *   - Le cache est volontairement long : moins on interroge
 *     Instagram, plus longtemps ça tient.
 * ---------------------------------------------------------------
 */

const COMPTE = process.env.IG_COMPTE || "morieresbasketclub";

// Identifiant public de l'application web Instagram, le même pour tout le monde.
const APP_ID = "936619743392459";

// Cache CDN. Les URL d'images d'Instagram expirent en quelques heures,
// donc le JSON ne doit pas vivre plus longtemps qu'elles.
const CACHE_CDN = 3600;          // 1 h
const CACHE_PERIME = 172800;     // 48 h de secours si Instagram tombe

// Cache mémoire, utile quand la fonction reste chaude.
const memo = new Map();
const MEMO_MS = 30 * 60 * 1000;

/* ---------------------------------------------------------------
   Récupération
   --------------------------------------------------------------- */
function entetes(avecSession) {
  const h = {
    "X-IG-App-ID": APP_ID,
    "Accept": "*/*",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Referer": `https://www.instagram.com/${COMPTE}/`,
    "X-Requested-With": "XMLHttpRequest",
  };
  if (avecSession && process.env.IG_SESSION_ID) {
    h["Cookie"] = `sessionid=${process.env.IG_SESSION_ID}`;
  }
  return h;
}

async function recupererProfil() {
  const url =
    "https://www.instagram.com/api/v1/users/web_profile_info/?username=" +
    encodeURIComponent(COMPTE);

  // Premier essai sans cookie. Second essai avec, si disponible.
  const essais = process.env.IG_SESSION_ID ? [false, true] : [false];
  let derniereErreur = null;

  for (const avecSession of essais) {
    try {
      const r = await fetch(url, { headers: entetes(avecSession) });

      if (r.status === 401 || r.status === 403) {
        derniereErreur = new Error(
          `Instagram refuse l'accès (HTTP ${r.status}). ` +
          "IP probablement bloquée ou cookie invalide."
        );
        continue;
      }
      if (r.status === 429) {
        derniereErreur = new Error("Instagram limite les requêtes (HTTP 429)");
        continue;
      }
      if (!r.ok) {
        derniereErreur = new Error(`Instagram HTTP ${r.status}`);
        continue;
      }

      const texte = await r.text();
      if (texte.trim().startsWith("<")) {
        derniereErreur = new Error(
          "Instagram a renvoyé une page HTML au lieu du JSON, " +
          "signe d'une redirection vers la page de connexion."
        );
        continue;
      }

      const json = JSON.parse(texte);
      const user = json?.data?.user;
      if (!user) {
        derniereErreur = new Error("Compte introuvable ou structure inattendue");
        continue;
      }
      return user;
    } catch (e) {
      derniereErreur = e;
    }
  }
  throw derniereErreur || new Error("Échec de récupération");
}

/* ---------------------------------------------------------------
   Mise en forme
   --------------------------------------------------------------- */
const MOIS = ["janv.","févr.","mars","avr.","mai","juin","juil.","août","sept.","oct.","nov.","déc."];

function formaterDate(timestamp) {
  if (!timestamp) return null;
  const d = new Date(timestamp * 1000);
  if (isNaN(d)) return null;

  // On lit les composants en heure de Paris, sans zéro initial sur le jour.
  const p = new Intl.DateTimeFormat("fr-FR", {
    weekday: "short", day: "numeric", month: "numeric", year: "numeric",
    timeZone: "Europe/Paris",
  }).formatToParts(d).reduce((o, x) => ((o[x.type] = x.value), o), {});

  const jourNum = String(parseInt(p.day, 10));
  const mois = MOIS[parseInt(p.month, 10) - 1];

  return {
    iso: d.toISOString(),
    jour: p.weekday,          // "sam."
    num: jourNum,             // "5" et non "05"
    mois: mois,               // "sept."
    annee: p.year,
    texte: `${jourNum} ${mois} ${p.year}`,
    court: `${jourNum} ${mois}`,
  };
}

/**
 * Les légendes du club commencent presque toujours par une ligne
 * qui fait office de titre. On la sépare du corps, comme le fait
 * le site de Mauguio.
 */
function decouperLegende(legende) {
  const brut = (legende || "").replace(/\r/g, "").trim();
  if (!brut) return { titre: "Publication", texte: "" };

  const lignes = brut.split("\n").map((l) => l.trim()).filter(Boolean);
  let titre = lignes[0] || "Publication";
  let reste = lignes.slice(1).join("\n").trim();

  // Si la première ligne est très longue, c'est une phrase et non un titre.
  // On coupe alors à la première ponctuation forte.
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

  return { titre, texte: reste, legende: brut };
}

/** Toutes les images passent par notre proxy : le CDN Instagram
 *  refuse les appels venant d'un autre site et ses URL expirent. */
function proxyImage(url, taille) {
  if (!url) return null;
  return `/api/instagram-image?w=${taille}&url=${encodeURIComponent(url)}`;
}

function transformer(user, n) {
  const bord = user?.edge_owner_to_timeline_media?.edges || [];

  const posts = bord.slice(0, n).map(({ node }) => {
    const legende = node?.edge_media_to_caption?.edges?.[0]?.node?.text || "";
    const d = decouperLegende(legende);
    return {
      id: node.id,
      code: node.shortcode,
      lien: `https://www.instagram.com/p/${node.shortcode}/`,
      image: proxyImage(node.display_url, 640),
      vignette: proxyImage(node.thumbnail_src || node.display_url, 320),
      largeur: node?.dimensions?.width || null,
      hauteur: node?.dimensions?.height || null,
      alt: node?.accessibility_caption || d.titre,
      titre: d.titre,
      texte: d.texte,
      legende: d.legende,
      date: formaterDate(node.taken_at_timestamp),
      video: !!node.is_video,
      carrousel: node.__typename === "GraphSidecar",
      likes: node?.edge_liked_by?.count ?? null,
      commentaires: node?.edge_media_to_comment?.count ?? null,
    };
  });

  return {
    compte: {
      pseudo: user.username,
      nom: user.full_name || null,
      abonnes: user?.edge_followed_by?.count ?? null,
      publications: user?.edge_owner_to_timeline_media?.count ?? null,
      lien: `https://www.instagram.com/${user.username}/`,
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

  const n = Math.min(Math.max(parseInt(req.query?.n, 10) || 6, 1), 12);
  const debug = req.query?.debug === "1";
  const cle = `ig:${COMPTE}:${n}`;
  const enMemoire = memo.get(cle);

  if (enMemoire && Date.now() - enMemoire.t < MEMO_MS && !debug) {
    res.setHeader("Cache-Control", `public, s-maxage=${CACHE_CDN}, stale-while-revalidate=${CACHE_PERIME}`);
    res.setHeader("X-MBC-Cache", "memoire");
    res.status(200).json(enMemoire.data);
    return;
  }

  try {
    const user = await recupererProfil();
    const data = transformer(user, n);

    if (!data.posts.length) throw new Error("Aucune publication récupérée");
    if (debug) data._diagnostic = { session: !!process.env.IG_SESSION_ID, compte: COMPTE };

    memo.set(cle, { t: Date.now(), data });

    res.setHeader("Cache-Control", `public, s-maxage=${CACHE_CDN}, stale-while-revalidate=${CACHE_PERIME}`);
    res.setHeader("X-MBC-Cache", "frais");
    res.status(200).json(data);
  } catch (e) {
    // Instagram bloque souvent. Mieux vaut servir du contenu périmé
    // que de vider le bloc actualités de la page d'accueil.
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
      aide: "Si le message parle de blocage ou de page de connexion, renseigner IG_SESSION_ID dans les variables d'environnement Vercel.",
    });
  }
}
