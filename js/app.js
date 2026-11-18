// Module « Échéances » : état, actions, synchronisation et écrans.

import { aujourdhui, dateCourte, ecartJours, periodesVersJours, libellesConges, lundiDe, ajouterJours, parseIso } from "./dates.js";
import { semaine } from "./timeline.js";
import { decoderPaquet, importerHub, chapitreParId, surMac, lienHub } from "./hub.js";
import { NOM_AGENDA, convertirEvenements, corpsEvenement, actionAgenda, plageLecture, signature } from "./agenda.js";
import { etatEcheance, libelleRestant } from "./jauge.js";
import { fusionner, nettoyer } from "./fusion.js";
import { TYPES } from "./modeles.js";
import { analyser, INTENTIONS } from "./parser/index.js";
import { preparerCommande, consulter } from "./commandes.js";
import * as G from "./google.js";
import { GOOGLE_CLIENT_ID } from "./config.js";
import { chargerDonnees, enregistrerDonnees, chargerLocal, enregistrerLocal, maintenant, migrer } from "./stockage.js";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

let D = null;      // données partagées (synchronisées)
let L = null;      // réglages de l'appareil
let syncEtat = { texte: "Non connecté à Google", classe: "off" };

// ================================================================ état et actions

const vivantes = (liste) => liste.filter((x) => !x.supprime);
const congesSaisis = () => periodesVersJours(D.reglages.periodesConges || "").jours;
const classe = (id) => D.reglages.classes.find((c) => c.id === id);

async function sauver({ sync = true } = {}) {
  D.majLe = maintenant();
  await enregistrerDonnees(D);
  if (sync) planifierSync();
}

/** Compare ce que le parseur avait compris à ce qui a été validé : une correction = phrase non reconnue. */
async function corrigerJournal(dicte, e) {
  const p = D.phrases.find((x) => x.id === dicte.idLog);
  if (!p) return;
  const diff = [];
  if (dicte.type !== e.type) diff.push(`type ${e.type}`);
  if (dicte.classeId !== e.classeId) diff.push(`classe ${e.classeId}`);
  if ((dicte.cours || null) !== (e.cours || null)) diff.push(`cours ${e.cours || "—"}`);
  if (dicte.date !== e.date) diff.push(`date ${e.date}`);
  if ((dicte.chapitre || null) !== (e.chapitre || null)) diff.push(`chapitre ${e.chapitre || "—"}`);
  if (diff.length) Object.assign(p, { reconnu: false, corrigeeEn: diff.join(", "), majLe: maintenant() });
  else if (!dicte.incertains.length && !dicte.manquants.length) Object.assign(p, { reconnu: true, majLe: maintenant() });
  else Object.assign(p, { reconnu: true, majLe: maintenant() }); // incertitudes confirmées telles quelles
  await sauver();
}

async function creerEcheance(e) {
  const t = maintenant();
  const ech = { ...e, id: e.id || uid(), statut: "active", faite: false, creeLe: t, majLe: t };
  D.echeances.push(ech);
  await sauver();
  return ech;
}

async function marquerFaite(echeanceId, faite) {
  const e = D.echeances.find((x) => x.id === echeanceId);
  Object.assign(e, { faite, faiteLe: faite ? maintenant() : null, majLe: maintenant() });
  await sauver();
}

async function decaler(echeanceId, nouvelleDate) {
  const e = D.echeances.find((x) => x.id === echeanceId);
  Object.assign(e, { date: nouvelleDate, majLe: maintenant() });
  await sauver();
}

async function supprimer(echeanceId) {
  const e = D.echeances.find((x) => x.id === echeanceId);
  Object.assign(e, { supprime: true, majLe: maintenant() });
  await sauver();
}

// ================================================================ synchronisation Google Drive

let minuteur = null, fichierId = null, enCours = false;

function etat(texte, classe) {
  syncEtat = { texte, classe };
  const el = $("#sync");
  if (el) { el.textContent = texte; el.className = `chip ${classe}`; }
}

function planifierSync() {
  clearTimeout(minuteur);
  minuteur = setTimeout(() => synchroniser(), 1500);
}

async function synchroniser({ interactif = false } = {}) {
  if (!L.clientId && !G.natif()) return etat("Non connecté à Google", "off");
  if (!navigator.onLine) return etat("Hors ligne : modifications gardées sur l'appareil", "warn");
  if (enCours) return planifierSync();
  enCours = true;
  try {
    if (G.estConnecte() && !G.jetonComplet()) { // jeton d'avant la Phase 5 : il manque l'accès Agenda
      G.oublier();
      if (!interactif) return etat("Touchez pour autoriser l'agenda", "warn");
    }
    if (!G.estConnecte()) {
      // Dans le Hub, la connexion native se renouvelle seule. Sur le web, Google exige un geste :
      // le premier toucher dans l'appli renouvelle l'accès sans redemander le compte (armerRenouvellement).
      const silencieux = L.dejaConnecte && G.natif();
      if (!interactif && !silencieux) {
        if (L.dejaConnecte) armerRenouvellement();
        return etat(L.dejaConnecte ? "Reconnexion au prochain toucher…" : "Non connecté à Google", "off");
      }
      etat("Connexion…", "warn");
      await G.connecter(L.clientId, interactif && !L.dejaConnecte);
      L.dejaConnecte = true;
      Object.assign(L, G.jetonActuel());
    }
    etat("Synchronisation…", "warn");
    const distant = await G.lireDrive();
    fichierId = distant.id;
    const avant = JSON.stringify(D);
    D = migrer(nettoyer(fusionner(D, distant.donnees)));
    await synchroniserAgenda();
    fichierId = await G.ecrireDrive(D, fichierId);
    await enregistrerDonnees(D);
    L.derniereSync = maintenant();
    await enregistrerLocal(L);
    etat(`Synchronisé ${new Date().toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit" })}`, "ok");
    if (JSON.stringify(D) !== avant) rendre(); // des changements venus de l'autre appareil
  } catch (e) {
    etat(`Sync impossible : ${e.message}`, "ko");
  } finally {
    enCours = false;
  }
}

