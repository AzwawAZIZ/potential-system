/**
 * Affectations locales, sans stockage, horloge globale, notification ni réseau.
 *
 * API (mutations synchrones de l'état s, données JSON ordinaires) :
 * - affectationCreate(s, p, {id, now}) : rôle actif stages, droit missions:write.
 *   p = {student, tutor, title, description, contract, company, city, address,
 *        start, end, cycle?, attachment?}. id est une chaîne unique ou une
 *   fonction pure appelée avec "m". now est obligatoire (voir ci-dessous).
 * - affectationReply(s, p, u, {now}) : rôle actif tutor, droit missions:validate.
 *   p = {id, decision: "Accepter"|"Refuser"|"Précisions", reason?, student?,
 *        cycle?}. Le motif est requis sauf pour Accepter. u est l'objet du compte
 *   ou son identifiant ; il doit correspondre à la session et au tuteur proposé.
 * - affectationFinalize(s, p, u, {now}) : rôle actif stages, droit
 *   missions:validate. p = {id, decision?: "Accepter"|"Refuser", reason?,
 *   student?, cycle?} ; défaut Accepter, motif requis pour Refuser. u est
 *   contrôlé comme ci-dessus. Seule l'acceptation affecte et vérifie la charge.
 *
 * now est une Date, un nombre de millisecondes Unix, une chaîne UTC canonique
 * YYYY-MM-DDTHH:mm:ss.sssZ ou une fonction pure qui renvoie une de ces valeurs.
 * Il sert aussi à contrôler l'expiration de session. p.cycle et p.student sont
 * des contrôles optionnels de formulaire périmé, pas des valeurs de remplacement.
 * Les fonctions lèvent une erreur AVANT toute mutation si une validation échoue.
 * Elles renvoient {mission, student, legacy, previousTutor, conflictIds, openRoom}
 * (mission et student sont des références dans s). L'appelant déclenche ensuite
 * ses éventuelles notifications locales et openRoom si openRoom vaut true.
 *
 * Les nouvelles propositions portent snapshot (le projet), studentBefore (tout
 * le dossier JSON au moment de la proposition), et proposalSignature (une
 * représentation canonique, NON cryptographique). Toute modification du dossier
 * ou des éléments proposés entre création, avis et décision est refusée. L'avis
 * favorable porte à son tour la signature du projet approuvé. Une comparaison de
 * valeurs ne détecte pas un changement suivi d'un retour à la valeur initiale.
 *
 * Compatibilité v1 : une mission réellement "En attente" sans propriété snapshot
 * est traitée uniquement si l'étudiant est au cycle 1, que son cycle éventuel est
 * 1 et qu'aucun contrat de cet étudiant n'est archivé. L'avis favorable mémorise
 * le dossier tel qu'il est à cet instant, pas un projet prétendument proposé ;
 * la décision finale laisse contract/company/city/address/start/end inchangés.
 * Un ancien avis favorable non passé par cette fonction, un snapshot partiel ou
 * un cycle incertain sont refusés. Les modifications antérieures à l'avis d'une
 * mission v1 ne peuvent être détectées faute de référence historique.
 *
 * Concurrence : les contrôles s'appliquent à l'état s le plus récent, dans une
 * opération JS synchrone. localStorage ne fournit pas de compare-and-swap : pour
 * plusieurs onglets/processus, le caller doit sérialiser lecture de l'état frais,
 * mutation et persistance sous un verrou partagé, ou utiliser un stockage
 * transactionnel/versionné avec vérification atomique. Sans cela, une copie
 * périmée peut écraser une autre opération ; ce module ne prétend pas l'éviter.
 * Les fonctions supposent des tableaux/objets JSON modifiables et des callbacks
 * d'id/horloge sans effet sur s. L'identité locale est simulée, non sécurisée.
 */

const affectationContracts = ["Apprentissage", "Stage alterné", "Stage temps plein", "Contrat de professionnalisation", "Césure"];
const affectationProjectFields = ["contract", "company", "city", "address", "start", "end"];
const affectationPendingStatuses = ["En attente", "Avis favorable du tuteur", "Précisions demandées"];

function affectationObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error(`${label} : objet requis.`);
  return value;
}
function affectationString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw Error(`${label} : valeur requise.`);
  return value;
}
function affectationCycle(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw Error("Cycle invalide ou ambigu.");
  return value;
}
function affectationClock(options) {
  affectationObject(options, "Options");
  let value = typeof options.now === "function" ? options.now() : options.now;
  if (typeof value === "string") {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw Error("Horodatage UTC invalide.");
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) throw Error("Horodatage UTC invalide.");
    value = parsed.getTime();
  } else if (value instanceof Date) value = value.getTime();
  if (typeof value !== "number" || !Number.isFinite(value)) throw Error("Horloge explicite requise.");
  const clock = new Date(value);
  if (!Number.isFinite(clock.getTime())) throw Error("Horloge invalide.");
  return { ms: clock.getTime(), date: clock.toISOString() };
}
function affectationCopy(value) {
  const json = JSON.stringify(value);
  if (json === undefined) throw Error("Données JSON requises.");
  return JSON.parse(json);
}
function affectationCanonical(value) {
  const copied = affectationCopy(value);
  function affectationSorted(item) {
    if (Array.isArray(item)) return item.map(affectationSorted);
    if (item && typeof item === "object") return Object.fromEntries(Object.keys(item).sort().map((key) => [key, affectationSorted(item[key])]));
    return item;
  }
  return JSON.stringify(affectationSorted(copied));
}
function affectationDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
function affectationValidateProject(project) {
  affectationObject(project, "Projet");
  if (!affectationContracts.includes(project.contract)) throw Error("Type de contrat invalide.");
  for (const field of ["company", "city", "address"]) {
    affectationString(project[field], field);
    if (project[field].trim() === "—") throw Error(`${field} : valeur requise.`);
  }
  if (!affectationDate(project.start) || !affectationDate(project.end) || project.end <= project.start) {
    throw Error("Dates invalides : la fin doit être postérieure au début.");
  }
}
function affectationState(s) {
  affectationObject(s, "État");
  for (const key of ["users", "students", "missions", "history"]) if (!Array.isArray(s[key])) throw Error(`État invalide : ${key}.`);
  for (const key of ["users", "students", "missions"]) {
    const ids = new Set();
    for (const item of s[key]) {
      affectationObject(item, key);
      affectationString(item.id, `${key}.id`);
      if (ids.has(item.id)) throw Error(`Identifiant ${key} en double : état ambigu.`);
      ids.add(item.id);
    }
  }
}
function affectationActor(s, u, role, mode, clock) {
  const session = s.session;
  if (!session || session.role !== role || typeof session.user !== "string") throw Error("Accès refusé : rôle actif incorrect.");
  const actorId = typeof u === "string" ? u : u?.id;
  if (u !== undefined && actorId !== session.user) throw Error("Accès refusé : identité de session incorrecte.");
  const actor = s.users.find((item) => item.id === session.user);
  const minutes = s.settings?.sessionMinutes ?? 60;
  if (!actor || actor.active !== true || !Array.isArray(actor.roles) || !actor.roles.includes(role) ||
      !Number.isFinite(session.lastActivity) || !Number.isFinite(minutes) || minutes <= 0 ||
      clock.ms < session.lastActivity || clock.ms - session.lastActivity > minutes * 60_000) {
    throw Error("Accès refusé : compte ou session inactive.");
  }
  if (s.overrides?.[role]?.missions === false || s.overrides?.[role]?.[`missions:${mode}`] === false) {
    throw Error("Accès refusé : permission missions retirée.");
  }
  return actor;
}
function affectationStudent(s, id) {
  affectationString(id, "Étudiant");
  const student = s.students.find((item) => item.id === id);
  if (!student) throw Error("Étudiant introuvable.");
  affectationCycle(student.cycle);
  if (typeof student.status !== "string" || !Number.isFinite(student.step)) throw Error("Dossier étudiant invalide.");
  return student;
}
function affectationTutor(s, id) {
  affectationString(id, "Tuteur");
  const tutor = s.users.find((item) => item.id === id);
  if (!tutor || tutor.active !== true || !Array.isArray(tutor.roles) || !tutor.roles.includes("tutor")) {
    throw Error("Sélectionnez un tuteur actif.");
  }
  return tutor;
}
function affectationExpected(p, student) {
  if (p.student !== undefined && p.student !== student.id) throw Error("Étudiant différent de la proposition.");
  if (p.cycle !== undefined && p.cycle !== student.cycle) throw Error("Cycle du formulaire périmé.");
}
function affectationMission(s, p) {
  affectationObject(p, "Paramètres");
  affectationString(p.id, "Mission");
  const mission = s.missions.find((item) => item.id === p.id);
  if (!mission || !Array.isArray(mission.history)) throw Error("Mission introuvable ou historique invalide.");
  const student = affectationStudent(s, mission.student);
  affectationExpected(p, student);
  return { mission, student };
}
function affectationLegacyCycle(s, mission, student) {
  if (student.cycle !== 1 || (Object.hasOwn(mission, "cycle") && mission.cycle !== 1) ||
      s.history.some((item) => item?.type === "Contrat archivé" && item.student === student.id)) {
    throw Error("Cycle de l'ancienne mission ambigu ou périmé.");
  }
}
function affectationDetails(mission, baseline, legacy) {
  return {
    id: mission.id, student: mission.student, tutor: mission.tutor,
    cycle: legacy ? 1 : mission.cycle,
    title: mission.title, description: mission.description,
    attachment: mission.attachment ?? null,
    ...(legacy ? { legacy: true, studentBeforeAvis: baseline } : {
      snapshot: mission.snapshot, studentBefore: baseline,
      createdAt: mission.createdAt, createdBy: mission.createdBy,
    }),
  };
}
function affectationCheckDetails(s, mission, student, legacy, baseline) {
  affectationString(mission.title, "Intitulé");
  affectationString(mission.description, "Description");
  affectationString(mission.tutor, "Tuteur");
  if (legacy) affectationLegacyCycle(s, mission, student);
  else {
    if (affectationCycle(mission.cycle) !== student.cycle) throw Error("Mission d'un cycle périmé.");
    affectationValidateProject(mission.snapshot);
    affectationObject(mission.studentBefore, "Référence du dossier");
    if (mission.studentBefore.id !== student.id || mission.studentBefore.cycle !== student.cycle ||
        typeof mission.proposalSignature !== "string" ||
        affectationCanonical(affectationDetails(mission, mission.studentBefore, false)) !== mission.proposalSignature) {
      throw Error("Proposition modifiée ou incomplète depuis sa création.");
    }
  }
  if (baseline && affectationCanonical(baseline) !== affectationCanonical(student)) {
    throw Error("Dossier modifié depuis la proposition ou l'avis : décision périmée.");
  }
}
function affectationResult(mission, student, legacy, previousTutor = null, conflictIds = [], openRoom = false) {
  return { mission, student, legacy, previousTutor, conflictIds, openRoom };
}

