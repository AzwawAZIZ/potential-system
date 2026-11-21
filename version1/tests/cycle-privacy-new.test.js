import test from "node:test";
import assert from "node:assert/strict";
import { seed } from "../seed.js";
import {
  activeUser, archivedCras, archivedCrvs, archivedVisits, can, crasFor,
  crvsFor, dossier, forbidden, modeAllowed, mutate, visitsFor,
} from "../domain.js";

const as = (s, user, role) => {
  s.session = { user, role, lastActivity: Date.now() };
};
const ids = (items) => items.map((x) => x.id);

// Lucie : Sophie/Marc au cycle 1, Thomas/Anne au cycle 2.
function twoCycles() {
  const s = seed();
  as(s, "marc", "company");
  mutate(s, "report", { student: "s1", text: "Rupture du premier contrat" });
  const report = s.reports[0].id;
  as(s, "sophie", "stages");
  mutate(s, "reportAction", { id: report, kind: "rupture" });
  mutate(s, "roomClose", { student: "s1", reason: "Rupture" });
  mutate(s, "newCycle", { student: "s1", reason: "Nouveau contrat" });
  mutate(s, "mission", {
    student: "s1", tutor: "thomas", title: "Mission 2", description: "Description",
    company: "Nouvelle société", address: "1 rue Nouvelle", city: "Lille",
    start: "2026-12-01", end: "2027-06-30", contract: "Stage alterné",
  });
  const mission = s.missions[0].id;
  as(s, "thomas", "tutor");
  mutate(s, "missionDecision", { id: mission, decision: "Accepter" });
  as(s, "lucie", "student");
  mutate(s, "onboarding", {
    student: "s1", company: "Nouvelle société", mentorName: "Anne Fournier",
    mentorEmail: "anne.fournier@groupe-verne.fr",
  });
  as(s, "sophie", "stages");
  mutate(s, "access", { student: "s1" });
  return s;
}

function populateCurrent(s) {
  as(s, "anne", "company");
  mutate(s, "visit", { student: "s1", date: "2026-12-01", time: "10:00", place: "Nouvelle société" });
  const visit = s.visits[0].id;
  as(s, "thomas", "tutor");
  mutate(s, "crvSave", { student: "s1", text: "Compte rendu du cycle 2" });
  const crv = s.crvs.at(-1).id;
  return { visit, crv };
}

function refusedUnchanged(s, action, payload) {
  const before = structuredClone(s);
  assert.throws(() => mutate(s, action, payload), undefined, action);
  assert.deepEqual(s, before, action);
}

test("Cycle 2 : les nouveaux encadrants ne voient ni visites ni CRV du cycle 1", () => {
  const s = twoCycles();
  // Lors de la transition, la provenance des données v1 a été figée.
  assert.equal(s.visits.find((v) => v.id === "v1").cycle, 1);
  assert.equal(s.crvs.find((c) => c.id === "crv1").cycle, 1);
  assert.equal(s.cra.find((c) => c.id === "cra1").cycle, 1);
  assert.equal(s.requests.find((r) => r.id === "req1").cycle, 1);
  for (const [user, role] of [["thomas", "tutor"], ["anne", "company"]]) {
    as(s, user, role);
    assert.deepEqual(visitsFor(s, "s1"), []);
    assert.deepEqual(crvsFor(s, "s1"), []);
    assert.deepEqual(archivedVisits(s, "s1"), []);
    assert.deepEqual(archivedCrvs(s, "s1"), []);
  }
  const current = populateCurrent(s);
  assert.equal(s.visits.find((v) => v.id === current.visit).cycle, 2);
  assert.equal(s.crvs.find((c) => c.id === current.crv).cycle, 2);
  for (const [user, role] of [["thomas", "tutor"], ["anne", "company"]]) {
    as(s, user, role);
    assert.deepEqual(ids(visitsFor(s, "s1")), [current.visit]);
    assert.deepEqual(ids(crvsFor(s, "s1")), [current.crv]);
    assert.deepEqual(archivedVisits(s, "s1"), []);
    assert.deepEqual(archivedCrvs(s, "s1"), []);
  }
});

test("Anciens acteurs : seule leur archive ; étudiant commun et stages : cycle courant et archives", () => {
  const s = twoCycles();
  const current = populateCurrent(s);
  for (const [user, role] of [["sophie", "tutor"], ["marc", "company"]]) {
    as(s, user, role);
    assert.deepEqual(visitsFor(s, "s1"), []);
    assert.deepEqual(crvsFor(s, "s1"), []);
    assert.deepEqual(ids(archivedVisits(s, "s1")), ["v1"]);
    assert.deepEqual(ids(archivedCrvs(s, "s1")), ["crv1"]);
  }
  for (const [user, role] of [["lucie", "student"], ["sophie", "stages"]]) {
    as(s, user, role);
    assert.deepEqual(ids(visitsFor(s, "s1")), [current.visit]);
    assert.deepEqual(ids(crvsFor(s, "s1")), [current.crv]);
    assert.deepEqual(ids(archivedVisits(s, "s1")), ["v1"]);
    assert.deepEqual(ids(archivedCrvs(s, "s1")), ["crv1"]);
  }
  // L'exception stages ne s'applique pas au rôle tuteur d'un compte multi-rôle.
  s.users.push({ id: "multi", name: "Multi", email: "multi@example.fr", active: true, roles: ["stages", "tutor"] });
  s.students.find((d) => d.id === "s1").tutor = "multi";
  as(s, "multi", "stages");
  assert.deepEqual(ids(archivedVisits(s, "s1")), ["v1"]);
  as(s, "multi", "tutor");
  assert.deepEqual(archivedVisits(s, "s1"), []);
  assert.deepEqual(archivedCrvs(s, "s1"), []);
});

