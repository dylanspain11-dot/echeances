// Dates en « AAAA-MM-JJ » (jour local, sans heure) : pas de surprise de fuseau horaire.

export function iso(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), j = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${j}`;
}

export function parseIso(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12); // midi : à l'abri des changements d'heure
}

export function aujourdhui() {
  return iso(new Date());
}

export function ajouterJours(s, n) {
  const d = parseIso(s);
  d.setDate(d.getDate() + n);
  return iso(d);
}

export function ecartJours(de, a) {
  return Math.round((parseIso(a) - parseIso(de)) / 86400000);
}

export function estWeekEnd(s) {
  const j = parseIso(s).getDay();
  return j === 0 || j === 6;
}

/** Jour ouvrable : ni samedi, ni dimanche, ni jour de congé. */
export function estOuvrable(s, conges) {
  return !estWeekEnd(s) && !(conges && conges.has(s));
}

/** Avance (pas > 0) ou recule (pas < 0) de |n| jours ouvrables. */
export function decalerOuvrables(s, n, conges) {
  const pas = n >= 0 ? 1 : -1;
  let reste = Math.abs(n), d = s;
  while (reste > 0) {
    d = ajouterJours(d, pas);
    if (estOuvrable(d, conges)) reste--;
  }
  return d;
}

/** Premier jour ouvrable à partir de s (inclus), dans le sens indiqué. */
export function ouvrableLePlusProche(s, conges, pas = -1) {
  let d = s;
  while (!estOuvrable(d, conges)) d = ajouterJours(d, pas);
  return d;
}

const JOURS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

export function dateCourte(s) {
  const d = parseIso(s);
  return `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]}`;
}

/**
 * Périodes de congé saisies à la main, une par ligne :
 *   « 19/12/2026 - 03/01/2027 Vacances d'hiver »  ou  « 11/11/2026 Armistice »
 * Renvoie les jours couverts (bornes incluses) et les lignes illisibles.
 */
export function periodesVersJours(texte) {
  const jours = new Set(), erreurs = [];
  const date = (j, m, a) => {
    const an = a.length === 2 ? 2000 + +a : +a;
    const s = `${an}-${String(m).padStart(2, "0")}-${String(j).padStart(2, "0")}`;
    const d = parseIso(s);
    return d.getDate() === +j && d.getMonth() + 1 === +m ? s : null;
  };
  for (const brute of (texte || "").split("\n")) {
    const ligne = brute.trim();
    if (!ligne || ligne.startsWith("#")) continue;
    const m = ligne.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:\s*(?:-|–|au|à)\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}))?/i);
    const debut = m && date(m[1], m[2], m[3]);
    const fin = m && (m[4] ? date(m[4], m[5], m[6]) : debut);
    if (!debut || !fin || fin < debut || ecartJours(debut, fin) > 120) { erreurs.push(ligne); continue; }
    for (let d = debut; d <= fin; d = ajouterJours(d, 1)) jours.add(d);
  }
  return { jours, erreurs };
}

/** Libellé de congé par jour (« Vacances d'hiver »…), d'après les périodes saisies. */
export function libellesConges(texte) {
  const out = new Map();
  for (const ligne of (texte || "").split("\n")) {
    const { jours } = periodesVersJours(ligne);
    const lib = ligne.replace(/^[\d/.\s–-]+(?:au|à)?[\d/.\s–-]*/i, "").trim() || "Congé";
    for (const j of jours) out.set(j, lib);
  }
  return out;
}

export function lundiDe(s) {
  let d = s;
  while (parseIso(d).getDay() !== 1) d = ajouterJours(d, -1);
  return d;
}