/** Web : au premier toucher (geste exigé par Google), renouvelle discrètement l'accès puis synchronise. */
let renouvellementArme = false;
function armerRenouvellement() {
  if (renouvellementArme || G.natif()) return;
  renouvellementArme = true;
  document.addEventListener("pointerdown", () => { renouvellementArme = false; synchroniser({ interactif: true }); }, { once: true, capture: true });
}

/** Google Agenda : lit tes événements (charge, timeline) et écrit les échéances dans l'agenda « Échéances ». */
let agendaErreur = null;
async function synchroniserAgenda({ forcerLecture = false } = {}) {
  const r = D.reglages;
  agendaErreur = null;
  try {
    if (r.agendaLecture !== false) {
      const vieux = !L.agenda?.majLe || Date.now() - new Date(L.agenda.majLe) > 15 * 60000;
      if (vieux || forcerLecture) {
        const { debut, fin } = plageLecture(aujourdhui());
        const items = [];
        for (const a of await G.agendasALire(r.agendaId)) items.push(...await G.lireEvenements(a.id, debut, fin));
        L.agenda = { evenements: convertirEvenements(items), majLe: maintenant() };
        await enregistrerLocal(L);
      }
    }
    const ecrire = !!r.agendaEcriture;
    const aTraiter = [...D.echeances, ...(D.sousTaches || [])].filter((o) => o.gcalEventId || (ecrire && !o.supprime));
    if (!aTraiter.length) return;
    let id = r.agendaId;
    if (ecrire || aTraiter.some((o) => o.gcalEventId)) {
      const trouve = await G.agendaAppli(NOM_AGENDA, r.agendaId);
      if (trouve !== r.agendaId) { r.agendaId = trouve; r.majLe = maintenant(); }
      id = trouve;
    }
    const lien = location.origin + location.pathname;
    for (const e of D.echeances) await appliquer(e, ecrire, id, corpsEvenement(e, { lien }));
    // Sous-tâches retirées le 18/11/2026 : on efface seulement leurs anciens événements.
    for (const t of D.sousTaches || []) await appliquer(t, false, id, null);
  } catch (err) {
    agendaErreur = err.message;
  }
}

async function appliquer(objet, actif, idAgenda, corps) {
  const action = actionAgenda(objet, actif);
  if (!action) return;
  if (action === "supprimer") {
    await G.supprimerEvenement(idAgenda, objet.gcalEventId);
    objet.gcalEventId = null;
    objet.gcalMajLe = null;
  } else {
    objet.gcalEventId = await G.ecrireEvenement(idAgenda, objet.gcalEventId, corps);
    objet.gcalMajLe = signature(objet); // sans toucher à majLe : pas de boucle de synchro
  }
}

async function actualiserConges({ interactif = false } = {}) {
  const nom = D.reglages.agendaConges;
  if (!nom) throw new Error("Indiquez d'abord le nom de l'agenda des congés.");
  await G.connecter(L.clientId, interactif);
  L.conges = { dates: await G.joursDeConges(nom), majLe: maintenant(), agenda: nom };
  await enregistrerLocal(L);
}

// ================================================================ écrans

