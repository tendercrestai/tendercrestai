import { test } from "node:test";
import assert from "node:assert/strict";
import { draftNoTextMessage } from "../assets/ui-helpers.mjs";

// Nov 18, 2026: the section preview blamed missing evidence for procedural
// requirements (submission instructions), which are never drafted from
// evidence. The message now names the gap reason from the job result;
// without a gapReason (old jobs) it keeps the previous no-evidence wording.
test("draft preview message names the gap reason", () => {
  assert.match(draftNoTextMessage("procedural"), /submission instructions/);
  assert.match(draftNoTextMessage("procedural"), /evidence does not draft these/);
  assert.match(draftNoTextMessage("no-evidence"), /approved, current evidence/);
  assert.match(draftNoTextMessage("mixed"), /submission instructions/);
  assert.match(draftNoTextMessage("mixed"), /approved, current evidence/);
  assert.equal(draftNoTextMessage(undefined), draftNoTextMessage("no-evidence"));
  assert.equal(draftNoTextMessage(null), draftNoTextMessage("no-evidence"));
  assert.equal(draftNoTextMessage("bogus"), draftNoTextMessage("no-evidence"));
  for (const reason of ["procedural", "no-evidence", "mixed", undefined]) {
    assert.ok(!draftNoTextMessage(reason).includes("\u2014"), "no em dash in user-facing copy");
  }
});
