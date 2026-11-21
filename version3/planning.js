/**
 * Calculs de planning autonomes, sans horloge implicite, stockage ni réseau.
 * Les dates sont des chaînes civiles YYYY-MM-DD (années 0001 à 9999) ; UTC
 * ne sert qu'aux calculs, sans conversion d'un fuseau local ni heure d'été.
 * Aucune fonction ne déclenche une clôture de CRV ou ne réalise un envoi.
 */

const DAY_MS = 86_400_000;
const PRESENCE_THRESHOLD = 45;

/** Vérifie le format exact et l'existence d'une date grégorienne civile. */
export function isValidISODate(value) {
  if (typeof value !== "string" || value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

function requireDate(value, label) {
  if (!isValidISODate(value)) throw new RangeError(`${label} : date YYYY-MM-DD invalide`);
  return value;
}

function dayNumber(value, label = "date") {
  requireDate(value, label);
  // setUTCFullYear évite l'interprétation spéciale des années 0 à 99 par Date.UTC.
  const date = new Date(0);
  date.setUTCFullYear(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  return date.getTime() / DAY_MS;
}

function requireInteger(value, label, minimum) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${label} : entier attendu, au moins ${minimum}`);
  }
}

function requireId(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} : identifiant non vide requis`);
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} : tableau requis`);
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} : objet requis`);
}

function requirePeriod(start, end) {
  requireDate(start, "début");
  requireDate(end, "fin");
  if (start > end) throw new RangeError("Le début de période doit précéder ou égaler sa fin");
}

/**
 * Ajoute un nombre entier signé de jours calendaires à une date civile.
 * Rejette les dates invalides, les décalages non entiers et les résultats
 * hors de 0001-01-01..9999-12-31. Sert aussi de calcul d'échéance générique.
 */
