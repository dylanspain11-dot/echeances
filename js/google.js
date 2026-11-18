// Connexion Google côté navigateur (Google Identity Services, gratuit) :
// Drive (dossier caché de l'appli) pour la synchronisation, Agenda en lecture pour les congés.

import { ajouterJours, aujourdhui } from "./dates.js";

const SCOPES = [
  "https://www.googleapis.com/auth/drive.appdata",
  "https://www.googleapis.com/auth/calendar.readonly",      // lire tes agendas (charge, congés)
  "https://www.googleapis.com/auth/calendar.app.created",   // gérer UNIQUEMENT l'agenda créé par l'appli
].join(" ");
const FICHIER = "echeances.json";

let client = null, jeton = null, expire = 0, attente = null, portee = "";

function chargerGis() {
  if (self.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((ok, ko) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.onload = ok;
    s.onerror = () => ko(new Error("Impossible de joindre Google (hors ligne ?)"));
    document.head.appendChild(s);
  });
}

/** Jeton gardé sur l'appareil (valable une heure) : évite une fenêtre Google à chaque ouverture. */
export function restaurer(j, exp, p = "") {
  if (j && exp > Date.now()) { jeton = j; expire = exp; portee = p || ""; }
}

export function jetonActuel() {
  return estConnecte() ? { jeton, expire, portee } : null;
}

/** Ce jeton couvre-t-il tous les accès demandés ? (un jeton d'avant la Phase 5 n'a pas l'accès Agenda) */
export function jetonComplet() {
  return SCOPES.split(" ").every((s) => portee.includes(s));
}

/** Oublie le jeton sur cet appareil (sans révoquer l'autorisation chez Google). */
export function oublier() {
  jeton = null; expire = 0; portee = "";
}

export function estConnecte() {
  return !!jeton && Date.now() < expire;
}

// ---------------------------------------------------------------- Pont avec Classroom Hub (onglet natif sur Mac)
// Google refuse sa connexion « web » dans une fenêtre intégrée : le Hub se connecte lui-même (une seule fois,
// jeton de renouvellement dans le trousseau) et fournit les jetons d'accès via window.webkit.messageHandlers.hubGoogle.

const pont = () => self.webkit?.messageHandlers?.hubGoogle || null;
export const natif = () => !!pont();
let attenteNative = null;
self.__hubJeton = (r) => {
  const a = attenteNative; attenteNative = null;
  if (!a) return;
  if (!r || r.erreur) return a.ko(new Error(r?.erreur || "Connexion Google annulée"));
  jeton = r.jeton; expire = Date.now() + (r.expireDans - 60) * 1000; portee = r.portee || SCOPES;
  a.ok(jeton);
};
function connecterNatif(interactif) {
  if (attenteNative) return attenteNative.promesse;
  let ok, ko;
  const promesse = new Promise((a, b) => { ok = a; ko = b; });
  attenteNative = { ok, ko, promesse };
  pont().postMessage({ action: "jeton", interactif, scopes: SCOPES });
  return promesse;
}

/** Demande un jeton d'accès. `interactif` : affiche la fenêtre Google (premier clic sur « Se connecter »). */
export async function connecter(clientId, interactif = false) {
  if (!clientId) throw new Error("ID client Google manquant (Réglages).");
  if (estConnecte()) return jeton;
  if (natif()) return connecterNatif(interactif);
  await chargerGis();
  if (!client) {
    client = google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: SCOPES, callback: () => {} });
  }
  if (attente) return attente;
  attente = new Promise((ok, ko) => {
    client.callback = (r) => {
      attente = null;
      if (r.error) return ko(new Error(r.error_description || r.error));
      jeton = r.access_token;
      expire = Date.now() + (r.expires_in - 60) * 1000;
      portee = r.scope || "";
      ok(jeton);
    };
    client.error_callback = (e) => { attente = null; ko(new Error(e.message || "Connexion Google annulée")); };
    client.requestAccessToken({ prompt: interactif ? "select_account" : "" }); // toujours choisir le compte (plusieurs comptes Google dans le navigateur)
  });
  return attente;
}

export function deconnecter() {
  if (natif()) pont().postMessage({ action: "deconnecter" });
  else if (jeton && self.google?.accounts?.oauth2) google.accounts.oauth2.revoke(jeton);
  jeton = null;
  expire = 0;
}

async function api(url, options = {}) {
  const r = await fetch(url, { ...options, headers: { Authorization: `Bearer ${jeton}`, ...(options.headers || {}) } });
  if (r.status === 401) { jeton = null; throw new Error("Session Google expirée : reconnectez-vous."); }
  if (r.status === 403) {
    const detail = await r.text();
    if (/insufficient|scope/i.test(detail)) { jeton = null; throw new Error("Autorisation Agenda manquante : reconnectez-vous à Google pour l'accorder."); }
    throw new Error("Google a refusé l'accès (403).");
  }
  if (r.status === 404 || r.status === 410) { const e = new Error("introuvable"); e.introuvable = true; throw e; }
  if (!r.ok) throw new Error(`Google a répondu ${r.status}`);
  return r;
}

// ---------------------------------------------------------------- Drive (synchronisation)

