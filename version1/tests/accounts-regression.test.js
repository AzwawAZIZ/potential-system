import test from "node:test";
import assert from "node:assert/strict";
import { seed } from "../seed.js";
import { mutate } from "../domain.js";

test("Comptes : la même adresse ne peut pas être enregistrée avec une casse différente", () => {
  const s = seed();
  s.session = { user: "admin", role: "admin", lastActivity: Date.now() };
  const account = { name: "Compte test", email: "SOPHIE.LAURENT@U-PICARDIE.FR", roles: ["tutor"], active: true, reason: "Test" };
  assert.throws(() => mutate(s, "account", account), /e-mail.*compte/i);
});
