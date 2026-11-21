import test from "node:test";
import assert from "node:assert/strict";
import { seed } from "../seed.js";
import {
  can,
  modeAllowed,
  scopedStudents,
  dossier,
  reportsFor,
  notices,
  mutate,
  parseCSV,
  importRows,
  messages,
  attachment,
  archivedRooms,
} from "../domain.js";
const as = (s, user, role) => {
  s.session = { user, role, lastActivity: Date.now() };
  return s;
};
const fresh = (user = "sophie", role = "stages") => as(seed(), user, role);
const fails = (fn, re) => assert.throws(fn, re);
test("Jeu de données : 12 étudiants, deux promotions et sept rôles", () => {
  const s = seed();
  assert.equal(s.students.length, 12);
  assert.equal(s.students.filter((x) => x.promo === "M1").length, 6);
  assert.equal(new Set(s.users.flatMap((u) => u.roles)).size, 7);
});
test("Admin : aucune cohorte, aucun dossier, CRA, salon ou import métier", () => {
  const s = fresh("admin", "admin");
  assert.deepEqual(scopedStudents(s), []);
  for (const fn of [
    "dossier",
    "cra",
    "crv",
    "room",
    "reports",
    "imports",
    "missions",
    "transition",
  ]) {
    assert.equal(can("admin", fn, s), false);
    fails(() => dossier(s, "s1", fn));
  }
  fails(() =>
    mutate(s, "message", { student: "s1", room: "room1", text: "Interdit" }),
  );
  fails(() => importRows(s, [], "a.csv"));
});
test("RG-10 : M1 et M2 ne peuvent ouvrir aucune pièce ni aucun dossier", () => {
  for (const [u, r] of [
    ["thomas", "m1"],
    ["claire", "m2"],
  ]) {
    const s = fresh(u, r);
    for (const f of ["dossier", "cra", "crv", "room", "reports"])
      fails(() => dossier(s, r === "m1" ? "s1" : "s3", f));
    assert.ok(scopedStudents(s).every((d) => d.promo === r.toUpperCase()));
    assert.ok(
      scopedStudents(s).every((d) => !("email" in d) && !("mentor" in d)),
    );
  }
});
test("Un rôle absent du compte est rejeté", () => {
  const s = fresh("lucie", "stages");
  assert.equal(scopedStudents(s).length, 0);
  fails(() => mutate(s, "access", { student: "s2" }));
});
test("Tuteur : uniquement ses affectations, aucune lecture inter-tuteur", () => {
  const s = fresh("thomas", "tutor");
  assert.deepEqual(
    scopedStudents(s).map((x) => x.id),
    ["s2", "s8"],
  );
  fails(() => dossier(s, "s1"));
});
test("Entreprise : uniquement ses étudiants, jamais les CRA", () => {
  const s = fresh("marc", "company");
  assert.deepEqual(
    scopedStudents(s).map((x) => x.id),
    ["s1", "s3"],
  );
  fails(() => dossier(s, "s1", "cra"));
  fails(() => dossier(s, "s4"));
});
test("Étudiant : uniquement son propre dossier", () => {
  const s = fresh("lucie", "student");
  assert.equal(scopedStudents(s).length, 1);
  fails(() => dossier(s, "s3"));
});
test("Notifications cloisonnées par couple compte/rôle", () => {
  const s = fresh();
  assert.equal(notices(s).length, 2);
  as(s, "sophie", "tutor");
  assert.equal(notices(s).length, 1);
  assert.ok(notices(s).every((n) => n.role === "tutor"));
});
test("Signalement confidentiel invisible au maître de stage et au tuteur non auteur", () => {
  const s = fresh("anne", "company");
  assert.equal(reportsFor(s).length, 0);
  as(s, "sophie", "tutor");
  assert.equal(reportsFor(s).length, 0);
  as(s, "julien", "tutor");
  assert.equal(reportsFor(s).length, 1);
  as(s, "sophie", "stages");
  assert.equal(reportsFor(s).length, 1);
});
test("Transfert de signalement limité aux acteurs du dossier", () => {
  const s = fresh();
  fails(() =>
    mutate(s, "reportAction", { id: "r1", kind: "transfer", user: "claire" }),
  );
  mutate(s, "reportAction", { id: "r1", kind: "transfer", user: "anne" });
  as(s, "anne", "company");
  assert.equal(reportsFor(s).length, 1);
});
test("Dernier admin : désactivation et retrait de rôle interdits", () => {
  const s = fresh("admin", "admin"),
    u = s.users[0];
  fails(
    () =>
      mutate(s, "account", {
        ...u,
        roles: ["tutor"],
        active: true,
        reason: "Test",
      }),
    /dernier administrateur/,
  );
  fails(
    () =>
      mutate(s, "account", {
        ...u,
        active: false,
        confirm: "DÉSACTIVER",
        reason: "Test",
      }),
    /propre session/,
  );
});
test("Désactivation : motif et confirmation renforcée obligatoires", () => {
  const s = fresh("admin", "admin"),
    u = s.users.find((x) => x.id === "claire");
  fails(() => mutate(s, "account", { ...u, active: false }), /motif/);
  fails(
    () => mutate(s, "account", { ...u, active: false, reason: "Départ" }),
    /DÉSACTIVER/,
  );
  mutate(s, "account", {
    ...u,
    active: false,
    reason: "Départ",
    confirm: "DÉSACTIVER",
  });
  assert.equal(s.users.find((x) => x.id === "claire").active, false);
});
test("Attribution Admin : confirmation ADMIN obligatoire", () => {
  const s = fresh("admin", "admin"),
    u = s.users.find((x) => x.id === "claire");
  fails(
    () =>
      mutate(s, "account", { ...u, roles: ["m2", "admin"], reason: "Gestion" }),
    /ADMIN/,
  );
  mutate(s, "account", {
    ...u,
    roles: ["m2", "admin"],
    reason: "Gestion",
    confirm: "ADMIN",
  });
  assert.ok(s.users.find((x) => x.id === "claire").roles.includes("admin"));
});
test("Permissions : impossible d’activer un droit métier interdit", () => {
  const s = fresh("admin", "admin");
  fails(
    () =>
      mutate(s, "permissions", {
        changes: { admin: { dossier: true } },
        reason: "Essai",
      }),
    /verrouillé/,
  );
  fails(
    () =>
      mutate(s, "permissions", {
        changes: { m1: { cra: true } },
        reason: "Essai",
      }),
    /verrouillé/,
  );
});
test("Permissions : aucun changement sans motif et révocation effective", () => {
  const s = fresh("admin", "admin");
  fails(
    () => mutate(s, "permissions", { changes: { tutor: { cra: false } } }),
    /motif/,
  );
  mutate(s, "permissions", {
    changes: { tutor: { cra: false } },
    reason: "Suspension pédagogique",
  });
  as(s, "sophie", "tutor");
  fails(() => dossier(s, "s1", "cra"));
  assert.equal(s.history[0].type, "Permissions");
});
test("Permissions granulaires : lecture maintenue, validation CRA retirée", () => {
  const s = fresh("admin", "admin");
  mutate(s, "permissions", {
    changes: { tutor: { "cra:validate": false } },
    reason: "Séparation temporaire",
  });
  as(s, "sophie", "tutor");
  assert.ok(dossier(s, "s1", "cra"));
  fails(
    () =>
      mutate(s, "craReview", { student: "s1", id: "cra1", status: "Validé" }),
    /Autorisation/,
  );
});
test("Paramètres : motif, historique Avant/Après et atomicité sur erreur", () => {
  const s = fresh("admin", "admin"),
    before = structuredClone(s.settings);
  fails(() =>
    mutate(s, "settings", {
      ...s.settings,
      craDays: 12,
      crvDays: -3,
      reason: "Test",
    }),
  );
  assert.deepEqual(s.settings, before);
  mutate(s, "settings", {
    ...s.settings,
    craDays: 12,
    reason: "Harmonisation",
  });
  assert.equal(s.settings.craDays, 12);
  assert.equal(s.history[0].before.craDays, 30);
});
test("Paramétrage métier délégué : pas de modification des limites techniques", () => {
  const s = fresh();
  fails(() =>
    mutate(s, "settings", { ...s.settings, craDays: 20, reason: "Test" }),
  );
  as(s, "admin", "admin");
  mutate(s, "settings", {
    ...s.settings,
    delegateBusiness: true,
    reason: "Délégation",
  });
  as(s, "sophie", "stages");
  mutate(s, "settings", {
    ...s.settings,
    craDays: 20,
    maxMB: 999,
    sessionMinutes: 999,
    reason: "Métier",
  });
  assert.equal(s.settings.craDays, 20);
  assert.equal(s.settings.maxMB, 10);
  assert.equal(s.settings.sessionMinutes, 60);
});
test("Mission : capacité recontrôlée au moment de l’acceptation", () => {
  const s = fresh("sophie", "tutor");
  s.users.find((x) => x.id === "sophie").capacity = 3;
  fails(
    () => mutate(s, "missionDecision", { id: "m1", decision: "Accepter" }),
    /Capacité/,
  );
  assert.equal(s.students.find((x) => x.id === "s5").tutor, null);
});
test("Mission : acceptation affecte le dossier et conserve l’ancien tuteur", () => {
  const s = fresh("sophie", "tutor");
  s.students.find((x) => x.id === "s5").tutor = "thomas";
  mutate(s, "missionDecision", { id: "m1", decision: "Accepter" });
  assert.equal(s.students.find((x) => x.id === "s5").tutor, "sophie");
  assert.ok(
    s.history.some((h) => h.type === "Ancien tuteur" && h.tutor === "thomas"),
  );
});
test("Mission : refus sans motif interdit", () => {
  const s = fresh("sophie", "tutor");
  fails(
    () => mutate(s, "missionDecision", { id: "m1", decision: "Refuser" }),
    /motif/,
  );
  mutate(s, "missionDecision", {
    id: "m1",
    decision: "Refuser",
    reason: "Déplacements incompatibles",
  });
  assert.equal(s.missions[0].status, "Refusée");
});
test("Disponibilité : capacité inférieure à la charge interdite", () => {
  const s = fresh("sophie", "tutor");
  fails(
    () => mutate(s, "availability", { capacity: 2, available: true }),
    /capacité/,
  );
});
test("CRA : brouillon puis envoi, association explicite requise", () => {
  const s = fresh("lucie", "student"),
    p = {
      student: "s1",
      period: "Décembre",
      activities: "API",
      difficulties: "Aucune",
      next: "Tests",
      request: "req1",
    };
  fails(() => mutate(s, "craSend", p), /association/);
  mutate(s, "craDraft", { ...p, linkConfirmed: true });
  let c = s.cra[0];
  assert.equal(c.status, "Brouillon");
  mutate(s, "craSend", { ...p, id: c.id, linkConfirmed: true });
  assert.equal(s.cra[0].status, "À lire");
  assert.equal(s.cra.filter((x) => x.id === c.id).length, 1);
});
test("CRA : validation réservée au tuteur affecté, complément motivé", () => {
  const s = fresh("thomas", "tutor");
  fails(() =>
    mutate(s, "craReview", { student: "s1", id: "cra1", status: "Validé" }),
  );
  as(s, "sophie", "tutor");
  fails(
    () =>
      mutate(s, "craReview", {
        student: "s1",
        id: "cra1",
        status: "À compléter",
      }),
    /corrections/,
  );
  mutate(s, "craReview", {
    student: "s1",
    id: "cra1",
    status: "Validé",
    feedback: "Très bien",
  });
  assert.equal(s.cra[0].status, "Validé");
});
test("CRV : impossible de signer hors de l’ordre Tuteur → Entreprise → Étudiant", () => {
  const s = fresh("lucie", "student");
  fails(() => mutate(s, "visa", { student: "s1" }), /circuit/);
  as(s, "marc", "company");
  mutate(s, "visa", { student: "s1" });
  as(s, "lucie", "student");
  mutate(s, "visa", { student: "s1" });
  assert.equal(s.crvs[0].visas.length, 3);
});
test("CRV : désaccord gèle tous les visas", () => {
  const s = fresh("sophie", "tutor");
  fails(() => mutate(s, "visa", { student: "s3" }), /gelés/);
});
test("CRV : rectification interdite sans délégation active", () => {
  const s = fresh("marc", "company");
  fails(
    () => mutate(s, "rectify", { student: "s3", text: "Rectifié" }),
    /délégation/,
  );
});
test("CRV : délégation, révocation puis rectification versionnée et 0/3 visas", () => {
  const s = fresh("sophie", "tutor"),
    before = s.crvs[1].text;
  mutate(s, "delegate", { student: "s3" });
  mutate(s, "delegate", { student: "s3" });
  assert.equal(s.crvs[1].delegated, false);
  mutate(s, "delegate", { student: "s3" });
  as(s, "marc", "company");
  mutate(s, "rectify", { student: "s3", text: "Version rectifiée" });
  const c = s.crvs[1];
  assert.equal(c.versions[0].before, before);
  assert.equal(c.text, "Version rectifiée");
  assert.equal(c.disagreement, false);
  assert.equal(c.delegated, false);
  assert.deepEqual(c.visas, []);
  fails(() => mutate(s, "rectify", { student: "s3", text: "Encore" }));
});
test("CRV : amendement sans altérer le texte original", () => {
  const s = fresh("marc", "company"),
    before = s.crvs[0].text;
  mutate(s, "amend", { student: "s1", text: "Une précision" });
  assert.equal(s.crvs[0].text, before);
  assert.equal(s.crvs[0].amendments.length, 1);
});
test("Visites : date passée rejetée et proposition confirmable uniquement par le tuteur", () => {
  const s = fresh("lucie", "student");
  fails(() =>
    mutate(s, "visit", {
      student: "s1",
      date: "2026-01-01",
      time: "10:00",
      place: "Visio",
    }),
  );
  mutate(s, "visit", {
    student: "s1",
    date: "2026-12-01",
    time: "10:00",
    place: "Visio",
  });
  fails(() => mutate(s, "visitConfirm", { student: "s1", id: s.visits[0].id }));
  as(s, "sophie", "tutor");
  mutate(s, "visitConfirm", { student: "s1", id: s.visits[0].id });
  assert.equal(s.visits[0].status, "Confirmée");
});
test("Accès entreprise : demande modifiable avant traitement, salon automatique ensuite", () => {
  const s = fresh("emma", "student");
  mutate(s, "onboarding", {
    student: "s2",
    company: "Somme Digital",
    mentorName: "Paul Garnier",
    mentorEmail: "paul.garnier@somme-digital.fr",
  });
  as(s, "sophie", "stages");
  mutate(s, "access", { student: "s2" });
  assert.ok(s.rooms.some((r) => r.student === "s2"));
  assert.equal(s.emails.length, 1);
  as(s, "emma", "student");
  fails(
    () => mutate(s, "onboarding", { student: "s2", company: "Autre" }),
    /déjà été traitée/,
  );
});
test("Salons : ciblage hors acteurs rejeté et responsable inclus pour l’étudiant", () => {
  const s = fresh("lucie", "student");
  fails(
    () =>
      mutate(s, "message", {
        student: "s1",
        room: "room1",
        text: "Test",
        recipients: ["claire"],
      }),
    /destinataire/,
  );
  mutate(s, "message", {
    student: "s1",
    room: "room1",
    text: "Ciblé",
    recipients: ["marc"],
  });
  assert.ok(s.rooms[0].messages.at(-1).recipients.includes("sophie"));
  as(s, "marc", "company");
  assert.equal(messages(s, s.rooms[0]).at(-1).text, "Ciblé");
});
test("Salons : fermeture motivée et historique définitivement en lecture seule", () => {
  const s = fresh();
  fails(() => mutate(s, "roomClose", { student: "s4" }), /motif/);
  mutate(s, "roomClose", { student: "s4", reason: "Rupture actée" });
  as(s, "chloe", "student");
  fails(
    () => mutate(s, "message", { student: "s4", room: "room3", text: "Non" }),
    /fermé/,
  );
});
test("Rupture : nouveau cycle conserve archive sans exposer le nouveau dossier aux anciens acteurs", () => {
  const s = fresh();
  fails(
    () => mutate(s, "newCycle", { student: "s4", reason: "Nouveau contrat" }),
    /Fermez/,
  );
  mutate(s, "roomClose", { student: "s4", reason: "Rupture actée" });
  mutate(s, "newCycle", {
    student: "s4",
    reason: "Recherche d’un nouveau contrat",
  });
  assert.equal(s.students.find((x) => x.id === "s4").cycle, 2);
  as(s, "anne", "company");
  assert.equal(scopedStudents(s).length, 0);
  assert.equal(archivedRooms(s).length, 1);
  assert.equal(archivedRooms(s)[0].summary.company, "Groupe Verne");
});
test("Bascule : M1 propose, responsable stages applique", () => {
  const s = fresh("thomas", "m1");
  mutate(s, "transition", { ids: ["s1"], decision: "Passer en M2" });
  assert.equal(s.students[0].promo, "M1");
  assert.equal(s.decisions[0].status, "Proposée");
  as(s, "sophie", "stages");
  mutate(s, "transition", { ids: ["s1"], decision: "Passer en M2" });
  as(s, "thomas", "m1");
  assert.ok(!scopedStudents(s).some((d) => d.id === "s1"));
  as(s, "claire", "m2");
  assert.ok(scopedStudents(s).some((d) => d.id === "s1"));
});
test("CSV : erreurs ligne par ligne et import tolérant", () => {
  const s = fresh(),
    rows = parseCSV(
      "nom;email;promotion\nAlice;alice@test.fr;M1\nDoublon;alice@test.fr;M1\nBob;invalide;M2\nEve;eve@test.fr;M3\nLucie Bernard;lucie.bernard@u-picardie.fr;M1",
      s,
    );
  assert.equal(rows.filter((x) => x.error).length, 3);
  const result = importRows(s, rows, "test.csv");
  assert.deepEqual(result, { created: 1, updated: 1, rejected: 3 });
  assert.equal(s.students.length, 13);
  assert.ok(!JSON.stringify(s.imports[0]).includes("Alice"));
});
test("CSV : guillemets et séparateur dans un nom", () => {
  const s = fresh(),
    rows = parseCSV('nom;email;promotion\n"Caron; Alice";alice@test.fr;M1', s);
  assert.equal(rows[0].nom, "Caron; Alice");
  assert.equal(rows[0].error, "");
});
test("Audit messages : motif obligatoire et trace avant lecture", () => {
  const s = fresh("admin", "admin");
  fails(() => mutate(s, "auditMessage", { room: "room2" }), /motif/);
  const n = s.audit.length;
  mutate(s, "auditMessage", {
    room: "room2",
    reason: "Incident de confidentialité signalé",
  });
  assert.equal(s.audit.length, n + 1);
  assert.equal(s.audit[0].type, "Consultation message");
  assert.ok(s.audit[0].detail.includes("Incident"));
});
test("Pièces jointes : format et taille contrôlés", () => {
  const s = seed();
  fails(() => attachment({ name: "script.exe", size: 10 }, s), /autorisés/);
  fails(
    () => attachment({ name: "a.pdf", size: 11 * 1024 * 1024 }, s),
    /taille maximale/,
  );
  assert.equal(
    attachment({ name: "bilan.pdf", size: 200 }, s).name,
    "bilan.pdf",
  );
});
test("Une mutation rejetée ne change jamais le jeu de données", () => {
  const s = fresh("marc", "company"),
    before = structuredClone(s);
  fails(() => mutate(s, "rectify", { student: "s1", text: "Attaque" }));
  assert.deepEqual(s, before);
});
test("Expiration : le moteur refuse les lectures et écritures après inactivité", () => {
  const s = fresh();
  s.session.lastActivity = Date.now() - 61 * 60000;
  assert.deepEqual(scopedStudents(s), []);
  assert.deepEqual(notices(s), []);
  fails(() => mutate(s, "access", { student: "s2" }));
});
test("Import : les données sont revalidées par le moteur, pas seulement par l’aperçu", () => {
  const s = fresh();
  const result = importRows(
    s,
    [{ nom: "Test", email: "invalide", promotion: "M1", error: "" }],
    "fichier.csv",
  );
  assert.equal(result.created, 0);
  assert.equal(result.rejected, 1);
});
test("Capacité : une valeur non numérique est rejetée", () => {
  const s = fresh("sophie", "tutor");
  fails(() => mutate(s, "availability", { capacity: "abc", available: true }));
});
test("Nouveau cycle : aucun double incrément sans nouvelle rupture", () => {
  const s = fresh();
  mutate(s, "roomClose", { student: "s4", reason: "Rupture" });
  mutate(s, "newCycle", { student: "s4", reason: "Nouveau contrat" });
  fails(
    () => mutate(s, "newCycle", { student: "s4", reason: "Double clic" }),
    /rupture/,
  );
  assert.equal(s.students.find((d) => d.id === "s4").cycle, 2);
});

