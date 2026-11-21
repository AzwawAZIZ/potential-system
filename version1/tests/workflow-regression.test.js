import test from "node:test";
import assert from "node:assert/strict";
import { seed } from "../seed.js";
import { mutate } from "../domain.js";

function session(user, role) {
  const state = seed();
  state.session = { user, role, lastActivity: Date.now() };
  return state;
}

test("CRA : association interdite à une demande d'un autre étudiant ou de mauvais type", () => {
  const s = session("lucie", "student");
  const base = { student: "s1", period: "Novembre", activities: "Développement", linkConfirmed: true };
  assert.throws(() => mutate(s, "craDraft", { ...base, request: "req2" }), /demande/i);
  s.requests.push({ id: "visite1", student: "s1", type: "Visite" });
  assert.throws(() => mutate(s, "craDraft", { ...base, request: "visite1" }), /demande/i);
  assert.throws(() => mutate(s, "craDraft", { ...base, request: "introuvable" }), /demande/i);
  mutate(s, "craDraft", { ...base, request: "req1" });
  assert.equal(s.cra[0].request, "req1");
});

test("Visite : dates et heures invalides rejetées par le moteur", () => {
  const s = session("lucie", "student");
  const base = { student: "s1", date: "2026-11-30", time: "10:00", place: "Amiens" };
  for (const change of [{ date: "2026-13-01" }, { date: "2026-02-30" }, { time: "25:80" }, { date2: "2026-12-01", time2: "9h" }]) {
    assert.throws(() => mutate(s, "visit", { ...base, ...change }), /date|heure|créneau/i);
  }
  mutate(s, "visit", base);
  assert.equal(s.visits[0].time, "10:00");
});

test("Visite : respecter les étapes proposée, confirmée, réalisée", () => {
  const s = session("sophie", "tutor");
  assert.throws(() => mutate(s, "visitConfirm", { student: "s9", id: "v3", done: true }), /confirmée/i);
  mutate(s, "visitConfirm", { student: "s9", id: "v3", done: false });
  assert.equal(s.visits.find((v) => v.id === "v3").status, "Confirmée");
  mutate(s, "visitConfirm", { student: "s9", id: "v3", done: true });
  assert.equal(s.visits.find((v) => v.id === "v3").status, "Réalisée");
  assert.throws(() => mutate(s, "visitConfirm", { student: "s9", id: "v3", done: false }), /proposée/i);
});
