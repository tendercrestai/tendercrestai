import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

test("database chunk cap matches the JavaScript MAX_CHUNKS (32)", async () => {
  // Nov 19, 2026: PR #105 raised the JavaScript RFP import cap to 300,000
  // characters / 32 chunks, but the database still enforced 16 chunks, so a
  // 171,304-character document (~18 chunks) was rejected five times live
  // with 400 'Invalid analysis request or changed source review.'
  // rfp_compliance_start raises 'invalid analysis size' (22023) when
  // chunks * 3 > 48, and the chunks column CHECK also capped at 16. The
  // JavaScript tests cannot see the database bounds, so this static check
  // ties the newest migration's bounds to the code's MAX_CHUNKS: if either
  // side moves again without the other, this fails first.
  const migrationDir = new URL("../supabase/migrations/", import.meta.url);
  const files = (await readdir(migrationDir)).filter((f) => f.endsWith(".sql")).sort();
  assert.ok(files.length > 0, "no migration files found");

  // Newest migration that (re)defines rfp_compliance_start.
  const startFiles = [];
  for (const file of files) {
    const sql = await readFile(new URL(file, migrationDir), "utf8");
    if (/function public\.rfp_compliance_start\(/.test(sql)) startFiles.push({ file, sql });
  }
  assert.ok(startFiles.length > 0, "no migration defines rfp_compliance_start");
  const latestStart = startFiles[startFiles.length - 1];
  const calls = latestStart.sql.match(/calls\s*:?=\s*jsonb_array_length\(p_chunks\)\s*\*\s*3;[\s\S]*?calls > (\d+)/);
  assert.ok(calls, `${latestStart.file} does not bound calls in rfp_compliance_start`);
  assert.equal(Number(calls[1]), 96, `${latestStart.file} must allow 96 calls (32 chunks x 3)`);

  // Newest migration that touches the chunks CHECK.
  const checkFiles = [];
  for (const file of files) {
    const sql = await readFile(new URL(file, migrationDir), "utf8");
    const match = sql.match(/jsonb_array_length\(chunks\) between 1 and (\d+)/);
    if (match) checkFiles.push({ file, max: Number(match[1]) });
  }
  assert.ok(checkFiles.length > 0, "no migration sets the chunks CHECK bound");
  const latestCheck = checkFiles[checkFiles.length - 1];
  assert.equal(latestCheck.max, 32, `${latestCheck.file} must set the chunks CHECK to 1-32`);

  // The JavaScript cap the database must match.
  const js = await readFile(new URL("../netlify/functions/lib/compliance-document.js", import.meta.url), "utf8");
  const maxChunks = js.match(/const MAX_CHUNKS = (\d+);/);
  assert.ok(maxChunks, "MAX_CHUNKS not found in compliance-document.js");
  assert.equal(Number(maxChunks[1]), 32, "MAX_CHUNKS must be 32");
  assert.equal(Number(calls[1]) / 3, Number(maxChunks[1]), "database calls bound / 3 must equal MAX_CHUNKS");
  assert.equal(latestCheck.max, Number(maxChunks[1]), "database chunks CHECK must equal MAX_CHUNKS");
});
