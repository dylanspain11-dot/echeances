// Parseur local de phrases dictées (aucune IA) : intention, type, classe, cours, date, chapitre.
// Modulaire et testé (tests/parser.test.mjs) ; on l'enrichit au fil des phrases non reconnues.

import { normaliser, sansAccents, similarite } from "./texte.js";
import { extraireDate } from "./dates.js";

export const INTENTIONS = {
  creer: "Créer", cocher: "Cocher", decaler: "Décaler", supprimer: "Supprimer", consulter: "Consulter",
};

const RE_INTENTION = [
  ["supprimer", /\b(supprime|supprimer|efface|effacer|annule|annuler|retire|retirer|enleve|enlever)\b/],
  ["decaler", /\b(decale|decaler|recule|reculer|avance|avancer|reporte|reporter|deplace|deplacer|repousse|repousser)\b/],
  ["cocher", /\b(coche|cocher|j'ai (fini|termine|fait|imprime|corrige|encode|redige)|c'est fait|est fait|est fini|est termine|marque .* (fait|fini))\b/],
  ["consulter", /\b(qu'est ce que|quest ce que|qu est ce que|ou j'en suis|ou en suis je|qu'est ce qui|quoi faire|quelles? (sont|taches?|echeances?)|montre|affiche|liste)\b/],
];

const RE_TYPES = [
  ["controle", /\b(controles?|interros?|interrogations?|tests?|evals?|evaluations?|examens?|bilans?)\b/],
  ["bulletin", /\b(bulletins?)\b/],
  ["conseil", /\b(conseils? de classe|conseils?|deliberations?|delibes?)\b/],
  ["preparation", /\b(prepa|preparation|preparer|prepare|cours a preparer|sequence|lecon)\b/],
];

function regexAlias(alias) {
  const morceaux = sansAccents(alias.toLowerCase()).match(/\d+|[a-z]+/g) || [];
  if (!morceaux.length) return null;
  const sep = "\\s*(?:&|et)?\\s*";
  return new RegExp(`(?:^|[\\s'])(${morceaux.join(sep)})(?=$|[\\s'])`);
}

/** Classe : alias des réglages et noms de classes, le plus long d'abord. « les 4 » → ambigu. */
function extraireClasse(t, classes, alias) {
  const candidats = [
    ...classes.map((c) => ({ alias: c.nom, classeId: c.id })),
    ...alias.map((a) => ({ alias: a.alias, classeId: a.classeId })),
  ].sort((a, b) => b.alias.length - a.alias.length);
  for (const c of candidats) {
    const re = regexAlias(c.alias);
    const m = re && t.match(re);
    if (m && classes.some((x) => x.id === c.classeId)) return { classeId: c.classeId, texte: m[1] };
  }
  const m = t.match(/\b(?:les|des|aux|en|pour les) (\d)(?:e|eme)?s?\b(?! (janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|jours?|semaines?|mois))/);
  if (m) {
    const possibles = classes.filter((c) => sansAccents(c.nom.toLowerCase()).replace(/[^a-z0-9]/g, "").includes(m[1]));
    if (possibles.length === 1) return { classeId: possibles[0].id, texte: m[0], incertain: true };
    return { classeId: null, texte: m[0], incertain: true, possibles: possibles.map((c) => c.id),
      note: `« ${m[0].trim()} » : quelle classe ? (${possibles.map((c) => c.nom).join(", ") || "aucune"})` };
  }
  return { classeId: null };
}

function extraireCours(t, classe) {
  for (const cours of classe?.cours || []) {
    const n = sansAccents(cours.toLowerCase());
    const prefixe = n.slice(0, Math.min(3, n.length));
    if (new RegExp(`\\b${prefixe}`).test(t)) return cours;
  }
  return null;
}

/** Chapitre : « chapitre (le) budget », « le chapitre sur la TVA » ; rapproché des chapitres du hub si connus. */
function extraireChapitre(t, chapitresHub) {
  const m = t.match(/\bchapitre (?:sur |du |de la |de l'|des |de |le |la |les |l')?([a-z0-9' ]+?)(?=$| des | de la | du | pour | le \d| les \d| en \d| avant | pour le | a rendre)/);
  if (!m) return { chapitre: null };
  const texte = m[1].trim();
  if (!chapitresHub?.length) return { chapitre: texte };
  let mieux = null, score = 0;
  for (const c of chapitresHub) {
    const s = Math.max(similarite(texte, c.nom), sansAccents(c.nom.toLowerCase()).includes(texte) ? 0.9 : 0);
    if (s > score) { score = s; mieux = c; }
  }
  return score >= 0.5 ? { chapitre: mieux.nom, chapitreId: mieux.id, incertain: score < 0.75 } : { chapitre: texte, incertain: true };
}

/** Décalage relatif : « recule d'une semaine », « repousse de 3 jours », « avance de 2 jours ». */
function extraireDecalage(t) {
  const m = t.match(/\b(recul|repouss|report|decal|deplac|retard|avanc)\w*\b.*?\b(?:d'|de |d )?(\d+|un|une) (jours?|semaines?)\b/);
  if (!m) return null;
  const n = /^\d+$/.test(m[2]) ? +m[2] : 1;
  const jours = (m[3].startsWith("semaine") ? 7 : 1) * n;
  return m[1] === "avanc" ? -jours : jours;
}

/** Période à consulter : aujourd'hui, demain, cette semaine, semaine prochaine. */
function extrairePeriode(t) {
  if (/\bsemaine prochaine\b/.test(t)) return "semaine-prochaine";
  if (/\b(cette semaine|la semaine|de la semaine)\b/.test(t)) return "semaine";
  if (/\bdemain\b/.test(t)) return "demain";
  if (/\b(aujourd ?'? ?hui|ce jour|maintenant)\b/.test(t)) return "aujourdhui";
  return null;
}

/**
 * Analyse une phrase.
 * @param {string} phrase
 * @param {object} ctx { aujourdhui, classes, alias, periodesConges, chapitres? (du hub, par classe) }
 */
export function analyser(phrase, ctx) {
  const t = normaliser(phrase);
  const intention = (RE_INTENTION.find(([, re]) => re.test(t)) || ["creer"])[0];
  const typeTrouve = RE_TYPES.find(([, re]) => re.test(t));
  const type = typeTrouve ? typeTrouve[0] : "autre";
  const cl = extraireClasse(t, ctx.classes || [], ctx.alias || []);
  const classe = (ctx.classes || []).find((c) => c.id === cl.classeId);
  const decalage = intention === "decaler" ? extraireDecalage(t) : null;
  const date = decalage ? { date: null, incertain: false } : extraireDate(t, ctx.aujourdhui, ctx.periodesConges || "");
  const chap = extraireChapitre(t, cl.classeId ? (ctx.chapitres || {})[cl.classeId] : null);

  const incertains = [], manquants = [], notes = [];
  if (!typeTrouve) incertains.push("type");
  if (!cl.classeId) manquants.push("classe");
  if (cl.incertain) incertains.push("classe"); // ex. « les 4 » : 3&4PV ou 4AS → à préciser
  if (cl.note) notes.push(cl.note);
  if (!date.date && !decalage) manquants.push("date");
  else if (date.incertain) incertains.push("date");
  if (date.note) notes.push(date.note);
  if (chap.incertain) incertains.push("chapitre");

  const reconnu = intention === "creer" ? manquants.length === 0 && incertains.length === 0 : true;
  return {
    phrase, normalise: t, intention, type, classeId: cl.classeId, cours: extraireCours(t, classe),
    date: date.date, chapitre: chap.chapitre, chapitreId: chap.chapitreId || null,
    incertains, manquants, notes, reconnu, decalage, periode: intention === "consulter" ? extrairePeriode(t) : null,
  };
}
