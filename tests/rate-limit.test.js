// Per-instance admission buckets for the OAuth and MCP endpoints.
// No network or database is touched: the buckets live in memory.
const { test } = require('node:test'), assert = require('node:assert/strict');
const rateLimit = require('../netlify/functions/lib/rate-limit');

process.env.SUPABASE_URL = 'https://database.invalid';
process.env.SUPABASE_PUBLISHABLE_KEY = 'fixture-publishable-key';

const event = (ip) => ({ headers: ip === undefined ? {} : { 'x-nf-client-connection-ip': ip } });

test('admit allows up to the limit, then answers 429', () => {
  rateLimit.reset();
  const ev = event('192.0.2.10');
  for (let i = 0; i < 3; i++) rateLimit.admit(ev, 'test-kind', 3, 60 * 1000);
  assert.throws(() => rateLimit.admit(ev, 'test-kind', 3, 60 * 1000), (e) => e.status === 429 && /Too many requests/.test(e.message));
});

test('budgets are separate per kind and per client', () => {
  rateLimit.reset();
  const a = event('192.0.2.11'), b = event('192.0.2.12');
  for (let i = 0; i < 2; i++) rateLimit.admit(a, 'kind-a', 2, 60 * 1000);
  assert.throws(() => rateLimit.admit(a, 'kind-a', 2, 60 * 1000), (e) => e.status === 429);
  rateLimit.admit(a, 'kind-b', 2, 60 * 1000);
  rateLimit.admit(b, 'kind-a', 2, 60 * 1000);
});

test('a fresh window resets the count', async () => {
  rateLimit.reset();
  const ev = event('192.0.2.13');
  rateLimit.admit(ev, 'window-kind', 1, 10);
  assert.throws(() => rateLimit.admit(ev, 'window-kind', 1, 10), (e) => e.status === 429);
  await new Promise((resolve) => setTimeout(resolve, 15));
  rateLimit.admit(ev, 'window-kind', 1, 10);
});

test('a missing or malformed client IP cannot be admitted', () => {
  rateLimit.reset();
  assert.throws(() => rateLimit.admit(event(undefined), 'test-kind', 3, 60 * 1000), (e) => e.status === 400);
  assert.throws(() => rateLimit.admit(event('not an ip'), 'test-kind', 3, 60 * 1000), (e) => e.status === 400);
});
