// Lien avec Classroom Hub (Phase 6) : classes et chapitres transmis par le hub dans l'adresse (#/hub?d=…).
import { sansAccents } from "./parser/texte.js";

const cle = (s) => sansAccents(String(s).toLowerCase()).replace(/[^a-z0-9]/g, "");

/** Décode le paquet base64url envoyé par le hub. */
export function decoderPaquet(d) {
  const b64 = d.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((d.length + 3) % 4);
  const bin = atob(b64);
  const octets = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(octets));
}

/** Associe les classes du hub (« 3 & 4PV ») à celles de l'appli (« 3&4PV ») ; garde les chapitres. */
export function importerHub(paquet, classesAppli, maintenant) {
  const classes = (paquet.classes || []).map((c) => {
    const appli = classesAppli.find((a) => cle(a.nom) === cle(c.nom) || cle(a.id) === cle(c.nom));
    return { id: appli ? appli.id : null, hubNom: c.nom, chapitres: (c.chapitres || []).map((x) => ({ id: x.id, nom: x.nom, theme: x.theme || "" })) };
  });
  return { majLe: maintenant, classes };
}

export function chapitreParId(hub, id) {
  for (const c of hub?.classes || []) {
    const ch = c.chapitres.find((x) => x.id === id);
    if (ch) return { ...ch, classeId: c.id, hubNom: c.hubNom };
  }
  return null;
}

export const surMac = () => /Macintosh|Mac OS X/.test(navigator.userAgent) && !/Android|iPhone|iPad/.test(navigator.userAgent);
export const lienHub = (chapitreId) => `classroomhub://chapitre/${chapitreId}`;
