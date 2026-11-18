// État d'une échéance (sans sous-tâches depuis le 18/11/2026) : jours restants et couleur selon la proximité.

import { ecartJours } from "./dates.js";

/**
 * ✓ fait : échéance marquée faite.
 * 🔴 rouge : dépassée (non faite) ou dans 2 jours ou moins.
 * 🟠 orange : dans 3 à 7 jours.
 * 🟢 vert : plus tard.
 */
export function etatEcheance(echeance, aujourdhui) {
  const j = ecartJours(aujourdhui, echeance.date);
  let couleur = "vert";
  if (echeance.faite) couleur = "fait";
  else if (j <= 2) couleur = "rouge";
  else if (j <= 7) couleur = "orange";
  return { joursRestants: j, couleur, faite: !!echeance.faite };
}

export function libelleRestant(j) {
  return j > 1 ? `J-${j}` : j === 1 ? "Demain" : j === 0 ? "Aujourd'hui" : `Dépassée de ${-j} j`;
}