test("CSV : détecte le séparateur hors guillemets et conserve les numéros physiques", () => {
  const s = fresh();
  const text = [
    "\uFEFF", "  ", '"Notes;libres", NOM, EMAIL, PROMOTION, VILLE',
    '"info;ok", "Caron, ""Alice""", ALICE@EXAMPLE.FR , m1 , "Amiens; Centre"',
    "", "   ", 'suite, Bob, bob@example.fr, M2, Lille',
  ].join("\r\n");
  const rows = parseCSV(text, s);
  assert.deepEqual(rows.map((x) => x.line), [4, 7]);
  assert.equal(rows[0].nom, 'Caron, "Alice"');
  assert.equal(rows[0].email, "alice@example.fr");
  assert.equal(rows[0].promotion, "M1");
  assert.equal(rows[0].ville, "Amiens; Centre");
  assert.ok(rows.every((x) => !x.error));
  assert.deepEqual(importRows(s, rows, "virgules.csv"), { created: 2, updated: 0, rejected: 0 });
  assert.equal(s.students.at(-2).city, "Amiens; Centre");
  assert.deepEqual(parseCSV("nom;email;promotion\r\rA;a@b.fr;M1", fresh()).map((r) => r.line), [3]);
});

test("CSV : rejette les en-têtes mal formés, ambigus ou réservés", () => {
  const s = fresh();
  for (const header of [
    "nom;email;promotion; NOM ",
    '"nom";email;promotion;"Email"',
    "nom;email;promotion;ville;VILLE",
  ]) fails(() => parseCSV(header + "\nAlice;a@b.fr;M1;x;x", s), /double/i);
  fails(() => parseCSV('nom;email;"promotion\nAlice;a@b.fr;M1', s), /en-tête.*guillemets/i);
  fails(() => parseCSV("nom;email;promotion;\nAlice;a@b.fr;M1;", s), /sans nom/i);
  fails(() => parseCSV("nom;email;promotion;line\nAlice;a@b.fr;M1;999", s), /réservé/i);
  fails(() => parseCSV("nom;email;promotion;error\nAlice;a@b.fr;M1;", s), /réservé/i);
  fails(() => parseCSV("nom;mail;promotion\nAlice;a@b.fr;M1", s), /Colonnes requises/);
  fails(() => parseCSV("nom,email,promotion;nom;email;promotion;X,nom,email,promotion", s), /séparateur ambigu/i);
});

