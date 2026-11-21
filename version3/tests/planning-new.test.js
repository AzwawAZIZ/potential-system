import test from "node:test";
import assert from "node:assert/strict";
import {
  isValidISODate,
  addDays,
  countPresenceDays,
  craDeadlines,
  calculateReminders,
  assessProposal,
} from "../planning.js";

function freezeDeep(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(freezeDeep);
  }
  return value;
}

const period = { start: "2026-01-01", end: "2026-06-30" };
const proposal = {
  id: "proposition-1", date: "2026-11-10", start: "10:00", end: "11:00",
  participants: ["tuteur-a", "entreprise-a"],
};
const available = [
  { person: "tuteur-a", date: "2026-11-10", start: "09:00", end: "12:00" },
  { person: "entreprise-a", date: "2026-11-10", start: "10:00", end: "11:00" },
];

test("Dates : format exact, calendrier grégorien et années 0001 à 9999", () => {
  for (const date of ["0001-01-01", "0099-12-31", "2000-02-29", "2024-02-29", "9999-12-31"]) {
    assert.equal(isValidISODate(date), true, date);
  }
  for (const date of [
    "0000-01-01", "1900-02-29", "2023-02-29", "2026-02-30", "2026-04-31",
    "2026-13-01", "2026-00-01", "2026-01-00", "2026-1-01", "2026-01-1",
    " 2026-01-01", "2026-01-01\n", "2026-01-01T00:00:00Z", "", null,
    undefined, new Date("2026-01-01T00:00:00Z"), 20260101,
  ]) assert.equal(isValidISODate(date), false, String(date));
});

test("Ajout de jours : UTC, bissextiles, changements d'année et bornes", () => {
  for (const [date, days, expected] of [
    ["2024-02-28", 1, "2024-02-29"], ["2024-03-01", -1, "2024-02-29"],
    ["1900-02-28", 1, "1900-03-01"], ["2000-02-28", 1, "2000-02-29"],
    ["0099-12-31", 1, "0100-01-01"], ["0001-01-01", 0, "0001-01-01"],
    ["9999-12-31", 0, "9999-12-31"], ["2026-03-28", 2, "2026-03-30"],
    ["2026-10-26", -2, "2026-10-24"], ["2026-12-31", 1, "2027-01-01"],
  ]) assert.equal(addDays(date, days), expected);
  for (const [date, days] of [
    ["2026-02-30", 1], ["2026-1-01", 1], ["0001-01-01", -1],
    ["9999-12-31", 1], ["2026-01-01", 1.5], ["2026-01-01", NaN],
    ["2026-01-01", Infinity], ["2026-01-01", Number.MAX_SAFE_INTEGER],
    ["2026-01-01", "1"],
  ]) assert.throws(() => addDays(date, days), RangeError);
});

test("Présences : aucun jour n'est déduit de la durée du contrat", () => {
  assert.deepEqual(countPresenceDays(period, [], "2026-12-31"), {
    count: 0, reached: false, remaining: 45, thresholdDate: null,
  });
  assert.deepEqual(countPresenceDays(period, ["2026-01-03", "2026-01-04"], "2026-01-04"), {
    count: 2, reached: false, remaining: 43, thresholdDate: null,
  }, "les présences explicitement déclarées le samedi et le dimanche comptent");
});

test("Présences : dates distinctes, bornes inclusives, référence et 45e date chronologique", () => {
  const dates = Array.from({ length: 46 }, (_, n) => addDays("2026-01-01", n));
  const input = freezeDeep(["2025-12-31", ...dates.toReversed(), "2026-01-01", "2026-07-01"]);
  assert.deepEqual(countPresenceDays(period, input, "2026-02-13"), {
    count: 44, reached: false, remaining: 1, thresholdDate: null,
  });
  assert.deepEqual(countPresenceDays(period, input, "2026-02-14"), {
    count: 45, reached: true, remaining: 0, thresholdDate: "2026-02-14",
  });
  assert.deepEqual(countPresenceDays(period, input, "2026-12-31"), {
    count: 46, reached: true, remaining: 0, thresholdDate: "2026-02-14",
  });
  assert.deepEqual(countPresenceDays(period, ["2026-01-01", "2026-06-30", "2026-07-01"], "2026-06-30"), {
    count: 2, reached: false, remaining: 43, thresholdDate: null,
  });
  assert.equal(countPresenceDays(period, input, "2025-01-01").count, 0);
});

test("Présences : rejet sans correction de chaque date invalide et des périodes inversées", () => {
  assert.throws(() => countPresenceDays({ start: "2026-02-30", end: "2026-06-30" }, [], "2026-05-01"));
  assert.throws(() => countPresenceDays({ start: "2026-07-01", end: "2026-06-30" }, [], "2026-05-01"));
  assert.throws(() => countPresenceDays(period, ["2027-02-30"], "2026-01-01"), /présence/);
  assert.throws(() => countPresenceDays(period, ["2026-01-01"], "2026-02-29"));
  assert.throws(() => countPresenceDays(period, new Array(1), "2026-02-01"));
  assert.throws(() => countPresenceDays(period, null, "2026-02-01"));
});

