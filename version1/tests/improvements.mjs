import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { seed } from "../seed.js";

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
async function fixture(uid, role, state = seed()) {
  state.session = { user: uid, role, lastActivity: Date.now() };
  await page.goto("http://127.0.0.1:3000");
  await page.evaluate((s) => localStorage.setItem("suivi-miage-v1", JSON.stringify(s)), state);
  await page.reload();
}
async function run(label, fn) {
  await fn();
  console.log("✓ " + label);
}

await run("Les données de la cohorte sont affichées comme du texte, pas du HTML", async () => {
  const s = seed();
  s.students[0].city = '<img src=x onerror="window.miageInjected=true">';
  await fixture("sophie", "stages", s);
  assert.equal(await page.evaluate(() => window.miageInjected), undefined);
  assert.equal(await page.locator("main img").count(), 0);
  assert.match(await page.locator("main").innerText(), /<img src=x/);
});

await run("Export CSV : les formules précédées d'espaces sont neutralisées", async () => {
  const s = seed();
  s.students[0].name = "   =2+2";
  await fixture("sophie", "stages", s);
  const pending = page.waitForEvent("download");
  await page.locator('[data-action="export-home"]').click();
  const download = await pending;
  const csv = await readFile(await download.path(), "utf8");
  assert.ok(csv.includes('"\'   =2+2"'));
});

await run("Calendrier : navigation vers le mois suivant et rendez-vous de décembre", async () => {
  await fixture("sophie", "tutor");
  await page.locator('.nav [data-page="agenda"]').click();
  assert.match(await page.locator('[aria-label^="Calendrier des visites"]').getAttribute("aria-label"), /Novembre 2026/);
  await page.getByRole("button", { name: "Mois suivant" }).click();
  const calendar = page.locator('[aria-label^="Calendrier des visites"]');
  assert.match(await calendar.getAttribute("aria-label"), /Décembre 2026/);
  assert.match(await calendar.innerText(), /09:30/);
  await page.getByRole("button", { name: "Mois précédent" }).click();
  assert.match(await calendar.getAttribute("aria-label"), /Novembre 2026/);
});

await run("Export calendrier : fin après minuit et caractères de contrôle échappés", async () => {
  const s = seed();
  Object.assign(s.visits[0], { date: "2026-11-30", time: "23:30", place: "Lieu\r\nX-FAKE:texte" });
  await fixture("sophie", "tutor", s);
  await page.locator('.nav [data-page="agenda"]').click();
  const pending = page.waitForEvent("download");
  await page.locator('[data-action="ics"][data-id="v1"]').first().click();
  const ics = await readFile(await (await pending).path(), "utf8");
  assert.ok(ics.includes("BEGIN:VTIMEZONE\r\nTZID:Europe/Paris"));
  assert.match(ics, /DTSTART;TZID=Europe\/Paris:20261130T233000/);
  assert.match(ics, /DTEND;TZID=Europe\/Paris:20261201T003000/);
  assert.ok(ics.includes("LOCATION:Lieu\\nX-FAKE:texte"));
  assert.ok(!ics.includes("\r\nX-FAKE:texte"));
});

await run("Activité clavier : la session est prolongée sans souris", async () => {
  await fixture("sophie", "stages");
  const original = await page.evaluate(() => JSON.parse(localStorage.getItem("suivi-miage-v1")).session.lastActivity);
  await page.evaluate((time) => { window.realDateNow = Date.now; Date.now = () => time; }, original + 59 * 60 * 1000);
  await page.keyboard.press("Tab");
  const refreshed = await page.evaluate(() => JSON.parse(localStorage.getItem("suivi-miage-v1")).session.lastActivity);
  assert.equal(refreshed, original + 59 * 60 * 1000);
  await page.evaluate((time) => { Date.now = () => time; }, original + 61 * 60 * 1000);
  await page.keyboard.press("Tab");
  assert.equal(await page.locator("form[data-form=login]").count(), 0);
  await page.evaluate(() => { Date.now = window.realDateNow; });
});

await run("État local illisible : alerte durable et aucune écriture destructrice", async () => {
  await page.goto("http://127.0.0.1:3000");
  const original = '{"version":1,';
  await page.evaluate((raw) => localStorage.setItem("suivi-miage-v1", raw), original);
  await page.reload();
  assert.match(await page.locator("#storage-status").innerText(), /illisibles ou incompatibles/);
  await page.locator("form[data-form=login] button[type=submit]").click();
  await page.locator('[data-action="choose-role"][data-role="stages"]').click();
  assert.match(await page.locator("#storage-status").innerText(), /n’ont pas été écrasées/);
  assert.equal(await page.evaluate(() => localStorage.getItem("suivi-miage-v1")), original);
});

const blocked = await browser.newContext();
const blockedPage = await blocked.newPage();
await blockedPage.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error("quota"); }; });
await run("Quota atteint : l’utilisateur est averti après une modification", async () => {
  await blockedPage.goto("http://127.0.0.1:3000");
  await blockedPage.locator("form[data-form=login] button[type=submit]").click();
  await blockedPage.locator('[data-action="choose-role"][data-role="stages"]').click();
  assert.match(await blockedPage.locator("#storage-status").innerText(), /Sauvegarde locale indisponible/);
  assert.match(await blockedPage.locator("#storage-status").innerText(), /uniquement en mémoire/);
});
await blocked.close();
assert.deepEqual(errors, []);
await browser.close();
console.log("7 scénarios de régression ciblés réussis.");
