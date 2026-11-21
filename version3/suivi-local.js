/**
 * Mutations locales déterministes : aucun accès à l'horloge, au stockage,
 * au réseau, aux comptes ou à l'authentification. L'appelant doit contrôler
 * l'identité, le rôle, le périmètre ET le cycle courant avant de les appeler,
 * fournir une date « aujourd'hui » fiable dans le fuseau civil choisi et
 * enregistrer les événements utiles. Les erreurs ne modifient pas les objets
 * d'entrée. Les champs ajoutés sont facultatifs pour les états v1.
 *
 * Dates civiles : YYYY-MM-DD, années 0001..9999, calendrier grégorien. Les
 * horodatages sont des chaînes UTC canoniques YYYY-MM-DDTHH:mm:ss.sssZ, par
 * exemple new Date().toISOString() calculé par l'appelant. Les créneaux sont
 * des intervalles civils [start,end) sur une même date, en HH:mm, sans fuseau
 * ni passage de minuit ; ils ne constituent pas une réservation d'agenda.
 */

const suiviContractTypes = Object.freeze([
  "Apprentissage", "Stage alterné", "Stage temps plein",
  "Contrat de professionnalisation", "Césure", "Sans contrat",
]);
const suiviContactFields = Object.freeze([
  "email", "phone", "mentorName", "mentorEmail", "mentorPhone",
  "tutorName", "tutorEmail", "tutorPhone", "address", "city",
]);

function suiviObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} : objet requis`);
  }
}

function suiviDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError(`${label} : date YYYY-MM-DD invalide`);
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) {
    throw new RangeError(`${label} : date YYYY-MM-DD invalide`);
  }
}

function suiviTimestamp(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new RangeError(`${label} : horodatage UTC ISO canonique requis`);
  }
  suiviDate(value.slice(0, 10), label);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new RangeError(`${label} : horodatage UTC ISO canonique invalide`);
  }
}

function suiviCycle(value, label = "cycle") {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} : entier positif requis`);
  }
}

function suiviCurrentCycle(student, cycle) {
  suiviObject(student, "étudiant");
  suiviCycle(student.cycle, "cycle courant");
  suiviCycle(cycle);
  if (cycle !== student.cycle) throw new RangeError("Le cycle demandé n'est pas le cycle courant");
}

function suiviExistingPresence(student) {
  const records = student.presenceDays === undefined ? [] : student.presenceDays;
  if (!Array.isArray(records)) throw new TypeError("presenceDays : tableau requis");
  const keys = new Set();
  for (const record of records) {
    suiviObject(record, "présence enregistrée");
    suiviCycle(record.cycle, "cycle de présence");
    suiviDate(record.date, "date de présence enregistrée");
    const key = `${record.cycle}/${record.date}`;
    if (keys.has(key)) throw new RangeError("Doublon de présence enregistré pour le cycle et la date");
    keys.add(key);
  }
  return records;
}

function suiviPresenceInput(student, input) {
  suiviObject(input, "présence");
  suiviCurrentCycle(student, input.cycle);
  suiviDate(student.start, "début du contrat");
  suiviDate(student.end, "fin du contrat");
  if (student.start > student.end) throw new RangeError("Bornes du contrat inversées");
  suiviDate(input.date, "date de présence");
  suiviDate(input.today, "aujourd'hui");
  if (input.date < student.start || input.date > student.end) {
    throw new RangeError("La présence doit être comprise dans les bornes du contrat");
  }
  if (input.date > input.today) throw new RangeError("Une présence ne peut pas être future");
  return suiviExistingPresence(student);
}

/**
 * Compte les journées explicitement déclarées sur un cycle quelconque :
 * suiviCountPresenceDays(student, cycle) -> nombre entier. student.presenceDays
 * est optionnel, sinon [{cycle: entier positif, date: 'YYYY-MM-DD'}, ...].
 * Les doublons et enregistrements mal formés sont rejetés ; les journées ne
 * sont jamais déduites du calendrier. L'accès aux anciens cycles doit être
 * autorisé par l'appelant. Aucun filtrage rétroactif par les bornes courantes.
 */
export function suiviCountPresenceDays(student, cycle) {
  suiviObject(student, "étudiant");
  suiviCycle(cycle);
  return suiviExistingPresence(student).filter((item) => item.cycle === cycle).length;
}

/**
 * Ajoute une journée réelle au cycle courant, en bornes inclusives :
 * suiviAddPresenceDay(student, {cycle, date, today}) -> décompte du cycle.
 * student doit porter cycle, start et end ; today est la date civile réelle
 * fournie par l'appelant. Un doublon, une date future ou hors contrat est rejeté.
 * Initialise student.presenceDays uniquement après validation complète.
 */
export function suiviAddPresenceDay(student, input) {
  const records = suiviPresenceInput(student, input);
  if (records.some((item) => item.cycle === input.cycle && item.date === input.date)) {
    throw new RangeError("Présence déjà déclarée pour ce cycle et cette date");
  }
  const count = records.filter((item) => item.cycle === input.cycle).length + 1;
  if (student.presenceDays === undefined) student.presenceDays = [];
  student.presenceDays.push({ cycle: input.cycle, date: input.date });
  return count;
}

