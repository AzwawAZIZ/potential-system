import test from "node:test";
import assert from "node:assert/strict";
import { seed } from "../seed.js";
import { archivedRooms, can, crasFor, dossier, messages, mutate } from "../domain.js";

// Les identifiants renvoient au jeu fictif de seed() ; tous les contenus ajoutés
// ci-dessous sont synthétiques. Une session n'implique pas les autres rôles du compte.
function as(s, user, role) {
  s.session = { user, role, lastActivity: Date.now() };
  return s;
}
function fresh(user = "sophie", role = "stages") {
  return as(seed(), user, role);
}
function refusedUnchanged(s, action, payload) {
  const before = structuredClone(s);
  assert.throws(() => mutate(s, action, payload), undefined, action);
  assert.deepEqual(s, before, `Le rejet de ${action} doit être atomique`);
}
function student(s, id) {
  return s.students.find((d) => d.id === id);
}
function room(s, id) {
  return s.rooms.find((r) => r.id === id);
}
function hasMessage(list, id) {
  return list.some((m) => m.id === id);
}

const proposal = () => ({
  student: "s5",
  tutor: "sophie",
  title: "Mission fictive de test",
  description: "Description fictive de la mission",
  company: "Entreprise fictive A",
  address: "1 rue Imaginaire",
  city: "Ville fictive",
  start: "2027-01-15",
  end: "2027-08-15",
  contract: "Stage temps plein",
  attachment: { name: "mission-fictive.pdf", size: 42 },
});

// Pour tester les étapes indépendamment d'une étape encore non développée.
function withMission(status = "En attente") {
  const s = fresh();
  s.missions.push({
    id: "mission-fictive",
    ...proposal(),
    cycle: student(s, "s5").cycle,
    status,
    history: [],
  });
  return s;
}

test("Mission : la proposition complète reste distincte du dossier et des affectations", () => {
  const s = fresh();
  const p = proposal();
  mutate(s, "mission", p);
  const saved = s.missions.find((m) => m.title === p.title);
  assert.ok(saved, "la proposition doit être enregistrée");
  for (const field of ["student", "tutor", "title", "description", "company", "address", "city", "start", "end", "contract"]) {
    assert.equal(saved[field], p[field], `champ de proposition ${field}`);
  }
  assert.deepEqual(saved.attachment, p.attachment);
  assert.equal(saved.cycle, student(s, p.student).cycle);
  assert.equal(saved.status, "En attente");
});

test("Mission : proposer n'altère aucun dossier, compte ou salon", () => {
  const s = fresh();
  const beforeStudents = structuredClone(s.students);
  const beforeUsers = structuredClone(s.users);
  const beforeRooms = structuredClone(s.rooms);
  mutate(s, "mission", proposal());
  assert.deepEqual(s.students, beforeStudents, "aucun champ du dossier ne change à la proposition");
  assert.deepEqual(s.users, beforeUsers, "aucun compte tuteur ou entreprise ne change");
  assert.deepEqual(s.rooms, beforeRooms, "une proposition n'ouvre pas de salon d'affectation");
});

test("Mission : l'acceptation du tuteur produit l'avis favorable exact", () => {
  const s = withMission();
  as(s, "sophie", "tutor");
  mutate(s, "missionDecision", { id: "mission-fictive", decision: "Accepter" });
  assert.equal(s.missions.find((item) => item.id === "mission-fictive").status, "Avis favorable du tuteur");
});

test("Mission : l'avis du tuteur ne réalise aucune affectation", () => {
  const s = withMission();
  const beforeStudents = structuredClone(s.students);
  const beforeRooms = structuredClone(s.rooms);
  as(s, "sophie", "tutor");
  mutate(s, "missionDecision", { id: "mission-fictive", decision: "Accepter" });
  assert.deepEqual(s.students, beforeStudents);
  assert.deepEqual(s.rooms, beforeRooms);
});

test("Mission : une seconde décision du tuteur est refusée", () => {
  const s = withMission("Avis favorable du tuteur");
  as(s, "sophie", "tutor");
  for (const decision of ["Accepter", "Refuser", "Précisions"]) {
    refusedUnchanged(s, "missionDecision", { id: "mission-fictive", decision, reason: "Motif fictif" });
  }
});

