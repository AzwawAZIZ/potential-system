import { seed, ROLES } from "./seed.js";
export const KEY = "suivi-miage-v1";
export const FUNCTIONS = {
  cohort: "Cohorte nominative",
  dossier: "Dossier 360°",
  cra: "Comptes rendus d’activité (CRA)",
  crv: "Comptes rendus de visite (CRV)",
  room: "Salons du projet",
  reports: "Signalements confidentiels",
  missions: "Missions & affectations",
  imports: "Imports métier",
  transition: "Bascule M1 → M2",
  accounts: "Comptes & rôles",
  permissions: "Matrice des permissions",
  settings: "Paramètres système",
  audit: "Journaux techniques",
  messageAudit: "Audit des messages directs",
};
const grants = {
  admin: ["accounts", "permissions", "settings", "audit"],
  stages: [
    "cohort",
    "dossier",
    "cra",
    "crv",
    "room",
    "reports",
    "missions",
    "imports",
    "transition",
  ],
  m1: ["cohort", "transition"],
  m2: ["cohort"],
  tutor: ["cohort", "dossier", "cra", "crv", "room", "reports", "missions"],
  company: ["cohort", "dossier", "cra", "crv", "room", "reports"],
  student: ["cohort", "dossier", "cra", "crv", "room", "reports"],
};
export function modeAllowed(r, f, m = "read") {
  if (!grants[r]?.includes(f)) return false;
  if (r === "company" && f === "cra" && m !== "read") return false;
  if (m === "read") return true;
  if (m === "configure")
    return r === "admin" && ["settings", "permissions", "accounts"].includes(f);
  if (["m1", "m2"].includes(r))
    return r === "m1" && f === "transition" && m === "write";
  if (r === "admin") return f === "accounts" && m === "write";
  if (m === "validate")
    return (
      (r === "stages" &&
        [
          "dossier",
          "crv",
          "reports",
          "missions",
          "transition",
          "imports",
        ].includes(f)) ||
      (r === "tutor" && ["cra", "crv", "missions"].includes(f)) ||
      (["company", "student"].includes(r) && f === "crv")
    );
  if (m !== "write") return false;
  return f !== "cohort" || r === "stages";
}
export function can(role, fn, state, mode = "read") {
  if (fn === "messageAudit" || role === "admin" && fn === "messageAudit") return false;
  if (
    fn === "settings" &&
    role === "stages" &&
    state?.settings.delegateBusiness
  )
    return !["maxMB", "sessionMinutes"].includes(mode);
  if (!modeAllowed(role, fn, mode)) return false;
  return (
    state?.overrides?.[role]?.[fn] !== false &&
    (mode === "read" || state?.overrides?.[role]?.[fn + ":" + mode] !== false)
  );
}
export function forbidden(role, fn) {
  return !grants[role]?.includes(fn);
}
export function activeUser(s) {
  const session = s.session;
  if (
    !session ||
    !Number.isFinite(session.lastActivity) ||
    Date.now() - session.lastActivity >
      (s.settings.sessionMinutes || 60) * 60000
  )
    return undefined;
  return s.users.find(
    (u) => u.id === session.user && u.active && u.roles.includes(session.role),
  );
}
export function requireRole(s, roles) {
  const u = activeUser(s);
  if (
    !u ||
    !u.roles.includes(s.session.role) ||
    !roles.includes(s.session.role)
  )
    throw Error(
      "Accès refusé : cette action n’est pas autorisée pour votre rôle actif.",
    );
  return u;
}
export function scopedStudents(s) {
  const u = activeUser(s),
    r = s.session?.role;
  if (!u || !u.roles.includes(r) || !can(r, "cohort", s)) return [];
  return s.students
    .filter(
      (x) =>
        r === "stages" ||
        (r === "m1" && x.promo === "M1") ||
        (r === "m2" && x.promo === "M2") ||
        (r === "tutor" && x.tutor === u.id) ||
        (r === "company" && x.mentor === u.id) ||
        (r === "student" && x.user === u.id),
    )
    .map((x) =>
      ["m1", "m2"].includes(r)
        ? Object.fromEntries(
            [
              "id",
              "name",
              "promo",
              "contract",
              "company",
              "city",
              "tutor",
              "status",
              "step",
            ].map((k) => [k, x[k]]),
          )
        : x,
    );
}
export function dossier(s, id, fn = "dossier") {
  if (!can(s.session?.role, fn, s))
    throw Error(
      "Accès interdit par la règle RG-10 ou la séparation des fonctions.",
    );
  const d = scopedStudents(s).find((x) => x.id === id);
  if (!d) throw Error("Ce dossier est hors de votre périmètre.");
  return d;
}
export function reportsFor(s) {
  const u = activeUser(s);
  if (!u || !can(s.session.role, "reports", s)) return [];
  return s.reports.filter(
    (r) =>
      s.session.role === "stages" ||
      r.author === u.id ||
      r.shared.includes(u.id),
  );
}
export function notices(s) {
  if (!activeUser(s)) return [];
  return s.notifications.filter(
    (n) => n.user === s.session?.user && n.role === s.session?.role,
  );
}
export function participants(s, d) {
  return [
    ...new Set(
      [
        d.user,
        d.tutor,
        d.mentor,
        ...s.users
          .filter((u) => u.roles.includes("stages") && u.active)
          .map((u) => u.id),
      ].filter((id) => id && s.users.some((u) => u.id === id && u.active)),
    ),
  ];
}
const roomFields = { student: "user", tutor: "tutor", company: "mentor" };
const businessRoles = ["student", "tutor", "company"];

// Les participants métier ont d'autres usages que la messagerie ; on conserve
// participants() et on représente séparément les couples compte/rôle du salon.
function roomActorRoles(s, d) {
  const roles = {};
  const add = (user, role) => {
    if (!user || !s.users.some((x) => x.id === user && x.active && x.roles.includes(role))) return;
    (roles[user] ??= []).push(role);
  };
  for (const role of businessRoles) add(d[roomFields[role]], role);
  for (const user of s.users.filter((x) => x.active && x.roles.includes("stages"))) add(user.id, "stages");
  return roles;
}

function roomAccess(s, room) {
  const u = activeUser(s), r = s.session?.role;
  if (!u || !["stages", ...businessRoles].includes(r) || !can(r, "room", s)) return false;
  if (!s.rooms.includes(room)) return false;
  const matches = s.students.filter((d) => d.id === room.student);
  if (matches.length !== 1) return false;
  const d = matches[0];
  if (!Number.isInteger(room.cycle) || !Number.isInteger(d.cycle) || room.cycle < 1 || room.cycle > d.cycle) return false;
  if (!room.closed && room.cycle === d.cycle)
    return r === "stages" || d[roomFields[r]] === u.id;
  // Un salon d'un ancien cycle resté ouvert ne doit pas devenir une archive.
  if (!room.closed) return false;
  if (r === "stages") return true;
  if (!Array.isArray(room.actors) || !room.actors.includes(u.id)) return false;
  if (room.actorRoles) return Array.isArray(room.actorRoles[u.id]) && room.actorRoles[u.id].includes(r);
  // Les archives v1 figent parfois uniquement les identifiants d’acteurs :
  // l’appartenance au salon suffit alors, sans réutiliser les affectations actuelles.
  return room.actors.includes(u.id);
}