function rendre() {
  const h = location.hash || "#/";
  const m = h.match(/^#\/e\/(.+)$/);
  if (!h.startsWith("#/nouvelle")) PREREMPLI = null;
  if (!h.startsWith("#/commande")) COMMANDE = null;
  if (h.startsWith("#/nouvelle")) return ecranNouvelle();
  if (h.startsWith("#/reglages")) return ecranReglages();
  if (h.startsWith("#/phrases")) return ecranPhrases();
  if (h.startsWith("#/commande")) return ecranCommande();
  if (h.startsWith("#/hub")) return recevoirHub(h);
  const mc = h.match(/^#\/chapitre\/([^/?]+)/);
  if (mc) return ecranChapitre(decodeURIComponent(mc[1]));
  if (m) return ecranEcheance(decodeURIComponent(m[1]));
  return ecranAccueil();
}

function bandeauConges() {
  if (L.conges.dates?.length || congesSaisis().size) return "";
  return `<div class="alerte">Congés scolaires non chargés : le planning n'exclut que les week-ends.
    <a href="#/reglages">Charger l'agenda des congés</a></div>`;
}

function carteEcheance(e, lien = true) {
  const j = etatEcheance(e, aujourdhui());
  const c = classe(e.classeId);
  const balise = lien ? "a" : "div";
  return `<div class="carte jauge ${j.couleur}">
    <label class="coche-ech" title="Marquer faite"><input type="checkbox" data-fait="${esc(e.id)}" ${e.faite ? "checked" : ""} aria-label="Marquer « ${esc(e.titre)} » comme faite"></label>
    <${balise} class="corps" ${lien ? `href="#/e/${encodeURIComponent(e.id)}"` : ""}>
      <div class="ligne"><strong>${esc(e.titre)}</strong><span class="j">${e.faite ? "Fait ✓" : libelleRestant(j.joursRestants)}</span></div>
      <div class="meta">${esc(c?.nom || e.classeId || "")}${e.cours ? " · " + esc(e.cours) : ""} · ${dateCourte(e.date)}${e.chapitre ? " · " + esc(e.chapitre) : ""}</div>
    </${balise}>
  </div>`;
}

function brancherFaites(racine, rerendre) {
  racine?.querySelectorAll("[data-fait]").forEach((cb) => cb.addEventListener("change", async () => {
    await marquerFaite(cb.dataset.fait, cb.checked);
    rerendre();
  }));
}

function ecranAccueil() {
  const actives = vivantes(D.echeances).filter((e) => !(e.faite && e.date < aujourdhui()))
    .sort((a, b) => a.date.localeCompare(b.date));
  const avert = (() => { try { const a = sessionStorage.getItem("hub-avert"); sessionStorage.removeItem("hub-avert"); return a; } catch { return null; } })();
  $("#app").innerHTML = `
    ${bandeauConges()}${avert ? `<div class="alerte">${esc(avert)}</div>` : ""}
    <section class="voix">
      <button class="micro" id="micro" aria-label="Dicter une échéance"><span class="micro-icone">🎙️</span><span id="micro-txt">Toucher pour dicter</span></button>
      <form id="f-phrase" class="phrase">
        <input id="phrase" autocomplete="off" placeholder="ou écrivez / dictez au clavier : « contrôle 3TQ le 5 décembre »" aria-label="Phrase">
        <button class="primaire" type="submit">OK</button>
      </form>
      <div id="voix-msg"></div>
      <a class="lien-manuel" href="#/nouvelle">✎ Saisie manuelle (formulaire)</a>
    </section>
    <h2>Mes échéances</h2>
    ${actives.length ? `<div class="liste" id="liste">${actives.map((e) => carteEcheance(e)).join("")}</div>`
      : `<p class="vide">Aucune échéance. Dictez-en une : « contrôle des 3TQ le 5 décembre ».</p>`}
    <p class="legende"><span class="pastille vert"></span> plus d'une semaine <span class="pastille orange"></span> cette semaine <span class="pastille rouge"></span> dans 2 jours ou dépassée · cochez quand c'est fait</p>
    <h2>Semaine par semaine</h2>
    <div id="timeline"></div>
    <p class="legende"><a href="#/phrases">Phrases non reconnues (${vivantes(D.phrases).filter((p) => !p.reconnu).length})</a></p>`;
  brancherVoix();
  brancherFaites($("#liste"), ecranAccueil);
  rendreTimeline();
}

// ================================================================ tableau de bord (Phase 4)

let TL_LUNDI = null, TL_JOUR = null;

/** Événements d'agenda à afficher et à compter dans la charge (remplis en Phase 5). */
function evenementsAgenda() {
  return L.agenda?.evenements || [];
}

function rendreTimeline() {
  const z = $("#timeline");
  if (!z) return;
  const today = aujourdhui();
  TL_LUNDI = TL_LUNDI || lundiDe(today);
  TL_JOUR = TL_JOUR || today;
  const jours = semaine(TL_LUNDI, {
    echeances: vivantes(D.echeances),
    conges: libellesConges(D.reglages.periodesConges || ""),
    evenements: evenementsAgenda(),
  });
  const couleur = (e) => etatEcheance(e, today).couleur;
  const LETTRES = ["L", "M", "M", "J", "V", "S", "D"];
  const fin = ajouterJours(TL_LUNDI, 6);
  const titre = `${parseIso(TL_LUNDI).getDate()} – ${dateCourte(fin).replace(/^\S+ /, "")}`;
  const choisi = jours.find((j) => j.date === TL_JOUR) || jours[0];
  z.innerHTML = `
    <div class="tl-nav"><button id="tl-prec" aria-label="Semaine précédente">‹</button>
      <button id="tl-auj" class="tl-titre">${esc(titre)}${TL_LUNDI === lundiDe(today) ? " · cette semaine" : ""}</button>
      <button id="tl-suiv" aria-label="Semaine suivante">›</button></div>
    <div class="tl-semaine">${jours.map((j, i) => `
      <button class="tl-jour ${j.weekEnd || j.conge ? "off" : ""} ${j.date === today ? "auj" : ""} ${j.date === choisi.date ? "choisi" : ""}" data-jour="${j.date}"
        aria-label="${dateCourte(j.date)}${j.conge ? ", " + esc(j.conge) : ""}, ${j.echeances.length} échéance(s), ${j.evenements.length} événement(s)">
        <span class="tl-l">${LETTRES[i]}</span><span class="tl-n">${parseIso(j.date).getDate()}</span>
        <span class="tl-ech">${j.echeances.map((e) => `<i class="pt ${couleur(e)}"></i>`).join("")}</span>
        <span class="tl-nb">${j.evenements.length ? "📅" + j.evenements.length : ""}</span>
      </button>`).join("")}</div>
    <div class="carte tl-detail">
      <div class="ligne"><strong>${dateCourte(choisi.date)}</strong></div>
      ${choisi.conge ? `<div class="meta">🏖️ ${esc(choisi.conge)}</div>` : ""}
      ${choisi.echeances.map((e) => `<a class="tl-e ${couleur(e)}" href="#/e/${encodeURIComponent(e.id)}">${e.faite ? "✓" : "⚑"} ${esc(e.titre)}</a>`).join("")}
      ${choisi.evenements.map((e) => `<div class="tl-evt">📅 ${e.heure ? esc(e.heure) + " " : ""}${esc(e.titre)}</div>`).join("")}
      ${!choisi.echeances.length && !choisi.evenements.length ? `<p class="vide">Rien ce jour-là.</p>` : ""}
    </div>
    <p class="legende">Colonne : pastille = échéance · 📅 = événements de ton agenda · gris = week-end ou congé</p>`;
  $("#tl-prec").addEventListener("click", () => { TL_LUNDI = ajouterJours(TL_LUNDI, -7); TL_JOUR = TL_LUNDI; rendreTimeline(); });
  $("#tl-suiv").addEventListener("click", () => { TL_LUNDI = ajouterJours(TL_LUNDI, 7); TL_JOUR = TL_LUNDI; rendreTimeline(); });
  $("#tl-auj").addEventListener("click", () => { TL_LUNDI = lundiDe(today); TL_JOUR = today; rendreTimeline(); });
  z.querySelectorAll("[data-jour]").forEach((b) => b.addEventListener("click", () => { TL_JOUR = b.dataset.jour; rendreTimeline(); }));
  // balayage gauche/droite sur la semaine
  let x0 = null;
  const zone = z.querySelector(".tl-semaine");
  zone.addEventListener("touchstart", (ev) => { x0 = ev.touches[0].clientX; }, { passive: true });
  zone.addEventListener("touchend", (ev) => {
    if (x0 === null) return;
    const dx = ev.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 50) { TL_LUNDI = ajouterJours(TL_LUNDI, dx < 0 ? 7 : -7); TL_JOUR = TL_LUNDI; rendreTimeline(); }
  });
}

// ================================================================ voix (Phase 2)

let PREREMPLI = null; // résultat du parseur, repris par le formulaire
let COMMANDE = null;  // commande vocale (Phase 3) en attente de validation

function contexteParseur() {
  return { aujourdhui: aujourdhui(), classes: D.reglages.classes, alias: vivantes(D.alias),
    periodesConges: D.reglages.periodesConges || "", chapitres: chapitresHub() };
}

/** Chapitres transmis par le hub (Phase 6), par classe. */
function chapitresHub() {
  const out = {};
  for (const c of D.hub?.classes || []) if (c.id) out[c.id] = c.chapitres || [];
  return out;
}

async function journaliser(texte, r) {
  const entree = { id: uid(), texte, dateHeure: maintenant(), reconnu: r.reconnu && r.intention === "creer",
    intention: r.intention, resultat: { type: r.type, classeId: r.classeId, cours: r.cours, date: r.date, chapitre: r.chapitre },
    incertains: r.incertains, manquants: r.manquants, corrigeeEn: null, majLe: maintenant() };
  D.phrases.push(entree);
  await sauver();
  return entree.id;
}

async function traiterPhrase(texte) {
  texte = texte.trim();
  if (!texte) return;
  const r = analyser(texte, contexteParseur());
  const idLog = await journaliser(texte, r);
  if (r.intention !== "creer") {
    COMMANDE = { r, idLog, prep: preparerCommande(r, { echeances: D.echeances }, aujourdhui(), L.derniere) };
    location.hash = "#/commande";
    return;
  }
  PREREMPLI = { ...r, idLog };
  location.hash = "#/nouvelle";
}

function brancherVoix() {
  const SR = self.SpeechRecognition || self.webkitSpeechRecognition;
  const bouton = $("#micro"), champ = $("#phrase");
  $("#f-phrase").addEventListener("submit", (ev) => { ev.preventDefault(); traiterPhrase(champ.value); });
  if (!SR) {
    bouton.classList.add("indispo");
    $("#micro-txt").textContent = "Micro indisponible ici : utilisez le micro du clavier dans le champ ci-dessous";
    bouton.addEventListener("click", () => champ.focus());
    return;
  }
  let reco = null, langue = "fr-BE", garde = null;
  const message = (t) => { $("#voix-msg").innerHTML = t ? `<div class="alerte">${t}</div>` : ""; };
  const repos = () => { clearTimeout(garde); bouton.classList.remove("ecoute"); $("#micro-txt").textContent = "Toucher pour dicter"; reco = null; };
  const AIDE_SYSTEME = /Android/.test(navigator.userAgent)
    ? "Android : Paramètres → Applications → Chrome → Autorisations → Micro → Autoriser."
    : "Mac : Réglages Système → Confidentialité et sécurité → Micro → cocher Google Chrome, puis relancer Chrome.";

  /** Demande d'abord l'accès au micro (vraie fenêtre d'autorisation), pour pouvoir expliquer un refus. */
  const autoriser = async () => {
    if (!navigator.mediaDevices?.getUserMedia) return true;
    try {
      const flux = await navigator.mediaDevices.getUserMedia({ audio: true });
      flux.getTracks().forEach((p) => p.stop());
      return true;
    } catch (e) {
      const raisons = {
        NotAllowedError: `Micro refusé. Autorisez-le : icône 🔒 ou 🎙️ à gauche de l'adresse → Micro → Autoriser. Si c'est déjà autorisé : ${AIDE_SYSTEME}`,
        NotFoundError: "Aucun micro détecté sur cet appareil.",
        NotReadableError: `Le micro est bloqué par le système ou utilisé par une autre appli. ${AIDE_SYSTEME}`,
      };
      message(esc(raisons[e.name] || `Micro indisponible (${e.name}).`) + " En attendant, utilisez le champ texte ci-dessous.");
      return false;
    }
  };

  const demarrer = async () => {
    $("#micro-txt").textContent = "Autorisation du micro…";
    if (!(await autoriser())) { repos(); return; }
    reco = new SR();
    reco.lang = langue;
    reco.interimResults = true;
    reco.maxAlternatives = 1;
    reco.onstart = () => { clearTimeout(garde); bouton.classList.add("ecoute"); $("#micro-txt").textContent = "J'écoute… (touchez pour arrêter)"; };
    reco.onresult = (ev) => {
      const res = [...ev.results].map((x) => x[0].transcript).join(" ");
      champ.value = res;
      if (ev.results[ev.results.length - 1].isFinal) traiterPhrase(res);
    };
    reco.onerror = (ev) => {
      if (ev.error === "language-not-supported" && langue === "fr-BE") { langue = "fr-FR"; repos(); demarrer(); return; }
      const msgs = {
        "not-allowed": `Micro refusé. Autorisez-le (icône à gauche de l'adresse → Micro). ${AIDE_SYSTEME}`,
        "service-not-allowed": "La reconnaissance vocale n'est pas disponible dans ce navigateur : utilisez Chrome, ou la dictée du clavier dans le champ texte.",
        "audio-capture": `Le micro ne capte rien. ${AIDE_SYSTEME}`,
        "no-speech": "Je n'ai rien entendu. Réessayez en parlant juste après « J'écoute ».",
        network: "La reconnaissance vocale de Chrome a besoin d'Internet : utilisez le champ texte hors ligne.",
        aborted: "",
      };
      const m = ev.error in msgs ? msgs[ev.error] : `Micro : ${ev.error}`;
      if (m) message(esc(m));
    };
    reco.onend = repos;
    garde = setTimeout(() => {
      if (!bouton.classList.contains("ecoute")) {
        message(esc(`Le micro ne démarre pas. Vérifiez l'autorisation (icône à gauche de l'adresse) puis réessayez. ${AIDE_SYSTEME}`));
        try { reco?.abort(); } catch { /* rien */ }
        repos();
      }
    }, 6000);
    try { reco.start(); } catch { repos(); }
  };
  bouton.addEventListener("click", () => { if (reco) reco.stop(); else { $("#voix-msg").innerHTML = ""; demarrer(); } });
}

// ================================================================ commandes vocales (Phase 3)

const VERBES = { cocher: "Marquer faite", decaler: "Décaler", supprimer: "Supprimer", consulter: "Consulter" };

function lireAVoixHaute(texte) {
  if (!("speechSynthesis" in self)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(texte);
  u.lang = "fr-BE";
  speechSynthesis.speak(u);
}

function ecranCommande() {
  if (!COMMANDE) { location.hash = "#/"; return; }
  const { r, prep } = COMMANDE;
  const tete = `<a class="retour" href="#/">← Retour</a>
    <div class="carte dictee"><div class="meta">Vous avez dit :</div><strong>« ${esc(r.phrase)} »</strong>
    <div class="meta">Compris : <b>${esc(VERBES[r.intention])}</b></div></div>`;

  if (r.intention === "consulter") return ecranConsulter(tete, prep.resultat);

  if (prep.probleme && !prep.echeance) {
    $("#app").innerHTML = tete + `<div class="alerte rouge">${esc(prep.probleme)}</div><a class="gros-bouton" href="#/">Retour</a>`;
    return;
  }
  const opts = prep.candidats.map((e) => `<option value="${esc(e.id)}" ${e.id === prep.echeance.id ? "selected" : ""}>${esc(e.titre)} — ${dateCourte(e.date)}</option>`).join("");
  const inc = (k) => (prep.incertains.includes(k) ? "incertain" : "");
  $("#app").innerHTML = tete + `
    <form id="fc" class="carte formulaire">
      <label class="${inc("echeance")}">Échéance<select name="echeance">${opts}</select></label>
      ${r.intention === "decaler" ? `<label class="${inc("date")} ${prep.date ? "" : "manquant"}">Nouvelle date<input type="date" name="date" value="${prep.date || ""}"></label>` : ""}
      <div id="cmd-info"></div>
      <div class="boutons"><button class="${r.intention === "supprimer" ? "danger" : "primaire"}" type="submit" id="valider">${esc(VERBES[r.intention])}</button>
        <a class="bouton-lien" href="#/">Annuler</a></div>
    </form>`;
  const f = $("#fc");
  const ech = () => vivantes(D.echeances).find((e) => e.id === f.echeance.value);
  const majDetails = () => {
    const e = ech();
    let info = "";
    if (r.intention === "cocher" && e.faite) info = `<div class="alerte">Cette échéance est déjà marquée faite.</div>`;
    if (r.intention === "decaler" && f.date.value) info = `<p class="aide">Du ${dateCourte(e.date)} au ${dateCourte(f.date.value)}.</p>`;
    if (r.intention === "supprimer") {
      info = `<div class="alerte rouge">« ${esc(e.titre)} » (${dateCourte(e.date)}) sera supprimée.</div>`;
    }
    $("#cmd-info").innerHTML = info;
  };
  f.querySelectorAll("select,input").forEach((x) => x.addEventListener("input", () => { x.closest("label").classList.remove("incertain", "manquant"); majDetails(); }));
  majDetails();
  f.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const e = ech();
    const diff = [];
    if (e.id !== prep.echeance.id) diff.push(`échéance ${e.titre}`);
    if (r.intention === "cocher") {
      await marquerFaite(e.id, true);
    } else if (r.intention === "decaler") {
      if (!f.date.value) { f.date.closest("label").classList.add("manquant"); return; }
      if (f.date.value !== prep.date) diff.push(`date ${f.date.value}`);
      await decaler(e.id, f.date.value);
    } else if (r.intention === "supprimer") {
      await supprimer(e.id);
    }
    await marquerJournal(COMMANDE.idLog, diff, prep.incertains.length === 0 && !prep.probleme);
    COMMANDE = null;
    location.hash = r.intention === "supprimer" ? "#/" : `#/e/${encodeURIComponent(e.id)}`;
  });
}

