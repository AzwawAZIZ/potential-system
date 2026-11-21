import { seed, ROLES } from "./seed.js";
import { KEY } from "./domain.js";

// Contrôles structurels seulement : ce ne sont ni des règles métier ni une
// frontière de sécurité. Les champs facultatifs et les valeurs héritées sont
// conservés ; on ne vérifie pas les références entre collections.
const storageRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const storageStrings = (value, keys) => keys.every((key) => typeof value[key] === "string");
const storagePresent = (value, keys) => keys.every((key) => value[key] != null);
const storageArray = (value, check) => Array.isArray(value) && Array.from(value).every(check);
const storageStringArray = (value) => storageArray(value, (item) => typeof item === "string");
const storageItem = (value, strings, present = []) =>
  storageRecord(value) && storageStrings(value, strings) && storagePresent(value, present);

export function compatibleState(value) {
  if (!storageRecord(value) || value.version !== 1) return false;
  const defaults = seed();
  for (const [key, example] of Object.entries(defaults)) {
    if (Array.isArray(example) && !Array.isArray(value[key])) return false;
    if (storageRecord(example) && !storageRecord(value[key])) return false;
  }
  if (!["light", "dark"].includes(value.preferences.theme) ||
      typeof value.preferences.motion !== "boolean" ||
      !Number.isFinite(value.settings.sessionMinutes) || value.settings.sessionMinutes <= 0) return false;
  if (!storageArray(value.users, (u) =>
    storageItem(u, ["id", "name", "email"]) && typeof u.active === "boolean" &&
    storageStringArray(u.roles) && u.roles.every((r) => Object.prototype.hasOwnProperty.call(ROLES, r)))) return false;
  // Une mission peut laisser « contract » absent ; les étudiants importés
  // peuvent ne pas avoir de compte, de dates ni d'adresse.
  if (!storageArray(value.students, (d) =>
    storageItem(d, ["id", "name", "email", "promo", "status", "access"], ["company", "city"]) &&
    Number.isFinite(d.step) && Number.isFinite(d.cycle))) return false;
  if (!storageArray(value.visits, (v) =>
    storageItem(v, ["id", "student", "date", "time", "status"], ["place"]))) return false;
  // Les difficultés, prochaines étapes et retours peuvent manquer dans un
  // brouillon ou après une lecture ; la demande associée est facultative.
  if (!storageArray(value.cra, (c) =>
    storageItem(c, ["id", "student", "status", "date"], ["period", "activities"]))) return false;
  if (!storageArray(value.requests, (q) =>
    storageItem(q, ["id", "student", "date"], ["text", "due"]))) return false;
  if (!storageArray(value.missions, (m) =>
    storageItem(m, ["id", "student", "tutor", "status"], ["title", "description"]) &&
    storageArray(m.history, (h) => storageItem(h, ["decision", "date"], ["reason"])))) return false;
  if (!storageArray(value.reports, (r) =>
    storageItem(r, ["id", "student", "author", "status", "date"], ["text"]) &&
    storageStringArray(r.shared) &&
    storageArray(r.notes, (n) => storageItem(n, ["author"], ["text"])))) return false;
  if (!storageArray(value.crvs, (c) =>
    storageItem(c, ["id", "student", "due"], ["text"]) &&
    storageStringArray(c.visas) &&
    storageArray(c.amendments, (a) => storageItem(a, ["author", "date"], ["text"])) &&
    storageArray(c.versions, (v) => storageItem(v, ["author", "date"], ["before", "after"])) &&
    (c.arbitrationNotes == null || storageArray(c.arbitrationNotes,
      (n) => storageItem(n, ["author", "date"], ["text"]))) &&
    typeof c.delegated === "boolean" && typeof c.disagreement === "boolean")) return false;
  if (!storageArray(value.rooms, (room) =>
    storageItem(room, ["id", "student"]) && Number.isFinite(room.cycle) &&
    typeof room.closed === "boolean" && (room.actors == null || storageStringArray(room.actors)) &&
    storageArray(room.messages, (m) =>
      storageItem(m, ["id", "author", "date"], ["text"]) && storageStringArray(m.recipients)))) return false;
  if (!storageArray(value.notifications, (n) =>
    storageItem(n, ["id", "user", "role"], ["text"]) && typeof n.read === "boolean")) return false;
  // bulkInfo crée des e-mails sans identifiant ; importRows accepte un nom de
  // fichier absent. Les deux variantes doivent rester lisibles.
  if (!storageArray(value.emails, (e) => storageItem(e, ["to", "date"], ["text"]))) return false;
  if (!storageArray(value.decisions, (d) =>
    storageItem(d, ["id", "student", "decision", "author", "status", "date"]))) return false;
  if (!storageArray(value.imports, (i) =>
    storageItem(i, ["id", "date", "author", "reasons"]) &&
    [i.created, i.updated, i.rejected].every(Number.isFinite))) return false;
  if (!storageArray(value.audit, (a) =>
    storageItem(a, ["id", "date", "author", "type", "result", "target"], ["detail"]))) return false;
  if (!storageArray(value.history, (h) => {
    if (!storageItem(h, ["type", "date"])) return false;
    if (h.type === "Permissions" || h.type === "Paramètres")
      return storageStrings(h, ["author"]) && storagePresent(h, ["before", "after", "reason"]);
    if (h.type === "Ancien tuteur") return storageStrings(h, ["student", "tutor"]);
    if (h.type === "Contrat archivé")
      return storageStrings(h, ["student"]) && storagePresent(h, ["before", "reason"]);
    return true; // Autres entrées historiques éventuellement issues d'une ancienne version 1.
  })) return false;
  if (value.session !== null && (!storageRecord(value.session) ||
      typeof value.session.user !== "string" || typeof value.session.role !== "string")) return false;
  return true;
}

function storageCompatibleJSON(raw) {
  try {
    return compatibleState(JSON.parse(raw));
  } catch {
    return false;
  }
}

export function readStoredState(host = globalThis) {
  let raw;
  try {
    raw = host.localStorage.getItem(KEY);
  } catch {
    return { state: seed(), issue: "unavailable" };
  }
  if (raw === null) return { state: seed(), issue: null };
  if (storageCompatibleJSON(raw)) return { state: JSON.parse(raw), issue: null };
  // Keep the original value intact so it is not silently replaced.
  return { state: seed(), issue: "incompatible" };
}

export function writeStoredState(state, issue, host = globalThis) {
  if (issue === "incompatible") return "incompatible";
  try {
    const storage = host.localStorage;
    // La valeur peut avoir changé depuis la lecture, par exemple dans un autre onglet.
    const original = storage.getItem(KEY);
    if (original !== null && !storageCompatibleJSON(original)) return "incompatible";
    // Une lecture initiale a pu échouer : « unavailable » ne permet pas de la
    // distinguer d'un simple échec d'écriture. Ne pas écraser une valeur qui
    // n'a peut-être jamais été chargée ; une nouvelle lecture peut la reprendre.
    if (issue === "unavailable" && original !== null) return "unavailable";
    const serialized = JSON.stringify(state);
    // Tester la forme effectivement stockée : JSON supprime les undefined et
    // transforme les trous des tableaux et les nombres non finis en null.
    if (!storageCompatibleJSON(serialized)) return "incompatible";
    storage.setItem(KEY, serialized);
    return null;
  } catch {
    return "unavailable";
  }
}
