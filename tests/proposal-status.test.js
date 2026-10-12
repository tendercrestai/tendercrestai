const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { handler } = require("../netlify/functions/proposal-status");

const USER = "11111111-1111-4111-8111-111111111111";
const ID = "44444444-4444-4444-8444-444444444444";
const RECORD = "rec123456789ABCDE";
const originalFetch = global.fetch;
let env, calls, settings;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
const run = (overrides = {}) => handler({
  httpMethod: "GET",
  headers: { authorization: "Bearer customer-token" },
  queryStringParameters: { submissionId: ID },
  ...overrides
});

describe("authenticated proposal status", () => {
beforeEach(() => {
  env = { ...process.env };
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-only";
  process.env.AIRTABLE_PAT = "airtable-only";
  delete process.env.AIRTABLE_BASE_ID;
  calls = [];
  settings = {};
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    const route = new URL(url);
    if (route.pathname === "/auth/v1/user") {
      return settings.expired ? json({}, 401) :
        json({ id: USER, email: "owner@example.com", email_confirmed_at: "2026-10-01" });
    }
    if (route.pathname === "/rest/v1/rfp_submissions") {
      assert.equal(options.headers.Authorization, "Bearer customer-token");
      assert.equal(route.searchParams.get("user_id"), "eq." + USER);
      assert.equal(route.searchParams.get("id"), "eq." + ID);
      assert.equal(route.searchParams.get("select"), "id,status,record_id");
      return settings.lookupDown ? json({}, 503) :
        json(settings.foreign ? [] : [{ id: ID, status: settings.ledgerStatus || "queued", record_id: settings.recordId || RECORD }]);
    }
    if (route.hostname === "api.airtable.com") {
      assert.equal(route.searchParams.get("filterByFormula"), "RECORD_ID()='" + RECORD + "'");
      assert.deepEqual(route.searchParams.getAll("fields[]"), ["Pipeline Status"]);
      assert.equal(options.headers.Authorization, "Bearer airtable-only");
      if (settings.airtableDown) return json({}, 429);
      return json({ records: settings.missingRecord ? [] : [{
        id: RECORD, fields: {
          "Pipeline Status": settings.stage || "Uploaded",
          "RFP Text Content": "PRIVATE SOURCE",
          "Generated Proposal Content": "PRIVATE DRAFT"
        }
      }] });
    }
    throw new Error("Unexpected request");
  };
});
afterEach(() => { global.fetch = originalFetch; process.env = env; });
const queueReads = () => calls.filter(x => x.url.includes("api.airtable.com"));

test("status requires GET and a valid submission ID", async () => {
  const response = await run({ httpMethod: "POST" });
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.Allow, "GET");
  assert.equal((await run({ queryStringParameters: { submissionId: "bad" } })).statusCode, 400);
  assert.equal((await run({ queryStringParameters: { recordId: RECORD } })).statusCode, 400);
  assert.equal(calls.length, 0);
});
test("status rejects missing and expired sessions", async () => {
  assert.equal((await run({ headers: {} })).statusCode, 401);
  settings.expired = true;
  assert.equal((await run()).statusCode, 401);
  assert.equal(queueReads().length, 0);
});
test("foreign submission is hidden before any Airtable request", async () => {
  settings.foreign = true;
  assert.equal((await run()).statusCode, 404);
  assert.equal(queueReads().length, 0);
});
test("maps live generation stages without exposing content or claiming email delivery", async () => {
  for (const [stage, expected] of [
    ["Uploaded", "queued"], ["Parsing Requirements", "parsing"],
    ["Drafting Proposal", "drafting"], ["Ready for Review", "ready"],
    ["Failed", "failed"], ["Quota Exceeded", "quota_exceeded"], ["Unknown", "processing"]
  ]) {
    settings.stage = stage;
    const response = await run();
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { status: expected, emailStatus: "unconfirmed" });
    assert.equal(response.headers["Cache-Control"], "no-store");
    assert.ok(!response.body.includes("PRIVATE"));
  }
});
test("reports prequeue/uncertain states without attempting generation or sending email", async () => {
  for (const status of ["processing", "uncertain", "retryable"]) {
    settings.ledgerStatus = status;
    assert.equal(JSON.parse((await run()).body).status, status);
  }
  assert.equal(queueReads().length, 0);
  assert.ok(calls.every(x => !x.options.method || x.options.method === "GET"));
});
test("invalid saved Airtable IDs cannot inject formula or URL paths", async () => {
  settings.recordId = "rec' OR TRUE()";
  assert.equal((await run()).statusCode, 503);
  assert.equal(queueReads().length, 0);
});
test("upstream failures fail closed and never mutate the ledger", async () => {
  settings.lookupDown = true;
  assert.equal((await run()).statusCode, 503);
  settings.lookupDown = false;
  settings.airtableDown = true;
  assert.equal((await run()).statusCode, 503);
  settings.airtableDown = false;
  settings.missingRecord = true;
  assert.equal((await run()).statusCode, 503);
  assert.ok(calls.every(x => !x.options.method || x.options.method === "GET"));
});
test("missing service or Airtable configuration returns a safe error", async () => {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.equal((await run()).statusCode, 503);
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-only";
  delete process.env.AIRTABLE_PAT;
  assert.equal((await run()).statusCode, 503);
  assert.equal(queueReads().length, 0);
});

test("status uses the configured test base and rejects malformed base identifiers", async () => {
  process.env.AIRTABLE_BASE_ID = 'app12345678901234';
  assert.equal((await run()).statusCode, 200);
  assert.ok(queueReads()[0].url.includes('/app12345678901234/'));
  calls = [];
  process.env.AIRTABLE_BASE_ID = '../invalid';
  assert.equal((await run()).statusCode, 503);
  assert.equal(queueReads().length, 0);
});

});