test("CSV : rejets syntaxiques par ligne et import des lignes saines suivantes", () => {
  const s = fresh();
  const rows = parseCSV([
    "nom;email;promotion",
    "Bonne;bonne@example.fr;M1",
    '"Non fermé;nonferme@example.fr;M1',
    'Al"ice;interne@example.fr;M1',
    '"Alice"x;apres@example.fr;M1',
    "Trop;trop@example.fr;M1;excédent",
    "Court;court@example.fr",
    "",
    "Diane;diane@example.fr;M2",
  ].join("\n"), s);
  assert.deepEqual(rows.map((r) => r.line), [2, 3, 4, 5, 6, 7, 9]);
  assert.deepEqual(rows.map((r) => !!r.error), [false, true, true, true, true, true, false]);
  assert.match(rows[1].error, /guillemets/);
  assert.match(rows[4].error, /colonnes/);
  // Effacer l’erreur et même corriger les champs en mémoire ne valide pas une ligne mal parsée.
  Object.assign(rows[1], { nom: "Fausse", email: "fausse@example.fr", promotion: "M1", error: "" });
  assert.deepEqual(importRows(s, rows, "malforme.csv"), { created: 2, updated: 0, rejected: 5 });
  assert.ok(!s.students.some((x) => x.email === "fausse@example.fr"));
});