/**
 * Supprime exactement une présence existante du cycle courant, avec les mêmes
 * contrôles de date que l'ajout :
 * suiviRemovePresenceDay(student, {cycle, date, today}) -> décompte restant.
 * Le cycle et la date sont obligatoires ; une absence d'enregistrement échoue.
 */
export function suiviRemovePresenceDay(student, input) {
  const records = suiviPresenceInput(student, input);
  const index = records.findIndex((item) => item.cycle === input.cycle && item.date === input.date);
  if (index === -1) throw new RangeError("Présence introuvable pour ce cycle et cette date");
  const count = records.filter((item) => item.cycle === input.cycle).length - 1;
  records.splice(index, 1);
  return count;
}

function suiviText(value, label, max = 200) {
  if (typeof value !== "string") throw new TypeError(`${label} : texte requis`);
  const text = value.trim();
  if (!text || text.length > max || /[\x00-\x1f\x7f]/.test(text)) {
    throw new RangeError(`${label} : texte non vide et sans caractères de contrôle requis`);
  }
  return text;
}

function suiviEmail(value, label) {
  const email = suiviText(value, label, 254).toLowerCase();
  const parts = email.split("@");
  if (parts.length !== 2) throw new RangeError(`${label} : adresse e-mail invalide`);
  const [local, domain] = parts;
  const labels = domain.split(".");
  if (local.length > 64 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) ||
      local.startsWith(".") || local.endsWith(".") || local.includes("..") ||
      labels.length < 2 || labels.some((part) => part.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part))) {
    throw new RangeError(`${label} : adresse e-mail invalide`);
  }
  return email;
}

function suiviPhone(value, label) {
  const phone = suiviText(value, label, 40);
  const digits = phone.replace(/\D/g, "");
  if (!/^\+?[0-9 ().-]+$/.test(phone) || digits.length < 7 || digits.length > 15) {
    throw new RangeError(`${label} : numéro de téléphone invalide`);
  }
  return phone;
}

/**
 * Met à jour explicitement les coordonnées affichées du dossier, jamais un
 * compte ni un lien student.user/mentor/tutor :
 * suiviUpdateContacts(student, changes, {confirmed: true, timestamp?}) ->
 * {type, student, cycle, before, after, date?}. changes est un sous-ensemble
 * non vide de email, phone, mentorName, mentorEmail, mentorPhone, tutorName,
 * tutorEmail, tutorPhone, address et city. Valeurs textuelles non vides ; les
 * e-mails sont normalisés en minuscules et validés selon une syntaxe courante
 * ASCII ; téléphones : 7 à 15 chiffres et séparateurs usuels. timestamp, s'il
 * existe, est un horodatage UTC canonique. before et after sont des instantanés
 * des seuls champs soumis ; un champ absent précédemment vaut null. L'appelant
 * doit conserver l'événement retourné, notamment l'ancienne address. Aucun
 * champ inconnu, suppression par chaîne vide ou réaffectation n'est permis.
 */
export function suiviUpdateContacts(student, changes, options) {
  suiviObject(student, "étudiant");
  suiviObject(changes, "coordonnées");
  suiviObject(options, "confirmation");
  if (options.confirmed !== true) throw new RangeError("Confirmation explicite des coordonnées requise");
  if (options.timestamp !== undefined) suiviTimestamp(options.timestamp, "horodatage");
  const fields = Object.keys(changes);
  if (!fields.length) throw new RangeError("Aucune coordonnée à modifier");
  const before = {};
  const after = {};
  for (const field of fields) {
    if (!suiviContactFields.includes(field)) throw new RangeError(`Coordonnée non modifiable : ${field}`);
    before[field] = Object.hasOwn(student, field) ? student[field] : null;
    if (field === "email" || field.endsWith("Email")) after[field] = suiviEmail(changes[field], field);
    else if (field === "phone" || field.endsWith("Phone")) after[field] = suiviPhone(changes[field], field);
    else after[field] = suiviText(changes[field], field, field === "address" ? 500 : 200);
  }
  const event = {
    type: "Coordonnées du dossier",
    student: student.id ?? null,
    cycle: student.cycle ?? null,
    before,
    after: { ...after },
    ...(options.timestamp !== undefined ? { date: options.timestamp } : {}),
  };
  Object.assign(student, after);
  return event;
}

/**
 * Ajoute un avenant au cycle courant :
 * suiviAddAmendment(student, {cycle, reason, date, start?, end?}) -> avenant.
 * reason est un texte non vide ; date est l'horodatage UTC canonique fourni
 * par l'appelant. start et end sont des dates civiles facultatives de l'avenant
 * et, si les deux existent, start <= end. start est uniquement informatif et
 * ne change jamais student.start. Seule la présence explicite de end modifie
 * student.end ; la date ne peut précéder student.start ni une présence déjà
 * enregistrée dans le cycle courant. student.start doit alors être valide.
 * L'avenant conserve previousEnd lorsque end est fourni. Le tableau facultatif
 * student.contractAmendments est conservé entre cycles, comme les présences.
 */