export function addDays(date, days) {
  const start = dayNumber(date);
  if (!Number.isSafeInteger(days)) throw new RangeError("Décalage : entier sûr requis");
  const result = start + days;
  const min = dayNumber("0001-01-01");
  const max = dayNumber("9999-12-31");
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new RangeError("Date résultante hors limites");
  return new Date(result * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Compte les dates de présence déclarées DISTINCTES dans [start, end] et
 * jusqu'à referenceDate incluse. Chaque date fournie est validée, même hors
 * période. Les autres dates ne sont pas imputées ; aucun week-end n'est exclu.
 * Renvoie {count, reached, remaining, thresholdDate}, thresholdDate étant la
 * date de la 45e présence ou null. Aucun effet sur le CRV.
 * Exemple : countPresenceDays({start, end}, ["2026-01-02"], "2026-01-31").
 */
export function countPresenceDays(period, dates, referenceDate) {
  requireObject(period, "période");
  requirePeriod(period.start, period.end);
  requireDate(referenceDate, "référence");
  requireArray(dates, "présences");
  for (const date of dates) requireDate(date, "présence");
  const distinct = [...new Set(dates.filter((date) => date >= period.start && date <= period.end && date <= referenceDate))].sort();
  return {
    count: distinct.length,
    reached: distinct.length >= PRESENCE_THRESHOLD,
    remaining: Math.max(0, PRESENCE_THRESHOLD - distinct.length),
    thresholdDate: distinct[PRESENCE_THRESHOLD - 1] ?? null,
  };
}

/**
 * Produit les dates d'échéance CRA d'une période inclusive {start, end}.
 * Par défaut : uniquement end. Si frequencyDays est renseigné, il s'agit d'un
 * entier positif de jours CALENDAIRES : première échéance au N-ième jour à
 * partir de start, puis tous les N jours ; end est toujours ajouté pour une
 * éventuelle période partielle. Aucune présence n'est déduite de ces dates.
 * Exemple : craDeadlines({start: "2026-01-01", end: "2026-01-10"}, 7).
 */
export function craDeadlines(period, frequencyDays) {
  requireObject(period, "période");
  requirePeriod(period.start, period.end);
  if (frequencyDays === undefined) return [period.end];
  requireInteger(frequencyDays, "fréquence", 1);
  const length = dayNumber(period.end) - dayNumber(period.start) + 1;
  const dates = [];
  for (let offset = frequencyDays - 1; offset < length; offset += frequencyDays) {
    dates.push(addDays(period.start, offset));
  }
  if (dates.at(-1) !== period.end) dates.push(period.end);
  return dates;
}

/**
 * Calcule des propositions de relance à la date explicite referenceDate.
 * deadlines : [{id, target, dueDate}] ; history : [{deadlineId, target, date}].
 * target est un identifiant opaque fourni par l'appelant. Options : daysBefore
 * (jours avant l'échéance, défaut 0) et repeatEveryDays (cadence après la
 * dernière relance, défaut 1). Il n'y a ni rattrapage des jours non évalués,
 * ni contrôle d'autorisation, ni envoi. Les dates futures dans l'historique
 * sont rejetées. Une échéance a au plus une relance par date, même si sa cible
 * change ; les doublons historiques sont retirés en conservant le premier.
 * Renvoie {reminders, history, states} : history contient aussi les nouvelles
 * propositions et states expose {deadlineId, lastReminderDate}, null si aucune.
 * L'appelant choisit explicitement de conserver history après une action locale ;
 * sans cela une évaluation identique reproduira les mêmes propositions.
 */
export function calculateReminders(deadlines, referenceDate, history = [], options = {}) {
  requireArray(deadlines, "échéances");
  requireDate(referenceDate, "référence");
  requireArray(history, "historique");
  requireObject(options, "options");
  const daysBefore = options.daysBefore === undefined ? 0 : options.daysBefore;
  const repeatEveryDays = options.repeatEveryDays === undefined ? 1 : options.repeatEveryDays;
  requireInteger(daysBefore, "anticipation", 0);
  requireInteger(repeatEveryDays, "cadence", 1);
  const referenceDay = dayNumber(referenceDate);
  const deadlineIds = new Set();
  for (const deadline of deadlines) {
    requireObject(deadline, "échéance");
    requireId(deadline.id, "échéance.id");
    requireId(deadline.target, "échéance.target");
    requireDate(deadline.dueDate, "échéance.dueDate");
    if (deadlineIds.has(deadline.id)) throw new RangeError("Identifiant d'échéance en double");
    deadlineIds.add(deadline.id);
  }
  const uniqueHistory = [];
  const keys = new Set();
  const latest = new Map();
  for (const reminder of history) {
    requireObject(reminder, "relance");
    requireId(reminder.deadlineId, "relance.deadlineId");
    requireId(reminder.target, "relance.target");
    requireDate(reminder.date, "relance.date");
    if (reminder.date > referenceDate) throw new RangeError("Relance historique après la date de référence");
    const key = JSON.stringify([reminder.deadlineId, reminder.date]);
    if (keys.has(key)) continue;
    keys.add(key);
    uniqueHistory.push({ ...reminder });
    const previous = latest.get(reminder.deadlineId);
    if (!previous || reminder.date > previous) latest.set(reminder.deadlineId, reminder.date);
  }
  const reminders = [];
  const states = [];
  for (const deadline of deadlines) {
    let last = latest.get(deadline.id) ?? null;
    const eligible = dayNumber(deadline.dueDate) - referenceDay <= daysBefore;
    const cadenceReached = last === null || referenceDay - dayNumber(last) >= repeatEveryDays;
    if (eligible && cadenceReached) {
      const reminder = { deadlineId: deadline.id, target: deadline.target, date: referenceDate };
      reminders.push(reminder);
      uniqueHistory.push({ ...reminder });
      last = referenceDate;
    }
    states.push({ deadlineId: deadline.id, lastReminderDate: last });
  }
  return { reminders, history: uniqueHistory, states };
}

function timeMinutes(value, label) {
  if (typeof value !== "string" || value.length !== 5 || !/^\d{2}:\d{2}$/.test(value)) throw new RangeError(`${label} : heure HH:mm invalide`);
  const hours = Number(value.slice(0, 2));
  const minutes = Number(value.slice(3, 5));
  if (hours > 23 || minutes > 59) throw new RangeError(`${label} : heure HH:mm invalide`);
  return hours * 60 + minutes;
}

function slotBounds(slot, label) {
  requireObject(slot, label);
  requireDate(slot.date, `${label}.date`);
  const start = timeMinutes(slot.start, `${label}.start`);
  const end = timeMinutes(slot.end, `${label}.end`);
  if (start >= end) throw new RangeError(`${label} : début strictement avant fin requis`);
  return { start, end };
}

function proposalDetails(proposal, label) {
  const bounds = slotBounds(proposal, label);
  requireId(proposal.id, `${label}.id`);
  requireArray(proposal.participants, `${label}.participants`);
  if (proposal.participants.length === 0) throw new RangeError(`${label} : au moins un participant requis`);
  const seen = new Set();
  for (const participant of proposal.participants) {
    requireId(participant, `${label}.participant`);
    if (seen.has(participant)) throw new RangeError(`${label} : participant en double`);
    seen.add(participant);
  }
  return bounds;
}

/**
 * Évalue une proposition {id, date, start, end, participants: [id, ...]}.
 * availability contient [{person, date, start, end}], otherProposals contient
 * des propositions de même forme. Heures civiles strictes HH:mm, de 00:00 à
 * 23:59, une seule date par créneau : pas de traversée de minuit ni fuseau.
 * Les intervalles sont semi-ouverts [start,end) : deux créneaux adjacents ne
 * sont pas en conflit ; des disponibilités contiguës couvrent une proposition.
 * Un conflit exige une date et un participant communs ET un chevauchement.
 * Pour modifier une proposition, son id dans otherProposals est ignoré après
 * validation. Aucune attribution d'autorisation ni réservation n'est faite.
 * Renvoie {available, unavailableParticipants, conflicts, possible}, conflicts
 * étant les identifiants des propositions en conflit dans l'ordre d'entrée.
 */
export function assessProposal(proposal, availability, otherProposals = []) {
  const proposedBounds = proposalDetails(proposal, "proposition");
  requireArray(availability, "disponibilités");
  requireArray(otherProposals, "autres propositions");
  const availableSlots = Array.from(availability, (slot) => {
    const bounds = slotBounds(slot, "disponibilité");
    requireId(slot.person, "disponibilité.person");
    return { person: slot.person, date: slot.date, ...bounds };
  });
  const seenIds = new Set();
  const conflicts = [];
  for (const other of otherProposals) {
    const bounds = proposalDetails(other, "autre proposition");
    if (seenIds.has(other.id)) throw new RangeError("Identifiant de proposition en double");
    seenIds.add(other.id);
    if (other.id !== proposal.id && other.date === proposal.date &&
        bounds.start < proposedBounds.end && proposedBounds.start < bounds.end &&
        other.participants.some((person) => proposal.participants.includes(person))) {
      conflicts.push(other.id);
    }
  }
  const unavailableParticipants = proposal.participants.filter((person) => {
    const slots = availableSlots
      .filter((slot) => slot.person === person && slot.date === proposal.date)
      .sort((a, b) => a.start - b.start || a.end - b.end);
    let coveredUntil = proposedBounds.start;
    for (const slot of slots) {
      if (slot.end <= coveredUntil) continue;
      if (slot.start > coveredUntil) break;
      coveredUntil = slot.end;
      if (coveredUntil >= proposedBounds.end) return false;
    }
    return true;
  });
  const available = unavailableParticipants.length === 0;
  return { available, unavailableParticipants, conflicts, possible: available && conflicts.length === 0 };
}
