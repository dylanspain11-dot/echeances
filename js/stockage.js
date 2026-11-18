// Stockage local (IndexedDB, repli localStorage) : les données partagées et les réglages propres à l'appareil.

import { CLASSES_DEFAUT, ALIAS_DEFAUT } from "./modeles.js";

const BASE = "echeances", TABLE = "kv";

function ouvrir() {
  return new Promise((ok, ko) => {
    if (!("indexedDB" in self)) return ko(new Error("IndexedDB indisponible"));
    const r = indexedDB.open(BASE, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(TABLE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}

async function lire(cle) {
  try {
    const db = await ouvrir();
    return await new Promise((ok, ko) => {
      const r = db.transaction(TABLE).objectStore(TABLE).get(cle);
      r.onsuccess = () => ok(r.result ?? null);
      r.onerror = () => ko(r.error);
    });
  } catch {
    try { return JSON.parse(localStorage.getItem(`${BASE}:${cle}`)); } catch { return null; }
  }
}

async function ecrire(cle, valeur) {
  try {
    const db = await ouvrir();
    await new Promise((ok, ko) => {
      const t = db.transaction(TABLE, "readwrite");
      t.objectStore(TABLE).put(valeur, cle);
      t.oncomplete = ok;
      t.onerror = () => ko(t.error);
    });
  } catch {
    try { localStorage.setItem(`${BASE}:${cle}`, JSON.stringify(valeur)); } catch { /* stockage plein ou bloqué */ }
  }
}

export function maintenant() {
  return new Date().toISOString();
}

/** Date des valeurs par défaut : la plus ancienne possible, pour que toute vraie modification
 *  (sur n'importe quel appareil) l'emporte à la fusion. Bug du 17/11/2026 : un appareil neuf écrasait les réglages. */
export const DATE_DEFAUT = "1970-01-01T00:00:00.000Z";

export function donneesVides() {
  const t = DATE_DEFAUT;
  return {
    version: 1,
    majLe: t,
    echeances: [],
    sousTaches: [],
    modeles: [],
    alias: ALIAS_DEFAUT.map((a) => ({ ...a, majLe: t })),
    phrases: [],
    reglages: { classes: CLASSES_DEFAUT, agendaConges: "", majLe: t },
    hub: null,
  };
}

export async function chargerDonnees() {
  return migrer((await lire("donnees")) || donneesVides());
}

/** Sous-tâches retirées le 18/11/2026 : chaque sous-tâche encore vivante devient une « pierre tombale »
 *  (supprime: true) pour que son événement d'agenda soit effacé et que la suppression gagne sur l'autre appareil.
 *  Les modèles restent dans les données (inutilisés) : on ne supprime rien d'autre. */
export function migrer(d, quand = new Date().toISOString()) {
  d.modeles = d.modeles || [];
  d.sousTaches = d.sousTaches || [];
  for (const t of d.sousTaches) if (!t.supprime) Object.assign(t, { supprime: true, majLe: quand });
  return d;
}

export async function enregistrerDonnees(d) {
  await ecrire("donnees", d);
}

/** Réglages propres à cet appareil (non synchronisés) : ID client Google, cache des congés, dernière sync. */
export async function chargerLocal() {
  return (await lire("local")) || { clientId: "", conges: { dates: [], majLe: null, agenda: "" }, derniereSync: null };
}

export async function enregistrerLocal(l) {
  await ecrire("local", l);
}
