/**
 * api/_helloasso.js
 * ---------------------------------------------------------------
 * Paiement HelloAsso par l'API Checkout.
 *
 * Variables d'environnement :
 *   HELLOASSO_CLIENT_ID, HELLOASSO_CLIENT_SECRET
 *   HELLOASSO_ORG_SLUG   identifiant de l'association dans l'URL HelloAsso
 *   HELLOASSO_ENV        "sandbox" pour les essais, "prod" en réel
 * ---------------------------------------------------------------
 */
const BASE = process.env.HELLOASSO_ENV === "prod"
  ? "https://api.helloasso.com"
  : "https://api.helloasso-sandbox.com";

let jeton = { valeur: null, expire: 0 };

async function obtenirJeton() {
  if (jeton.valeur && Date.now() < jeton.expire - 60000) return jeton.valeur;
  const r = await fetch(`${BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.HELLOASSO_CLIENT_ID || "",
      client_secret: process.env.HELLOASSO_CLIENT_SECRET || "",
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`HelloAsso authentification : ${j.error_description || r.status}`);
  jeton = { valeur: j.access_token, expire: Date.now() + (j.expires_in || 1800) * 1000 };
  return jeton.valeur;
}

async function appel(chemin, options = {}) {
  const t = await obtenirJeton();
  const slug = process.env.HELLOASSO_ORG_SLUG;
  if (!slug) throw new Error("HELLOASSO_ORG_SLUG manquant");
  const r = await fetch(`${BASE}/v5/organizations/${encodeURIComponent(slug)}${chemin}`, {
    ...options,
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`HelloAsso HTTP ${r.status} : ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

/** Échéancier en centimes : 1x = un seul prélèvement, 3x = trois mensualités. */
export function echeancier(totalEuros, nombre) {
  const total = Math.round(totalEuros * 100);
  if (nombre === 1) return { initial: total, suivantes: [] };
  const base = Math.floor(total / nombre);
  const initial = total - base * (nombre - 1);           // l'arrondi va sur la première
  const suivantes = [];
  for (let i = 1; i < nombre; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() + i);
    suivantes.push({ amount: base, date: d.toISOString().slice(0, 10) });
  }
  return { initial, suivantes };
}

export async function creerPaiement({ totalEuros, nombre, libelle, payeur, metadata, urls }) {
  const e = echeancier(totalEuros, nombre);
  const corps = {
    totalAmount: Math.round(totalEuros * 100),
    initialAmount: e.initial,
    itemName: libelle.slice(0, 250),
    backUrl: urls.retourArriere,
    errorUrl: urls.erreur,
    returnUrl: urls.retour,
    containsDonation: false,
    payer: payeur,
    metadata,
  };
  if (e.suivantes.length) corps.terms = e.suivantes;
  return appel("/checkout-intents", { method: "POST", body: JSON.stringify(corps) });
}

/** Un paiement est acquis quand HelloAsso a créé une commande. */
export async function lirePaiement(idPaiement) {
  const j = await appel(`/checkout-intents/${encodeURIComponent(idPaiement)}`);
  return { paye: !!j?.order, commande: j?.order?.id || null };
}
