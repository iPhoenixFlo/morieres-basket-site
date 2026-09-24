/**
 * api/inscription.js
 * ---------------------------------------------------------------
 *   POST /api/inscription
 *     Vérifie le formulaire, réserve les places 30 minutes,
 *     crée le paiement HelloAsso et renvoie le lien de paiement.
 *
 *   GET /api/inscription?statut=ID
 *     Statut d'une inscription, utilisé au retour de HelloAsso.
 *     Si le paiement est acquis, confirme l'inscription au passage.
 * ---------------------------------------------------------------
 */
import { trouverStage, calculerPrix } from "./_config-stages.js";
import { reserver, libererPlaces, creerInscription, modifierInscription, supprimerInscription, lireInscription } from "./_db.js";
import { creerPaiement, lirePaiement } from "./_helloasso.js";
import { confirmerInscription } from "./_confirmation.js";

const SITE = process.env.MBC_SITE || "https://morieres-basket.club";
const RESERVATION_MS = 30 * 60 * 1000;

const JOURS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const libelleJour = (iso) => { const d = new Date(iso + "T12:00:00Z");
  return `${JOURS[d.getUTCDay()]} ${d.getUTCDate()} ${MOIS[d.getUTCMonth()]}`; };

const nettoyer = (v, max = 120) => String(v ?? "").replace(/[<>]/g, "").trim().slice(0, max);

/* Mise en forme des noms, appliquée côté serveur pour que la base
   reste propre quoi que tape le parent :
   nom de famille en majuscules, prénom avec une capitale par partie
   (Jean-Pierre, D'Angelo, Marie Claire). */
const espaces = (v) => nettoyer(v).replace(/\s+/g, " ");
const majuscules = (v) => espaces(v).toLocaleUpperCase("fr-FR");

