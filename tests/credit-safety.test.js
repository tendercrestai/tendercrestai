const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const credits = require('../netlify/functions/lib/credits');

const now = Date.parse('2026-10-25T12:00:00Z');
const SUBMISSION = '44444444-4444-4444-8444-444444444444';
let originalFetch;
let settings;
let calls;

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

beforeEach(() => {
  originalFetch = global.fetch;
  settings = { airtableRecords: [], reservations: [], reservation: null, releaseDown: false };
  calls = [];
  credits.clearUsageCache();
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.includes('/rest/v1/proposal_credit_reservations')) {
      if (url.includes('submission_id=eq.')) return Response.json(settings.reservation ? [settings.reservation] : []);
      return Response.json(settings.reservations);
    }
    if (url.includes('release_uncertain_credit')) {
      if (settings.releaseDown) return new Response('{}', { status: 503 });
      return Response.json({ ok: true, released: true });
    }
    if (url.includes('api.airtable.com')) return Response.json({ records: settings.airtableRecords });
    if (url.includes('/rest/v1/')) return Response.json(settings.reservations);
    throw new Error('Unexpected request: ' + url);
  };
});

afterEach(() => { global.fetch = originalFetch; });

// F8: a deleted linked Airtable record no longer breaks the usage page.
test('missing linked records are counted as existing only, with a review flag and no 503', async () => {
  const c = company(['recPresent', 'recDeleted']);
  settings.airtableRecords = [{ id: 'recPresent', fields: { 'Created Date': '2026-10-21', 'Pipeline Status': 'Ready for Review' } }];
  settings.reservations = [{ submission_id: 'held', status: 'reserved' }];
  const r = await credits.summary(config, c, root, headers, now);
  assert.equal(r.used, 2);
  assert.equal(r.remaining, 18);
  assert.equal(r.missingLinkedRecords, 1);
});

test('history dedupes repeated rows and ignores rows outside the linked list', async () => {
  const c = company(['recPresent']);
  settings.airtableRecords = [
    { id: 'recPresent', fields: { 'Created Date': '2026-10-21', 'Pipeline Status': 'Ready for Review' } },
    { id: 'recPresent', fields: { 'Created Date': '2026-10-21', 'Pipeline Status': 'Ready for Review' } },
    { id: 'recStray', fields: { 'Created Date': '2026-10-21', 'Pipeline Status': 'Ready for Review' } }
  ];
  settings.reservations = [];
  const r = await credits.summary(config, c, root, headers, now);
  assert.equal(r.used, 1);
  assert.equal(r.missingLinkedRecords, undefined);
});

// F8: quota math is unchanged — Failed / Quota Exceeded rows count 0.
test('Failed and Quota Exceeded rows still count 0 after the tolerance change', async () => {
  const c = company(['recFailed', 'recExceeded', 'recOk']);
  settings.airtableRecords = [
    { id: 'recFailed', fields: { 'Credit Reservation ID': 'f1', 'Pipeline Status': 'Failed', 'Created Date': '2026-10-21' } },
    { id: 'recExceeded', fields: { 'Credit Reservation ID': 'f2', 'Pipeline Status': 'Quota Exceeded', 'Created Date': '2026-10-21' } },
    { id: 'recOk', fields: { 'Created Date': '2026-10-21', 'Pipeline Status': 'Ready for Review' } }
  ];
  settings.reservations = [
    { submission_id: 'f1', record_id: 'recFailed', status: 'queued' },
    { submission_id: 'f2', record_id: 'recExceeded', status: 'queued' },
    { submission_id: 'held', status: 'reserved' }
  ];
  const r = await credits.summary(config, c, root, headers, now);
  assert.equal(r.used, 2);
  assert.equal(r.remaining, 18);
  assert.equal(r.missingLinkedRecords, undefined);
});

// F8: repeated usage-page loads are bounded by a brief summary cache.
test('summary caches a computed balance briefly instead of re-reading Airtable on every load', async () => {
  const c = company(['recPresent']);
  settings.airtableRecords = [{ id: 'recPresent', fields: { 'Created Date': '2026-10-21', 'Pipeline Status': 'Ready for Review' } }];
  settings.reservations = [];
  const first = await credits.summary(config, c, root, headers, now);
  const callsAfterFirst = calls.length;
  assert.ok(callsAfterFirst > 0);
  const second = await credits.summary(config, c, root, headers, now);
  assert.deepEqual(second, first);
  assert.equal(calls.length, callsAfterFirst);
});

// F2: release the uncertain credit when the Airtable record is absent.
test('reconcileUncertain releases the credit when no Airtable record carries the marker', async () => {
  settings.reservation = { submission_id: SUBMISSION, company_id: 'recCompany', status: 'uncertain', record_id: null };
  settings.airtableRecords = [];
  const result = await credits.reconcileUncertain(config, SUBMISSION, root, headers);
  assert.deepEqual(result, { released: true });
  assert.ok(calls.some(call => call.url.includes('release_uncertain_credit')));
});

// F2: never release when the Airtable record exists.
test('reconcileUncertain keeps the credit when the Airtable record exists', async () => {
  settings.reservation = { submission_id: SUBMISSION, company_id: 'recCompany', status: 'uncertain', record_id: null };
  settings.airtableRecords = [{ id: 'recProposal', fields: { 'Credit Reservation ID': SUBMISSION, 'Pipeline Status': 'Uploaded' } }];
  const result = await credits.reconcileUncertain(config, SUBMISSION, root, headers);
  assert.equal(result.released, false);
  assert.equal(result.recordExists, true);
  assert.equal(result.recordId, 'recProposal');
  assert.ok(!calls.some(call => call.url.includes('release_uncertain_credit')));
});

// F2: a reservation that already carries a record id is never released.
test('reconcileUncertain never releases a reservation whose record id is set', async () => {
  settings.reservation = { submission_id: SUBMISSION, company_id: 'recCompany', status: 'uncertain', record_id: 'recProposal' };
  const result = await credits.reconcileUncertain(config, SUBMISSION, root, headers);
  assert.equal(result.released, false);
  assert.equal(result.recordExists, true);
  assert.ok(!calls.some(call => call.url.includes('release_uncertain_credit')));
  assert.ok(!calls.some(call => call.url.includes('api.airtable.com')));
});

// F2: safe degradation when the migration is not applied yet.
test('reconcileUncertain degrades safely when the release RPC is unavailable', async () => {
  settings.reservation = { submission_id: SUBMISSION, company_id: 'recCompany', status: 'uncertain', record_id: null };
  settings.airtableRecords = [];
  settings.releaseDown = true;
  const result = await credits.reconcileUncertain(config, SUBMISSION, root, headers);
  assert.equal(result.released, false);
  assert.equal(result.reason, 'release-unavailable');
});

// F2: non-uncertain reservations are left alone.
test('reconcileUncertain leaves a queued reservation alone', async () => {
  settings.reservation = { submission_id: SUBMISSION, company_id: 'recCompany', status: 'queued', record_id: 'recProposal' };
  const result = await credits.reconcileUncertain(config, SUBMISSION, root, headers);
  assert.equal(result.released, false);
  assert.equal(result.reason, 'not-uncertain');
  assert.ok(!calls.some(call => call.url.includes('api.airtable.com')));
  assert.ok(!calls.some(call => call.url.includes('release_uncertain_credit')));
});
