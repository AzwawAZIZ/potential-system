import test from "node:test";
import assert from "node:assert/strict";
import { compatibleState } from "../storage.js";
import {
  suiviCountPresenceDays,
  suiviAddPresenceDay,
  suiviRemovePresenceDay,
  suiviUpdateContacts,
  suiviAddAmendment,
  suiviNormalizeContractType,
  suiviAddAvailability,
  suiviRemoveAvailability,
} from "../suivi-local.js";

const suiviTestStudent = () => ({
  id: "etudiant-fictif", cycle: 1, start: "2026-01-01", end: "2026-12-31",
  email: "ancien@example.test", address: "1 rue Imaginaire", city: "Ville fictive",
  user: "compte-etudiant", mentor: "compte-mentor", tutor: "compte-tuteur",
});
const suiviTestToday = "2026-06-15";
const suiviTestStamp = "2026-06-15T09:30:00.000Z";
const suiviTestPresence = (date, cycle = 1, today = suiviTestToday) => ({ cycle, date, today });
const suiviTestSlot = (date = "2026-06-20", start = "09:00", end = "10:00") => ({ date, start, end });
function suiviUnchangedOnFailure(object, run, message) {
  const before = structuredClone(object);
  assert.throws(run, message);
  assert.deepEqual(object, before);
}

test("présences explicites, bornes incluses, unicité et suppression exacte", () => {
  const student = suiviTestStudent();
  assert.equal(suiviCountPresenceDays(student, 1), 0);
  assert.equal(suiviAddPresenceDay(student, suiviTestPresence("2026-01-01")), 1);
  assert.equal(suiviAddPresenceDay(student, suiviTestPresence(suiviTestToday)), 2);
  assert.deepEqual(student.presenceDays, [
    { cycle: 1, date: "2026-01-01" }, { cycle: 1, date: "2026-06-15" },
  ]);
  suiviUnchangedOnFailure(student, () => suiviAddPresenceDay(student, suiviTestPresence("2026-01-01")), /déjà déclarée/);
  assert.equal(suiviRemovePresenceDay(student, suiviTestPresence("2026-01-01")), 1);
  assert.equal(suiviCountPresenceDays(student, 1), 1);
  suiviUnchangedOnFailure(student, () => suiviRemovePresenceDay(student, suiviTestPresence("2026-01-01")), /introuvable/);
  assert.equal(suiviRemovePresenceDay(student, suiviTestPresence(suiviTestToday)), 0);
});