test("Mission : seule l'affectation par stages applique la proposition approuvée", () => {
  const s = withMission("Avis favorable du tuteur");
  as(s, "sophie", "tutor");
  refusedUnchanged(s, "missionAssign", { id: "mission-fictive" });
  as(s, "lucie", "student");
  refusedUnchanged(s, "missionAssign", { id: "mission-fictive" });
  as(s, "sophie", "stages");
  mutate(s, "missionAssign", { id: "mission-fictive" });
  const d = student(s, "s5");
  const p = proposal();
  for (const field of ["tutor", "company", "address", "city", "start", "end", "contract"]) {
    assert.equal(d[field], p[field], `affectation : ${field}`);
  }
  assert.equal(d.cycle, 1);
  refusedUnchanged(s, "missionAssign", { id: "mission-fictive" });
});

test("Mission : une proposition en attente ou refusée n'est pas affectable", () => {
  for (const status of ["En attente", "Refusée", "Précisions demandées"]) {
    const s = withMission(status);
    refusedUnchanged(s, "missionAssign", { id: "mission-fictive" });
  }
});

for (const when of ["decision", "assign"]) {
  for (const condition of ["indisponible", "complet", "cycle changé"]) {
    test(`Mission : ${when}, tuteur ${condition} : refus atomique`, () => {
      const s = withMission(when === "decision" ? "En attente" : "Avis favorable du tuteur");
      const tutor = s.users.find((u) => u.id === "sophie");
      if (condition === "indisponible") tutor.available = false;
      if (condition === "complet") tutor.capacity = s.students.filter((d) => d.tutor === tutor.id).length;
      if (condition === "cycle changé") student(s, "s5").cycle += 1;
      if (when === "decision") {
        as(s, "sophie", "tutor");
        refusedUnchanged(s, "missionDecision", { id: "mission-fictive", decision: "Accepter" });
      } else {
        as(s, "sophie", "stages");
        refusedUnchanged(s, "missionAssign", { id: "mission-fictive" });
      }
    });
  }
}

test("Mission : affectation refusée si le tuteur est devenu inactif", () => {
  const s = withMission("Avis favorable du tuteur");
  s.users.find((u) => u.id === "sophie").active = false;
  s.users.push({ id: "stage-test", name: "Responsable fictif", roles: ["stages"], active: true });
  as(s, "stage-test", "stages");
  refusedUnchanged(s, "missionAssign", { id: "mission-fictive" });
});

test("CRA : lecture seule pour l'entreprise, limitée aux étudiants attribués", () => {
  const s = fresh("marc", "company");
  assert.equal(can("company", "cra", s), true);
  assert.equal(can("company", "cra", s, "write"), false);
  assert.equal(can("company", "cra", s, "validate"), false);
  assert.equal(dossier(s, "s1", "cra").id, "s1");
  assert.throws(() => dossier(s, "s4", "cra"));
  s.overrides.company = { cra: true, "cra:write": true, "cra:validate": true };
  assert.equal(can("company", "cra", s, "write"), false);
  assert.equal(can("company", "cra", s, "validate"), false);
  refusedUnchanged(s, "craDraft", { student: "s1", period: "Période fictive", activities: "Texte fictif" });
  refusedUnchanged(s, "craSend", { student: "s1", period: "Période fictive", activities: "Texte fictif", difficulties: "Aucune", next: "Suite" });
  refusedUnchanged(s, "craReview", { student: "s1", id: "cra1", status: "Validé" });
});

test("CRA : le sélecteur entreprise masque les dossiers croisés et les brouillons", () => {
  const s = fresh("marc", "company");
  s.cra.push(
    { id: "cra-envoye-test", student: "s1", cycle: 1, status: "À lire", activities: "Fictif" },
    { id: "cra-brouillon-test", student: "s1", cycle: 1, status: "Brouillon", activities: "Fictif" },
    { id: "cra-autre-test", student: "s4", cycle: 1, status: "À lire", activities: "Fictif" },
  );
  const visible = crasFor(s).map((c) => c.id);
  assert.ok(visible.includes("cra-envoye-test"));
  assert.ok(!visible.includes("cra-brouillon-test"));
  assert.ok(!visible.includes("cra-autre-test"));
  assert.deepEqual(crasFor(s, "s4"), []);
});