test("CSV : une ligne invalide ne réserve pas l’e-mail d’une ligne valide ultérieure", () => {
  const s = fresh();
  const rows = parseCSV("nom;email;promotion\n; Même@EXAMPLE.fr ;M1\nMême; même@example.FR ;M1\nAutre;MÊME@example.fr;M1", s);
  assert.match(rows[0].error, /Nom manquant/);
  assert.equal(rows[1].error, "");
  assert.match(rows[2].error, /Doublon/);
  assert.deepEqual(importRows(s, rows, "doublons.csv"), { created: 1, updated: 0, rejected: 2 });
  assert.equal(s.students.at(-1).email, "même@example.fr");
});

test("Import direct : mêmes contrôles et normalisation, y compris types et e-mails malformés", () => {
  const s = fresh();
  const rows = [
    { nom: "  Alice  ", email: " ALICE@Example.FR ", promotion: " m1 ", ville: " Amiens " },
    { nom: "Alice bis", email: "alice@example.fr", promotion: "M1" },
    { nom: "  ", email: "vide@example.fr", promotion: "M1" },
    { nom: "Bob", email: "bob@autre@example.fr", promotion: "M2" },
    { nom: "Fausse", email: "ligne@example.fr\n", promotion: "M2" },
    { nom: "Faux\nNom", email: "faux@example.fr", promotion: "M1" },
    { nom: "Points", email: "a..b@example.fr", promotion: "M1" },
    { nom: "Domaine", email: "a@example..fr", promotion: "M1" },
    { nom: "Tiret", email: "a@-example.fr", promotion: "M1" },
    { nom: "Guillemet", email: 'a"@example.fr', promotion: "M1" },
    { nom: "Type", email: Symbol("invalide"), promotion: "M1" },
    null,
  ];
  assert.deepEqual(importRows(s, rows, "direct.csv"), { created: 1, updated: 0, rejected: 11 });
  const alice = s.students.at(-1);
  assert.equal(alice.name, "Alice");
  assert.equal(alice.email, "alice@example.fr");
  assert.equal(alice.promo, "M1");
  assert.equal(alice.city, "Amiens");
});

