// MCP server tests: protocol handshake, tools/list, free tool calls through
// the real site handlers, auth gating, rate-limit admission, and the OAuth
// endpoints. No network, database, or provider is touched: fetch and the
// Supabase RPC helper are stubbed per test, following free-tools.test.js.
const { test } = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const kb = require('../netlify/functions/lib/knowledge-base');
const mcp = require('../netlify/functions/mcp');
const mcpAuth = require('../netlify/functions/mcp-auth');
const mcpAuthLib = require('../netlify/functions/lib/mcp-auth');
const { TOOL_DEFINITIONS } = require('../netlify/functions/lib/mcp-tools');

process.env.SUPABASE_URL = 'https://database.invalid';
process.env.SUPABASE_PUBLISHABLE_KEY = 'fixture-publishable-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-service-key';
process.env.FREE_TOOLS_ENABLED = 'true';
process.env.KB_ENABLED = 'true';
process.env.PROPOSAL_WORKSPACE_ENABLED = 'true';
process.env.ANALYTICS_SIGNING_SECRET = 'test-only-signing-secret-at-least-32-characters';
process.env.KB_WORKER_SECRET = 'test-only-worker-secret-at-least-32-characters';
process.env.SAM_GOV_API_KEY = 'fixture-sam-key';
process.env.URL = 'https://www.tendercrestai.com';
process.env.MCP_OAUTH_SIGNING_SECRET = 'test-only-oauth-secret-at-least-32-characters';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '22222222-2222-4222-8222-222222222222';
const USER = { id: USER_ID, email: 'owner@example.invalid', email_confirmed_at: new Date().toISOString() };

function event(message, headers = {}) {
  return { httpMethod: 'POST', headers: { 'x-nf-client-connection-ip': '192.0.2.1', ...headers }, body: JSON.stringify(message) };
}
function initialize(version = '2025-06-18') {
  return { jsonrpc: '2.0', id: 'init-1', method: 'initialize', params: { protocolVersion: version, capabilities: {}, clientInfo: { name: 'test-client', version: '0' } } };
}
async function rpc(handler, message, headers) {
  const response = await handler(event(message, headers));
  return { response, body: response.body ? JSON.parse(response.body) : null };
}

test('initialize negotiates the client protocol version and describes the server', async () => {
  const { response, body } = await rpc(mcp.handler, initialize('2025-06-18'));
  assert.equal(response.statusCode, 200);
  assert.equal(body.result.protocolVersion, '2025-06-18');
  assert.equal(body.result.serverInfo.name, 'tendercrest-mcp');
  assert.equal(body.result.capabilities.tools.listChanged, false);
  assert.match(body.result.instructions, /human review/);
  const older = await rpc(mcp.handler, initialize('2025-03-26'));
  assert.equal(older.body.result.protocolVersion, '2025-03-26');
  const unknown = await rpc(mcp.handler, initialize('1999-01-01'));
  assert.equal(unknown.body.result.protocolVersion, '2025-06-18');
});

