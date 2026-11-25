const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../netlify/functions/lib/proposal-core');
const exp = require('../netlify/functions/lib/proposal-export');

test('grant projects carry the marker and start with an empty budget', () => {
  const grant = core.initial('Grant X', 'Org', true);
  assert.equal(grant.grant, true);
  assert.deepEqual(grant.budget, { rows: [], narrative: '' });
  assert.equal(core.initial('RFP X', 'Org').grant, false);
  assert.equal(core.initial('RFP X', 'Org', 'yes').grant, false);
});

test('budget action caps rows and amounts and stores who saved it', () => {
  const state = core.initial('Grant X', 'Org', true);
  const next = core.apply(state, 'budget', { rows: [{ item: 'Staff time', amount: 1200, note: 'Lead writer' }], narrative: 'Direct costs only.' }, 'user-1', {});
  assert.equal(next.budget.rows.length, 1);
  assert.equal(next.budget.rows[0].amount, 1200);
  assert.equal(next.budget.narrative, 'Direct costs only.');
  assert.equal(next.budget.updatedBy, 'user-1');
  assert.throws(() => core.apply(state, 'budget', { rows: [{ item: 'Bad', amount: -1 }], narrative: '' }, 'user-1', {}), e => e.status === 400);
  assert.throws(() => core.apply(state, 'budget', { rows: Array.from({ length: 51 }, () => ({ item: 'x', amount: 1 })), narrative: '' }, 'user-1', {}), e => e.status === 400);
  assert.throws(() => core.apply(state, 'budget', { rows: [{ item: 'x'.repeat(201), amount: 1 }], narrative: '' }, 'user-1', {}), e => e.status === 400);
});

test('settings action toggles the grant marker and rejects a non-boolean value', () => {
  const state = core.initial('Grant X', 'Org', true);
  assert.equal(core.apply(state, 'settings', { title: 'Grant X', company: 'Org', grant: false }, 'user-1', {}).grant, false);
  assert.throws(() => core.apply(state, 'settings', { title: 'Grant X', company: 'Org', grant: 'yes' }, 'user-1', {}), e => e.status === 400);
});

test('readiness report for a grant project discloses AI use, eligibility and submission guidance', () => {
  const state = core.initial('Grant X', 'Org', true);
  state.sections = [{ id: 's1', title: 'Need', text: 'Drafted text', status: 'draft', unverified: true }];
  state.requirements = [{ id: 'r1', text: 'Applicants must be nonprofits.', category: 'Eligibility', status: 'Needs Review' }];
  state.analysis = { facts: [{ type: 'Eligibility', value: 'Eligible applicants: nonprofit organizations.' }] };
  const report = exp.readinessReportText({ id: 'p1', revision: 1, state });
  assert.match(report, /AI-USE DISCLOSURE/);
  assert.match(report, /Customer data is not used to train a shared model/);
  assert.match(report, /ELIGIBILITY CHECK/);
  assert.match(report, /nonprofit organizations/);
  assert.match(report, /TenderCrest does not submit for you/);
  assert.match(report, /Grants\.gov Workspace/);
  const rfp = exp.readinessReportText({ id: 'p2', revision: 1, state: core.initial('RFP X', 'Org') });
  assert.ok(!rfp.includes('ELIGIBILITY CHECK'));
  assert.ok(!rfp.includes('does not submit for you'));
});
