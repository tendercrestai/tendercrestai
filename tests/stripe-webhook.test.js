const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { handler } = require('../netlify/functions/stripe-webhook');
const originalFetch = global.fetch;
let env, sub, writes, settings;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

function event(type = 'invoice.paid', object = { parent: { subscription_details: { subscription: 'sub_current' } } }) {
  const body = JSON.stringify({ type, livemode: true, data: { object } });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(timestamp + '.' + body).digest('hex');
  return { httpMethod: 'POST', body, headers: { 'stripe-signature': 't=' + timestamp + ',v1=' + signature } };
}
beforeEach(() => {
  env = { ...process.env };
  Object.assign(process.env, { STRIPE_WEBHOOK_SECRET: 'test-signing', STRIPE_READ_KEY: 'test-read', AIRTABLE_PAT: 'test-airtable' });
  writes = []; settings = {};
  sub = { id: 'sub_current', customer: 'cus_current', livemode: true, status: 'active', items: { data: [{ quantity: 1, price: { id: 'price_1UJqs7FinOspVJZ4xHjda0xZ' }, current_period_start: 1790812800, current_period_end: 1793491200 }] }, latest_invoice: { status: 'paid', status_transitions: { paid_at: 1790812830 } } };
  global.fetch = async (url, options = {}) => {
    const route = new URL(url);
    if (route.pathname === '/v1/subscriptions/sub_old') return json({ status: settings.oldStatus || 'canceled' });
    if (route.pathname === '/v1/subscriptions/sub_current') return json(sub);
    if (route.pathname === '/v1/customers/cus_current') return json({ email: 'owner@example.com', name: 'Example' });
    if (route.pathname === '/v1/subscriptions') return json({ has_more: false, data: settings.multiple ? [sub, sub] : [sub] });
    if (route.hostname === 'api.airtable.com') {
      if (options.method === 'PATCH') { writes.push(JSON.parse(options.body)); return json({}, settings.writeFail ? 503 : 200); }
      return json({ records: settings.ambiguous ? [{ id: 'recA', fields: {} }, { id: 'recB', fields: {} }] : [{ id: 'recCompany', fields: { 'Stripe Customer ID': 'cus_current', 'Stripe Subscription ID': settings.old ? 'sub_old' : 'sub_current' } }] });
    }
    throw new Error('Unexpected request: ' + url);
  };
});
afterEach(() => { global.fetch = originalFetch; process.env = env; });

test('renewal persists exact Stripe period boundaries, including a 31-day month', async () => {
  assert.equal((await handler(event())).statusCode, 200);
  const fields = writes[0].records[0].fields;
  assert.equal(fields['Billing Period Start'], '2026-10-01T00:00:00.000Z');
  assert.equal(fields['Billing Period End'], '2026-11-01T00:00:00.000Z');
  assert.equal(fields.Status, 'Active');
  assert.equal(fields['Subscription Tier'], 'Pro ($299/mo)');
});
test('duplicate renewal deliveries do not clear usage or create another company', async () => {
  await handler(event()); await handler(event());
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(writes[0].records[0].id, 'recCompany');
  assert.ok(!('Usage This Cycle' in writes[0].records[0].fields));
});
test('failed payments and cancellations revoke eligibility using current Stripe state', async () => {
  sub.status = 'past_due'; sub.latest_invoice.status = 'open';
  await handler(event('invoice.payment_failed'));
  assert.equal(writes[0].records[0].fields.Status, 'Past Due');
  sub.status = 'canceled';
  await handler(event('customer.subscription.deleted', { id: 'sub_current' }));
  assert.equal(writes[1].records[0].fields.Status, 'Canceled');
});
test('an old invoice event cannot reactivate a currently canceled subscription', async () => {
  sub.status = 'canceled';
  await handler(event());
  assert.equal(writes[0].records[0].fields.Status, 'Canceled');
});
test('missing periods, ambiguous accounts and multiple active subscriptions fail closed', async () => {
  delete sub.items.data[0].current_period_end;
  assert.equal((await handler(event())).statusCode, 503);
  sub.items.data[0].current_period_end = 1793491200;
  settings.ambiguous = true;
  assert.equal((await handler(event())).statusCode, 503);
  settings.ambiguous = false; settings.multiple = true;
  assert.equal((await handler(event())).statusCode, 503);
  assert.equal(writes.length, 0);
});
test('a canceled subscription can be replaced, and delayed old events cannot cancel it', async () => {
  settings.old = true;
  assert.equal((await handler(event())).statusCode, 200);
  assert.equal(writes[0].records[0].fields['Stripe Subscription ID'], 'sub_current');
  sub.status = 'canceled';
  assert.equal((await handler(event())).statusCode, 200);
  assert.equal(writes.length, 1);
});
test('invalid signatures and failed Airtable writes are not acknowledged', async () => {
  const unsigned = event(); unsigned.headers = {};
  assert.equal((await handler(unsigned)).statusCode, 400);
  settings.writeFail = true;
  assert.equal((await handler(event())).statusCode, 503);
});
