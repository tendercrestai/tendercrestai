// Public browser configuration only. Never return service-role or Airtable credentials.
exports.handler = async event => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: { ...headers, Allow: 'GET' }, body: '{}' };
  const url = process.env.SUPABASE_URL || 'https://vfdwaqgfepvoujprtuww.supabase.co';
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_7J1W7gPugOUuVnCWKpS24A_ozYw0KM3';
  if (!/^https:\/\//.test(url) || !/^sb_publishable_[A-Za-z0-9_.-]+$/.test(key)) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'Public evidence configuration is unavailable.' }) };
  }
  return { statusCode: 200, headers, body: JSON.stringify({ url, key, enabled: process.env.EVIDENCE_ENGINE_ENABLED === 'true' }) };
};
