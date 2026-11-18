// Dates dites en français : « le 5 décembre », « le 5/12 », « le 5 du 12 », « vendredi (prochain) »,
// « demain », « dans 2 semaines », « dans huit jours », « après les vacances de Noël »…
// Si l'année n'est pas dite : prochaine occurrence future.

import { ajouterJours, iso, parseIso, estOuvrable, ouvrableLePlusProche, periodesVersJours } from "../dates.js";
import { sansAccents } from "./texte.js";

export const MOIS = { janvier: 1, janv: 1, fevrier: 2, fevr: 2, fev: 2, mars: 3, avril: 4, avr: 4, mai: 5, juin: 6,
  juillet: 7, juil: 7, aout: 8, septembre: 9, sept: 9, octobre: 10, oct: 10, novembre: 11, nov: 11, decembre: 12, dec: 12 };
const JOURS = { lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6, dimanche: 0 };
const MOIS_RE = Object.keys(MOIS).sort((a, b) => b.length - a.length).join("|");

function dateValide(an, m, j) {
  const s = `${an}-${String(m).padStart(2, "0")}-${String(j).padStart(2, "0")}`;
  const d = parseIso(s);
  return d.getMonth() + 1 === m && d.getDate() === j ? s : null;
}

/** Jour/mois sans année : cette année si encore à venir, sinon l'an prochain. */
function prochaine(j, m, aujourdhui, an = null) {
  if (an) return dateValide(an < 100 ? 2000 + an : an, m, j);
  const y = +aujourdhui.slice(0, 4);
  const cette = dateValide(y, m, j);
  return cette && cette >= aujourdhui ? cette : dateValide(y + 1, m, j);
}

/** Vacances nommées → mots-clés présents dans le libellé des périodes saisies dans les réglages. */
const VACANCES = [
  [/noel|hiver/, ["hiver", "noel"]],
  [/carnaval|detente/, ["detente", "carnaval"]],
  [/paques|printemps/, ["printemps", "paques"]],
  [/toussaint|automne/, ["automne", "toussaint"]],
  [/ete|grandes vacances/, ["ete"]],
];

