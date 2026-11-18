// Google Agenda (Phase 5), partie pure et testée : conversion des événements lus, corps des événements écrits,
// et décision de ce qu'il faut créer, mettre à jour ou supprimer.

import { ajouterJours, parseIso, iso } from "./dates.js";

export const NOM_AGENDA = "Échéances";
// Événement « journée entière » = à partir de 0 h : J-3 à 18 h = 54 h avant (3240 min), la veille à 18 h = 6 h avant (360 min).
// Décision du 17/11/2026 (au lieu de 4320/1440, qui tombaient à minuit).
export const RAPPELS = [{ method: "popup", minutes: 3240 }, { method: "popup", minutes: 360 }];
/** Version du contenu des événements : la changer met à jour tous les événements déjà écrits. */
export const VERSION_EVENEMENT = "3"; // 3 : « ✓ » dans le titre quand l'échéance est faite (18/11/2026)

export function signature(objet) {
  return `${objet.majLe || ""}#${VERSION_EVENEMENT}`;
}

/** Événements de l'API → { date, titre, dureeMin, journee } (un par jour couvert pour les événements sur plusieurs jours). */
export function convertirEvenements(items) {
  const out = [];
  for (const ev of items || []) {
    if (ev.status === "cancelled" || !ev.start) continue;
    const titre = ev.summary || "(sans titre)";
    if (ev.start.date) { // journée entière : affichée, pas comptée dans la charge
      for (let d = ev.start.date; d < ev.end.date; d = ajouterJours(d, 1)) out.push({ date: d, titre, dureeMin: 0, journee: true });
      continue;
    }
    const debut = new Date(ev.start.dateTime), fin = new Date(ev.end.dateTime);
    const jour = iso(debut);
    const minutes = Math.max(0, Math.round((fin - debut) / 60000));
    if (iso(fin) === jour || minutes <= 24 * 60) out.push({ date: jour, titre, dureeMin: Math.min(minutes, 24 * 60), journee: false, heure: debut.toTimeString().slice(0, 5) });
    else for (let d = jour; d <= iso(fin); d = ajouterJours(d, 1)) out.push({ date: d, titre, dureeMin: 0, journee: true });
  }
  return out.sort((a, b) => (a.date + (a.heure || "")).localeCompare(b.date + (b.heure || "")));
}

/** Minutes d'agenda par jour (événements avec horaire seulement). */
export function chargeAgenda(evenements) {
  const m = new Map();
  for (const e of evenements || []) if (!e.journee) m.set(e.date, (m.get(e.date) || 0) + e.dureeMin);
  return m;
}

/** Corps d'un événement « toute la journée » pour une échéance (avec rappels) ou une sous-tâche (sans rappel). */
export function corpsEvenement(objet, { sousTache = false, titreEcheance = "", lien = "" } = {}) {
  const date = sousTache ? objet.datePrevue : objet.date;
  return {
    summary: sousTache ? `${objet.faite ? "✓" : "☐"} ${objet.nom} — ${titreEcheance}` : `${objet.faite ? "✓" : "⚑"} ${objet.titre}`,
    description: `${sousTache ? "Sous-tâche" : "Échéance"} gérée par l'appli Échéances.${lien ? "\n" + lien : ""}`,
    start: { date },
    end: { date: ajouterJours(date, 1) },
    transparency: "transparent", // n'apparaît pas comme « occupé »
    reminders: sousTache ? { useDefault: false, overrides: [] } : { useDefault: false, overrides: RAPPELS },
  };
}

/** Que faire pour cet objet dans l'agenda ? 'creer' | 'maj' | 'supprimer' | null */
export function actionAgenda(objet, actif = true) {
  if (objet.supprime || !actif) return objet.gcalEventId ? "supprimer" : null;
  if (!objet.gcalEventId) return "creer";
  if ((objet.gcalMajLe || "") !== signature(objet)) return "maj";
  return null;
}

/** Plage de lecture : une semaine avant, trois mois après. */
export function plageLecture(aujourdhui) {
  const d = parseIso(aujourdhui);
  d.setMonth(d.getMonth() + 3);
  return { debut: ajouterJours(aujourdhui, -7), fin: iso(d) };
}