async function marquerJournal(idLog, diff, sansDoute) {
  const p = D.phrases.find((x) => x.id === idLog);
  if (!p) return;
  Object.assign(p, diff.length ? { reconnu: false, corrigeeEn: diff.join(", ") } : { reconnu: sansDoute || true }, { majLe: maintenant() });
  await sauver();
}

function ecranConsulter(tete, res) {
  const resume = res.echeances.length
    ? `${res.titre} : ${res.echeances.length} échéance${res.echeances.length > 1 ? "s" : ""}. ` +
      res.echeances.slice(0, 6).map((e) => `${e.titre}, ${e.depassee ? "dépassée" : dateCourte(e.date)}`).join(". ")
    : `${res.titre} : rien de prévu.`;
  $("#app").innerHTML = tete + `
    <div class="carte"><div class="ligne"><h3 style="margin:0">${esc(res.titre)}</h3><button id="lire" aria-label="Lire à voix haute">🔊 Lire</button></div></div>
    ${res.echeances.length ? `<div class="liste" id="liste">${res.echeances.map((e) => carteEcheance(e)).join("")}</div>` : `<p class="vide">Rien de prévu 🎉</p>`}`;
  $("#lire").addEventListener("click", () => lireAVoixHaute(resume));
  brancherFaites($("#liste"), () => { COMMANDE.prep.resultat = consulter(COMMANDE.r, D.echeances, aujourdhui()); ecranCommande(); });
  marquerJournal(COMMANDE.idLog, [], true);
}