test("Les mutations de l'ancien cycle et les formulaires périmés sont refusés atomiquement", () => {
  const s = twoCycles();
  const current = populateCurrent(s);
  as(s, "thomas", "tutor");
  refusedUnchanged(s, "visitConfirm", { student: "s1", id: "v1", done: true });
  refusedUnchanged(s, "visitConfirm", { student: "s1", id: current.visit, cycle: 1 });
  refusedUnchanged(s, "visit", { student: "s1", cycle: 1, date: "2026-12-02", time: "10:00", place: "Test" });
  for (const action of ["crvSave", "visa", "delegate"]) {
    refusedUnchanged(s, action, { student: "s1", id: "crv1", text: "Test" });
    refusedUnchanged(s, action, { student: "s1", cycle: 1, text: "Test" });
  }
  as(s, "anne", "company");
  for (const action of ["visa", "disagree", "rectify", "amend"]) {
    refusedUnchanged(s, action, { student: "s1", id: "crv1", text: "Test", reason: "Test" });
    refusedUnchanged(s, action, { student: "s1", cycle: 1, text: "Test", reason: "Test" });
  }
  as(s, "sophie", "stages");
  refusedUnchanged(s, "crvArbitrate", { student: "s1", id: "crv1", text: "Test" });
  as(s, "sophie", "tutor");
  refusedUnchanged(s, "visitConfirm", { student: "s1", id: current.visit });
  refusedUnchanged(s, "crvSave", { student: "s1", text: "Attaque" });
  as(s, "marc", "company");
  refusedUnchanged(s, "amend", { student: "s1", text: "Attaque" });
  // Les actions normales concernent bien le nouveau CRV, sans toucher l'ancien.
  const old = structuredClone(s.crvs.find((c) => c.id === "crv1"));
  as(s, "thomas", "tutor");
  mutate(s, "visa", { student: "s1", id: current.crv, cycle: 2 });
  assert.deepEqual(s.crvs.find((c) => c.id === "crv1"), old);
  assert.deepEqual(s.crvs.find((c) => c.id === current.crv).visas, ["tutor"]);
});

test("Formats hérités : premier cycle certain accepté ; cycles ambigus et invalides masqués", () => {
  const s = seed();
  as(s, "sophie", "tutor");
  assert.deepEqual(ids(visitsFor(s, "s1")), ["v1"]);
  assert.deepEqual(ids(crvsFor(s, "s1")), ["crv1"]);
  for (const invalid of [null, 0, -1, 1.5, "1"]) {
    s.visits.find((v) => v.id === "v1").cycle = invalid;
    s.crvs.find((c) => c.id === "crv1").cycle = invalid;
    assert.deepEqual(visitsFor(s, "s1"), []);
    assert.deepEqual(crvsFor(s, "s1"), []);
  }
  delete s.visits.find((v) => v.id === "v1").cycle;
  delete s.crvs.find((c) => c.id === "crv1").cycle;
  s.students.find((d) => d.id === "s1").cycle = 2;
  for (const [user, role] of [["sophie", "tutor"], ["marc", "company"], ["sophie", "stages"]]) {
    as(s, user, role);
    assert.deepEqual(visitsFor(s, "s1"), []);
    assert.deepEqual(crvsFor(s, "s1"), []);
    assert.deepEqual(archivedVisits(s, "s1"), []);
    assert.deepEqual(archivedCrvs(s, "s1"), []);
  }
  // Même un cycle numérique ne prouve pas les acteurs sans contrat archivé.
  s.visits.find((v) => v.id === "v1").cycle = 1;
  s.crvs.find((c) => c.id === "crv1").cycle = 1;
  as(s, "marc", "company");
  assert.deepEqual(archivedVisits(s, "s1"), []);
  assert.deepEqual(archivedCrvs(s, "s1"), []);
  as(s, "sophie", "stages");
  assert.deepEqual(ids(archivedVisits(s, "s1")), ["v1"]);
  assert.deepEqual(ids(archivedCrvs(s, "s1")), ["crv1"]);
});

