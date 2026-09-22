/**
 * api/_config-stages.js
 * ---------------------------------------------------------------
 * LA SEULE PARTIE À MAINTENIR À LA MAIN.
 * Un bloc par stage. Le préfixe _ empêche Vercel d'en faire une route.
 *
 * capaciteParJour : nombre maximum de stagiaires par journée.
 * prixJour / prixSemaine : en euros. Le forfait semaine s'applique
 * automatiquement quand tous les jours du stage sont cochés.
 * paiement3x : autorisé seulement à partir de ce montant (euros).
 * ---------------------------------------------------------------
 */
export const STAGES = [
  {
    id: "toussaint-2026-u11-u13",
    titre: "Stage de Toussaint U11-U13",
    periode: "Vacances de Toussaint 2026",
    public: "U11 et U13, nés de 2014 à 2017",
    anneesNaissance: [2014, 2015, 2016, 2017],
    encadrant: "Marjorie Barré",
    horaires: "9h à 16h",
    precision: "Repas tiré du sac",
    lieu: "Gymnase Pierre Perdiguier",
    jours: ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"],
    capaciteParJour: 24,          // À CONFIRMER
    prixJour: 20,
    prixSemaine: 90,
    paiement3xDes: 90,
    ouvert: true,
  },
  {
    id: "toussaint-2026-u15-u18",
    titre: "Stage de Toussaint U15-U18",
    periode: "Vacances de Toussaint 2026",
    public: "U15 et U18, nés de 2009 à 2013",
    anneesNaissance: [2009, 2010, 2011, 2012, 2013],
    encadrant: "Malcolm Reid",
    horaires: "16h à 20h",
    precision: "Niveau avancé : joueurs de région ou départementaux confirmés",
    lieu: "Gymnase Pierre Perdiguier",
    jours: ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"],
    capaciteParJour: 20,          // À CONFIRMER
    prixJour: 20,
    prixSemaine: 90,
    paiement3xDes: 90,
    ouvert: true,
  },
];

export function trouverStage(id) {
  return STAGES.find((s) => s.id === id) || null;
}

/** Prix d'une sélection de jours, forfait semaine compris. */
export function calculerPrix(stage, jours) {
  const n = jours.length;
  if (!n) return 0;
  if (n === stage.jours.length) return stage.prixSemaine;
  return n * stage.prixJour;
}