test('ping, notifications, and unknown methods follow JSON-RPC shape', async () => {
  const ping = await rpc(mcp.handler, { jsonrpc: '2.0', id: 1, method: 'ping' });
  assert.deepEqual(ping.body.result, {});
  const notification = await mcp.handler(event({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  assert.equal(notification.statusCode, 202);
  assert.equal(notification.body, '');
  const unknown = await rpc(mcp.handler, { jsonrpc: '2.0', id: 2, method: 'resources/list' });
  assert.equal(unknown.body.error.code, -32601);
  const bad = await mcp.handler({ httpMethod: 'POST', headers: {}, body: '{not json' });
  assert.equal(JSON.parse(bad.body).error.code, -32700);
  const batch = await mcp.handler({ httpMethod: 'POST', headers: {}, body: '[]' });
  assert.equal(JSON.parse(batch.body).error.code, -32600);
  const get = await mcp.handler({ httpMethod: 'GET', headers: {}, body: '' });
  assert.equal(get.statusCode, 405);
});

test('tools/list exposes the free and account tools with honest limits', async () => {
  const { body } = await rpc(mcp.handler, { jsonrpc: '2.0', id: 3, method: 'tools/list' });
  assert.equal(body.result.tools.length, TOOL_DEFINITIONS.length);
  const names = body.result.tools.map((t) => t.name);
  for (const name of ['shred_rfp', 'get_shred_result', 'check_bid_fit', 'get_bid_check_result', 'search_opportunities', 'get_opportunity', 'list_organizations', 'list_evidence', 'read_evidence_source', 'search_evidence', 'list_proposals', 'read_proposal', 'list_proposal_records', 'get_proposal_revision']) assert.ok(names.includes(name), name);
  for (const tool of body.result.tools) {
    assert.equal(typeof tool.description, 'string');
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.requiresAuth, undefined, 'requiresAuth is internal and must not leak into tools/list');
  }
  assert.match(body.result.tools.find((t) => t.name === 'shred_rfp').description, /human review/);
  assert.match(body.result.tools.find((t) => t.name === 'check_bid_fit').description, /never a win prediction/);
});

test('free tool call searches SAM.gov through the real handler and counts against the same admission limit', async () => {
  const saved = { fetch: global.fetch, rpc: kb.rpc };
  const admissions = [];
  kb.rpc = async (config, name, args) => { if (name === 'ft_admit') admissions.push(args); return null; };
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/rest/v1/ft_cache')) return new Response('[]', { status: 200 });
    if (u.includes('api.sam.gov')) return new Response(JSON.stringify({ opportunitiesData: [{ noticeId: 'a'.repeat(32), title: 'Fixture generator notice', active: 'Yes' }], totalRecords: 1 }), { status: 200 });
    throw new Error('Unexpected fetch ' + u);
  };
  try {
    const { response, body } = await rpc(mcp.handler, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'search_opportunities', arguments: { keyword: 'generator' } } });
    assert.equal(response.statusCode, 200);
    assert.equal(body.error, undefined);
    const text = body.result.content[0].text;
    assert.match(text, /Fixture generator notice/);
    assert.equal(admissions.length, 1);
    assert.equal(admissions[0].p_kind, 'sam');
    assert.equal(admissions[0].p_limit, 10);
    assert.equal(admissions[0].p_global, 50);
  } finally { global.fetch = saved.fetch; kb.rpc = saved.rpc; }
});

test('free tool call starts a shred through the real handler and counts against the 3-per-day limit', async () => {
  const saved = { fetch: global.fetch, rpc: kb.rpc };
  const admissions = [];
  kb.rpc = async (config, name, args) => { if (name === 'ft_admit') admissions.push(args); return null; };
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('free-tools-worker-background')) return new Response('', { status: 202 });
    if (u.includes('database.invalid')) return new Response('[]', { status: 200 });
    throw new Error('Unexpected fetch ' + u);
  };
  try {
    const text = 'SECTION C REQUIREMENTS\nThe contractor shall provide weekly reports.\nThe contractor must retain records for seven years.';
    const { response, body } = await rpc(mcp.handler, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'shred_rfp', arguments: { text, title: 'Fixture solicitation', source: 'Test only', processingConsent: true } } });
    assert.equal(response.statusCode, 200);
    const parsed = JSON.parse(body.result.content[0].text);
    assert.equal(parsed.status, 'Pending');
    assert.match(parsed.token, /^[0-9a-f-]+\.[a-f0-9]{64}$/);
    assert.equal(admissions.length, 1);
    assert.equal(admissions[0].p_kind, 'shred');
    assert.equal(admissions[0].p_limit, 3);
  } finally { global.fetch = saved.fetch; kb.rpc = saved.rpc; }
});

test('bid check tool starts through the real handler with the five answers validated', async () => {
  const saved = { fetch: global.fetch, rpc: kb.rpc };
  kb.rpc = async () => null;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('free-tools-worker-background')) return new Response('', { status: 202 });
    if (u.includes('database.invalid')) return new Response('[]', { status: 200 });
    throw new Error('Unexpected fetch ' + u);
  };
  try {
    const call = { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'check_bid_fit', arguments: { text: 'SECTION C REQUIREMENTS\nThe contractor shall provide weekly reports.\nThe contractor must retain records for seven years.', title: 'Fixture bid', source: 'Test only', processingConsent: true, answers: { deadline: '2027-01-15', hours: 60, eligibility: 'yes', performance: 'similar', evidence: 'most' } } } };
    const { body } = await rpc(mcp.handler, call);
    const parsed = JSON.parse(body.result.content[0].text);
    assert.equal(parsed.status, 'Pending');
    assert.ok(parsed.token);
    const bad = await rpc(mcp.handler, { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'check_bid_fit', arguments: { text: 'x'.repeat(50), title: 'Bad', source: 'Test', processingConsent: true, answers: { deadline: 'not-a-date', hours: 1, eligibility: 'yes', performance: 'similar', evidence: 'most' } } } });
    assert.equal(bad.body.result.isError, true);
    assert.match(bad.body.result.content[0].text, /deadline/);
  } finally { global.fetch = saved.fetch; kb.rpc = saved.rpc; }
});

