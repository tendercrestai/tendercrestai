import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("browser auth follows deployment configuration and never embeds production or test credentials", async () => {
 for(const path of ['index.html','auth.html','assets/rfp-upload.mjs']){const file=await readFile(new URL('../'+path,import.meta.url),'utf8');assert.ok(file.includes('auth-journey.mjs'),path);assert.ok(!file.includes('https://vfdwaqgfepvoujprtuww.supabase.co'),path);assert.ok(!file.includes('wcrrywzleylmdsqqlise'),path);assert.ok(file.includes('@supabase/supabase-js@2.117.3/+esm'));assert.ok(!file.includes('SUPABASE_SERVICE_ROLE_KEY'));assert.ok(!file.includes('AIRTABLE_PAT'));}
});

test("production queue targets the original Airtable schema", async () => {
  const source = await readFile(
    new URL("../netlify/functions/lib/billing-source.js", import.meta.url), "utf8"
  );
  assert.ok(source.includes("https://api.airtable.com/v0/appsaqdp3UZdhB2VH"));
  assert.ok(source.includes("tbliWnP6ThqA02G5L"));
  assert.ok(source.includes("tblkL2ct7mYtUTu9S"));
  assert.ok(source.includes("test&&process.env.SUPABASE_URL!=="));
});

test("every proposal commit operation is allowed by pw_commit in the migrations", async () => {
  // Nov 18, 2026: the Amendments tab proposed fine after PR #94, but the
  // server answered every attempt 400 'Invalid knowledge request.' The
  // handler commits with operation 'amendment.proposed', which pw_commit
  // rejects with 22023 because its hardcoded allowlist (migration
  // 20261023160000) predates Capability 2 (readiness) and Capability 3
  // (amendments). The API tests stub S.commit, so only a static check ties
  // the operation names the code sends to the operations the database
  // accepts. Any new operation added in code without a matching migration
  // must fail here first.
  const { readdir } = await import("node:fs/promises");
  const migrationDir = new URL("../supabase/migrations/", import.meta.url);
  const allowed = new Set();
  for (const file of await readdir(migrationDir)) {
    if (!file.endsWith(".sql")) continue;
    const sql = await readFile(new URL(file, migrationDir), "utf8");
    for (const match of sql.matchAll(/p_operation not in \(([^)]*)\)/g)) {
      for (const token of match[1].matchAll(/'([^']+)'/g)) allowed.add(token[1]);
    }
  }
  assert.ok(allowed.size > 0, "no pw_commit allowlist found in the migrations");
  const used = new Set();
  for (const path of ["netlify/functions/proposals.js", "netlify/functions/lib/customer-upgrade.js"]) {
    const source = await readFile(new URL("../" + path, import.meta.url), "utf8");
    for (const match of source.matchAll(/S\.commit\([^)]*?'([a-z][a-z0-9._-]+)'/g)) used.add(match[1]);
    if (source.includes("data.amendment?'amendment':'import'")) used.add("import");
    const operations = source.match(/const operations=\{([\s\S]*?)\};/);
    if (operations) for (const match of operations[1].matchAll(/:\['([^']+)'/g)) used.add(match[1]);
    for (const match of source.matchAll(/\?'([a-z][a-z0-9._-]+)':operation\[0\]/g)) used.add(match[1]);
  }
  assert.ok(used.has("amendment.proposed"), "test must cover the reported defect");
  const missing = [...used].filter((op) => !allowed.has(op));
  assert.deepEqual(missing, [], `operations used by the code but rejected by pw_commit: ${missing.join(", ")}`);
});
