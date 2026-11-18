// Modèles de sous-tâches par type d'échéance (éditables dans les réglages).
// Seul « contrôle » est défini en Phase 1 ; bulletin, conseil de classe et préparation seront proposés en Phase 2.

export const TYPES = {
  controle: "Contrôle",
  bulletin: "Bulletin",
  conseil: "Conseil de classe",
  preparation: "Préparation de cours",
  autre: "Autre",
};

export const MODELES_DEFAUT = [
  {
    id: "modele-controle",
    type: "controle",
    sousTaches: [
      { nom: "Rédiger le contrôle", dureeMin: 120, decalageJours: 7, apresEcheance: false },
      { nom: "Corrigé et grille", dureeMin: 45, decalageJours: 5, apresEcheance: false },
      { nom: "Version élève et mise en page", dureeMin: 30, decalageJours: 3, apresEcheance: false },
      { nom: "Imprimer", dureeMin: 15, decalageJours: 1, apresEcheance: false },
      { nom: "Corriger les copies", dureeMin: 90, decalageJours: 2, apresEcheance: true },
      { nom: "Encoder les notes", dureeMin: 20, decalageJours: 4, apresEcheance: true },
    ],
  },
  // Modèles validés le 17/11/2026 (Phase 2)
  {
    id: "modele-bulletin",
    type: "bulletin",
    sousTaches: [
      { nom: "Vérifier que toutes les notes sont encodées", dureeMin: 30, decalageJours: 5, apresEcheance: false },
      { nom: "Calculer et vérifier les moyennes", dureeMin: 45, decalageJours: 4, apresEcheance: false },
      { nom: "Rédiger les appréciations", dureeMin: 90, decalageJours: 3, apresEcheance: false },
      { nom: "Relire et valider dans le logiciel de l'école", dureeMin: 30, decalageJours: 1, apresEcheance: false },
    ],
  },
  {
    id: "modele-conseil",
    type: "conseil",
    sousTaches: [
      { nom: "Lister les élèves à discuter", dureeMin: 45, decalageJours: 3, apresEcheance: false },
      { nom: "Remplir la fiche du conseil", dureeMin: 30, decalageJours: 2, apresEcheance: false },
      { nom: "Imprimer ou partager les documents", dureeMin: 15, decalageJours: 1, apresEcheance: false },
      { nom: "Communiquer les décisions et les remédiations", dureeMin: 30, decalageJours: 1, apresEcheance: true },
    ],
  },
  {
    id: "modele-preparation",
    type: "preparation",
    sousTaches: [
      { nom: "Relire le programme et fixer les objectifs", dureeMin: 20, decalageJours: 5, apresEcheance: false },
      { nom: "Préparer la théorie", dureeMin: 90, decalageJours: 4, apresEcheance: false },
      { nom: "Préparer les activités et exercices (2 niveaux)", dureeMin: 60, decalageJours: 3, apresEcheance: false },
      { nom: "Préparer les supports (copies, Smartschool)", dureeMin: 20, decalageJours: 1, apresEcheance: false },
    ],
  },
];

export const CLASSES_DEFAUT = [
  { id: "3TQ", nom: "3TQ", cours: ["Économie", "Bureautique", "TAOS"] },
  { id: "3&4PV", nom: "3&4PV", cours: [] },
  { id: "4AS", nom: "4AS", cours: [] },
  { id: "3PS", nom: "3PS", cours: [] },
  { id: "2D", nom: "2D", cours: [] },
];

export const ALIAS_DEFAUT = [
  ["3P", "3&4PV"], ["4P", "3&4PV"], ["3PV", "3&4PV"], ["4PV", "3&4PV"], ["trois TQ", "3TQ"],
  ["3 TQ", "3TQ"], ["4 AS", "4AS"], ["3 PS", "3PS"], ["2 D", "2D"],
].map(([alias, classeId]) => ({ id: `alias-${alias}`, alias, classeId }));
