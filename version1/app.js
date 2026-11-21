import { ROLES, seed, TODAY } from "./seed.js";
import {
  KEY,
  FUNCTIONS,
  can,
  modeAllowed,
  forbidden,
  activeUser,
  scopedStudents,
  dossier,
  reportsFor,
  notices,
  participants,
  messages,
  archivedRooms,
  id,
  log,
  notify,
  mutate,
  attachment,
  parseCSV,
  importRows,
  STUDENT_STATUSES,
  visitsFor,
  crvsFor,
  crasFor,
} from "./domain.js";
import { readStoredState, writeStoredState } from "./storage.js";
import {
  icon,
  esc,
  avatar,
  badge,
  btn,
  empty,
  notice,
  field,
  area,
  select,
  fileField,
  miniPipeline,
  pipeline,
  safeRich,
  richEditor,
} from "./ui.js";
let { state: s, issue: storageIssue } = readStoredState();
let page = "home",
  tab = "",
  filters = {},
  selected = new Set(),
  detailId = null,
  dialog = null,
  dialogReturn = null,
  permissionDraft = null,
  importData = null,
  importStep = 1,
  importName = "mon-master-demo.csv",
  roomChannel = "general",
  calendarOffset = 0,
  externalConflict = false,
  timer;
const app = document.querySelector("#app"),
  overlay = document.querySelector("#overlay");
const name = (id) => s.users.find((u) => u.id === id)?.name || "Non affecté";
const role = () => s.session?.role;
const roleShort = () =>
  role() === "company"
    ? scopedStudents(s).length &&
      scopedStudents(s).every((d) => ["Stage alterné", "Stage temps plein"].includes(d.contract))
      ? "Maître de stage"
      : "Tuteur entreprise"
    : ROLES[role()]?.short;
const user = () => activeUser(s);
const students = () => scopedStudents(s);
const fmt = (x) =>
  x
    ? new Date(x + "T12:00:00").toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "Non renseigné";
const dname = (id) =>
  students().find((x) => x.id === id)?.name || "Dossier hors périmètre";