test("Admin : aucune lecture ni action d'audit des messages, même avec overrides hérités", () => {
  const s = fresh("admin", "admin");
  s.overrides.admin = { messageAudit: true, "messageAudit:read": true, "messageAudit:write": true, "messageAudit:validate": true };
  for (const mode of ["read", "write", "validate"]) {
    assert.equal(can("admin", "messageAudit", s, mode), false);
  }
  assert.throws(() => dossier(s, "s1", "messageAudit"));
  assert.throws(() => messages(s, room(s, "room1")));
  assert.deepEqual(archivedRooms(s), []);
  refusedUnchanged(s, "auditMessage", { room: "room1", reason: "Motif fictif" });
});

test("Message ciblé : includeManager hérité n'ajoute jamais un destinataire non choisi", () => {
  const s = fresh("lucie", "student");
  s.settings.includeManager = true;
  const chosen = ["marc"];
  mutate(s, "message", { student: "s1", room: "room1", text: "Message privé fictif", recipients: chosen });
  const msg = room(s, "room1").messages.at(-1);
  assert.deepEqual(msg.recipients, ["marc"]);
  assert.deepEqual(chosen, ["marc"], "le tableau transmis ne doit pas être modifié");
  as(s, "marc", "company");
  assert.ok(hasMessage(messages(s, room(s, "room1")), msg.id));
  for (const role of ["stages", "tutor"]) {
    as(s, "sophie", role);
    assert.ok(!hasMessage(messages(s, room(s, "room1")), msg.id));
  }
});

test("Message général récent : le rôle actif stages ne bénéficie pas du rôle tuteur", () => {
  const s = fresh("lucie", "student");
  mutate(s, "message", { student: "s1", room: "room1", text: "Message général fictif" });
  const msg = room(s, "room1").messages.at(-1);
  assert.equal(msg.author, "lucie");
  as(s, "sophie", "stages");
  assert.ok(!hasMessage(messages(s, room(s, "room1")), msg.id));
  as(s, "sophie", "tutor");
  assert.ok(hasMessage(messages(s, room(s, "room1")), msg.id));
  as(s, "marc", "company");
  assert.ok(hasMessage(messages(s, room(s, "room1")), msg.id));
  as(s, "lucie", "student");
  assert.ok(hasMessage(messages(s, room(s, "room1")), msg.id));
});

test("Message général de stages : l'auteur conserve la lecture de son propre message", () => {
  const s = fresh("sophie", "stages");
  mutate(s, "message", { student: "s4", room: "room3", text: "Message émis par stages" });
  const msg = room(s, "room3").messages.at(-1);
  assert.ok(hasMessage(messages(s, room(s, "room3")), msg.id));
});

test("Un message explicitement adressé à stages reste lisible par stages", () => {
  const s = fresh("chloe", "student");
  mutate(s, "message", { student: "s4", room: "room3", text: "Pour la responsable fictive", recipients: ["sophie"] });
  const msg = room(s, "room3").messages.at(-1);
  assert.deepEqual(msg.recipients, ["sophie"]);
  as(s, "sophie", "stages");
  assert.ok(hasMessage(messages(s, room(s, "room3")), msg.id));
  as(s, "anne", "company");
  assert.ok(!hasMessage(messages(s, room(s, "room3")), msg.id));
});

test("Archives : les messages récents gardent les mêmes règles de confidentialité par rôle", () => {
  const s = fresh("lucie", "student");
  mutate(s, "message", { student: "s1", room: "room1", text: "Général archivé fictif" });
  const general = room(s, "room1").messages.at(-1).id;
  mutate(s, "message", { student: "s1", room: "room1", text: "Pour stages archivé", recipients: ["sophie"] });
  const targeted = room(s, "room1").messages.at(-1).id;
  as(s, "sophie", "stages");
  mutate(s, "roomClose", { student: "s1", reason: "Fermeture fictive" });
  const archive = archivedRooms(s).find((r) => r.id === "room1");
  assert.ok(archive);
  assert.ok(!hasMessage(archive.messages, general));
  assert.ok(hasMessage(archive.messages, targeted));
  assert.ok(!hasMessage(messages(s, room(s, "room1")), general));
  assert.ok(hasMessage(messages(s, room(s, "room1")), targeted));
  as(s, "sophie", "tutor");
  assert.ok(hasMessage(archivedRooms(s).find((r) => r.id === "room1").messages, general));
});