test('account tool without a token is rejected with 401 and never reaches the handler', async () => {
  let reached = false;
  const handler = mcp.createHandler({ tools: { knowledge: async () => { reached = true; return { statusCode: 200, body: '{}' }; } } });
  const { response, body } = await rpc(handler, { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'list_evidence', arguments: { orgId: ORG_ID } } });
  assert.equal(response.statusCode, 401);
  assert.equal(body.error.code, -32001);
  assert.match(body.error.message, /Sign in/);
  assert.equal(reached, false);
});

test('a presented Bearer token that does not verify is rejected before any tool runs', async () => {
  const saved = { fetch: global.fetch };
  global.fetch = async (url) => {
    if (String(url).includes('/auth/v1/user')) return new Response('{}', { status: 401 });
    throw new Error('Unexpected fetch ' + url);
  };
  try {
    const { response, body } = await rpc(mcp.handler, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'search_opportunities', arguments: {} } }, { authorization: 'Bearer invalid-token' });
    assert.equal(response.statusCode, 401);
    assert.match(body.error, /session has expired|log in/i);
  } finally { global.fetch = saved.fetch; }
});

test('a verified Bearer token reaches the account tool through the real verification path', async () => {
  const saved = { fetch: global.fetch };
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/auth/v1/user')) return new Response(JSON.stringify(USER), { status: 200 });
    if (u.includes('kb_memberships')) return new Response(JSON.stringify([{ org_id: ORG_ID, role: 'owner', kb_organizations: { id: ORG_ID, name: 'Fixture Org' } }]), { status: 200 });
    throw new Error('Unexpected fetch ' + u);
  };
  try {
    const { response, body } = await rpc(mcp.handler, { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'list_organizations', arguments: {} } }, { authorization: 'Bearer fixture-access-token' });
    assert.equal(response.statusCode, 200);
    assert.match(body.result.content[0].text, /Fixture Org/);
  } finally { global.fetch = saved.fetch; }
});

test('OAuth metadata needs the signing secret and describes the endpoints when configured', async () => {
  const meta = { httpMethod: 'GET', path: '/.well-known/oauth-authorization-server', headers: {}, body: '' };
  const ok = await mcpAuth.handler(meta);
  assert.equal(ok.statusCode, 200);
  const body = JSON.parse(ok.body);
  assert.equal(body.issuer, 'https://www.tendercrestai.com');
  assert.equal(body.authorization_endpoint, 'https://www.tendercrestai.com/oauth/authorize');
  assert.equal(body.token_endpoint, 'https://www.tendercrestai.com/oauth/token');
  assert.deepEqual(body.code_challenge_methods_supported, ['S256']);
  assert.deepEqual(body.grant_types_supported, ['authorization_code', 'refresh_token']);
  delete process.env.MCP_OAUTH_SIGNING_SECRET;
  try {
    const missing = await mcpAuth.handler(meta);
    assert.equal(missing.statusCode, 503);
    assert.match(JSON.parse(missing.body).error, /not configured/);
  } finally { process.env.MCP_OAUTH_SIGNING_SECRET = 'test-only-oauth-secret-at-least-32-characters'; }
});

test('dynamic client registration validates redirect URIs', async () => {
  const register = (redirect_uris) => mcpAuth.handler({ httpMethod: 'POST', path: '/oauth/register', headers: {}, body: JSON.stringify({ redirect_uris }) });
  const bad = await register(['https://evil.invalid/cb', 'javascript:alert(1)']);
  assert.equal(bad.statusCode, 400);
  const loopback = await register(['http://127.0.0.1:54321/callback']);
  assert.equal(loopback.statusCode, 201);
  assert.match(JSON.parse(loopback.body).client_id, /^[0-9a-f-]{36}$/);
  assert.equal(JSON.parse(loopback.body).token_endpoint_auth_method, 'none');
});

