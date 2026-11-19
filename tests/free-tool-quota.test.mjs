import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const read = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");

test("free-tool quota is 5 per IP / 25 shared in JS, SQL, and user-facing copy", async () => {
  // Nov 18, 2026: the quota was raised from 3 per IP / 10 shared to 5 / 25.
  // The shredder admits from JS, but the bid checker admits inside the SQL
  // function ft_bidcheck_start, so a JS-only change would leave the bid
  // checker at the old cap. This test ties the three places together: the JS
  // admit params, the latest ft_bidcheck_start definition in the migrations,
  // and the copy users see. Historical migration files keep their old
  // numbers; only the latest definition of the function counts.
  const handler = await read("netlify/functions/free-tools.js");
  const jsAdmit = handler.match(/p_kind:'shred',p_limit:(\d+),p_global:(\d+)/);
  assert.ok(jsAdmit, "shred admit params in free-tools.js");
  assert.deepEqual([jsAdmit[1], jsAdmit[2]], ["5", "25"]);
  const quota = handler.match(/limit=(\d+),sharedLimit=(\d+)/);
  assert.ok(quota, "quota action limits in free-tools.js");
  assert.deepEqual([quota[1], quota[2]], ["5", "25"]);
  assert.match(handler, /up to five bids per IP per UTC day/);
  assert.match(handler, /shred up to five times per IP per UTC day/);
  assert.ok(!handler.includes("three bids"), "no stale bid-check 429 copy");
  assert.ok(!handler.includes("three times per IP"), "no stale shred 429 copy");

  const client = await read("assets/free-tools.mjs");
  assert.match(client, /share five anonymous uses per IP per UTC day/);
  assert.ok(!client.includes("three anonymous uses"), "no stale quota copy");

  const dir = new URL("../supabase/migrations/", import.meta.url);
  const files = (await readdir(dir)).sort();
  const definitions = [];
  for (const file of files) {
    const sql = await read("supabase/migrations/" + file);
    if (!sql.includes("function public.ft_bidcheck_start")) continue;
    const m = sql.match(/ft_admit\(p_ip,'shred',(\d+),(\d+)\)/);
    assert.ok(m, "ft_bidcheck_start admits from the shred bucket in " + file);
    definitions.push({ file, limit: m[1], global: m[2] });
  }
  assert.ok(definitions.length >= 2, "original + quota-raise definitions exist");
  const latest = definitions[definitions.length - 1];
  assert.deepEqual(
    [latest.limit, latest.global],
    [jsAdmit[1], jsAdmit[2]],
    "latest ft_bidcheck_start (" + latest.file + ") matches the JS admit params"
  );
});

test("free-tool quota copy says five, not three, on the tool pages, MCP, and docs", async () => {
  // Nov 18, 2026: PR #104 raised the quota from 3 per IP / 10 shared to
  // 5 / 25, but the descriptive copy still said three. The shared 25 is
  // deliberately not shown in descriptive copy.
  const shredder = await read("shredder.html");
  assert.match(shredder, /Five anonymous shreds per IP per UTC day/);
  assert.match(shredder, /limited to five shreds per IP per UTC day/);
  assert.ok(!shredder.includes("Three anonymous shreds"), "no stale shredder quota copy");
  assert.ok(!shredder.includes("three shreds"), "no stale shredder quota copy");
  const bidCheck = await read("bid-check.html");
  assert.match(bidCheck, /five anonymous uses per IP per UTC day/);
  assert.ok(!bidCheck.includes("three anonymous uses"), "no stale bid-check quota copy");
  const mcp = await read("netlify/functions/lib/mcp-tools.js");
  assert.match(mcp, /Limited to 5 shreds per day/);
  assert.ok(!mcp.includes("Limited to 3 shreds"), "no stale MCP quota copy");
  const docs = await read("docs/mcp.md");
  assert.match(docs, /5 shreds per IP per UTC day/);
  assert.ok(!docs.includes("3 shreds per IP"), "no stale MCP docs quota copy");
});
