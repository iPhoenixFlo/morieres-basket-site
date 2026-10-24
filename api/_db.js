/**
 * api/_db.js
 * ---------------------------------------------------------------
 * Accès à Supabase par son API REST. Aucune dépendance npm.
 *
 * Variables d'environnement, avec ou sans le préfixe STORAGE_ :
 *   SUPABASE_URL                 https://xxxx.supabase.co
 *   SUPABASE_SECRET_KEY          clé secrète (sb_secret_...), JAMAIS côté navigateur
 *                                ou, à défaut, l'ancienne SUPABASE_SERVICE_ROLE_KEY
 * ---------------------------------------------------------------
 */
/* L'intégration Vercel peut ajouter un préfixe aux noms de variables
   (STORAGE_ par défaut). On accepte les deux formes. */
const env = (nom) =>
  process.env[nom] || process.env[`STORAGE_${nom}`] || process.env[`NEXT_PUBLIC_${nom}`] || "";

const URL = env("SUPABASE_URL").replace(/\/$/, "");
/* Nouvelles clés Supabase (sb_secret_...) ou ancienne clé service_role.
   Les deux donnent l'accès complet : côté serveur uniquement. */
const CLE = env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
const NOUVELLE_CLE = CLE.startsWith("sb_");

async function requete(chemin, { methode = "GET", corps, prefer } = {}) {
  if (!URL || !CLE) throw new Error("Supabase non configuré (SUPABASE_URL / SUPABASE_SECRET_KEY)");
  // Une clé sb_secret_ n'est pas un jeton JWT : elle passe uniquement
  // dans l'en-tête apikey. L'ancienne clé service_role passe dans les deux.
  const entetes = { apikey: CLE, "Content-Type": "application/json" };
  if (!NOUVELLE_CLE) entetes.Authorization = `Bearer ${CLE}`;
  if (prefer) entetes.Prefer = prefer;
  const r = await fetch(`${URL}/rest/v1/${chemin}`, {
    method: methode, headers: entetes, body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const texte = await r.text();
  const j = texte ? JSON.parse(texte) : null;
  if (!r.ok) throw new Error(`Supabase ${r.status} : ${j?.message || texte}`.slice(0, 300));
  return j;
}
const rpc = (fonction, args) => requete(`rpc/${fonction}`, { methode: "POST", corps: args });

/* ---------- places ---------- */
export async function reserver(id, stageId, jours, capacite, expireLe) {
  return Number(await rpc("reserver_places", {
    p_inscription: id, p_stage: stageId, p_jours: jours,
    p_capacite: capacite, p_expire: new Date(expireLe).toISOString(),
  }));
}
export const confirmerPlaces = (id) => rpc("confirmer_places", { p_inscription: id });
export const libererPlaces = (id) => rpc("liberer_places", { p_inscription: id });
export const purger = () => rpc("purger_inscriptions", {});

export async function placesPrises(stageId) {
  const lignes = (await rpc("places_par_jour", { p_stage: stageId })) || [];
  const m = {};
  for (const l of lignes) m[String(l.jour).slice(0, 10)] = Number(l.prises);
  return m;
}

/* ---------- inscriptions ----------
   La base est en snake_case, le code en camelCase : conversion ici. */
const versBase = (i) => ({
  id: i.id, stage_id: i.stageId, jours: i.jours, statut: i.statut,
  montant: i.montant, paiement: i.paiement, enfant: i.enfant, parent: i.parent,
  autorisations: i.autorisations, sante: i.sante, paiement_id: i.paiementId ?? null,
  commande: i.commande ?? null, payee_le: i.payeeLe ? new Date(i.payeeLe).toISOString() : null,
  purge_le: new Date(i.purgeLe).toISOString(),
});
const depuisBase = (r) => r && ({
  id: r.id, stageId: r.stage_id, jours: (r.jours || []).map((d) => String(d).slice(0, 10)),
  statut: r.statut, montant: Number(r.montant), paiement: r.paiement, enfant: r.enfant,
  parent: r.parent, autorisations: r.autorisations, sante: r.sante, paiementId: r.paiement_id,
  commande: r.commande, payeeLe: r.payee_le, purgeLe: r.purge_le,
});

export const creerInscription = (i) =>
  requete("inscriptions", { methode: "POST", corps: versBase(i), prefer: "return=minimal" });

export const modifierInscription = (id, champs) =>
  requete(`inscriptions?id=eq.${encodeURIComponent(id)}`, { methode: "PATCH", corps: champs, prefer: "return=minimal" });

export const supprimerInscription = (id) =>
  requete(`inscriptions?id=eq.${encodeURIComponent(id)}`, { methode: "DELETE", prefer: "return=minimal" });

export async function lireInscription(id) {
  const r = await requete(`inscriptions?id=eq.${encodeURIComponent(id)}&select=*`);
  return depuisBase(r?.[0]);
}

export async function listerPayees(stageId) {
  const r = await requete(`inscriptions?stage_id=eq.${encodeURIComponent(stageId)}&statut=eq.payee&select=*&order=cree_le`);
  return (r || []).map(depuisBase);
}

/* ---------- cache FFBB ----------
   Depuis le 19 octobre 2026, le pare-feu de la FFBB refuse les requêtes
   venant des hébergeurs. Les données sont collectées depuis une connexion
   ordinaire (collecte/collecte-ffbb.mjs), déposées par /api/ingest, et le
   site ne lit plus que cette table.

   Clés : "club", ou "equipe:<identifiant d'engagement>". */

/* Mémo par instance : sur une même requête, resultats.js interroge
   /api/club puis plusieurs /api/equipe. Inutile de retourner en base pour
   une clé qu'on vient de lire. */
const memoFfbb = new Map();
const MEMO_FFBB_MS = 60 * 1000;

export async function lireCacheFfbb(cle) {
  const enMemoire = memoFfbb.get(cle);
  if (enMemoire && Date.now() - enMemoire.t < MEMO_FFBB_MS) return enMemoire.v;

  const r = await requete(
    `ffbb_cache?cle=eq.${encodeURIComponent(cle)}&select=charge,maj,collecte_le&limit=1`
  );
  const ligne = Array.isArray(r) ? r[0] : null;
  const valeur = ligne
    ? { charge: ligne.charge, maj: ligne.maj, collecteLe: ligne.collecte_le || null }
    : null;

  memoFfbb.set(cle, { t: Date.now(), v: valeur });
  return valeur;
}

export async function deposerCacheFfbb(cle, charge, collecteLe = null) {
  const maj = await rpc("deposer_ffbb", {
    p_cle: cle,
    p_charge: charge,
    p_collecte_le: collecteLe || new Date().toISOString(),
  });
  memoFfbb.delete(cle);
  return maj;
}

/** Âge d'une entrée en minutes, pour afficher "données d'il y a 2 h". */
export function ageMinutes(maj) {
  if (!maj) return null;
  const t = Date.parse(maj);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 60000));
}