test('authorize page requires valid OAuth params and PKCE challenge', async () => {
  const base = { client_id: 'test-client', redirect_uri: 'https://client.example.invalid/callback', code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', code_challenge_method: 'S256', state: 'xyz' };
  const page = await mcpAuth.handler({ httpMethod: 'GET', path: '/oauth/authorize', queryStringParameters: { response_type: 'code', ...base }, headers: {}, body: '' });
  assert.equal(page.statusCode, 200);
  assert.match(page.headers['Content-Type'], /text\/html/);
  assert.match(page.body, /Connect TenderCrest AI/);
  assert.match(page.body, /test-client/);
  const bad = await mcpAuth.handler({ httpMethod: 'GET', path: '/oauth/authorize', queryStringParameters: { response_type: 'code', ...base, code_challenge_method: 'plain' }, headers: {}, body: '' });
  assert.equal(bad.statusCode, 400);
});

test('authorization codes are opaque, bound, and expire; PKCE is enforced at the token endpoint', async () => {
  const challenge = mcpAuthLib.pkceChallenge('fixture-verifier-0123456789-abcdefghijklmnopqrstuvwxyz');
  assert.equal(challenge.length, 43);
  const code = mcpAuthLib.issueCode({ userId: USER_ID, clientId: 'test-client', redirectUri: 'https://client.example.invalid/callback', codeChallenge: challenge, refreshToken: 'fixture-refresh-token' });
  const payload = mcpAuthLib.decryptCode(code);
  assert.equal(payload.userId, USER_ID);
  assert.equal(payload.refreshToken, 'fixture-refresh-token');
  assert.ok(!code.includes('fixture-refresh-token'), 'the refresh token must not be readable in the code');
  assert.throws(() => mcpAuthLib.decryptCode(code.slice(0, -4) + 'AAAA'), (e) => e.status === 400);
  const expired = mcpAuthLib.encryptCode({ type: 'mcp_auth_code', userId: USER_ID, clientId: 'test-client', redirectUri: 'https://client.example.invalid/callback', codeChallenge: challenge, refreshToken: 'fixture-refresh-token', exp: Date.now() - 1000 });
  const saved = { fetch: global.fetch };
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/auth/v1/token')) return new Response(JSON.stringify({ access_token: 'new-access-token', refresh_token: 'new-refresh-token', expires_in: 3600 }), { status: 200 });
    throw new Error('Unexpected fetch ' + u);
  };
  try {
    const tokenCall = (body) => mcpAuth.handler({ httpMethod: 'POST', path: '/oauth/token', headers: {}, body: JSON.stringify(body) });
    const wrongVerifier = await tokenCall({ grant_type: 'authorization_code', code, redirect_uri: 'https://client.example.invalid/callback', client_id: 'test-client', code_verifier: 'wrong-verifier-0123456789-abcdefghijklmnopqrstuvwxyz' });
    assert.equal(wrongVerifier.statusCode, 400);
    assert.equal(JSON.parse(wrongVerifier.body).error, 'invalid_grant');
    const expiredCall = await tokenCall({ grant_type: 'authorization_code', code: expired, redirect_uri: 'https://client.example.invalid/callback', client_id: 'test-client', code_verifier: 'fixture-verifier-0123456789-abcdefghijklmnopqrstuvwxyz' });
    assert.equal(expiredCall.statusCode, 400);
    const good = await tokenCall({ grant_type: 'authorization_code', code, redirect_uri: 'https://client.example.invalid/callback', client_id: 'test-client', code_verifier: 'fixture-verifier-0123456789-abcdefghijklmnopqrstuvwxyz' });
    assert.equal(good.statusCode, 200);
    const tokens = JSON.parse(good.body);
    assert.equal(tokens.access_token, 'new-access-token');
    assert.equal(tokens.refresh_token, 'new-refresh-token');
    assert.equal(tokens.token_type, 'Bearer');
    const refreshed = await tokenCall({ grant_type: 'refresh_token', refresh_token: 'new-refresh-token' });
    assert.equal(refreshed.statusCode, 200);
    assert.equal(JSON.parse(refreshed.body).access_token, 'new-access-token');
  } finally { global.fetch = saved.fetch; }
});