async function trouverFichier() {
  const q = encodeURIComponent(`name='${FICHIER}'`);
  const r = await api(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)`);
  return (await r.json()).files?.[0] || null;
}

export async function lireDrive() {
  const f = await trouverFichier();
  if (!f) return { id: null, donnees: null };
  const r = await api(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`);
  return { id: f.id, donnees: await r.json() };
}

export async function ecrireDrive(donnees, id) {
  const corps = JSON.stringify(donnees);
  if (id) {
    await api(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: corps,
    });
    return id;
  }
  const limite = "echeances" + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name: FICHIER, parents: ["appDataFolder"], mimeType: "application/json" });
  const body = `--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${limite}\r\nContent-Type: application/json\r\n\r\n${corps}\r\n--${limite}--`;
  const r = await api("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST", headers: { "Content-Type": `multipart/related; boundary=${limite}` }, body,
  });
  return (await r.json()).id;
}

// ---------------------------------------------------------------- Agenda (congés)

export async function listerAgendas() {
  const r = await api("https://www.googleapis.com/calendar/v3/users/me/calendarList?fields=items(id,summary)");
  return (await r.json()).items || [];
}

/** Jours couverts par les événements « toute la journée » de l'agenda des congés (de -2 mois à +15 mois). */
export async function joursDeConges(nomAgenda) {
  const agendas = await listerAgendas();
  const cible = agendas.find((a) => a.summary.trim().toLowerCase() === nomAgenda.trim().toLowerCase());
  if (!cible) throw new Error(`Agenda « ${nomAgenda} » introuvable. Agendas disponibles : ${agendas.map((a) => a.summary).join(", ")}`);
  const debut = ajouterJours(aujourdhui(), -60), fin = ajouterJours(aujourdhui(), 460);
  const params = new URLSearchParams({ timeMin: `${debut}T00:00:00Z`, timeMax: `${fin}T00:00:00Z`, singleEvents: "true",
    maxResults: "2500", fields: "items(summary,start,end)" });
  const r = await api(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cible.id)}/events?${params}`);
  const jours = new Set();
  for (const ev of (await r.json()).items || []) {
    if (!ev.start?.date) continue; // seulement les événements sur la journée entière
    for (let d = ev.start.date; d < ev.end.date; d = ajouterJours(d, 1)) jours.add(d);
  }
  return [...jours].sort();
}


// ---------------------------------------------------------------- Agenda : lecture des événements et agenda « Échéances »

const CAL = "https://www.googleapis.com/calendar/v3";

/** Agendas à lire : principal + agendas cochés, sans l'agenda de l'appli ni les agendas de jours fériés. */
export async function agendasALire(idAgendaAppli) {
  const r = await api(`${CAL}/users/me/calendarList?fields=items(id,summary,primary,selected)`);
  return ((await r.json()).items || []).filter((a) => (a.primary || a.selected) && a.id !== idAgendaAppli && !a.id.includes("#holiday"));
}

export async function lireEvenements(idAgenda, debut, fin) {
  const items = [];
  let page = "";
  do {
    const p = new URLSearchParams({ timeMin: `${debut}T00:00:00Z`, timeMax: `${fin}T23:59:59Z`, singleEvents: "true", maxResults: "2500",
      fields: "nextPageToken,items(status,summary,start,end)" });
    if (page) p.set("pageToken", page);
    const r = await api(`${CAL}/calendars/${encodeURIComponent(idAgenda)}/events?${p}`);
    const j = await r.json();
    items.push(...(j.items || []));
    page = j.nextPageToken || "";
  } while (page);
  return items;
}

/** Retrouve l'agenda « Échéances » (par son id mémorisé ou son nom) ou le crée. */
export async function agendaAppli(nom, idConnu) {
  if (idConnu) {
    try { await api(`${CAL}/calendars/${encodeURIComponent(idConnu)}?fields=id`); return idConnu; }
    catch (e) { if (!e.introuvable) throw e; }
  }
  const liste = await api(`${CAL}/users/me/calendarList?fields=items(id,summary,accessRole)`);
  const trouve = ((await liste.json()).items || []).find((a) => a.summary === nom && a.accessRole === "owner");
  if (trouve) return trouve.id;
  const r = await api(`${CAL}/calendars`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ summary: nom, description: "Échéances de cours et rappels (appli Échéances)", timeZone: "Europe/Brussels" }) });
  return (await r.json()).id;
}

export async function ecrireEvenement(idAgenda, idEvenement, corps) {
  const base = `${CAL}/calendars/${encodeURIComponent(idAgenda)}/events`;
  if (idEvenement) {
    try {
      const r = await api(`${base}/${encodeURIComponent(idEvenement)}?fields=id`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
      return (await r.json()).id;
    } catch (e) { if (!e.introuvable) throw e; } // supprimé à la main dans l'agenda : on le recrée
  }
  const r = await api(`${base}?fields=id`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
  return (await r.json()).id;
}

export async function supprimerEvenement(idAgenda, idEvenement) {
  try { await api(`${CAL}/calendars/${encodeURIComponent(idAgenda)}/events/${encodeURIComponent(idEvenement)}`, { method: "DELETE" }); }
  catch (e) { if (!e.introuvable) throw e; } // déjà supprimé : rien à faire
}
