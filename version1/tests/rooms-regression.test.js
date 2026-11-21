import test from "node:test";
import assert from "node:assert/strict";
import { seed } from "../seed.js";
import { archivedRooms, dossier, messages, mutate, scopedStudents } from "../domain.js";

function as(s, user, role) {
  s.session = { user, role, lastActivity: Date.now() };
}

function roomFor(s, cycle) {
  return s.rooms.find((room) => room.student === "s4" && room.cycle === cycle);
}

function texts(items) {
  return items.map((message) => message.text);
}

// Une rupture réelle, suivie de l'affectation d'un nouveau tuteur et d'un
// nouveau maître de stage. L'ancienne liste d'acteurs est figée à la fermeture.
function afterRupture() {
  const s = seed();
  as(s, "julien", "tutor");
  mutate(s, "message", { student: "s4", room: "room3", text: "ancien général" });
  mutate(s, "message", { student: "s4", room: "room3", text: "ancien à Anne", recipients: ["anne"] });
  as(s, "anne", "company");
  mutate(s, "message", { student: "s4", room: "room3", text: "ancien à Julien", recipients: ["julien"] });
  as(s, "chloe", "student");
  mutate(s, "message", { student: "s4", room: "room3", text: "ancien de Chloé", recipients: ["julien"] });

  // Données historiques incohérentes : même un destinataire explicite, ou un
  // auteur, ne doit pas contourner la liste d'acteurs figée à la fermeture.
  roomFor(s, 1).messages.push(
    { id: "legacy-recipient", author: "anne", text: "ancien à Thomas", recipients: ["thomas"] },
    { id: "legacy-author", author: "thomas", text: "ancien de Thomas", recipients: ["anne"] },
  );

  as(s, "sophie", "stages");
  mutate(s, "reportAction", { id: "r1", kind: "rupture" });
  mutate(s, "roomClose", { student: "s4", reason: "Rupture actée" });
  mutate(s, "newCycle", { student: "s4", reason: "Nouveau contrat" });
  mutate(s, "mission", {
    student: "s4", tutor: "thomas", title: "Nouvelle mission", description: "Développement",
    company: "Nouvelle entreprise", address: "1 rue du Test", city: "Amiens",
    start: "2026-12-01", end: "2027-06-30", contract: "Stage",
  });
  const missionId = s.missions[0].id;
  as(s, "thomas", "tutor");
  mutate(s, "missionDecision", { id: missionId, decision: "Accepter" });
  as(s, "chloe", "student");
  mutate(s, "onboarding", {
    student: "s4", company: "Nouvelle entreprise", mentorName: "Marc Petit",
    mentorEmail: "marc.petit@atelier-numerique.fr",
  });
  as(s, "sophie", "stages");
  mutate(s, "access", { student: "s4" });
  const current = roomFor(s, 2);
  assert.ok(current && !current.closed);
  as(s, "thomas", "tutor");
  mutate(s, "message", { student: "s4", room: current.id, text: "nouveau général" });
  mutate(s, "message", { student: "s4", room: current.id, text: "nouveau à Marc", recipients: ["marc"] });
  return s;
}

test("Rupture : le nouveau tuteur ne lit ni le général ni les messages ciblés de l'ancien salon", () => {
  const s = afterRupture();
  const old = roomFor(s, 1);
  assert.equal(old.closed, true);
  assert.deepEqual(old.actors, ["chloe", "julien", "anne", "sophie"]);
  assert.equal(dossier(s, "s4", "room").tutor, "thomas");
  assert.deepEqual(messages(s, old), []);
  assert.deepEqual(archivedRooms(s).filter((room) => room.id === old.id), []);
  assert.deepEqual(texts(messages(s, roomFor(s, 2))), ["nouveau général", "nouveau à Marc"]);
});

test("Le nouveau maître de stage ne lit pas non plus l'ancienne archive", () => {
  const s = afterRupture();
  as(s, "marc", "company");
  assert.equal(dossier(s, "s4", "room").mentor, "marc");
  assert.deepEqual(messages(s, roomFor(s, 1)), []);
  assert.deepEqual(archivedRooms(s).filter((room) => room.student === "s4"), []);
  assert.deepEqual(texts(messages(s, roomFor(s, 2))), ["nouveau général", "nouveau à Marc"]);
});

test("Les anciens encadrants conservent leurs seules archives filtrées, sans accès au nouveau dossier", () => {
  const s = afterRupture();
  for (const [user, role, expected] of [
    ["julien", "tutor", ["ancien général", "ancien à Anne", "ancien à Julien", "ancien de Chloé"]],
    ["anne", "company", ["ancien général", "ancien à Anne", "ancien à Julien", "ancien à Thomas", "ancien de Thomas"]],
  ]) {
    as(s, user, role);
    assert.equal(scopedStudents(s).some((student) => student.id === "s4"), false);
    assert.throws(() => dossier(s, "s4", "room"), /périmètre/);
    assert.throws(() => messages(s, roomFor(s, 2)), /périmètre/);
    assert.throws(() => messages(s, roomFor(s, 1)), /périmètre/);
    const archives = archivedRooms(s).filter((room) => room.student === "s4");
    assert.equal(archives.length, 1);
    assert.deepEqual(texts(archives[0].messages), expected);
  }
});

