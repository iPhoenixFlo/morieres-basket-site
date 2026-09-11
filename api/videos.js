import crypto from 'node:crypto';

// ------------------------------------------------------------
// MBC - Vidéos protégées (live en cours + replays)
// POST { motDePasse }            -> jeton 30 jours + données
// GET  Authorization: Bearer ... -> données
// Variables Vercel : YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET,
// YOUTUBE_REFRESH_TOKEN, MBC_VIDEOS_PASSWORD
// ------------------------------------------------------------

const ORIGINES = ['https://morieres-basket.club', 'https://www.morieres-basket.club'];
const DUREE_JETON = 30 * 24 * 3600 * 1000; // 30 jours
const CACHE_LIVE = 2 * 60 * 1000;          // 2 minutes
const CACHE_REPLAYS = 30 * 60 * 1000;      // 30 minutes
const FENETRE_ECHECS = 15 * 60 * 1000;     // 15 minutes
const MAX_ECHECS = 10;

let accessToken = null;
let accessTokenExp = 0;
let cacheLive = null;
let cacheLiveTime = 0;
let cacheReplays = null;
let cacheReplaysTime = 0;
const echecs = new Map();

// ---------- CORS ----------
function cors(req, res) {
  const origin = req.headers.origin;
  if (ORIGINES.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// ---------- Mot de passe et jeton ----------
function egal(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Changer le mot de passe invalide tous les jetons déjà distribués
function signer(exp) {
  const cle = `${process.env.YOUTUBE_CLIENT_SECRET}:${process.env.MBC_VIDEOS_PASSWORD}`;
  return crypto.createHmac('sha256', cle).update(String(exp)).digest('base64url');
}

function creerJeton() {
  const exp = Date.now() + DUREE_JETON;
  return { jeton: `${exp}.${signer(exp)}`, expire: exp };
}

function jetonValide(jeton) {
  if (!jeton || typeof jeton !== 'string') return false;
  const [exp, sig] = jeton.split('.');
  if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  return egal(sig, signer(exp));
}

// ---------- Anti force brute ----------
function ipDe(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'inconnue';
}

function bloque(ip) {
  const e = echecs.get(ip);
  if (!e) return false;
  if (Date.now() - e.t > FENETRE_ECHECS) {
    echecs.delete(ip);
    return false;
  }
  return e.n >= MAX_ECHECS;
}

function noterEchec(ip) {
  const e = echecs.get(ip);
  if (!e || Date.now() - e.t > FENETRE_ECHECS) echecs.set(ip, { n: 1, t: Date.now() });
  else e.n++;
}

// ---------- Google / YouTube ----------
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

async function youtube(params) {
  const url = 'https://www.googleapis.com/youtube/v3/liveBroadcasts?' + new URLSearchParams(params);
  const r = await fetch(url, { headers: { Authorization: `Bearer ${await jetonGoogle()}` } });
  const d = await r.json();
  if (!r.ok) throw new Error(`youtube: ${d.error?.message || r.status}`);
  return d;
}

// Reconnaît "U18-R3", "U18R3", "U13-1", "U15M", "Séniors", "Loisirs"...
export function equipe(titre = '') {
  const t = titre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const m = t.match(/(?:^|[^A-Z])U\s?-?(9|11|13|15|18|21)(?!\d)/);
  if (m) return `U${m[1]}`;
  if (t.includes('SENIOR')) return 'Séniors';
  if (t.includes('LOISIR')) return 'Loisirs';
  return 'Autres';
}

function formater(b) {
  const s = b.snippet || {};
  return {
    id: b.id,
    titre: s.title,
    equipe: equipe(s.title),
    date: s.actualStartTime || s.scheduledStartTime || s.publishedAt,
    miniature: s.thumbnails?.high?.url || s.thumbnails?.medium?.url || null,
  };
}

async function liveEnCours() {
  if (cacheLive && Date.now() - cacheLiveTime < CACHE_LIVE) return cacheLive.valeur;
  const d = await youtube({
    part: 'snippet,status',
    broadcastStatus: 'active',
    broadcastType: 'all',
    maxResults: '5',
  });
  const b = (d.items || []).find((i) => ['live', 'liveStarting'].includes(i.status?.lifeCycleStatus));
  const valeur = b ? formater(b) : null;
  // Un live vient de se terminer : on rafraîchit les replays tout de suite
  if (cacheLive?.valeur && !valeur) cacheReplays = null;
  cacheLive = { valeur };
  cacheLiveTime = Date.now();
  return valeur;
}

async function replays() {
  if (cacheReplays && Date.now() - cacheReplaysTime < CACHE_REPLAYS) return cacheReplays;
  const liste = [];
  let pageToken;
  for (let page = 0; page < 4; page++) {
    const params = {
      part: 'snippet,status',
      broadcastStatus: 'completed',
      broadcastType: 'all',
      maxResults: '50',
    };
    if (pageToken) params.pageToken = pageToken;
    const d = await youtube(params);
    for (const b of d.items || []) {
      if (b.status?.recordingStatus === 'recorded' && b.status?.privacyStatus !== 'private') {
        liste.push(formater(b));
      }
    }
    pageToken = d.nextPageToken;
    if (!pageToken) break;
  }
  liste.sort((a, b) => new Date(b.date) - new Date(a.date));
  cacheReplays = liste;
  cacheReplaysTime = Date.now();
  return liste;
}

// ---------- Point d'entrée ----------
export default async function handler(req, res) {
  cors(req, res);
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const manquantes = ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN', 'MBC_VIDEOS_PASSWORD']
    .filter((k) => !process.env[k]);
  if (manquantes.length) return res.status(500).json({ erreur: 'configuration', manquantes });

  let nouveauJeton = null;

  if (req.method === 'POST') {
    const ip = ipDe(req);
    if (bloque(ip)) return res.status(429).json({ erreur: 'trop_de_tentatives' });

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    const mdp = body?.motDePasse;

    if (!mdp || !egal(mdp, process.env.MBC_VIDEOS_PASSWORD)) {
      noterEchec(ip);
      await new Promise((r) => setTimeout(r, 800));
      return res.status(401).json({ erreur: 'mot_de_passe' });
    }
    echecs.delete(ip);
    nouveauJeton = creerJeton();
  } else if (req.method === 'GET') {
    const auth = String(req.headers.authorization || '');
    const jeton = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!jetonValide(jeton)) return res.status(401).json({ erreur: 'acces_expire' });
  } else {
    return res.status(405).json({ erreur: 'methode' });
  }

  try {
    const [live, liste] = await Promise.all([liveEnCours(), replays()]);
    return res.status(200).json({ ...(nouveauJeton || {}), live, replays: liste });
  } catch (err) {
    console.error('[MBC Vidéos]', err.message);
    const erreur = err.message.startsWith('google_auth') ? 'youtube_auth' : 'youtube';
    return res.status(502).json({ ...(nouveauJeton || {}), erreur });
  }
}
