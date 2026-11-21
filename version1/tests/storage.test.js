import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script, runInNewContext } from "node:vm";
import { seed } from "../seed.js";
import { KEY, importRows, mutate } from "../domain.js";
import { compatibleState, readStoredState, writeStoredState } from "../storage.js";

function memory(value = null) {
  let raw = value, writes = 0;
  return { localStorage: {
    getItem: (key) => key === KEY ? raw : null,
    setItem: (key, data) => { if (key === KEY) { raw = data; writes++; } },
  }, raw: () => raw, writes: () => writes };
}

function sample() {
  const s = seed();
  s.decisions.push({ id: "dec1", student: "s1", decision: "Passer en M2", author: "thomas", status: "Proposée", date: "2026-11-21" });
  s.emails.push({ to: "test@example.fr", text: "Texte", date: "21/11/2026" });
  s.history.push({ type: "Ancien tuteur", student: "s1", tutor: "thomas", date: "2026-11-21" });
  return s;
}

const collections = {
  users: "active", students: "status", visits: "date", cra: "student",
  crvs: "student", missions: "history", requests: "text", reports: "shared",
  notifications: "user", decisions: "decision", imports: "rejected", audit: "detail",
  history: "date", rooms: "student", emails: "to",
};

test("Stockage : jeu initial, collections vides et données supplémentaires compatibles", () => {
  assert.equal(compatibleState(seed()), true);
  const host = memory(JSON.stringify(seed()));
  assert.equal(readStoredState(host).issue, null);
  assert.equal(readStoredState(host).state.students.length, 12);
  const s = sample();
  for (const key of Object.keys(collections)) s[key] = [];
  s.extra = { nouvellesDonnees: true };
  assert.equal(compatibleState(s), true);
  assert.equal(writeStoredState(s, null, host), null);
  assert.deepEqual(readStoredState(host).state, s);
});

test("Stockage : toute collection absente, nulle ou non tableau est incompatible", () => {
  for (const key of Object.keys(collections)) {
    for (const replacement of [undefined, null, {}]) {
      const s = sample();
      if (replacement === undefined) delete s[key]; else s[key] = replacement;
      assert.equal(compatibleState(s), false, `${key} = ${String(replacement)}`);
    }
  }
});

test("Stockage : éléments nuls et champs indispensables absents ou nuls dans chaque collection", () => {
  for (const [key, field] of Object.entries(collections)) {
    for (const corruption of ["element null", "element tableau", "objet vide", "champ absent", "champ null"]) {
      const s = sample();
      if (corruption === "element null") s[key][0] = null;
      if (corruption === "element tableau") s[key][0] = [];
      if (corruption === "objet vide") s[key][0] = {};
      if (corruption === "champ absent") delete s[key][0][field];
      if (corruption === "champ null") s[key][0][field] = null;
      const original = JSON.stringify(s, null, 2);
      assert.equal(compatibleState(s), false, `${key} : ${corruption}`);
      const host = memory(original);
      const loaded = readStoredState(host);
      assert.equal(loaded.issue, "incompatible", `${key} : ${corruption}`);
      assert.equal(writeStoredState(loaded.state, loaded.issue, host), "incompatible");
      assert.equal(host.raw(), original, `${key} : contenu original conservé`);
      assert.equal(host.writes(), 0);
    }
  }
});

test("Stockage : chaque champ structurel indispensable est protégé contre l’absence et null", () => {
  const fields = {
    users: ["id", "name", "email", "roles", "active"],
    students: ["id", "name", "email", "promo", "status", "access", "company", "city", "step", "cycle"],
    visits: ["id", "student", "date", "time", "status", "place"],
    cra: ["id", "student", "status", "date", "period", "activities"],
    requests: ["id", "student", "date", "text", "due"],
    missions: ["id", "student", "tutor", "status", "title", "description", "history"],
    reports: ["id", "student", "author", "status", "date", "text", "shared", "notes"],
    crvs: ["id", "student", "due", "text", "visas", "amendments", "versions", "delegated", "disagreement"],
    rooms: ["id", "student", "cycle", "closed", "messages"],
    notifications: ["id", "user", "role", "text", "read"],
    emails: ["to", "date", "text"],
    decisions: ["id", "student", "decision", "author", "status", "date"],
    imports: ["id", "date", "author", "reasons", "created", "updated", "rejected"],
    audit: ["id", "date", "author", "type", "result", "target", "detail"],
    history: ["type", "date", "student", "tutor"],
  };
  for (const [collection, keys] of Object.entries(fields)) {
    for (const key of keys) {
      for (const remove of [false, true]) {
        const s = sample();
        if (remove) delete s[collection][0][key]; else s[collection][0][key] = null;
        assert.equal(compatibleState(s), false, `${collection}.${key} ${remove ? "absent" : "null"}`);
      }
    }
  }
});