// ================================================================ lien avec Classroom Hub (Phase 6)

async function recevoirHub(h) {
  const params = new URLSearchParams(h.split("?")[1] || "");
  const aller = params.get("aller") || "/";
  try {
    const hub = importerHub(decoderPaquet(params.get("d") || ""), D.reglages.classes, maintenant());
    D.hub = hub;
    await sauver();
    const sans = hub.classes.filter((c) => !c.id).map((c) => c.hubNom);
    if (sans.length) sessionStorage.setItem("hub-avert", `Classes du Hub sans équivalent dans l'appli : ${sans.join(", ")} (ajoutez-les dans les réglages).`);
  } catch {
    sessionStorage.setItem("hub-avert", "Les chapitres envoyés par le Hub n'ont pas pu être lus.");
  }
  history.replaceState(null, "", location.pathname + "#" + decodeURIComponent(aller));
  rendre();
}

function ecranChapitre(id) {
  const ch = chapitreParId(D.hub, id);
  const liees = vivantes(D.echeances).filter((e) => e.chapitreId === id).sort((a, b) => a.date.localeCompare(b.date));
  $("#app").innerHTML = `
    <a class="retour" href="#/">← Retour</a>
    <h2>📚 ${esc(ch?.nom || "Chapitre")}</h2>
    <p class="meta">${ch ? `${esc(ch.hubNom)}${ch.theme ? " · " + esc(ch.theme) : ""}` : "Chapitre inconnu : rouvrez l'appli depuis le Hub pour mettre à jour la liste."}</p>
    <div class="boutons">${ch?.classeId ? `<button class="primaire" id="nouv">＋ Échéance pour ce chapitre</button>` : ""}
      ${surMac() ? `<a class="bouton-lien" href="${lienHub(id)}">Ouvrir dans le Hub</a>` : ""}</div>
    ${liees.length ? `<div class="liste" id="liste">${liees.map((e) => carteEcheance(e)).join("")}</div>` : `<p class="vide">Aucune échéance liée à ce chapitre.</p>`}`;
  brancherFaites($("#liste"), () => ecranChapitre(id));
  $("#nouv")?.addEventListener("click", () => {
    PREREMPLI = { phrase: `Chapitre « ${ch.nom} »`, type: "controle", classeId: ch.classeId, cours: null, date: null, chapitre: ch.nom,
      chapitreId: id, incertains: ["type"], manquants: ["date"], notes: [], idLog: null };
    location.hash = "#/nouvelle";
  });
}

