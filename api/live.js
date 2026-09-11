// ------------------------------------------------------------
// MBC - Détection du live pour le bandeau d'accueil
// Public : renvoie seulement { live, titre, equipe }, jamais l'ID vidéo.
// La vidéo elle-même n'est accessible que via /api/videos (mot de passe).
// ------------------------------------------------------------

const CACHE = 2 * 60 * 1000; // 2 minutes

let accessToken = null;
let accessTokenExp = 0;
let cache = null;
let cacheTime = 0;

async function jetonGoogle() {
  if (accessToken && Date.now() < accessTokenExp) return accessToken;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.YOUTUBE_CLIENT_ID,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET,
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`google_auth: ${d.error || r.status}`);
  accessToken = d.access_token;
  accessTokenExp = Date.now() + (d.expires_in - 60) * 1000;
  return accessToken;
}

function equipe(titre = '') {
  const t = titre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const m = t.match(/(?:^|[^A-Z])U\s?-?(9|11|13|15|18|21)(?!\d)/);
  if (m) return `U${m[1]}`;
  if (t.includes('SENIOR')) return 'Séniors';
  if (t.includes('LOISIR')) return 'Loisirs';
  return null;
}

function titrePropre(titre = '') {
  return titre.replace(/^\s*mori[eè]res\s+basket\s+club\s*[-\u2013\u2014]\s*/i, '').trim() || 'Match du club';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (cache && Date.now() - cacheTime < CACHE) {
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=60');
    return res.status(200).json(cache);
  }

  try {
    const url = 'https://www.googleapis.com/youtube/v3/liveBroadcasts?' + new URLSearchParams({
      part: 'snippet,status',
      broadcastStatus: 'active',
      broadcastType: 'all',
      maxResults: '5',
    });
    const r = await fetch(url, { headers: { Authorization: `Bearer ${await jetonGoogle()}` } });
    const d = await r.json();
    if (!r.ok) throw new Error(`youtube: ${d.error?.message || r.status}`);

    const b = (d.items || []).find((i) => ['live', 'liveStarting'].includes(i.status?.lifeCycleStatus));
    cache = b
      ? { live: true, titre: titrePropre(b.snippet?.title), equipe: equipe(b.snippet?.title) }
      : { live: false, titre: null, equipe: null };
    cacheTime = Date.now();

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=60');
    return res.status(200).json(cache);
  } catch (err) {
    console.error('[MBC Live]', err.message);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ live: false, titre: null, equipe: null });
  }
}