test("Stockage : tableaux et éléments imbriqués indispensables sont contrôlés", () => {
  const corruptions = [
    (s) => { s.users[0].roles = [null]; },
    (s) => { s.missions[0].history = [null]; },
    (s) => { s.missions[0].history = [{ decision: "Refusée", date: "x" }]; },
    (s) => { s.reports[0].shared = [null]; },
    (s) => { s.reports[0].notes = [null]; },
    (s) => { s.reports[0].notes = [{ author: "sophie" }]; },
    (s) => { s.crvs[0].visas = [null]; },
    (s) => { s.crvs[0].versions = [null]; },
    (s) => { s.crvs[0].versions = [{ author: "marc", date: "x", before: "avant" }]; },
    (s) => { s.crvs[0].amendments = [null]; },
    (s) => { s.crvs[0].amendments = [{ author: "marc", date: "x" }]; },
    (s) => { s.crvs[0].arbitrationNotes = [null]; },
    (s) => { s.crvs[0].arbitrationNotes = {}; },
    (s) => { s.rooms[0].actors = [null]; },
    (s) => { s.rooms[0].messages = [null]; },
    (s) => { delete s.rooms[0].messages[0].author; },
    (s) => { s.rooms[0].messages[0].recipients = null; },
    (s) => { s.rooms[0].messages[0].recipients = [null]; },
    (s) => { s.history = [{ type: "Paramètres", date: "x", author: "admin", before: {}, reason: "x" }]; },
    (s) => { s.history = [{ type: "Contrat archivé", date: "x", student: "s1", reason: "x" }]; },
  ];
  corruptions.forEach((corrupt, index) => {
    const s = sample();
    corrupt(s);
    assert.equal(compatibleState(s), false, `corruption imbriquée ${index}`);
    const host = memory(JSON.stringify(s));
    const original = host.raw();
    const loaded = readStoredState(host);
    assert.equal(loaded.issue, "incompatible");
    assert.equal(writeStoredState(loaded.state, loaded.issue, host), "incompatible");
    assert.equal(host.raw(), original);
  });
});

test("Stockage : champs facultatifs, valeurs libres et références historiques ne sont pas survalidés", () => {
  const s = sample();
  // Étudiant non lié ni contractuellement complet, comme après certains imports
  // et une proposition de mission sans type de contrat.
  const d = s.students.find((item) => item.id === "s6");
  delete d.contract;
  assert.equal(d.user, undefined);
  s.requests.push({ id: "q", student: "autre-dossier", text: "Consigne", due: "plus tard", date: "date libre" });
  s.cra.push({ id: "c", student: "autre-dossier", status: "Brouillon", date: "date libre", period: "", activities: "", request: null, attachment: null });
  s.visits[0].status = "Ancien statut";
  s.visits[0].alternative = null;
  s.reports[0].category = null;
  s.crvs[0].arbitrationNotes = null;
  s.rooms[0].summary = null;
  s.rooms[0].closed = true;
  s.rooms[0].actors = null;
  delete s.rooms[1].actors;
  s.imports[0].file = null;
  s.history.push({ type: "Ancien type conservé", date: "date libre", autre: null });
  s.notifications.push({ id: "n", user: "inconnu", role: "ancien rôle", text: "", read: false });
  s.students[0].cycle = 10001;
  s.settings.sessionMinutes = 100000;
  s.unknownField = { contenu: "préservé" };
  const before = JSON.stringify(s);
  assert.equal(compatibleState(s), true);
  assert.equal(JSON.stringify(s), before, "la validation ne modifie pas les données");
  const host = memory();
  assert.equal(writeStoredState(s, null, host), null);
  assert.deepEqual(readStoredState(host).state, s);
});

test("Stockage : aucune limite de taille ou d’unicité n’est ajoutée aux collections", () => {
  const s = seed();
  s.notifications = Array.from({ length: 10001 }, () => ({ id: "identique", user: "autre", role: "ancien", text: "", read: false }));
  assert.equal(compatibleState(s), true);
  const host = memory();
  assert.equal(writeStoredState(s, null, host), null);
  assert.equal(readStoredState(host).state.notifications.length, 10001);
});

