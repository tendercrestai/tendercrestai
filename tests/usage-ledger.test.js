const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const credits = require('../netlify/functions/lib/credits');
const handler = require('../netlify/functions/account-ledger').handler;

const now = Date.parse('2026-10-25T12:00:00Z');
const period = { start: '2026-10-20T00:00:00Z', end: '2026-11-20T00:00:00Z' };
const SUB_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const SUB_B = 'bbbbbbbb-2222-4222-8222-222222222222';

const company = (pipeline = []) => ({
  id: 'recCompany',
  createdTime: '2026-10-01T00:00:00Z',
  fields: {
    Status: 'Active',
    'Subscription Tier': 'Growth ($699/mo)',
    'Billing Period Start': '2026-10-20T00:00:00Z',
    'Billing Period End': '2026-11-20T00:00:00Z',
    'Proposals Pipeline': pipeline
  }
});
const config = { url: 'https://db.invalid', serviceKey: 'private' };
const root = 'https://api.airtable.com';
const headers = {};
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com' };

let originalFetch, env, settings, calls;
beforeEach(() => {
  originalFetch = global.fetch;
  env = { ...process.env };
  settings = { airtableRecords: [], reservations: [], submissions: [], uploads: [] };
  calls = [];
  credits.clearUsageCache();
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.includes('/rest/v1/proposal_credit_reservations')) return Response.json(settings.reservations);
    if (url.includes('/rest/v1/rfp_submissions')) return Response.json(settings.submissions);
    if (url.includes('/rest/v1/rfp_uploads')) return Response.json(settings.uploads);
    if (url.includes('api.airtable.com')) return Response.json({ records: settings.airtableRecords });
    if (url.includes('/rest/v1/')) throw new Error('Unexpected Supabase read: ' + url);
    throw new Error('Unexpected request: ' + url);
  };
});
afterEach(() => { global.fetch = originalFetch; process.env = env; credits.clearUsageCache(); });

const reservation = (over = {}) => ({ submission_id: SUB_A, status: 'queued', record_id: null, reserved_at: '2026-10-21T10:00:00Z', ...over });
const pipeRow = (over = {}) => ({ id: 'recPipe1', fields: { 'Proposal Name': 'Acme RFP', 'Created Date': '2026-10-21', 'Pipeline Status': 'Ready for Review', 'Credit Reservation ID': SUB_A }, ...over });
const submission = (over = {}) => ({ id: SUB_A, document_id: 'doc1', status: 'queued', created_at: '2026-10-21T09:00:00Z', ...over });
const upload = (over = {}) => ({ id: 'doc1', file_name: 'acme-rfp.pdf', ...over });

// A reservation and its Airtable row are one credit, labelled by Proposal Name.
test('merge lists a reservation once, labelled by its Airtable Proposal Name', () => {
  const entries = credits.mergeLedgerEntries({
    reservations: [reservation({ record_id: 'recPipe1' })],
    submissions: [submission()],
    uploads: [upload()],
    pipelineRows: [pipeRow()],
    period
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].label, 'Acme RFP');
  assert.equal(entries[0].effect, 'used');
  assert.equal(entries[0].status, 'Credit used');
  assert.equal(entries[0].reference, 'aaaaaaaa');
  assert.equal(entries[0].inCurrentPeriod, true);
});

// The marker alone merges the pair when the reservation carries no record id.
test('merge dedupes by reservation marker when the Airtable row carries it', () => {
  const entries = credits.mergeLedgerEntries({
    reservations: [reservation()],
    submissions: [submission()],
    uploads: [upload()],
    pipelineRows: [pipeRow()],
    period
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].label, 'Acme RFP');
});

// Without an Airtable row, the uploaded RFP file name labels the job.
test('merge falls back to the uploaded file name without an Airtable row', () => {
  const entries = credits.mergeLedgerEntries({
    reservations: [reservation()],
    submissions: [submission()],
    uploads: [upload()],
    pipelineRows: [],
    period
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].label, 'acme-rfp.pdf');
});

// With no name anywhere, the entry is a plain proposal submission, never invented.
test('merge never invents a job name', () => {
  const entries = credits.mergeLedgerEntries({
    reservations: [reservation()],
    submissions: [],
    uploads: [],
    pipelineRows: [],
    period
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].label, 'Proposal submission');
  assert.equal(entries[0].reference, 'aaaaaaaa');
});