function ecranPhrases() {
  const toutes = vivantes(D.phrases).sort((a, b) => b.dateHeure.localeCompare(a.dateHeure));
  const voirTout = location.hash.includes("toutes");
  const liste = voirTout ? toutes : toutes.filter((p) => !p.reconnu);
  const ligne = (p) => `<li class="carte"><div class="ligne"><strong>« ${esc(p.texte)} »</strong></div>
    <div class="meta">${new Date(p.dateHeure).toLocaleString("fr-BE")} · ${esc(INTENTIONS[p.intention] || p.intention)}
    ${p.manquants?.length ? ` · manquant : ${esc(p.manquants.join(", "))}` : ""}${p.incertains?.length ? ` · incertain : ${esc(p.incertains.join(", "))}` : ""}</div>
    ${p.corrigeeEn ? `<div class="meta">Corrigé en : ${esc(p.corrigeeEn)}</div>` : ""}</li>`;
  $("#app").innerHTML = `
    <a class="retour" href="#/">← Retour</a>
    <h2>Phrases ${voirTout ? "(toutes)" : "non reconnues"}</h2>
    <p class="aide">Une phrase est « non reconnue » s'il a fallu compléter ou corriger l'aperçu, ou si la commande n'est pas encore gérée.
      Exportez-les pour les recopier dans la feuille de route : on enrichira les règles ensemble.</p>
    <div class="boutons"><button id="exporter" class="primaire">Copier pour la feuille de route</button>
      <a class="bouton-lien" href="${voirTout ? "#/phrases" : "#/phrases/toutes"}">${voirTout ? "Seulement les non reconnues" : "Voir toutes les phrases"}</a></div>
    ${liste.length ? `<ul class="liste-phrases">${liste.map(ligne).join("")}</ul>` : `<p class="vide">Aucune phrase.</p>`}`;
  $("#exporter").addEventListener("click", async () => {
    const texte = liste.map((p) => `- ${p.dateHeure.slice(0, 10)} « ${p.texte} » → ${INTENTIONS[p.intention] || p.intention}` +
      `${p.manquants?.length ? ` ; manquant : ${p.manquants.join(", ")}` : ""}${p.incertains?.length ? ` ; incertain : ${p.incertains.join(", ")}` : ""}` +
      `${p.corrigeeEn ? ` ; corrigé en : ${p.corrigeeEn}` : ""}`).join("\n");
    try { await navigator.clipboard.writeText(texte); $("#exporter").textContent = "Copié ✓"; }
    catch {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([texte], { type: "text/plain" }));
      a.download = "phrases-non-reconnues.txt";
      a.click();
    }
  });
}

function ecranNouvelle() {
  const classes = D.reglages.classes;
  $("#app").innerHTML = `
    <a class="retour" href="#/">← Retour</a>
    <h2>Nouvelle échéance</h2>
    ${PREREMPLI ? `<div class="carte dictee"><div class="meta">${PREREMPLI.idLog ? "Vous avez dit :" : "Depuis le Hub :"}</div><strong>« ${esc(PREREMPLI.phrase)} »</strong>
      ${PREREMPLI.notes.map((n) => `<div class="alerte">${esc(n)}</div>`).join("")}
      <p class="aide">Vérifiez : <span class="tag incertain">à vérifier</span> <span class="tag manquant">à compléter</span>. Rien n'est enregistré sans votre validation.</p></div>` : ""}
    <form id="f" class="carte formulaire">
      <label>Type<select name="type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
      <label>Classe<select name="classeId">${classes.map((c) => `<option value="${esc(c.id)}">${esc(c.nom)}</option>`).join("")}</select></label>
      <label id="l-cours">Cours<select name="cours"></select></label>
      <label>Date<input type="date" name="date" required min="${aujourdhui()}"></label>
      <label>Titre<input name="titre" placeholder="Rempli automatiquement"></label>
      <label>Chapitre (facultatif)<input name="chapitre" list="chapitres-hub" placeholder="ex. Le budget" autocomplete="off"></label>
      <datalist id="chapitres-hub"></datalist>
      <button class="primaire" type="submit">Enregistrer l'échéance</button>
    </form>`;
  const f = $("#f");
  const majCours = () => {
    const c = classe(f.classeId.value);
    $("#chapitres-hub").innerHTML = (chapitresHub()[f.classeId.value] || []).map((x) => `<option value="${esc(x.nom)}">${esc(x.theme)}</option>`).join("");
    $("#l-cours").classList.toggle("cache", !c?.cours?.length);
    f.cours.innerHTML = `<option value="">—</option>` + (c?.cours || []).map((x) => `<option>${esc(x)}</option>`).join("");
  };
  const titreAuto = () => {
    const c = classe(f.classeId.value);
    return `${TYPES[f.type.value]} ${c?.nom || ""}${f.cours.value ? " — " + f.cours.value : ""}${f.chapitre.value ? " (" + f.chapitre.value + ")" : ""}`.trim();
  };
  const dicte = PREREMPLI;
  if (dicte) {
    f.type.value = dicte.type;
    if (dicte.classeId) f.classeId.value = dicte.classeId; else f.classeId.selectedIndex = -1;
    if (dicte.date) f.date.value = dicte.date;
    if (dicte.chapitre) f.chapitre.value = dicte.chapitre;
    const champ = { type: "type", classe: "classeId", date: "date", chapitre: "chapitre" };
    for (const k of dicte.incertains) f[champ[k]]?.closest("label").classList.add("incertain");
    for (const k of dicte.manquants) f[champ[k]]?.closest("label").classList.add("manquant");
    f.querySelectorAll("label").forEach((l) => l.addEventListener("input", () => l.classList.remove("incertain", "manquant")));
  }
  majCours();
  if (dicte?.cours) f.cours.value = dicte.cours;
  f.classeId.addEventListener("change", () => { majCours(); f.titre.placeholder = titreAuto(); });
  ["type", "cours", "chapitre"].forEach((n) => f[n].addEventListener("input", () => { f.titre.placeholder = titreAuto(); }));
  f.titre.placeholder = titreAuto();
  f.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!f.classeId.value) { f.classeId.closest("label").classList.add("manquant"); f.classeId.focus(); return; }
    const chHub = (chapitresHub()[f.classeId.value] || []).find((x) => x.nom.toLowerCase() === f.chapitre.value.trim().toLowerCase());
    const e = { type: f.type.value, classeId: f.classeId.value, cours: f.cours.value || null, date: f.date.value,
      titre: f.titre.value.trim() || titreAuto(), chapitre: f.chapitre.value.trim() || null, chapitreId: chHub ? chHub.id : null };
    const ech = await creerEcheance(e);
    if (dicte) await corrigerJournal(dicte, e);
    PREREMPLI = null;
    location.hash = `#/e/${encodeURIComponent(ech.id)}`;
  });
}