test("dates et bornes des présences : invalides, futures, absentes ou inversées", () => {
  const student = suiviTestStudent();
  for (const date of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-1-01", "0000-01-01", "2025-12-31", "2027-01-01", "2026-06-16"]) {
    suiviUnchangedOnFailure(student, () => suiviAddPresenceDay(student, suiviTestPresence(date)), /date|présence/i);
  }
  for (const today of [undefined, "2026-02-29", "demain"]) {
    suiviUnchangedOnFailure(student, () => suiviAddPresenceDay(student, { cycle: 1, date: "2026-06-01", today }), /aujourd'hui/);
  }
  const withoutBounds = { cycle: 1, contract: "Sans contrat" };
  suiviUnchangedOnFailure(withoutBounds, () => suiviAddPresenceDay(withoutBounds, suiviTestPresence("2026-01-01")), /début du contrat/);
  const inverted = { cycle: 1, start: "2026-02-01", end: "2026-01-01" };
  suiviUnchangedOnFailure(inverted, () => suiviAddPresenceDay(inverted, suiviTestPresence("2026-01-01")), /inversées/);
  const leap = { cycle: 1, start: "0004-02-29", end: "0004-03-01" };
  assert.equal(suiviAddPresenceDay(leap, { cycle: 1, date: "0004-02-29", today: "0004-03-01" }), 1);
  const end = { cycle: 1, start: "2026-01-01", end: "2026-06-15" };
  assert.equal(suiviAddPresenceDay(end, suiviTestPresence("2026-06-15")), 1);
  suiviUnchangedOnFailure(end, () => suiviRemovePresenceDay(end, suiviTestPresence("2026-06-16")), /bornes/);
});

test("présences séparées par cycle, données antérieures intactes", () => {
  const student = suiviTestStudent();
  suiviAddPresenceDay(student, suiviTestPresence("2026-06-01"));
  student.cycle = 2;
  assert.equal(suiviAddPresenceDay(student, suiviTestPresence("2026-06-01", 2)), 1);
  assert.equal(suiviCountPresenceDays(student, 1), 1);
  assert.equal(suiviCountPresenceDays(student, 2), 1);
  suiviUnchangedOnFailure(student, () => suiviRemovePresenceDay(student, suiviTestPresence("2026-06-01", 1)), /cycle courant/);
  assert.equal(suiviRemovePresenceDay(student, suiviTestPresence("2026-06-01", 2)), 0);
  assert.deepEqual(student.presenceDays, [{ cycle: 1, date: "2026-06-01" }]);
  for (const cycle of [0, -1, 1.1, "2", Number.MAX_SAFE_INTEGER + 1]) {
    suiviUnchangedOnFailure(student, () => suiviAddPresenceDay(student, suiviTestPresence("2026-06-01", cycle)), /cycle/);
  }
});

test("présences existantes mal formées ou dupliquées rejetées sans réparation silencieuse", () => {
  for (const presenceDays of [null, {}, [{ date: "2026-01-01" }], [{ cycle: 1, date: "2026-02-29" }], [
    { cycle: 1, date: "2026-01-01" }, { cycle: 1, date: "2026-01-01" },
  ]]) {
    const student = { ...suiviTestStudent(), presenceDays };
    suiviUnchangedOnFailure(student, () => suiviAddPresenceDay(student, suiviTestPresence("2026-06-01")));
    assert.throws(() => suiviCountPresenceDays(student, 1));
  }
});

test("coordonnées confirmées, événements avant/après et aucun changement de compte", () => {
  const student = suiviTestStudent();
  const users = [{ id: "compte-mentor", email: "mentor@example.test" }, { id: "autre-compte", email: "autre@example.test" }];
  const userSnapshot = structuredClone(users);
  const event = suiviUpdateContacts(student, {
    email: " NOUVEAU@EXAMPLE.TEST ", mentorEmail: "autre@example.test", mentorName: "Tuteur Fictif",
    phone: "+33 1 00 00 00 00", address: " 2 rue Inventée ", city: "Ville Imaginaire",
  }, { confirmed: true, timestamp: suiviTestStamp });
  assert.equal(student.email, "nouveau@example.test");
  assert.equal(student.address, "2 rue Inventée");
  assert.equal(event.before.address, "1 rue Imaginaire");
  assert.equal(event.before.mentorEmail, null);
  assert.equal(event.after.address, "2 rue Inventée");
  assert.equal(event.date, suiviTestStamp);
  assert.equal(event.student, student.id);
  assert.equal(event.cycle, 1);
  assert.deepEqual(users, userSnapshot);
  assert.equal(student.user, "compte-etudiant");
  assert.equal(student.mentor, "compte-mentor");
  assert.equal(student.tutor, "compte-tuteur");
  student.address = "3 rue Nouvelle";
  assert.equal(event.after.address, "2 rue Inventée");
});

test("coordonnées : confirmation, liste blanche, validité et atomicité", () => {
  const cases = [
    [{ address: "Nouvelle adresse" }, {}, /Confirmation/],
    [{ address: "Nouvelle adresse", mentor: "autre" }, { confirmed: true }, /non modifiable/],
    [{ address: "Nouvelle adresse", email: "invalid@@example.test" }, { confirmed: true }, /e-mail/],
    [{ email: "a..b@example.test" }, { confirmed: true }, /e-mail/],
    [{ email: "a@-exemple.test" }, { confirmed: true }, /e-mail/],
    [{ email: "a@example.test\r\nBcc: x@example.test" }, { confirmed: true }, /contrôle/],
    [{ address: "  " }, { confirmed: true }, /texte non vide/],
    [{ mentorPhone: "123" }, { confirmed: true }, /téléphone/],
    [{ tutorPhone: "+33+123456789" }, { confirmed: true }, /téléphone/],
    [{}, { confirmed: true }, /Aucune/],
    [{ city: "Ailleurs" }, { confirmed: true, timestamp: "2026-06-15" }, /horodatage/],
  ];
  for (const [changes, options, error] of cases) {
    const student = suiviTestStudent();
    suiviUnchangedOnFailure(student, () => suiviUpdateContacts(student, changes, options), error);
  }
  const student = suiviTestStudent();
  const event = suiviUpdateContacts(student, { tutorPhone: "01 00 00 00 00" }, { confirmed: true });
  assert.equal(event.before.tutorPhone, null);
  assert.equal(Object.hasOwn(event, "date"), false);
});

test("avenant horodaté sans end : le contrat reste inchangé", () => {
  const student = suiviTestStudent();
  const result = suiviAddAmendment(student, {
    cycle: 1, reason: " Évolution de mission ", date: suiviTestStamp, start: "2026-07-01",
  });
  assert.deepEqual(result, { cycle: 1, reason: "Évolution de mission", date: suiviTestStamp, start: "2026-07-01" });
  assert.equal(student.end, "2026-12-31");
  assert.equal(student.start, "2026-01-01");
  assert.deepEqual(student.contractAmendments, [result]);
  result.reason = "autre";
  assert.equal(student.contractAmendments[0].reason, "Évolution de mission");
});

test("avenants avec fin explicite : précédente fin conservée et cycles séparés", () => {
  const student = suiviTestStudent();
  suiviAddPresenceDay(student, suiviTestPresence("2026-06-01"));
  const result = suiviAddAmendment(student, {
    cycle: 1, reason: "Prolongation", date: suiviTestStamp,
    start: "2026-12-01", end: "2027-03-31",
  });
  assert.equal(student.end, "2027-03-31");
  assert.equal(result.previousEnd, "2026-12-31");
  student.cycle = 2;
  student.start = "2027-04-01";
  student.end = "2028-03-31";
  suiviAddAmendment(student, { cycle: 2, reason: "Mise à jour", date: suiviTestStamp });
  assert.deepEqual(student.contractAmendments.map((x) => x.cycle), [1, 2]);
  assert.equal(student.end, "2028-03-31");
});

test("avenants : rejet atomique des motifs, dates, cycles et fins incohérents", () => {
  const cases = [
    [{ cycle: 1, reason: " ", date: suiviTestStamp }, /motif/],
    [{ cycle: 2, reason: "Modification", date: suiviTestStamp }, /cycle courant/],
    [{ cycle: 1, reason: "Modification", date: "2026-02-30T09:30:00.000Z" }, /date|horodatage/],
    [{ cycle: 1, reason: "Modification", date: "2026-06-15T25:30:00.000Z" }, /horodatage/],
    [{ cycle: 1, reason: "Modification", date: suiviTestStamp, start: "2026-02-29" }, /date/],
    [{ cycle: 1, reason: "Modification", date: suiviTestStamp, end: "2025-12-31" }, /début/],
    [{ cycle: 1, reason: "Modification", date: suiviTestStamp, start: "2026-07-01", end: "2026-06-30" }, /inversées/],
    [{ cycle: 1, reason: "Modification", date: suiviTestStamp, end: undefined }, /date/],
    [{ cycle: 1, reason: "Modification", date: suiviTestStamp, end: "2026-05-01" }, /présence/],
  ];
  for (const [input, error] of cases) {
    const student = suiviTestStudent();
    student.presenceDays = [{ cycle: 1, date: "2026-06-01" }];
    suiviUnchangedOnFailure(student, () => suiviAddAmendment(student, input), error);
  }
  const old = { cycle: 1, contract: "Sans contrat" };
  assert.equal(suiviAddAmendment(old, { cycle: 1, reason: "Note", date: suiviTestStamp }).reason, "Note");
  suiviUnchangedOnFailure(old, () => suiviAddAmendment(old, { cycle: 1, reason: "Changement", date: suiviTestStamp, end: "2026-12-31" }), /début/);
  old.contractAmendments = null;
  suiviUnchangedOnFailure(old, () => suiviAddAmendment(old, { cycle: 1, reason: "Note", date: suiviTestStamp }), /tableau/);
});

test("normalisation exhaustive des six types et refus des valeurs inconnues", () => {
  const variants = [
    ["  APPRENTISSAGE  ", "Apprentissage"], ["stage   ALTERNE", "Stage alterné"],
    ["stage temps plein", "Stage temps plein"], ["Stage à temps plein", "Stage temps plein"],
    ["contrat de PROFESSIONNALISATION", "Contrat de professionnalisation"],
    ["cesure", "Césure"], ["CÉSURE", "Césure"], ["sans contrat", "Sans contrat"],
  ];
  for (const [raw, expected] of variants) assert.equal(suiviNormalizeContractType(raw), expected);
  for (const bad of ["alternance", "stagiaire", "", null, 5]) assert.throws(() => suiviNormalizeContractType(bad));
});

test("disponibilités locales non chevauchantes, adjacentes et suppression exacte", () => {
  const person = { id: "encadrant-fictif", roles: ["tutor"], available: true };
  assert.equal(suiviAddAvailability(person, suiviTestSlot()), 1);
  assert.equal(suiviAddAvailability(person, suiviTestSlot("2026-06-20", "10:00", "10:30")), 2);
  assert.equal(suiviAddAvailability(person, suiviTestSlot("2026-06-21", "09:00", "10:00")), 3);
  for (const slot of [
    suiviTestSlot(), suiviTestSlot("2026-06-20", "08:30", "09:30"),
    suiviTestSlot("2026-06-20", "09:30", "11:00"), suiviTestSlot("2026-06-20", "08:00", "11:00"),
  ]) suiviUnchangedOnFailure(person, () => suiviAddAvailability(person, slot), /chevauche/);
  suiviUnchangedOnFailure(person, () => suiviRemoveAvailability(person, suiviTestSlot("2026-06-20", "09:00", "09:30")), /introuvable/);
  assert.equal(suiviRemoveAvailability(person, suiviTestSlot()), 2);
  assert.equal(person.available, true);
  assert.deepEqual(person.availabilitySlots, [suiviTestSlot("2026-06-20", "10:00", "10:30"), suiviTestSlot("2026-06-21", "09:00", "10:00")]);
});

test("créneaux : dates/heures strictes, finie, même jour, et refus d'états corrompus", () => {
  for (const slot of [
    suiviTestSlot("2026-02-29"), suiviTestSlot("2026-06-20", "9:00", "10:00"),
    suiviTestSlot("2026-06-20", "09:00", "24:00"), suiviTestSlot("2026-06-20", "09:60", "10:00"),
    suiviTestSlot("2026-06-20", "10:00", "10:00"), suiviTestSlot("2026-06-20", "23:00", "01:00"),
    suiviTestSlot("2026-06-20", 9, Infinity),
  ]) {
    const person = {};
    suiviUnchangedOnFailure(person, () => suiviAddAvailability(person, slot));
  }
  const person = { availabilitySlots: [suiviTestSlot(), suiviTestSlot("2026-06-20", "09:30", "11:00")] };
  suiviUnchangedOnFailure(person, () => suiviAddAvailability(person, suiviTestSlot("2026-06-21")), /Chevauchement/);
  const empty = {};
  suiviUnchangedOnFailure(empty, () => suiviRemoveAvailability(empty, suiviTestSlot()), /introuvable/);
  const malformed = { availabilitySlots: null };
  suiviUnchangedOnFailure(malformed, () => suiviAddAvailability(malformed, suiviTestSlot()), /tableau/);
});

test("état v1 fictif : champs facultatifs et événement restent sérialisables", () => {
  const student = {
    ...suiviTestStudent(), name: "Étudiant Fictif", promo: "M1", status: "En cours",
    access: "Accès créé", company: "Entreprise fictive", step: 1,
  };
  const person = { id: "encadrant-fictif", name: "Encadrant Fictif", email: "encadrant@example.test", active: true, roles: ["tutor"] };
  const state = {
    version: 1, session: null, preferences: { theme: "light", motion: false },
    settings: { sessionMinutes: 60 }, overrides: {}, users: [person], students: [student],
    cra: [], requests: [], visits: [], crvs: [], missions: [], reports: [], rooms: [],
    notifications: [], emails: [], decisions: [], imports: [], audit: [], history: [],
  };
  assert.equal(compatibleState(state), true);
  suiviAddPresenceDay(student, suiviTestPresence("2026-06-01"));
  suiviAddAmendment(student, { cycle: 1, reason: "Prolongation fictive", date: suiviTestStamp, end: "2027-01-31" });
  suiviAddAvailability(person, suiviTestSlot());
  state.history.push(suiviUpdateContacts(student, { address: "4 rue Fiction" }, { confirmed: true, timestamp: suiviTestStamp }));
  const restored = JSON.parse(JSON.stringify(state));
  assert.equal(compatibleState(restored), true);
  assert.equal(restored.history[0].before.address, "1 rue Imaginaire");
  assert.equal(restored.students[0].contractAmendments[0].previousEnd, "2026-12-31");
  assert.equal(suiviCountPresenceDays(restored.students[0], 1), 1);
  assert.deepEqual(restored.users[0].availabilitySlots, [suiviTestSlot()]);
});
