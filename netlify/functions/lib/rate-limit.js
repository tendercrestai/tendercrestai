// Small per-instance admission buckets for the OAuth and MCP endpoints.
// Netlify Functions are stateless and scale out, so this is defense in depth,
// not a hard global limit: each warm instance holds its own buckets and a cold
// start wipes them. (The free tools use the DB-backed ft_admit RPC instead;
// these endpoints use this helper so no Supabase migration is needed to ship
// it. A DB-backed limiter is the follow-up if abuse ever becomes real.)
// The client IP is hashed, never stored raw.
const crypto = require('node:crypto');
const kb = require('./knowledge-base');

const buckets = new Map();

function clientKey(event) {
  const v = event.headers?.['x-nf-client-connection-ip'];
  if (typeof v !== 'string' || !/^[a-fA-F0-9:.]{1,100}$/.test(v)) kb.fail(400, 'Request could not be admitted.');
  return crypto.createHash('sha256').update(v).digest('hex');
}

// Admit one request from this client for `kind`. Throws 429 past `limit`
// requests inside a `windowMs` window. Buckets are keyed by kind + hashed IP,
// so different endpoints and different clients never share a budget.
function admit(event, kind, limit, windowMs) {
  const now = Date.now();
  const key = kind + ':' + clientKey(event);
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.start >= windowMs) bucket = { start: now, count: 0 };
  bucket.count += 1;
  buckets.set(key, bucket);
  if (buckets.size > 10000) {
    for (const [k, b] of buckets) if (now - b.start >= windowMs) buckets.delete(k);
  }
  if (bucket.count > limit) kb.fail(429, 'Too many requests. Try again in a few minutes.');
}

function reset() { buckets.clear(); }

module.exports = { admit, reset };
