export const paths = {
  home: "m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  briefcase: "M3 7h18v14H3z M8 7V3h8v4 M3 12a20 20 0 0 0 18 0 M10 12h4v3h-4z",
  shield: "M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7Z m-4 9 3 3 5-6",
  upload: "M12 16V3 m-5 5 5-5 5 5 M4 15v6h16v-6",
  download: "M12 3v13 m-5-5 5 5 5-5 M4 16v5h16v-5",
  message:
    "M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0 M7 10h10 M7 14h6",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4",
  chevron: "m9 5 7 7-7 7",
  down: "m6 9 6 6 6-6",
  arrow: "M5 12h14 m-5-5 5 5-5 5",
  back: "M19 12H5 m5-5-5 5 5 5",
  plus: "M12 5v14 M5 12h14",
  x: "m6 6 12 12 M6 18 18 6",
  check: "m5 12 4 4L19 6",
  clock: "M12 7v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  calendar: "M4 5h16v16H4z M4 10h16 M8 2v6 M16 2v6",
  alert: "m12 3 10 18H2Z M12 9v5 M12 17v1",
  file: "M5 3h9l5 5v13H5Z M14 3v6h5 M8 13h8 M8 17h5",
  settings:
    "m10 2-1 3-3 1-3 1 1 4-1 4 3 1 3 1 1 3h4l1-3 3-1 3-1-1-4 1-4-3-1-3-1-1-3z M15 11a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  log: "M8 3h12v18H4V7z M8 3v5H4 M8 12h8 M8 16h8",
  lock: "M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  moon: "M20.9 13A9 9 0 0 1 11 3.1a9 9 0 1 0 9.9 9.9",
  sun: "M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5 1.5 1.5 M5 19l1.5-1.5 M17.5 6.5 1.5-1.5 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  help: "M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3 M12 17v1 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  logout: "M9 3H3v18h6 M9 12h12 m-5-5 5 5-5 5",
  filter: "M4 5h16 M7 12h10 M10 19h4",
  refresh:
    "M20 7v-4 m0 4h-4 M4 17v4 m0-4h4 M20 7a9 9 0 0 0-16 1 M4 17a9 9 0 0 0 16-1",
  chart: "M4 3v18h17 M8 16v-4 M13 16V8 M18 16V5",
  cap: "m2 8 10-5 10 5-10 5Z M6 10v7c4 3 8 3 12 0v-7 M22 8v8",
  building:
    "M5 21V3h14v18 M9 7h1 M14 7h1 M9 11h1 M14 11h1 M9 15h1 M14 15h1 M10 21v-3h4v3",
  menu: "M3 6h18 M3 12h18 M3 18h18",
  mail: "M3 5h18v14H3Z m0 0 9 8 9-8",
  pin: "M12 22s8-8 8-14a8 8 0 0 0-16 0c0 6 8 14 8 14 M15 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  paperclip: "m9 17 8-8a3 3 0 0 0-4-4L4 14a5 5 0 0 0 7 7L21 11 M7 15l7-7",
  spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z",
};
export const icon = (name, cls = "") =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.file}"/></svg>`;
export const esc = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const initials = (name) =>
  name
    ?.split(" ")
    .map((x) => x[0])
    .slice(0, 2)
    .join("") || "MI";
export const avatar = (name, cls = "") =>
  `<span class="avatar ${cls}">${esc(initials(name))}</span>`;
export function badge(text) {
  let c =
    /Clôturé|Validé|Confirmée|Réalisée|créé|Acceptée|Succès|Appliquée/.test(
      text,
    )
      ? "green"
      : /Rupture|Désaccord|Refus|Échec|rejet|compléter/.test(text)
        ? "red"
        : /attente|affecter|essai|lire|Proposée|Ouvert/.test(text)
          ? "amber"
          : /cours/.test(text)
            ? "blue"
            : "";
  return `<span class="badge badge-dot ${c}">${esc(text)}</span>`;
}
export const btn = (label, action, cls = "", ico = "", data = "") =>
  `<button type="button" class="${cls}" data-action="${action}" ${data}>${ico ? icon(ico) : ""}${label}</button>`;
export const empty = (
  title,
  text,
  label = "Réinitialiser les filtres",
  action = "reset-filters",
) =>
  `<div class="empty">${icon("file")}<h3>${title}</h3><p>${text}</p>${btn(label, action, "small", "arrow")}</div>`;
export const notice = (title, text = "", cls = "", ico = "shield") =>
  `<div class="notice ${cls}">${icon(ico)}<div><strong>${title}</strong>${text ? `<p>${text}</p>` : ""}</div></div>`;
export const field = (
  label,
  name,
  value = "",
  type = "text",
  help = "",
  full = false,
) =>
  `<label class="field ${full ? "full" : ""}">${label}<input name="${name}" type="${type}" value="${esc(value)}" ${type === "number" ? 'min="1" max="1440"' : ""}>${help ? `<small>${help}</small>` : ""}</label>`;
export const area = (label, name, value = "", help = "", full = true) =>
  `<label class="field ${full ? "full" : ""}">${label}<textarea name="${name}" rows="4">${esc(value)}</textarea>${help ? `<small>${help}</small>` : ""}</label>`;
export const select = (label, name, options, value = "", full = false) =>
  `<label class="field ${full ? "full" : ""}">${label}<select name="${name}" class="field-control">${options
    .map((o) => {
      const [v, t] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(t)}</option>`;
    })
    .join("")}</select></label>`;
export const fileField = () =>
  `<label class="field full">Pièce jointe (facultative)<input type="file" name="attachment" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.webp"><small>PDF, Word, Excel, CSV ou image. Le prototype conserve le nom et la taille, pas le contenu du fichier.</small></label>`;
export const miniPipeline = (n) =>
  `<div class="mini-pipeline" role="img" aria-label="Étape ${n} sur 6">${Array.from({ length: 6 }, (_, i) => `<i class="${i < n ? "filled" : ""}"></i>`).join("")}</div>`;
export function pipeline(n) {
  return `<div class="pipeline" role="group" tabindex="0" aria-label="Avancement du parcours">${["Recherche", "Contrat", "Affectation", "Suivi & CRA", "Visite", "Circuit CRV", "Clôture"].map((t, i) => `<div class="pipeline-step ${i < n ? "done" : i === n ? "current" : ""}"><i>${i < n ? "✓" : i + 1}</i>${t}</div>`).join("")}</div>`;
}
export function safeRich(html) {
  return esc(html).replace(
    /&lt;(\/?(?:b|strong|i|em|u|p|div|br|ul|ol|li|h3|h4)\s*\/?)&gt;/gi,
    "<$1>",
  );
}
export function richEditor(text = "", html = "") {
  return `<div class="rich-editor field full"><span id="rich-label">Compte rendu · Modèle MIAGE</span><div class="rich-toolbar" role="toolbar" aria-label="Mise en forme du compte rendu"><button type="button" data-action="editor-bold" aria-label="Mettre en gras"><strong>Gras</strong></button><button type="button" data-action="editor-italic" aria-label="Mettre en italique"><em>Italique</em></button><button type="button" data-action="editor-list">Liste à puces</button></div><div id="rich-crv" class="rich-content" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="rich-label" spellcheck="true">${html ? safeRich(html) : esc(text).replaceAll("\n", "<br>")}</div><small>Structure MIAGE : Contexte · Missions · Compétences · Intégration · Avis. La mise en forme simple est conservée ; les contenus collés sont ramenés au texte.</small></div>`;
}
