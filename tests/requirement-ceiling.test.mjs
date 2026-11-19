import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const core = require("../netlify/functions/lib/proposal-core");

// Fictional requirements only. No real customer document is used anywhere in this file.
const DOC = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ANALYSIS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
// Two-token texts: the similarity step skips any pair whose smaller token
// set has 3 or fewer tokens, so distinct texts can never match each other
// and a replacement comparison counts exactly one change per requirement.
const analysisReq = (i) => ({ id: "req-" + i, fingerprint: undefined, original_requirement: "Obligation w" + i + "alpha.", requirement: "Obligation w" + i + "alpha.", mandatory: "Yes", category: "Technical", evaluation_weight: null, sources: [], uncertain: false, duplicate_count: 0 });
const reqs = (n, start = 0) => Array.from({ length: n }, (_, i) => analysisReq(start + i));
const workspaceFor = (list) => ({ analysis: { id: ANALYSIS, fingerprint: "fp", status: "Completed", documents: [], warnings: [], facts: [] }, requirements: list });
const stateFor = (list) => core.imported(core.initial("Fictional", "Fictional"), workspaceFor(list));
const propose = (s, list, kind = "supplemental") => core.proposeAmendment(s, { kind, analysisId: ANALYSIS, sourceDocumentId: DOC, fileIds: ["file-1"], documentsCompared: [{ id: DOC, name: "Fictional Amendment 1" }], documentsUnprocessed: [], newRequirements: core.normalizeAnalysisRequirements(workspaceFor(list)) }, "author-1");

test("share import succeeds at 579 requirements (the Nov 19 cap-test fixture size)", () => {
  const s = stateFor(reqs(579));
  assert.equal(s.requirements.length, 579);
  assert.equal(s.sections.length, 579);
});

test("share import succeeds at exactly 1000 requirements", () => {
  const s = stateFor(reqs(1000));
  assert.equal(s.requirements.length, 1000);
  assert.equal(s.sections.length, 1000);
});

test("share import fails above 1000 requirements", () => {
  assert.throws(() => stateFor(reqs(1001)), /at most 1000/);
});

test("analysis normalization succeeds at 1000 requirements and fails above", () => {
  assert.equal(core.normalizeAnalysisRequirements(workspaceFor(reqs(1000))).length, 1000);
  assert.throws(() => core.normalizeAnalysisRequirements(workspaceFor(reqs(1001))), /at most 1000/);
});

test("amendment proposal succeeds with 1000 new requirements (exactly 1000 added changes)", () => {
  const s = propose(stateFor(reqs(3)), reqs(1000, 1000));
  assert.equal(s.amendments.length, 1);
  assert.equal(s.amendments[0].changes.length, 1000);
});

test("amendment proposal fails above 1000 new requirements", () => {
  assert.throws(() => propose(stateFor(reqs(3)), reqs(1001, 1000)), /at most 1000/);
});

test("amendment proposal fails when proposed changes exceed 1000", () => {
  // 501 removed + 501 added = 1002 proposed changes, with only 501 new
  // requirements, so the changes cap (not the requirements cap) must fire.
  assert.throws(() => propose(stateFor(reqs(501)), reqs(501, 1000), "replacement"), /more than 1000 changes/);
});

test("database pw_commit limits match the JavaScript requirement ceiling (1000)", async () => {
  // Nov 19, 2026: raising only the JavaScript share ceiling would have
  // repeated the PR #105/#106 trap — the share flow commits through
  // pw_commit (S.commit with operation 'import'), and pw_commit rejected
  // any workspace with more than 500 requirements or sections with 22023
  // 'Invalid workspace', which the API surfaces as 400 'Invalid analysis
  // request or changed source review.' The share builds one section per
  // requirement, so both bounds must rise together. This static check ties
  // the newest migration's bounds to AMENDMENT_MAX_REQUIREMENTS: if either
  // side moves again without the other, this fails first.
  const migrationDir = new URL("../supabase/migrations/", import.meta.url);
  const files = (await readdir(migrationDir)).filter((f) => f.endsWith(".sql")).sort();
  const commitFiles = [];
  for (const file of files) {
    const sql = await readFile(new URL(file, migrationDir), "utf8");
    if (/function public\.pw_commit\(/.test(sql)) commitFiles.push({ file, sql });
  }
  assert.ok(commitFiles.length > 0, "no migration defines pw_commit");
  const latest = commitFiles[commitFiles.length - 1];
  const req = latest.sql.match(/jsonb_array_length\(p_state->'requirements'\)>(\d+)/);
  const sec = latest.sql.match(/jsonb_array_length\(p_state->'sections'\)>(\d+)/);
  assert.ok(req, `${latest.file} does not bound requirements in pw_commit`);
  assert.ok(sec, `${latest.file} does not bound sections in pw_commit`);
  assert.equal(Number(req[1]), 1000, `${latest.file} must allow 1000 requirements`);
  assert.equal(Number(sec[1]), 1000, `${latest.file} must allow 1000 sections`);
  const js = await readFile(new URL("../netlify/functions/lib/proposal-core.js", import.meta.url), "utf8");
  const max = js.match(/AMENDMENT_MAX_REQUIREMENTS=(\d+)/);
  assert.ok(max, "AMENDMENT_MAX_REQUIREMENTS not found in proposal-core.js");
  assert.equal(Number(max[1]), 1000, "AMENDMENT_MAX_REQUIREMENTS must be 1000");
  assert.equal(Number(req[1]), Number(max[1]), "database requirements bound must equal AMENDMENT_MAX_REQUIREMENTS");
  assert.equal(Number(sec[1]), Number(max[1]), "database sections bound must equal AMENDMENT_MAX_REQUIREMENTS");
});