// Legacy Airtable rows without a marker are real usage and are listed once.
test('merge lists legacy Airtable rows without a marker, Failed rows as failed', () => {
  const entries = credits.mergeLedgerEntries({
    reservations: [],
    submissions: [],
    uploads: [],
    pipelineRows: [
      { id: 'recOld', fields: { 'Proposal Name': 'Legacy bid', 'Created Date': '2026-09-15', 'Pipeline Status': 'Ready for Review' } },
      { id: 'recBad', fields: { 'Proposal Name': 'Failed bid', 'Created Date': '2026-09-16', 'Pipeline Status': 'Failed' } }
    ],
    period
  });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].label, 'Failed bid');
  assert.equal(entries[0].effect, 'failed');
  assert.equal(entries[0].status, 'Failed — no credit used');
  assert.equal(entries[0].inCurrentPeriod, false);
  assert.equal(entries[1].label, 'Legacy bid');
  assert.equal(entries[1].effect, 'used');
  assert.equal(entries[1].inCurrentPeriod, false);
});

// A marker row with no matching reservation is still one entry, not a duplicate.
test('merge lists a marker row without a reservation once', () => {
  const entries = credits.mergeLedgerEntries({
    reservations: [],
    submissions: [],
    uploads: [],
    pipelineRows: [pipeRow()],
    period
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].label, 'Acme RFP');
  assert.equal(entries[0].effect, 'used');
});

// Every reservation status maps to a distinct credit effect.
test('merge maps reserved, uncertain and released to held, held and released', () => {
  const entries = credits.mergeLedgerEntries({
    reservations: [
      reservation({ submission_id: SUB_A, status: 'reserved', reserved_at: '2026-10-23T10:00:00Z' }),
      reservation({ submission_id: SUB_B, status: 'uncertain', reserved_at: '2026-10-22T10:00:00Z' }),
      { submission_id: 'cccccccc-3333-4333-8333-333333333333', status: 'released', record_id: null, reserved_at: '2026-10-21T10:00:00Z' }
    ],
    submissions: [],
    uploads: [],
    pipelineRows: [],
    period
  });
  assert.deepEqual(entries.map(e => [e.effect, e.status]), [
    ['held', 'Credit held — in progress'],
    ['held', 'Credit held — outcome being verified'],
    ['released', 'Credit released']
  ]);
  assert.deepEqual(entries.map(e => e.date), ['2026-10-23T10:00:00Z', '2026-10-22T10:00:00Z', '2026-10-21T10:00:00Z']);
});

// Entries sort newest first; undated entries sort last; no period means unmarked.
test('merge sorts newest first and leaves the period unmarked without one', () => {
  const entries = credits.mergeLedgerEntries({
    reservations: [
      reservation({ submission_id: SUB_A, reserved_at: null }),
      reservation({ submission_id: SUB_B, reserved_at: '2026-10-22T10:00:00Z' })
    ],
    submissions: [],
    uploads: [],
    pipelineRows: []
  });
  assert.equal(entries[0].reference, 'bbbbbbbb');
  assert.equal(entries[1].reference, 'aaaaaaaa');
  assert.equal(entries[0].inCurrentPeriod, null);
});

test('ledger merges reservations, submissions, uploads and Pipeline rows', async () => {
  const c = company(['recPipe1']);
  settings.airtableRecords = [pipeRow()];
  settings.reservations = [reservation({ record_id: 'recPipe1' })];
  settings.submissions = [submission()];
  settings.uploads = [upload()];
  const r = await credits.ledger(config, c, user, root, headers, 0, now);
  assert.equal(r.total, 1);
  assert.equal(r.hasMore, false);
  assert.equal(r.entries[0].label, 'Acme RFP');
  assert.equal(r.entries[0].effect, 'used');
  assert.equal(r.missingLinkedRecords, undefined);
  assert.ok(calls.every(x => !x.opts.method || x.opts.method === 'GET'));
});

test('ledger reports a deleted linked record instead of failing', async () => {
  const c = company(['recPipe1', 'recDeleted']);
  settings.airtableRecords = [pipeRow()];
  settings.reservations = [reservation({ record_id: 'recPipe1' })];
  settings.submissions = [submission()];
  settings.uploads = [upload()];
  const r = await credits.ledger(config, c, user, root, headers, 0, now);
  assert.equal(r.total, 1);
  assert.equal(r.missingLinkedRecords, 1);
});

test('ledger pages 20 at a time, newest first', async () => {
  const c = company([]);
  settings.airtableRecords = [];
  settings.reservations = Array.from({ length: 21 }, (_, i) => ({
    submission_id: '11111111-1111-4111-8111-' + String(i).padStart(12, '0'),
    status: 'queued', record_id: null, reserved_at: '2026-10-' + String(21 - i).padStart(2, '0') + 'T10:00:00Z'
  }));
  const first = await credits.ledger(config, c, user, root, headers, 0, now);
  assert.equal(first.entries.length, 20);
  assert.equal(first.hasMore, true);
  assert.equal(first.total, 21);
  assert.equal(first.entries[0].date, '2026-10-21T10:00:00Z');
  const second = await credits.ledger(config, c, user, root, headers, 1, now);
  assert.equal(second.entries.length, 1);
  assert.equal(second.hasMore, false);
});