function crvState() {
  const s = fresh();
  student(s, "s1").cycle = 2;
  s.crvs = s.crvs.filter((c) => c.student !== "s1");
  s.crvs.push({
    id: "crv-ancien-test", student: "s1", cycle: 1, text: "Ancien texte fictif",
    visas: [], versions: [], amendments: [], delegated: false, disagreement: false,
  });
  return s;
}
function addCurrentCrv(s, visas = []) {
  const c = {
    id: "crv-courant-test", student: "s1", cycle: 2, text: "Texte initial fictif",
    visas: [...visas], versions: [], amendments: [], delegated: false, disagreement: false,
  };
  s.crvs.push(c);
  return c;
}

test("CRV : entreprise et tuteur créent et modifient le bon cycle avec versions et sans visa", () => {
  const s = crvState();
  const old = structuredClone(s.crvs.find((c) => c.id === "crv-ancien-test"));
  as(s, "marc", "company");
  mutate(s, "crvSave", { student: "s1", cycle: 2, text: "Première rédaction fictive" });
  const c = s.crvs.find((item) => item.student === "s1" && item.cycle === 2);
  assert.ok(c);
  assert.equal(c.text, "Première rédaction fictive");
  assert.deepEqual(c.visas, []);
  const baseline = c.versions.length;
  as(s, "sophie", "tutor");
  mutate(s, "crvSave", { student: "s1", id: c.id, cycle: 2, text: "Révision du tuteur" });
  assert.equal(c.versions.length, baseline + 1);
  assert.ok(c.versions.some((v) => v.before === "Première rédaction fictive" && v.after === "Révision du tuteur" && v.author === "sophie"));
  as(s, "marc", "company");
  mutate(s, "crvSave", { student: "s1", id: c.id, cycle: 2, text: "Révision de l'entreprise" });
  assert.equal(c.text, "Révision de l'entreprise");
  assert.equal(c.versions.length, baseline + 2);
  assert.ok(c.versions.some((v) => v.before === "Révision du tuteur" && v.after === "Révision de l'entreprise" && v.author === "marc"));
  assert.deepEqual(c.visas, []);
  assert.deepEqual(s.crvs.find((item) => item.id === old.id), old);
  assert.equal(s.crvs.filter((item) => item.student === "s1" && item.cycle === 2).length, 1);
});

test("CRV : le tuteur peut également créer, puis l'entreprise modifier avant visa", () => {
  const s = crvState();
  as(s, "sophie", "tutor");
  mutate(s, "crvSave", { student: "s1", cycle: 2, text: "Création fictive par tuteur" });
  const c = s.crvs.find((item) => item.student === "s1" && item.cycle === 2);
  assert.ok(c);
  const baseline = c.versions.length;
  as(s, "marc", "company");
  mutate(s, "crvSave", { student: "s1", id: c.id, cycle: 2, text: "Complément fictif" });
  assert.equal(c.text, "Complément fictif");
  assert.equal(c.versions.length, baseline + 1);
  assert.ok(c.versions.some((v) => v.before === "Création fictive par tuteur" && v.after === "Complément fictif" && v.author === "marc"));
  assert.deepEqual(c.visas, []);
});

test("CRV : tout visa existant interdit l'écrasement, sans perte de texte ni de signature", () => {
  for (const visas of [["tutor"], ["tutor", "company"], ["tutor", "company", "student"]]) {
    for (const [user, role] of [["sophie", "tutor"], ["marc", "company"]]) {
      const s = crvState();
      addCurrentCrv(s, visas);
      as(s, user, role);
      refusedUnchanged(s, "crvSave", { student: "s1", id: "crv-courant-test", cycle: 2, text: "Écrasement interdit" });
    }
  }
});

