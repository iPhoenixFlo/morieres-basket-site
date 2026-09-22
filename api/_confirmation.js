/**
 * api/_confirmation.js
 * Confirmation d'une inscription payée. Idempotente : appelée à la fois
 * par le retour de paiement et par le webhook, sans risque de doublon.
 */
import { lireInscription, modifierInscription, confirmerPlaces } from "./_db.js";

export async function confirmerInscription(id, commande) {
  const i = await lireInscription(id);
  if (!i || i.statut === "payee") return i;
  await confirmerPlaces(id);
  await modifierInscription(id, { statut: "payee", commande: commande || null, payee_le: new Date().toISOString() });
  return { ...i, statut: "payee" };
}
