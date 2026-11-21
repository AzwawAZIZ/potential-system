import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { seed } from "../seed.js";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
let n = 0;
let issues = [];
await page.goto("http://127.0.0.1:3000");
async function audit(label) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  n++;
  if (result.violations.length)
    issues.push({
      label,
      violations: result.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes
          .map((n) => ({ target: n.target, summary: n.failureSummary }))
          .slice(0, 8),
      })),
    });
}
await audit("Connexion");
for (const [uid, r] of [
  ["sophie", "stages"],
  ["admin", "admin"],
  ["thomas", "m1"],
  ["claire", "m2"],
  ["sophie", "tutor"],
  ["marc", "company"],
  ["lucie", "student"],
]) {
  const s = seed();
  s.session = { user: uid, role: r, lastActivity: Date.now() };
  await page.evaluate(
    (s) => localStorage.setItem("suivi-miage-v1", JSON.stringify(s)),
    s,
  );
  await page.reload();
  await audit(r + " accueil clair");
  const nav = await page
    .locator(".nav button")
    .evaluateAll((es) => es.map((x) => x.dataset.page));
  for (const p of nav.filter((p) => p !== "home")) {
    await page.locator(`.nav [data-page="${p}"]`).click();
    await audit(r + " " + p);
  }
  await page.locator("[data-action=theme]").click();
  await page.locator(".nav [data-page=home]").click();
  await audit(r + " accueil sombre");
}
console.log(JSON.stringify({ screens: n, issues }, null, 2));
await browser.close();
if (issues.length) process.exitCode = 1;