test("Import : les collisions avec les comptes ne créent pas d’identité incohérente", () => {
  const s = fresh();
  s.users.push({ id: "seul", name: "Compte Seul", email: " Seul@Example.fr ", roles: ["student"], active: true });
  const rows = parseCSV([
    "nom;email;promotion",
    "Sophie Laurent; SOPHIE.LAURENT@U-PICARDIE.FR ;M1",
    "Compte Seul;seul@example.fr;M1",
    "Autre Nom;lucie.bernard@u-picardie.fr;M2",
    "Nouvelle;nouvELLE@example.fr;M2",
  ].join("\n"), s);
  assert.match(rows[0].error, /compte non lié/);
  assert.match(rows[1].error, /compte non lié/);
  assert.match(rows[2].error, /Nom différent/);
  assert.deepEqual(importRows(s, rows, "identites.csv"), { created: 1, updated: 0, rejected: 3 });
  assert.equal(s.students.find((x) => x.id === "s1").name, "Lucie Bernard");
  assert.ok(!s.students.some((x) => x.email === "seul@example.fr"));
});

test("Import : compte lié cohérent, e-mail normalisé et nom de compte préservé", () => {
  const s = fresh();
  const st = s.students.find((x) => x.id === "s1");
  st.email = "  LUCIE.BERNARD@U-PICARDIE.FR ";
  const rows = parseCSV("nom;email;promotion\n lucie bernard ; Lucie.Bernard@u-picardie.fr ; M2 ", s);
  assert.equal(rows[0].kind, "Mise à jour");
  assert.equal(rows[0].error, "");
  assert.deepEqual(importRows(s, rows, "mise-a-jour.csv"), { created: 0, updated: 1, rejected: 0 });
  assert.equal(st.name, "Lucie Bernard");
  assert.equal(st.promo, "M2");
  assert.equal(st.user, "lucie");
  assert.equal(s.students.length, 12);
});

