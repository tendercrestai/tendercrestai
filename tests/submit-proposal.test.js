const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { handler } = require("../netlify/functions/submit-proposal");

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const DOC = "33333333-3333-4333-8333-333333333333";
const ID = "44444444-4444-4444-8444-444444444444";

const input = {
  proposalName: "Sample RFP",
  submitterEmail: "owner@example.com",
  organizationName: "Example",
  proposalSector: "Commercial / Enterprise RFP",
  rfpText: "Deliver a reviewed proposal.",
  qualifications: "Verified credentials",
  submissionId: ID
};

const source = Buffer.from("Source requirements");
const originalFetch = global.fetch;

let ledger;
let calls;
let settings;
let metadata;
let env;

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });

const run = (payload = input, token = "valid") =>
  handler({
    httpMethod: "POST",
    headers: token
      ? { authorization: "Bearer " + token }
      : {},
    body: JSON.stringify(payload)
  });

const body = response => JSON.parse(response.body);

beforeEach(() => {
  env = { ...process.env };
  process.env.AIRTABLE_PAT = "test-only";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";

  ledger = new Map();
  calls = [];
  settings = {};

  metadata = {
    id: DOC,
    user_id: USER,
    storage_path: USER + "/" + DOC + "/source.txt",
    size_bytes: source.length,
    mime_type: "text/plain",
    sha256: createHash("sha256").update(source).digest("hex")
  };

  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });

    const route = new URL(url);
    const payload = options.body ? JSON.parse(options.body) : null;

    if (route.pathname === "/auth/v1/user") {
      if (options.headers.Authorization !== "Bearer valid") {
        return json({}, 401);
      }

      return json({
        id: USER,
        email: "owner@example.com",
        email_confirmed_at: "2026-10-01"
      });
    }

    if (route.pathname === "/rest/v1/rfp_uploads") {
      return json(settings.foreign ? [] : [metadata]);
    }

    if (route.pathname.startsWith("/storage/v1/")) {
      assert.equal(
        options.headers.Authorization,
        "Bearer valid",
        "document download must use customer JWT"
      );

      if (settings.missingSource) return json({}, 404);

      return new Response(settings.source || source, {
        headers: { "content-type": metadata.mime_type }
      });
    }

    if (route.pathname === "/rest/v1/rfp_submissions") {
      if (settings.databaseDown) return json({}, 503);

      if (options.method === "POST") {
        const duplicateDocument = [...ledger.values()].some(
          row => row.document_id &&
            row.document_id === payload.document_id
        );

        if (ledger.has(payload.id) || duplicateDocument) {
          return json({}, 409);
        }

        ledger.set(payload.id, payload);
        return json([payload], 201);
      }

      const rows = [...ledger.values()].filter(row =>
        (
          !route.searchParams.has("id") ||
          route.searchParams.get("id") === "eq." + row.id
        ) &&
        (
          !route.searchParams.has("document_id") ||
          route.searchParams.get("document_id") ===
            "eq." + row.document_id
        ) &&
        (
          !route.searchParams.has("user_id") ||
          route.searchParams.get("user_id") ===
            "eq." + row.user_id
        ) &&
        (
          !route.searchParams.has("status") ||
          route.searchParams.get("status") ===
            "eq." + row.status
        )
      );

      if (options.method === "PATCH") {
        if (settings.finishDown) return json({}, 503);
        rows.forEach(row => Object.assign(row, payload));
      }

      return json(rows);
    }

    if (route.pathname.endsWith("/tbliWnP6ThqA02G5L")) {
      if (options.method === "POST") {
        return json({
          id: "recTrial",
          fields: payload.fields
        }, 201);
      }

      if (settings.accountDown) return json({}, 503);

      return json({
        records: settings.newTrial
          ? []
          : [{
              id: "recCompany",
              fields: {
                "Company Name": "Example",
                "Quota Status": settings.quota || "ACTIVE",
                "Remaining Proposals": 60,
                "Company Credentials Digest": "Saved credentials"
              }
            }]
      });
    }

    if (route.pathname.endsWith("/tblkL2ct7mYtUTu9S")) {
      if (settings.queueTimeout) {
        throw new Error("Network timeout");
      }

      if (settings.queueReject) return json({}, 503);
      return json({ id: "recProposal" }, 201);
    }

    throw new Error("Unexpected request: " + url);
  };
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = env;
});

const queueCalls = () =>
  calls.filter(call => call.url.includes("/tblkL2ct7mYtUTu9S"));

test("requires a verified bearer session and rejects email impersonation", async () => {
  assert.equal((await run(input, null)).statusCode, 401);
  assert.equal((await run(input, "expired")).statusCode, 401);

  assert.equal(
    (await run({
      ...input,
      submitterEmail: "other@example.com"
    })).statusCode,
    403
  );

  assert.equal(queueCalls().length, 0);
});

test("fails closed when service configuration or ledger is unavailable", async () => {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.equal((await run()).statusCode, 503);

  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
  settings.databaseDown = true;

  assert.equal((await run()).statusCode, 503);
  assert.equal(queueCalls().length, 0);
});

test("queues reviewed text in the unchanged Airtable schema", async () => {
  const response = await run({ ...input, documentId: DOC });

  assert.equal(response.statusCode, 200);

  const fields = JSON.parse(queueCalls()[0].options.body).fields;

  assert.deepEqual(fields, {
    "Proposal Name": input.proposalName,
    "Submitter Email": input.submitterEmail,
    "Submitting Organization Name": input.organizationName,
    "RFP Text Content": input.rfpText,
    "Proposal Specific Qualifications": input.qualifications,
    "Proposal Sector": input.proposalSector,
    "Pipeline Status": "Uploaded",
    Company: ["recCompany"]
  });

  assert.equal(ledger.get(ID).status, "queued");

  assert.equal(
    body(await run({ ...input, documentId: DOC })).duplicate,
    true
  );

  assert.equal(queueCalls().length, 1);
});

