const { test } = require('node:test');
const assert = require('node:assert/strict');
const { entitlement, monthlyPeriod } = require('../netlify/functions/lib/credits');

test('complimentary month-end anchors clamp February without drifting March', () => {
  const origin = '2024-01-31T15:23:45.000Z';
  let period = monthlyPeriod(origin, Date.parse('2024-02-29T15:23:44Z'));
  assert.equal(new Date(period.start).toISOString(), origin);
  assert.equal(new Date(period.end).toISOString(), '2024-02-29T15:23:45.000Z');
  period = monthlyPeriod(origin, Date.parse('2024-02-29T15:23:45Z'));
  assert.equal(new Date(period.start).toISOString(), '2024-02-29T15:23:45.000Z');
  assert.equal(new Date(period.end).toISOString(), '2024-03-31T15:23:45.000Z');
  period = monthlyPeriod(origin, Date.parse('2025-02-28T15:23:45Z'));
  assert.equal(new Date(period.end).toISOString(), '2025-03-31T15:23:45.000Z');
});
test('complimentary accounts retain their plan and receive calendar-month intervals', () => {
  const company = { createdTime: '2026-09-26T07:08:47Z', fields: { Status: 'Active', 'Complimentary Access': true, 'Calculated Tier': 'Growth ($699/mo)' } };
  assert.deepEqual(entitlement(company, Date.parse('2026-10-13T12:00:00Z')), { start: '2026-09-26T07:08:47.000Z', end: '2026-10-26T07:08:47.000Z', quota: 20 });
  assert.deepEqual(entitlement(company, Date.parse('2026-10-26T07:08:47Z')), { start: '2026-10-26T07:08:47.000Z', end: '2026-11-26T07:08:47.000Z', quota: 20 });
});
test('unchecked complimentary access never grants unverified Active accounts', () => {
  assert.throws(() => entitlement({ createdTime: '2026-10-01', fields: { Status: 'Active', 'Calculated Tier': 'Pro ($299/mo)' } }), error => error.status === 503);
});
test('complimentary flag cannot bypass an inactive or linked Stripe subscription', () => {
  const company = { createdTime: '2026-10-01', fields: { Status: 'Canceled', 'Complimentary Access': true, 'Subscription Tier': 'Pro ($299/mo)' } };
  assert.throws(() => entitlement(company), error => error.status === 403);
  company.fields.Status = 'Active'; company.fields['Stripe Subscription ID'] = 'sub_paid';
  assert.throws(() => entitlement(company), error => error.status === 503);
});
test('free trials expire once and cannot renew like complimentary accounts', () => {
  const company = { createdTime: '2026-01-31T12:00:00Z', fields: { Status: 'Trialing', 'Complimentary Access': true } };
  assert.equal(entitlement(company, Date.parse('2026-02-01')).quota, 60);
  assert.throws(() => entitlement(company, Date.parse('2026-03-03')), error => error.status === 403);
});
test('14-day Stripe trials use the selected plan allowance and expire exactly at the end', () => {
  for (const [tier,quota] of [['Pro ($299/mo)',5],['Growth ($699/mo)',20],['Enterprise ($1,299/mo)',60]]) {
    const company={createdTime:'2026-10-01T00:00:00Z',fields:{Status:'Trialing','Stripe Subscription ID':'sub_trial','Subscription Tier':tier,'Billing Period Start':'2026-10-01T00:00:00Z','Billing Period End':'2026-10-15T00:00:00Z'}};
    assert.equal(entitlement(company,Date.parse('2026-10-01T00:00:00Z')).quota,quota);
    assert.equal(entitlement(company,Date.parse('2026-10-14T23:59:59Z')).quota,quota);
    assert.throws(()=>entitlement(company,Date.parse('2026-10-15T00:00:00Z')),e=>e.status===403);
    assert.throws(()=>entitlement(company,Date.parse('2026-09-30T23:59:59Z')),e=>e.status===403);
  }
});
test('legacy unlinked free Enterprise trials retain their original allowance and expiry without renewal', () => {
  const company={createdTime:'2026-10-01T00:00:00Z',fields:{Status:'Trialing','Subscription Tier':'Enterprise ($1,299/mo)','Billing Period Start':'2026-10-01T00:00:00Z','Billing Period End':'2026-10-31T00:00:00Z'}};
  assert.equal(entitlement(company,Date.parse('2026-10-30T23:59:59Z')).quota,60);
  assert.throws(()=>entitlement(company,Date.parse('2026-10-31T00:00:00Z')),e=>e.status===403);
});
test('a linked Stripe trial never falls back to the legacy Enterprise allowance for an unknown tier', () => {
  const company={fields:{Status:'Trialing','Stripe Subscription ID':'sub_trial','Billing Period Start':'2026-10-01','Billing Period End':'2026-10-15','Subscription Tier':'Unknown'}};
  assert.throws(()=>entitlement(company,Date.parse('2026-10-02')),e=>e.status===503);
});
