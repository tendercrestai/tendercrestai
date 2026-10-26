import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createProposalStatusTracker } from "../assets/proposal-status.mjs";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ID = "44444444-4444-4444-8444-444444444444";
const NEXT = "55555555-5555-4555-8555-555555555555";
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };

function fixture(initial = [{ status: "queued" }], storage = new Map()) {
  const timers = new Map(), listeners = new Map(), updates = [], requests = [];
  let timerId = 0, expired = 0;
  const document = {
    hidden: false,
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name) { listeners.delete(name); }
  };
  const session = { user: { id: OWNER }, access_token: "customer-token" };
  const responses = [...initial];
  const environment = {
    document,
    storage: () => ({
      getItem: key => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    }),
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async fetch(url, options) {
      requests.push({ url, options });
      const value = responses.shift();
      if (value instanceof Error) throw value;
      if (typeof value === "function") return value();
      return { status: value?.httpStatus || 200, ok: !(value?.httpStatus >= 400), async json() { return value; } };
    }
  };
  const tracker = createProposalStatusTracker({
    supabase: { auth: { async getSession() { return { data: { session } }; } } },
    storageKey: "status-test", environment,
    onUpdate: progress => updates.push(progress),
    onAuthExpired: () => { expired++; }
  });
  return {
    tracker, environment, timers, updates, requests, responses, storage, session,
    get expired() { return expired; },
    visibility(hidden) { document.hidden = hidden; listeners.get("visibilitychange")?.(); },
    async tick() {
      const [id, timer] = timers.entries().next().value || [];
      assert.ok(timer, "expected a scheduled poll");
      timers.delete(id); timer.fn(); await flush();
    }
  };
}

test("queued-to-ready progress replaces the queued label and stops polling", async () => {
  const f = fixture([{ status: "queued" }, { status: "drafting" }, { status: "ready" }]);
  f.tracker.start(ID, OWNER); await flush();
  await f.tick(); await f.tick();
  assert.deepEqual(f.updates.map(x => x.status), ["queued", "drafting", "ready"]);
  assert.match(f.updates.at(-1).label, /Draft ready/);
  assert.ok(!f.updates.at(-1).message.includes("Email sent"));
  assert.equal(f.timers.size, 0);
  assert.equal(f.requests.length, 3);
});
test("saved submission ID resumes after a reload without storing customer text or tokens", async () => {
  const storage = new Map();
  const first = fixture([{ status: "queued" }], storage);
  first.tracker.start(ID, OWNER); await flush(); first.tracker.destroy();
  assert.deepEqual([...storage.values()], [ID]);
  const second = fixture([{ status: "ready" }], storage);
  assert.equal(second.tracker.resume(OWNER), true);
  await flush();
  assert.equal(second.updates[0].status, "ready");
  assert.equal(second.requests[0].options.headers.Authorization, "Bearer customer-token");
});
test("a different account never resumes another account's submission", async () => {
  const f = fixture();
  f.tracker.start(ID, OWNER); await flush();
  assert.equal(f.tracker.resume(OTHER), false);
  assert.equal(f.timers.size, 0);
  assert.equal(f.requests.length, 1);
});
test("expired server session stops checks and requests login", async () => {
  const f = fixture([{ httpStatus: 401 }]);
  f.tracker.start(ID, OWNER); await flush();
  assert.equal(f.expired, 1);
  assert.equal(f.timers.size, 0);
  assert.equal(f.updates.length, 0);
});
test("hidden tabs pause polling and resume once visible", async () => {
  const f = fixture([{ status: "queued" }, { status: "ready" }]);
  f.tracker.start(ID, OWNER); await flush();
  f.visibility(true);
  assert.equal(f.timers.size, 0);
  f.visibility(false); await flush();
  assert.equal(f.requests.length, 2);
  assert.equal(f.updates.at(-1).status, "ready");
});
test("temporary status failures back off and recover without resubmitting", async () => {
  const f = fixture([new Error("offline"), { status: "ready" }]);
  f.tracker.start(ID, OWNER); await flush();
  assert.match(f.updates[0].message, /temporarily unavailable/);
  assert.equal([...f.timers.values()][0].delay, 20000);
  await f.tick();
  assert.equal(f.updates.at(-1).status, "ready");
  assert.ok(f.requests.every(r => !r.options.method || r.options.method === "GET"));
});
test("an old in-flight response cannot overwrite a newer submission", async () => {
  let resolveFirst;
  const f = fixture([
    () => new Promise(resolve => { resolveFirst = resolve; }),
    { status: "drafting" }
  ]);
  f.tracker.start(ID, OWNER); await flush();
  f.tracker.start(NEXT, OWNER); await flush();
  resolveFirst({ status: 200, ok: true, async json() { return { status: "ready" }; } });
  await flush();
  assert.deepEqual(f.updates.map(x => x.status), ["drafting"]);
  f.tracker.destroy();
});
test("forget removes the saved ID and cancels polls", async () => {
  const f = fixture();
  f.tracker.start(ID, OWNER); await flush();
  f.tracker.forget(OWNER);
  assert.equal(f.storage.size, 0);
  assert.equal(f.timers.size, 0);
});
test("both submission pages start and resume the shared tracker", async () => {
  const [workspace, upload] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../assets/rfp-upload.mjs", import.meta.url), "utf8")
  ]);
  assert.ok(workspace.includes("window.tendercrestProposalTracker.start("));
  assert.ok(workspace.includes("statusTracker.resume(authenticatedUser.id)"));
  assert.ok(upload.includes("statusTracker.start(payload.submissionId, owner)"));
  assert.ok(upload.includes("statusTracker.resume(user.id)"));
  assert.ok(!workspace.includes("},4000)"));
});

test("terminal failures include a support reference without exposing document content", async () => {
  const f=fixture([{status:'failed'}]);f.tracker.start(ID,OWNER);await flush();
  assert.equal(f.updates[0].reference,ID);assert.ok(f.updates[0].message.includes('Support reference: '+ID));assert.equal(f.timers.size,0);
});
