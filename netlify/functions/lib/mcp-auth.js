// OAuth 2.1 helpers for the TenderCrest MCP server. The server acts as an
// authorization server for TenderCrest accounts: it wraps Supabase Auth, so
// the tokens it issues are real Supabase access and refresh tokens and the
// MCP endpoint verifies them the same way the web app does. No new trust
// model, no stored credentials, no database table: authorization codes are
// AES-256-GCM encrypted blobs that live for 10 minutes and are bound to one
// client, one redirect URI, and one PKCE challenge. The Supabase refresh
// token inside a code is handled only in memory, only to mint tokens, and is
// never logged, stored, or returned to the browser. OAuth is unavailable
// until MCP_OAUTH_SIGNING_SECRET (at least 32 characters) is set in the
// Netlify environment; Bearer-token connection still works without it.
const crypto = require('node:crypto');
const kb = require('./knowledge-base');

const CODE_TTL_MS = 10 * 60 * 1000;
const SCOPE = 'mcp:read';

function oauthSecret() {
  const secret = process.env.MCP_OAUTH_SIGNING_SECRET;
  if (!secret || secret.length < 32) kb.fail(503, 'MCP OAuth is not configured for this deployment. Connect with a TenderCrest access token instead; see docs/mcp.md.');
  return secret;
}
function codeKey() {
  return crypto.createHash('sha256').update(oauthSecret()).digest();
}
function base64url(value) {
  return Buffer.from(value).toString('base64url');
}
function sha256Base64url(value) {
  return crypto.createHash('sha256').update(value).digest('base64url');
}
function pkceChallenge(verifier) {
  return sha256Base64url(verifier);
}

// Encrypt a small JSON payload into an opaque authorization code.
function encryptCode(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', codeKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return base64url(Buffer.concat([iv, tag, ciphertext]));
}
function decryptCode(code) {
  let raw;
  try { raw = Buffer.from(code, 'base64url'); } catch { kb.fail(400, 'Invalid authorization code.'); }
  if (raw.length < 12 + 16 + 1) kb.fail(400, 'Invalid authorization code.');
  const iv = raw.subarray(0, 12), tag = raw.subarray(12, 28), ciphertext = raw.subarray(28);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', codeKey(), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    const payload = JSON.parse(plain);
    if (!payload || typeof payload !== 'object') kb.fail(400, 'Invalid authorization code.');
    return payload;
  } catch (e) { if (e.status) throw e; kb.fail(400, 'Invalid authorization code.'); }
}
function issueCode({ userId, clientId, redirectUri, codeChallenge, refreshToken }) {
  return encryptCode({ type: 'mcp_auth_code', userId, clientId, redirectUri, codeChallenge, refreshToken, exp: Date.now() + CODE_TTL_MS });
}

// Redirect URIs: https anywhere, or loopback http (desktop MCP clients).
function validRedirectUri(value) {
  if (typeof value !== 'string' || !value) return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.username || url.password || url.hash) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return false;
}
function validCodeChallenge(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(value);
}
function validClientId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._~-]{8,128}$/.test(value);
}

// Exchange a Supabase refresh token for a fresh access/refresh pair.
async function refreshSupabaseSession(config, refreshToken) {
  const response = await fetch(config.url + '/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    headers: { apikey: config.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) kb.fail(400, 'The TenderCrest session could not be refreshed. Sign in again.');
  const session = await response.json();
  if (typeof session.access_token !== 'string' || typeof session.refresh_token !== 'string') kb.fail(400, 'The TenderCrest session could not be refreshed. Sign in again.');
  return session;
}

// Verify a Supabase access token and return the user, using the same path
// as the web app (GET /auth/v1/user, verified email required).
async function verifySupabaseToken(config, accessToken) {
  return kb.authenticate({ headers: { authorization: 'Bearer ' + accessToken } }, config).then(({ user }) => user);
}

module.exports = { CODE_TTL_MS, SCOPE, oauthSecret, base64url, sha256Base64url, pkceChallenge, encryptCode, decryptCode, issueCode, validRedirectUri, validCodeChallenge, validClientId, refreshSupabaseSession, verifySupabaseToken };
