import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("production client and server defaults agree and contain no test project configuration", async () => {
  const paths = [
    "netlify/functions/evidence-config.js",
    "netlify/functions/lib/rfp-security.js"
  ];
  const files = await Promise.all(paths.map(path =>
    readFile(new URL("../" + path, import.meta.url), "utf8")
  ));
  for (let i = 0; i < files.length; i++) {
    assert.ok(files[i].includes("https://vfdwaqgfepvoujprtuww.supabase.co"), paths[i]);
    assert.ok(files[i].includes("sb_publishable_7J1W7gPugOUuVnCWKpS24A_ozYw0KM3"), paths[i]);
    assert.ok(!files[i].includes("wcrrywzleylmdsqqlise"), paths[i]);
    assert.ok(!files[i].includes("sb_publishable_ODNiFkBvJp_IiLOFYDXTYg_uxg5Jecq"), paths[i]);
  }
  for (const path of ['index.html', 'auth.html', 'assets/rfp-upload.mjs']) {
    const file = await readFile(new URL('../' + path, import.meta.url), 'utf8');
    assert.ok(file.includes('createBrowserClient'));
    assert.ok(!file.includes('vfdwaqgfepvoujprtuww'));
    assert.ok(!file.includes("SUPABASE_SERVICE_ROLE_KEY"));
    assert.ok(!file.includes("AIRTABLE_PAT"));
  }
  const client = await readFile(new URL('../assets/supabase-client.mjs', import.meta.url), 'utf8');
  assert.ok(client.includes('@supabase/supabase-js@2.117.3/+esm'));
  assert.ok(client.includes('/.netlify/functions/evidence-config'));
});

test("production queue targets the original Airtable schema", async () => {
  const source = await readFile(
    new URL("../netlify/functions/submit-proposal.js", import.meta.url), "utf8"
  );
  assert.ok(source.includes("https://api.airtable.com/v0/appsaqdp3UZdhB2VH"));
  assert.ok(source.includes("tbliWnP6ThqA02G5L"));
  assert.ok(source.includes("tblkL2ct7mYtUTu9S"));
  assert.ok(!source.includes("appsDmtQ1XOE8Gjtr"));
});

