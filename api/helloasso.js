/**
 * api/helloasso.js
 * ---------------------------------------------------------------
 * Webhook HelloAsso. À déclarer dans l'espace association HelloAsso,
 * rubrique Intégrations et API, URL de notification :
 *   https://api.morieres-basket.club/api/helloasso
 *
 * On ne fait jamais confiance au contenu du webhook : on relit le
 * paiement directement chez HelloAsso avant de confirmer.
 * ---------------------------------------------------------------
 */
import { lireInscription } from "./_db.js";
import { lirePaiement } from "./_helloasso.js";
import { confirmerInscription } from "./_confirmation.js";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).end(); return; }
  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const id = b?.metadata?.inscription || b?.data?.metadata?.inscription;
  if (!id) { res.status(200).json({ ignore: true }); return; }

  try {
    const i = await lireInscription(id);
    if (i && i.statut === "attente" && i.paiementId) {
      const p = await lirePaiement(i.paiementId);
      if (p.paye) await confirmerInscription(id, p.commande);
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(200).json({ ok: false, detail: e.message });
  }
}