test("CRA : fin de période par défaut ; fréquence en jours calendaires, fin partielle incluse", () => {
  assert.deepEqual(craDeadlines(freezeDeep({ start: "2026-01-01", end: "2026-01-10" })), ["2026-01-10"]);
  assert.deepEqual(craDeadlines({ start: "2026-01-01", end: "2026-01-10" }, 3), ["2026-01-03", "2026-01-06", "2026-01-09", "2026-01-10"]);
  assert.deepEqual(craDeadlines({ start: "2026-01-01", end: "2026-01-10" }, 5), ["2026-01-05", "2026-01-10"]);
  assert.deepEqual(craDeadlines({ start: "2024-02-27", end: "2024-03-02" }, 2), ["2024-02-28", "2024-03-01", "2024-03-02"]);
  assert.deepEqual(craDeadlines({ start: "2026-01-01", end: "2026-01-01" }, 1), ["2026-01-01"]);
  assert.deepEqual(craDeadlines({ start: "9999-12-30", end: "9999-12-31" }, Number.MAX_SAFE_INTEGER), ["9999-12-31"]);
});

test("CRA : les paramètres incorrects sont rejetés, non normalisés", () => {
  for (const frequency of [0, -1, 2.5, null, "7", NaN, Infinity]) {
    assert.throws(() => craDeadlines(period, frequency));
  }
  assert.throws(() => craDeadlines({ start: "2026-02-30", end: "2026-04-01" }));
  assert.throws(() => craDeadlines({ start: "2026-06-01", end: "2026-05-01" }, 2));
});

test("Relances : cibles et dates par échéance, échéance atteinte seulement par défaut", () => {
  const deadlines = freezeDeep([
    { id: "cra-1", target: "etudiant-a", dueDate: "2026-11-10" },
    { id: "cra-2", target: "etudiant-b", dueDate: "2026-11-11" },
    { id: "cra-3", target: "etudiant-a", dueDate: "2026-11-09" },
  ]);
  assert.deepEqual(calculateReminders(deadlines, "2026-11-10"), {
    reminders: [
      { deadlineId: "cra-1", target: "etudiant-a", date: "2026-11-10" },
      { deadlineId: "cra-3", target: "etudiant-a", date: "2026-11-10" },
    ],
    history: [
      { deadlineId: "cra-1", target: "etudiant-a", date: "2026-11-10" },
      { deadlineId: "cra-3", target: "etudiant-a", date: "2026-11-10" },
    ],
    states: [
      { deadlineId: "cra-1", lastReminderDate: "2026-11-10" },
      { deadlineId: "cra-2", lastReminderDate: null },
      { deadlineId: "cra-3", lastReminderDate: "2026-11-10" },
    ],
  });
});

test("Relances : aucune réémission le même jour, cadence et conservation de l'historique", () => {
  const deadlines = [{ id: "x", target: "cible-a", dueDate: "2026-11-10" }];
  const first = calculateReminders(deadlines, "2026-11-08", [], { daysBefore: 2, repeatEveryDays: 3 });
  assert.equal(first.reminders.length, 1);
  const changedTarget = [{ ...deadlines[0], target: "cible-b" }];
  const sameDay = calculateReminders(changedTarget, "2026-11-08", freezeDeep(first.history), { daysBefore: 2, repeatEveryDays: 3 });
  assert.deepEqual(sameDay.reminders, []);
  assert.deepEqual(sameDay.states, [{ deadlineId: "x", lastReminderDate: "2026-11-08" }]);
  const early = calculateReminders(changedTarget, "2026-11-10", sameDay.history, { daysBefore: 2, repeatEveryDays: 3 });
  assert.deepEqual(early.reminders, []);
  const next = calculateReminders(changedTarget, "2026-11-11", early.history, { daysBefore: 2, repeatEveryDays: 3 });
  assert.deepEqual(next.reminders, [{ deadlineId: "x", target: "cible-b", date: "2026-11-11" }]);
  assert.deepEqual(next.history, [
    { deadlineId: "x", target: "cible-a", date: "2026-11-08" },
    { deadlineId: "x", target: "cible-b", date: "2026-11-11" },
  ]);
  assert.equal(next.states[0].lastReminderDate, "2026-11-11");
  assert.deepEqual(calculateReminders(deadlines, "2026-11-07", [], { daysBefore: 2 }).reminders, []);
});

