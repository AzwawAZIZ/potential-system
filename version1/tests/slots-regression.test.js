import test from "node:test";
import assert from "node:assert/strict";
import { seed } from "../seed.js";
import { mutate, parseCSV, importRows, visitsFor, notices } from "../domain.js";

const as = (s, user, role) => { s.session = { user, role, lastActivity: Date.now() }; return s; };

test("Visites : le tuteur confirme le second créneau proposé", () => {
  const s = as(seed(), "lucie", "student");
  mutate(s, "visit", { student: "s1", date: "2026-12-01", time: "10:00", date2: "2026-12-02", time2: "15:30", place: "Amiens" });
  const v = s.visits[0];
  as(s, "sophie", "tutor");
  mutate(s, "visitConfirm", { student: "s1", id: v.id, slot: "second" });
  assert.equal(v.date, "2026-12-02");
  assert.equal(v.time, "15:30");
  assert.equal(v.alternative, "2026-12-01 10:00");
  assert.equal(v.status, "Confirmée");
});

test("Visites : second créneau absent ou inconnu rejeté", () => {
  const s = as(seed(), "sophie", "tutor");
  assert.throws(() => mutate(s, "visitConfirm", { student: "s9", id: "v3", slot: "second" }), /second créneau/i);
  assert.throws(() => mutate(s, "visitConfirm", { student: "s9", id: "v3", slot: "inconnu" }), /créneau/i);
});

test("Import : la ville renseignée met à jour le dossier, une ville vide le préserve", () => {
  const s = as(seed(), "sophie", "stages");
  let rows = parseCSV("nom;email;promotion;ville\nLucie Bernard;lucie.bernard@u-picardie.fr;M1;Paris", s);
  assert.equal(importRows(s, rows, "ville.csv").updated, 1);
  assert.equal(s.students.find((x) => x.id === "s1").city, "Paris");
  rows = parseCSV("nom;email;promotion\nLucie Bernard;lucie.bernard@u-picardie.fr;M1", s);
  assert.equal(importRows(s, rows, "sans-ville.csv").updated, 1);
  assert.equal(s.students.find((x) => x.id === "s1").city, "Paris");
});

test("Proposition de Julien : un événement et une invitation par rôle pour Chloé et Anne", () => {
  const s = as(seed(), "julien", "tutor");
  const before = s.visits.length;
  mutate(s, "visit", { student: "s4", date: "2026-12-01", time: "10:00",
    date2: "2026-12-06", time2: "13:17", place: "Visioconférence" });
  const visit = s.visits[0];
  assert.equal(s.visits.length, before + 1);
  const invites = s.notifications.filter(n => n.visitId === visit.id);
  assert.deepEqual(invites.map(n => [n.user, n.role]).sort(), [["anne","company"],["chloe","student"]]);
  for (const [user, role] of [["chloe","student"],["anne","company"]]) {
    as(s, user, role);
    assert.ok(visitsFor(s).some(v => v.id === visit.id));
    const invite = notices(s).find(n => n.visitId === visit.id);
    assert.match(invite.text, /01.12.2026 à 10:00 ou 06.12.2026 à 13:17/);
    assert.ok(invite.text.includes(visit.place));
  }
  as(s, "julien", "tutor");
  mutate(s, "visitConfirm", { student: "s4", id: visit.id, slot: "second" });
  assert.equal(s.visits.length, before + 1);
  assert.equal(s.visits[0].status, "Confirmée");
});
