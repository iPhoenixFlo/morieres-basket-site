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
    titre: "Stage de Toussaint U11 à U15",
    periode: "Vacances de Toussaint 2026",
    public: "U11, U13 et U15, nés de 2012 à 2017",
    anneesNaissance: [2012, 2013, 2014, 2015, 2016, 2017],
    niveau: "Tous niveaux",
    encadrant: "Marjorie Barré",
    horaires: "9h à 16h",
    precision: "Repas tiré du sac. Ouvert à tous les niveaux, du débutant au confirmé.",
    lieu: "Gymnase Pierre Perdiguier",
    jours: ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"],
    capaciteParJour: 20,          // 15 à 20 stagiaires, 20 au maximum
    prixJour: 20,
    prixSemaine: 90,
    paiement3xDes: 40,   // deux jours ou plus : en dessous, les échéances seraient dérisoires
    ouvert: true,
  },
  {
    id: "toussaint-2026-u15-u18",
    titre: "Stage de Toussaint U15-U18",
    periode: "Vacances de Toussaint 2026",
    public: "U15 région ou élite et U18 région, nés de 2009 à 2013",
    anneesNaissance: [2009, 2010, 2011, 2012, 2013],
    niveau: "Niveau avancé",
    encadrant: "Malcolm Reid",
    horaires: "16h à 20h",
    precision: "Réservé aux U15 de niveau région ou élite départementale et aux U18 de niveau région. Les U15 des autres niveaux sont attendus sur le stage de Marjorie.",
    lieu: "Gymnase Pierre Perdiguier",
    jours: ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"],
    capaciteParJour: 25,          // 20 à 25 stagiaires, 25 au maximum
    prixJour: 20,
    prixSemaine: 90,
    paiement3xDes: 40,   // deux jours ou plus : en dessous, les échéances seraient dérisoires
    ouvert: true,
  },
];

export function trouverStage(id) {
  return STAGES.find((s) => s.id === id) || null;
}

/** Prix d'une sélection de jours, forfait semaine compris. */
/* Un U15 né en 2012 ou 2013 remplit la condition d'âge des DEUX stages.
   Le choix se fait alors sur le niveau, pas sur l'année de naissance. */
export const DEUX_STAGES = [2012, 2013];

export function calculerPrix(stage, jours) {
  const n = jours.length;
  if (!n) return 0;
  if (n === stage.jours.length) return stage.prixSemaine;
  return n * stage.prixJour;
}