test('ledger rejects an invalid page', async () => {
  const c = company([]);
  await assert.rejects(() => credits.ledger(config, c, user, root, headers, -1, now), e => e.status === 400);
  await assert.rejects(() => credits.ledger(config, c, user, root, headers, 1.5, now), e => e.status === 400);
});

test('ledger stays readable when the plan is inactive or expired', async () => {
  const c = company([]);
  c.fields.Status = 'Canceled';
  settings.airtableRecords = [];
  settings.reservations = [reservation()];
  const r = await credits.ledger(config, c, user, root, headers, 0, now);
  assert.equal(r.total, 1);
  assert.equal(r.entries[0].inCurrentPeriod, null);
});

test('ledger endpoint rejects unsigned requests, bad pages and extra fields', async () => {
  assert.equal((await handler({ httpMethod: 'POST' })).statusCode, 405);
  assert.equal((await handler({ httpMethod: 'GET', queryStringParameters: { email: 'other@example.com' } })).statusCode, 400);
  assert.equal((await handler({ httpMethod: 'GET', queryStringParameters: { page: 'abc' } })).statusCode, 400);
  assert.equal((await handler({ httpMethod: 'GET', queryStringParameters: { page: '1001' } })).statusCode, 400);
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'private';
  assert.equal((await handler({ httpMethod: 'GET', headers: {} })).statusCode, 401);
});

test('ledger endpoint returns the company ledger without leaking company ids', async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'private';
  process.env.AIRTABLE_PAT = 'private';
  const c = company(['recPipe1']);
  c.fields['Billing Period Start'] = new Date(Date.now() - 86400000).toISOString();
  c.fields['Billing Period End'] = new Date(Date.now() + 86400000).toISOString();
  global.fetch = async url => {
    if (url.includes('/auth/v1/user')) return Response.json({ id: user.id, email: 'owner@example.com', email_confirmed_at: '2026-01-01' });
    if (url.includes('tbliWnP6ThqA02G5L')) return Response.json({ records: [c] });
    if (url.includes('tblkL2ct7mYtUTu9S')) return Response.json({ records: [pipeRow()] });
    if (url.includes('/rest/v1/proposal_credit_reservations')) return Response.json([reservation({ record_id: 'recPipe1' })]);
    if (url.includes('/rest/v1/rfp_submissions')) return Response.json([submission()]);
    if (url.includes('/rest/v1/rfp_uploads')) return Response.json([upload()]);
    throw new Error('Unexpected request: ' + url);
  };
  const r = await handler({ httpMethod: 'GET', headers: { authorization: 'Bearer owner' } });
  assert.equal(r.statusCode, 200);
  const body = JSON.parse(r.body);
  assert.equal(body.total, 1);
  assert.equal(body.entries[0].label, 'Acme RFP');
  assert.ok(!r.body.includes(c.id));
  assert.ok(!r.body.includes('private'));
});

test('ledger endpoint with no linked company returns an empty ledger', async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'private';
  process.env.AIRTABLE_PAT = 'private';
  global.fetch = async url => {
    if (url.includes('/auth/v1/user')) return Response.json({ id: user.id, email: 'owner@example.com', email_confirmed_at: '2026-01-01' });
    return Response.json({ records: [] });
  };
  const r = await handler({ httpMethod: 'GET', headers: { authorization: 'Bearer owner' } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(JSON.parse(r.body), { entries: [], page: 0, hasMore: false, total: 0 });
});

// Nov 19, 2026: the AI-preview fail banner read "generate a new preview..
// Saved content is unchanged." (double period) and never showed the stored
// error code. The banner now names the code and strips the label's trailing
// period before the sentence's own period, so no label can double it.
test('job failure banner names the code and never doubles a period', async () => {
  const source = await readFile(path.join(__dirname, '..', 'assets', 'workspace.mjs'), 'utf8');
  const lines = source.split('\n').filter(l =>
    l.startsWith('const JOB_ERROR_LABELS=') ||
    l.startsWith('const jobErrorLabel=') ||
    l.startsWith('const jobFailureMessage='));
  assert.equal(lines.length, 3);
  const jobFailureMessage = new Function(lines.join('\n') + '; return jobFailureMessage;')();
  const noEvidence = jobFailureMessage('Failed', 'draft_no_evidence');
  assert.ok(noEvidence.includes('(draft_no_evidence)'));
  assert.ok(noEvidence.includes('generate a new preview (draft_no_evidence). Saved content is unchanged.'));
  assert.ok(!noEvidence.includes('..'));
  const timeout = jobFailureMessage('Failed', 'draft_timeout');
  assert.ok(timeout.includes('(draft_timeout)'));
  assert.ok(!timeout.includes('..'));
  assert.equal(
    jobFailureMessage('Cancelled', null),
    'Job Cancelled. Saved content is unchanged. Retry is available below.'
  );
});