export function affectationCreate(s, p, options) {
  affectationState(s);
  affectationObject(p, "Paramètres");
  const clock = affectationClock(options);
  const actor = affectationActor(s, undefined, "stages", "write", clock);
  const student = affectationStudent(s, p.student);
  affectationExpected(p, student);
  const tutor = affectationTutor(s, p.tutor);
  affectationString(p.title, "Intitulé");
  affectationString(p.description, "Description");
  const snapshot = Object.fromEntries(affectationProjectFields.map((field) => [field, p[field]]));
  affectationValidateProject(snapshot);
  const studentBefore = affectationCopy(student);
  const attachment = p.attachment === undefined ? undefined : affectationCopy(p.attachment);
  const newId = typeof options.id === "function" ? options.id("m") : options.id;
  affectationString(newId, "Identifiant de mission");
  if (s.missions.some((item) => item.id === newId)) throw Error("Identifiant de mission déjà utilisé.");
  const mission = {
    id: newId, student: student.id, tutor: tutor.id, cycle: student.cycle,
    title: p.title, description: p.description,
    ...(attachment === undefined ? {} : { attachment }),
    snapshot, studentBefore, createdAt: clock.date, createdBy: actor.id,
    status: "En attente", history: [],
  };
  mission.proposalSignature = affectationCanonical(affectationDetails(mission, studentBefore, false));
  s.missions.unshift(mission);
  return affectationResult(mission, student, false);
}

export function affectationReply(s, p, u, options) {
  affectationState(s);
  const clock = affectationClock(options);
  const actor = affectationActor(s, u, "tutor", "validate", clock);
  if (u === undefined) throw Error("Identité du tuteur requise.");
  const { mission, student } = affectationMission(s, p);
  if (mission.status !== "En attente") throw Error("Cette mission n’est plus en attente.");
  if (mission.tutor !== actor.id) throw Error("Seul le tuteur proposé peut répondre.");
  if (!["Accepter", "Refuser", "Précisions"].includes(p.decision)) throw Error("Avis invalide.");
  if (p.decision !== "Accepter") affectationString(p.reason, "Motif ou demande de précisions");
  const legacy = !Object.hasOwn(mission, "snapshot");
  affectationCheckDetails(s, mission, student, legacy, legacy ? null : mission.studentBefore);
  let approval;
  if (p.decision === "Accepter") {
    const baseline = legacy ? affectationCopy(student) : mission.studentBefore;
    approval = {
      actor: actor.id, date: clock.date,
      signature: affectationCanonical(affectationDetails(mission, baseline, legacy)),
      ...(legacy ? { legacy: true, studentBeforeAvis: baseline } : {}),
    };
  }
  const status = p.decision === "Accepter" ? "Avis favorable du tuteur" : p.decision === "Refuser" ? "Refusée" : "Précisions demandées";
  const entry = { decision: status, reason: p.reason || "", date: clock.date, author: actor.id };
  mission.status = status;
  mission.history.push(entry);
  if (approval) mission.approval = approval;
  return affectationResult(mission, student, legacy);
}