test("Les nouveaux CRA et demandes portent le cycle, sans exposer les brouillons", () => {
  const s = twoCycles();
  as(s, "lucie", "student");
  mutate(s, "craDraft", { student: "s1", period: "Décembre", activities: "Activités nouvelles" });
  assert.equal(s.cra[0].cycle, 2);
  const draft = s.cra[0].id;
  assert.deepEqual(ids(crasFor(s, "s1")), [draft]);
  assert.deepEqual(ids(archivedCras(s, "s1")), ["cra1"]);
  as(s, "thomas", "tutor");
  assert.deepEqual(crasFor(s, "s1"), []);
  assert.deepEqual(archivedCras(s, "s1"), []);
  mutate(s, "request", { student: "s1", type: "CRA", text: "Bilan", due: "2026-12-01" });
  assert.equal(s.requests[0].cycle, 2);
  as(s, "anne", "company");
  assert.deepEqual(crasFor(s, "s1"), []);
  assert.deepEqual(archivedCras(s, "s1"), []);
  as(s, "lucie", "student");
  mutate(s, "craSend", { student: "s1", id: draft, period: "Décembre", activities: "Activités nouvelles", difficulties: "Aucune", next: "Suite" });
  assert.equal(s.cra.find((c) => c.id === draft).cycle, 2);
  as(s, "thomas", "tutor");
  assert.deepEqual(ids(crasFor(s, "s1")), [draft]);
  as(s, "sophie", "tutor");
  assert.deepEqual(crasFor(s, "s1"), []);
  assert.deepEqual(ids(archivedCras(s, "s1")), ["cra1"]);
});

test("Nouveau cycle : ancien site et contacts archivés puis effacés du dossier courant", () => {
  const s = seed();
  const d = s.students.find((x) => x.id === "s1");
  d.mentorName = "Ancien contact";
  d.mentorEmail = "ancien@example.fr";
  const old = structuredClone(d);
  as(s, "marc", "company");
  mutate(s, "report", { student: "s1", text: "Rupture" });
  as(s, "sophie", "stages");
  mutate(s, "reportAction", { id: s.reports[0].id, kind: "rupture" });
  mutate(s, "roomClose", { student: "s1", reason: "Rupture" });
  mutate(s, "newCycle", { student: "s1", reason: "Nouveau contrat" });
  const archived = s.history.find((h) => h.type === "Contrat archivé" && h.student === "s1").before;
  for (const field of ["city", "address", "start", "end", "mentorName", "mentorEmail"])
    assert.equal(archived[field], old[field], field);
  assert.equal(d.city, "—");
  for (const field of ["address", "start", "end", "mentorName", "mentorEmail"])
    assert.equal(d[field], "", field);
  for (const field of ["id", "user", "name", "email", "promo"])
    assert.equal(d[field], old[field], field);
  as(s, "lucie", "student");
  mutate(s, "onboarding", { student: "s1", company: "Nouveau site", mentorName: "Anne Fournier", mentorEmail: "anne.fournier@groupe-verne.fr" });
  as(s, "sophie", "stages");
  mutate(s, "access", { student: "s1" });
  as(s, "anne", "company");
  const current = dossier(s, "s1");
  assert.equal(current.city, "—");
  assert.equal(current.address, "");
  assert.equal(current.start, "");
  assert.equal(current.end, "");
  assert.equal(current.mentorName, "Anne Fournier");
  assert.equal(current.mentorEmail, "anne.fournier@groupe-verne.fr");
});

test("Sessions, permissions et instantanés historiques incohérents : refus par défaut", () => {
  const s = twoCycles();
  populateCurrent(s);
  as(s, "marc", "company");
  assert.ok(activeUser(s));
  const h = s.history.find((x) => x.type === "Contrat archivé" && x.student === "s1");
  s.history.push(structuredClone(h));
  assert.deepEqual(archivedVisits(s, "s1"), []);
  assert.deepEqual(archivedCrvs(s, "s1"), []);
  s.history.pop();
  s.overrides.company = { dossier: false, crv: false };
  assert.deepEqual(archivedVisits(s, "s1"), []);
  assert.deepEqual(archivedCrvs(s, "s1"), []);
  delete s.overrides.company;
  s.session.lastActivity = Date.now() - (s.settings.sessionMinutes + 1) * 60000;
  assert.deepEqual(archivedVisits(s, "s1"), []);
  assert.deepEqual(archivedCrvs(s, "s1"), []);
  as(s, "admin", "admin");
  assert.deepEqual(visitsFor(s), []);
  assert.deepEqual(crvsFor(s), []);
  assert.deepEqual(archivedVisits(s), []);
  assert.deepEqual(archivedCrvs(s), []);
});

test("Administrateur : audit des messages privés interdit malgré les anciens overrides", () => {
  const s = seed();
  as(s, "admin", "admin");
  s.overrides.admin = { messageAudit: true, "messageAudit:read": true, "messageAudit:write": true };
  assert.equal(forbidden("admin", "messageAudit"), true);
  assert.equal(modeAllowed("admin", "messageAudit", "read"), false);
  assert.equal(can("admin", "messageAudit", s), false);
  refusedUnchanged(s, "auditMessage", { room: "room2", reason: "Motif" });
  refusedUnchanged(s, "permissions", { changes: { admin: { messageAudit: true } }, reason: "Ancien droit" });
});
