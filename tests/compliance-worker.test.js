'use strict';
// F9: paid analysis only advanced while the browser tab kept calling `step`.
// The worker continues reviewed Pending / lease-expired Processing analyses
// server-side, one chunk at a time, at most 3 chunks per invocation, then
// re-dispatches itself while work remains. Failed analyses stay user-initiated.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../netlify/functions/lib/compliance-worker');
const { sweepStrandedJobs } = require('../netlify/functions/lib/job-sweeper');

const ID = '44444444-4444-4444-8444-444444444444';
const OWNER = '11111111-1111-4111-8111-111111111111';
const VALIDATION_MESSAGE = 'AI output failed source validation. Retry this chunk or review the source manually.';

const originalFetch = global.fetch;
const originalEnv = { ...process.env };
let analysis, calls, aiCalls, dispatchCalls, settings;

const response = (value, status = 200) => Response.json(value, { status });
function chunk(i) { return [{ id: 'seg-' + i, text: 'The vendor must provide three references.' }]; }
function freshAnalysis(overrides = {}) {
  return {
    id: ID, user_id: OWNER, fingerprint: 'fp', reviewed_hash: 'fp', status: 'Pending',
    documents: [{ id: 'doc-1', name: 'Fictional RFP' }], chunks: [chunk(0), chunk(1), chunk(2), chunk(3)],
    warnings: [], facts: [], cursor: 0, attempts: 0, lease_token: null, lease_until: null,
    updated_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function installFetch() {
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    const u = new URL(url), body = options.body ? JSON.parse(options.body) : null;
    if (u.pathname === '/rest/v1/rfp_compliance_analyses') {
      return response(analysis ? [analysis] : []);
    }
    if (u.pathname === '/rest/v1/rpc/rfp_compliance_claim') {
      const a = analysis;
      if (a.status === 'Completed' || a.status === 'Partial') return response({ done: true });
      if (settings.claimBudget) return response({ code: 'P0001' }, 400);
      if (a.lease_token && Date.parse(a.lease_until) > Date.now()) return response({ code: '55P03' }, 400);
      if (a.attempts >= 3) return response({ code: 'P0001' }, 400);
      a.lease_token = body.p_lease;
      a.lease_until = new Date(Date.now() + 90000).toISOString();
      a.attempts++;
      a.status = 'Processing';
      return response({ chunk: a.chunks[a.cursor], documents: a.documents, cursor: a.cursor });
    }
    if (u.pathname === '/rest/v1/rpc/rfp_compliance_finish') {
      const a = analysis;
      if (a.lease_token !== body.p_lease) return response(false);
      a.lease_token = null; a.lease_until = null;
      if (body.p_error) { a.status = 'Failed'; }
      else {
        a.cursor++; a.attempts = 0;
        a.status = a.cursor === a.chunks.length ? (a.warnings.length ? 'Partial' : 'Completed') : 'Pending';
      }
      return response(true);
    }
    throw Error('Unexpected route ' + u.pathname);
  };
}

function config() { return { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_PUBLISHABLE_KEY, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY }; }
function aiStub() {
  return async () => {
    aiCalls++;
    if (settings.aiFailures && aiCalls <= settings.aiFailures) {
      const e = new Error(settings.aiFailureMessage || 'AI service is unavailable.');
      if (settings.aiFailureStatus !== undefined) e.status = settings.aiFailureStatus;
      throw e;
    }
    return { requirements: [{ requirement: 'Fictional requirement.' }], facts: [] };
  };
}
function dispatchStub() { return async (id) => { dispatchCalls.push(id); return true; }; }
function run(id = ID) { return W.processAnalysis(config(), id, { analyzeChunk: aiStub(), dispatch: dispatchStub() }); }

test.beforeEach(() => {
  process.env.SUPABASE_URL = 'https://vfdwaqgfepvoujprtuww.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_fixture';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-fixture';
  process.env.COMPLIANCE_AI_API_KEY = 'fixture-key';
  process.env.COMPLIANCE_AI_MODEL = 'fixture-model';
  calls = []; aiCalls = 0; dispatchCalls = []; settings = {};
  analysis = freshAnalysis();
  installFetch();
});
test.afterEach(() => { global.fetch = originalFetch; process.env = { ...originalEnv }; });

test('worker advances up to 3 chunks per invocation then chains itself', async () => {
  const result = await run();
  assert.equal(result.done, false);
  assert.equal(result.advanced, 3);
  assert.equal(aiCalls, 3);
  assert.equal(analysis.cursor, 3);
  assert.equal(analysis.status, 'Pending');
  assert.deepEqual(dispatchCalls, [ID]);
});

test('worker stops at Completed without chaining', async () => {
  analysis.chunks = [chunk(0), chunk(1)];
  const result = await run();
  assert.equal(result.done, true);
  assert.equal(result.advanced, 2);
  assert.equal(analysis.status, 'Completed');
  assert.deepEqual(dispatchCalls, []);
});

test('worker stops at Partial without chaining', async () => {
  analysis.chunks = [chunk(0)];
  analysis.warnings = ['One document had extraction gaps.'];
  const result = await run();
  assert.equal(result.done, true);
  assert.equal(result.advanced, 1);
  assert.equal(analysis.status, 'Partial');
  assert.deepEqual(dispatchCalls, []);
});

test('worker does not start an unreviewed analysis', async () => {
  analysis.reviewed_hash = null;
  const result = await run();
  assert.equal(result.advanced, 0);
  assert.equal(result.done, false);
  assert.ok(calls.every(c => !c.url.includes('/rpc/rfp_compliance_claim')));
  assert.deepEqual(dispatchCalls, []);
});

test('worker leaves a Failed analysis for the user retry', async () => {
  analysis.status = 'Failed';
  const result = await run();
  assert.equal(result.advanced, 0);
  assert.ok(calls.every(c => !c.url.includes('/rpc/rfp_compliance_claim')));
  assert.deepEqual(dispatchCalls, []);
});

test('worker marks a chunk Failed after analyzeChunk throws and does not chain', async () => {
  settings.aiFailures = 3;
  settings.aiFailureMessage = 'boom';
  const result = await run();
  assert.equal(result.advanced, 0);
  assert.equal(analysis.status, 'Failed');
  assert.equal(aiCalls, 1);
  assert.deepEqual(dispatchCalls, []);
});

test('worker retries a transient analyzeChunk failure inside the lease', async () => {
  settings.aiFailures = 2;
  settings.aiFailureStatus = 502;
  const result = await run();
  assert.equal(result.advanced, 3);
  assert.equal(aiCalls, 5);
  assert.equal(analysis.status, 'Pending');
  assert.deepEqual(dispatchCalls, [ID]);
});

test('worker retries a validation failure once, then marks the chunk Failed', async () => {
  settings.aiFailures = 3;
  settings.aiFailureMessage = VALIDATION_MESSAGE;
  settings.aiFailureStatus = 502;
  const result = await run();
  assert.equal(result.advanced, 0);
  assert.equal(aiCalls, 2);
  assert.equal(analysis.status, 'Failed');
  assert.deepEqual(dispatchCalls, []);
});

test('worker backs off when the browser holds the lease', async () => {
  analysis.lease_token = 'browser-lease';
  analysis.lease_until = new Date(Date.now() + 60000).toISOString();
  analysis.status = 'Processing';
  const result = await run();
  assert.equal(result.advanced, 0);
  assert.equal(aiCalls, 0);
  assert.deepEqual(dispatchCalls, []);
});

test('worker stops on the per-chunk attempt budget without chaining', async () => {
  analysis.attempts = 3;
  const result = await run();
  assert.equal(result.advanced, 0);
  assert.ok(calls.every(c => !c.url.includes('/rpc/rfp_compliance_claim')));
  assert.deepEqual(dispatchCalls, []);
});

test('worker stops on a claim budget error without chaining', async () => {
  settings.claimBudget = true;
  const result = await run();
  assert.equal(result.advanced, 0);
  assert.equal(aiCalls, 0);
  assert.deepEqual(dispatchCalls, []);
});

test('stalledQuery only matches reviewed, in-budget, idle, Pending or lease-expired Processing analyses', () => {
  const now = new Date('2026-11-15T16:00:00.000Z');
  const q = W.stalledQuery(now);
  assert.ok(q.startsWith('rfp_compliance_analyses?'));
  assert.ok(q.includes('attempts=lt.3'));
  assert.ok(q.includes('reviewed_hash=is.not.null'));
  assert.ok(q.includes('updated_at=lt.' + encodeURIComponent('2026-11-15T15:55:00.000Z')));
  assert.ok(q.includes('or=(status.eq.Pending,and(status.eq.Processing,lease_until.lt.' + encodeURIComponent('2026-11-15T16:00:00.000Z') + '))'));
  assert.ok(q.includes('order=updated_at.asc'));
  assert.ok(q.includes('limit=10'));
});

test('sweep dispatches a stalled paid analysis through the compliance dispatcher', async () => {
  const dispatched = [];
  const db = async (path) => {
    if (path.startsWith('rfp_compliance_analyses?')) return [{ id: ID }];
    return [];
  };
  const summary = await sweepStrandedJobs(config(), {
    db,
    now: new Date('2026-11-15T16:00:00.000Z'),
    dispatchers: {
      proposal: async () => false,
      knowledge: async () => false,
      free: async () => false,
      compliance: async (id) => { dispatched.push(id); return true; },
    },
  });
  assert.deepEqual(dispatched, [ID]);
  assert.deepEqual(summary.compliance, { found: 1, redispatched: 1, failed: 0 });
  assert.deepEqual(summary.pw, { found: 0, redispatched: 0, failed: 0 });
  assert.deepEqual(summary.ft, { found: 0, redispatched: 0, failed: 0 });
});