test("Import : dossiers et comptes ambigus ou liens rompus sont rejetés", () => {
  for (const scenario of ["students", "duplicate-id", "users", "missing", "wrong-role", "linked-twice", "unlinked"]) {
    const s = fresh();
    const st = s.students.find((x) => x.id === "s1");
    const u = s.users.find((x) => x.id === "lucie");
    if (scenario === "students") s.students.push({ ...st, id: "autre" });
    if (scenario === "duplicate-id") s.students.push({ ...st, email: "autre@example.fr" });
    if (scenario === "users") s.users.push({ ...u, id: "autre", email: " LUCIE.BERNARD@U-PICARDIE.FR " });
    if (scenario === "missing") st.user = "inconnu";
    if (scenario === "wrong-role") u.roles = ["tutor"];
    if (scenario === "linked-twice") s.students.push({ ...st, id: "autre", email: "autre@example.fr" });
    if (scenario === "unlinked") delete st.user;
    const rows = parseCSV("nom;email;promotion\nLucie Bernard;lucie.bernard@u-picardie.fr;M2", s);
    assert.ok(rows[0].error, scenario);
    assert.deepEqual(importRows(s, rows, "ambigue.csv"), { created: 0, updated: 0, rejected: 1 }, scenario);
    assert.equal(st.promo, "M1", scenario);
  }
});