function messageVisible(s, message) {
  const u = activeUser(s), role = s.session.role;
  if (!u || !Array.isArray(message.recipients)) return false;
  const authored = message.author === u.id &&
    (message.authorRole ? message.authorRole === role : u.roles.filter((x) => ["stages", ...businessRoles].includes(x)).length === 1);
  const roles = message.recipientRoles?.[u.id];
  const targeted = message.recipients.includes(u.id) &&
    (Array.isArray(roles) ? roles.includes(role) : typeof roles === "string" ? roles === role :
      // Un destinataire stages hérité peut avoir été ajouté par includeManager.
      role !== "stages" && u.roles.filter((x) => ["stages", ...businessRoles].includes(x)).length === 1);
  return authored || targeted || (message.recipients.length === 0 && businessRoles.includes(role));
}

export function messages(s, room) {
  if (!activeUser(s) || !can(s.session?.role, "room", s)) throw Error("Accès au salon refusé.");
  if (!roomAccess(s, room)) return [];
  return room.messages.filter((m) => messageVisible(s, m) || (room.closed && s.session.role === "stages" && ((m.recipients.length === 0 && m.author !== s.students.find((d) => d.id === room.student)?.user) || (Array.isArray(room.actors) && room.actors.includes(s.session.user) && m.author === s.students.find((d) => d.id === room.student)?.user && m.recipients.length > 0))));
}
export function archivedRooms(s) {
  return s.rooms
    .filter((room) => room.closed && roomAccess(s, room))
    .map((room) => ({ ...room, messages: room.messages.filter((m) => messageVisible(s, m) || (s.session.role === "stages" && ((m.recipients.length === 0 && m.author !== s.students.find((d) => d.id === room.student)?.user) || (Array.isArray(room.actors) && room.actors.includes(s.session.user) && m.author === s.students.find((d) => d.id === room.student)?.user && m.recipients.length > 0)))) }));
}

// Les données v1 ne portaient pas toutes un cycle. Leur rattachement n'est
// certain que pour un dossier encore au premier cycle, sans contrat archivé.
// Après plusieurs cycles, une date ou la présence d'un salon ne suffit pas à
// attribuer sûrement une visite ou un CRV : ces enregistrements sont masqués.
function recordCycle(s, record, student) {
  if (!record || !student || record.student !== student.id) return null;
  if (Object.hasOwn(record, "cycle"))
    return Number.isInteger(record.cycle) && record.cycle > 0
      ? record.cycle
      : null;
  if (
    student.cycle === 1 &&
    !s.history.some((h) => h.type === "Contrat archivé" && h.student === student.id)
  ) return 1;
  return null;
}

function selectCycleRecords(s, records, fn, studentId, archived) {
  const u = activeUser(s), r = s.session?.role;
  if (
    !u || !["stages", "tutor", "company", "student"].includes(r) ||
    !can(r, fn, s)
  ) return [];
  const current = archived ? [] : scopedStudents(s);
  return records.filter((record) => {
    if (studentId != null && record.student !== studentId) return false;
    // Une identité de dossier dupliquée ne permet pas de déterminer son cycle.
    const matches = s.students.filter((d) => d.id === record.student);
    if (matches.length !== 1) return false;
    const student = matches[0];
    if (!Number.isInteger(student.cycle) || student.cycle < 1) return false;
    const cycle = recordCycle(s, record, student);
    if (cycle === null) return false;
    if (!archived)
      return cycle === student.cycle && current.some((d) => d.id === student.id);
    if (cycle >= student.cycle) return false;
    if (r === "stages") return true;
    // Les acteurs historiques sont lus dans l'instantané du contrat, et non
    // dans les affectations actuelles ni dans une liste de salon périmée.
    const snapshots = s.history.filter((h) =>
      h.type === "Contrat archivé" && h.student === student.id &&
      h.before?.id === student.id && h.before?.cycle === cycle
    );
    if (snapshots.length !== 1) return false;
    const field = { tutor: "tutor", company: "mentor", student: "user" }[r];
    return snapshots[0].before[field] === u.id;
  });
}

// Sans studentId, ces sélecteurs couvrent tous les dossiers autorisés. Les
// archives sont séparées des vues et des mutations du cycle courant.
export const visitsFor = (s, studentId) =>
  selectCycleRecords(s, s.visits, "dossier", studentId, false);
export const crvsFor = (s, studentId) =>
  selectCycleRecords(s, s.crvs, "crv", studentId, false);
export const archivedVisits = (s, studentId) =>
  selectCycleRecords(s, s.visits, "dossier", studentId, true);
export const archivedCrvs = (s, studentId) =>
  selectCycleRecords(s, s.crvs, "crv", studentId, true);
// Un futur droit CRA entreprise doit utiliser ces sélecteurs plutôt que lire
// directement la collection. Les brouillons restent réservés à l'étudiant.
export const crasFor = (s, studentId) =>
  selectCycleRecords(s, s.cra, "cra", studentId, false)
    .filter((c) => s.session.role === "student" || c.status !== "Brouillon");
export const archivedCras = (s, studentId) =>
  selectCycleRecords(s, s.cra, "cra", studentId, true)
    .filter((c) => s.session.role === "student" || c.status !== "Brouillon");