function ecranEcheance(id) {
  const e = vivantes(D.echeances).find((x) => x.id === id);
  if (!e) { location.hash = "#/"; return; }
  if (L.derniere !== id) { L.derniere = id; enregistrerLocal(L); }
  const c = classe(e.classeId);
  $("#app").innerHTML = `
    <a class="retour" href="#/">← Retour</a>
    <div id="fiche">${carteEcheance(e, false)}</div>
    <div class="carte">
      <div class="meta">${esc(TYPES[e.type])} · ${esc(c?.nom || e.classeId)}${e.cours ? " · " + esc(e.cours) : ""}${e.chapitre ? " · chapitre : " + esc(e.chapitre) : ""}</div>
      ${e.chapitreId ? `<div class="boutons">${surMac() ? `<a class="bouton-lien" href="${lienHub(e.chapitreId)}">📚 Ouvrir le chapitre dans le Hub</a>` : ""}
        <a class="bouton-lien" href="#/chapitre/${encodeURIComponent(e.chapitreId)}">Toutes les échéances du chapitre</a></div>` : ""}
      <div class="boutons"><button class="primaire" id="fait">${e.faite ? "Marquer comme non faite" : "✓ Marquer faite"}</button></div>
      <label>Décaler l'échéance au<input type="date" id="nd" value="${e.date}"></label>
      <div class="boutons"><button id="decaler">Décaler</button><button class="danger" id="suppr">Supprimer</button></div>
    </div>`;
  brancherFaites($("#fiche"), () => ecranEcheance(id));
  $("#fait").addEventListener("click", async () => { await marquerFaite(id, !e.faite); ecranEcheance(id); });
  $("#decaler").addEventListener("click", async () => {
    const nd = $("#nd").value;
    if (!nd || nd === e.date) return;
    await decaler(id, nd);
    ecranEcheance(id);
  });
  $("#suppr").addEventListener("click", async () => {
    if (!confirm(`Supprimer « ${e.titre} » ?`)) return;
    await supprimer(id);
    location.hash = "#/";
  });
}