test("Import : revalidation de l’état et de la cible depuis l’aperçu", () => {
  const s = fresh();
  const rows = parseCSV([
    "nom;email;promotion",
    "Lucie Bernard;lucie.bernard@u-picardie.fr;M2",
    "Nouvelle;nouvelle@example.fr;M1",
    "Modification;modif@example.fr;M1",
    "Valide;valide@example.fr;M2",
  ].join("\n"), s);
  assert.ok(rows.every((r) => !r.error));
  s.users.find((u) => u.id === "lucie").roles = ["tutor"];
  s.students.push({ id: "concurrent", name: "Ne pas écraser", email: "nouvelle@example.fr", promo: "M2" });
  rows[2].nom = "Changement non prévisualisé";
  assert.deepEqual(importRows(s, rows, "perime.csv"), { created: 1, updated: 0, rejected: 3 });
  assert.equal(s.students.find((x) => x.id === "s1").promo, "M1");
  assert.equal(s.students.find((x) => x.id === "concurrent").name, "Ne pas écraser");
  assert.ok(!s.students.some((x) => x.email === "modif@example.fr"));
});

test("Import : une collision de compte ou une révocation apparue depuis l’aperçu est contrôlée", () => {
  const s = fresh();
  const rows = parseCSV("nom;email;promotion\nAlice;alice@example.fr;M1\nBob;bob@example.fr;M2", s);
  s.users.push({ id: "nouveau", name: "Alice", email: " ALICE@EXAMPLE.FR ", roles: ["student"], active: true });
  assert.deepEqual(importRows(s, rows, "compte.csv"), { created: 1, updated: 0, rejected: 1 });
  assert.ok(!s.students.some((x) => x.email === "alice@example.fr"));

  const autre = parseCSV("nom;email;promotion\nClaire;nouvelle@example.fr;M1", s);
  s.overrides.stages = { "imports:validate": false };
  const before = structuredClone(s);
  fails(() => importRows(s, autre, "droits.csv"), /non autorisé/);
  assert.deepEqual(s, before);
});

