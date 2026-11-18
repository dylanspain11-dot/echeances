// Commandes vocales : marquer faite, décaler, supprimer, consulter (sans sous-tâches depuis le 18/11/2026).
// Fonctions pures (testées dans tests/commandes.test.mjs) : elles PRÉPARENT une action, que l'utilisateur valide.

import { ajouterJours, ecartJours, parseIso } from "./dates.js";

const vivantes = (l) => (l || []).filter((x) => !x.supprime);

/** Échéances candidates, de la plus probable à la moins probable (les faites et passées sont exclues). */
export function classerEcheances(r, echeances, aujourdhui, derniereId = null) {
  const actives = vivantes(echeances).filter((e) => !(e.faite && e.date < aujourdhui));
  const scores = actives.map((e) => {
    let s = 0;
    if (r.type && r.type !== "autre") s += e.type === r.type ? 4 : -3;
    if (r.classeId) s += e.classeId === r.classeId ? 4 : -6;
    if (r.cours) s += e.cours === r.cours ? 2 : -1;
    if (r.date && r.intention !== "decaler" && e.date === r.date) s += 3;
    if (r.intention === "cocher" && e.faite) s -= 2;  // « c'est fait » vise d'abord une échéance pas encore faite
    if (e.id === derniereId) s += 1.5;               // « recule d'une semaine » sans préciser : la dernière échéance vue
    s -= Math.max(0, ecartJours(aujourdhui, e.date)) / 1000; // à égalité, la plus proche
    return { echeance: e, score: s };
  });
  return scores.sort((a, b) => b.score - a.score);
}

/** Nouvelle date d'une échéance à décaler : date dite (« au 12 décembre ») ou décalage (« d'une semaine »). */
export function nouvelleDate(r, echeance) {
  if (r.decalage) return { date: ajouterJours(echeance.date, r.decalage), incertain: false };
  if (r.date) return { date: r.date, incertain: r.incertains.includes("date") };
  return { date: null, incertain: true };
}

function lundiDe(s) {
  let d = s;
  while (parseIso(d).getDay() !== 1) d = ajouterJours(d, -1);
  return d;
}

/** Ce qu'il y a (consulter) : échéances non faites de la période, plus celles dépassées. */
export function consulter(r, echeances, aujourdhui) {
  const filtre = (e) => (!r.type || r.type === "autre" || e.type === r.type) && (!r.classeId || e.classeId === r.classeId);
  let debut = aujourdhui, fin = aujourdhui, titre = "Aujourd'hui";
  if (r.periode === "demain") { debut = fin = ajouterJours(aujourdhui, 1); titre = "Demain"; }
  else if (r.periode === "semaine") { fin = ajouterJours(lundiDe(aujourdhui), 6); titre = "Cette semaine"; }
  else if (r.periode === "semaine-prochaine") { debut = ajouterJours(lundiDe(aujourdhui), 7); fin = ajouterJours(debut, 6); titre = "La semaine prochaine"; }
  else if ((r.type && r.type !== "autre") || r.classeId) { fin = "9999-12-31"; titre = "À venir"; } // « où j'en suis pour les bulletins »
  const liste = vivantes(echeances).filter((e) => filtre(e) && !e.faite && e.date <= fin && (e.date >= debut || e.date < aujourdhui))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({ ...e, depassee: e.date < aujourdhui }));
  return { titre, debut, fin, echeances: liste };
}

/**
 * Prépare la commande à montrer pour validation.
 * @returns {{ intention, candidats, echeance, date?, incertains: string[], probleme? }}
 */
export function preparerCommande(r, donnees, aujourdhui, derniereId = null) {
  const out = { intention: r.intention, incertains: [], candidats: [] };
  if (r.intention === "consulter") return { ...out, resultat: consulter(r, donnees.echeances, aujourdhui) };
  const candidats = classerEcheances(r, donnees.echeances, aujourdhui, derniereId);
  out.candidats = candidats.map((c) => c.echeance);
  if (!candidats.length || candidats[0].score < -2) return { ...out, probleme: "Aucune échéance ne correspond." };
  out.echeance = candidats[0].echeance;
  if (candidats.length > 1 && Math.abs(candidats[0].score - candidats[1].score) < 1) out.incertains.push("echeance");
  if (r.intention === "cocher" && out.echeance.faite) out.probleme = "Cette échéance est déjà marquée faite.";
  if (r.intention === "decaler") {
    const nd = nouvelleDate(r, out.echeance);
    out.date = nd.date;
    if (nd.incertain) out.incertains.push("date");
    if (!nd.date) out.probleme = "Je n'ai pas compris la nouvelle date.";
  }
  return out;
}