function ecranReglages() {
  const r = D.reglages;
  $("#app").innerHTML = `
    <a class="retour" href="#/">← Retour</a>
    <h2>Réglages</h2>
    <section class="carte formulaire">
      <h3>Compte Google (synchronisation et congés)</h3>
      <p class="aide">Connectez-vous une seule fois : ensuite, la synchronisation est automatique (à chaque modification, à l'ouverture et toutes les 5 minutes).</p>
      <label>ID client Google<input id="cid" value="${esc(L.clientId)}" placeholder="xxxxx.apps.googleusercontent.com" autocomplete="off"></label>
      <div class="boutons"><button class="primaire" id="connecter">${G.estConnecte() ? "Synchroniser maintenant" : "Se connecter à Google"}</button>
        ${G.estConnecte() ? `<button id="deco">Se déconnecter</button>` : ""}</div>
      <p class="aide">État : <span id="etat-sync">${esc(syncEtat.texte)}</span>${L.derniereSync ? ` · dernière sync ${new Date(L.derniereSync).toLocaleString("fr-BE")}` : ""}</p>
    </section>
    <section class="carte formulaire">
      <h3>Congés scolaires</h3>
      <p class="aide">Une période par ligne, d'après le calendrier officiel FWB : « 19/12/2026 - 03/01/2027 Vacances d'hiver »
        ou un jour seul « 11/11/2026 Armistice ». Synchronisé entre tes appareils.</p>
      <label>Périodes de congé<textarea id="periodes" rows="8" placeholder="JJ/MM/AAAA - JJ/MM/AAAA Libellé">${esc(r.periodesConges || "")}</textarea></label>
      <p class="aide">${congesSaisis().size} jour(s) de congé saisis.</p>
      <details><summary class="aide">Option : lire aussi un agenda Google</summary>
      <label>Nom de l'agenda Google des congés<input id="agenda" value="${esc(r.agendaConges)}" placeholder="ex. Congés scolaires FWB"></label>
      <div class="boutons"><button id="conges">Charger les congés</button><button id="lister">Choisir dans mes agendas</button></div>
      <div id="agendas"></div>
      </details>
      <p class="aide">${L.conges.dates?.length ? `${L.conges.dates.length} jours de congé chargés (agenda « ${esc(L.conges.agenda)} », ${new Date(L.conges.majLe).toLocaleDateString("fr-BE")}).` : "Aucun congé chargé."}</p>
    </section>
    <section class="carte formulaire">
      <h3>Google Agenda</h3>
      <label class="row"><input type="checkbox" id="ag-lire" ${r.agendaLecture !== false ? "checked" : ""}> Lire mes événements (timeline et charge)</label>
      <label class="row"><input type="checkbox" id="ag-ecrire" ${r.agendaEcriture ? "checked" : ""}> Écrire mes échéances dans l'agenda « ${esc(NOM_AGENDA)} » (rappels J-3 et la veille, à 18 h)</label>
      <p class="aide">${L.agenda?.majLe ? `${L.agenda.evenements.length} événement(s) lus (${new Date(L.agenda.majLe).toLocaleString("fr-BE")}).` : "Aucun événement lu."}
        ${r.agendaId ? " Agenda « Échéances » relié." : ""}${agendaErreur ? ` <span class="retard">${esc(agendaErreur)}</span>` : ""}</p>
      <div class="boutons"><button id="ag-maj">Mettre à jour l'agenda maintenant</button></div>
    </section>
    <section class="carte formulaire">
      <h3>Classes et cours</h3>
      <p class="aide">Une classe par ligne ; les cours après « : », séparés par des virgules.</p>
      <textarea id="classes" rows="5">${esc(r.classes.map((c) => c.nom + (c.cours.length ? " : " + c.cours.join(", ") : "")).join("\n"))}</textarea>
      <h3>Alias de classes (pour la voix)</h3>
      <p class="aide">Un alias par ligne : « alias = classe ».</p>
      <textarea id="alias" rows="5">${esc(vivantes(D.alias).map((a) => `${a.alias} = ${a.classeId}`).join("\n"))}</textarea>
    </section>
    <div class="boutons"><button class="primaire" id="sauver">Enregistrer les réglages</button></div>
    <div id="msg"></div>`;
  const msg = (t, cls = "") => { $("#msg").innerHTML = `<div class="alerte ${cls}">${esc(t)}</div>`; };
  $("#connecter").addEventListener("click", async () => {
    L.clientId = $("#cid").value.trim();
    await enregistrerLocal(L);
    await synchroniser({ interactif: true });
    ecranReglages();
  });
  $("#deco")?.addEventListener("click", async () => { G.deconnecter(); L.dejaConnecte = false; L.jeton = null; L.expire = 0; await enregistrerLocal(L); etat("Non connecté à Google", "off"); ecranReglages(); });
  $("#conges").addEventListener("click", async () => {
    try {
      L.clientId = $("#cid").value.trim();
      D.reglages.agendaConges = $("#agenda").value.trim();
      D.reglages.majLe = maintenant();
      await sauver();
      await actualiserConges({ interactif: !G.estConnecte() });
      ecranReglages();
    } catch (e) { msg(e.message, "rouge"); }
  });
  $("#lister").addEventListener("click", async () => {
    try {
      L.clientId = $("#cid").value.trim();
      await G.connecter(L.clientId, !G.estConnecte());
      const liste = await G.listerAgendas();
      $("#agendas").innerHTML = `<p class="aide">Touchez l'agenda des congés :</p><div class="boutons">${liste.map((a) =>
        `<button data-agenda="${esc(a.summary)}">${esc(a.summary)}</button>`).join("")}</div>`;
      document.querySelectorAll("[data-agenda]").forEach((b) => b.addEventListener("click", () => {
        $("#agenda").value = b.dataset.agenda;
        $("#conges").click();
      }));
    } catch (e) { msg(e.message, "rouge"); }
  });
  $("#ag-maj").addEventListener("click", async () => {
    D.reglages.agendaLecture = $("#ag-lire").checked;
    D.reglages.agendaEcriture = $("#ag-ecrire").checked;
    D.reglages.majLe = maintenant();
    await enregistrerDonnees(D);
    $("#ag-maj").textContent = "Mise à jour…";
    if (L.agenda) L.agenda.majLe = null; // relire tout de suite
    await synchroniser({ interactif: !G.estConnecte() || !G.jetonComplet() });
    ecranReglages();
  });
  $("#sauver").addEventListener("click", async () => {
    try {
      const t = maintenant();
      r.agendaConges = $("#agenda").value.trim();
      r.agendaLecture = $("#ag-lire").checked;
      r.agendaEcriture = $("#ag-ecrire").checked;
      const periodes = periodesVersJours($("#periodes").value);
      if (periodes.erreurs.length) throw new Error(`Périodes illisibles : ${periodes.erreurs.join(" · ")}`);
      r.periodesConges = $("#periodes").value.trim();
      r.classes = $("#classes").value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
        const [nom, cours = ""] = l.split(":");
        return { id: nom.trim(), nom: nom.trim(), cours: cours.split(",").map((x) => x.trim()).filter(Boolean) };
      });
      r.majLe = t;
      const lignesAlias = $("#alias").value.split("\n").map((l) => l.split("=").map((x) => x.trim())).filter(([a, c]) => a && c);
      D.alias.forEach((a) => Object.assign(a, { supprime: true, majLe: t }));
      lignesAlias.forEach(([alias, classeId]) => D.alias.push({ id: uid(), alias, classeId, majLe: t }));
      await sauver();
      msg(`Réglages enregistrés (${periodes.jours.size} jours de congé).`);
    } catch (e) { msg(e.message, "rouge"); }
  });
}

// ================================================================ démarrage

async function demarrer() {
  D = await chargerDonnees();
  L = await chargerLocal();
  if (!L.clientId) L.clientId = GOOGLE_CLIENT_ID;
  G.restaurer(L.jeton, L.expire, L.portee);
  $("#sync").addEventListener("click", () => synchroniser({ interactif: true }));
  window.addEventListener("hashchange", rendre);
  window.addEventListener("online", () => synchroniser());
  window.addEventListener("offline", () => etat("Hors ligne : modifications gardées sur l'appareil", "warn"));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") synchroniser(); });
  rendre();
  etat(syncEtat.texte, syncEtat.classe);
  synchroniser();
  setInterval(() => { if (document.visibilityState === "visible") synchroniser(); }, 5 * 60000); // synchro automatique
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
}

demarrer();

// Pour les tests manuels dans la console.
self.__echeances = { get donnees() { return D; }, ecartJours };
