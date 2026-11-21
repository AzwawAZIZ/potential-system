import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { seed } from "../seed.js";

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
async function fixture(user, role, state = seed()) {
  state.session = { user, role, lastActivity: Date.now() };
  await page.goto("http://127.0.0.1:3000");
  await page.evaluate((s) => localStorage.setItem("suivi-miage-v1", JSON.stringify(s)), state);
  await page.reload();
}
async function run(label, fn) { await fn(); console.log("✓ " + label); }

await run("Les archives sont limitées aux acteurs du bon cycle", async () => {
  const s = seed();
  const d = s.students.find((x) => x.id === "s4");
  Object.assign(d, { cycle: 2, tutor: "sophie", mentor: "marc", status: "En cours" });
  const old = s.rooms.find((x) => x.id === "room3");
  old.closed = true;
  old.actors = ["chloe", "julien", "anne"];
  old.messages.push({ id: "private-history", author: "julien", text: "Ancien échange réservé", recipients: [], date: "2026-11-20" });
  s.rooms.push({ id: "room4", student: "s4", cycle: 2, actors: ["chloe", "sophie", "marc"], closed: false, messages: [], summary: {name: d.name, company: d.company} });
  await fixture("sophie", "tutor", s);
  await page.locator('.nav [data-page="rooms"]').click();
  await page.locator('[data-filter="student"]').selectOption("s4");
  assert.equal(await page.getByText("Ancien échange réservé").count(), 0);
  await fixture("anne", "company", s);
  await page.locator('.nav [data-page="rooms"]').click();
  await page.locator('details').first().evaluate((d) => { d.open = true; });
  assert.equal(await page.getByText("Ancien échange réservé").count(), 1);
  await fixture("sophie", "stages", s);
  await page.locator('.nav [data-page="rooms"]').click();
  await page.locator('[data-filter="student"]').selectOption("s4");
  await page.locator('details').last().evaluate((d) => { d.open = true; });
  assert.equal(await page.getByText("Ancien échange réservé").count(), 1);
});

await run("Le fichier de rejets est disponible même sans lignes valides et contient la ville", async () => {
  await fixture("sophie", "stages");
  await page.locator('.nav [data-page="imports"]').click();
  await page.locator('textarea[name="csv"]').fill("nom;email;promotion;ville\nTest;invalide;M1;Lille");
  await page.locator('form[data-form="import-preview"] button[type="submit"]').click();
  const wait = page.waitForEvent("download");
  await page.locator('[data-action="import-rejects"]').click();
  const csv = await readFile(await (await wait).path(), "utf8");
  assert.match(csv, /"Ville"/);
  assert.match(csv, /"Lille"/);
});

await run("Le tuteur peut choisir le second créneau avant confirmation", async () => {
  const s = seed();
  s.visits.find((v) => v.id === "v3").alternative = "2026-12-04 14:30";
  await fixture("sophie", "tutor", s);
  await page.locator('.nav [data-page="agenda"]').click();
  await page.locator('[data-action="visit-confirm"][data-id="v3"]').click();
  await page.locator('[name="slot"]').selectOption("second");
  await page.locator('#dialog-form').evaluate((f) => f.requestSubmit());
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("suivi-miage-v1")));
  const visit = stored.visits.find((v) => v.id === "v3");
  assert.equal(visit.date, "2026-12-04");
  assert.equal(visit.time, "14:30");
  assert.equal(visit.status, "Confirmée");
});

await run("Un autre onglet ne ferme pas une saisie ; le conflit bloque l’écrasement", async () => {
  await fixture("sophie", "tutor");
  const second = await context.newPage();
  await second.goto("http://127.0.0.1:3000");
  await second.locator('.nav [data-page="agenda"]').click();
  await second.locator('[data-action="visit-form"]').first().click();
  await second.locator('[name="place"]').fill("Saisie à préserver");
  // Mouse activity alone no longer replaces the form in another tab.
  await page.locator('.nav [data-page="agenda"]').click();
  await page.waitForTimeout(100);
  assert.equal(await second.locator('[name="place"]').inputValue(), "Saisie à préserver");
  // A real external change shows a conflict instead of saving stale data.
  await page.locator('[data-action="theme"]').first().click();
  await second.locator('.dialog-body .external-change-notice').waitFor();
  assert.equal(await second.locator('[name="place"]').inputValue(), "Saisie à préserver");
  await second.locator('#dialog-form').evaluate((f) => f.requestSubmit());
  assert.match(await second.locator('.form-error').textContent(), /autre onglet/);
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem("suivi-miage-v1")));
  assert.equal(state.visits.length, 3);
  await second.locator('.dialog-body [data-action="reload-external"]').click();
  await second.waitForLoadState("load");
  assert.equal(await second.locator('[role="dialog"]').count(), 0);
  await second.close();
});

await run("Menu mobile fermé hors de l’ordre de tabulation, et Échap synchronise le bouton", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture("sophie", "stages");
  assert.equal(await page.locator('.sidebar').evaluate((e) => getComputedStyle(e).visibility), "hidden");
  await page.locator('[data-action="menu"]').click();
  assert.equal(await page.locator('[data-action="menu"]').getAttribute("aria-expanded"), "true");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator('[data-action="menu"]').getAttribute("aria-expanded"), "false");
  assert.equal(await page.locator('.sidebar').evaluate((e) => getComputedStyle(e).visibility), "hidden");
  await page.setViewportSize({ width: 1440, height: 900 });
});

await run("Filtres et matrice conservent le focus clavier après mise à jour", async () => {
  await fixture("sophie", "stages");
  await page.locator('.nav [data-page="cohort"]').click();
  await page.locator('[data-filter="promo"]').selectOption("M1");
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.filter), "promo");
  await fixture("admin", "admin");
  await page.locator('.nav [data-page="permissions"]').click();
  await page.locator('[data-filter="role1"]').selectOption("tutor");
  await page.locator('[data-permission="tutor|cra|validate"]').uncheck();
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.permission), "tutor|cra|validate");
});
assert.deepEqual(errs, []);
await browser.close();
console.log("6 scénarios complémentaires réussis.");