const capitaliser = (v) =>
  espaces(v)
    .toLocaleLowerCase("fr-FR")
    .replace(/(^|[\s\-'’])([\p{L}])/gu, (m, avant, lettre) => avant + lettre.toLocaleUpperCase("fr-FR"));

const email = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
const tel = (v) => /^[0-9 +().-]{8,20}$/.test(v);

function valider(b, stage) {
  const e = [];
  if (!stage) return { erreurs: ["Stage inconnu."], jours: [], nombre: 1, montant: 0 };
  if (!stage.ouvert) e.push("Les inscriptions à ce stage sont closes.");

  const jours = Array.isArray(b.jours) ? [...new Set(b.jours)] : [];
  if (!jours.length) e.push("Choisis au moins un jour.");
  if (jours.some((j) => !stage.jours.includes(j))) e.push("Un des jours choisis n'existe pas.");

  const en = b.enfant || {}, pa = b.parent || {};
  if (!nettoyer(en.prenom)) e.push("Le prénom du stagiaire est obligatoire.");
  if (!nettoyer(en.nom)) e.push("Le nom du stagiaire est obligatoire.");
  const annee = Number(String(en.naissance || "").slice(0, 4));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(en.naissance || "")) e.push("La date de naissance est invalide.");
  else if (!stage.anneesNaissance.includes(annee))
    e.push(`Ce stage est réservé aux enfants nés de ${Math.min(...stage.anneesNaissance)} à ${Math.max(...stage.anneesNaissance)}.`);

  if (!nettoyer(pa.prenom) || !nettoyer(pa.nom)) e.push("Le nom du responsable légal est obligatoire.");
  if (!email(pa.email || "")) e.push("L'adresse e-mail est invalide.");
  if (!tel(pa.tel || "")) e.push("Le numéro de téléphone est invalide.");

  if (nettoyer(b.sante?.allergies, 500) && !b.sante?.consentement)
    e.push("Pour enregistrer des informations de santé, le consentement est obligatoire.");

  const nombre = b.paiement === "3x" ? 3 : 1;
  const montant = calculerPrix(stage, jours);
  if (nombre === 3 && montant < stage.paiement3xDes)
    e.push(`Le paiement en 3 fois est disponible à partir de ${stage.paiement3xDes} €.`);

  return { erreurs: e, jours: jours.sort(), nombre, montant };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  // ---------- retour de paiement ----------
  if (req.method === "GET") {
    const id = nettoyer(req.query?.statut, 40);
    const i = id && await lireInscription(id);
    if (!i) { res.status(404).json({ erreur: "Inscription introuvable" }); return; }
    if (i.statut === "attente" && i.paiementId) {
      try {
        const p = await lirePaiement(i.paiementId);
        if (p.paye) await confirmerInscription(id, p.commande);
      } catch (e) { /* on renverra le statut connu */ }
    }
    const a_jour = await lireInscription(id);
    const stage = trouverStage(a_jour.stageId);
    res.status(200).json({
      statut: a_jour.statut,
      prenom: a_jour.enfant.prenom,
      stage: stage?.titre || null,
      jours: a_jour.jours,
      montant: a_jour.montant,
      paiement: a_jour.paiement,
    });
    return;
  }

  if (req.method !== "POST") { res.status(405).json({ erreur: "Méthode non autorisée" }); return; }

  // ---------- nouvelle inscription ----------
  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const stage = trouverStage(b.stageId);
  const v = valider(b, stage);
  if (v.erreurs.length) { res.status(400).json({ erreurs: v.erreurs }); return; }

  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  // Les données sont purgées 30 jours après la fin du stage.
  const finStage = new Date(stage.jours[stage.jours.length - 1] + "T23:59:59Z").getTime();
  const inscription = {
    id, stageId: stage.id, jours: v.jours, statut: "attente",
    montant: v.montant, paiement: v.nombre === 3 ? "3x" : "1x",
    enfant: { prenom: capitaliser(b.enfant.prenom), nom: majuscules(b.enfant.nom), naissance: b.enfant.naissance },
    parent: { prenom: capitaliser(b.parent.prenom), nom: majuscules(b.parent.nom),
              email: nettoyer(b.parent.email).toLowerCase(), tel: nettoyer(b.parent.tel, 20) },
    autorisations: { photo: !!b.autorisations?.photo, sortie: !!b.autorisations?.sortie },
    sante: b.sante?.consentement && nettoyer(b.sante.allergies, 500)
      ? { allergies: nettoyer(b.sante.allergies, 500) } : null,
    purgeLe: finStage + 30 * 86400000,
  };

  // L'inscription d'abord, puis les places : la base lie les deux,
  // et supprimer l'inscription libère automatiquement ses places.
  try {
    await creerInscription(inscription);
  } catch (e) {
    res.status(502).json({ erreurs: ["L'inscription n'a pas pu être enregistrée. Réessaie dans un instant."], detail: e.message });
    return;
  }

  const plein = await reserver(id, stage.id, v.jours, stage.capaciteParJour, Date.now() + RESERVATION_MS);
  if (plein !== 0) {
    await supprimerInscription(id).catch(() => {});
    res.status(409).json({ erreurs: [`Le ${libelleJour(v.jours[plein - 1])} est complet. Choisis d'autres jours.`] });
    return;
  }

  try {
    const p = await creerPaiement({
      totalEuros: v.montant,
      nombre: v.nombre,
      libelle: `${stage.titre} - ${inscription.enfant.prenom} ${inscription.enfant.nom} - ${v.jours.length} jour(s)`,
      payeur: { firstName: inscription.parent.prenom, lastName: inscription.parent.nom, email: inscription.parent.email },
      metadata: { inscription: id, stage: stage.id },
      urls: {
        retour: `${SITE}/stages?inscription=${id}`,
        retourArriere: `${SITE}/stages`,
        erreur: `${SITE}/stages?inscription=${id}&erreur=1`,
      },
    });
    await modifierInscription(id, { paiement_id: String(p.id) });
    res.status(200).json({ lien: p.redirectUrl, inscription: id });
  } catch (e) {
    await supprimerInscription(id).catch(() => {});
    res.status(502).json({ erreurs: ["Le paiement n'a pas pu être préparé. Réessaie dans un instant."], detail: e.message });
  }
}