test("Relances : dédoublonnage par échéance et date, ordre historique quelconque", () => {
  const deadlines = [{ id: "x", target: "cible", dueDate: "2026-01-01" }];
  const history = freezeDeep([
    { deadlineId: "x", target: "ancienne", date: "2026-01-02", extra: "conservé" },
    { deadlineId: "x", target: "nouvelle", date: "2026-01-02" },
    { deadlineId: "x", target: "ancienne", date: "2026-01-01" },
    { deadlineId: "y", target: "autre", date: "2026-01-02" },
  ]);
  const result = calculateReminders(deadlines, "2026-01-02", history);
  assert.deepEqual(result.reminders, []);
  assert.deepEqual(result.history, [history[0], history[2], history[3]]);
  assert.deepEqual(result.states, [{ deadlineId: "x", lastReminderDate: "2026-01-02" }]);
  assert.equal(history.length, 4);
  assert.notStrictEqual(result.history[0], history[0]);
});

test("Relances : pas d'historique futur, dates ou options invalides", () => {
  const deadlines = [{ id: "x", target: "cible", dueDate: "2026-01-10" }];
  for (const fn of [
    () => calculateReminders(deadlines, "2026-02-30"),
    () => calculateReminders([{ ...deadlines[0], dueDate: "2026-02-30" }], "2026-01-01"),
    () => calculateReminders([...deadlines, deadlines[0]], "2026-01-01"),
    () => calculateReminders([{ ...deadlines[0], target: "  " }], "2026-01-01"),
    () => calculateReminders(deadlines, "2026-01-01", [{ deadlineId: "x", target: "cible", date: "2026-01-02" }]),
    () => calculateReminders(deadlines, "2026-01-01", [{ deadlineId: "autre", target: "cible", date: "2026-02-30" }]),
    () => calculateReminders(deadlines, "2026-01-01", [], { daysBefore: -1 }),
    () => calculateReminders(deadlines, "2026-01-01", [], { repeatEveryDays: 0 }),
    () => calculateReminders(deadlines, "2026-01-01", [], { repeatEveryDays: 1.5 }),
    () => calculateReminders(deadlines, "2026-01-01", [], null),
  ]) assert.throws(fn);
});

test("Disponibilités : couverture de tous les participants, contiguïté et trous", () => {
  assert.deepEqual(assessProposal(freezeDeep(proposal), freezeDeep(available)), {
    available: true, unavailableParticipants: [], conflicts: [], possible: true,
  });
  const split = [
    { person: "tuteur-a", date: proposal.date, start: "10:30", end: "11:00" },
    { person: "tuteur-a", date: proposal.date, start: "09:00", end: "10:30" },
    available[1],
  ];
  assert.equal(assessProposal(proposal, split).possible, true);
  const gap = [{ ...split[0], start: "10:31" }, split[1], available[1]];
  assert.deepEqual(assessProposal(proposal, gap).unavailableParticipants, ["tuteur-a"]);
  assert.deepEqual(assessProposal(proposal, []).unavailableParticipants, ["tuteur-a", "entreprise-a"]);
  assert.deepEqual(assessProposal(proposal, available.map((slot) => ({ ...slot, date: "2026-11-11" }))).unavailableParticipants, ["tuteur-a", "entreprise-a"]);
});

test("Propositions : seuls date, participant et chevauchement communs créent un conflit", () => {
  const others = freezeDeep([
    { id: "adjacent-avant", date: proposal.date, start: "09:00", end: "10:00", participants: ["tuteur-a"] },
    { id: "adjacent-apres", date: proposal.date, start: "11:00", end: "11:30", participants: ["tuteur-a"] },
    { id: "autre-personne", date: proposal.date, start: "10:30", end: "10:45", participants: ["autre"] },
    { id: "autre-jour", date: "2026-11-11", start: "10:30", end: "10:45", participants: ["tuteur-a"] },
    { id: "conflit-1", date: proposal.date, start: "10:59", end: "11:30", participants: ["tuteur-a"] },
    { id: "conflit-2", date: proposal.date, start: "09:45", end: "10:01", participants: ["entreprise-a"] },
    { ...proposal, start: "10:15", end: "10:30" },
  ]);
  assert.deepEqual(assessProposal(proposal, available, others), {
    available: true, unavailableParticipants: [], conflicts: ["conflit-1", "conflit-2"], possible: false,
  });
});

test("Créneaux : validation stricte, même pour les données ne concernant pas la proposition", () => {
  for (const changed of [
    { date: "2026-02-30" }, { date: "2026-11-10\n" }, { start: "9:00" },
    { start: "10:00\n" }, { start: "24:00" }, { end: "23:60" },
    { start: "10:00", end: "10:00" }, { start: "23:00", end: "01:00" },
    { participants: [] }, { participants: ["a", "a"] }, { id: "" },
  ]) assert.throws(() => assessProposal({ ...proposal, ...changed }, available));
  assert.throws(() => assessProposal(proposal, [{ ...available[0], date: "2027-02-30", person: "autre" }]));
  assert.throws(() => assessProposal(proposal, new Array(1)));
  assert.throws(() => assessProposal(proposal, available, [{ ...proposal, id: "autre", end: "25:00" }]));
  assert.throws(() => assessProposal(proposal, available, [{ ...proposal, id: "autre" }, { ...proposal, id: "autre" }]));
});
