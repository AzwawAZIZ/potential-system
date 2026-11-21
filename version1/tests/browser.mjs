import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { seed } from "../seed.js";
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
let passed = 0;
async function run(label, fn) {
  try {
    await fn();
    console.log("✓ " + label);
    passed++;
  } catch (e) {
    console.error("✗ " + label);
    throw e;
  }
}
async function fixture(uid, role, state = seed()) {
  state.session = { user: uid, role, lastActivity: Date.now() };
  await page.goto("http://127.0.0.1:3000");
  await page.evaluate(
    (s) => localStorage.setItem("suivi-miage-v1", JSON.stringify(s)),
    state,
  );
  await page.reload();
}
const state = () =>
  page.evaluate(() => JSON.parse(localStorage.getItem("suivi-miage-v1")));
const click = (a) => page.locator(`[data-action="${a}"]`).first().click();
await run("Connexion avec choix du rôle, puis tableau de bord", async () => {
  await page.goto("http://127.0.0.1:3000");
  await page.locator("form[data-form=login] button[type=submit]").click();
  await page.locator("[data-action=choose-role][data-role=stages]").click();
  assert.match(await page.locator("h1").textContent(), /Bonjour Sophie/);
});
await run(
  "Sept rôles : chaque page et chaque sous-onglet sans erreur",
  async () => {
    for (const [uid, r] of [
      ["admin", "admin"],
      ["sophie", "stages"],
      ["thomas", "m1"],
      ["claire", "m2"],
      ["sophie", "tutor"],
      ["marc", "company"],
      ["lucie", "student"],
    ]) {
      await fixture(uid, r);
      const nav = await page
        .locator(".nav button")
        .evaluateAll((es) => es.map((e) => e.dataset.page));
      assert.ok(nav.length <= 6);
      for (const name of nav) {
        await page.locator(`.nav [data-page="${name}"]`).click();
        assert.ok(await page.locator("h1").count());
        const tabs = await page
          .locator("main [role=tab]")
          .evaluateAll((es) => es.map((e) => e.dataset.tab));
        for (const t of tabs)
          await page.locator(`main [data-tab="${t}"]`).click();
      }
      assert.equal(
        await page
          .locator('input[type=search],input[placeholder*="Rechercher"]')
          .count(),
        0,
      );
    }
  },
);
await run(
  "M1 : aucune ligne ouvrable et aucune identité M2 dans la cohorte",
  async () => {
    await fixture("thomas", "m1");
    await page.locator(".nav [data-page=cohort]").click();
    assert.equal(await page.locator("tr[data-action=preview]").count(), 0);
    assert.ok(
      !(await page.locator("main").innerText()).includes("Nathan Robert"),
    );
    assert.ok(
      (await page.locator("main").innerText()).includes("Lucie Bernard"),
    );
  },
);
await run("Filtres structurés, sélection et aperçu en drawer", async () => {
  await fixture("sophie", "stages");
  await page.locator(".nav [data-page=cohort]").click();
  await page.locator("[data-filter=promo]").selectOption("M2");
  assert.equal(await page.locator("tbody tr").count(), 6);
  await page.locator("[data-action=reset-filters]").click();
  assert.equal(await page.locator("tbody tr").count(), 12);
  await page.locator("tr[data-id=s1]").click();
  assert.ok(await page.locator(".drawer").count());
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("[role=dialog]").count(), 0);
});
await run(
  "CRV : délégation, rectification, archivage, puis trois visas",
  async () => {
    await fixture("sophie", "tutor");
    await page.locator("[data-action=open-dossier][data-target=s3]").click();
    await page.locator("[data-tab=crv]").click();
    await click("delegate-confirm");
    await page.locator("#dialog-form").evaluate((f) => f.requestSubmit());
    assert.equal((await state()).crvs[1].delegated, true);
    await page.locator("[data-action=demo]").click();
    await page.locator("[data-action=demo-login][data-id=marc]").click();
    await page.locator("[data-action=open-dossier][data-target=s3]").click();
    await page.locator("[data-tab=crv]").click();
    await click("rectify-form");
    await page
      .locator("textarea[name=text]")
      .fill(
        "Contexte : bilan revu.\nMissions : pilotage de la recette confirmé.\nCompétences : autonomie acquise.\nIntégration : très bonne.\nAvis : positif.",
      );
    await page.locator("#dialog-form").evaluate((f) => f.requestSubmit());
    let c = (await state()).crvs[1];
    assert.equal(c.delegated, false);
    assert.equal(c.visas.length, 0);
    assert.equal(c.versions.length, 1);
    for (const [uid, r] of [
      ["sophie", "tutor"],
      ["marc", "company"],
      ["nathan", "student"],
    ]) {
      await click("demo");
      await page.locator(`[data-action=demo-login][data-id="${uid}"]`).click();
      if (uid === "sophie")
        await page
          .locator("[data-action=choose-role][data-role=tutor]")
          .click();
      if (r === "student") {
        await page.locator(".nav [data-page=work]").click();
        await page.locator("[data-tab=crv]").click();
      } else {
        await page
          .locator("[data-action=open-dossier][data-target=s3]")
          .click();
        await page.locator("[data-tab=crv]").click();
      }
      await click("visa-confirm");
      await page.locator("#dialog-form").evaluate((f) => f.requestSubmit());
    }
    assert.equal((await state()).crvs[1].visas.length, 3);
  },
);
await run(
  "Étudiant : CRA brouillon puis envoi avec association explicite",
  async () => {
    await fixture("lucie", "student");
    await click("cra-form");
    await page
      .locator("[name=activities]")
      .fill("Développement du module de gestion.");
    await page.locator("[name=difficulties]").fill("Aucune");
    await page.locator("[name=next]").fill("Tests automatisés");
    await page.locator("[name=linkConfirmed]").check();
    await page.locator("#dialog-form").evaluate((f) => f.requestSubmit());
    let s = await state();
    assert.equal(s.cra[0].status, "Brouillon");
    await page.locator(".nav [data-page=work]").click();
    await page.locator("[data-action=cra-form][data-id]").click();
    await page.locator("select[name=mode]").selectOption("craSend");
    await page.locator("#dialog-form").evaluate((f) => f.requestSubmit());
    assert.equal((await state()).cra[0].status, "À lire");
  },
);
await run(
  "Import : six lignes, trois anomalies, import partiel confirmé",
  async () => {
    await fixture("sophie", "stages");
    await page.locator(".nav [data-page=imports]").click();
    await click("import-example");
    await page
      .locator("form[data-form=import-preview] button[type=submit]")
      .click();
    assert.equal(await page.locator("tbody tr").count(), 6);
    await click("import-next");
    await page.locator("[name=confirmed]").check();
    await page
      .locator("form[data-form=import-confirm] button[type=submit]")
      .click();
    const s = await state();
    assert.equal(s.students.length, 14);
    assert.equal(s.imports[0].rejected, 3);
  },
);
await run(
  "Permissions : aperçu, motif requis puis sauvegarde effective",
  async () => {
    await fixture("admin", "admin");
    await page.locator(".nav [data-page=permissions]").click();
    await page.locator("[data-filter=role1]").selectOption("tutor");
    await page.locator('[data-permission="tutor|cra|validate"]').uncheck();
    assert.equal((await state()).overrides.tutor, undefined);
    await click("permissions-preview");
    await page.locator("#dialog-form").evaluate((f) => f.requestSubmit());
    assert.match(await page.locator(".form-error").textContent(), /motif/);
    await page
      .locator("[name=reason]")
      .fill("Contrôle de séparation des responsabilités");
    await page.locator("#dialog-form").evaluate((f) => f.requestSubmit());
    assert.equal((await state()).overrides.tutor["cra:validate"], false);
  },
);
await run(
  "Administration : aucun accès aux messages privés",
  async () => {
    await fixture("admin", "admin");
    assert.equal(await page.locator(".nav [data-page=messageAudit]").count(), 0);
    assert.equal(await page.locator("[data-action=audit-message-form]").count(), 0);
    assert.equal((await state()).audit.some((item) => item.type === "Consultation message"), false);
  },
);
await run(
  "CRV : éditeur riche préstructuré et brouillon modifiable",
  async () => {
    await fixture("sophie", "tutor");
    await page.locator("[data-action=open-dossier][data-target=s9]").click();
    await page.locator("[data-tab=crv]").click();
    await page
      .locator(".rich-content")
      .fill(
        "Contexte : première visite.\nMissions : API.\nCompétences : Java.\nIntégration : satisfaisante.\nAvis : positif.",
      );
    await page.locator(".rich-content").selectText();
    await click("editor-bold");
    await page.locator("form[data-form=crvSave] button[type=submit]").click();
    const c = (await state()).crvs.find((c) => c.student === "s9");
    assert.ok(c.text.includes("Contexte"));
    assert.ok(/<(b|strong)>/.test(c.html));
    await click("crv-edit");
    assert.equal(await page.locator(".rich-content").count(), 1);
    await page.keyboard.press("Escape");
  },
);
await run(
  "Onboarding : demande étudiant, création d’accès et e-mail simulé",
  async () => {
    await fixture("emma", "student");
    await page.locator(".nav [data-page=onboarding]").click();
    await page.locator("[name=mentorName]").fill("Paul Garnier");
    await page
      .locator("[name=mentorEmail]")
      .fill("paul.garnier@somme-digital.fr");
    await page
      .locator("form[data-form=onboarding] button[type=submit]")
      .click();
    let s = await state();
    s.session = { user: "sophie", role: "stages", lastActivity: Date.now() };
    await fixture("sophie", "stages", s);
    await page.locator(".nav [data-page=access]").click();
    await click("access-create");
    await page.locator("#dialog-form").evaluate((f) => f.requestSubmit());
    s = await state();
    assert.equal(s.students.find((d) => d.id === "s2").access, "Accès créé");
    assert.ok(s.rooms.some((r) => r.student === "s2"));
    assert.ok(s.emails.some((e) => e.to === "paul.garnier@somme-digital.fr"));
  },
);
await run(
  "Rupture : qualification, fermeture motivée puis nouveau cycle",
  async () => {
    await fixture("sophie", "stages");
    await page.locator(".nav [data-page=access]").click();
    await page.locator("[data-tab=reports]").click();
    await click("report-rupture");
    await page.locator("#dialog-form").evaluate((f) => f.requestSubmit());
    await page.locator(".nav [data-page=cohort]").click();
    await page.locator("tr[data-id=s4]").click();
    await click("open-dossier");
    await page.locator("[data-tab=room]").click();
    await click("room-close");
    await page
      .locator("[name=reason]")
      .fill("Rupture confirmée lors de l’entretien tripartite.");
    await page.locator("#dialog-form").evaluate((f) => f.requestSubmit());
    await click("new-cycle");
    await page
      .locator("[name=reason]")
      .fill("Reprise de recherche avec un nouveau contrat.");
    await page.locator("#dialog-form").evaluate((f) => f.requestSubmit());
    const s = await state();
    assert.equal(s.students.find((d) => d.id === "s4").cycle, 2);
    assert.equal(s.rooms.find((r) => r.id === "room3").closed, true);
    assert.equal(await page.locator("[data-action=new-cycle]").count(), 0);
  },
);
await run(
  "Bascule : confirmation, transfert du périmètre M1 vers M2",
  async () => {
    await fixture("sophie", "stages");
    await page.locator(".nav [data-page=cohort]").click();
    await page.locator("[data-tab=transition]").click();
    await page.locator("[name=ids][value=s1]").check();
    await page
      .locator("form[data-form=transition-preview] button[type=submit]")
      .click();
    assert.equal((await state()).students[0].promo, "M1");
    await page.locator("#dialog-form").evaluate((f) => f.requestSubmit());
    assert.equal((await state()).students[0].promo, "M2");
  },
);
await run(
  "Thème, préférences et données conservés après rechargement",
  async () => {
    await fixture("sophie", "stages");
    await click("theme");
    await page.reload();
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    await click("profile");
    await page.locator("#reduce-motion").check();
    await page.keyboard.press("Escape");
    await page.reload();
    assert.equal((await state()).preferences.motion, true);
  },
);
await run("Mobile : menu, aucune fuite horizontale de la page", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture("sophie", "stages");
  await click("menu");
  assert.ok(await page.locator(".sidebar.open").count());
  await page.locator(".nav [data-page=cohort]").click();
  await page.keyboard.press("Escape");
  const sizes = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  assert.equal(sizes[0], sizes[1]);
});
await run("Réinitialisation renforcée revient à la connexion", async () => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await click("demo");
  await click("reset-form");
  await page.locator("[name=confirmation]").fill("RÉINITIALISER");
  await page.locator("#dialog-form").evaluate((f) => f.requestSubmit());
  assert.equal(await page.locator("form[data-form=login]").count(), 1);
  assert.equal(await state(), null);
});
assert.deepEqual(errors, []);
console.log(
  `\n${passed} scénarios navigateur réussis ; aucune erreur JavaScript ou console.`,
);
await browser.close();