test("creates a free trial without Stripe and does not wait for computed quota", async () => {
  settings.newTrial = true;
  assert.equal((await run()).statusCode, 200);

  const trial = calls.find(call =>
    call.url.includes("/tbliWnP6ThqA02G5L") &&
    call.options.method === "POST"
  );

  assert.deepEqual(JSON.parse(trial.options.body).fields, {
    "Company Name": "Example",
    "Billing Email": "owner@example.com",
    "Subscription Tier": "Enterprise ($1,299/mo)",
    Status: "Trialing",
    "Amount Paid": 0
  });

  assert.deepEqual(
    JSON.parse(queueCalls()[0].options.body).fields.Company,
    ["recTrial"]
  );

  assert.ok(calls.every(call => !call.url.includes("stripe")));
});

test("cannot submit another user's document, a missing upload, or mismatched bytes", async () => {
  settings.foreign = true;

  assert.equal(
    (await run({ ...input, documentId: DOC })).statusCode,
    404
  );

  settings.foreign = false;
  metadata.user_id = OTHER;

  assert.equal(
    (await run({ ...input, documentId: DOC })).statusCode,
    404
  );

  metadata.user_id = USER;
  settings.missingSource = true;

  assert.equal(
    (await run({ ...input, documentId: DOC })).statusCode,
    400
  );

  settings.missingSource = false;
  settings.source = Buffer.from("Tampered file");

  assert.equal(
    (await run({ ...input, documentId: DOC })).statusCode,
    400
  );

  assert.equal(queueCalls().length, 0);
});

test("validates identifiers, paths, size and PDF signature", async () => {
  assert.equal(
    (await run({ ...input, documentId: "bad" })).statusCode,
    400
  );

  metadata.storage_path = OTHER + "/" + DOC + "/source.txt";

  assert.equal(
    (await run({ ...input, documentId: DOC })).statusCode,
    400
  );

  metadata.storage_path = USER + "/" + DOC + "/source.txt";
  metadata.size_bytes = 10485761;

  assert.equal(
    (await run({ ...input, documentId: DOC })).statusCode,
    400
  );

  metadata.size_bytes = source.length;
  metadata.storage_path = USER + "/" + DOC + "/source.pdf";
  metadata.mime_type = "application/pdf";

  assert.equal(
    (await run({ ...input, documentId: DOC })).statusCode,
    400
  );

  assert.equal(queueCalls().length, 0);
});

test("concurrent identical submissions create one queue record", async () => {
  const responses = await Promise.all([run(), run(), run()]);

  assert.ok(
    responses.some(response => response.statusCode === 200)
  );

  assert.equal(queueCalls().length, 1);
});

test("same document cannot be resubmitted under a fresh ID or changed inputs", async () => {
  const payload = { ...input, documentId: DOC };
  await run(payload);

  assert.equal(
    body(await run({
      ...payload,
      submissionId: OTHER
    })).duplicate,
    true
  );

  assert.equal(
    (await run({
      ...payload,
      rfpText: "Changed",
      submissionId: OTHER
    })).statusCode,
    409
  );

  assert.equal(queueCalls().length, 1);
});

test("failed account verification can safely retry before queue dispatch", async () => {
  settings.accountDown = true;

  assert.equal((await run()).statusCode, 503);
  assert.equal(ledger.get(ID).status, "retryable");

  settings.accountDown = false;

  assert.equal((await run()).statusCode, 200);
  assert.equal(queueCalls().length, 1);
});

test("an ambiguous Airtable response locks retries for manual reconciliation", async () => {
  settings.queueTimeout = true;

  assert.equal((await run()).statusCode, 503);
  assert.equal(ledger.get(ID).status, "uncertain");
  assert.equal((await run()).statusCode, 409);
  assert.equal(queueCalls().length, 1);
});

test("a failed ledger update never queues the request again", async () => {
  settings.finishDown = true;

  assert.equal((await run()).statusCode, 503);
  assert.equal(ledger.get(ID).status, "processing");

  settings.finishDown = false;

  assert.equal((await run()).statusCode, 409);
  assert.equal(queueCalls().length, 1);
});

test("existing quota states remain enforced", async () => {
  for (const [quota, status] of [
    ["SUBSCRIPTION_INACTIVE", 403],
    ["QUOTA_EXCEEDED", 429],
    ["Pending", 503]
  ]) {
    settings.quota = quota;
    assert.equal((await run()).statusCode, status);
  }

  assert.equal(queueCalls().length, 0);
});

test("invalid request shapes, limits and sectors never reach the queue", async () => {
  assert.equal(
    (await handler({ httpMethod: "GET" })).statusCode,
    405
  );

  assert.equal(
    (await handler({
      httpMethod: "POST",
      body: "x".repeat(600001)
    })).statusCode,
    413
  );

  assert.equal(
    (await handler({
      httpMethod: "POST",
      body: "{"
    })).statusCode,
    400
  );

  for (const change of [
    { rfpText: "x".repeat(100001) },
    { proposalSector: "Invalid" },
    { proposalName: "" },
    { qualifications: 123 }
  ]) {
    assert.equal(
      (await run({ ...input, ...change })).statusCode,
      400
    );
  }

  assert.equal(queueCalls().length, 0);
});