test("Import : les identifiants créés restent uniques même si le générateur entre en collision", () => {
  const s = fresh();
  const now = Date.now(), originalNow = Date.now, originalRandom = Math.random;
  const base = `s-${now.toString(36)}-${(0.5).toString(36).slice(2, 7)}`;
  s.students.push({ id: base, name: "Ancien", email: "ancien@example.fr", promo: "M1" });
  s.students.push({ id: base + "-1", name: "Ancien 2", email: "ancien2@example.fr", promo: "M1" });
  try {
    Date.now = () => now;
    Math.random = () => 0.5;
    const result = importRows(s, [
      { nom: "A", email: "a@example.fr", promotion: "M1" },
      { nom: "B", email: "b@example.fr", promotion: "M1" },
      { nom: "C", email: "c@example.fr", promotion: "M1" },
    ], "ids.csv");
    assert.deepEqual(result, { created: 3, updated: 0, rejected: 0 });
    assert.deepEqual(s.students.slice(-3).map((x) => x.id), [base + "-2", base + "-3", base + "-4"]);
    assert.equal(new Set(s.students.map((x) => x.id)).size, s.students.length);
  } finally {
    Date.now = originalNow;
    Math.random = originalRandom;
  }
});

test("Import : un rejet d’aperçu reste exclu et ne peut injecter de données dans le journal", () => {
  const s = fresh();
  const rows = parseCSV("nom;email;promotion\n;vide@example.fr;M1", s);
  Object.assign(rows[0], { nom: "Secret", error: "" });
  assert.deepEqual(importRows(s, rows, "rejet.csv"), { created: 0, updated: 0, rejected: 1 });
  assert.deepEqual(importRows(s, [{ nom: "Secret", email: "secret@example.fr", promotion: "M1", error: "Donnée confidentielle" }], "direct.csv"), { created: 0, updated: 0, rejected: 1 });
  assert.ok(!JSON.stringify(s.imports[0]).includes("Donnée confidentielle"));
  assert.match(s.imports[0].reasons, /rejetée à l’aperçu/);
});

test("Import : limite de 10 000 lignes à l’aperçu et à la confirmation", () => {
  const s = fresh();
  const header = "nom;email;promotion\n";
  const lines = "A;a@example.fr;M1\n".repeat(10000);
  assert.equal(parseCSV(header + lines, s).length, 10000);
  fails(() => parseCSV(header + lines + "B;b@example.fr;M2", s), /10 000/);
  const invalid = { nom: "", email: "a@example.fr", promotion: "M1" };
  assert.deepEqual(importRows(s, Array(10000).fill(invalid), "limite.csv"), { created: 0, updated: 0, rejected: 10000 });
  fails(() => importRows(s, Array(10001).fill(invalid), "trop.csv"), /10 000/);
  const valid = Array.from({ length: 10000 }, (_, i) => ({
    nom: `Étudiant ${i}`,
    email: `etudiant${i}@example.fr`,
    promotion: "M1",
  }));
  assert.deepEqual(importRows(s, valid, "limite-valide.csv"), { created: 10000, updated: 0, rejected: 0 });
  assert.equal(new Set(s.students.map((x) => x.id)).size, s.students.length);
});

test("CSV : le jeu d’exemple conserve ses deux créations, une mise à jour et trois rejets", () => {
  const s = fresh();
  const rows = parseCSV([
    "nom;email;promotion;ville",
    "Alice Caron;alice.caron@u-picardie.fr;M1;Amiens",
    "Lucie Bernard;lucie.bernard@u-picardie.fr;M1;Amiens",
    "Yanis Noël;yanis.noel@u-picardie.fr;M2;Lille",
    "Alice Caron;alice.caron@u-picardie.fr;M1;Amiens",
    "Sarah Faure;sarah.sans-arobase;M1;Beauvais",
    "Noé Lambert;noe.lambert@u-picardie.fr;L3;Amiens",
  ].join("\n"), s);
  assert.equal(rows.filter((r) => r.error).length, 3);
  assert.deepEqual(importRows(s, rows, "exemple.csv"), { created: 2, updated: 1, rejected: 3 });
});
