/**
 * api/instagram-image.js
 * ---------------------------------------------------------------
 * Sert d'intermédiaire pour les images d'Instagram.
 *
 * Pourquoi c'est indispensable :
 *   - Le CDN d'Instagram refuse les appels venant d'un autre site.
 *     Une balise img pointant directement dessus affiche une image
 *     cassée.
 *   - Les URL d'images sont signées et expirent au bout de quelques
 *     heures. Elles ne peuvent donc pas être stockées durablement.
 *
 * Appel :
 *   /api/instagram-image?url=<URL encodée>&w=640
 *
 * Sécurité : seules les URL des domaines d'Instagram et de Facebook
 * sont acceptées, sinon la fonction devient un proxy ouvert que
 * n'importe qui pourrait utiliser pour masquer son trafic.
 * ---------------------------------------------------------------
 */

const DOMAINES_AUTORISES = [
  "cdninstagram.com",   // scontent.cdninstagram.com, servi par l'API officielle
  "fbcdn.net",          // scontent-*.xx.fbcdn.net
  "instagram.com",
  "facebook.com",
];

const CACHE = 21600;         // 6 h côté CDN
const CACHE_LONG = 604800;   // 7 j en réutilisation périmée

function domaineAutorise(hote) {
  return DOMAINES_AUTORISES.some(
    (d) => hote === d || hote.endsWith("." + d)
  );
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const brut = req.query?.url;
  if (!brut) {
    res.status(400).json({ erreur: "Paramètre url manquant" });
    return;
  }

  let cible;
  try {
    cible = new URL(brut);
  } catch {
    res.status(400).json({ erreur: "URL invalide" });
    return;
  }

  if (cible.protocol !== "https:" || !domaineAutorise(cible.hostname)) {
    res.status(403).json({ erreur: "Domaine non autorisé" });
    return;
  }

  try {
    const amont = await fetch(cible.toString(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        // Instagram sert ses images sans référent, en ajouter un fait échouer.
        "Referer": "",
      },
    });

    if (!amont.ok) {
      // 403 signifie presque toujours une URL signée expirée.
      res.setHeader("Cache-Control", "public, s-maxage=60");
      res.status(amont.status === 403 ? 410 : 502).json({
        erreur: amont.status === 403 ? "Image expirée" : "Image indisponible",
        http: amont.status,
        aide: "Rafraîchir /api/instagram pour obtenir des URL à jour.",
      });
      return;
    }

    const type = amont.headers.get("content-type") || "";
    if (!type.startsWith("image/")) {
      res.status(415).json({ erreur: "Le contenu récupéré n'est pas une image" });
      return;
    }

    const buffer = Buffer.from(await amont.arrayBuffer());

    res.setHeader("Content-Type", type);
    res.setHeader("Content-Length", buffer.length);
    res.setHeader(
      "Cache-Control",
      `public, s-maxage=${CACHE}, stale-while-revalidate=${CACHE_LONG}, max-age=${CACHE}`
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(200).send(buffer);
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ erreur: "Récupération impossible", detail: e.message });
  }
}
