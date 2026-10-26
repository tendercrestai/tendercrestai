import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("browser auth follows deployment configuration and never embeds production or test credentials", async () => {
 for(const path of ['index.html','auth.html','assets/rfp-upload.mjs']){const file=await readFile(new URL('../'+path,import.meta.url),'utf8');assert.ok(file.includes('auth-journey.mjs'),path);assert.ok(!file.includes('https://vfdwaqgfepvoujprtuww.supabase.co'),path);assert.ok(!file.includes('wcrrywzleylmdsqqlise'),path);assert.ok(file.includes('@supabase/supabase-js@2.117.3/+esm'));assert.ok(!file.includes('SUPABASE_SERVICE_ROLE_KEY'));assert.ok(!file.includes('AIRTABLE_PAT'));}
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
