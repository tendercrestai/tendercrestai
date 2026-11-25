// Grant plans in the in-app trial checkout: the JS plans map, the SQL
// checkout function, and the checkout table check must agree on all six
// plans. Nov 25, 2026: PR #119 added the grant plans to the JS map, but
// cc_begin_checkout and the cc_checkouts plan check still admitted only
// pro/growth/enterprise, so every grant checkout raised 22023 and the hub
// showed only the generic 400 'Invalid knowledge request.' — 11 failed
// attempts, no Stripe session ever created. Same class as the Nov 18
// pw_commit defect (production-config.test.mjs): the API tests stub the
// database, so only a static check ties the plan names the code sends to
// the plans the database accepts. Any new plan added in code without a
// matching migration must fail here first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const read = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");
const PLANS = ["pro", "growth", "enterprise", "grant-starter", "grant-plus", "grant-pro"];

async function latestDefinitions(pattern, files) {
  const found = [];
  for (const file of files) {
    const sql = await read("supabase/migrations/" + file);
    for (const match of sql.matchAll(pattern)) {
      found.push({ file, plans: [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) });
    }
  }
  return found;
}

test("every plan the hub checkout offers is allowed by cc_begin_checkout and the cc_checkouts check", async () => {
  const js = await read("netlify/functions/lib/customer-care.js");
  const plansLine = js.match(/const plans=\{([\s\S]*?)\};/);
  assert.ok(plansLine, "plans map in lib/customer-care.js");
  const jsPlans = [...plansLine[1].matchAll(/'?(pro|growth|enterprise|grant-starter|grant-plus|grant-pro)'?\s*:\s*\{price:/g)].map((m) => m[1]);
  assert.deepEqual([...jsPlans].sort(), [...PLANS].sort(), "JS plans map offers all six plans");

  const dir = new URL("../supabase/migrations/", import.meta.url);
  const files = (await readdir(dir)).sort();
  const functions = await latestDefinitions(/if p_plan not in \(([^)]+)\)/g, files);
  assert.ok(functions.length >= 3, "original + plan-switch + grant-plans cc_begin_checkout definitions exist");
  const latestFunction = functions[functions.length - 1];
  assert.deepEqual(
    [...latestFunction.plans].sort(),
    [...PLANS].sort(),
    "latest cc_begin_checkout (" + latestFunction.file + ") admits all six plans"
  );
  const constraints = await latestDefinitions(/check\(plan in \(([^)]+)\)/g, files);
  assert.ok(constraints.length >= 2, "original + grant-plans cc_checkouts plan checks exist");
  const latestConstraint = constraints[constraints.length - 1];
  assert.deepEqual(
    [...latestConstraint.plans].sort(),
    [...PLANS].sort(),
    "latest cc_checkouts plan check (" + latestConstraint.file + ") admits all six plans"
  );
});

test("the latest ft_admit definition admits the grants feed kind", async () => {
  // Nov 25, 2026: the Grants.gov feed on the isolated test site returned
  // 400 'Invalid knowledge request.' for every keyword while production
  // worked — ft_admit in the test project still ran the pre-grants
  // allowlist (the 20261119230000 migration was never applied there).
  // The repo definition must keep admitting 'grants'; applying the latest
  // migration to the test project is a production step, not a code change.
  const js = await read("netlify/functions/lib/grants-opportunities.js");
  assert.match(js, /p_kind:\s*'grants'/, "grants search admits from the grants bucket");
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const files = (await readdir(dir)).sort();
  const definitions = await latestDefinitions(/if p_kind not in \(([^)]+)\)/g, files);
  assert.ok(definitions.length >= 2, "original + grants ft_admit definitions exist");
  const latest = definitions[definitions.length - 1];
  assert.ok(latest.plans.includes("grants"), "latest ft_admit (" + latest.file + ") admits 'grants'");
  for (const kind of ["shred", "email", "event", "sam", "ai", "nyc", "bonfire", "webs", "socrata", "dc-pass"]) {
    assert.ok(latest.plans.includes(kind), "latest ft_admit (" + latest.file + ") still admits '" + kind + "'");
  }
});
