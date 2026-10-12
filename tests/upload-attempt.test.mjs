import { test } from "node:test";
import assert from "node:assert/strict";
import { uploadAttemptKey, beginNewUpload, mayStartNew } from "../assets/upload-attempt.mjs";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const FIRST = "33333333-3333-4333-8333-333333333333";
const NEXT = "44444444-4444-4444-8444-444444444444";
const HASH = "a".repeat(64);
function storage() {
  const values = new Map();
  return {
    values,
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value)
  };
}

test("ordinary retries preserve the existing file-specific attempt key", () => {
  const s = storage();
  const key = uploadAttemptKey(OWNER, HASH, s);
  assert.equal(key, "tendercrest-rfp:" + OWNER + ":" + HASH);
  s.setItem(key, JSON.stringify({ documentId: FIRST, submissionId: NEXT }));
  assert.equal(uploadAttemptKey(OWNER, HASH, s), key);
});
test("explicit new proposal creates a fresh same-file key and leaves old retry state intact", () => {
  const s = storage();
  const oldKey = uploadAttemptKey(OWNER, HASH, s);
  s.setItem(oldKey, "old-attempt");
  beginNewUpload(OWNER, s, () => FIRST);
  const newKey = uploadAttemptKey(OWNER, HASH, s);
  assert.notEqual(newKey, oldKey);
  assert.equal(s.getItem(oldKey), "old-attempt");
  assert.equal(s.getItem(newKey), null);
  assert.ok(newKey.includes(FIRST));
});
test("reload and retries keep the new attempt stable until another deliberate new action", () => {
  const s = storage();
  beginNewUpload(OWNER, s, () => FIRST);
  const key = uploadAttemptKey(OWNER, HASH, s);
  assert.equal(uploadAttemptKey(OWNER, HASH, s), key);
  beginNewUpload(OWNER, s, () => NEXT);
  assert.notEqual(uploadAttemptKey(OWNER, HASH, s), key);
});
test("new-attempt mode is account-specific", () => {
  const s = storage();
  const otherKey = uploadAttemptKey(OTHER, HASH, s);
  beginNewUpload(OWNER, s, () => FIRST);
  assert.equal(uploadAttemptKey(OTHER, HASH, s), otherKey);
});
test("failed session-storage write does not silently reset an existing attempt", () => {
  const s = storage();
  const key = uploadAttemptKey(OWNER, HASH, s);
  assert.throws(() => beginNewUpload(OWNER, {
    ...s, setItem() { throw new Error("storage unavailable"); }
  }, () => FIRST), /storage unavailable/);
  assert.equal(uploadAttemptKey(OWNER, HASH, s), key);
});
test("uncertain/prequeue reservations do not offer a new-proposal bypass", () => {
  for (const status of ["uncertain", "processing", "retryable", undefined]) {
    assert.equal(mayStartNew(status), false);
  }
  for (const status of ["queued", "parsing", "drafting", "ready", "failed", "quota_exceeded"]) {
    assert.equal(mayStartNew(status), true);
  }
});
