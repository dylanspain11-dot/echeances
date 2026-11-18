// Timeline par semaine : pour chaque jour, échéances, événements d'agenda et congé.
// Fonction pure (tests/timeline.test.mjs).

import { ajouterJours, estWeekEnd } from "./dates.js";

/**
 * @param {string} lundi          premier jour de la semaine (AAAA-MM-JJ)
 * @param {object} p
 * @param {Array}  p.echeances    échéances (non supprimées)
 * @param {Map}    p.conges       date → libellé du congé
 * @param {Array}  p.evenements   événements d'agenda [{ date, titre, dureeMin }]
 */
export function semaine(lundi, { echeances = [], conges = new Map(), evenements = [] }) {
  const jours = [];
  for (let i = 0; i < 7; i++) {
    const date = ajouterJours(lundi, i);
    jours.push({
      date,
      weekEnd: estWeekEnd(date),
      conge: conges.get(date) || null,
      echeances: echeances.filter((e) => e.date === date),
      evenements: evenements.filter((e) => e.date === date),
    });
  }
  return jours;
}