export function affectationFinalize(s, p, u, options) {
  affectationState(s);
  const clock = affectationClock(options);
  const actor = affectationActor(s, u, "stages", "validate", clock);
  if (u === undefined) throw Error("Identité du responsable stages requise.");
  const { mission, student } = affectationMission(s, p);
  if (mission.status !== "Avis favorable du tuteur") throw Error("Un avis favorable du tuteur est requis pour la décision finale.");
  const decision = p.decision === undefined ? "Accepter" : p.decision;
  if (!["Accepter", "Refuser"].includes(decision)) throw Error("Décision finale invalide.");
  if (decision === "Refuser") affectationString(p.reason, "Motif de refus");
  const legacy = !Object.hasOwn(mission, "snapshot");
  const approval = affectationObject(mission.approval, "Avis du tuteur");
  if (approval.actor !== mission.tutor || typeof approval.date !== "string" || typeof approval.signature !== "string" ||
      !mission.history.some((item) => item?.decision === "Avis favorable du tuteur" && item.author === approval.actor && item.date === approval.date)) {
    throw Error("Avis du tuteur invalide ou incomplet.");
  }
  if (legacy && approval.legacy !== true) throw Error("Ancien avis favorable sans référence vérifiable.");
  if (!legacy && approval.legacy === true) throw Error("Avis incohérent avec la proposition.");
  const baseline = legacy ? affectationObject(approval.studentBeforeAvis, "Référence à l'avis") : mission.studentBefore;
  affectationCheckDetails(s, mission, student, legacy, baseline);
  if (baseline.id !== student.id || baseline.cycle !== student.cycle ||
      approval.signature !== affectationCanonical(affectationDetails(mission, baseline, legacy))) {
    throw Error("Projet modifié depuis l'avis du tuteur.");
  }
  const entry = { decision: decision === "Accepter" ? "Acceptée" : "Refusée par stages", reason: p.reason || "", date: clock.date, author: actor.id };
  if (decision === "Refuser") {
    mission.status = entry.decision;
    mission.history.push(entry);
    return affectationResult(mission, student, legacy);
  }
  const tutor = affectationTutor(s, mission.tutor);
  if (tutor.available !== true || !Number.isSafeInteger(tutor.capacity) || tutor.capacity < 1) {
    throw Error("Disponibilité ou capacité du tuteur invalide.");
  }
  const load = s.students.filter((item) => item.tutor === tutor.id).length;
  const additional = student.tutor === tutor.id ? 0 : 1;
  if (load + additional > tutor.capacity) throw Error("Capacité du tuteur atteinte.");
  const conflicts = [];
  for (const other of s.missions) {
    if (other.id === mission.id || other.student !== student.id || !affectationPendingStatuses.includes(other.status)) continue;
    let sameCycle = other.cycle === student.cycle;
    if (!Object.hasOwn(other, "cycle") && student.cycle === 1) {
      sameCycle = !s.history.some((item) => item?.type === "Contrat archivé" && item.student === student.id);
    }
    if (!sameCycle) continue;
    if (!Array.isArray(other.history)) throw Error("Historique d'une proposition concurrente invalide.");
    conflicts.push(other);
  }
  const previousTutor = student.tutor || null;
  const oldTutorHistory = previousTutor && previousTutor !== tutor.id ? {
    type: "Ancien tuteur", student: student.id, tutor: previousTutor,
    cycle: student.cycle, date: clock.date, author: actor.id,
  } : null;
  const conflictEntry = { decision: "Conflit d’affectation", reason: `Mission ${mission.id} acceptée pour ce cycle.`, date: clock.date, author: actor.id };
  // Les validations et constructions ci-dessus précèdent toute mutation.
  if (oldTutorHistory) s.history.push(oldTutorHistory);
  if (!legacy) Object.assign(student, mission.snapshot);
  student.tutor = tutor.id;
  student.status = "En cours";
  student.step = Math.max(2, student.step);
  mission.status = "Acceptée";
  mission.history.push(entry);
  for (const other of conflicts) {
    other.status = "Conflit d’affectation";
    other.history.push({ ...conflictEntry });
  }
  return affectationResult(mission, student, legacy, previousTutor, conflicts.map((item) => item.id), true);
}
