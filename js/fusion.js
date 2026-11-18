// Fusion de deux copies des données (Mac ↔ Samsung) : élément par élément, la modification la plus récente gagne.
// Une suppression est gardée comme « pierre tombale » (supprime: true) pour se propager à l'autre appareil.

const COLLECTIONS = ["echeances", "sousTaches", "modeles", "alias", "phrases"];

export function fusionner(local, distant) {
  const out = { version: 1, majLe: "" };
  for (const c of COLLECTIONS) {
    const parId = new Map();
    for (const x of local?.[c] || []) parId.set(x.id, x);
    for (const x of distant?.[c] || []) {
      const l = parId.get(x.id);
      if (!l || (x.majLe || "") > (l.majLe || "")) parId.set(x.id, x);
      // même version : garder celle qui connaît déjà son événement d'agenda (sinon il serait recréé en double)
      else if ((x.majLe || "") === (l.majLe || "") && x.gcalEventId && !l.gcalEventId) parId.set(x.id, x);
    }
    out[c] = [...parId.values()];
  }
  // Réglages partagés : le bloc le plus récent gagne (les réglages propres à l'appareil restent locaux).
  const rl = local?.reglages || {}, rd = distant?.reglages || {};
  out.reglages = (rd.majLe || "") > (rl.majLe || "") ? rd : rl;
  out.hub = (distant?.hub?.majLe || "") > (local?.hub?.majLe || "") ? distant.hub : local?.hub || null;
  out.majLe = [local?.majLe || "", distant?.majLe || ""].sort().pop();
  return out;
}

/** Retire les pierres tombales de plus de 60 jours (déjà propagées). */
export function nettoyer(donnees, maintenant = new Date()) {
  const limite = new Date(maintenant.getTime() - 60 * 86400000).toISOString();
  for (const c of COLLECTIONS) donnees[c] = (donnees[c] || []).filter((x) => !x.supprime || (x.majLe || "") > limite);
  return donnees;
}