test("Stockage : mutations et imports du domaine restent compatibles après sérialisation", () => {
  const s = seed();
  const as = (user, role) => { s.session = { user, role, lastActivity: Date.now() }; };
  const check = (label) => {
    assert.equal(compatibleState(s), true, `${label} en mémoire`);
    const roundtrip = JSON.parse(JSON.stringify(s));
    assert.equal(compatibleState(roundtrip), true, `${label} après JSON`);
    const host = memory();
    assert.equal(writeStoredState(s, null, host), null, label);
    assert.deepEqual(readStoredState(host), { state: roundtrip, issue: null }, label);
  };
  as("lucie", "student");
  mutate(s, "craDraft", { student: "s1", period: "Décembre", activities: "Tests" });
  mutate(s, "visit", { student: "s1", date: "2026-12-01", time: "10:00", place: "Visio" });
  mutate(s, "report", { student: "s1", text: "Une difficulté" });
  mutate(s, "message", { student: "s1", room: "room1", text: "Bonjour" });
  check("brouillon sans difficultés ni prochaines étapes, signalement sans catégorie");
  as("sophie", "tutor");
  mutate(s, "request", { student: "s1", text: "Consigne", due: "2026-12-01" });
  mutate(s, "craReview", { student: "s1", id: "cra1", status: "Lu" });
  mutate(s, "delegate", { student: "s3" });
  check("demande sans type ni période et retour CRA absent");
  as("sophie", "stages");
  mutate(s, "reportAction", { id: "r1", kind: "note", text: "Note" });
  mutate(s, "reportAction", { id: "r1", kind: "transfer", user: "anne" });
  mutate(s, "crvArbitrate", { student: "s3", text: "Consigne" });
  mutate(s, "bulkInfo", { ids: ["s6"], text: "Information" });
  mutate(s, "mission", { student: "s5", tutor: "julien", title: "Mission", description: "Description", company: "Entreprise", address: "Adresse", city: "Amiens", start: "2026-12-01", end: "2027-12-01" });
  importRows(s, [{ nom: "Alice", email: "alice@example.fr", promotion: "M1" }]);
  check("mission sans contrat, e-mail sans id et import sans fichier");
  as("marc", "company");
  mutate(s, "amend", { student: "s1", text: "Précision" });
  mutate(s, "rectify", { student: "s3", text: "Rectifié" });
  check("amendement et version CRV");
  as("julien", "tutor");
  mutate(s, "missionDecision", { id: s.missions[0].id, decision: "Refuser", reason: "Motif" });
  check("historique de mission");
  as("thomas", "m1");
  mutate(s, "transition", { ids: ["s1"], decision: "Passer en M2" });
  check("décision de transition");
  as("sophie", "stages");
  mutate(s, "roomClose", { student: "s4", reason: "Rupture" });
  mutate(s, "newCycle", { student: "s4", reason: "Nouveau contrat" });
  check("salon archivé et nouveau cycle");
  as("admin", "admin");
  mutate(s, "permissions", { changes: { tutor: { cra: false } }, reason: "Motif" });
  mutate(s, "settings", { ...s.settings, reason: "Motif" });
  check("historiques de permissions et paramètres");
});

test("Stockage : JSON illisible, version future ou structure incomplète conservés", () => {
  for (const original of ['{"version":1,', JSON.stringify({ version: 2 }), JSON.stringify({ version: 1, users: [] })]) {
    const host = memory(original);
    const loaded = readStoredState(host);
    assert.equal(loaded.issue, "incompatible");
    assert.equal(writeStoredState(loaded.state, loaded.issue, host), "incompatible");
    assert.equal(host.raw(), original);
  }
});

test("Stockage : une valeur devenue incompatible depuis la lecture ne peut pas être écrasée", () => {
  for (const issue of [null, "unavailable"]) {
    for (const original of ['{illisible', JSON.stringify({ version: 2 }), JSON.stringify({ ...seed(), visits: [null] })]) {
      const host = memory(original);
      assert.equal(writeStoredState(seed(), issue, host), "incompatible");
      assert.equal(host.raw(), original);
      assert.equal(host.writes(), 0);
    }
  }
});