export function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s?.version === 1) return s;
  } catch {}
  return seed();
}
export function persist(s) {
  localStorage.setItem(KEY, JSON.stringify(s));
}
export function id(p) {
  return (
    p +
    "-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 7)
  );
}
export function log(s, type, detail, result = "Succès", target = "système") {
  s.audit.unshift({
    id: id("a"),
    date: new Date().toLocaleString("sv-SE").slice(0, 16),
    author: s.session?.user || "anonyme",
    type,
    detail,
    result,
    target,
  });
}
export function notify(s, user, role, text, email = false) {
  if (!user) return;
  s.notifications.unshift({ id: id("n"), user, role, text, read: false });
  if (email)
    s.emails.unshift({
      id: id("email"),
      to: s.users.find((u) => u.id === user)?.email || user,
      text,
      date: new Date().toLocaleString("fr-FR"),
    });
}
function need(v, msg) {
  if (!v || !String(v).trim()) throw Error(msg);
}
function validCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
function validClockTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
export function attachment(file, s) {
  if (!file) return null;
  if (!Number.isFinite(file.size) || file.size < 0)
    throw Error("Pièce jointe : taille invalide.");
  if (!/\.(pdf|docx?|xlsx?|csv|png|jpe?g|webp)$/i.test(file.name))
    throw Error(
      "Pièce jointe : seuls PDF, Word, Excel, CSV et images sont autorisés.",
    );
  if (file.size > s.settings.maxMB * 1024 * 1024)
    throw Error(
      "Pièce jointe : la taille maximale est de " + s.settings.maxMB + " Mo.",
    );
  return { name: file.name, size: file.size };
}
export function mutate(s, action, p = {}) {
  const before = structuredClone(s);
  try {
    return execute(s, action, p);
  } catch (e) {
    for (const key of Object.keys(s)) delete s[key];
    Object.assign(s, before);
    throw e;
  }
}
function execute(s, action, p = {}) {
  const u = activeUser(s),
    r = s.session?.role;
  requireRole(s, Object.keys(ROLES));
  let d;
  if (p.attachment) p.attachment = attachment(p.attachment, s);
  const scoped = (fn = "dossier") => (d = dossier(s, p.student, fn));
  const scopedCycle = (fn = "dossier") => {
    scoped(fn);
    if (p.cycle !== undefined && p.cycle !== d.cycle)
      throw Error("Ce cycle n’est plus le cycle courant du dossier.");
  };
  const currentCrv = () => {
    const candidates = crvsFor(s, d.id);
    if (p.id !== undefined) {
      const c = candidates.find((x) => x.id === p.id);
      if (!c) throw Error("CRV hors du cycle courant ou introuvable.");
      return c;
    }
    if (candidates.length > 1) throw Error("Plusieurs CRV pour ce cycle : précisez le compte rendu.");
    return candidates[0];
  };
  const business = (fn) => {
    if (!can(r, fn, s))
      throw Error("Votre rôle actif ne dispose pas de ce droit.");
  };
  const resource = {
    account: ["accounts", "write"],
    permissions: ["permissions", "configure"],
    settings: ["settings", r === "admin" ? "configure" : "write"],
    mission: ["missions", "write"],
    missionDecision: ["missions", "validate"],
    missionAssign: ["missions", "validate"],
    craDraft: ["cra", "write"],
    craSend: ["cra", "write"],
    craReview: ["cra", "validate"],
    request: [p.type === "CRA" ? "cra" : "dossier", "write"],
    visit: ["dossier", "write"],
    visitConfirm: ["dossier", "write"],
    crvSave: ["crv", "write"],
    visa: ["crv", "validate"],
    disagree: ["crv", "write"],
    delegate: ["crv", "write"],
    rectify: ["crv", "write"],
    amend: ["crv", "write"],
    crvArbitrate: ["crv", "validate"],
    onboarding: ["dossier", "write"],
    access: ["dossier", "validate"],
    report: ["reports", "write"],
    reportAction: ["reports", p.kind === "rupture" ? "validate" : "write"],
    roomClose: ["room", "write"],
    newCycle: ["dossier", "write"],
    message: ["room", "write"],
    transition: ["transition", r === "m1" ? "write" : "validate"],
    bulkStatus: ["cohort", "write"],
    bulkInfo: ["cohort", "write"],
    auditMessage: ["messageAudit", "read"],
  }[action];
  if (resource && !can(r, resource[0], s, resource[1]))
    throw Error(
      "Autorisation refusée : " + resource[0] + " / " + resource[1] + ".",
    );
  switch (action) {
    case "availability":
      requireRole(s, ["tutor"]);
      if (
        !Number.isInteger(+p.capacity) ||
        +p.capacity < 1 ||
        +p.capacity < scopedStudents(s).length ||
        +p.capacity > 30
      )
        throw Error(
          "La capacité doit couvrir vos affectations actuelles et ne pas dépasser 30.",
        );
      u.capacity = +p.capacity;
      u.available = !!p.available;
      break;
    case "account": {
      requireRole(s, ["admin"]);
      need(p.name, "Nom obligatoire.");
      const email = String(p.email || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw Error("E-mail : saisir une adresse valide.");
      if (!p.roles?.length) throw Error("Sélectionnez au moins un rôle.");
      if (p.roles.some((x) => !ROLES[x])) throw Error("Rôle inconnu.");
      if (s.users.some((x) => x.email.trim().toLowerCase() === email && x.id !== p.id))
        throw Error("Cet e-mail appartient déjà à un compte.");
      const old = s.users.find((x) => x.id === p.id);
      const accessChanged =
        !old ||
        JSON.stringify([...old.roles].sort()) !==
          JSON.stringify([...p.roles].sort()) ||
        old.active !== !!p.active;
      if (accessChanged && !can(r, "accounts", s, "configure"))
        throw Error(
          "Paramétrage des habilitations non autorisé pour ce rôle actif.",
        );
      if (old && !p.active) {
        need(p.reason, "Le motif de désactivation est obligatoire.");
        if (old.id === u.id)
          throw Error("Vous ne pouvez pas désactiver votre propre session.");
        if (
          old.roles.includes("admin") &&
          s.users.filter((x) => x.active && x.roles.includes("admin")).length <=
            1
        )
          throw Error(
            "Impossible de désactiver le dernier administrateur actif.",
          );
        if (p.confirm !== "DÉSACTIVER")
          throw Error("Saisissez DÉSACTIVER pour confirmer.");
      }
      if (
        old?.roles.includes("admin") &&
        !p.roles.includes("admin") &&
        s.users.filter((x) => x.active && x.roles.includes("admin")).length <= 1
      )
        throw Error("Le dernier administrateur actif doit conserver son rôle.");
      if (
        p.roles.includes("admin") &&
        !old?.roles.includes("admin") &&
        p.confirm !== "ADMIN"
      )
        throw Error("Saisissez ADMIN pour confirmer l’attribution sensible.");
      need(p.reason, "Le motif de modification des droits est obligatoire.");
      const record = {
        id: old?.id || id("u"),
        name: p.name,
        email,
        roles: p.roles,
        active: !!p.active,
        created: old?.created || "2026-11-21",
        lastLogin: old?.lastLogin || "Jamais",
      };
      if (old) Object.assign(old, record);
      else
        s.users.push({
          ...record,
          ...(p.roles.includes("tutor")
            ? { capacity: s.settings.capacity, available: true }
            : {}),
        });
      log(
        s,
        "Compte",
        "Compte et droits mis à jour. Motif : " + p.reason,
        "Succès",
        record.id,
      );
      return;
    }
    case "permissions":
      requireRole(s, ["admin"]);
      need(p.reason, "Le motif du changement de permissions est obligatoire.");
      for (const [role, fs] of Object.entries(p.changes)) {
        for (const [fn, val] of Object.entries(fs)) {
          const [resource, mode = "read"] = fn.split(":");
          if (
            !ROLES[role] ||
            !FUNCTIONS[resource] ||
            !["read", "write", "validate", "configure"].includes(mode)
          )
            throw Error("Permission inconnue.");
          if (val && !modeAllowed(role, resource, mode))
            throw Error("Droit verrouillé par une règle métier inviolable.");
        }
      }
      s.history.unshift({
        type: "Permissions",
        author: u.id,
        date: new Date().toISOString(),
        before: structuredClone(s.overrides),
        after: p.changes,
        reason: p.reason,
      });
      s.overrides = structuredClone(p.changes);
      break;
    case "settings":
      requireRole(s, ["admin", "stages"]);
      business("settings");
      need(p.reason, "Le motif de modification est obligatoire.");
      {
        const before = { ...s.settings };
        for (const key of [
          "craDays",
          "crvDays",
          "visitDays",
          "reminderDays",
          "capacity",
          "maxMB",
          "sessionMinutes",
        ]) {
          if (r === "stages" && ["maxMB", "sessionMinutes"].includes(key))
            continue;
          if (!Number.isInteger(+p[key]) || +p[key] < 1 || +p[key] > 1440)
            throw Error(
              "Chaque délai, taille ou capacité doit être compris entre 1 et 1 440.",
            );
          s.settings[key] = +p[key];
        }
        if (r === "admin") s.settings.delegateBusiness = !!p.delegateBusiness;
        s.history.unshift({
          type: "Paramètres",
          author: u.id,
          date: new Date().toISOString(),
          before,
          after: { ...s.settings },
          reason: p.reason,
        });
      }
      break;
    case "mission": {
      requireRole(s, ["stages"]);
      business("missions");
      const st = s.students.find((x) => x.id === p.student);
      if (!st) throw Error("Étudiant requis.");
      need(p.title, "Intitulé requis.");
      need(p.description, "Description de mission requise.");
      need(p.company, "Entreprise requise.");
      need(p.address, "Adresse exacte requise.");
      need(p.city, "Ville requise.");
      if (!p.start || !p.end || p.end <= p.start)
        throw Error("La date de fin doit être postérieure au début.");
      const tu = s.users.find(
        (x) => x.id === p.tutor && x.active && x.roles.includes("tutor"),
      );
      if (!tu) throw Error("Sélectionnez un tuteur actif.");
      const snapshot = {
        company: p.company, city: p.city, address: p.address,
        start: p.start, end: p.end, contract: p.contract,
      };
      s.missions.unshift({
        id: id("m"), student: st.id, tutor: tu.id, cycle: st.cycle,
        title: p.title, description: p.description, attachment: p.attachment,
        ...snapshot, snapshot, studentBefore: structuredClone(st), status: "En attente", history: [],
      });
      notify(s, tu.id, "tutor", "Une mission vous est proposée.");
      break;
    }
    case "missionDecision": {
      requireRole(s, ["tutor"]);
      business("missions");
      const m = s.missions.find((x) => x.id === p.id && x.tutor === u.id);
      if (!m || m.status !== "En attente")
        throw Error("Cette mission n’est plus en attente.");
      if (!["Accepter", "Refuser", "Précisions"].includes(p.decision))
        throw Error("Décision de mission invalide.");
      if (p.decision === "Accepter") {
        d = s.students.find((x) => x.id === m.student);
        if (!d || m.cycle !== d.cycle || (m.studentBefore && JSON.stringify(m.studentBefore) !== JSON.stringify(d)))
          throw Error("La proposition est périmée ou son cycle a changé.");
        if (!u.available || s.students.filter((x) => x.tutor === u.id).length >= u.capacity)
          throw Error("Capacité atteinte ou disponibilité désactivée.");
        if (m.contract !== "Stage") {
          m.status = "Avis favorable du tuteur";
          notify(s, s.users.find((x) => x.roles.includes("stages") && x.active)?.id, "stages", "Un avis favorable attend la décision finale.");
        } else {
          Object.assign(d, { tutor: u.id, company: m.company, city: m.city, address: m.address, start: m.start, end: m.end, contract: m.contract, status: "En cours", step: Math.max(2, d.step) });
          m.status = "Acceptée"; openRoom(s, d);
        }
      } else {
        need(
          p.reason,
          "Le motif de refus ou la demande de précisions est obligatoire.",
        );
        m.status =
          p.decision === "Refuser" ? "Refusée" : "Précisions demandées";
      }
      m.history.push({
        decision: m.status,
        reason: p.reason || "",
        date: new Date().toISOString(),
      });
      s.users
        .filter((x) => x.roles.includes("stages"))
        .forEach((x) =>
          notify(
            s,
            x.id,
            "stages",
            "Réponse à une proposition de mission : " + m.status,
          ),
        );
      break;
    }
    case "missionAssign": {
      requireRole(s, ["stages"]);
      business("missions");
      const m = s.missions.find((x) => x.id === p.id && x.status === "Avis favorable du tuteur");
      if (!m || m.cycle == null) throw Error("Cette mission n’attend pas de décision finale.");
      d = s.students.find((x) => x.id === m.student);
      const tu = s.users.find((x) => x.id === m.tutor);
      if (!d || d.cycle !== m.cycle || !tu?.active || !tu.roles.includes("tutor") || !tu.available || s.students.filter((x) => x.tutor === tu.id).length >= tu.capacity)
        throw Error("La mission est périmée, le tuteur est indisponible ou sa capacité est atteinte.");
      if (m.studentBefore && JSON.stringify(m.studentBefore) !== JSON.stringify(d)) throw Error("Le dossier a changé depuis la proposition.");
      if (d.tutor && d.tutor !== tu.id) s.history.push({type:"Ancien tuteur", student:d.id, tutor:d.tutor, date:new Date().toISOString()});
      Object.assign(d, m.snapshot || { company:m.company, city:m.city, address:m.address, start:m.start, end:m.end, contract:m.contract }, { tutor: tu.id, status: "En cours", step: Math.max(2, d.step) });
      m.status = "Affectée";
      m.history.push({ decision: "Affectation finale", author: u.id, date: new Date().toISOString() });
      openRoom(s, d);
      break;
    }
    case "craDraft":
    case "craSend": {
      requireRole(s, ["student"]);
      scoped("cra");
      need(p.period, "Indiquez la période du CRA.");
      need(p.activities, "Décrivez les activités réalisées.");
      if (action === "craSend") {
        need(
          p.difficulties,
          "Renseignez les difficultés, ou indiquez « Aucune ».",
        );
        need(p.next, "Indiquez les prochaines étapes.");
      }
      if (p.request && !p.linkConfirmed)
        throw Error(
          "Cochez la confirmation d’association à la demande du tuteur.",
        );
      if (p.request && !s.requests.some((q) => q.id === p.request && q.student === d.id && q.type === "CRA"))
        throw Error("La demande de CRA doit appartenir à ce dossier.");
      const old = s.cra.find(
        (x) =>
          x.id === p.id &&
          x.student === d.id &&
          ["Brouillon", "À compléter"].includes(x.status),
      );
      const rec = {
        id: old?.id || id("cra"),
        student: d.id,
        ...(!old ? { cycle: d.cycle } : {}),
        period: p.period,
        activities: p.activities,
        difficulties: p.difficulties,
        next: p.next,
        attachment: p.attachment || old?.attachment,
        request: p.request || null,
        status: action === "craDraft" ? "Brouillon" : "À lire",
        date: "2026-11-21",
        feedback: "",
      };
      if (old) Object.assign(old, rec);
      else s.cra.unshift(rec);
      if (action === "craSend")
        notify(s, d.tutor, "tutor", "Un CRA attend votre lecture.");
      break;
    }
    case "craReview":
      requireRole(s, ["tutor"]);
      scoped("cra");
      {
        const c = s.cra.find((x) => x.id === p.id && x.student === d.id);
        if (!c || c.status === "Brouillon") throw Error("CRA indisponible.");
        if (!["Lu", "Validé", "À compléter"].includes(p.status))
          throw Error("Décision invalide.");
        if (p.status === "À compléter")
          need(p.feedback, "Précisez les corrections attendues.");
        c.status = p.status;
        c.feedback = p.feedback;
        notify(
          s,
          d.user,
          "student",
          "Votre CRA a reçu une décision : " + p.status,
        );
      }
      break;
    case "request":
      requireRole(s, ["tutor"]);
      scoped();
      need(p.text, "Consigne obligatoire.");
      if (!p.due || p.due < "2026-11-21")
        throw Error(
          "La date souhaitée doit être future ou égale à aujourd’hui.",
        );
      s.requests.unshift({
        id: id("req"),
        student: d.id,
        cycle: d.cycle,
        type: p.type,
        period: p.period,
        text: p.text,
        due: p.due,
        date: "2026-11-21",
      });
      notify(
        s,
        d.user,
        "student",
        "Votre tuteur vous adresse une demande de " + p.type,
      );
      break;
    case "visit":
      requireRole(s, ["student", "tutor", "company"]);
      scopedCycle();
      if (!validCalendarDate(p.date) || p.date < "2026-11-21" || !validClockTime(p.time) || !String(p.place || "").trim())
        throw Error(
          "Choisissez une date future, une heure et un lieu ou visioconférence.",
        );
      if ((p.date2 || p.time2) && (!validCalendarDate(p.date2) || p.date2 < "2026-11-21" || !validClockTime(p.time2)))
        throw Error(
          "Le second créneau doit inclure une date future et une heure.",
        );
      s.visits.unshift({
        id: id("v"),
        student: d.id,
        cycle: d.cycle,
        date: p.date,
        time: p.time,
        place: p.place,
        status: "Proposée",
        alternative: p.date2 ? `${p.date2} ${p.time2}` : null,
      });
      participants(s, d)
        .filter((x) => x !== u.id)
        .forEach((x) =>
          notify(
            s,
            x,
            s.users.find((v) => v.id === x)?.roles.includes("company")
              ? "company"
              : x === d.user
                ? "student"
                : "tutor",
            "Une proposition de visite est disponible.",
            x === d.mentor,
          ),
        );
      break;
    case "visitConfirm":
      requireRole(s, ["tutor"]);
      scopedCycle();
      {
        const v = visitsFor(s, d.id).find((x) => x.id === p.id);
        if (!v) throw Error("Visite introuvable.");
        if (p.done && v.status !== "Confirmée")
          throw Error("Seule une visite confirmée peut être marquée réalisée.");
        if (!p.done && v.status !== "Proposée")
          throw Error("Seule une visite proposée peut être confirmée.");
        if (!p.done && ![undefined, "first", "second"].includes(p.slot))
          throw Error("Créneau de visite invalide.");
        if (!p.done && p.slot === "second") {
          const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(v.alternative || "");
          if (!match || !validCalendarDate(match[1]) || !validClockTime(match[2]))
            throw Error("Le second créneau n’est pas disponible.");
          const previous = `${v.date} ${v.time}`;
          v.date = match[1];
          v.time = match[2];
          v.alternative = previous;
        }
        v.status = p.done ? "Réalisée" : "Confirmée";
        participants(s, d).forEach((x) =>
          notify(
            s,
            x,
            x === d.user ? "student" : x === d.mentor ? "company" : "tutor",
            "Visite " + v.status.toLowerCase(),
            x === d.mentor,
          ),
        );
      }
      break;
    case "crvSave":
      requireRole(s, ["tutor", "company"]);
      scopedCycle("crv");
      need(p.text, "Le compte rendu doit être renseigné.");
      {
        const c = currentCrv();
        if (c && (c.disagreement || c.visas.length))
          throw Error(
            "Un CRV en désaccord ou déjà visé ne peut pas être écrasé.",
          );
        if (c) {
          c.versions ??= [];
          c.versions.push({ before: c.text, after: p.text, author: u.id, date: new Date().toISOString() });
          c.cycle = d.cycle;
          c.text = p.text;
          c.html = p.html || null;
          c.attachment = p.attachment || c.attachment;
        } else
          s.crvs.push({
            id: id("crv"),
            student: d.id,
            cycle: d.cycle,
            text: p.text,
            html: p.html || null,
            visas: [],
            versions: [],
            amendments: [],
            delegated: false,
            disagreement: false,
            due: "2026-12-05",
            attachment: p.attachment,
          });
      }
      break;
    case "visa":
      scopedCycle("crv");
      {
        const c = currentCrv();
        if (!c) throw Error("Aucun CRV à viser.");
        const order = ["tutor", "company", "student"];
        if (c.disagreement)
          throw Error("Les visas sont gelés pendant le désaccord.");
        if (order[c.visas.length] !== r)
          throw Error("Respectez le circuit : Tuteur, Entreprise, Étudiant.");
        c.visas.push(r);
        if (c.visas.length === 3) {
          d.step = 6;
          d.status = "Clôturé";
        }
        const next = order[c.visas.length];
        if (next)
          notify(
            s,
            next === "company" ? d.mentor : d.user,
            next,
            "Votre visa est attendu sur le CRV.",
            next === "company",
          );
      }
      break;
    case "disagree":
      requireRole(s, ["company", "student"]);
      scopedCycle("crv");
      need(p.reason, "Expliquez précisément le désaccord.");
      {
        const c = currentCrv();
        if (!c) throw Error("CRV absent.");
        c.disagreement = true;
        c.disagreementText = p.reason;
        d.status = "Désaccord CRV";
        s.users
          .filter((x) => x.roles.includes("stages"))
          .forEach((x) =>
            notify(s, x.id, "stages", "Désaccord CRV : arbitrage à suivre."),
          );
      }
      break;
    case "delegate":
      requireRole(s, ["tutor"]);
      scopedCycle("crv");
      {
        const c = currentCrv();
        if (!c?.disagreement)
          throw Error("La délégation est réservée aux CRV en désaccord.");
        c.delegated = !c.delegated;
        notify(
          s,
          d.mentor,
          "company",
          c.delegated
            ? "Une rectification temporaire est autorisée."
            : "La délégation a été révoquée.",
          true,
        );
      }
      break;
    case "rectify":
      requireRole(s, ["company"]);
      scopedCycle("crv");
      {
        const c = currentCrv();
        if (!c?.delegated || !c.disagreement)
          throw Error(
            "Une délégation temporaire active du tuteur est obligatoire.",
          );
        need(p.text, "Le texte rectifié est obligatoire.");
        c.versions.unshift({
          before: c.text,
          after: p.text,
          author: u.id,
          date: new Date().toISOString(),
        });
        c.text = p.text;
        delete c.html;
        c.delegated = false;
        c.disagreement = false;
        c.visas = [];
        d.status = "En cours";
        d.step = 5;
        notify(
          s,
          d.tutor,
          "tutor",
          "Le CRV a été rectifié. Les visas sont réinitialisés à 0/3.",
        );
      }
      break;
    case "amend":
      requireRole(s, ["company"]);
      scopedCycle("crv");
      need(p.text, "Amendement obligatoire.");
      {
        const c = currentCrv();
        if (!c) throw Error("CRV absent.");
        c.amendments.push({ author: u.id, text: p.text, date: "2026-11-21" });
      }
      break;
    case "crvArbitrate":
      requireRole(s, ["stages"]);
      scopedCycle("crv");
      need(p.text, "Une consigne d’arbitrage est obligatoire.");
      {
        const c = currentCrv();
        if (!c?.disagreement) throw Error("Aucun désaccord actif à arbitrer.");
        c.arbitrationNotes ??= [];
        c.arbitrationNotes.push({
          text: p.text,
          author: u.id,
          date: new Date().toISOString(),
        });
        notify(
          s,
          d.tutor,
          "tutor",
          "Une consigne d’arbitrage est disponible sur le CRV.",
        );
      }
      break;
    case "onboarding":
      requireRole(s, ["student"]);
      scoped();
      if (d.access === "Accès créé")
        throw Error("La demande a déjà été traitée.");
      need(p.company, "Entreprise obligatoire.");
      need(p.mentorName, "Nom du maître de stage obligatoire.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.mentorEmail))
        throw Error("E-mail du maître de stage invalide.");
      Object.assign(d, {
        company: p.company,
        mentorName: p.mentorName,
        mentorEmail: p.mentorEmail,
        access: "En attente",
      });
      break;
    case "access":
      requireRole(s, ["stages"]);
      scoped();
      if (d.access !== "En attente") throw Error("Aucune demande en attente.");
      {
        let mentor = s.users.find((x) => x.email === d.mentorEmail);
        if (mentor && !mentor.roles.includes("company"))
          throw Error("Cet e-mail est déjà utilisé par un compte interne.");
        if (!mentor) {
          mentor = {
            id: id("u"),
            name: d.mentorName,
            email: d.mentorEmail,
            roles: ["company"],
            active: true,
            created: "2026-11-21",
            lastLogin: "Jamais",
          };
          s.users.push(mentor);
        }
        if (!mentor.active)
          throw Error(
            "Le compte entreprise est désactivé. Contactez l’administrateur.",
          );
        d.mentor = mentor.id;
        d.access = "Accès créé";
        notify(
          s,
          mentor.id,
          "company",
          "Votre accès Suivi MIAGE est créé.",
          true,
        );
        openRoom(s, d);
      }
      break;
    case "report":
      scoped("reports");
      need(p.text, "Décrivez le problème rencontré.");
      s.reports.unshift({
        id: id("r"),
        student: d.id,
        author: u.id,
        category: p.category,
        text: p.text,
        status: "Ouvert",
        shared: [],
        notes: [],
        date: "2026-11-21",
        attachment: p.attachment,
      });
      s.users
        .filter((x) => x.roles.includes("stages"))
        .forEach((x) =>
          notify(
            s,
            x.id,
            "stages",
            "Un signalement confidentiel a été déposé.",
          ),
        );
      break;
    case "reportAction": {
      requireRole(s, ["stages"]);
      business("reports");
      const report = s.reports.find((x) => x.id === p.id);
      if (!report) throw Error("Signalement introuvable.");
      if (p.kind === "note") {
        need(p.text, "La note ne peut pas être vide.");
        report.notes.push({ author: u.id, text: p.text });
      } else if (p.kind === "transfer") {
        const st = s.students.find((x) => x.id === report.student);
        if (!participants(s, st).includes(p.user))
          throw Error("Destinataire hors périmètre.");
        if (!report.shared.includes(p.user)) report.shared.push(p.user);
      } else if (p.kind === "rupture") {
        report.status = "Rupture qualifiée";
        s.students.find((x) => x.id === report.student).status = "Rupture";
      } else report.status = p.kind === "close" ? "Clôturé" : "Pris en charge";
      break;
    }
    case "roomClose":
      requireRole(s, ["stages"]);
      scoped("room");
      need(p.reason, "Le motif de fermeture est obligatoire.");
      {
        const room = s.rooms.find((x) => x.student === d.id && !x.closed);
        if (!room) throw Error("Aucun salon actif.");
        room.closed = true;
        room.reason = p.reason;
        room.actors = participants(s, d);
        room.summary = { name: d.name, company: d.company };
      }
      break;
    case "newCycle":
      requireRole(s, ["stages"]);
      scoped();
      if (!d.status.includes("Rupture"))
        throw Error(
          "Un nouveau cycle nécessite une situation de rupture sur le contrat courant.",
        );
      need(p.reason, "Le motif du nouveau cycle est obligatoire.");
      if (s.rooms.some((x) => x.student === d.id && !x.closed))
        throw Error(
          "Fermez le salon existant avant d’ouvrir un nouveau cycle.",
        );
      // Figer les anciennes données v1 seulement si leur cycle est certain,
      // avant que l'incrément ne rende leur attribution impossible.
      for (const collection of [s.visits, s.crvs, s.cra, s.requests])
        for (const record of collection)
          if (!Object.hasOwn(record, "cycle") && recordCycle(s, record, d) === d.cycle)
            record.cycle = d.cycle;
      s.history.push({
        type: "Contrat archivé",
        student: d.id,
        before: structuredClone(d),
        date: new Date().toISOString(),
        reason: p.reason,
      });
      Object.assign(d, {
        cycle: d.cycle + 1,
        tutor: null,
        mentor: null,
        company: "—",
        city: "—",
        address: "",
        start: "",
        end: "",
        mentorName: "",
        mentorEmail: "",
        contract: "Sans contrat",
        status: "En recherche",
        step: 0,
        access: "À déclarer",
      });
      break;
    case "message":
      scoped("room");
      {
        const room = s.rooms.find((x) => x.id === p.room && x.student === d.id);
        if (!room || room.closed)
          throw Error("Salon fermé : historique en lecture seule.");
        need(p.text, "Le message ne peut pas être vide.");
        const recipients = p.recipients || [];
        if (recipients.some((x) => !participants(s, d).includes(x)))
          throw Error("Un destinataire est hors des acteurs autorisés.");
        const recipientRoles = Object.fromEntries(recipients.map((recipient) => [recipient, participants(s, d).includes(recipient) ? (recipient === d.mentor ? ["company"] : recipient === d.tutor ? ["tutor"] : recipient === d.user ? ["student"] : ["stages"]) : []]));
        room.messages.push({
          id: id("msg"),
          author: u.id,
          authorRole: r,
          text: p.text,
          date: new Date().toLocaleString("fr-FR"),
          recipients: [...recipients],
          recipientRoles,
          attachment: p.attachment,
        });
        participants(s, d)
          .filter(
            (x) => x !== u.id && (!recipients.length || recipients.includes(x)),
          )
          .forEach((x) => {
            const role =
              x === d.mentor
                ? "company"
                : x === d.user
                  ? "student"
                  : x === d.tutor
                    ? "tutor"
                    : "stages";
            notify(
              s,
              x,
              role,
              "Nouveau message dans un salon du projet.",
              role === "company",
            );
          });
      }
      break;
    case "transition":
      requireRole(s, ["stages", "m1"]);
      business("transition");
      if (!p.ids?.length) throw Error("Sélectionnez au moins un étudiant M1.");
      if (
        !["Passer en M2", "Redoublement", "Sortie MIAGE"].includes(p.decision)
      )
        throw Error("Décision invalide.");
      for (const student of p.ids) {
        const st = scopedStudents(s).find(
          (x) => x.id === student && x.promo === "M1",
        );
        if (!st) throw Error("Sélection hors périmètre M1.");
      }
      if (r === "stages")
        s.decisions
          .filter((x) => p.ids.includes(x.student) && x.status === "Proposée")
          .forEach((x) => (x.status = "Décision reçue"));
      for (const student of p.ids) {
        s.decisions.unshift({
          id: id("dec"),
          student,
          decision: p.decision,
          author: u.id,
          status: r === "m1" ? "Proposée" : "Appliquée",
          date: "2026-11-21",
        });
        if (r === "stages") {
          const st = s.students.find((x) => x.id === student);
          if (p.decision === "Passer en M2") {
            if (["Stage temps plein", "Stage alterné", "Césure", "Contrat de professionnalisation"].includes(st.contract)) {
              s.history.push({ type: "Contrat archivé", student: st.id, before: structuredClone(st), date: new Date().toISOString(), reason: "Bascule annuelle" });
              st.status = "Clôturé";
            }
            st.promo = "M2";
          } else st.status = p.decision;
        }
      }
      s.users
        .filter((x) => x.roles.includes(r === "m1" ? "stages" : "m1"))
        .forEach((x) =>
          notify(
            s,
            x.id,
            r === "m1" ? "stages" : "m1",
            r === "m1"
              ? "Une proposition de bascule attend votre décision."
              : "Une décision de bascule a été appliquée.",
          ),
        );
      break;
    case "bulkStatus":
      requireRole(s, ["stages"]);
      business("cohort");
      if (!["En cours", "En recherche", "Clôturé"].includes(p.status))
        throw Error("Statut non autorisé.");
      if (
        !p.ids?.length ||
        p.ids.some((id) => !scopedStudents(s).some((x) => x.id === id))
      )
        throw Error("Sélection invalide.");
      p.ids.forEach(
        (id) => (s.students.find((x) => x.id === id).status = p.status),
      );
      break;
    case "bulkInfo":
      requireRole(s, ["stages"]);
      business("cohort");
      need(p.text, "Le message d’information est obligatoire.");
      p.ids.forEach((id) => {
        const st = dossier(s, id);
        if (st.user) notify(s, st.user, "student", p.text, true);
        else
          s.emails.push({
            to: st.email,
            text: p.text,
            date: new Date().toLocaleString("fr-FR"),
          });
      });
      break;
    case "auditMessage":
      throw Error("L’audit des messages privés est interdit à l’administrateur.");
    default:
      throw Error("Action inconnue.");
  }
  log(
    s,
    {
      permissions: "Changement de droits",
      settings: "Paramètres",
      message: "Message",
      transition: "Bascule",
    }[action] || "Action métier",
    action + (p.reason ? " · Motif : " + p.reason : ""),
  );
}
function openRoom(s, d) {
  if (
    d.tutor &&
    d.mentor &&
    s.users.find((u) => u.id === d.tutor)?.active &&
    s.users.find((u) => u.id === d.mentor)?.active &&
    !s.rooms.some((x) => x.student === d.id && x.cycle === d.cycle)
  )
    s.rooms.push({
      id: id("room"),
      student: d.id,
      cycle: d.cycle,
      actors: participants(s, d),
      summary: { name: d.name, company: d.company },
      closed: false,
      messages: [],
    });
}
const CSV_REQUIRED = ["nom", "email", "promotion"];
const CSV_LIMIT = 10000;
const CSV_EMAIL =
  /^[^\s@()<>\[\],;:\\"\x00-\x1f\x7f-\x9f]+@[^\s@()<>\[\],;:\\"\x00-\x1f\x7f-\x9f]+$/u;
// Un défaut de structure découvert à l’analyse ne disparaît pas si l’aperçu est modifié.
const csvSyntaxErrors = new WeakMap();
const csvPreview = new WeakMap();
const importReasons = new Set([
  "CSV mal formé : guillemets invalides",
  "CSV mal formé : nombre de colonnes incorrect",
  "Nom manquant",
  "Nom invalide",
  "E-mail invalide",
  "Promotion attendue : M1 ou M2",
  "Ville invalide",
  "Doublon dans le fichier",
  "E-mail ambigu dans les dossiers existants",
  "E-mail ambigu dans les comptes existants",
  "Identifiant de dossier existant incohérent",
  "E-mail déjà utilisé par un compte non lié",
  "Compte étudiant lié incohérent",
  "Nom différent du compte étudiant lié",
  "Ligne ou identité modifiée depuis l’aperçu",
  "Ligne rejetée à l’aperçu",
]);

function parseCSVLine(line, sep) {
  const values = [];
  let value = "",
    state = "start",
    error = "";
  const push = () => {
    values.push(value.trim());
    value = "";
    state = "start";
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (state === "quoted") {
      if (c === '"' && line[i + 1] === '"') {
        value += '"';
        i++;
      } else if (c === '"') state = "closed";
      else value += c;
    } else if (c === sep) push();
    else if (state === "start" && /\s/.test(c)) continue;
    else if (state === "start" && c === '"') state = "quoted";
    else if (state === "closed" && /\s/.test(c)) continue;
    else {
      if (c === '"' || state === "closed")
        error = "CSV mal formé : guillemets invalides";
      value += c;
      state = "unquoted";
    }
  }
  if (state === "quoted") error = "CSV mal formé : guillemets invalides";
  push();
  return { values, error };
}

const importText = (value) => (typeof value === "string" ? value.trim() : "");
const importEmail = (value) => importText(value).toLowerCase();
const normalizedImportName = (value) =>
  importText(value).replace(/\s+/g, " ").toLocaleLowerCase("fr");

function validImportEmail(email) {
  if (!CSV_EMAIL.test(email)) return false;
  const [local, domain] = email.split("@");
  const labels = domain.split(".");
  return (
    !local.startsWith(".") &&
    !local.endsWith(".") &&
    !local.includes("..") &&
    labels.length > 1 &&
    labels.every(
      (label) =>
        /^[\p{L}\p{M}\p{N}-]+$/u.test(label) &&
        !label.startsWith("-") &&
        !label.endsWith("-"),
    )
  );
}

function importIndex(items, key) {
  const index = new Map();
  for (const item of items) {
    const k = key(item);
    if (!k) continue;
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(item);
  }
  return index;
}

// Même contrôle pour l’aperçu et la confirmation, sur l’état courant.
function validateImportRows(s, rows) {
  const studentsByEmail = importIndex(s.students, (x) => importEmail(x?.email));
  const studentsById = importIndex(s.students, (x) => x?.id);
  const usersByEmail = importIndex(s.users, (x) => importEmail(x?.email));
  const usersById = importIndex(s.users, (x) => x?.id);
  const studentsByUser = importIndex(s.students, (x) => x?.user);
  const seen = new Set();
  return rows.map((input) => {
    const row =
      input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const nom = importText(row.nom),
      email = importEmail(row.email),
      promotion = importText(row.promotion).toUpperCase(),
      ville = importText(row.ville);
    const students = studentsByEmail.get(email) || [];
    const users = usersByEmail.get(email) || [];
    const syntaxError = csvSyntaxErrors.get(row) || "";
    const preview = csvPreview.get(row);
    const previewError = row.error
      ? importReasons.has(row.error)
        ? row.error
        : "Ligne rejetée à l’aperçu"
      : "";
    let error = syntaxError || preview?.error || previewError;
    if (!error) {
      if (!nom) error = "Nom manquant";
      else if (/[\r\n]/.test(row.nom)) error = "Nom invalide";
      else if (
        (typeof row.email === "string" && /[\r\n]/.test(row.email)) ||
        !validImportEmail(email)
      ) error = "E-mail invalide";
      else if (!["M1", "M2"].includes(promotion) || /[\r\n]/.test(row.promotion))
        error = "Promotion attendue : M1 ou M2";
      else if (
        row.ville != null &&
        (typeof row.ville !== "string" || /[\r\n]/.test(row.ville))
      ) error = "Ville invalide";
      else if (seen.has(email)) error = "Doublon dans le fichier";
      else if (students.length > 1)
        error = "E-mail ambigu dans les dossiers existants";
      else if (users.length > 1)
        error = "E-mail ambigu dans les comptes existants";
      else if (
        students.length &&
        (typeof students[0].id !== "string" ||
          !students[0].id.trim() ||
          (studentsById.get(students[0].id) || []).length !== 1)
      )
        error = "Identifiant de dossier existant incohérent";
      else if (
        preview &&
        (preview.nom !== nom ||
          preview.email !== email ||
          preview.promotion !== promotion ||
          preview.ville !== ville ||
          preview.student !== (students[0]?.id ?? null) ||
          preview.user !== (students[0]?.user ?? null))
      )
        error = "Ligne ou identité modifiée depuis l’aperçu";
      else {
        const student = students[0];
        if (student?.user) {
          const linked = usersById.get(student.user) || [];
          if (
            linked.length !== 1 ||
            users.length !== 1 ||
            linked[0] !== users[0] ||
            !Array.isArray(linked[0].roles) ||
            !linked[0].roles.includes("student") ||
            (studentsByUser.get(student.user) || []).length !== 1
          )
            error = "Compte étudiant lié incohérent";
          else if (
            !normalizedImportName(linked[0].name) ||
            normalizedImportName(nom) !== normalizedImportName(linked[0].name)
          )
            error = "Nom différent du compte étudiant lié";
        } else if (users.length)
          error = "E-mail déjà utilisé par un compte non lié";
      }
    }
    // Une ligne rejetée ne réserve pas l’adresse au détriment d’une ligne valide ultérieure.
    if (!error) seen.add(email);
    const result = {
      ...row,
      nom,
      email,
      promotion,
      ville,
      error,
      kind: students.length ? "Mise à jour" : "Création",
    };
    if (syntaxError) csvSyntaxErrors.set(result, syntaxError);
    return result;
  });
}

export function parseCSV(text, s) {
  if (typeof text !== "string")
    throw Error("Le contenu CSV doit être du texte.");
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  const headerLine = lines.findIndex((line) => line.trim());
  const header = headerLine < 0 ? "" : lines[headerLine];
  const candidates = [";", ","].map((sep) => {
    const parsed = parseCSVLine(header, sep);
    return {
      sep,
      ...parsed,
      headers: parsed.values.map((x) => x.toLowerCase()),
    };
  });
  const matches = candidates.filter(
    (x) => !x.error && CSV_REQUIRED.every((k) => x.headers.includes(k)),
  );
  if (!matches.length) {
    if (candidates.some((x) => x.error))
      throw Error("En-tête CSV mal formé : guillemets invalides.");
    throw Error(
      "Colonnes requises : nom, email, promotion. Séparateur : point-virgule ou virgule.",
    );
  }
  if (matches.length > 1) throw Error("En-tête CSV : séparateur ambigu.");
  const chosen = matches[0];
  const { sep, headers } = chosen;
  if (headers.some((h) => !h)) throw Error("En-tête CSV : colonne sans nom.");
  if (new Set(headers).size !== headers.length)
    throw Error("En-tête CSV : colonnes en double.");
  if (headers.some((h) => ["line", "error", "kind"].includes(h)))
    throw Error("En-tête CSV : nom de colonne réservé.");
  const rows = [];
  for (let i = headerLine + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (rows.length === CSV_LIMIT)
      throw Error("L’import doit contenir de 1 à 10 000 lignes.");
    const parsed = parseCSVLine(lines[i], sep);
    const row = {
      ...Object.fromEntries(headers.map((h, j) => [h, parsed.values[j] || ""])),
      line: i + 1,
    };
    const syntaxError =
      parsed.error ||
      (parsed.values.length !== headers.length
        ? "CSV mal formé : nombre de colonnes incorrect"
        : "");
    if (syntaxError) csvSyntaxErrors.set(row, syntaxError);
    rows.push(row);
  }
  const checked = validateImportRows(s, rows);
  const studentsByEmail = importIndex(s.students, (x) => importEmail(x?.email));
  for (const row of checked) {
    const student = studentsByEmail.get(row.email)?.[0];
    csvPreview.set(row, {
      nom: row.nom,
      email: row.email,
      promotion: row.promotion,
      ville: row.ville,
      error: row.error,
      student: student?.id ?? null,
      user: student?.user ?? null,
    });
  }
  return checked;
}
export function importRows(s, rows, file) {
  requireRole(s, ["stages"]);
  if (!can("stages", "imports", s, "validate"))
    throw Error("Import non autorisé.");
  if (!Array.isArray(rows) || !rows.length || rows.length > CSV_LIMIT)
    throw Error("L’import doit contenir de 1 à 10 000 lignes.");
  rows = validateImportRows(s, rows);
  const studentsByEmail = importIndex(s.students, (x) => importEmail(x?.email));
  const usersById = importIndex(s.users, (x) => x?.id);
  const studentIds = new Set(s.students.map((x) => x?.id));
  const nextSuffix = new Map();
  const counters = { created: 0, updated: 0, rejected: 0 };
  rows.forEach((row) => {
    if (row.error) {
      counters.rejected++;
      return;
    }
    const old = studentsByEmail.get(row.email)?.[0];
    if (old) {
      // Le compte lié fait autorité : ne pas créer deux noms pour la même identité.
      old.name = old.user ? usersById.get(old.user)[0].name : row.nom;
      old.promo = row.promotion;
      if (row.ville) old.city = row.ville;
      counters.updated++;
    } else {
      const baseId = id("s");
      let studentId = baseId,
        suffix = nextSuffix.get(baseId) || 1;
      while (studentIds.has(studentId)) studentId = baseId + "-" + suffix++;
      nextSuffix.set(baseId, suffix);
      studentIds.add(studentId);
      s.students.push({
        id: studentId,
        name: row.nom,
        email: row.email,
        promo: row.promotion,
        contract: "Sans contrat",
        company: "—",
        city: row.ville || "Amiens",
        tutor: null,
        mentor: null,
        status: "En recherche",
        step: 0,
        cycle: 1,
        access: "À déclarer",
      });
      counters.created++;
    }
  });
  s.imports.unshift({
    id: id("i"),
    date: new Date().toLocaleString("sv-SE").slice(0, 16),
    author: s.session.user,
    file,
    ...counters,
    reasons: [...new Set(rows.filter((x) => x.error).map((x) => x.error))].join(
      " · ",
    ),
  });
  log(
    s,
    "Import",
    `${counters.created} créations · ${counters.updated} mises à jour · ${counters.rejected} rejets`,
  );
  return counters;
}
