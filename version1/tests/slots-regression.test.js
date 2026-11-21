import test from "node:test";
import assert from "node:assert/strict";
import { seed } from "../seed.js";
import { mutate, parseCSV, importRows } from "../domain.js";

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
