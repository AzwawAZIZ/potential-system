import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { seed } from "../seed.js";

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

async function fixture(user, role, state = seed()) {
  state.session = { user, role, lastActivity: Date.now() };
  await page.goto(base);
  await page.evaluate((value) => localStorage.setItem("suivi-miage-v1", JSON.stringify(value)), state);
  await page.reload();
  await page.locator(".nav").waitFor();
}
async function state() {
  return page.evaluate(() => JSON.parse(localStorage.getItem("suivi-miage-v1")));
}
async function run(label, fn) {
  await fn();
  console.log("✓ " + label);
}
async function openStudent(id, tab) {
  await page.locator(`[data-action="open-dossier"][data-target="${id}"]`).first().click();
  await page.locator(`[role="tab"][data-tab="${tab}"]`).click();
}

try {
  await run("Administration : journaux conservés, aucune voie d’audit des messages privés", async () => {
    const data = seed();
    data.rooms[0].messages.push({ id: "secret", author: "lucie", text: "CONTENU PRIVÉ FICTIF", recipients: ["marc"], date: "2026-11-20" });
    await fixture("admin", "admin", data);
    assert.equal(await page.locator('[data-page="messageAudit"], [data-target="messageAudit"], [data-action="audit-message-form"]').count(), 0);
    assert.equal(await page.getByText("CONTENU PRIVÉ FICTIF").count(), 0);
    await page.locator('[data-page="logs"]').click();
    assert.match(await page.locator("h1").textContent(), /Journaux/);
    await page.locator('[data-page="permissions"]').click();
    assert.equal(await page.getByText("Audit des messages directs").count(), 0);
    await page.evaluate(() => {
      const button = document.createElement("button");
      button.dataset.action = "nav-target";
      button.dataset.target = "messageAudit";
      document.querySelector("#app").append(button);
      button.click();
    });
    assert.match(await page.locator("h1").textContent(), /permissions/i);
    assert.equal(await page.getByText("CONTENU PRIVÉ FICTIF").count(), 0);
    await page.evaluate(() => {
      const form = document.createElement("form");
      form.dataset.form = "auditMessage";
      form.innerHTML = '<input name="reason" value="test"><div class="form-error"></div>';
      document.querySelector("#app").append(form);
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    assert.equal(await page.getByText("CONTENU PRIVÉ FICTIF").count(), 0);
    assert.match(await page.locator('form[data-form="auditMessage"] .form-error').textContent(), /non pris en charge/);
  });

  await run("Salons ciblés : choix explicite et e-mails visibles, sans inclusion cachée", async () => {
    await fixture("lucie", "student");
    await page.locator('[data-page="rooms"]').click();
    await page.locator('[data-action="channel"][data-channel="targeted"]').click();
    const form = page.locator('form[data-form="message"]');
    assert.match(await form.locator("fieldset").textContent(), /au moins un destinataire/);
    assert.match(await form.locator('label:has(input[value="marc"])').textContent(), /marc\.petit@atelier-numerique\.fr/);
    assert.doesNotMatch(await form.textContent(), /automatiquement inclus/i);
    await form.locator('textarea[name="text"]').fill("Message fictif ciblé");
    await form.evaluate((element) => element.requestSubmit());
    assert.match(await form.locator(".form-error").textContent(), /au moins un destinataire/);
    await form.locator('input[value="marc"]').check();
    const before = await state();
    await form.evaluate((element) => element.requestSubmit());
    const after = await state();
    const newMessages = after.rooms.find((r) => r.student === "s1").messages.filter((m) => m.text === "Message fictif ciblé");
    if (newMessages.length) {
      assert.equal(newMessages.length, 1);
      assert.deepEqual(newMessages[0].recipients, ["marc"]);
    } else {
      assert.equal(after.rooms.find((r) => r.student === "s1").messages.length, before.rooms.find((r) => r.student === "s1").messages.length);
      assert.match(await form.locator(".form-error").textContent(), /destinataires|règles de messagerie/i);
    }
  });

  await run("Mail externe : validation, encodage et aucune mutation du salon", async () => {
    await fixture("lucie", "student");
    await page.locator('[data-page="rooms"]').click();
    const initial = await state();
    await page.locator('[data-action="external-email-form"]').click();
    const form = page.locator('form[data-form="external-email"]');
    assert.match(await page.locator('[role="dialog"]').textContent(), /Aucun envoi depuis l’application/);
    assert.match(await page.locator('[role="dialog"]').textContent(), /aucun accès au salon/i);
    await form.locator('input[name="email"]').fill("pas-une-adresse");
    assert.equal(await form.locator('input[name="email"]').evaluate((el) => el.checkValidity()), false);
    await form.evaluate((el) => el.requestSubmit());
    assert.equal(await page.locator('a[href^="mailto:"]').count(), 0);
    const address = "externe+test@example.org", subject = "Suivi & bilan ?", body = "Bonjour\nUn test & rien d’autre.";
    await form.locator('input[name="email"]').fill(address);
    await form.locator('input[name="subject"]').fill(subject);
    await form.locator('textarea[name="body"]').fill(body);
    await form.evaluate((el) => el.requestSubmit());
    const href = await page.locator('a[href^="mailto:"]').getAttribute("href");
    assert.equal(href, `mailto:${encodeURIComponent(address)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
    const after = await state();
    assert.deepEqual(after.rooms, initial.rooms);
    assert.deepEqual(after.users, initial.users);
  });

  await run("Missions : avis non affectant et décision finale distincte", async () => {
    await fixture("sophie", "tutor");
    await page.locator('[data-page="missions"]').click();
    await page.locator('[data-action="mission-decision"][data-decision="Accepter"]').click();
    assert.match(await page.locator('[role="dialog"]').textContent(), /avis favorable/i);
    assert.match(await page.locator('[role="dialog"]').textContent(), /pas une affectation/i);
    const before = await state();
    await page.locator('#dialog-form').evaluate((f) => f.requestSubmit());
    const after = await state();
    const mission = after.missions.find((m) => m.id === "m1");
    assert.equal(after.students.find((d) => d.id === mission.student).tutor, before.students.find((d) => d.id === mission.student).tutor);
    if (mission.status === "En attente") {
      assert.match(await page.locator('#dialog-form .form-error').textContent(), /règles de décision finale/i);
    } else {
      assert.equal(mission.status, "Avis favorable du tuteur");
    }
    const pending = seed();
    pending.missions[0].status = "Avis favorable du tuteur";
    await fixture("sophie", "stages", pending);
    await page.locator('[data-page="missions"]').click();
    assert.equal(await page.locator('[data-action="mission-assign"][data-id="m1"]').count(), 1);
    await page.locator('[data-action="mission-assign"][data-id="m1"]').click();
    assert.match(await page.locator('[role="dialog"]').textContent(), /décision finale/i);
  });

  await run("Types de contrat : options existantes et nouvelles", async () => {
    await fixture("sophie", "stages");
    await page.locator('[data-page="missions"]').click();
    await page.locator('[data-action="mission-form"]').first().click();
    const values = await page.locator('select[name="contract"] option').allTextContents();
    for (const value of ["Apprentissage", "Stage alterné", "Stage temps plein", "Contrat de professionnalisation", "Césure"]) assert.ok(values.includes(value), value);
    await page.locator('[role="dialog"] [data-action="close"]').first().click();
    await page.locator('[data-page="cohort"]').click();
    const filters = await page.locator('[data-filter="contract"] option').allTextContents();
    for (const value of ["Stage temps plein", "Contrat de professionnalisation", "Césure", "Sans contrat"]) assert.ok(filters.includes(value), value);
  });

  await run("CRV : bouton entreprise, reprise tuteur et visas réels", async () => {
    const data = seed();
    await fixture("marc", "company", data);
    await openStudent("s1", "crv");
    assert.match(await page.locator(".visa-grid").textContent(), /Visa apposé/);
    assert.equal(await page.locator('.visa-step.done').count(), 1);
    await page.locator('[data-action="crv-edit"]').click();
    assert.match(await page.locator('[role="dialog"]').textContent(), /versions/i);
    assert.match(await page.locator('[role="dialog"]').textContent(), /visas/i);
    assert.match(await page.locator('.rich-content').textContent(), /Première visite/);
    await fixture("sophie", "tutor", data);
    await openStudent("s1", "crv");
    assert.match(await page.locator('[data-action="crv-edit"]').textContent(), /Reprendre/);
    assert.equal(await page.locator('.visa-step.done').count(), 1);
    await page.locator('[data-action="crv-edit"]').click();
    assert.match(await page.locator('[role="dialog"]').textContent(), /versions/i);
  });

  await run("CRA entreprise : conditionné à la permission, envoyés seuls et lecture seule", async () => {
    const data = seed();
    data.cra.push({ ...data.cra[0], id: "draft-ui-test", period: "BROUILLON-FICTIF", status: "Brouillon", activities: "SECRET-BROUILLON-FICTIF" });
    await fixture("marc", "company", data);
    assert.match(await page.locator("main").textContent(), /CRA envoyés/);
    await page.locator('[data-action="open-dossier"][data-target="s1"]').first().click();
    const tabs = page.locator('[role="tab"][data-tab="cra"]');
    if (await tabs.count()) {
      await tabs.click();
      assert.match(await page.locator("main").textContent(), /Novembre 2026/);
      assert.doesNotMatch(await page.locator("main").textContent(), /SECRET-BROUILLON-FICTIF|BROUILLON-FICTIF/);
      assert.equal(await page.locator('[data-action="cra-review"], [data-action="cra-form"]').count(), 0);
    } else {
      assert.doesNotMatch(await page.locator("main").textContent(), /SECRET-BROUILLON-FICTIF/);
    }
  });

  assert.deepEqual(errors, []);
  console.log("7 scénarios UI ciblés réussis.");
} finally {
  await context.close();
  await browser.close();
}