test("CRV : accès croisé et cycle ou identifiant périmé refusés pour les deux encadrants", () => {
  const s = crvState();
  addCurrentCrv(s);
  for (const [user, role] of [["sophie", "tutor"], ["marc", "company"]]) {
    as(s, user, role);
    refusedUnchanged(s, "crvSave", { student: "s1", id: "crv-ancien-test", cycle: 1, text: "Ancien cycle" });
    refusedUnchanged(s, "crvSave", { student: "s1", id: "crv-ancien-test", cycle: 2, text: "Ancien identifiant" });
    refusedUnchanged(s, "crvSave", { student: "s1", id: "crv-courant-test", cycle: 1, text: "Formulaire périmé" });
    refusedUnchanged(s, "crvSave", { student: "s4", cycle: 1, text: "Autre étudiant" });
  }
  for (const [user, role] of [["thomas", "tutor"], ["anne", "company"]]) {
    as(s, user, role);
    refusedUnchanged(s, "crvSave", { student: "s1", id: "crv-courant-test", cycle: 2, text: "Autre encadrant" });
  }
});

test("Bascule unique M1-M2 : apprentissage conservé, les deux types de stages clos et données préservées", () => {
  const s = fresh();
  Object.assign(student(s, "s2"), { contract: "Stage temps plein", status: "En cours" });
  Object.assign(student(s, "s4"), { contract: "Stage alterné", status: "En cours" });
  const selected = ["s1", "s2", "s4"];
  const before = Object.fromEntries(selected.map((id) => [id, structuredClone(student(s, id))]));
  const unrelated = structuredClone(s.students.filter((d) => !selected.includes(d.id)));
  const retained = [
    { collection: "cra", record: { id: "cra-transition-test", student: "s2", cycle: 1, status: "À lire", activities: "Activités fictives" } },
    { collection: "visits", record: { id: "visite-transition-test", student: "s4", cycle: 1, status: "Réalisée", place: "Lieu fictif" } },
    { collection: "crvs", record: { id: "crv-transition-test", student: "s4", cycle: 1, text: "Compte rendu fictif", visas: [], versions: [], amendments: [] } },
    { collection: "requests", record: { id: "demande-transition-test", student: "s2", cycle: 1, type: "CRA", text: "Demande fictive" } },
  ];
  for (const item of retained) s[item.collection].push(structuredClone(item.record));
  const otherRecords = Object.fromEntries(["cra", "visits", "crvs", "requests", "reports"].map((name) => [name, structuredClone(s[name].filter((r) => !selected.includes(r.student)))]));

  mutate(s, "transition", { ids: selected, decision: "Passer en M2" });
  for (const id of selected) assert.equal(student(s, id).promo, "M2");
  const apprenticeship = student(s, "s1");
  for (const key of ["contract", "company", "city", "address", "start", "end", "tutor", "mentor", "cycle", "status", "step"]) {
    assert.deepEqual(apprenticeship[key], before.s1[key], `apprentissage : ${key}`);
  }
  for (const id of ["s2", "s4"]) {
    const d = student(s, id);
    const archived = s.history.find((h) => h.student === id && h.before?.cycle === before[id].cycle && h.before?.contract === before[id].contract);
    // Deux représentations compatibles : contrat clos conservé dans le dossier,
    // ou instantané historique suivi d'un dossier sans contrat actif.
    assert.ok(d.status === "Clôturé" || (archived && d.contract === "Sans contrat"), `stage ${id} doit être clos`);
    const saved = archived?.before || d;
    for (const key of ["contract", "company", "city", "address", "start", "end", "tutor", "mentor", "cycle"]) {
      assert.deepEqual(saved[key], before[id][key], `données historiques ${id} : ${key}`);
    }
  }
  assert.deepEqual(s.students.filter((d) => !selected.includes(d.id)), unrelated);
  for (const item of retained) {
    assert.deepEqual(s[item.collection].find((r) => r.id === item.record.id), item.record);
  }
  for (const [name, records] of Object.entries(otherRecords)) {
    assert.deepEqual(s[name].filter((r) => !selected.includes(r.student)), records);
  }
  for (const id of selected) {
    assert.equal(s.decisions.filter((d) => d.student === id && d.decision === "Passer en M2" && d.status === "Appliquée").length, 1);
  }
  refusedUnchanged(s, "transition", { ids: selected, decision: "Passer en M2" });
});