/** Dernier jour ouvrable avant le début des vacances nommées (« avant Noël », « dernier jour avant carnaval »). */
function avantVacances(nom, periodesTexte, aujourdhui) {
  const cible = VACANCES.find(([re]) => re.test(nom));
  if (!cible) return null;
  const conges = periodesVersJours(periodesTexte).jours;
  for (const ligne of (periodesTexte || "").split("\n")) {
    const lib = sansAccents(ligne.toLowerCase());
    if (!cible[1].some((k) => lib.includes(k))) continue;
    const m = ligne.match(/^\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (!m) continue;
    const debut = dateValide(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
    if (debut && debut > aujourdhui) return ouvrableLePlusProche(ajouterJours(debut, -1), conges, -1);
  }
  return null;
}

function apresVacances(nom, periodesTexte, aujourdhui) {
  const cible = VACANCES.find(([re]) => re.test(nom));
  if (!cible) return null;
  const conges = periodesVersJours(periodesTexte).jours;
  for (const ligne of (periodesTexte || "").split("\n")) {
    const lib = sansAccents(ligne.toLowerCase());
    if (!cible[1].some((k) => lib.includes(k))) continue;
    const m = ligne.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*$|-\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (!m) continue;
    const [j, mo, a] = m[4] ? [m[4], m[5], m[6]] : [m[1], m[2], m[3]];
    const fin = dateValide(a.length === 2 ? 2000 + +a : +a, +mo, +j);
    if (fin && fin >= aujourdhui) return ouvrableLePlusProche(ajouterJours(fin, 1), conges, +1);
  }
  return null;
}

/**
 * @returns {{ date: string|null, incertain: boolean, note?: string, texte?: string }}
 */
export function extraireDate(t, aujourdhui, periodesTexte = "") {
  let r = null;
  const conges = periodesVersJours(periodesTexte).jours;
  let m;
  if ((m = t.match(new RegExp(`\\b(\\d{1,2}) (${MOIS_RE})\\b(?: (\\d{4}))?`)))) {
    r = { date: prochaine(+m[1], MOIS[m[2]], aujourdhui, m[3] ? +m[3] : null), texte: m[0] };
  } else if ((m = t.match(/\b(\d{1,2}) ?\/ ?(\d{1,2})(?: ?\/ ?(\d{2,4}))?\b/))) {
    r = { date: prochaine(+m[1], +m[2], aujourdhui, m[3] ? +m[3] : null), texte: m[0] };
  } else if ((m = t.match(/\b(\d{1,2}) du (\d{1,2})\b/))) {
    r = { date: prochaine(+m[1], +m[2], aujourdhui), texte: m[0] };
  } else if ((m = t.match(/\bapres demain\b/))) {
    r = { date: ajouterJours(aujourdhui, 2), texte: m[0] };
  } else if ((m = t.match(/\bdemain\b/))) {
    r = { date: ajouterJours(aujourdhui, 1), texte: m[0] };
  } else if ((m = t.match(/\baujourd ?'? ?hui\b|\bce jour\b/))) {
    r = { date: aujourdhui, texte: m[0] };
  } else if ((m = t.match(/\bdans (\d+|une?|quelques) (jours?|semaines?|mois)\b/))) {
    const n = /^\d+$/.test(m[1]) ? +m[1] : m[1] === "quelques" ? 3 : 1;
    let jours = m[2].startsWith("jour") ? n : m[2].startsWith("semaine") ? 7 * n : 0;
    if (m[2].startsWith("jour") && (n === 8 || n === 15)) jours = n - 1; // « dans huit jours » = une semaine
    let date = jours ? ajouterJours(aujourdhui, jours) : null;
    if (m[2] === "mois") { const d = parseIso(aujourdhui); d.setMonth(d.getMonth() + n); date = iso(d); }
    r = { date, texte: m[0], incertain: m[1] === "quelques" };
  } else if ((m = t.match(/\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche) (\d{1,2})\b(?! (?:jours?|semaines?|mois|h\b|heures?))/))) {
    // « le jeudi 10 » : le prochain 10 du mois qui tombe un jeudi (bug du 17/11/2026)
    const cible = JOURS[m[1]], jour = +m[2];
    let d = null, premier = null;
    for (let i = 0, y = +aujourdhui.slice(0, 4), mo = +aujourdhui.slice(5, 7); i < 13; i++, mo = mo === 12 ? 1 : mo + 1, y += mo === 1 ? 1 : 0) {
      const c = dateValide(y, mo, jour);
      if (!c || c < aujourdhui) continue;
      premier = premier || c;
      if (parseIso(c).getDay() === cible) { d = c; break; }
    }
    r = d ? { date: d, texte: m[0] } : { date: premier, texte: m[0], incertain: true, note: `Le ${jour} ne tombe pas un ${m[1]} prochainement` };
  } else if ((m = t.match(/\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)( prochain| de la semaine prochaine)?\b/))) {
    const cible = JOURS[m[1]];
    let d = ajouterJours(aujourdhui, 1);
    while (parseIso(d).getDay() !== cible) d = ajouterJours(d, 1);
    if (m[2]) {
      // « vendredi prochain » : le vendredi de la semaine suivante (ambigu → à vérifier)
      const lundiProchain = (() => { let x = ajouterJours(aujourdhui, 1); while (parseIso(x).getDay() !== 1) x = ajouterJours(x, 1); return x; })();
      while (d < lundiProchain) d = ajouterJours(d, 7);
    }
    r = { date: d, texte: m[0], incertain: !!m[2] };
  } else if ((m = t.match(/\bla semaine prochaine\b/))) {
    let d = ajouterJours(aujourdhui, 1);
    while (parseIso(d).getDay() !== 1) d = ajouterJours(d, 1);
    r = { date: d, texte: m[0], incertain: true, note: "« la semaine prochaine » : lundi pris par défaut" };
  } else if ((m = t.match(/\b(?:apres|au retour d|a la fin d)\w* (?:les |des |du )?(?:vacances|conges?) (?:de |d'|du )?(?:la )?([a-z ]+?)(?=$| pour| des| les| le| en)/)) ||
             (m = t.match(/\bapres (noel|carnaval|paques|la toussaint|toussaint)\b/))) {
    const date = apresVacances(m[1], periodesTexte, aujourdhui);
    r = date ? { date, texte: m[0] } : { date: null, texte: m[0], note: "Vacances introuvables dans les congés saisis (Réglages)" };
  } else if ((m = t.match(/\b(?:dernier jour |juste )?avant (?:les |le |la )?(?:vacances|conges?)? ?(?:de |d'|du )?(?:la )?(noel|hiver|carnaval|detente|paques|printemps|toussaint|automne|ete)\b/))) {
    const date = avantVacances(m[1], periodesTexte, aujourdhui);
    r = date ? { date, texte: m[0] } : { date: null, texte: m[0], note: "Vacances introuvables dans les congés saisis (Réglages)" };
  } else if ((m = t.match(/\ba la rentree\b/))) {
    const date = apresVacances("ete", periodesTexte, aujourdhui);
    r = date ? { date, texte: m[0], incertain: true } : { date: null, texte: m[0] };
  }
  if (!r) return { date: null, incertain: false };
  r.incertain = !!r.incertain;
  if (r.date && !estOuvrable(r.date, conges)) {
    r.incertain = true;
    r.note = r.note || "Ce jour tombe un week-end ou pendant un congé";
  }
  return r;
}
