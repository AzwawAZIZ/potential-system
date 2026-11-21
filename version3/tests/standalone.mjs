import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext();
const page = await context.newPage();
const errors = [],
  external = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (request) => {
  if (/^https?:/.test(request.url())) external.push(request.url());
});
await page.goto(pathToFileURL(resolve("Suivi-MIAGE-UPJV.html")).href);
assert.equal(await page.locator("form[data-form=login]").count(), 1);
await page.locator("form[data-form=login] button[type=submit]").click();
await page.locator("[data-action=choose-role][data-role=stages]").click();
assert.match(await page.locator("h1").textContent(), /Bonjour Sophie/);
await page.reload();
assert.match(await page.locator("h1").textContent(), /Bonjour Sophie/);
assert.deepEqual(external, []);
assert.deepEqual(errors, []);
console.log(
  "✓ HTML autonome : ouverture file://, connexion, choix du rôle et persistance après rechargement.",
);
console.log("✓ Zéro requête HTTP externe, zéro erreur JavaScript.");
await browser.close();