test("Stockage : une nouvelle valeur incompatible ne remplace pas les données existantes", () => {
  const original = JSON.stringify(seed(), null, 2);
  for (const bad of [null, { ...seed(), visits: [null] }, { ...seed(), history: [undefined] }]) {
    const host = memory(original);
    assert.equal(writeStoredState(bad, null, host), "incompatible");
    assert.equal(host.raw(), original);
    assert.equal(host.writes(), 0);
  }
});

test("Stockage : une lecture initiale indisponible ne permet pas d’écraser des données non lues", () => {
  const existing = seed();
  existing.preferences.theme = "dark";
  const original = JSON.stringify(existing, null, 2);
  let raw = original, readDenied = true, writes = 0;
  const host = { localStorage: {
    getItem() { if (readDenied) throw Error("lecture refusée"); return raw; },
    setItem(key, value) { assert.equal(key, KEY); raw = value; writes++; },
  } };
  const unread = readStoredState(host);
  assert.equal(unread.issue, "unavailable");
  assert.equal(unread.state.preferences.theme, "light");
  // Le stockage accepte les écritures, mais reste impossible à lire.
  assert.equal(writeStoredState(unread.state, unread.issue, host), "unavailable");
  assert.equal(raw, original);
  readDenied = false;
  // Même une lecture redevenue possible ne prouve pas que l'état affiché
  // contient les données antérieures : il faut d'abord les charger.
  assert.equal(writeStoredState(unread.state, unread.issue, host), "unavailable");
  assert.equal(raw, original);
  assert.equal(writes, 0);
  const loaded = readStoredState(host);
  assert.equal(loaded.issue, null);
  assert.equal(loaded.state.preferences.theme, "dark");
  loaded.state.preferences.motion = true;
  assert.equal(writeStoredState(loaded.state, loaded.issue, host), null);
  assert.equal(JSON.parse(raw).preferences.motion, true);
});

test("Stockage : reprise possible après indisponibilité si aucune donnée n’existe", () => {
  let readDenied = true, raw = null;
  const host = { localStorage: {
    getItem() { if (readDenied) throw Error("lecture refusée"); return raw; },
    setItem(key, value) { assert.equal(key, KEY); raw = value; },
  } };
  const unloaded = readStoredState(host);
  assert.equal(unloaded.issue, "unavailable");
  readDenied = false;
  assert.equal(writeStoredState(unloaded.state, unloaded.issue, host), null);
  assert.equal(JSON.parse(raw).version, 1);
});

test("Stockage : après échec d’écriture, reprise conservatrice si des données existent", () => {
  const original = JSON.stringify(seed());
  let raw = original, writeDenied = true;
  const host = { localStorage: {
    getItem() { return raw; },
    setItem(key, value) { if (writeDenied) throw Error("quota"); raw = value; },
  } };
  const loaded = readStoredState(host);
  loaded.state.preferences.theme = "dark";
  assert.equal(writeStoredState(loaded.state, loaded.issue, host), "unavailable");
  writeDenied = false;
  assert.equal(writeStoredState(loaded.state, "unavailable", host), "unavailable");
  assert.equal(raw, original);
});

test("Stockage : indisponible et quota plein sont signalés sans planter", () => {
  const blocked = { get localStorage() { throw Error("denied"); } };
  assert.equal(readStoredState(blocked).issue, "unavailable");
  assert.equal(writeStoredState(seed(), null, blocked), "unavailable");
  const quota = { localStorage: { getItem() { return null; }, setItem() { throw Error("quota"); } } };
  assert.equal(writeStoredState(seed(), null, quota), "unavailable");
  const host = memory();
  assert.equal(writeStoredState(seed(), "unavailable", host), null);
  assert.ok(host.raw());
});

test("Stockage : assemblage autonome sans collision et validation identique", () => {
  const files = ["seed.js", "domain.js", "storage.js", "ui.js", "app.js"];
  const assemble = (names) => names.map((name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8")
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, "")
    .replace(/\bexport (?=(?:const|let|function|class)\b)/g, "")).join("\n");
  // Identique à bundle.mjs, mais sans régénérer ni modifier le fichier HTML.
  assert.doesNotThrow(() => new Script(`'use strict'; (() => { ${assemble(files)} })();`));
  const sandbox = {};
  runInNewContext(`'use strict'; (() => { ${assemble(files.slice(0, 3))}\nglobalThis.check = () => { const s = seed(); const valid = compatibleState(s); s.visits[0] = null; return [valid, compatibleState(s)]; }; })();`, sandbox);
  assert.deepEqual(Array.from(sandbox.check()), [true, false]);
});