const data = (key, val) => `data-${key}="${esc(val)}"`;
function toast(text) {
  clearTimeout(timer);
  const el = document.querySelector("#toast");
  el.textContent = text;
  el.classList.add("show");
  timer = setTimeout(() => el.classList.remove("show"), 4200);
}
function storageMessage() {
  if (externalConflict)
    return `<div class="notice amber external-change-notice" role="alert">${icon("alert")}<div><strong>Données modifiées dans un autre onglet</strong><p>Copiez votre saisie si nécessaire, puis rechargez. Les modifications sont bloquées pour éviter d’écraser les données de l’autre onglet.</p>${btn("Recharger les données", "reload-external", "small mt", "refresh")}</div></div>`;
  if (storageIssue === "incompatible")
    return notice("Données locales illisibles ou incompatibles", "Les données d’origine n’ont pas été écrasées. La démonstration fonctionne temporairement en mémoire ; la réinitialisation explicite les supprimera.", "amber", "alert");
  if (storageIssue === "unavailable")
    return notice("Sauvegarde locale indisponible", "Les modifications restent uniquement en mémoire et seront perdues à la fermeture. Des données existantes pourraient ne pas avoir été chargées. Vérifiez les réglages ou l’espace de stockage, copiez vos modifications puis rechargez pour relire les données locales.", "amber", "alert");
  return "";
}
function storageBanner() {
  return `<div id="storage-status" role="status" aria-live="polite">${storageMessage()}</div>`;
}
function save() {
  if (externalConflict) return false;
  storageIssue = writeStoredState(s, storageIssue);
  const status = document.querySelector("#storage-status");
  if (status) status.innerHTML = storageMessage();
  return storageIssue === null;
}
function act(action, p, msg = "Modification enregistrée et tracée.") {
  const before = structuredClone(s);
  // Le domaine peut être mis à jour indépendamment : refuser toute ancienne
  // mutation qui contredirait la confidentialité ou les engagements affichés.
  const intendedRecipients = action === "message" && p.recipients?.length
    ? [...p.recipients].sort() : null;
  const intendedTargets = action === "message" ? structuredClone(p.recipientTargets || []) : [];
  const oldCrv = action === "crvSave"
    ? before.crvs.find((c) => c.student === p.student && (!p.id || c.id === p.id)) : null;
  try {
    mutate(s, action, p);
    if (intendedRecipients) {
      const roomBefore = before.rooms.find((room) => room.id === p.room);
      const roomAfter = s.rooms.find((room) => room.id === p.room);
      const added = roomAfter?.messages.slice(roomBefore?.messages.length ?? 0);
      const actual = added?.length === 1 ? [...added[0].recipients].sort() : [];
      if (JSON.stringify(actual) !== JSON.stringify(intendedRecipients))
        throw Error("Envoi annulé : les destinataires ne correspondent pas à votre sélection. La mise à jour des règles de messagerie est nécessaire.");
      const student = before.students.find((d) => d.id === p.student);
      const possible = student ? roomRecipientTargets(student, before) : [];
      const multiRoleIds = [...new Set(intendedTargets.map((t) => t.user))]
        .filter((id) => possible.filter((t) => t.user === id).length > 1);
      if (multiRoleIds.length) {
        const keys = (items) => items.map((t) => JSON.stringify([t.user, t.role])).sort();
        if (!Array.isArray(added[0].recipientTargets) && !added[0].recipientRoles ||
            added[0].recipientTargets && JSON.stringify(keys(added[0].recipientTargets)) !== JSON.stringify(keys(intendedTargets)))
          throw Error("Envoi annulé : le ciblage par rôle nécessite la mise à jour des règles de messagerie.");
        // Refuser un filtrage encore fondé seulement sur l'identifiant de compte.
        for (const target of possible.filter((t) => multiRoleIds.includes(t.user))) {
          if (intendedTargets.some((t) => t.user === target.user && t.role === target.role)) continue;
          const probe = structuredClone(s);
          probe.session = { user: target.user, role: target.role, lastActivity: Date.now() };
          const probeRoom = probe.rooms.find((room) => room.id === p.room);
          let visible = false;
          try { visible = messages(probe, probeRoom).some((m) => m.id === added[0].id); } catch {}
          if (visible)
            throw Error("Envoi annulé : le filtrage des destinataires par rôle n’est pas encore disponible.");
        }
      }
    }
    if (action === "missionDecision" && p.decision === "Accepter") {
      const oldMission = before.missions.find((m) => m.id === p.id);
      const newMission = s.missions.find((m) => m.id === p.id);
      const oldStudent = before.students.find((d) => d.id === oldMission?.student);
      const newStudent = s.students.find((d) => d.id === oldMission?.student);
      if (!oldStudent || newMission?.status !== "Avis favorable du tuteur" || newStudent?.tutor !== oldStudent.tutor)
        throw Error("Avis non enregistré : les règles de décision finale doivent être mises à jour avant cette action.");
    }
    if (oldCrv) {
      const updated = crvsFor(s).find((c) => c.id === oldCrv.id);
      const changed = updated && (updated.text !== oldCrv.text || (updated.html || "") !== (oldCrv.html || ""));
      if (changed && ((updated.versions || []).length <= (oldCrv.versions || []).length || updated.visas.length))
        throw Error("Modification annulée : la conservation des versions et la remise à zéro des visas doivent être prises en charge par le domaine.");
    }
    save();
    closeDialog();
    render();
    toast(msg);
    return true;
  } catch (e) {
    s = before;
    log(
      s,
      "Action refusée",
      "Action rejetée par les règles : " + action,
      "Échec",
    );
    save();
    const err = overlay.querySelector(".form-error") || app.querySelector(".form-error");
    if (err) {
      err.textContent = e.message;
      err.setAttribute("tabindex", "-1");
      err.focus();
    } else toast(e.message);
    return false;
  }
}
const navs = {
  admin: [
    ["home", "home", "Tableau de bord"],
    ["logs", "log", "Suivi des actions"],
    ["settings", "settings", "Paramétrage"],
  ],
  stages: [
    ["home", "home", "Vue d’ensemble"],
    ["cohort", "users", "Cohorte & bascule"],
    ["missions", "briefcase", "Missions & affectations"],
    ["access", "shield", "Accès & signalements"],
    ["imports", "upload", "Imports & exports"],
    ["rooms", "message", "Salons du projet"],
  ],
  m1: [
    ["home", "home", "Pilotage M1"],
    ["cohort", "users", "Cohorte M1"],
    ["analysis", "chart", "Analyses & fin d’année"],
  ],
  m2: [
    ["home", "home", "Pilotage M2"],
    ["cohort", "users", "Cohorte M2"],
    ["analysis", "chart", "Analyses & fin d’année"],
  ],
  tutor: [
    ["home", "home", "Mon espace de suivi"],
    ["missions", "briefcase", "Missions proposées"],
    ["cohort", "users", "Mes étudiants"],
    ["agenda", "calendar", "Agenda des visites"],
    ["rooms", "message", "Salons du projet"],
  ],
  company: [
    ["home", "home", "Mon espace entreprise"],
    ["cohort", "users", "Mes étudiants"],
    ["agenda", "calendar", "Visites & disponibilités"],
    ["rooms", "message", "Salons du projet"],
    ["reports", "shield", "Déclarer un problème"],
  ],
  student: [
    ["home", "home", "Mon parcours"],
    ["work", "file", "Mes comptes rendus"],
    ["agenda", "calendar", "Mes visites"],
    ["onboarding", "building", "Mon entreprise"],
    ["rooms", "message", "Mon salon de projet"],
  ],
};
function goto(p) {
  if (p !== "dossier" && !navs[role()]?.some((x) => x[0] === p)) {
    toast("Cette page n’est pas autorisée pour votre rôle.");
    return;
  }
  page = p;
  tab = "";
  filters = {};
  selected.clear();
  permissionDraft = null;
  detailId = null;
  roomChannel = "general";
  closeDialog();
  render();
  window.scrollTo(0, 0);
}
function header(
  title,
  subtitle = "",
  actions = "",
  eyebrow = "ESPACE DE SUIVI",
) {
  return `<div class="page-head"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${subtitle ? `<p class="subtext">${subtitle}</p>` : ""}</div><div class="head-actions">${actions}</div></div>`;
}
function panel(title, body, action = "") {
  return `<section class="panel"><div class="panel-head"><h2>${title}</h2>${action}</div>${body}</section>`;
}
function tabs(items, active) {
  return `<div class="tabs" role="tablist" aria-label="Sections">${items.map(([v, t]) => `<button role="tab" aria-selected="${active === v}" tabindex="${active === v ? 0 : -1}" data-action="tab" data-tab="${v}">${t}</button>`).join("")}</div>`;
}
function metric(label, value, sub, ico = "chart", delta = "") {
  return `<div class="metric"><div class="metric-top">${label}${icon(ico)}</div><div class="metric-value">${value}${delta ? `<small>${delta}</small>` : ""}</div><p>${sub}</p></div>`;
}
function urgent(n, label, sub, ico, cls, action, target = "") {
  return `<button class="urgent" data-action="${action}" data-target="${target}"><span class="urgent-top"><span class="urgent-icon ${cls}">${icon(ico)}</span><span class="urgent-number">${String(n).padStart(2, "0")}</span></span><strong>${label}</strong><span class="urgent-foot">${sub}${icon("arrow")}</span></button>`;
}
function shell() {
  const u = user(),
    r = role(),
    count = notices(s).filter((n) => !n.read).length;
  return `<aside class="sidebar" aria-label="Navigation principale"><div class="brand"><div class="brandmark">${icon("cap")}</div><div><div class="brand-name">Suivi MIAGE<span style="color:#6298be">.</span></div><div class="brand-caption">L’EXIGENCE, EN LIEN.</div></div></div><div class="workspace"><div class="workspace-icon">${icon("building")}</div><div><strong>MIAGE · UPJV</strong><span>Année 2026 – 2027</span></div>${icon("down")}</div><div class="nav-label">${r === "admin" ? "GOUVERNANCE" : "MON ESPACE"}</div><nav class="nav">${navs[r].map(([v, i, t]) => `<button data-action="nav" data-page="${v}" class="${page === v || (page === "dossier" && v === "cohort") ? "active" : ""}" ${page === v ? 'aria-current="page"' : ""}>${icon(i)}${t}${r === "stages" && v === "access" ? '<span class="count">' + s.students.filter((x) => x.access === "En attente").length + "</span>" : ""}</button>`).join("")}</nav><div class="sidebar-foot"><div class="demo-card"><div class="row">${icon("help")}<strong style="font-size:11px">Un espace pour chaque rôle</strong></div><p>Explorez les parcours et les cas métier de la démonstration.</p>${btn("Guide démo & comptes", "demo", "", "arrow")}</div><div class="university"><strong>UPJV</strong><span>Université de Picardie<br>Jules Verne</span></div></div></aside><div class="shell"><header class="topbar"><div class="breadcrumb">${btn("", "menu", "icon-btn quiet mobile-menu", "menu", 'aria-label="Ouvrir le menu" aria-expanded="false"')}<span>Espace MIAGE</span>${icon("chevron")}<strong>${page === "dossier" ? "Dossier 360°" : navs[r].find((x) => x[0] === page)?.[2] || "Vue d’ensemble"}</strong></div><div class="top-right"><span class="year">2026 – 2027</span><span class="role-pill">${roleShort()}</span>${btn("", "theme", "icon-btn quiet", s.preferences.theme === "dark" ? "sun" : "moon", 'aria-label="Changer le thème"')}${btn(`${count ? `<span class="dot-count">${count}</span>` : ""}`, "notifications", "icon-btn quiet bell", "bell", 'aria-label="Notifications : ' + count + ' non lues"')}<button class="profile-btn" data-action="profile">${avatar(u.name)}<span><strong>${esc(u.name)}</strong><small>${roleShort()}</small></span>${icon("down")}</button></div></header><main id="main" class="main" tabindex="-1">${storageBanner()}${r === "admin" ? '<div class="system-strip">' + icon("shield") + " &nbsp; Administration · Utilisateurs, rôles et permissions.</div>" : ""}${content()}<footer class="fineprint"><span>Suivi MIAGE · Université de Picardie Jules Verne</span><span class="footer-lock">${icon("lock")}Démonstration locale · Données fictives</span></footer></main></div>`;
}
function render() {
  document.documentElement.dataset.theme = s.preferences.theme;
  document.documentElement.classList.toggle("no-motion", s.preferences.motion);
  document.documentElement.style.setProperty(
    "--accent",
    ROLES[role()]?.color || "#16588b",
  );
  if (
    s.session &&
    (!user() ||
      Date.now() - (s.session.lastActivity || 0) >
        s.settings.sessionMinutes * 60000)
  ) {
    s.session = null;
    save();
  }
  app.innerHTML = !s.session ? login() : shell();
}
function login() {
  return `<div class="login"><section class="login-art"><div class="brand"><div class="brandmark">${icon("cap")}</div><div><div class="brand-name">Suivi MIAGE.</div><div class="brand-caption">UNIVERSITÉ DE PICARDIE JULES VERNE</div></div></div><div class="login-message"><div class="login-kicker">Le lien entre formation et entreprise</div><h1>Chaque parcours mérite un suivi d’excellence.</h1><p>Un espace commun pour accompagner les étudiants, coordonner les acteurs et construire la réussite.</p><div class="login-visual"><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="row" style="font-size:11px;color:#bdd0e6">${icon("shield")}Parcours fictifs · Accès simulés</div></div><div class="login-foot">UPJV &nbsp; / &nbsp; Institut d’administration des entreprises · MIAGE</div></section><section class="login-form-side"><div class="login-form">${storageBanner()}<div class="eyebrow">BIENVENUE DANS VOTRE ESPACE</div><h1>Heureux de vous retrouver.</h1><p class="subtext">Connectez-vous pour poursuivre votre suivi.</p><form data-form="login"><div class="form-error" role="alert"></div>${field("Adresse e-mail universitaire ou professionnelle", "email", "sophie.laurent@u-picardie.fr", "email")}${field("Mot de passe", "password", "Miage2026!", "password")}<div class="row between mb"><span style="font-size:11px;color:var(--muted)">${icon("lock")} Connexion locale de démonstration</span>${btn("Aide", "login-help", "link small")}</div><button class="primary" type="submit">Se connecter ${icon("arrow")}</button></form><div class="demo-note"><strong>Une démonstration, tous les parcours.</strong><p>Tous les comptes utilisent le mot de passe <strong>Miage2026!</strong>. Aucune donnée n’est transmise.</p></div>${btn("Explorer les comptes de démonstration", "demo", "quiet", "users")}<p class="subtext" style="font-size:10px;margin-top:30px">Démonstration uniquement · Ne saisissez pas de données personnelles réelles.<br>Les contrôles d’accès sont simulés, pas une sécurité serveur.</p></div></section></div>`;
}
function content() {
  const fn = {
    cohort: "cohort",
    dossier: "dossier",
    missions: "missions",
    access: "dossier",
    reports: "reports",
    imports: "imports",
    rooms: "room",
    work: "cra",
    onboarding: "dossier",
    accounts: "accounts",
    permissions: "permissions",
    settings: role() === "admin" ? undefined : "settings",
    logs: "audit",
  }[page];
  if (fn && !can(role(), fn, s))
    return (
      header("Accès non autorisé") +
      notice(
        "Cette autorisation n’est pas active",
        "Votre rôle actif ne permet pas de consulter cette section. Les droits interdits par règle métier restent verrouillés.",
        "red",
        "lock",
      ) +
      btn("Retour à mon espace", "home", "", "back")
    );
  switch (page) {
    case "home":
      return role() === "admin"
        ? adminHome()
        : ["m1", "m2"].includes(role())
          ? formationHome()
          : role() === "stages"
            ? stagesHome()
            : role() === "tutor"
              ? tutorHome()
              : role() === "student"
                ? studentHome()
                : companyHome();
    case "cohort":
      return cohortPage();
    case "dossier":
      return dossierPage();
    case "missions":
      return missionsPage();
    case "access":
      return accessPage();
    case "reports":
      return reportsPage();
    case "imports":
      return importsPage();
    case "rooms":
      return roomsPage();
    case "agenda":
      return agendaPage();
    case "work":
      return workPage();
    case "onboarding":
      return onboardingPage();
    case "analysis":
      return analysisPage();
    case "settings":
      return role() === "admin" ? adminSettings() : settingsPage();
    case "logs":
      return logsPage();
    default:
      return empty(
        "Page indisponible",
        "Revenez à votre espace.",
        "Retour à l’accueil",
        "home",
      );
  }
}
function cohortRows(list, compact = false) {
  const training = ["m1", "m2"].includes(role());
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="Tableau de données"><table><thead><tr>${!compact && role() === "stages" ? '<th><input type="checkbox" data-select-all aria-label="Sélectionner les lignes visibles"></th>' : ""}<th>Étudiant</th><th>Entreprise${compact ? " / Contrat" : ""}</th>${!compact ? "<th>Ville</th><th>Tuteur universitaire</th>" : ""}<th>Statut${compact ? " du suivi" : ""}</th>${compact ? "<th>Avancement</th>" : training ? "<th>Contrat</th>" : "<th>Prochaine action</th>"}${!training ? '<th><span class="muted">' + (compact ? "" : "Dossier") + "</span></th>" : ""}</tr></thead><tbody>${list.map((d, i) => `<tr class="${training ? "" : "clickable"}" ${training ? "" : `data-action="preview" data-id="${d.id}" tabindex="0" aria-label="Aperçu de ${esc(d.name)}"`}>${!compact && role() === "stages" ? `<td><input type="checkbox" data-select="${d.id}" ${selected.has(d.id) ? "checked" : ""} aria-label="Sélectionner ${esc(d.name)}"></td>` : ""}<td><div class="person">${avatar(d.name, ["", "purple", "green", "amber"][i % 4])}<span><strong>${esc(d.name)}</strong><small>${esc(d.promo)} · ${compact ? esc(d.contract) : "2026–2027"}</small></span></div></td><td><strong style="font-size:11px;font-weight:550">${esc(d.company)}</strong>${compact ? `<div class="muted" style="font-size:10px">${esc(d.city)}</div>` : ""}</td>${!compact ? `<td>${esc(d.city)}</td><td>${esc(name(d.tutor))}</td>` : ""}<td>${badge(d.status)}</td>${compact ? `<td>${miniPipeline(d.step)}<span style="font-size:9px;color:var(--muted)">${["Recherche", "Contrat", "Affectation", "Suivi en cours", "Visite planifiée", "Circuit des visas", "Clôturé"][d.step]}</span></td>` : training ? `<td>${esc(d.contract)}</td>` : `<td><span class="muted">${!d.tutor ? "Affecter un tuteur" : d.status.includes("Désaccord") ? "Suivre le désaccord" : d.access === "En attente" ? "Créer l’accès" : "Consulter le suivi"}</span></td>`}${!training ? `<td>${icon("chevron")}</td>` : ""}</tr>`).join("")}</tbody></table></div>`;
}
function taskCounts() {
  return {
    assign: students().filter((d) => !d.tutor && d.contract !== "Sans contrat")
      .length,
    missions: s.missions.filter((m) => m.status === "En attente").length,
    access: students().filter((d) => d.access === "En attente").length,
    reports: reportsFor(s).filter((x) => x.status !== "Clôturé").length,
  };
}
function stagesHome() {
  const c = taskCounts(),
    list = students(),
    trial = list.find(
      (x) => x.status.includes("essai") && x.access === "En attente",
    ),
    disputed = list.find((d) =>
      crvsFor(s).some((c) => c.student === d.id && c.disagreement),
    ),
    awaited = list.find((d) =>
      s.requests.some(
        (q) =>
          q.student === d.id &&
          q.type === "CRA" &&
          !crasFor(s).some((c) => c.request === q.id && c.status !== "Brouillon"),
      ),
    );
  return (
    header(
      "Bonjour " + esc(user().name.split(" ")[0]) + ",",
      "Voici les priorités de votre cohorte. Gardons le lien avec chaque parcours.",
      `<span class="date-label">${icon("calendar")}Référence démo · 21 novembre 2026</span>${btn("Exporter la synthèse", "export-home", "", "download")}`,
      "PILOTAGE DES STAGES & ALTERNANCES",
    ) +
    `<div class="section-line"><div class="section-title"><h2>À traiter en priorité</h2><span class="section-tag">${c.assign + c.missions + c.access + c.reports} actions</span></div><span class="muted" style="font-size:10px">Données de démonstration</span></div><div class="urgent-grid">${urgent(c.assign, "Dossiers à affecter", "Un tuteur à désigner", "users", "", "priority", "assign")}${urgent(c.missions, "Missions en attente", "Une réponse tuteur attendue", "briefcase", "amber", "nav-target", "missions")}${urgent(c.access, "Accès entreprise à créer", "Accueillir un nouvel encadrant", "shield", "purple", "priority", "access")}${urgent(c.reports, "Signalements ouverts", "Des situations à accompagner", "alert", "red", "priority", "reports")}</div><div class="dashboard-grid"><div class="stack">${panel(
      "La cohorte, en un regard",
      `${tabs(
        [
          [
            "all",
            'Tous les étudiants <span class="badge">' + list.length + "</span>",
          ],
          [
            "attention",
            'À suivre <span class="badge">' +
              list.filter((x) => x.status !== "En cours").length +
              "</span>",
          ],
        ],
        tab || "all",
      )}${cohortRows((tab === "attention" ? list.filter((x) => x.status !== "En cours") : list).slice(0, 5), true)}<div class="table-footer"><span>${Math.min(5, (tab === "attention" ? list.filter((x) => x.status !== "En cours") : list).length)} parcours affichés · Année 2026–2027</span>${btn("Voir toute la cohorte", "nav-target", "link small", "arrow", 'data-target="cohort"')}</div>`,
      btn(
        "Gérer la cohorte",
        "nav-target",
        "link small",
        "",
        'data-target="cohort"',
      ),
    )}${panel(
      "Derniers mouvements",
      `<div class="panel-body">${crasFor(s)
        .filter((c) => c.status !== "Brouillon")
        .slice(0, 2)
        .map(
          (c) =>
            `<div class="activity"><span class="urgent-icon green">${icon("file")}</span><div><p><strong>${esc(dname(c.student))}</strong> · CRA de ${esc(c.period)} ${badge(c.status)}</p><small>${fmt(c.date)} · Compte rendu d’activité</small></div></div>`,
        )
        .join("")}${s.audit
        .filter((a) => a.type === "Action métier")
        .slice(0, 2)
        .map(
          (a) =>
            `<div class="activity"><span class="urgent-icon">${icon("refresh")}</span><div><p>Suivi actualisé par <strong>${esc(name(a.author))}</strong></p><small>${esc(a.date)} · Action tracée dans le journal</small></div></div>`,
        )
        .join("")}</div>`,
    )}</div><aside class="stack">${panel("Échéances & vigilances", `<div class="panel-body">${trial ? alertRow("Période d’essai à suivre", esc(trial.name) + " · Accès entreprise en attente. Repère de 45 jours à vérifier.", "Accéder aux demandes", "priority", "access", "clock") : ""}${disputed ? alertRow("Un désaccord à accompagner", esc(disputed.name) + " · Circuit des visas suspendu.", "Consulter le CRV", "open-crv", disputed.id, "alert", "red") : ""}${awaited ? alertRow("Un CRA attendu", esc(awaited.name) + " · Demande du tuteur en cours.", "Voir le dossier", "open-dossier", awaited.id, "file") : ""}${c.assign ? alertRow(c.assign + " parcours sans tuteur", "Une proposition peut être envoyée à un encadrant disponible.", "Voir les affectations", "nav-target", "missions", "users") : ""}</div>`, `<span class="badge amber">À suivre</span>`)}${workloadPanel()}</aside></div><section class="metrics-section"><div class="section-line"><h2>Les repères de la promotion</h2><span class="muted" style="font-size:10px">Périmètre M1 & M2 · ${list.length} étudiants</span></div><div class="metric-grid">${metric("Étudiants accompagnés", list.length, list.filter((x) => x.promo === "M1").length + " en M1 · " + list.filter((x) => x.promo === "M2").length + " en M2", "users")}${metric("Taux de placement", Math.round((list.filter((x) => x.contract !== "Sans contrat").length / (list.length || 1)) * 100) + " %", "Étudiants avec contrat / effectif total", "briefcase")}${metric("Visites réalisées", visitsFor(s).filter((v) => v.status === "Réalisée").length, "Sur " + list.filter((x) => x.contract !== "Sans contrat").length + " contrats actifs", "calendar")}${metric("Tuteurs mobilisés", s.users.filter((x) => x.roles.includes("tutor") && x.active).length, "Capacités renseignées par les encadrants", "cap")}</div></section>`
  );
}
function alertRow(title, text, label, action, target, ico, cls = "") {
  return `<div class="alert-row"><span class="alert-icon ${cls}">${icon(ico)}</span><div class="alert-content"><h3>${title}</h3><p>${text}</p>${btn(label, action, "link", "", 'data-target="' + target + '"')}</div></div>`;
}
function workloadPanel() {
  return panel(
    "Charge des tuteurs",
    `<div class="panel-body">${s.users
      .filter((x) => x.roles.includes("tutor") && x.active)
      .map((u) => {
        const n = students().filter((x) => x.tutor === u.id).length;
        return `<div class="workload">${avatar(u.name)}<div class="workload-info"><div class="workload-head"><span>${esc(u.name)}</span><span class="muted">${n} / ${u.capacity || 5}</span></div><div class="bar"><span style="width:${Math.min(100, (n / (u.capacity || 5)) * 100)}%"></span></div></div></div>`;
      })
      .join("")}</div>`,
    btn("Affecter", "nav-target", "link small", "", 'data-target="missions"'),
  );
}
function filterSelect(key, label, values, all = "Tous") {
  return `<label>${label}<select data-filter="${key}"><option value="">${all}</option>${[
    ...new Set(values.filter(Boolean)),
  ]
    .map((v) => {
      const [val, text] = Array.isArray(v) ? v : [v, v];
      return `<option value="${esc(val)}" ${filters[key] === val ? "selected" : ""}>${esc(text)}</option>`;
    })
    .join("")}</select></label>`;
}
function filterBar() {
  const list = students();
  return `<div class="filters">${!["m1", "m2"].includes(role()) ? filterSelect("promo", "Promotion", ["M1", "M2"], "Toutes les promotions") : ""}${filterSelect("contract", "Contrat", ["Apprentissage", "Stage alterné", "Stage temps plein", "Contrat de professionnalisation", "Césure", "Sans contrat"], "Tous les contrats")}${filterSelect(
    "status",
    "Statut",
    list.map((x) => x.status),
    "Tous les statuts",
  )}${filterSelect(
    "tutor",
    "Tuteur",
    s.users
      .filter((u) => u.roles.includes("tutor") && u.active)
      .map((u) => [u.id, u.name]),
    "Tous les tuteurs",
  )}${filterSelect(
    "company",
    "Entreprise",
    list.map((x) => x.company),
    "Toutes les entreprises",
  )}${filterSelect(
    "city",
    "Ville",
    list.map((x) => x.city),
    "Toutes les villes",
  )}${filterSelect("alert", "Vigilance", ["Sans tuteur", "Désaccord CRV", "Période d’essai", "Rupture", "CRA attendu", "Visite à planifier", "CRV en attente"], "Toutes les alertes")}${btn("Réinitialiser", "reset-filters", "quiet reset", "refresh")}</div>`;
}
function filteredStudents() {
  return students().filter((d) =>
    Object.entries(filters).every(([k, v]) =>
      !v || k === "alert"
        ? k === "alert" && v
          ? alertMatches(d, v)
          : true
        : d[k] === v,
    ),
  );
}
function alertMatches(d, v) {
  return v === "Sans tuteur"
    ? !d.tutor
    : v === "Rupture"
      ? d.status.includes("Rupture")
      : v === "CRA attendu"
        ? s.requests.some(
            (q) =>
              q.student === d.id &&
              q.type === "CRA" &&
              !crasFor(s).some(
                (c) => c.request === q.id && c.status !== "Brouillon",
              ),
          )
        : v === "Visite à planifier"
          ? !visitsFor(s).some((x) => x.student === d.id)
          : v === "CRV en attente"
            ? crvsFor(s).some((x) => x.student === d.id && x.visas.length < 3)
            : d.status.includes(v);
}
function cohortPage() {
  const training = ["m1", "m2"].includes(role()),
    list = filteredStudents();
  return (
    header(
      training
        ? "La cohorte " + role().toUpperCase()
        : role() === "tutor"
          ? "Mes étudiants"
          : "Cohorte & bascule",
      training
        ? "Une vue pédagogique de votre promotion, dans le respect des périmètres."
        : "Tous les parcours, leurs acteurs et la prochaine étape.",
      `${btn("Exporter CSV", "export-cohort", "", "download")}${btn("Récapitulatif PDF", "print", "", "file")}`,
    ) +
    (training
      ? notice(
          "Confidentialité · RG-10",
          "Tableau nominatif de votre promotion uniquement. Les dossiers individuels, CRA, CRV, pièces internes et salons ne sont jamais accessibles.",
        )
      : role() === "stages"
        ? tabs(
            [
              ["cohort", "Cohorte étudiante"],
              ["transition", "Bascule M1 → M2"],
            ],
            tab || "cohort",
          )
        : "") +
    (tab === "transition" && role() === "stages"
      ? transitionContent()
      : `<section class="panel ${role() === "stages" ? "mt" : ""}">${filterBar()}${role() === "stages" ? `<div class="panel-body row between" style="padding-top:11px;padding-bottom:11px"><span class="muted" style="font-size:11px">${selected.size} étudiant(s) sélectionné(s)</span><div class="row wrap">${btn("Informer", "bulk-info", "small", "mail")}${btn("Changer le statut", "bulk-status", "small", "refresh")}${btn("Exporter la sélection", "export-selected", "small", "download")}</div></div>` : ""}${list.length ? cohortRows(list) : empty("Aucun parcours dans cette sélection", "Modifiez un critère pour retrouver vos étudiants.")}<div class="table-footer"><span>${list.length} étudiant(s) · ${training ? "Lecture seule" : "Cliquez sur une ligne pour un aperçu"}</span><span>${role() === "company" ? "Uniquement vos étudiants affectés" : "Année universitaire 2026–2027"}</span></div></section>`)
  );
}
function availability() {
  const u = user();
  return `<form class="availability" data-form="availability">${icon("cap")}<strong>Ma disponibilité</strong><label class="check-label"><input type="checkbox" name="available" ${u.available ? "checked" : ""}>J’accepte de nouvelles missions</label><label class="row">Capacité ${scopedStudents(s).length} / <input type="number" name="capacity" value="${u.capacity || 5}" min="1" max="30" aria-label="Capacité maximale"></label><button type="submit" class="small">Enregistrer</button></form>`;
}
function tutorHome() {
  const list = students(),
    ids = list.map((x) => x.id),
    pending = s.missions.filter(
      (m) => m.tutor === user().id && m.status === "En attente",
    ).length,
    c = crasFor(s).filter(
      (x) => ids.includes(x.student) && x.status === "À lire",
    ).length;
  return (
    header(
      "Bonjour " + esc(user().name.split(" ")[0]) + ",",
      "Un accompagnement de proximité, une prochaine étape pour chacun.",
      btn("Mon agenda", "nav-target", "", "calendar", 'data-target="agenda"'),
      "ESPACE TUTEUR UNIVERSITAIRE",
    ) +
    availability() +
    `<div class="section-line"><h2>Mes tâches prioritaires</h2></div><div class="urgent-grid">${urgent(pending, "Missions à examiner", "Rendre un avis sur les propositions", "briefcase", "", "nav-target", "missions")}${urgent(c, "CRA à lire & valider", "Apporter un retour à l’étudiant", "file", "amber", "tutor-cra")}${urgent(visitsFor(s).filter((x) => ids.includes(x.student) && x.status === "Proposée").length, "Visites à confirmer", "Trouver le bon créneau", "calendar", "", "nav-target", "agenda")}${urgent(crvsFor(s).filter((x) => ids.includes(x.student) && x.visas.length < 3).length, "CRV à rédiger ou viser", "Poursuivre le circuit des visas", "shield", "purple", "tutor-crv")}</div><div class="section-line"><h2>Mes étudiants <span class="badge">${list.length}</span></h2><span class="muted" style="font-size:11px">Périmètre de vos affectations uniquement</span></div><div class="grid3">${list.map((d) => studentCard(d)).join("")}</div>`
  );
}
function studentCard(d) {
  return `<article class="panel student-card"><div class="person">${avatar(d.name)}<span><strong>${esc(d.name)}</strong><small>${esc(d.promo)} · ${esc(d.contract)}</small></span></div><div class="row between">${badge(d.status)}<span class="muted" style="font-size:10px">Cycle ${d.cycle}</span></div><p class="mt">${icon("building")} ${esc(d.company)} · ${esc(d.city)}</p><p>${role() === "company" ? "Tuteur universitaire : " + esc(name(d.tutor)) : "Maître de stage : " + esc(d.mentor ? name(d.mentor) : d.mentorName || "Non renseigné")}</p>${pipeline(d.step)}${btn(d.status.includes("Désaccord") ? "Accompagner le désaccord" : "Ouvrir le suivi", "open-dossier", "", "arrow", data("target", d.id))}</article>`;
}
function studentHome() {
  const d = students()[0];
  if (!d)
    return (
      header("Mon parcours") +
      empty(
        "Aucun dossier affecté",
        "Votre responsable de formation doit rattacher votre compte.",
        "Consulter le guide",
        "demo",
      )
    );
  return (
    header(
      "Bonjour " + esc(user().name.split(" ")[0]) + ",",
      "Votre parcours avance. Retrouvez ici les prochaines étapes.",
      btn(
        "Déposer un CRA",
        "cra-form",
        "primary",
        "plus",
        data("student", d.id),
      ),
      "MON PARCOURS MIAGE",
    ) +
    projectBanner(d) +
    `<div class="panel mb"><div class="panel-body">${pipeline(d.step)}</div></div><div class="dashboard-grid"><div class="stack">${panel("La prochaine action attendue", `<div class="panel-body"><div class="row"><div class="urgent-icon">${icon(d.status.includes("Désaccord") ? "shield" : "file")}</div><div><h3>${d.status.includes("Désaccord") ? "Suivre la résolution du désaccord CRV" : "Préparer le bilan de la prochaine visite"}</h3><p class="subtext">${d.status.includes("Désaccord") ? "Les visas sont suspendus jusqu’à la rectification." : "Votre tuteur attend un point sur vos activités et vos prochaines étapes."}</p></div></div><div class="row mt">${btn("Voir mon CRV", "open-crv", "primary", "shield", data("target", d.id))}${btn("Proposer une visite", "visit-form", "", "calendar", data("student", d.id))}</div></div>`)}${panel("Ma chronologie", `<div class="panel-body">${timeline(d)}</div>`)}</div><aside class="stack">${panel("Mes interlocuteurs", `<div class="panel-body"><div class="person mb">${avatar(name(d.tutor))}<span><strong>${esc(name(d.tutor))}</strong><small>Tuteur universitaire</small></span></div><div class="person">${avatar(d.mentor ? name(d.mentor) : "En attente", "amber")}<span><strong>${esc(d.mentor ? name(d.mentor) : "Accès en attente")}</strong><small>Maître de stage</small></span></div>${btn("Échanger dans mon salon", "nav-target", "link mt", "message", 'data-target="rooms"')}</div>`)}${panel(
      "Mes dernières notifications",
      `<div class="panel-body">${
        notices(s)
          .slice(0, 3)
          .map(
            (n) =>
              `<div class="activity"><div>${icon("bell")}</div><p>${esc(n.text)}</p></div>`,
          )
          .join("") || '<p class="muted">Vous êtes à jour.</p>'
      }</div>`,
    )}${notice("Les mots du suivi", "CRA : votre bilan d’activité. CRV : le compte rendu de visite, visé successivement par votre tuteur, votre entreprise et vous.", "", "help")}</aside></div>`
  );
}
function projectBanner(d) {
  return `<section class="panel mb"><div class="panel-body"><div class="row between wrap"><div><div class="eyebrow">MON PROJET PROFESSIONNEL · CYCLE ${d.cycle}</div><h2 style="font-size:20px;margin-top:6px">${esc(d.company)}</h2><p class="subtext">${esc(d.contract)} · ${esc(d.city)} · ${fmt(d.start)} → ${fmt(d.end)}</p></div>${badge(d.status)}</div></div></section>${d.status.includes("essai") ? notice("Période d’essai · 45 jours", "Repère de démonstration : 45 jours calendaires. Le décompte réglementaire réel de l’apprentissage se fait en jours de présence en entreprise.", "amber", "clock") : ""}`;
}
function companyHome() {
  const list = students(),
    stage = list.length > 0 && list.every((x) => ["Stage alterné", "Stage temps plein"].includes(x.contract));
  return (
    header(
      "Bienvenue, " + esc(user().name.split(" ")[0]) + ".",
      "Un espace simple pour accompagner vos étudiants et échanger avec leur tuteur.",
      btn(
        "Déclarer un problème",
        "report-form",
        "",
        "alert",
        data("student", list[0]?.id || ""),
      ),
      stage
        ? "ESPACE MAÎTRE DE STAGE"
        : "ESPACE TUTEUR ENTREPRISE / MAÎTRE D’APPRENTISSAGE",
    ) +
    notice(
      "Votre rôle en trois étapes",
      "Accueillez une visite, relisez le CRV (compte rendu de visite), puis apposez votre visa après le tuteur universitaire. L’étudiant signe en dernier. " + (can(role(), "cra", s) ? "Consultez les CRA envoyés en lecture seule ; les brouillons ne sont pas accessibles." : "La consultation en lecture seule des CRA envoyés dépend de votre autorisation ; les brouillons ne sont pas accessibles."),
      "",
      "help",
    ) +
    `<div class="section-line"><h2>Les étudiants que j’accompagne</h2><span class="muted" style="font-size:11px">${list.length} affectation(s)</span></div><div class="grid2">${list.map((d) => studentCard(d)).join("")}</div>`
  );
}
function timeline(d) {
  const items = [
    ...s.requests
      .filter(
        (x) =>
          x.student === d.id &&
          role() !== "company" &&
          (x.type !== "CRA" || can(role(), "cra", s)),
      )
      .map((x) => ({
        date: x.date,
        title: "Demande du tuteur · " + x.type,
        text: x.text + "\nDate souhaitée : " + fmt(x.due),
        status: "Demande",
        deposit: false,
      })),
    ...crasFor(s)
      .filter(
        (x) =>
          x.student === d.id &&
          can(role(), "cra", s) &&
          (role() === "student" || x.status !== "Brouillon"),
      )
      .map((x) => ({
        date: x.date,
        title:
          (role() === "student" ? "Mon dépôt" : "Dépôt étudiant") +
          " · CRA " +
          x.period,
        text:
          x.activities +
          "\nDifficultés : " +
          x.difficulties +
          "\nProchaines étapes : " +
          x.next +
          (x.feedback ? "\nRetour du tuteur : " + x.feedback : ""),
        status: x.status,
        deposit: true,
      })),
    ...visitsFor(s)
      .filter((x) => x.student === d.id)
      .map((x) => ({
        date: x.date,
        title: "Visite · " + x.place,
        text: x.time + " · " + x.status,
        status: x.status,
      })),
    ...crvsFor(s)
      .filter((x) => x.student === d.id && can(role(), "crv", s))
      .map((x) => ({
        date: "2026-11-19",
        title: "Compte rendu de visite · CRV",
        text: x.disagreement
          ? x.disagreementText
          : "Circuit des visas : " + x.visas.length + "/3",
        status: x.disagreement ? "Désaccord" : "En cours",
      })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  return items.length
    ? `<div class="timeline">${items.map((x) => `<div class="timeline-item ${x.deposit ? "deposit" : ""}"><div class="timeline-date">${fmt(x.date)}</div><details><summary>${icon(x.deposit ? "upload" : x.title.includes("Demande") ? "download" : "calendar")} ${esc(x.title)} ${badge(x.status)}</summary><p>${esc(x.text)}</p></details></div>`).join("")}</div>`
    : empty(
        "Le parcours commence ici",
        "Les demandes, dépôts et visites apparaîtront dans cette chronologie.",
        "Voir les parcours",
        "home",
      );
}
function openDossier(id, t = "summary") {
  try {
    dossier(s, id);
    detailId = id;
    page = "dossier";
    tab = t;
    closeDialog();
    render();
    window.scrollTo(0, 0);
  } catch (e) {
    toast(e.message);
  }
}
function dossierPage() {
  let d;
  try {
    d = dossier(s, detailId);
  } catch (e) {
    return notice("Accès refusé", esc(e.message), "red");
  }
  const t = tab || "summary";
  let items = [["summary", "Chronologie & synthèse"]];
  if (can(role(), "cra", s)) items.push(["cra", "CRA"]);
  items.push(["visits", "Visites"]);
  if (can(role(), "crv", s)) items.push(["crv", "CRV"]);
  if (can(role(), "room", s)) items.push(["room", "Salon"]);
  if (can(role(), "reports", s)) items.push(["reports", "Signalements"]);
  return `${btn("Retour à mon espace", "home", "link small mb", "back")}${header(esc(d.name), `${esc(d.promo)} · ${esc(d.contract)} · Cycle ${d.cycle}`, `${badge(d.status)}`, "DOSSIER 360°")}${projectBanner(d)}${d.status.includes("Désaccord") ? notice("Action attendue · Désaccord CRV", "Les visas sont gelés. Le tuteur peut déléguer une rectification temporaire à l’entreprise.", "amber", "alert") : ""}${d.access === "En attente" && role() === "stages" ? `<div class="notice amber row between"><span>Accès entreprise en attente pour ${esc(d.mentorName)}</span>${btn("Créer l’accès", "access-create", "small", "plus", data("student", d.id))}</div>` : ""}<section class="panel">${tabs(items, t)}<div class="panel-body">${t === "summary" ? `<div class="row between wrap mb"><h2>Une chronologie, tout le parcours</h2><div class="row wrap">${role() === "tutor" ? btn("Demander un CRA", "request-form", "small", "plus", data("student", d.id) + ' data-type="CRA"') + btn("Demander une visite", "request-form", "small", "calendar", data("student", d.id) + ' data-type="Visite"') : role() === "student" ? btn("Déposer un CRA", "cra-form", "small primary", "plus", data("student", d.id)) : ""}</div></div>${pipeline(d.step)}${timeline(d)}` : t === "cra" ? craContent(d) : t === "visits" ? visitsContent(d) : t === "crv" ? crvContent(d) : t === "room" ? roomContent(d) : reportsContent(d)}</div></section>`;
}
function craContent(d) {
  if (!can(role(), "cra", s))
    return notice(
      "Accès interdit",
      "Les CRA académiques ne sont pas accessibles à ce rôle.",
      "red",
    );
  const list = crasFor(s).filter(
    (c) =>
      c.student === d.id && (role() === "student" || c.status !== "Brouillon"),
  );
  return `<div class="row between wrap mb"><div><h2>Comptes rendus d’activité</h2><p class="subtext">${role() === "company" ? "CRA envoyés en lecture seule ; les brouillons ne sont pas accessibles." : "Un bilan régulier des activités, difficultés et prochaines étapes."}</p></div>${role() === "student" ? btn("Déposer un CRA", "cra-form", "primary small", "plus", data("student", d.id)) : role() === "tutor" ? btn("Demander un CRA", "request-form", "small", "plus", data("student", d.id) + ' data-type="CRA"') : ""}</div>${list.map((c) => `<article class="panel mb"><div class="panel-head"><div><h3>CRA · ${esc(c.period)}</h3><span class="muted" style="font-size:10px">Déposé le ${fmt(c.date)} ${c.request ? "· Associé à une demande du tuteur" : "· Dépôt spontané"}</span></div>${badge(c.status)}</div><div class="panel-body"><div class="grid3"><div><h3>Activités réalisées</h3><p class="subtext">${esc(c.activities)}</p></div><div><h3>Difficultés</h3><p class="subtext">${esc(c.difficulties)}</p></div><div><h3>Prochaines étapes</h3><p class="subtext">${esc(c.next)}</p></div></div>${c.attachment ? `<p class="subtext">${icon("paperclip")} ${esc(c.attachment.name)} · Métadonnées conservées</p>` : ""}${c.feedback ? notice("Retour du tuteur", esc(c.feedback), "", "message") : ""}<div class="row mt">${role() === "tutor" ? btn("Lire & rendre une décision", "cra-review", "small primary", "check", data("student", d.id) + " " + data("id", c.id)) : role() === "student" && ["Brouillon", "À compléter"].includes(c.status) ? btn("Reprendre mon CRA", "cra-form", "small", "file", data("student", d.id) + " " + data("id", c.id)) : ""}</div></div></article>`).join("") || empty("Aucun CRA déposé", "Une demande ou un premier dépôt permettra de lancer le suivi.", "Retour au parcours", "home")}`;
}
function visitsContent(d) {
  const list = visitsFor(s).filter((v) => v.student === d.id);
  return `<div class="row between wrap mb"><div><h2>Visites & rendez-vous</h2><p class="subtext">Propositions, confirmations et historique du suivi.</p></div>${["student", "tutor", "company"].includes(role()) ? btn("Proposer des créneaux", "visit-form", "small primary", "plus", data("student", d.id)) : ""}</div>${list.map((v) => `<div class="panel mb"><div class="panel-body row between wrap"><div><h3>${icon("calendar")} ${fmt(v.date)} · ${esc(v.time)}</h3><p class="subtext">${esc(v.place)}${v.alternative ? " · Autre créneau : " + esc(v.alternative) : ""}</p><div class="mt">${badge(v.status)}</div></div><div class="row wrap">${btn("Calendrier .ics", "ics", "small", "download", data("id", v.id))}${role() === "tutor" && v.status === "Proposée" ? btn("Confirmer", "visit-confirm", "small primary", "check", data("id", v.id) + " " + data("student", d.id)) : role() === "tutor" && v.status === "Confirmée" ? btn("Marquer réalisée", "visit-done", "small", "check", data("id", v.id) + " " + data("student", d.id)) : ""}</div></div></div>`).join("") || empty("Aucune visite planifiée", "Proposez un rendez-vous pour organiser le suivi en entreprise.", "Voir mon agenda", "nav-agenda")}`;
}
function crvContent(d) {
  if (!can(role(), "crv", s))
    return notice(
      "Accès interdit",
      "Vous ne disposez pas du droit de lecture des CRV.",
      "red",
      "lock",
    );
  const c = crvsFor(s).find((x) => x.student === d.id);
  if (!c)
    return `<div class="row between mb"><h2>Compte rendu de visite</h2></div>${role() === "tutor" ? `<form data-form="crvSave" data-student="${d.id}"><div class="form-error" role="alert"></div>${richEditor("Contexte :\n\nMissions :\n\nCompétences :\n\nIntégration :\n\nAvis :")}${fileField()}<button class="primary mt" type="submit">Enregistrer le CRV</button></form>` : empty("Le CRV n’est pas encore rédigé", "Le tuteur universitaire rédigera le compte rendu à l’issue de la visite.", "Revenir au suivi", "home")}`;
  const next = ["tutor", "company", "student"][c.visas.length];
  return `<div class="row between wrap mb"><div><h2>Compte rendu de visite</h2><p class="subtext">Échéance du circuit : ${fmt(c.due)} · ${c.visas.length}/3 visas · ${c.disagreement ? "Circuit gelé" : next ? "Attendu : " + ROLES[next].short : "Circuit terminé"}</p></div>${badge(c.disagreement ? "Désaccord ouvert" : c.visas.length === 3 ? "Clôturé" : "En cours")}</div><div class="visa-grid">${[
    ["tutor", "1. Visa Tuteur"],
    ["company", "2. Visa Entreprise"],
    ["student", "3. Visa Étudiant"],
  ]
    .map(
      ([r, t]) =>
        `<div class="visa-step ${c.visas.includes(r) ? "done" : ""}"><strong>${c.visas.includes(r) ? "✓ " : ""}${t}</strong>${esc(name(r === "tutor" ? d.tutor : r === "company" ? d.mentor : d.user))}<div style="font-size:10px;margin-top:4px">${c.visas.includes(r) ? "Visa apposé" : c.disagreement ? "Suspendu" : next === r ? "Votre visa est attendu" : "En attente de l’étape précédente"}</div></div>`,
    )
    .join(
      "",
    )}</div>${c.disagreement ? notice("Désaccord · Les visas sont gelés", esc(c.disagreementText), "amber", "alert") : ""}${c.delegated ? notice("Délégation temporaire active", "Seul le maître de stage peut enregistrer une rectification. Le droit sera refermé automatiquement et les visas réinitialisés à 0/3.", "amber") : ""}<div class="crv-text">${c.html ? safeRich(c.html) : esc(c.text)}</div>${c.attachment ? `<p class="subtext">${icon("paperclip")} ${esc(c.attachment.name)} · Métadonnées de la pièce jointe</p>` : ""}${c.amendments.map((a) => `<div class="notice mt">${icon("message")}<div><strong>Amendement de ${esc(name(a.author))}</strong><p>${esc(a.text)}</p></div></div>`).join("")}<div class="row wrap mt mb">${["tutor", "company"].includes(role()) && can(role(), "crv", s, "write") && !c.disagreement ? btn(role() === "tutor" ? "Reprendre le texte du CRV" : "Modifier le texte du CRV", "crv-edit", "", "file", data("student", d.id) + " " + data("id", c.id)) : ""}${!c.disagreement && next === role() ? btn("Apposer mon visa", "visa-confirm", "primary", "check", data("student", d.id)) : ""}${["company", "student"].includes(role()) && !c.disagreement ? btn("Signaler un désaccord", "disagree-form", "", "alert", data("student", d.id)) : ""}${role() === "stages" && c.disagreement ? btn("Adresser une consigne d’arbitrage", "arbitrate-form", "primary", "shield", data("student", d.id)) : ""}${role() === "company" ? btn("Ajouter un amendement", "amend-form", "", "plus", data("student", d.id)) : ""}${role() === "tutor" && c.disagreement ? btn(c.delegated ? "Révoquer la délégation" : "Autoriser la modification temporaire au maître de stage", "delegate-confirm", c.delegated ? "" : "primary", "shield", data("student", d.id)) : ""}${role() === "company" && c.delegated ? btn("Rectifier le compte rendu", "rectify-form", "primary", "file", data("student", d.id)) : ""}</div>${(c.arbitrationNotes || []).map((n) => notice("Consigne du responsable stages", esc(n.text), "", "message")).join("")}${c.versions.map((v) => `<details class="panel mt"><summary class="panel-body">Version archivée · Comparaison Avant / Après · ${esc(name(v.author))}</summary><div class="compare panel-body"><div><h3>Avant</h3><pre>${esc(v.before)}</pre></div><div><h3>Après</h3><pre>${esc(v.after)}</pre></div></div></details>`).join("")}`;
}
function workPage() {
  const d = students()[0];
  return (
    header(
      "Mes comptes rendus",
      "De l’activité au bilan de visite, chaque étape reste lisible.",
    ) +
    (d
      ? `<section class="panel">${tabs(
          [
            ["cra", "Mes CRA"],
            ["crv", "Mon CRV"],
          ],
          tab || "cra",
        )}<div class="panel-body">${tab === "crv" ? crvContent(d) : craContent(d)}</div></section>`
      : empty(
          "Aucun dossier",
          "Votre compte n’est pas encore rattaché.",
          "Voir le guide",
          "demo",
        ))
  );
}
function missionsPage() {
  if (!can(role(), "missions", s)) return notice("Accès refusé");
  const list = s.missions.filter(
    (m) => role() === "stages" || m.tutor === user().id,
  );
  return (
    header(
      role() === "stages"
        ? "Missions & affectations"
        : "Mes missions proposées",
      "L’avis favorable du tuteur précède la décision finale du responsable stages.",
      role() === "stages"
        ? btn("Proposer une mission", "mission-form", "primary", "plus")
        : "",
    ) +
    (role() === "tutor" ? availability() : "") +
    `<div class="grid2">${
      list
        .map((m) => {
          const d =
            role() === "stages"
              ? students().find((x) => x.id === m.student)
              : s.students.find((x) => x.id === m.student);
          // Une proposition peut différer du dossier tant que l'affectation n'est pas décidée.
          const proposal = m.proposal || d;
          return `<article class="panel"><div class="panel-head"><div><h2>${esc(m.proposal?.title ?? m.title)}</h2><p class="subtext">${esc(d.name)} · ${esc(d.promo)}${m.cycle != null ? " · Cycle " + esc(m.cycle) : ""}</p></div>${badge(m.status)}</div><div class="panel-body"><h3>${esc(proposal.company || "Entreprise non renseignée")}</h3><p class="subtext">${icon("pin")} ${esc(proposal.address || "Adresse non renseignée")}${proposal.city ? " · " + esc(proposal.city) : ""}</p><p class="subtext">${esc(proposal.contract || "Contrat non renseigné")} · ${fmt(proposal.start)} → ${fmt(proposal.end)}</p><p class="mt">${esc(m.proposal?.description ?? m.description)}</p><p class="subtext">Tuteur proposé : ${esc(name(m.tutor))} · Charge : ${s.students.filter((x) => x.tutor === m.tutor).length}/${s.users.find((x) => x.id === m.tutor)?.capacity || 5}</p>${m.history.length ? `<details class="mt"><summary>Historique des décisions</summary>${m.history.map((x) => `<p class="subtext">${esc(x.decision)} · ${esc(x.reason)}</p>`).join("")}</details>` : ""}<div class="row wrap mt">${role() === "tutor" && m.status === "En attente" ? btn("Accepter", "mission-decision", "primary small", "check", data("id", m.id) + ' data-decision="Accepter"') + btn("Refuser", "mission-decision", "small danger", "x", data("id", m.id) + ' data-decision="Refuser"') + btn("Demander des précisions", "mission-decision", "small", "message", data("id", m.id) + ' data-decision="Précisions"') : role() === "stages" ? (m.status === "Avis favorable du tuteur" && can(role(), "missions", s, "validate") ? btn("Décider l’affectation", "mission-assign", "primary small", "check", data("id", m.id)) : "") + btn("Nouvelle proposition", "mission-form", "small", "plus", data("student", d.id)) : ""}</div></div></article>`;
        })
        .join("") ||
      empty(
        "Aucune proposition",
        "Les propositions de mission apparaîtront ici.",
        "Retour à mon espace",
        "home",
      )
    }</div>${role() === "stages" ? `<section class="mt">${workloadPanel()}</section>` : ""}`
  );
}
function reportsContent(d) {
  const list = reportsFor(s).filter((x) => !d || x.student === d.id);
  return `<div class="row between mb"><div><h2>Signalements confidentiels</h2><p class="subtext">Visibles uniquement par l’auteur, le responsable stages et les destinataires autorisés.</p></div>${["company", "student", "tutor"].includes(role()) ? btn("Déclarer un problème", "report-form", "small", "plus", data("student", d?.id || students()[0]?.id || "")) : ""}</div>${list.map((r) => `<article class="panel mb"><div class="panel-head"><div><h3>${esc(r.category)}</h3><p class="subtext">${esc(dname(r.student))} · ${fmt(r.date)} · ${esc(name(r.author))}</p></div>${badge(r.status)}</div><div class="panel-body"><p>${esc(r.text)}</p>${r.notes.map((n) => `<div class="notice mt">${icon("file")}<div><strong>${esc(name(n.author))}</strong><p>${esc(n.text)}</p></div></div>`).join("")}${r.shared.length ? `<p class="subtext">Transmis à : ${r.shared.map((x) => esc(name(x))).join(", ")}</p>` : ""}${role() === "stages" ? `<div class="row wrap mt">${btn("Prendre en charge", "report-take", "small", "check", data("id", r.id))}${btn("Ajouter une note", "report-note", "small", "plus", data("id", r.id))}${btn("Transférer", "report-transfer", "small", "arrow", data("id", r.id))}${btn("Qualifier en rupture", "report-rupture", "small danger", "alert", data("id", r.id))}${btn("Clôturer", "report-close", "small", "lock", data("id", r.id))}</div>` : ""}</div></article>`).join("") || empty("Aucun signalement à afficher", "Seuls les signalements que vous êtes autorisé à consulter apparaissent ici.", "Retour à l’accueil", "home")}`;
}
function reportsPage() {
  return (
    header(
      "Déclarer un problème",
      "Un espace confidentiel pour faire remonter une difficulté.",
    ) +
    panel(
      "Suivi des déclarations",
      `<div class="panel-body">${reportsContent()}</div>`,
    )
  );
}
function accessPage() {
  return (
    header(
      "Accès & signalements",
      "Accueillir les acteurs, accompagner les situations sensibles.",
    ) +
    `<section class="panel">${tabs(
      [
        [
          "access",
          'Accès entreprise <span class="badge">' +
            students().filter((x) => x.access === "En attente").length +
            "</span>",
        ],
        ["reports", "Signalements confidentiels"],
      ],
      tab || "access",
    )}<div class="panel-body">${
      tab === "reports"
        ? reportsContent()
        : students()
            .filter((x) => x.access === "En attente")
            .map(
              (d) =>
                `<div class="panel mb"><div class="panel-body row between wrap"><div><h3>${esc(d.mentorName)}</h3><p class="subtext">${esc(d.mentorEmail)} · ${esc(d.company)}</p><p class="subtext">Demande liée à ${esc(d.name)} · ${esc(d.promo)}</p></div>${btn("Valider & créer l’accès", "access-create", "primary small", "shield", data("student", d.id))}</div></div>`,
            )
            .join("") ||
          empty(
            "Aucune demande en attente",
            "Les demandes déclarées par les étudiants seront affichées ici.",
            "Voir la cohorte",
            "nav-cohort",
          )
    }</div></section>`
  );
}
// Un compte peut représenter plusieurs acteurs du même dossier : chaque
// couple compte/rôle est un destinataire distinct.
function roomRecipientTargets(d, state = s) {
  const all = [
    { user: d.user, role: "student" },
    { user: d.tutor, role: "tutor" },
    { user: d.mentor, role: "company" },
    ...state.users.filter((u) => u.active && u.roles.includes("stages"))
      .map((u) => ({ user: u.id, role: "stages" })),
  ];
  const seen = new Set();
  return all.filter((target) => {
    const account = state.users.find((u) => u.id === target.user && u.active && u.roles.includes(target.role));
    const key = JSON.stringify([target.user, target.role]);
    if (!account || target.user === state.session?.user || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function roomContent(d) {
  if (!can(role(), "room", s)) return notice("Accès interdit");
  const room = s.rooms.find((x) => x.student === d.id && x.cycle === d.cycle &&
    (!x.closed || role() === "stages" || x.actors?.includes(user().id)));
  const history = archivedRooms(s)
    .filter((x) => x.student === d.id && x.id !== room?.id)
    .map((old) => `<details class="panel mt"><summary class="panel-body">Historique archivé · Cycle ${old.cycle} · ${esc(old.reason || "Ancien cycle")}</summary><div class="panel-body">${old.messages.map((m) => `<p class="subtext"><strong>${esc(name(m.author))}</strong> · ${esc(m.text)}</p>`).join("")}</div></details>`)
    .join("");
  if (!room)
    return (
      notice(
        "Salon non encore ouvert",
        "L’ouverture est automatique lorsqu’un tuteur universitaire et un maître de stage actifs sont affectés.",
        "",
        "message",
      ) +
      btn("Préparer un e-mail externe", "external-email-form", "small", "mail") +
      (role() === "stages" && d.status.includes("Rupture")
        ? btn(
            "Ouvrir un nouveau cycle",
            "new-cycle",
            "",
            "plus",
            data("student", d.id),
          )
        : "") + history
    );
  const msgs = messages(s, room).filter((m) =>
    roomChannel === "general" ? !m.recipients.length : m.recipients.length,
  );
  return `<div class="row between wrap mb"><div><h2>${esc(d.company)} · Cycle ${room.cycle}</h2><p class="subtext">Acteurs autorisés : ${participants(
    s,
    d,
  )
    .map((x) => esc(name(x)) + " · " + esc(s.users.find((u) => u.id === x)?.email || "E-mail non renseigné"))
    .join(
      " · ",
    )}</p></div>${btn("Préparer un e-mail externe", "external-email-form", "small", "mail")}${role() === "stages" && !room.closed ? btn("Fermer le salon", "room-close", "small danger", "lock", data("student", d.id)) : ""}${role() === "stages" && room.closed && d.status.includes("Rupture") ? btn("Ouvrir un nouveau cycle", "new-cycle", "small", "plus", data("student", d.id)) : ""}</div>${room.closed ? notice("Salon fermé · Lecture seule", esc(room.reason), "amber", "lock") : ""}<div class="row mb">${btn("# général", "channel", roomChannel === "general" ? "small primary" : "small", "", data("channel", "general"))}${btn("Messages ciblés", "channel", roomChannel === "targeted" ? "small primary" : "small", "", data("channel", "targeted"))}</div><div class="chat-area">${msgs.map((m) => `<article class="chat-message ${m.author === user().id ? "mine" : ""}"><small><strong>${esc(name(m.author))}</strong> · ${esc(m.date)}${m.recipients.length ? " · À : " + (m.recipientTargets?.length ? m.recipientTargets.map((t) => esc(name(t.user)) + " (" + esc(s.users.find((u) => u.id === t.user)?.email || "E-mail non renseigné") + ") · " + esc(ROLES[t.role]?.short || t.role)) : m.recipients.map((x) => esc(name(x)) + " (" + esc(s.users.find((u) => u.id === x)?.email || "E-mail non renseigné") + ")")).join(", ") : ""}</small><div class="chat-bubble">${esc(m.text)}${m.attachment ? `<p class="subtext">${icon("paperclip")} ${esc(m.attachment.name)}</p>` : ""}</div></article>`).join("") || '<div class="empty"><h3>La conversation peut commencer</h3><p>Rédigez votre premier message ci-dessous.</p></div>'}</div>${
    !room.closed
      ? `<form class="mt" data-form="message" data-student="${d.id}" data-room="${room.id}"><div class="form-error" role="alert"></div>${
          roomChannel === "targeted"
            ? `<fieldset style="border:1px solid var(--border);border-radius:7px;margin:0 0 15px"><legend style="font-size:12px">Choisissez explicitement au moins un destinataire</legend>${roomRecipientTargets(d)
                .map(
                  (target) =>
                    `<label class="check-label"><input type="checkbox" name="recipientTargets" data-recipient-user="${esc(target.user)}" data-recipient-role="${esc(target.role)}" value="${esc(JSON.stringify(target))}">${esc(name(target.user))} · ${esc(s.users.find((u) => u.id === target.user)?.email || "E-mail non renseigné")} · ${esc(ROLES[target.role].short)}</label>`,
                )
                .join(
                  "",
                )}</fieldset>`
            : ""
        }${area("Votre message", "text", "", "Restez dans le cadre du suivi pédagogique et professionnel.")}${fileField()}<button class="primary mt" type="submit">${icon("message")} Envoyer le message</button></form>`
      : ""
  }${history}`;
}
function roomsPage() {
  const list = students().filter((d) =>
    s.rooms.some((x) => x.student === d.id),
  );
  const chosen = list.find((d) => d.id === filters.student) || list[0];
  return (
    header(
      role() === "student" ? "Mon salon de projet" : "Salons du projet",
      "Un lieu d’échange réservé aux acteurs de chaque dossier.",
    ) +
    `<section class="panel"><div class="filters">${filterSelect(
      "student",
      "Dossier",
      list.map((d) => [d.id, d.name]),
      "Choisir un dossier",
    )}</div><div class="panel-body">${chosen ? roomContent(chosen) : empty("Aucun salon ouvert", "Un salon s’ouvre dès que les deux encadrants actifs sont affectés.", "Retour à mon espace", "home") + btn("Préparer un e-mail externe", "external-email-form", "small", "mail")}</div></section>${archivedRooms(
      s,
    )
      .filter((x) => !list.some((d) => d.id === x.student))
      .map(
        (old) =>
          `<details class="panel mt"><summary class="panel-body">Archive en lecture seule · ${esc(old.summary?.name || old.id)} · Cycle ${old.cycle}</summary><div class="panel-body">${notice("Salon fermé", esc(old.reason), "amber", "lock")}${old.messages.map((m) => `<div class="chat-message"><small>${esc(name(m.author))}</small><div class="chat-bubble">${esc(m.text)}</div></div>`).join("") || '<p class="muted">Aucun message dans ce cycle.</p>'}</div></details>`,
      )
      .join("")}`
  );
}
function showVisitMonth(date) {
  const [year, month] = date.split("-").map(Number);
  const [baseYear, baseMonth] = TODAY.split("-").map(Number);
  calendarOffset = 12 * (year - baseYear) + month - baseMonth;
}
function calendarDate() {
  const [year, month] = TODAY.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + calendarOffset, 1));
}
function calendarTitle() {
  const text = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(calendarDate());
  return text.charAt(0).toLocaleUpperCase("fr-FR") + text.slice(1);
}
function calendarContent(list) {
  const date = calendarDate();
  const year = date.getUTCFullYear(), month = date.getUTCMonth();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const offset = (date.getUTCDay() + 6) % 7;
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
  const headings = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((x) => `<div class="cal-head">${x}</div>`).join("");
  const blanks = Array.from({ length: offset }, () => "<div></div>").join("");
  const dates = Array.from({ length: days }, (_, i) => {
    const day = prefix + String(i + 1).padStart(2, "0");
    const events = list.flatMap(v => {
      const slots = v.date === day ? [v] : [];
      if (v.status === "Proposée" && v.alternative?.startsWith(day + " "))
        slots.push({ ...v, time: v.alternative.slice(11) });
      return slots;
    });
    return `<div class="cal-day ${events.length ? "event" : ""}"><strong>${i + 1}</strong>${events.map((e) => `${esc(e.time)}<br>${esc(dname(e.student).split(" ")[0])}`).join("<br>")}</div>`;
  }).join("");
  return `<div class="panel-body"><div class="calendar" aria-label="Calendrier des visites · ${calendarTitle()}">${headings}${blanks}${dates}</div><p class="subtext">Les jours colorés correspondent à une visite proposée, confirmée ou réalisée. Le calendrier s’ouvre sur le mois du jeu de démonstration.</p></div>`;
}
function agendaPage() {
  const ids = students().map((d) => d.id),
    list = visitsFor(s).filter((v) => ids.includes(v.student));
  return (
    header(
      "Agenda des visites",
      "Organisez les échanges entre l’université, l’étudiant et l’entreprise.",
      students()[0]
        ? btn(
            "Proposer une visite",
            "visit-form",
            "primary",
            "plus",
            data("student", students()[0].id),
          )
        : "",
    ) +
    `<div class="grid2">${panel("Les prochains rendez-vous", `<div class="panel-body">${list.map((v) => `<div class="alert-row" id="visit-${esc(v.id)}" tabindex="-1"><span class="alert-icon">${icon("calendar")}</span><div class="alert-content"><h3>${fmt(v.date)} · ${esc(v.time)}</h3><p>${esc(dname(v.student))} · ${esc(v.place)}</p><div class="row wrap mt">${badge(v.status)}${btn(".ics", "ics", "small", "download", data("id", v.id))}${role() === "tutor" && v.status === "Proposée" ? btn("Confirmer", "visit-confirm", "small primary", "check", data("student", v.student) + " " + data("id", v.id)) : ""}</div></div></div>`).join("") || empty("Aucun rendez-vous", "Vos prochaines visites apparaîtront ici.", "Retour à l’accueil", "home")}</div>`)}${panel(
      calendarTitle(),
      calendarContent(list),
      `<div class="calendar-controls">${btn("", "calendar-prev", "small", "back", 'aria-label="Mois précédent"')}${btn("", "calendar-next", "small", "arrow", 'aria-label="Mois suivant"')}</div>`,
    )}</div>`
  );
}
function onboardingPage() {
  const d = students()[0];
  return (
    header(
      "Mon entreprise & mon encadrant",
      "Déclarez votre maître de stage pour ouvrir un suivi partagé.",
    ) +
    (d
      ? panel(
          "Demande d’accès entreprise",
          `<div class="panel-body">${notice("État de la demande : " + d.access, d.access === "Accès créé" ? "Votre maître de stage dispose maintenant d’un accès à son espace dédié." : "Vous pouvez modifier cette demande tant qu’elle n’a pas été traitée.", "", "building")}${d.access !== "Accès créé" ? `<form data-form="onboarding" data-student="${d.id}"><div class="form-error" role="alert"></div><div class="form-grid">${field("Entreprise", "company", d.company === "—" ? "" : d.company)}${field("Nom du maître de stage", "mentorName", d.mentorName || "")}${field("E-mail professionnel", "mentorEmail", d.mentorEmail || "", "email")}</div><button class="primary mt" type="submit">Transmettre la demande</button></form>` : `<dl class="detail-grid"><div><dt>Entreprise</dt><dd>${esc(d.company)}</dd></div><div><dt>Encadrant</dt><dd>${esc(name(d.mentor))}</dd></div></dl>`}</div>`,
        )
      : empty(
          "Dossier non rattaché",
          "Demandez un rattachement au responsable stages.",
          "Voir le guide",
          "demo",
        ))
  );
}
function formationHome() {
  const list = students(),
    total = list.length,
    placed = list.filter((x) => x.contract !== "Sans contrat").length,
    other = s.students.filter((d) => d.promo !== role().toUpperCase());
  return (
    header(
      "Pilotage de la formation " + role().toUpperCase(),
      "Une vision consolidée des parcours, sans accès aux pièces de suivi.",
      `${btn("Exporter CSV", "export-cohort", "", "download")}${btn("Synthèse PDF", "print", "", "file")}`,
      "RESPONSABLE DE FORMATION · " + role().toUpperCase(),
    ) +
    notice(
      "Confidentialité · Règle RG-10",
      "Vous accédez uniquement aux données récapitulatives de votre promotion. Aucun dossier 360°, CRA, CRV, document interne ni salon étudiant n’est accessible.",
    ) +
    `<div class="metric-grid mb">${metric("Effectif " + role().toUpperCase(), total, "Étudiants de votre promotion", "users")}${metric("Taux de placement", Math.round((placed / Math.max(1, total)) * 100) + " %", "Avec contrat / effectif de la promotion", "briefcase")}${metric("Apprentissage", list.filter((x) => x.contract === "Apprentissage").length, "Contrats d’apprentissage actifs", "building")}${metric("Sans contrat", total - placed, "À accompagner dans leur recherche", "alert")}</div>${total - placed > total * 0.2 ? notice("Seuil de vigilance dépassé", "Plus de 20 % de la promotion est sans contrat. Un point avec le responsable stages est recommandé.", "amber", "alert") : notice("Placement · Seuil de vigilance maîtrisé", "La part d’étudiants sans contrat est inférieure ou égale à 20 %.", "green", "check")}<div class="grid2">${panel(
      "Répartition des contrats",
      `<div class="panel-body">${[
        "Apprentissage",
        "Stage alterné",
        "Stage temps plein",
        "Contrat de professionnalisation",
        "Césure",
        "Sans contrat",
      ]
        .map((c) => {
          const n = list.filter((x) => x.contract === c).length;
          return `<div class="workload"><div class="workload-info"><div class="workload-head"><span>${c}</span><strong>${n} étudiant(s) · ${Math.round((n / Math.max(1, total)) * 100)} %</strong></div><div class="bar"><span style="width:${(n / Math.max(1, total)) * 100}%"></span></div></div></div>`;
        })
        .join(
          "",
        )}<p class="subtext">Légende : bleu = part de l’effectif. Formule : effectif du contrat ÷ effectif total × 100.</p></div>`,
    )}${panel("Repères comparatifs anonymisés", `<div class="panel-body"><h3>Autre promotion · ${role() === "m1" ? "M2" : "M1"}</h3><div class="metric-grid mt" style="grid-template-columns:1fr 1fr">${metric("Effectif agrégé", other.length, "Aucune identité accessible", "users")}${metric("Placement", Math.round((other.filter((x) => x.contract !== "Sans contrat").length / other.length) * 100) + " %", "Avec contrat / effectif", "briefcase")}</div><p class="subtext">Les indicateurs de l’autre promotion sont strictement anonymisés. Les calculs sont basés sur le jeu fictif local.</p></div>`)}</div><div class="grid3 mt">${metric("Visites réalisées", visitsFor(s).filter((v) => list.some((d) => d.id === v.student) && v.status === "Réalisée").length, "Nombre de visites réalisées dans votre promotion", "calendar")}${metric("Ruptures", list.filter((d) => d.status.includes("Rupture")).length, "Nombre agrégé de situations de rupture", "alert")}${metric("Charge moyenne tuteur", (list.filter((x) => x.tutor).length / Math.max(1, new Set(list.filter((x) => x.tutor).map((x) => x.tutor)).size)).toFixed(1), "Affectations / nombre de tuteurs distincts", "cap")}</div>`
  );
}
function transitionContent() {
  const list = students().filter((x) => x.promo === "M1");
  return `<div class="panel mt"><div class="panel-body">${notice(role() === "m1" ? "Proposer sans appliquer" : "Une décision, des conséquences explicites", role() === "m1" ? "Vos propositions sont transmises au responsable stages, seul habilité à appliquer la bascule." : "Le passage en M2 modifie le périmètre nominatif des responsables de formation. Les historiques sont conservés.", "amber", "refresh")}<form data-form="transition-preview"><div class="form-error" role="alert"></div><div class="grid2"><fieldset style="border:1px solid var(--border);border-radius:8px"><legend>Étudiants M1</legend>${list.map((d) => `<label class="check-label"><input type="checkbox" name="ids" value="${d.id}">${esc(d.name)} · ${esc(d.status)}</label>`).join("")}</fieldset><div>${select("Décision", "decision", ["Passer en M2", "Redoublement", "Sortie MIAGE"])}<p class="subtext mt">Un aperçu vous sera présenté avant toute transmission ou application.</p><button class="primary mt" type="submit">Prévisualiser la décision ${icon("arrow")}</button></div></div></form></div></div>${
    s.decisions.length
      ? panel(
          "Historique des décisions",
          `<div class="panel-body">${
            s.decisions
              .filter(
                (x) =>
                  students().some((d) => d.id === x.student) ||
                  role() === "stages" ||
                  (role() === "m1" && x.author === user().id),
              )
              .map(
                (x) =>
                  `<div class="activity"><div><h3>${esc(dname(x.student) === "Dossier hors périmètre" ? "Étudiant désormais hors du périmètre M1" : dname(x.student))} · ${esc(x.decision)}</h3><p class="subtext">${esc(name(x.author))} · ${x.date} ${badge(x.status)}</p></div></div>`,
              )
              .join("") ||
            '<p class="muted">Aucune décision dans le périmètre courant.</p>'
          }</div>`,
        )
      : ""
  }`;
}
function analysisPage() {
  const list = students(),
    contracts = list.filter((x) => x.contract !== "Sans contrat").length,
    visits = visitsFor(s).filter(
      (x) => list.some((d) => d.id === x.student) && x.status === "Réalisée",
    ).length,
    closed = crvsFor(s).filter(
      (x) => list.some((d) => d.id === x.student) && x.visas.length === 3,
    ).length;
  return (
    header(
      "Analyses & fin d’année",
      "Comparer les tendances et préparer les prochaines décisions.",
    ) +
    panel(
      "Évolution sur trois années universitaires",
      `<div class="table-wrap" tabindex="0" role="region" aria-label="Tableau de données"><table><thead><tr><th>Année</th><th>Effectif</th><th>Taux de placement</th><th>Visites réalisées</th><th>Source</th></tr></thead><tbody>${[
        ["2024–2025", 24, "88 %", "92 %", "Historique fictif"],
        ["2025–2026", 26, "92 %", "96 %", "Historique fictif"],
        [
          "2026–2027",
          list.length,
          Math.round((contracts / list.length) * 100) + " %",
          Math.round((visits / Math.max(1, contracts)) * 100) + " %",
          "Calcul sur les données locales",
        ],
      ]
        .map((row) => `<tr>${row.map((x) => `<td>${x}</td>`).join("")}</tr>`)
        .join(
          "",
        )}</tbody></table></div><div class="panel-body"><p class="subtext">Placement = étudiants avec contrat / effectif × 100. Visites = visites réalisées / contrats × 100. Les historiques servent uniquement à illustrer la comparaison.</p></div>`,
    ) +
    (role() === "m1"
      ? transitionContent()
      : `<section class="mt">${notice("Préparation du jury M2", "Indicateurs agrégés uniquement : aucune ouverture de pièce ou de dossier individuel.")}<div class="grid3">${metric("Visites réalisées", Math.round((visits / Math.max(1, contracts)) * 100) + " %", "Visites réalisées / contrats", "calendar")}${metric("CRV clôturés", Math.round((closed / Math.max(1, contracts)) * 100) + " %", "CRV à 3 visas / contrats", "shield")}${metric("Dossiers à finaliser", Math.max(0, contracts - closed), "Contrats sans circuit CRV complet", "file")}</div></section>`)
  );
}
const settingsSections = [
  ["users", "Utilisateurs", "users", "accounts"],
  ["create", "Créer un utilisateur", "plus", "accounts"],
  ["roles", "Gestion des rôles", "cap", "accounts"],
  ["permissions", "Permissions", "shield", "permissions"],
  ["system", "Paramètres système", "settings", "settings"],
];
function adminSettings() {
  const available = settingsSections.filter(([, , , fn]) => can(role(), fn, s));
  const section = available.find(([key]) => key === tab) || available[0];
  if (!section) return notice("Paramétrage indisponible", "Aucune rubrique accessible pour ce rôle.");
  const [key] = section;
  const links = available.map(([id, title, symbol]) => `<button data-action="setting-section" data-section="${id}" ${key === id ? 'aria-current="page"' : ""}>${icon(symbol)}<span>${title}</span>${icon("chevron")}</button>`).join("");
  const views = { users: accountsPage, create: () => accountEditor(), roles: rolesPage, permissions: permissionsPage, system: settingsPage };
  const detail = key === "users" && detailId ? accountEditor(detailId, filters.suggestedRole) : views[key]();
  return `<div class="config-layout"><aside class="config-rail"><div class="config-title">${icon("settings")}<h2>Paramétrage</h2></div><nav aria-label="Rubriques de paramétrage">${links}</nav></aside><section class="config-detail" aria-label="Détail du paramétrage">${detail}</section></div>`;
}
function rolesPage() {
  const selectedRole = filters.memberRole || "admin";
  const members = s.users.filter(u => u.roles.includes(selectedRole));
  const candidates = s.users.filter(u => !u.roles.includes(selectedRole));
  const assign = candidates.length && can(role(), "accounts", s, "configure")
    ? `<form data-form="assign-role" class="panel-body"><div class="form-error" role="alert"></div>
      ${select("Utilisateur", "account", [["", "Choisir un utilisateur"], ...candidates.map(u => [u.id, u.name + " · " + u.email])])}
      <button class="primary mt" type="submit">Attribuer ce rôle</button></form>` : "";
  return header("Gestion des rôles", "Sélectionnez un rôle pour consulter ses titulaires et modifier leurs habilitations.") +
    panel("Titulaires du rôle", `<div class="panel-body">${filterSelect("memberRole", "Rôle à consulter", Object.entries(ROLES).map(([key, r]) => [key, r.label]), "Administrateur par défaut")}
      <h3 class="mt">${esc(ROLES[selectedRole].label)} · ${members.length} titulaire(s)</h3>
      ${members.map(u => `<div class="role-member"><div class="person">${avatar(u.name)}<span><strong>${esc(u.name)}</strong><small>${esc(u.email)}</small></span></div>${btn("Modifier les rôles", "account-form", "small", "users", data("id", u.id))}</div>`).join("") || empty("Aucun titulaire", "Vous pouvez attribuer ce rôle depuis la fiche d’un utilisateur.")}</div>`) +
    (assign ? panel("Attribuer le rôle · " + ROLES[selectedRole].label, assign) : "");
}
function adminHome() {
  return (
    header(
      "Tableau de bord",
      "Suivi des accès, des imports et de l’activité administrative.",
      btn("Exporter les journaux", "export-audit", "", "download"),
      "ADMINISTRATION",
    ) +
    `<div class="metric-grid mb">${metric("Comptes actifs", s.users.filter((u) => u.active).length, s.users.filter((u) => !u.active).length + " compte(s) désactivé(s)", "users")}${metric("Changements de droits", s.audit.filter((x) => ["Changement de droits", "Compte"].includes(x.type)).length, "Événements de gouvernance tracés", "shield")}${metric("Connexions récentes", s.audit.filter((x) => x.type === "Connexion" && x.result === "Succès").length, "Connexions conservées dans ce jeu local", "lock")}${metric("Imports techniques", s.imports.length, s.imports.reduce((n, x) => n + x.rejected, 0) + " ligne(s) rejetée(s) · aucune identité étudiante", "upload")}</div><div class="dashboard-grid"><div>${panel("Derniers événements d’audit", can(role(), "audit", s) ? auditTable(s.audit.slice(0, 8)) : notice("Lecture du journal non autorisée", "Cette autorisation a été retirée de votre rôle.", "", "lock"), btn("Suivre les actions", "nav-target", "link small", "arrow", 'data-target="logs"'))}</div><aside class="stack">${panel("À examiner", `<div class="panel-body">${alertRow("Actions en échec", s.audit.filter(e => e.result === "Échec").length + " événement(s) dans le journal.", "Voir les échecs", "audit-failures", "", "alert")}${alertRow("Rejets à l’import", s.imports.reduce((total, entry) => total + entry.rejected, 0) + " ligne(s) rejetée(s) sur les imports enregistrés.", "Examiner les imports", "audit-imports", "", "upload")}</div>`)}</aside></div>`
  );
}
function accountsPage() {
  const list = s.users.filter(
    (u) =>
      (!filters.role || u.roles.includes(filters.role)) &&
      (!filters.active || (filters.active === "Actif") === u.active),
  );
  return (
    header(
      "Utilisateurs",
      "Consultez les comptes et leurs rôles dans l’établissement.",
      btn("Créer un compte", "account-form", "primary", "plus"),
    ) +
    `<section class="panel"><div class="filters">${filterSelect(
      "role",
      "Rôle",
      Object.entries(ROLES).map(([v, r]) => [v, r.short]),
      "Tous les rôles",
    )}${filterSelect("active", "Statut", ["Actif", "Désactivé"], "Tous les statuts")}${btn("Réinitialiser", "reset-filters", "quiet reset", "refresh")}</div>${list.length ? `<div class="table-wrap" tabindex="0" role="region" aria-label="Tableau de données"><table><thead><tr><th>Compte</th><th>Rôles</th><th>Statut</th><th>Dernière connexion</th><th>Gestion</th></tr></thead><tbody>${list.map((u) => `<tr class="clickable" data-action="account-form" data-id="${u.id}" tabindex="0"><td><div class="person">${avatar(u.name)}<span><strong>${esc(u.name)}</strong><small>${esc(u.email)}</small></span></div></td><td>${u.roles.map((r) => `<span class="badge">${ROLES[r].short}</span>`).join(" ")}</td><td>${badge(u.active ? "Actif" : "Désactivé")}</td><td>${esc(u.lastLogin)}</td><td>${btn("Modifier", "account-form", "small", "chevron", data("id", u.id))}</td></tr>`).join("")}</tbody></table></div>` : empty("Aucun compte correspondant", "Réinitialisez les filtres pour afficher tous les comptes.")}<div class="table-footer">${list.length} compte(s) · La désactivation ne supprime aucun historique.</div></section>`
  );
}
const MODES = {
  read: "Lecture",
  write: "Modification",
  validate: "Validation",
  configure: "Paramétrage",
};
function matrixVal(r, f, m) {
  const draft = permissionDraft || s.overrides;
  return (
    modeAllowed(r, f, m) &&
    draft?.[r]?.[m === "read" ? f : f + ":" + m] !== false
  );
}
function permissionsPage() {
  const mode = filters.mode || "all";
  let rs =
    mode === "compare"
      ? [filters.role1 || "stages", filters.role2 || "m1"]
      : filters.role1
        ? [filters.role1]
        : Object.keys(ROLES);
  rs = [...new Set(rs)];
  return (
    header(
      "Matrice des permissions",
      "Des droits lisibles. Des interdictions métier non négociables.",
      btn("Historique des changements", "permission-history", "", "log"),
    ) +
    notice(
      "Une règle métier ne se contourne pas",
      "Les cases verrouillées ne peuvent jamais être activées. L’administrateur reste exclu des dossiers métier ; RG-10 protège les CRA, CRV et salons des responsables de formation.",
      "",
      "lock",
    ) +
    `<section class="panel"><div class="filters">${filterSelect(
      "mode",
      "Affichage",
      [
        ["all", "Vue complète"],
        ["compare", "Comparer deux rôles"],
      ],
      "Choisir la vue",
    )}${filterSelect(
      "role1",
      "Premier rôle",
      Object.entries(ROLES).map(([v, x]) => [v, x.short]),
      "Tous les rôles",
    )}${
      mode === "compare"
        ? filterSelect(
            "role2",
            "Deuxième rôle",
            Object.entries(ROLES).map(([v, x]) => [v, x.short]),
            "Responsable M1",
          )
        : ""
    }${btn("Réinitialiser", "reset-filters", "quiet reset", "refresh")}</div><div class="table-wrap" tabindex="0" role="region" aria-label="Tableau de données"><table class="matrix"><thead><tr><th>Fonction / périmètre</th>${rs.map((r) => `<th style="min-width:180px">${ROLES[r].short}<div style="font-size:9px;margin-top:7px;font-weight:400">Lire · Modifier · Valider · Paramétrer</div></th>`).join("")}</tr></thead><tbody>${Object.entries(
      FUNCTIONS,
    )
      .filter(([f]) => f !== "messageAudit")
      .map(
        ([f, label]) =>
          `<tr><td><strong style="font-size:11px;font-weight:550">${label}</strong></td>${rs
            .map(
              (r) =>
                `<td><div class="row" style="justify-content:center;gap:12px">${Object.entries(
                  MODES,
                )
                  .map(([m, t]) =>
                    modeAllowed(r, f, m)
                      ? `<label title="${t} · ${label} · ${ROLES[r].short}"><input type="checkbox" data-permission="${r}|${f}|${m}" ${matrixVal(r, f, m) ? "checked" : ""} aria-label="${t} : ${label}, ${ROLES[r].short}"></label>`
                      : `<button class="lock-cell" data-action="locked" title="${!forbidden(r, f) ? "Cette opération n’appartient pas aux responsabilités du rôle." : ["m1", "m2"].includes(r) ? "RG-10 : accès aux dossiers et pièces de suivi interdit." : r === "admin" ? "Séparation des fonctions : accès métier interdit à l’administrateur." : "Hors des responsabilités autorisées pour ce rôle."}" aria-label="${t} verrouillée pour ${ROLES[r].short} : ${label}" aria-disabled="true">${icon("lock")}</button>`,
                  )
                  .join("")}</div></td>`,
            )
            .join("")}</tr>`,
      )
      .join(
        "",
      )}</tbody></table></div><div class="panel-body"><p class="subtext">Légende : cases cochées = autorisations ; cadenas = interdiction permanente. Les périmètres d’affectation et de promotion s’appliquent toujours, même lorsqu’une case est cochée.</p>${btn("Délégation du paramétrage métier", "setting-section", "link small", "settings", 'data-section="system"')}</div></section>${permissionDraft ? `<div class="change-bar"><span>${icon("shield")} Modifications non enregistrées</span><div class="row">${btn("Annuler", "discard-permissions", "small")}${btn("Enregistrer les permissions", "permissions-preview", "small", "check")}</div></div>` : ""}`
  );
}
function settingsPage() {
  const settings = [
    ["craDays", "Délai CRA (jours)"],
    ["crvDays", "Délai de visa CRV (jours)"],
    ["visitDays", "Délai visite (jours)"],
    ["reminderDays", "Délai de relance (jours)"],
    ["capacity", "Capacité tuteur par défaut"],
    ["maxMB", "Taille maximale des PJ (Mo)"],
    ["sessionMinutes", "Expiration de session (minutes)"],
  ];
  return (
    header(
      "Paramètres " + (role() === "admin" ? "système" : "métier"),
      "Une modification sensible est toujours expliquée, confirmée et historisée.",
    ) +
    panel(
      "Délais, capacités & limites",
      `<div class="panel-body"><form data-form="settings-preview"><div class="form-error" role="alert"></div><div class="form-grid">${settings
        .filter(
          ([k]) =>
            role() === "admin" || !["maxMB", "sessionMinutes"].includes(k),
        )
        .map(([k, t]) =>
          field(
            t,
            k,
            s.settings[k],
            "number",
            "Valeur actuelle : " + s.settings[k],
          ),
        )
        .join(
          "",
        )}</div>${role() === "admin" ? `<div class="form-section">Délégation encadrée</div><label class="check-label"><input type="checkbox" name="delegateBusiness" ${s.settings.delegateBusiness ? "checked" : ""}>Déléguer les délais et la capacité par défaut au responsable stages</label><p class="subtext">Les paramètres techniques et la matrice restent réservés à l’administrateur.</p>` : ""}<button class="primary mt" type="submit">Prévisualiser les changements ${icon("arrow")}</button></form></div>`,
    ) +
    panel(
      "Historique des paramètres",
      `<div class="panel-body">${
        s.history
          .filter((h) => h.type === "Paramètres")
          .map(
            (h) =>
              `<div class="activity"><div><h3>${esc(name(h.author))} · ${new Date(h.date).toLocaleString("fr-FR")}</h3><p class="subtext">Motif : ${esc(h.reason)}</p><details><summary>Ancien / Nouveau</summary><div class="compare"><pre>${esc(JSON.stringify(h.before, null, 2))}</pre><pre>${esc(JSON.stringify(h.after, null, 2))}</pre></div></details></div></div>`,
          )
          .join("") ||
        '<p class="muted">Aucune modification depuis la création de cette démonstration.</p>'
      }</div>`,
    )
  );
}
function auditTable(list) {
  return list.length
    ? `<div class="table-wrap" tabindex="0" role="region" aria-label="Tableau de données"><table><thead><tr><th>Date & heure</th><th>Événement</th><th>Auteur</th><th>Résultat</th><th>Détail</th></tr></thead><tbody>${list.map((a) => `<tr class="clickable" data-action="audit-detail" data-id="${a.id}" tabindex="0"><td>${esc(a.date)}</td><td>${esc(a.type)}</td><td>${esc(name(a.author))}</td><td>${badge(a.result)}</td><td>${icon("chevron")}</td></tr>`).join("")}</tbody></table></div>`
    : empty(
        "Aucun événement",
        "Ajustez les critères du journal pour élargir la période.",
      );
}
function actionDetail(e) {
  return `<section class="panel action-record" id="action-record" tabindex="-1"><div class="panel-head"><h2>Détail de l’action</h2>${btn("Fermer le détail", "close-audit", "small", "x")}</div><div class="panel-body">${`<dl class="detail-grid"><div><dt>Événement</dt><dd>${esc(e.type)}</dd></div><div><dt>Résultat</dt><dd>${badge(e.result)}</dd></div><div><dt>Auteur</dt><dd>${esc(name(e.author))}</dd></div><div><dt>Date</dt><dd>${esc(e.date)}</dd></div><div><dt>Compte / ressource</dt><dd>${esc(e.target)}</dd></div><div><dt>Identifiant d’audit</dt><dd>${esc(e.id)}</dd></div></dl><div class="notice mt"><p>${esc(e.detail)}</p></div>`}</div></section>`;
}
function logsPage() {
  const list = s.audit.filter(
    (x) =>
      (!filters.type || x.type === filters.type) &&
      (!filters.author || x.author === filters.author) &&
      (!filters.result || x.result === filters.result) &&
      (!filters.target || x.target === filters.target) &&
      inPeriod(x.date, filters.period),
  );
  return (
    header(
      "Suivi des actions",
      "Filtrez les événements puis sélectionnez une action pour consulter son détail.",
      btn("Exporter les journaux", "export-audit", "", "download"),
    ) +
    (tab !== "imports" && list.some(e => e.id === detailId) ? actionDetail(list.find(e => e.id === detailId)) : "") +
    `<section class="panel">${tabs(
      [
        ["logs", "Journal d’audit"],
        ["imports", "Historique technique des imports"],
      ],
      tab || "logs",
    )}${
      tab === "imports"
        ? importsHistory()
        : `<div class="filters">${filterSelect("period", "Période", ["Aujourd’hui", "7 derniers jours", "30 derniers jours"], "Tout l’historique")}${filterSelect(
            "type",
            "Type d’événement",
            s.audit.map((x) => x.type),
          )}${filterSelect(
            "author",
            "Auteur",
            s.users.map((u) => [u.id, u.name]),
          )}${filterSelect(
            "target",
            "Compte concerné",
            s.users.map((u) => [u.id, u.name]),
          )}${filterSelect("result", "Résultat", ["Succès", "Échec"])}${btn("Réinitialiser", "reset-filters", "quiet reset", "refresh")}</div>${auditTable(list)}`
    }</section>`
  );
}
function inPeriod(date, period) {
  if (!period) return true;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date));
  if (!match) return false;
  const today = new Date();
  const currentDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const eventDay = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const diff = (currentDay - eventDay) / 86400000;
  return period === "Aujourd’hui"
    ? diff === 0
    : diff >= 0 && diff < (period === "7 derniers jours" ? 7 : 30);
}
function importsHistory() {
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="Tableau de données"><table><thead><tr><th>Date</th><th>Auteur</th><th>Fichier</th><th>Créés</th><th>Modifiés</th><th>Rejetés</th><th>Motifs techniques</th></tr></thead><tbody>${s.imports.map((x) => `<tr><td>${esc(x.date)}</td><td>${esc(name(x.author))}</td><td>${esc(x.file)}</td><td>${x.created}</td><td>${x.updated}</td><td>${x.rejected}</td><td>${esc(x.reasons || "Aucun")}</td></tr>`).join("")}</tbody></table></div>`;
}
const exampleCSV =
  "nom;email;promotion;ville;statut\nAlice Caron;alice.caron@u-picardie.fr;M1;Amiens;\nLucie Bernard;lucie.bernard@u-picardie.fr;M1;Amiens;En conflit avec l’entreprise\nYanis Noël;yanis.noel@u-picardie.fr;M2;Lille;\nAlice Caron;alice.caron@u-picardie.fr;M1;Amiens;\nSarah Faure;sarah.sans-arobase;M1;Beauvais;\nNoé Lambert;noe.lambert@u-picardie.fr;L3;Amiens;";