test("Une actrice commune aux deux cycles lit l'archive et le salon courant selon leurs destinataires", () => {
  const s = afterRupture();
  as(s, "chloe", "student");
  assert.deepEqual(texts(messages(s, roomFor(s, 1))), ["ancien général", "ancien de Chloé"]);
  const archive = archivedRooms(s).find((room) => room.student === "s4");
  assert.deepEqual(texts(archive.messages), ["ancien général", "ancien de Chloé"]);
  assert.deepEqual(texts(messages(s, roomFor(s, 2))), ["nouveau général"]);
});

test("Responsables stages : archives accessibles même sans présence parmi les acteurs, mais ciblage respecté", () => {
  const s = afterRupture();
  as(s, "sophie", "stages");
  assert.deepEqual(texts(messages(s, roomFor(s, 1))), ["ancien général", "ancien de Chloé"]);
  assert.deepEqual(texts(archivedRooms(s).find((room) => room.student === "s4").messages), ["ancien général", "ancien de Chloé"]);
  s.users.push({ id: "new-stage", roles: ["stages"], active: true });
  as(s, "new-stage", "stages");
  assert.equal(roomFor(s, 1).actors.includes("new-stage"), false);
  assert.deepEqual(texts(messages(s, roomFor(s, 1))), ["ancien général"]);
  assert.deepEqual(texts(archivedRooms(s).find((room) => room.student === "s4").messages), ["ancien général"]);
});

test("L'exception stages dépend du rôle actif, pas des autres rôles du compte", () => {
  const s = afterRupture();
  s.users.push({ id: "multi", roles: ["stages", "tutor"], active: true });
  s.students.find((student) => student.id === "s4").tutor = "multi";
  as(s, "multi", "stages");
  assert.deepEqual(texts(messages(s, roomFor(s, 1))), ["ancien général"]);
  as(s, "multi", "tutor");
  assert.equal(dossier(s, "s4", "room").tutor, "multi");
  assert.deepEqual(messages(s, roomFor(s, 1)), []);
  assert.equal(archivedRooms(s).some((room) => room.student === "s4"), false);
  assert.deepEqual(texts(messages(s, roomFor(s, 2))), ["nouveau général"]);
});

test("Une archive autorisée reste en lecture seule", () => {
  const s = afterRupture();
  as(s, "chloe", "student");
  const before = texts(messages(s, roomFor(s, 1)));
  assert.throws(() => mutate(s, "message", { student: "s4", room: "room3", text: "Écriture interdite" }), /fermé/);
  assert.deepEqual(texts(messages(s, roomFor(s, 1))), before);
});

test("Salon courant : les affectations font autorité même si sa liste d'acteurs est périmée", () => {
  const s = afterRupture();
  roomFor(s, 2).actors = [];
  for (const [user, role, expected] of [
    ["thomas", "tutor", ["nouveau général", "nouveau à Marc"]],
    ["marc", "company", ["nouveau général", "nouveau à Marc"]],
    ["chloe", "student", ["nouveau général"]],
    ["sophie", "stages", ["nouveau général"]],
  ]) {
    as(s, user, role);
    assert.deepEqual(texts(messages(s, roomFor(s, 2))), expected);
  }
  as(s, "lucie", "student");
  assert.throws(() => messages(s, roomFor(s, 2)), /périmètre/);
});

test("Archive sans liste d'acteurs : refus par défaut, sauf responsable stages", () => {
  for (const actors of [undefined, null, []]) {
    const s = afterRupture();
    roomFor(s, 1).actors = actors;
    as(s, "chloe", "student");
    assert.deepEqual(messages(s, roomFor(s, 1)), []);
    assert.equal(archivedRooms(s).some((room) => room.student === "s4"), false);
    as(s, "sophie", "stages");
    assert.deepEqual(texts(messages(s, roomFor(s, 1))), ["ancien général", "ancien de Chloé"]);
  }
});

test("Les sessions invalides et les permissions retirées ne donnent accès à aucun salon", () => {
  const s = afterRupture();
  const old = roomFor(s, 1);
  const current = roomFor(s, 2);
  for (const [user, role] of [["admin", "admin"], ["thomas", "m1"], ["claire", "m2"], ["chloe", "stages"]]) {
    as(s, user, role);
    assert.throws(() => messages(s, old));
    assert.throws(() => messages(s, current));
    assert.deepEqual(archivedRooms(s), []);
  }
  as(s, "chloe", "student");
  s.session.lastActivity = Date.now() - (s.settings.sessionMinutes + 1) * 60000;
  assert.throws(() => messages(s, old));
  assert.deepEqual(archivedRooms(s), []);
  as(s, "chloe", "student");
  s.users.find((user) => user.id === "chloe").active = false;
  assert.throws(() => messages(s, old));
  assert.deepEqual(archivedRooms(s), []);
  s.users.find((user) => user.id === "chloe").active = true;
  s.overrides.student = { room: false };
  assert.throws(() => messages(s, old));
  assert.throws(() => messages(s, current));
  assert.deepEqual(archivedRooms(s), []);
  as(s, "sophie", "stages");
  s.overrides.stages = { room: false };
  assert.throws(() => messages(s, old));
  assert.deepEqual(archivedRooms(s), []);
});