export function suiviAddAmendment(student, input) {
  suiviObject(input, "avenant");
  suiviCurrentCycle(student, input.cycle);
  const reason = suiviText(input.reason, "motif", 2000);
  suiviTimestamp(input.date, "date de l'avenant");
  const hasStart = Object.hasOwn(input, "start");
  const hasEnd = Object.hasOwn(input, "end");
  if (hasStart) suiviDate(input.start, "début de l'avenant");
  if (hasEnd) suiviDate(input.end, "fin de l'avenant");
  if (hasStart && hasEnd && input.start > input.end) {
    throw new RangeError("Les dates de l'avenant sont inversées");
  }
  if (student.contractAmendments !== undefined && !Array.isArray(student.contractAmendments)) {
    throw new TypeError("contractAmendments : tableau requis");
  }
  if (hasEnd) {
    suiviDate(student.start, "début du contrat");
    if (input.end < student.start) throw new RangeError("La fin du contrat ne peut précéder son début");
    if (suiviExistingPresence(student).some((item) => item.cycle === input.cycle && item.date > input.end)) {
      throw new RangeError("La fin du contrat précéderait une présence déclarée du cycle");
    }
  }
  const amendment = {
    cycle: input.cycle,
    reason,
    date: input.date,
    ...(hasStart ? { start: input.start } : {}),
    ...(hasEnd ? { end: input.end, previousEnd: student.end ?? null } : {}),
  };
  if (student.contractAmendments === undefined) student.contractAmendments = [];
  student.contractAmendments.push(amendment);
  if (hasEnd) student.end = input.end;
  return { ...amendment };
}

/**
 * suiviNormalizeContractType(value) -> l'un des six libellés canoniques :
 * Apprentissage, Stage alterné, Stage temps plein, Contrat de professionnalisation,
 * Césure, Sans contrat. Accepte espaces répétés, casse et accents variables,
 * ainsi que « Stage à temps plein ». Rejette les types absents ou inconnus.
 * La fonction ne modifie pas le dossier ; l'appelant choisit où stocker le type.
 */
export function suiviNormalizeContractType(value) {
  const text = suiviText(value, "type de contrat");
  const key = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ");
  const canonical = suiviContractTypes.find((type) =>
    type.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() === key
  );
  if (canonical) return canonical;
  if (key === "stage a temps plein") return "Stage temps plein";
  throw new RangeError("Type de contrat inconnu");
}

function suiviSlot(slot) {
  suiviObject(slot, "créneau");
  suiviDate(slot.date, "date du créneau");
  for (const field of ["start", "end"]) {
    if (typeof slot[field] !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot[field])) {
      throw new RangeError(`${field} : heure HH:mm invalide`);
    }
  }
  if (slot.start >= slot.end) throw new RangeError("Le début du créneau doit précéder sa fin");
}

function suiviAvailability(person) {
  suiviObject(person, "encadrant");
  const slots = person.availabilitySlots === undefined ? [] : person.availabilitySlots;
  if (!Array.isArray(slots)) throw new TypeError("availabilitySlots : tableau requis");
  for (let i = 0; i < slots.length; i++) {
    suiviSlot(slots[i]);
    for (let j = 0; j < i; j++) {
      if (slots[i].date === slots[j].date && slots[i].start < slots[j].end && slots[j].start < slots[i].end) {
        throw new RangeError("Chevauchement de disponibilités enregistrées");
      }
    }
  }
  return slots;
}

/**
 * Déclare un créneau local : suiviAddAvailability(person, {date, start, end})
 * -> nombre total de créneaux. person.availabilitySlots est facultatif et contient
 * [{date:'YYYY-MM-DD', start:'HH:mm', end:'HH:mm'}]. Chaque intervalle fini
 * est sur une seule date et non chevauchant ; les intervalles adjacents sont
 * admis. L'identité et le rôle de l'encadrant sont contrôlés par l'appelant.
 */
export function suiviAddAvailability(person, slot) {
  const slots = suiviAvailability(person);
  suiviSlot(slot);
  if (slots.some((item) => item.date === slot.date && item.start < slot.end && slot.start < item.end)) {
    throw new RangeError("Le créneau chevauche une disponibilité existante");
  }
  if (person.availabilitySlots === undefined) person.availabilitySlots = [];
  person.availabilitySlots.push({ date: slot.date, start: slot.start, end: slot.end });
  return person.availabilitySlots.length;
}

/**
 * Supprime exactement un créneau local identifié par {date, start, end} :
 * suiviRemoveAvailability(person, slot) -> nombre total restant. L'absence
 * de correspondance exacte échoue. Aucun agenda externe n'est synchronisé.
 */
export function suiviRemoveAvailability(person, slot) {
  const slots = suiviAvailability(person);
  suiviSlot(slot);
  const index = slots.findIndex((item) => item.date === slot.date && item.start === slot.start && item.end === slot.end);
  if (index === -1) throw new RangeError("Disponibilité introuvable");
  slots.splice(index, 1);
  return slots.length;
}
