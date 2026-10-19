const { test } = require('node:test');
const assert = require('node:assert/strict');
const { handler } = require('../netlify/functions/evidence-config');
test('public configuration follows deployment settings and never returns private keys', async () => {
  const previous = { ...process.env };
  try {
    process.env.SUPABASE_URL = 'https://preview.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_preview';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'private-service';
    process.env.AIRTABLE_PAT = 'private-airtable';
    process.env.EVIDENCE_ENGINE_ENABLED = 'true';
    const response = await handler({ httpMethod: 'GET' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { url: 'https://preview.supabase.co', key: 'sb_publishable_preview', enabled: true });
    assert.equal(response.headers['Cache-Control'], 'no-store');
    process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_secret_do-not-expose';
    assert.equal((await handler({ httpMethod: 'GET' })).statusCode, 503);
    assert.equal((await handler({ httpMethod: 'POST' })).statusCode, 405);
  } finally { process.env = previous; }
});