function importsPage() {
  return (
    header(
      "Imports & exports",
      "Intégrez les données Mon Master en gardant la main sur chaque ligne.",
      btn("Exporter la cohorte CSV", "export-cohort", "", "download"),
    ) +
    `<section class="panel">${tabs(
      [
        ["wizard", "Assistant d’import"],
        ["history", "Historique des imports"],
      ],
      tab || "wizard",
    )}<div class="panel-body">${tab === "history" ? importsHistory() : `<div class="stepper">${["Dépôt des données", "Contrôle & aperçu", "Confirmation & import"].map((t, i) => `<div class="wizard-step ${importStep === i + 1 ? "active" : ""}"><strong>0${i + 1}</strong> · ${t}</div>`).join("")}</div>${importStep === 1 ? `<form data-form="import-preview"><div class="form-error" role="alert"></div><div class="upload-area">${icon("upload")}<h3>Vos données, prêtes à être vérifiées</h3><p>Déposez un CSV UTF-8 exporté depuis Excel ou collez son contenu.<br>Colonnes requises : nom, email, promotion. Colonnes facultatives : ville et statut. Une cellule vide conserve la valeur du dossier. Statuts acceptés : ${STUDENT_STATUSES.join(", ")}.</p><input type="file" id="csv-file" accept=".csv,text/csv" aria-label="Choisir un fichier CSV"><p>Les fichiers .xlsx doivent d’abord être exportés en CSV.</p>${btn("Utiliser le jeu d’exemple avec anomalies", "import-example", "small", "spark")}</div><div class="mt">${area("Données CSV (séparateur ; ou ,)", "csv", "", "Les guillemets CSV et les cellules contenant des séparateurs sont reconnus. Un enregistrement par ligne.")}</div><button type="submit" class="primary mt">Contrôler les données ${icon("arrow")}</button></form>` : importStep === 2 ? `${importSummary()}${importPreview()}<div class="row between wrap mt">${btn("Retour au dépôt", "import-back", "", "back")}${importData.some((x) => x.error) ? btn("Télécharger les rejets CSV", "import-rejects", "", "download") : ""}${btn("Continuer vers la confirmation", "import-next", "primary", "arrow")}</div>` : `${importSummary()}${notice("Seules les lignes valides seront importées", "Les lignes rejetées restent disponibles en CSV avec un motif précis. Aucun rejet ne bloque les autres lignes.", "amber", "alert")}<div class="row wrap">${btn("Télécharger les rejets CSV", "import-rejects", "", "download")}${btn("Modifier le fichier", "import-restart", "", "back")}</div><form class="mt" data-form="import-confirm"><div class="form-error" role="alert"></div><label class="check-label"><input type="checkbox" name="confirmed" required>Je confirme l’import de ${importData.filter((x) => !x.error).length} ligne(s) valide(s), en excluant les ${importData.filter((x) => x.error).length} rejet(s).</label><button type="submit" class="primary mt">${icon("check")} Importer les lignes valides</button></form>`}`}</div></section>`
  );
}
function importSummary() {
  return `<div class="metric-grid mb">${metric("Lignes analysées", importData.length, "Colonnes reconnues : nom, email, promotion", "file")}${metric("Créations", importData.filter((x) => !x.error && x.kind === "Création").length, "Nouveaux étudiants", "plus")}${metric("Mises à jour", importData.filter((x) => !x.error && x.kind === "Mise à jour").length, "Correspondance par e-mail", "refresh")}${metric("Rejets", importData.filter((x) => x.error).length, "Téléchargeables avec leur motif", "alert")}</div>`;
}
function importPreview() {
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="Tableau de données"><table><thead><tr><th>Ligne</th><th>Nom</th><th>E-mail</th><th>Promotion</th><th>Statut importé</th><th>Contrôle</th></tr></thead><tbody>${importData.map((x) => `<tr><td>${x.line}</td><td>${esc(x.nom)}</td><td>${esc(x.email)}</td><td>${esc(x.promotion)}</td><td>${esc(x.statut || (x.kind === "Création" ? "En recherche" : "Conservé"))}</td><td>${badge(x.error || x.kind)}</td></tr>`).join("")}</tbody></table></div>`;
}
let previousFocus = null,
  pendingUser = null,
  pendingPayload = null;
function openDialog(title, body, footer = "", drawer = false, wide = false) {
  previousFocus = document.activeElement;
  app.inert = true;
  overlay.innerHTML = `<div class="backdrop ${drawer ? "drawer-backdrop" : ""}"><section class="${drawer ? "drawer" : "modal"} ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabindex="-1"><div class="dialog-head"><h2 id="dialog-title">${title}</h2>${btn("", "close", "icon-btn quiet", "x", 'aria-label="Fermer"')}</div><div class="dialog-body">${body}</div>${footer ? `<div class="dialog-foot">${footer}</div>` : ""}</section></div>`;
  document.body.style.overflow = "hidden";
  setTimeout(
    () =>
      overlay
        .querySelector(
          "input:not([type=file]), select, textarea, button, [tabindex]",
        )
        ?.focus(),
    30,
  );
}
function closeDialog() {
  app.inert = false;
  overlay.innerHTML = "";
  document.body.style.overflow = "";
  dialog = null;
  if (previousFocus?.isConnected) previousFocus.focus();
}
function formDialog(
  title,
  form,
  body,
  payload = {},
  submit = "Enregistrer",
  drawer = false,
  wide = false,
) {
  dialog = { form, payload };
  openDialog(
    title,
    `<form id="dialog-form" data-form="${form}"><div class="form-error" role="alert"></div>${body}</form>`,
    `${btn("Annuler", "close")}<button type="submit" form="dialog-form" class="primary">${submit}</button>`,
    drawer,
    wide,
  );
  dialog = { form, payload };
}
function confirmDialog(
  title,
  text,
  action,
  payload = {},
  label = "Confirmer",
  extra = "",
) {
  formDialog(
    title,
    "confirm-action",
    notice(title, text, "amber", "alert") + extra,
    { action, payload },
    label,
  );
}
function showDemo() {
  openDialog(
    "Guide démo & changer de compte",
    `${notice("Environnement local · données fictives", "Changer de compte déconnecte la session courante. Il ne s’agit pas d’une usurpation d’identité administrateur.", "", "help")}<h3 class="mb">Choisir un compte de démonstration</h3>${s.users
      .filter((u) => u.active)
      .map(
        (u) =>
          `<button class="demo-account" data-action="demo-login" data-id="${u.id}">${avatar(u.name)}<span><strong>${esc(u.name)}</strong><small>${u.roles.map((r) => ROLES[r].short).join(" · ")}</small><small>${esc(u.email)}</small></span><span style="margin-left:auto">${icon("arrow")}</span></button>`,
      )
      .join(
        "",
      )}<div class="form-section">Parcours prêts à tester</div><div class="notice"><div><strong>Désaccord CRV · Nathan Robert (M2)</strong><p>Sophie → rôle Tuteur → Nathan → CRV → Autoriser la modification. Puis Marc → Nathan → rectifier. Revenir à Sophie pour le 1er visa, Marc pour le 2e et Nathan pour le 3e.</p></div></div><div class="notice"><div><strong>CRA & visites · Lucie Bernard (M1)</strong><p>Lucie dépose un brouillon puis l’envoie. Sophie, en rôle Tuteur, le valide. Avec l’autorisation de lecture CRA, Marc consulte les CRA envoyés en lecture seule, jamais les brouillons.</p></div></div><div class="notice"><div><strong>Gouvernance & RG-10</strong><p>Camille est isolée du métier. Thomas en Responsable M1 ne voit que les M1, en lecture seule. Son rôle Tuteur possède un périmètre différent.</p></div></div><div class="row wrap">${btn("E-mails simulés", "emails", "", "mail")}${btn("Réinitialiser la démonstration", "reset-form", "danger", "refresh")}</div><p class="subtext">Mot de passe commun : <strong>Miage2026!</strong><br>Les pièces jointes sont simulées par leurs métadonnées. La sécurité reste démonstrative : un navigateur local n’est pas une frontière de confiance.</p>`,
    "",
    true,
  );
}
function authenticate(uid) {
  const u = s.users.find((x) => x.id === uid && x.active);
  if (!u) return toast("Compte indisponible.");
  if (s.session)
    log(s, "Déconnexion", "Fin de session pour changement de compte.");
  s.session = null;
  pendingUser = uid;
  save();
  if (u.roles.length > 1) {
    render();
    chooseRole(u);
  } else finishLogin(uid, u.roles[0]);
}
function chooseRole(u) {
  openDialog(
    "Choisir mon rôle actif",
    `<p class="subtext mb">Connecté en tant que <strong>${esc(u.name)}</strong>. Un seul rôle est actif à la fois ; les données et les notifications seront cloisonnées.</p>${u.roles.map((r) => btn(`${icon(r === "tutor" ? "cap" : "shield")}<span><strong>${ROLES[r].label}</strong><small style="display:block;font-size:11px;font-weight:400">Ouvrir cet espace</small></span>`, "choose-role", "demo-account", "", data("role", r) + " " + data("user", u.id))).join("")}`,
  );
}
function finishLogin(uid, r) {
  const u = s.users.find((x) => x.id === uid && x.active);
  if (!u?.roles.includes(r)) return toast("Rôle non autorisé.");
  s.session = { user: uid, role: r, lastActivity: Date.now() };
  u.lastLogin = new Date().toLocaleString("sv-SE").slice(0, 16);
  log(
    s,
    "Connexion",
    "Session ouverte · rôle " + ROLES[r].short,
    "Succès",
    uid,
  );
  save();
  pendingUser = null;
  importData = null;
  importStep = 1;
  goto("home");
}
function showProfile() {
  const u = user();
  openDialog(
    "Mon profil & préférences",
    `<div class="person mb">${avatar(u.name)}<span><strong>${esc(u.name)}</strong><small>${esc(u.email)}</small></span></div><div class="form-section">Mon rôle actif</div>${u.roles.map((r) => btn(`${ROLES[r].label} ${r === role() ? "✓" : ""}`, "switch-role", "demo-account", "", 'data-role="' + r + '"')).join("")}<div class="form-section">Accessibilité & affichage</div>${btn(s.preferences.theme === "dark" ? "Passer en thème clair" : "Passer en thème sombre", "theme", "", "sun")}<label class="check-label mt"><input type="checkbox" id="reduce-motion" ${s.preferences.motion ? "checked" : ""}>Réduire les animations (en plus du réglage de votre appareil)</label>${role() === "tutor" ? '<div class="form-section">Disponibilité</div>' + availability() : ""}${role() === "stages" && s.settings.delegateBusiness ? btn("Paramètres métier délégués", "business-settings", "", "settings") : ""}<div class="form-section">Session</div><p class="subtext">Expiration après ${s.settings.sessionMinutes} minutes d’inactivité. L’application n’envoie aucune donnée ; les e-mails externes sont ouverts dans votre propre client de messagerie.</p><div class="row wrap mt">${btn("Changer de compte démo", "demo", "", "users")}${btn("Se déconnecter", "logout", "danger", "logout")}</div>`,
    "",
    true,
  );
}
function showPreview(uid) {
  let d;
  try {
    d = dossier(s, uid);
  } catch (e) {
    return toast(e.message);
  }
  openDialog(
    "Aperçu du parcours",
    `<div class="person mb">${avatar(d.name)}<div><h2>${esc(d.name)}</h2><p class="subtext">${esc(d.promo)} · ${esc(d.contract)}</p></div></div>${badge(d.status)}${pipeline(d.step)}<dl class="detail-grid"><div><dt>Entreprise</dt><dd>${esc(d.company)}</dd></div><div><dt>Ville</dt><dd>${esc(d.city)}</dd></div><div><dt>Tuteur universitaire</dt><dd>${esc(name(d.tutor))}</dd></div><div><dt>Maître de stage</dt><dd>${esc(d.mentor ? name(d.mentor) : d.mentorName || "À déclarer")}</dd></div><div><dt>E-mail étudiant</dt><dd>${esc(d.email)}</dd></div><div><dt>Prochaine action</dt><dd>${!d.tutor ? "Affecter un tuteur" : d.status.includes("Désaccord") ? "Résoudre le désaccord CRV" : "Poursuivre le suivi"}</dd></div></dl><div class="mt">${notice("Un parcours, une chronologie", "Le dossier 360° rassemble les échanges et pièces autorisés pour votre rôle.", "", "file")}</div>`,
    btn(
      "Ouvrir le dossier 360°",
      "open-dossier",
      "primary",
      "arrow",
      data("target", d.id),
    ),
    true,
  );
}
function accountEditor(uid, suggestedRole) {
  const u = s.users.find((x) => x.id === uid);
  return header(u ? "Modifier l’utilisateur" : "Créer un utilisateur", u ? esc(u.name) : "Renseignez son identité et attribuez ses rôles.") +
    `<section class="panel"><form class="panel-body" data-form="account-preview" ${uid ? data("account", uid) : ""}><div class="form-error" role="alert"></div>` +
    `<div class="form-section">Identité</div><div class="form-grid">${field("Nom complet", "name", u?.name || "")}${field("Adresse e-mail", "email", u?.email || "", "email")}${u ? `<div class="field"><span>Création</span><small>${u.created}</small></div><div class="field"><span>Dernière connexion</span><small>${u.lastLogin}</small></div>` : ""}</div><div class="form-section">Rôles attribués</div><p class="subtext">Cochez un ou plusieurs rôles pour cet utilisateur.</p>${Object.entries(
      ROLES,
    )
      .map(
        ([r, v]) =>
          `<label class="check-label"><input name="roles" type="checkbox" value="${r}" ${u?.roles.includes(r) || r === suggestedRole ? "checked" : ""}>${v.label}</label>`,
      )
      .join(
        "",
      )}<label class="check-label mt"><input name="active" type="checkbox" ${!u || u.active ? "checked" : ""}>Compte actif</label>${notice("Désactiver ne supprime pas", "La connexion sera bloquée ; les dossiers et les historiques restent conservés. Votre propre session et le dernier administrateur actif sont protégés.", "amber", "shield")}${area("Motif obligatoire de création ou de modification", "reason", "")}${field("Confirmation renforcée si nécessaire", "confirm", "", "text", "Saisir DÉSACTIVER pour une désactivation, ou ADMIN pour une nouvelle attribution du rôle administrateur.")}` +
    `<div class="row wrap mt">${btn("Retour aux utilisateurs", "setting-section", "", "back", 'data-section="users"')}<button class="primary" type="submit">Vérifier les habilitations</button></div></form></section>`;
}
function missionForm(studentId) {
  const ds = students(),
    st =
      ds.find((x) => x.id === studentId) ||
      ds.find((x) => !x.tutor && x.contract !== "Sans contrat") ||
      ds[0],
    tutors = s.users
      .filter((u) => u.active && u.roles.includes("tutor"))
      .sort(
        (a, b) =>
          Number(b.available) - Number(a.available) ||
          s.students.filter((x) => x.tutor === a.id).length / a.capacity -
            s.students.filter((x) => x.tutor === b.id).length / b.capacity,
      );
  formDialog(
    "Proposer une mission & un tuteur",
    "mission",
    `<div class="form-section">01 · Étudiant & entreprise</div><div class="form-grid">${select(
      "Étudiant",
      "student",
      ds.map((d) => [d.id, d.name + " · " + d.promo]),
      st?.id,
    )}${select("Type de contrat", "contract", ["Apprentissage", "Stage alterné", "Stage temps plein", "Contrat de professionnalisation", "Césure"], st?.contract)}${field("Entreprise", "company", st?.company === "—" ? "" : st?.company)}${field("Ville", "city", st?.city)}${field("Adresse exacte", "address", st?.address || "")}${field("Date de début", "start", st?.start || "", "date")}${field("Date de fin", "end", st?.end || "", "date")}</div><div class="form-section">02 · Mission & encadrement</div><div class="form-grid">${field("Intitulé de la mission", "title", "Développement d’une application métier")}${select(
      "Tuteur proposé · suggestions par disponibilité puis charge",
      "tutor",
      tutors.map((u) => [
        u.id,
        `${u.name} · ${s.students.filter((d) => d.tutor === u.id).length}/${u.capacity || 5} · ${u.available ? "Disponible" : "Indisponible"}`,
      ]),
      tutors[0]?.id,
    )}${area("Description détaillée", "description", "Concevoir et développer des fonctionnalités métier, participer aux tests et documenter les solutions.")}${fileField()}</div>${notice("Une proposition, pas une affectation immédiate", "Le tuteur rend d’abord un avis. En cas d’avis favorable, le responsable stages prend séparément la décision finale d’affectation.", "", "briefcase")}`,
    {},
    "Envoyer la proposition",
    false,
    true,
  );
}
function craForm(studentId, craId) {
  let d;
  try {
    d = dossier(s, studentId, "cra");
  } catch (e) {
    return toast(e.message);
  }
  const c = crasFor(s).find((x) => x.id === craId && x.student === d.id),
    requests = s.requests.filter((q) => q.student === d.id && q.type === "CRA");
  formDialog(
    c ? "Reprendre mon CRA" : "Déposer un CRA",
    "cra-submit",
    `<div class="form-grid">${field("Période du compte rendu", "period", c?.period || "Novembre 2026")}${select("Association à une demande", "request", [["", "CRA spontané"], ...requests.map((q) => [q.id, q.period + " · attendu le " + fmt(q.due)])], c?.request || requests[0]?.id || "")}${area("Activités réalisées", "activities", c?.activities || "")}${area("Difficultés rencontrées", "difficulties", c?.difficulties || "", "Si vous n’avez rencontré aucune difficulté, indiquez « Aucune ».")}${area("Prochaines étapes", "next", c?.next || "")}${fileField()}</div><label class="check-label"><input type="checkbox" name="linkConfirmed" ${c?.request ? "checked" : ""}>Je confirme l’association à la demande du tuteur sélectionnée ci-dessus (si applicable).</label><label class="field mt">Mode d’enregistrement<select name="mode" class="field-control"><option value="craDraft">Enregistrer en brouillon</option><option value="craSend">Envoyer au tuteur</option></select><small>Un brouillon n’est visible que dans votre espace.</small></label>`,
    { student: d.id, id: c?.id },
    "Enregistrer",
    false,
    true,
  );
}
function requestForm(d, type) {
  formDialog(
    "Demander " + (type === "CRA" ? "un CRA" : "une visite"),
    "request",
    `<div class="form-grid">${field("Période concernée", "period", "Novembre 2026")}${field("Date souhaitée", "due", "2026-11-30", "date")}${select(
      "Modèle réutilisable",
      "template",
      [
        ["bilan", "Bilan mensuel MIAGE"],
        ["sprint", "Bilan de sprint"],
        ["visit", "Préparation de visite"],
      ],
      "bilan",
    )}${area("Consigne au destinataire", "text", type === "CRA" ? "Présenter les activités réalisées, les difficultés et les prochaines étapes." : "Merci de proposer un ou deux créneaux pour une visite de suivi en entreprise.")}</div>`,
    { student: d, type },
    "Envoyer la demande",
  );
}
function visitForm(st) {
  const opts = students();
  formDialog(
    "Proposer une visite",
    "visit",
    `${notice("Un ou deux créneaux, au choix", "L’envoi ajoute la proposition à l’agenda et prévient les autres participants dans leur espace. Le tuteur confirme ensuite le créneau retenu.", "", "calendar")}<div class="form-grid">${select(
      "Étudiant concerné",
      "student",
      opts.map((d) => [d.id, d.name]),
      st || opts[0]?.id,
      true,
    )}${field("Premier créneau · date", "date", "2026-12-01", "date")}${field("Heure", "time", "10:00", "time")}${field("Second créneau · date (facultatif)", "date2", "", "date")}${field("Seconde heure (facultatif)", "time2", "", "time")}${field("Lieu ou visioconférence", "place", "Visioconférence", "text", "Adresse exacte si accueil sur site.", true)}</div>`,
    {},
    "Envoyer les créneaux",
  );
}
function reportForm(st) {
  formDialog(
    "Déclarer un problème confidentiel",
    "report",
    `${notice("Un échange confidentiel", "Ce signalement ne sera pas publié dans le salon. Seuls vous et le responsable stages y avez accès par défaut.", "", "shield")}<div class="form-grid">${select(
      "Dossier concerné",
      "student",
      students().map((d) => [d.id, d.name]),
      st,
      true,
    )}${select("Catégorie", "category", ["Difficulté de mission", "Risque de rupture", "Conditions de travail", "Difficulté pédagogique", "Autre"], undefined, true)}${area("Description de la situation", "text", "", "Décrivez les faits et l’accompagnement souhaité.")}${fileField()}</div>`,
    {},
    "Transmettre le signalement",
  );
}
function csvDownload(filename, headers, rows) {
  const cell = (x) => {
    let v = String(x ?? "");
    if (/^[\t\r\n]|^[\x00-\x20]*[=+@\-]/.test(v)) v = "'" + v;
    return '"' + v.replaceAll('"', '""') + '"';
  };
  download(
    filename,
    "\uFEFF" +
      [headers, ...rows].map((r) => r.map(cell).join(";")).join("\r\n"),
    "text/csv;charset=utf-8",
  );
}
function download(filename, body, type = "text/plain") {
  const blob = new Blob([body], { type }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Fichier préparé : " + filename);
}
function exportCohort(onlySelected = false) {
  const list = filteredStudents().filter(
    (d) => !onlySelected || selected.has(d.id),
  );
  if (!list.length) return toast("Sélectionnez au moins une ligne à exporter.");
  csvDownload(
    "cohorte-miage-" +
      (role() === "m1" ? "M1" : role() === "m2" ? "M2" : "2026-2027") +
      ".csv",
    ["Nom", "Promotion", "Contrat", "Entreprise", "Ville", "Tuteur", "Statut"],
    list.map((d) => [
      d.name,
      d.promo,
      d.contract,
      d.company,
      d.city,
      name(d.tutor),
      d.status,
    ]),
  );
  log(s, "Export", "Export récapitulatif du périmètre autorisé.");
  save();
}
function exportIcs(vid) {
  const v = visitsFor(s).find(
    (x) => x.id === vid && students().some((d) => d.id === x.student),
  );
  if (!v) return toast("Visite hors périmètre.");
  const clean = (x) =>
    String(x)
      .replaceAll("\\", "\\\\")
      .replaceAll(";", "\\;")
      .replaceAll(",", "\\,")
      .replace(/\r\n|\r|\n/g, "\\n");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.time))
    return toast("Date ou heure de visite invalide ; export impossible.");
  const start = v.date.replaceAll("-", "") + "T" + v.time.replace(":", "") + "00";
  // Add one wall-clock hour, including the transition to the next calendar day.
  const [year, month, day] = v.date.split("-").map(Number);
  const [hour, minute] = v.time.split(":").map(Number);
  const endDate = new Date(Date.UTC(year, month - 1, day, hour + 1, minute));
  const end = endDate.toISOString().replace(/[-:]/g, "").slice(0, 15);
  download(
    "visite-miage.ics",
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//UPJV//Suivi MIAGE//FR",
      "BEGIN:VTIMEZONE",
      "TZID:Europe/Paris",
      "BEGIN:DAYLIGHT",
      "DTSTART:19960331T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
      "TZOFFSETFROM:+0100",
      "TZOFFSETTO:+0200",
      "TZNAME:CEST",
      "END:DAYLIGHT",
      "BEGIN:STANDARD",
      "DTSTART:19961027T030000",
      "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
      "TZOFFSETFROM:+0200",
      "TZOFFSETTO:+0100",
      "TZNAME:CET",
      "END:STANDARD",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:" + v.id + "@miage.local",
      "DTSTAMP:" + new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"),
      "DTSTART;TZID=Europe/Paris:" + start,
      "DTEND;TZID=Europe/Paris:" + end,
      "SUMMARY:" + clean("Visite MIAGE · " + dname(v.student)),
      "LOCATION:" + clean(v.place),
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n"),
    "text/calendar;charset=utf-8",
  );
}
async function handleAction(a, el) {
  const p = el.dataset,
    student = p.student || p.target;
  try {
    if (externalConflict && !["close", "menu", "reload-external"].includes(a))
      return toast("Copiez votre saisie puis rechargez les données de l’autre onglet.");
    switch (a) {
      case "reload-external":
        window.location.reload();
        break;
      case "nav":
        goto(p.page);
        break;
      case "nav-target":
        goto(p.target);
        break;
      case "home":
        goto("home");
        break;
      case "nav-cohort":
        goto("cohort");
        break;
      case "nav-agenda":
        goto("agenda");
        break;
      case "close":
        closeDialog();
        break;
      case "calendar-prev":
      case "calendar-next":
        calendarOffset += a === "calendar-next" ? 1 : -1;
        render();
        document.querySelector(`[data-action="${a}"]`)?.focus();
        break;
      case "menu": {
        const bar = document.querySelector(".sidebar");
        bar?.classList.toggle("open");
        el.setAttribute("aria-expanded", bar?.classList.contains("open"));
        break;
      }
      case "tab":
        tab = p.tab;
        selected.clear();
        render();
        break;
      case "reset-filters":
        filters = {};
        selected.clear();
        render();
        break;
      case "priority":
        if (p.target === "assign") {
          goto("cohort");
          filters.alert = "Sans tuteur";
          render();
        } else {
          goto("access");
          tab = p.target === "reports" ? "reports" : "access";
          render();
        }
        break;
      case "demo":
        showDemo();
        break;
      case "demo-login":
        authenticate(p.id);
        break;
      case "choose-role":
        if (p.user !== pendingUser)
          return toast("Reconnectez-vous pour sélectionner un rôle.");
        finishLogin(p.user, p.role);
        break;
      case "profile":
        showProfile();
        break;
      case "switch-role": {
        const u = user();
        if (!u.roles.includes(p.role)) throw Error("Rôle non autorisé.");
        s.session.role = p.role;
        s.session.lastActivity = Date.now();
        save();
        importData = null;
        importStep = 1;
        goto("home");
        toast("Rôle actif : " + ROLES[p.role].short);
        break;
      }
      case "logout":
        log(s, "Déconnexion", "Fin de session explicite.");
        s.session = null;
        save();
        closeDialog();
        render();
        break;
      case "theme":
        s.preferences.theme = s.preferences.theme === "dark" ? "light" : "dark";
        save();
        render();
        if (overlay.innerHTML && document.querySelector("#reduce-motion"))
          showProfile();
        break;
      case "login-help":
        openDialog(
          "Aide à la connexion",
          notice(
            "Tous les comptes sont fictifs",
            "Mot de passe : Miage2026! · Utilisez le guide pour choisir un compte. Un compte désactivé ne peut pas se connecter. Aucun e-mail réel n’est envoyé.",
            "",
            "help",
          ),
          btn("Ouvrir le guide", "demo", "primary", "users"),
        );
        break;
      case "notifications":
        openDialog(
          "Mes notifications",
          `${notice("Un périmètre compte + rôle", "Seules les notifications de votre rôle actif apparaissent ici.")}<div>${
            notices(s)
              .map(
                (n) =>
                  `<article class="notification ${!n.read ? "unread" : ""}"><p>${esc(n.text)}</p><div class="row wrap mt">${n.visitId && visitsFor(s).some(v => v.id === n.visitId) ? btn("Voir dans l’agenda", "notice-visit", "small", "calendar", data("id", n.id)) : ""}${n.read ? badge("Lu") : btn("Marquer comme lue", "notice-read", "small", "check", data("id", n.id))}</div></article>`,
              )
              .join("") ||
            empty(
              "Vous êtes à jour",
              "Les prochaines notifications de ce rôle apparaîtront ici.",
              "Retour à mon espace",
              "home",
            )
          }</div>`,
          btn("Tout marquer comme lu", "notice-all", "", "check"),
          true,
        );
        break;
      case "notice-visit": {
        const n = notices(s).find(item => item.id === p.id);
        const visit = n && visitsFor(s).find(v => v.id === n.visitId);
        if (!visit) throw Error("Cette visite n’est plus accessible.");
        n.read = true;
        save();
        showVisitMonth(visit.date);
        goto("agenda");
        document.getElementById("visit-" + visit.id)?.focus();
        break;
      }
      case "notice-read": {
        const n = notices(s).find((x) => x.id === p.id);
        if (n) n.read = true;
        save();
        render();
        handleAction("notifications", el);
        break;
      }
      case "notice-all":
        notices(s).forEach((x) => (x.read = true));
        save();
        closeDialog();
        render();
        toast("Notifications du rôle marquées comme lues.");
        break;
      case "emails":
        openDialog(
          "E-mails envoyés · simulation",
          `${notice("Aucun e-mail réel envoyé", "Journal de démonstration des notifications externes. Le contenu est limité aux destinataires autorisés de votre périmètre.", "", "mail")}${
            s.emails
              .filter(
                (e) =>
                  s.session && (role() === "stages" || e.to === user()?.email),
              )
              .map(
                (e) =>
                  `<article class="notification"><h3>${esc(e.to)}</h3><p>${esc(e.text)}</p><small class="muted">${esc(e.date)}</small></article>`,
              )
              .join("") ||
            '<p class="muted">Aucun e-mail simulé dans ce périmètre.</p>'
          }`,
          "",
          true,
        );
        break;
      case "preview":
        showPreview(p.id);
        break;
      case "open-dossier":
        openDossier(student);
        break;
      case "open-crv":
        openDossier(student, "crv");
        break;
      case "tutor-cra": {
        const d =
          students().find((d) =>
            crasFor(s).some((c) => c.student === d.id && c.status === "À lire"),
          ) || students()[0];
        if (d) openDossier(d.id, "cra");
        else toast("Aucun CRA à lire.");
        break;
      }
      case "tutor-crv": {
        const d =
          students().find((d) =>
            crvsFor(s).some((c) => c.student === d.id && c.visas.length < 3),
          ) || students()[0];
        if (d) openDossier(d.id, "crv");
        else toast("Aucun compte rendu en attente.");
        break;
      }
      case "cra-form":
        craForm(student, p.id);
        break;
      case "cra-review":
        formDialog(
          "Lire & décider · CRA",
          "craReview",
          `${select("Décision explicite", "status", ["Lu", "Validé", "À compléter"], "Validé")}${area("Retour à l’étudiant", "feedback", "", "Obligatoire si vous demandez un complément.")}`,
          { student, id: p.id },
          "Transmettre la décision",
        );
        break;
      case "request-form":
        requestForm(student, p.type);
        break;
      case "visit-form":
        visitForm(student);
        break;
      case "visit-confirm": {
        const visit = visitsFor(s).find((v) => v.id === p.id && v.student === student);
        if (!visit) throw Error("Visite introuvable.");
        const alternative = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(visit.alternative || "");
        confirmDialog(
          "Confirmer la visite",
          "Les acteurs du dossier seront notifiés, y compris l’entreprise par e-mail simulé.",
          "visitConfirm",
          { student, id: p.id },
          "Confirmer",
          alternative ? select("Créneau à confirmer", "slot", [["first", `${fmt(visit.date)} · ${visit.time}`], ["second", `${fmt(alternative[1])} · ${alternative[2]}`]], "first", true) : "",
        );
        break;
      }
      case "visit-done":
        confirmDialog(
          "Marquer la visite réalisée",
          "Cette étape met à jour les indicateurs de suivi.",
          "visitConfirm",
          { student, id: p.id, done: true },
        );
        break;
      case "ics":
        exportIcs(p.id);
        break;
      case "editor-bold":
      case "editor-italic":
      case "editor-list":
      case "editor-command":
        formatSelection(el, el.dataset.command);
        break;
      case "crv-edit": {
        const d = dossier(s, student, "crv"),
          c = crvsFor(s).find((x) => x.student === d.id && x.id === p.id);
        if (!["tutor", "company"].includes(role()) || !can(role(), "crv", s, "write") || !c || c.disagreement)
          throw Error("Modification de ce compte rendu non autorisée.");
        formDialog(
          "Modifier le texte du CRV",
          "crvSave",
          notice("Historique et visas", "Une modification du texte conserve les versions et réinitialise les visas de l’ancienne version : chaque personne doit viser la nouvelle version.", "amber", "shield") + richEditor(c.text, c.html) + fileField(),
          { student: d.id, id: c.id },
          "Enregistrer le texte",
          false,
          true,
        );
        break;
      }
      case "visa-confirm":
        confirmDialog(
          "Apposer mon visa",
          "Je confirme avoir relu cette version du compte rendu. La prochaine étape sera notifiée et tracée.",
          "visa",
          { student },
          "Confirmer mon visa",
        );
        break;
      case "disagree-form":
        formDialog(
          "Signaler un désaccord CRV",
          "disagree",
          notice(
            "Les visas seront gelés",
            "Le responsable stages sera prévenu. Le texte initial reste conservé.",
            "amber",
            "alert",
          ) + area("Motif du désaccord", "reason", ""),
          { student },
          "Signaler le désaccord",
        );
        break;
      case "delegate-confirm": {
        const c = crvsFor(s).find((x) => x.student === student);
        confirmDialog(
          c?.delegated
            ? "Révoquer la délégation"
            : "Autoriser une rectification temporaire",
          "La version originale sera archivée. Après la rectification, le droit d’édition sera fermé automatiquement et les visas réinitialisés à 0/3.",
          "delegate",
          { student },
        );
        break;
      }
      case "rectify-form": {
        dossier(s, student, "crv");
        const c = crvsFor(s).find((x) => x.student === student);
        formDialog(
          "Rectifier le CRV · délégation temporaire",
          "rectify",
          `${notice("Version originale conservée", "L’enregistrement ferme votre droit d’édition, lève le désaccord et remet les visas à zéro.", "amber")}<details class="mb"><summary>Version initiale du tuteur</summary><pre>${esc(c.text)}</pre></details>${richEditor(c.text, c.html)}`,
          { student },
          "Enregistrer la rectification",
          false,
          true,
        );
        break;
      }
      case "arbitrate-form":
        formDialog(
          "Consigne d’arbitrage du CRV",
          "crvArbitrate",
          notice(
            "Le circuit reste gelé jusqu’à la rectification",
            "Votre consigne est transmise au tuteur et conservée dans le compte rendu. La délégation reste de sa responsabilité.",
            "amber",
          ) + area("Consigne de résolution", "text", ""),
          { student },
          "Transmettre la consigne",
        );
        break;
      case "amend-form":
        formDialog(
          "Ajouter un amendement",
          "amend",
          notice(
            "Le texte original reste inchangé",
            "Cet amendement est ajouté au compte rendu, sans en remplacer le contenu.",
          ) + area("Votre amendement", "text", ""),
          { student },
          "Ajouter l’amendement",
        );
        break;
      case "mission-form":
        missionForm(p.student);
        break;
      case "mission-decision":
        formDialog(
          p.decision === "Accepter"
            ? "Donner un avis favorable"
            : p.decision === "Refuser"
              ? "Refuser la mission"
              : "Demander des précisions",
          "missionDecision",
          p.decision === "Accepter"
            ? notice(
                "Un avis favorable, pas une affectation",
                "Votre réponse transmet un avis favorable. Le responsable stages prend ensuite la décision finale d’affectation.",
                "amber",
                "briefcase",
              )
            : area(
                p.decision === "Refuser"
                  ? "Motif obligatoire de refus"
                  : "Précisions demandées",
                "reason",
                "",
              ),
          { id: p.id, decision: p.decision },
          p.decision === "Accepter" ? "Transmettre mon avis favorable" : "Transmettre",
        );
        break;
      case "mission-assign":
        if (role() !== "stages" || !can(role(), "missions", s, "validate"))
          throw Error("Décision finale réservée au responsable stages autorisé.");
        if (!s.missions.some((m) => m.id === p.id && m.status === "Avis favorable du tuteur"))
          throw Error("Cette mission n’attend pas de décision finale.");
        confirmDialog(
          "Décider l’affectation",
          "Vous prenez la décision finale d’affecter ce tuteur à la mission après son avis favorable.",
          "missionAssign",
          { id: p.id },
          "Confirmer l’affectation",
        );
        break;
      case "access-create": {
        const d = dossier(s, student);
        formDialog(
          "Créer l’accès entreprise",
          "access",
          notice("Dossier de " + esc(d.name), "Vérifiez les coordonnées du contact. Une invitation est simulée après validation.") +
            `<div class="form-grid">${field("Entreprise", "company", d.company === "—" ? "" : d.company)}${field("Nom complet du contact", "mentorName", d.mentorName || "")}${field("E-mail professionnel", "mentorEmail", d.mentorEmail || "", "email")}</div>`,
          { student }, "Valider & créer l’accès",
        );
        break;
      }
      case "report-form":
        reportForm(p.student);
        break;
      case "report-take":
        confirmDialog(
          "Prendre en charge le signalement",
          "Le suivi sera mis à jour et conservé.",
          "reportAction",
          { id: p.id, kind: "take" },
        );
        break;
      case "report-close":
        confirmDialog(
          "Clôturer le signalement",
          "Le signalement reste conservé dans l’historique confidentiel.",
          "reportAction",
          { id: p.id, kind: "close" },
        );
        break;
      case "report-rupture":
        confirmDialog(
          "Qualifier la situation en rupture",
          "Cette action met à jour le statut du dossier. Le salon n’est jamais fermé automatiquement : sa fermeture exige une action distincte avec motif.",
          "reportAction",
          { id: p.id, kind: "rupture" },
        );
        break;
      case "report-note":
        formDialog(
          "Ajouter une note confidentielle",
          "reportAction",
          area("Note de suivi", "text", ""),
          { id: p.id, kind: "note" },
          "Ajouter la note",
        );
        break;
      case "report-transfer": {
        const report = reportsFor(s).find((x) => x.id === p.id);
        if (!report) throw Error("Signalement hors périmètre.");
        const d = dossier(s, report.student);
        formDialog(
          "Transférer à une personne autorisée",
          "reportAction",
          notice(
            "Le transfert accorde une lecture confidentielle",
            "Seuls les acteurs affectés à ce dossier peuvent être sélectionnés.",
            "amber",
          ) +
            select(
              "Destinataire",
              "user",
              participants(s, d)
                .filter((x) => x !== user().id)
                .map((x) => [x, name(x)]),
            ),
          { id: p.id, kind: "transfer" },
          "Confirmer le transfert",
        );
        break;
      }
      case "room-close":
        formDialog(
          "Fermer manuellement le salon",
          "roomClose",
          notice(
            "Le salon passera en lecture seule",
            "Les messages sont conservés. Aucun nouvel envoi ne sera possible dans ce cycle.",
            "amber",
            "lock",
          ) + area("Motif obligatoire de fermeture", "reason", ""),
          { student },
          "Fermer le salon",
        );
        break;
      case "new-cycle":
        formDialog(
          "Ouvrir un nouveau cycle de contrat",
          "newCycle",
          notice(
            "Un nouveau départ, un historique conservé",
            "L’ancien contrat est archivé. Les encadrants sont désaffectés ; un nouveau salon sera ouvert après leur nouvelle affectation.",
            "amber",
            "refresh",
          ) + area("Motif du nouveau cycle", "reason", ""),
          { student },
          "Créer le cycle suivant",
        );
        break;
      case "external-email-form":
        if (!can(role(), "room", s)) throw Error("Accès aux échanges non autorisé.");
        formDialog(
          "Préparer un e-mail externe",
          "external-email",
          notice("Aucun envoi depuis l’application", "Un lien ouvrira votre client de messagerie externe ; vous déciderez de l’envoi. Une adresse externe ne donne aucun accès au salon.", "", "mail") +
            '<label class="field">Adresse e-mail du destinataire<input type="email" name="email" autocomplete="email" required></label>' +
            field("Objet (facultatif)", "subject", "") +
            area("Message (facultatif)", "body", "", "Ne saisissez que les informations que vous souhaitez partager à l’extérieur."),
          {},
          "Préparer le lien",
        );
        break;
      case "channel":
        roomChannel = p.channel;
        render();
        break;
      case "bulk-info":
        if (!selected.size) throw Error("Sélectionnez au moins un étudiant.");
        formDialog(
          "Informer la sélection",
          "bulkInfo",
          area(
            "Information à transmettre à " + selected.size + " étudiant(s)",
            "text",
            "",
          ),
          { ids: [...selected] },
          "Envoyer l’information",
        );
        break;
      case "bulk-status":
        if (!selected.size) throw Error("Sélectionnez au moins un étudiant.");
        formDialog(
          "Changer le statut de la sélection",
          "bulkStatus",
          notice(
            "Confirmation de groupe",
            "Le changement concerne " +
              selected.size +
              " étudiant(s). Les historiques sont conservés.",
            "amber",
          ) +
            select("Nouveau statut", "status", [
              "En cours",
              "En recherche",
              "Clôturé",
            ]),
          { ids: [...selected] },
          "Confirmer le changement",
        );
        break;
      case "export-home":
        exportCohort();
        break;
      case "export-cohort":
        exportCohort();
        break;
      case "export-selected":
        exportCohort(true);
        break;
      case "print":
        log(s, "Export", "Impression PDF du récapitulatif autorisé.");
        save();
        window.print();
        break;
      case "setting-section":
      case "account-form": {
        const section = a === "account-form" ? (p.id ? "users" : "create") : p.section || p.target;
        const match = settingsSections.find(([key]) => key === section);
        if (role() !== "admin" || !match || !can(role(), match[3], s)) throw Error("Accès refusé.");
        page = "settings";
        tab = section;
        filters = {};
        detailId = a === "account-form" ? p.id : null;
        permissionDraft = null;
        closeDialog();
        render();
        const heading = document.querySelector(".config-detail h1");
        heading?.setAttribute("tabindex", "-1");
        heading?.focus();
        break;
      }
      case "locked":
        toast(el.title || "Droit verrouillé par une règle métier.");
        break;
      case "discard-permissions":
        permissionDraft = null;
        render();
        toast("Modifications annulées.");
        break;
      case "permissions-preview": {
        if (!permissionDraft) break;
        const changes = [];
        for (const [r, fs] of Object.entries(permissionDraft))
          for (const [f, val] of Object.entries(fs))
            if ((s.overrides[r]?.[f] !== false) !== val) {
              const [fn, m = "read"] = f.split(":");
              changes.push(
                `<tr><td>${ROLES[r].short}</td><td>${FUNCTIONS[fn]} · ${MODES[m]}</td><td>${val ? "Non → Oui" : "Oui → Non"}</td></tr>`,
              );
            }
        formDialog(
          "Aperçu des permissions · Avant / Après",
          "permissions",
          `${changes.length ? `<div class="table-wrap mb"><table><thead><tr><th>Rôle</th><th>Autorisation</th><th>Avant → Après</th></tr></thead><tbody>${changes.join("")}</tbody></table></div>` : notice("Aucun changement effectif", "Les valeurs sont identiques à celles actuellement enregistrées.")}${area("Motif obligatoire du changement", "reason", "")}`,
          { changes: structuredClone(permissionDraft) },
          "Confirmer les permissions",
          false,
          true,
        );
        break;
      }
      case "permission-history":
        openDialog(
          "Historique des permissions",
          s.history
            .filter((h) => h.type === "Permissions")
            .map(
              (h) =>
                `<div class="notice"><div><strong>${esc(name(h.author))} · ${new Date(h.date).toLocaleString("fr-FR")}</strong><p>${esc(h.reason)}</p><details><summary>Avant / Après</summary><div class="compare"><pre>${esc(JSON.stringify(h.before, null, 2))}</pre><pre>${esc(JSON.stringify(h.after, null, 2))}</pre></div></details></div></div>`,
            )
            .join("") ||
            notice(
              "Aucun changement enregistré",
              "Toute future sauvegarde apparaîtra ici avec son motif et son auteur.",
            ),
        );
        break;
      case "business-settings":
        if (role() !== "stages" || !can("stages", "settings", s))
          throw Error("Paramétrage non délégué.");
        page = "settings";
        closeDialog();
        render();
        break;
      case "audit-failures":
      case "audit-imports":
        if (role() !== "admin" || !can(role(), "audit", s)) throw Error("Accès refusé.");
        goto("logs");
        if (a === "audit-imports") tab = "imports";
        else filters.result = "Échec";
        render();
        break;
      case "close-audit":
        detailId = null;
        render();
        break;
      case "audit-detail": {
        if (role() !== "admin") throw Error("Accès refusé.");
        const e = s.audit.find((x) => x.id === p.id);
        if (!e || !can(role(), "audit", s)) throw Error("Événement inaccessible.");
        if (page !== "logs") goto("logs");
        detailId = e.id;
        render();
        document.getElementById("action-record")?.focus();
        break;
      }
      case "export-audit":
        if (role() !== "admin")
          throw Error("Export réservé à l’administrateur.");
        csvDownload(
          "journal-audit-miage.csv",
          [
            "Date",
            "Type",
            "Auteur",
            "Compte / ressource",
            "Résultat",
            "Détail",
          ],
          s.audit.map((x) => [
            x.date,
            x.type,
            name(x.author),
            x.target,
            x.result,
            x.detail,
          ]),
        );
        log(s, "Export", "Export du journal technique.");
        save();
        break;
      case "import-example":
        document.querySelector("textarea[name=csv]").value = exampleCSV;
        importName = "mon-master-demo.csv";
        toast("Exemple chargé : 6 lignes, dont 3 anomalies.");
        break;
      case "import-next":
        if (!importData?.some((x) => !x.error))
          throw Error(
            "Aucune ligne valide : revenez au dépôt et corrigez le fichier.",
          );
        importStep = 3;
        render();
        break;
      case "import-back":
      case "import-restart":
        importStep = 1;
        render();
        break;
      case "import-rejects":
        if (!importData) throw Error("Analysez d’abord un fichier.");
        csvDownload(
          "lignes-rejetees.csv",
          ["Ligne", "Nom", "Email", "Promotion", "Ville", "Motif"],
          importData
            .filter((x) => x.error)
            .map((x) => [x.line, x.nom, x.email, x.promotion, x.ville, x.error]),
        );
        break;
      case "reset-form":
        formDialog(
          "Réinitialiser la démonstration",
          "reset",
          notice(
            "Toutes les modifications locales seront supprimées",
            "Comptes créés, messages, décisions, notifications et préférences seront remplacés par le jeu fictif initial. Cette opération est irréversible.",
            "red",
            "alert",
          ) + field("Saisir RÉINITIALISER pour confirmer", "confirmation", ""),
          {},
          "Réinitialiser maintenant",
        );
        break;
      default:
        toast("Cette action n’est pas disponible.");
    }
  } catch (e) {
    toast(e.message);
  }
}
app.addEventListener("click", (e) => {
  if (e.target.closest("input,select,textarea,label")) return;
  const el = e.target.closest("[data-action]");
  if (el) handleAction(el.dataset.action, el);
});
overlay.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (el) handleAction(el.dataset.action, el);
  else if (e.target === overlay.querySelector(".backdrop")) closeDialog();
});
async function handleSubmit(e) {
  const form = e.target.closest("form[data-form]");
  if (!form) return;
  e.preventDefault();
  if (externalConflict) {
    const error = form.querySelector(".form-error");
    if (error) error.textContent = "Données modifiées dans un autre onglet. Copiez votre saisie puis rechargez avant d’enregistrer.";
    else toast("Copiez votre saisie puis rechargez avant d’enregistrer.");
    return;
  }
  const f = new FormData(form),
    p = Object.fromEntries(f.entries()),
    kind = form.dataset.form,
    context = dialog?.payload || {};
  if (form.dataset.student) p.student = form.dataset.student;
  const err = form.querySelector(".form-error");
  if (err) err.textContent = "";
  try {
    const editor = form.querySelector(".rich-content");
    if (editor) {
      p.text = editor.innerText;
      p.html = safeRich(editor.innerHTML);
    }
    if (f.get("attachment")?.size)
      p.attachment = attachment(f.get("attachment"), s);
    else delete p.attachment;
    switch (kind) {
      case "login": {
        const u = s.users.find(
          (x) => x.email.toLowerCase() === p.email.trim().toLowerCase(),
        );
        if (!u || p.password !== "Miage2026!" || !u.active) {
          log(
            s,
            "Connexion",
            "Tentative de connexion refusée.",
            "Échec",
            u?.id || "inconnu",
          );
          save();
          throw Error(
            "E-mail ou mot de passe incorrect, ou compte désactivé. Pour la démo : Miage2026!",
          );
        }
        authenticate(u.id);
        break;
      }
      case "confirm-action":
        act(context.action, context.action === "visitConfirm"
          ? { ...context.payload, slot: p.slot || "first" }
          : context.payload);
        break;
      case "availability":
        act(
          "availability",
          { capacity: p.capacity, available: f.has("available") },
          "Disponibilité et capacité enregistrées.",
        );
        break;
      case "assign-role": {
        if (role() !== "admin" || !can(role(), "accounts", s, "configure"))
          throw Error("Attribution non autorisée.");
        if (!s.users.some(u => u.id === p.account)) throw Error("Choisissez un utilisateur.");
        const suggestedRole = filters.memberRole || "admin";
        tab = "users";
        detailId = p.account;
        filters = { suggestedRole };
        render();
        document.querySelector('[name="roles"]:checked')?.focus();
        break;
      }
      case "account-preview": {
        p.id = form.dataset.account;
        p.roles = f.getAll("roles");
        p.active = f.has("active");
        pendingPayload = p;
        const old = s.users.find((x) => x.id === p.id);
        formDialog(
          "Confirmer les habilitations",
          "account-commit",
          `<div class="compare mb"><div><h3>Avant</h3><p class="subtext">${old ? esc(old.name) + "<br>" + old.roles.map((r) => ROLES[r].short).join(", ") + "<br>" + (old.active ? "Actif" : "Désactivé") : "Nouveau compte"}</p></div><div><h3>Après</h3><p class="subtext">${esc(p.name)}<br>${p.roles.map((r) => ROLES[r]?.short).join(", ")}<br>${p.active ? "Actif" : "Désactivé"}</p></div></div>${notice("Motif enregistré", esc(p.reason || "Aucun motif renseigné. Un motif est obligatoire."), "amber")}`,
          { account: p },
          "Confirmer l’enregistrement",
        );
        break;
      }
      case "account-commit":
        if (
          act(
            "account",
            context.account,
            "Compte et habilitations enregistrés.",
          )
        )
          {
            pendingPayload = null;
            tab = "users";
            detailId = null;
            render();
          }
        break;
      case "settings-preview": {
        p.delegateBusiness = f.has("delegateBusiness");
        const changes = Object.keys(p).filter(
          (k) => k in s.settings && String(p[k]) !== String(s.settings[k]),
        );
        formDialog(
          "Confirmer les paramètres",
          "settings",
          `<div class="table-wrap mb"><table><thead><tr><th>Paramètre</th><th>Ancien</th><th>Nouveau</th></tr></thead><tbody>${changes.map((k) => `<tr><td>${esc(k)}</td><td>${esc(s.settings[k])}</td><td>${esc(p[k])}</td></tr>`).join("") || '<tr><td colspan="3">Aucune modification.</td></tr>'}</tbody></table></div>${area("Motif obligatoire", "reason", "")}`,
          { settings: p },
          "Appliquer les paramètres",
        );
        break;
      }
      case "settings":
        act("settings", {
          ...s.settings,
          ...context.settings,
          reason: p.reason,
        });
        break;
      case "permissions":
        if (
          act(
            "permissions",
            { changes: context.changes, reason: p.reason },
            "Permissions enregistrées avec motif.",
          )
        ) {
          permissionDraft = null;
          render();
        }
        break;
      case "mission":
        act("mission", p, "Proposition de mission envoyée au tuteur.");
        break;
      case "missionDecision":
        act("missionDecision", { ...context, ...p });
        break;
      case "cra-submit":
        act(
          p.mode,
          { ...context, ...p, linkConfirmed: f.has("linkConfirmed") },
          p.mode === "craDraft"
            ? "Brouillon enregistré. Il reste dans votre espace."
            : "CRA envoyé au tuteur universitaire.",
        );
        break;
      case "craReview":
        act("craReview", { ...context, ...p });
        break;
      case "request":
        act("request", { ...context, ...p });
        break;
      case "visit": {
        if (!act("visit", p)) break;
        const visit = s.visits[0];
        showVisitMonth(visit.date);
        goto("agenda");
        const recipients = s.notifications.filter(n => n.visitId === visit.id);
        const names = recipients.map(n => name(n.user));
        toast("Visite proposée. " + (names.length ? "Notification envoyée à " + names.join(" et ") + "." : "Aucun autre compte affecté à prévenir."));
        break;
      }
      case "crvSave":
        act("crvSave", { ...context, ...p });
        break;
      case "rectify":
        act(
          "rectify",
          { ...context, ...p },
          "Rectification enregistrée. Délégation fermée, visas réinitialisés à 0/3.",
        );
        break;
      case "disagree":
      case "amend":
      case "crvArbitrate":
      case "roomClose":
      case "newCycle":
      case "reportAction":
        act(kind, { ...context, ...p });
        break;
      case "access":
        act("access", { ...p, ...context }, "Accès entreprise créé ou rattaché.");
        break;
      case "onboarding":
        act("onboarding", p, "Demande transmise au responsable stages.");
        break;
      case "report":
        act("report", p, "Signalement confidentiel transmis.");
        break;
      case "external-email": {
        if (!can(role(), "room", s)) throw Error("Accès aux échanges non autorisé.");
        const address = String(p.email || "").trim();
        if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(address) || !form.elements.email.validity.valid)
          throw Error("Saisissez une seule adresse e-mail valide.");
        const uri = "mailto:" + encodeURIComponent(address) +
          "?subject=" + encodeURIComponent(p.subject || "") +
          "&body=" + encodeURIComponent(p.body || "");
        openDialog(
          "E-mail externe prêt",
          notice("Aucun envoi depuis l’application", "Le lien ouvre votre client de messagerie. L’envoi reste sous votre contrôle et ne donne aucun accès au salon.", "", "mail") +
            `<p class="subtext">Destinataire : ${esc(address)}</p><a class="primary" href="${esc(uri)}">Ouvrir mon client de messagerie</a>`,
        );
        break;
      }
      case "message": {
        const recipientTargets = f.getAll("recipientTargets").map((value) => JSON.parse(value));
        if (roomChannel === "targeted" && !recipientTargets.length)
          throw Error("Sélectionnez au moins un destinataire explicite.");
        const d = dossier(s, p.student, "room");
        const validTargets = roomRecipientTargets(d);
        if (recipientTargets.some((t) => !validTargets.some((v) => v.user === t.user && v.role === t.role)))
          throw Error("Un destinataire ou son rôle est hors du salon.");
        const recipients = [...new Set(recipientTargets.map((t) => t.user))];
        delete p.recipientTargets;
        act(
          "message",
          { ...p, room: form.dataset.room, recipients, recipientTargets },
          "Message envoyé aux acteurs autorisés.",
        );
        break;
      }
      case "bulkInfo":
        act("bulkInfo", { ...context, text: p.text });
        break;
      case "bulkStatus":
        if (act("bulkStatus", { ...context, status: p.status })) {
          selected.clear();
          render();
        }
        break;
      case "transition-preview": {
        const ids = f.getAll("ids");
        if (!ids.length) throw Error("Cochez au moins un étudiant M1.");
        formDialog(
          "Aperçu de la décision de bascule",
          "transition",
          `<div class="notice amber"><div><strong>${esc(p.decision)} · ${ids.length} étudiant(s)</strong><p>${ids.map((x) => esc(dname(x))).join(", ")}</p><p>${role() === "m1" ? "La proposition sera transmise au responsable stages. Aucune promotion ne sera modifiée." : "Les promotions seront mises à jour si le passage en M2 est choisi. Les responsables M1 perdront immédiatement leur visibilité nominative sur ces étudiants ; le responsable M2 la recevra."}</p></div></div>`,
          { ids, decision: p.decision },
          role() === "m1"
            ? "Transmettre la proposition"
            : "Appliquer la décision",
        );
        break;
      }
      case "transition":
        act("transition", context);
        break;
      case "import-preview": {
        if (role() !== "stages" || !can("stages", "imports", s))
          throw Error("Import réservé au responsable stages.");
        let text = p.csv;
        const file = document.querySelector("#csv-file")?.files[0];
        if (file) {
          if (!/\.csv$/i.test(file.name))
            throw Error(
              "Exportez votre fichier Excel en CSV avant de l’importer.",
            );
          if (file.size > 5 * 1024 * 1024)
            throw Error("Le fichier CSV doit faire moins de 5 Mo.");
          text = await file.text();
          importName = file.name;
        }
        if (!text?.trim())
          throw Error(
            "Déposez un CSV, collez des données ou utilisez le jeu d’exemple.",
          );
        importData = parseCSV(text, s);
        if (!importData.length)
          throw Error(
            "Le fichier doit contenir au moins une ligne de données.",
          );
        importStep = 2;
        render();
        break;
      }
      case "import-confirm": {
        if (!f.has("confirmed"))
          throw Error("Confirmez explicitement l’import des lignes valides.");
        const counts = importRows(s, importData, importName);
        save();
        tab = "history";
        render();
        toast(
          `${counts.created} création(s), ${counts.updated} mise(s) à jour, ${counts.rejected} rejet(s).`,
        );
        break;
      }
      case "reset":
        if (p.confirmation !== "RÉINITIALISER")
          throw Error("Saisissez exactement RÉINITIALISER, avec les accents.");
        try {
          localStorage.removeItem(KEY);
          storageIssue = null;
        } catch {
          storageIssue = "unavailable";
        }
        s = seed();
        permissionDraft = null;
        importData = null;
        importStep = 1;
        filters = {};
        selected.clear();
        closeDialog();
        render();
        toast("Jeu de démonstration restauré.");
        break;
      default:
        throw Error("Formulaire non pris en charge.");
    }
  } catch (error) {
    if (err) {
      err.textContent = error.message;
      err.tabIndex = -1;
      err.focus();
    } else toast(error.message);
  }
}
document.addEventListener("submit", handleSubmit);
document.addEventListener("change", (e) => {
  const el = e.target;
  if (externalConflict) return;
  if (el.dataset.filter) {
    const key = el.dataset.filter;
    filters[key] = el.value;
    selected.clear();
    render();
    document.querySelector(`[data-filter="${CSS.escape(key)}"]`)?.focus();
  }
  if (el.dataset.select) {
    el.checked
      ? selected.add(el.dataset.select)
      : selected.delete(el.dataset.select);
    const checked = [...selected];
    render();
    document
      .querySelector(`[data-select="${CSS.escape(el.dataset.select)}"]`)
      ?.focus();
  }
  if (el.hasAttribute("data-select-all")) {
    filteredStudents().forEach((d) =>
      el.checked ? selected.add(d.id) : selected.delete(d.id),
    );
    render();
  }
  if (el.dataset.permission) {
    const [r, f, m] = el.dataset.permission.split("|");
    if (!modeAllowed(r, f, m)) return toast("Droit verrouillé.");
    permissionDraft ??= structuredClone(s.overrides);
    permissionDraft[r] ??= {};
    permissionDraft[r][m === "read" ? f : f + ":" + m] = el.checked;
    const key = el.dataset.permission;
    render();
    document.querySelector(`[data-permission="${CSS.escape(key)}"]`)?.focus();
  }
  if (el.id === "reduce-motion") {
    s.preferences.motion = el.checked;
    save();
    document.documentElement.classList.toggle("no-motion", el.checked);
  }
  if (el.name === "template") {
    const t = document.querySelector("textarea[name=text]");
    if (t)
      t.value = {
        bilan:
          "Présenter les activités réalisées, les difficultés et les prochaines étapes.",
        sprint:
          "Présenter le bilan du sprint, les livrables et les points de blocage.",
        visit:
          "Merci de préparer les missions, compétences acquises et questions pour la visite.",
      }[el.value];
  }
  if (
    el.name === "student" &&
    document.querySelector("form[data-form=mission]")
  ) {
    const d = students().find((d) => d.id === el.value),
      form = el.closest("form");
    if (d)
      for (const key of [
        "company",
        "city",
        "address",
        "start",
        "end",
        "contract",
      ])
        if (form.elements[key])
          form.elements[key].value = d[key] === "—" ? "" : d[key] || "";
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (overlay.innerHTML) closeDialog();
    const sidebar = document.querySelector(".sidebar");
    const wasOpen = sidebar?.classList.contains("open");
    sidebar?.classList.remove("open");
    const menu = document.querySelector(".mobile-menu");
    menu?.setAttribute("aria-expanded", "false");
    if (wasOpen) menu?.focus();
  }
  if (e.key === "Tab" && overlay.innerHTML) {
    const root = overlay.querySelector("[role=dialog]"),
      items = [
        ...root.querySelectorAll(
          'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
        ),
      ].filter((el) => el.offsetParent !== null),
      first = items[0],
      last = items.at(-1);
    if (
      e.shiftKey &&
      (document.activeElement === first || document.activeElement === root)
    ) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }
  if (
    e.target.getAttribute("role") === "tab" &&
    ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
  ) {
    e.preventDefault();
    const items = [...e.target.parentNode.children],
      i = items.indexOf(e.target),
      next =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? items.length - 1
            : (i + (e.key === "ArrowRight" ? 1 : -1) + items.length) %
              items.length;
    const tabId = items[next].dataset.tab;
    handleAction("tab", items[next]);
    document.querySelector(`[role=tab][data-tab="${tabId}"]`)?.focus();
  }
  if (e.key === "Enter" && e.target.matches("tr[data-action]")) {
    e.preventDefault();
    handleAction(e.target.dataset.action, e.target);
  }
});
let lastPersist = 0;
function recordActivity() {
  if (externalConflict) return;
  if (s.session) {
    const now = Date.now();
    if (now - s.session.lastActivity > s.settings.sessionMinutes * 60000) {
      s.session = null;
      save();
      closeDialog();
      render();
      toast("Session expirée. Veuillez vous reconnecter.");
      return;
    }
    s.session.lastActivity = now;
    if (now - lastPersist > 10000) {
      save();
      lastPersist = now;
    }
  }
}
for (const type of ["pointerdown", "keydown", "input"]) {
  document.addEventListener(type, recordActivity);
}
setInterval(() => {
  if (
    s.session &&
    Date.now() - s.session.lastActivity > s.settings.sessionMinutes * 60000
  ) {
    s.session = null;
    save();
    closeDialog();
    render();
    toast("Session expirée après inactivité.");
  }
}, 30000);
function onlyActivityChanged(oldRaw, newRaw) {
  try {
    const before = JSON.parse(oldRaw), after = JSON.parse(newRaw);
    if (!before?.session || !after?.session) return false;
    delete before.session.lastActivity;
    delete after.session.lastActivity;
    return JSON.stringify(before) === JSON.stringify(after);
  } catch { return false; }
}
window.addEventListener("storage", (e) => {
  if (e.key !== KEY) return;
  const incoming = readStoredState();
  if (onlyActivityChanged(e.oldValue, e.newValue)) {
    if (!externalConflict && s.session && incoming.state.session)
      s.session.lastActivity = Math.max(s.session.lastActivity, incoming.state.session.lastActivity);
    return;
  }
  const currentSession = s.session && `${s.session.user}|${s.session.role}`;
  const nextSession = incoming.state.session && `${incoming.state.session.user}|${incoming.state.session.role}`;
  const editing = !!overlay.querySelector("form") || !!app.querySelector("main form") ||
    !!permissionDraft || (page === "imports" && !!importData);
  if (editing && (incoming.issue !== null || currentSession === nextSession)) {
    externalConflict = true;
    const status = document.querySelector("#storage-status");
    if (status) status.innerHTML = storageMessage();
    const body = overlay.querySelector(".dialog-body");
    if (body && !body.querySelector(".external-change-notice"))
      body.insertAdjacentHTML("afterbegin", storageMessage());
    toast("Données modifiées ailleurs : copiez votre saisie, puis rechargez.");
    return;
  }
  ({ state: s, issue: storageIssue } = incoming);
  externalConflict = false;
  closeDialog();
  page = "home";
  tab = "";
  filters = {};
  selected.clear();
  detailId = null;
  permissionDraft = null;
  importData = null;
  importStep = 1;
  roomChannel = "general";
  render();
});
render();

const editorSelections = new WeakMap();
document.addEventListener("selectionchange", () => {
  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const editor = (node.nodeType === 1 ? node : node.parentElement)?.closest(".rich-content");
  if (editor) editorSelections.set(editor, range.cloneRange());
});
function formatSelection(control, command, value = null) {
  const editor = control.closest(".rich-editor")?.querySelector(".rich-content");
  if (!editor) return;
  const saved = editorSelections.get(editor);
  editor.focus();
  if (saved && editor.contains(saved.commonAncestorContainer)) {
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(saved);
  }
  document.execCommand(command, false, value);
}
document.addEventListener("mousedown", e => {
  if (e.target.closest(".rich-toolbar button")) e.preventDefault();
});
document.addEventListener("change", e => {
  const control = e.target.closest("[data-editor-select]");
  if (control && control.value) {
    formatSelection(control, control.dataset.editorSelect, control.value);
    control.selectedIndex = 0;
  }
});
document.addEventListener("paste", (e) => {
  if (e.target.closest(".rich-content")) {
    e.preventDefault();
    document.execCommand(
      "insertText",
      false,
      e.clipboardData.getData("text/plain"),
    );
  }
});
