// OAuth 2.1 authorization server for the TenderCrest MCP server, wrapping
// Supabase Auth. Endpoints (rewritten to clean URLs in netlify.toml):
//   GET  /.well-known/oauth-authorization-server  metadata
//   POST /oauth/register    dynamic client registration (public clients, PKCE)
//   GET  /oauth/authorize  TenderCrest sign-in page
//   POST /oauth/authorize  issue an authorization code after sign-in
//   POST /oauth/token      exchange a code or refresh token for Supabase tokens
// The tokens issued are real Supabase access and refresh tokens, so the MCP
// endpoint verifies them exactly as the web app does, and revocation follows
// Supabase. Nothing is stored server-side. See lib/mcp-auth.js for the code
// format and docs/mcp.md for the connection steps.
const crypto = require('node:crypto');
const kb = require('./lib/knowledge-base');
const auth = require('./lib/mcp-auth');

const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

function origin() {
  let url;
  try { url = new URL(process.env.DEPLOY_PRIME_URL || process.env.URL || 'https://www.tendercrestai.com'); } catch { kb.fail(503, 'MCP OAuth deployment is invalid.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || !(url.hostname === 'www.tendercrestai.com' || url.hostname.endsWith('.netlify.app'))) kb.fail(503, 'MCP OAuth deployment is invalid.');
  return url.origin;
}
function route(event) {
  const path = event.path || '';
  if (path.includes('/.well-known/oauth-authorization-server')) return 'metadata';
  if (path.includes('/oauth/register')) return 'register';
  if (path.includes('/oauth/authorize')) return 'authorize';
  if (path.includes('/oauth/token')) return 'token';
  return (event.queryStringParameters && event.queryStringParameters.endpoint) || '';
}
function parseBody(event, max = 20000) {
  if (event.httpMethod !== 'POST') kb.fail(405, 'Method Not Allowed');
  if (event.isBase64Encoded || typeof event.body !== 'string' || Buffer.byteLength(event.body) > max) kb.fail(413, 'Request exceeds the supported size.');
  try {
    const body = JSON.parse(event.body);
    if (!body || typeof body !== 'object' || Array.isArray(body)) kb.fail(400, 'Invalid request.');
    return body;
  } catch (e) { if (e.status) throw e; kb.fail(400, 'Invalid JSON.'); }
}
// Token endpoint body parsing: RFC 6749 requires token requests to be sent
// as application/x-www-form-urlencoded, while this server's other POST routes
// use JSON. Accept both here so spec-compliant OAuth clients can exchange
// codes: a form body is parsed into the same flat string-valued object the
// route already expects. A body that is neither valid JSON nor valid form
// data still fails 400; the size cap and downstream checks are unchanged.
function parseTokenBody(event) {
  if (event.httpMethod !== 'POST') kb.fail(405, 'Method Not Allowed');
  if (event.isBase64Encoded || typeof event.body !== 'string' || Buffer.byteLength(event.body) > 20000) kb.fail(413, 'Request exceeds the supported size.');
  const contentType = String(((event.headers || {})['content-type'] || (event.headers || {})['Content-Type'] || '')).split(';')[0].trim().toLowerCase();
  if (contentType === 'application/x-www-form-urlencoded') return parseFormBody(event.body);
  try {
    const body = JSON.parse(event.body);
    if (!body || typeof body !== 'object' || Array.isArray(body)) kb.fail(400, 'Invalid request.');
    return body;
  } catch (e) {
    if (e.status) throw e;
    // A client may send a form body without the form content type; accept
    // it when it parses as form data, otherwise keep the JSON error.
    if (event.body.includes('=')) return parseFormBody(event.body);
    kb.fail(400, 'Invalid JSON.');
  }
}
function parseFormBody(raw) {
  const body = {};
  for (const [key, value] of new URLSearchParams(raw)) body[key] = value;
  return body;
}
function checkAuthorizeParams(params) {
  if (params.response_type !== 'code') kb.fail(400, 'Only response_type=code is supported.');
  if (!auth.validClientId(params.client_id)) kb.fail(400, 'A valid client_id is required.');
  if (!auth.validRedirectUri(params.redirect_uri)) kb.fail(400, 'A valid https or loopback redirect_uri is required.');
  if (!auth.validCodeChallenge(params.code_challenge)) kb.fail(400, 'A valid PKCE code_challenge is required.');
  if (params.code_challenge_method !== 'S256') kb.fail(400, 'Only code_challenge_method=S256 is supported.');
  if (params.state !== undefined && (typeof params.state !== 'string' || params.state.length > 500)) kb.fail(400, 'Invalid state.');
  return params;
}
function loginPage(params) {
  const embedded = JSON.stringify(params).replace(/</g, '\\u003c');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect TenderCrest AI</title><style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem;color:#0e1d30}label{display:block;margin:1rem 0 .25rem}input{width:100%;padding:.6rem;border:1px solid #888;border-radius:.25rem}button{margin-top:1.25rem;padding:.6rem 1.2rem;background:#0e1d30;color:#fff;border:0;border-radius:.25rem;cursor:pointer}#error{color:#9b1c1c;margin-top:1rem}</style></head><body><h1>Connect TenderCrest AI</h1><p>Sign in with your TenderCrest account to connect this assistant. It will be able to read your company evidence and proposals. The free tools need no sign-in. Your password goes directly to TenderCrest sign-in and is never stored here.</p><form id="form"><label for="email">Email</label><input id="email" type="email" required autocomplete="email"><label for="password">Password</label><input id="password" type="password" required autocomplete="current-password"><button type="submit">Sign in and connect</button></form><p id="error" role="alert"></p><script>const params=${embedded};const form=document.getElementById('form'),error=document.getElementById('error');form.addEventListener('submit',async(e)=>{e.preventDefault();error.textContent='';const button=form.querySelector('button');button.disabled=true;button.textContent='Signing in…';try{const configResponse=await fetch('/.netlify/functions/auth-config');if(!configResponse.ok)throw new Error('Account connection is temporarily unavailable.');const config=await configResponse.json();const sessionResponse=await fetch(config.url+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:config.key,'Content-Type':'application/json'},body:JSON.stringify({email:document.getElementById('email').value,password:document.getElementById('password').value})});if(!sessionResponse.ok)throw new Error('Email or password did not match. Try again.');const session=await sessionResponse.json();if(!session.refresh_token)throw new Error('Sign-in did not return a session. Try again.');const codeResponse=await fetch('/oauth/authorize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:params.client_id,redirect_uri:params.redirect_uri,code_challenge:params.code_challenge,state:params.state,refresh_token:session.refresh_token})});const codeBody=await codeResponse.json();if(!codeResponse.ok)throw new Error(codeBody.error||'Connection failed. Try again.');window.location.href=codeBody.redirect;}catch(err){error.textContent=err.message||'Sign-in failed. Try again.';button.disabled=false;button.textContent='Sign in and connect';}});</script></body></html>`;
  return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, body: html };
}

function createHandler(adapters = {}) {
  const configOf = adapters.configuration || (() => kb.configuration());
  return async (event) => {
    try {
      const which = route(event);
      const site = origin();
      if (which === 'metadata') {
        if (event.httpMethod !== 'GET') return { statusCode: 405, headers: { ...HEADERS, Allow: 'GET' }, body: JSON.stringify({ error: 'Method Not Allowed' }) };
        auth.oauthSecret();
        return { statusCode: 200, headers: HEADERS, body: JSON.stringify({
          issuer: site,
          authorization_endpoint: site + '/oauth/authorize',
          token_endpoint: site + '/oauth/token',
          registration_endpoint: site + '/oauth/register',
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
          scopes_supported: [auth.SCOPE]
        }) };
      }
      if (which === 'register') {
        const body = parseBody(event);
        auth.oauthSecret();
        if (!Array.isArray(body.redirect_uris) || !body.redirect_uris.length || body.redirect_uris.some((u) => !auth.validRedirectUri(u))) kb.fail(400, 'At least one valid https or loopback redirect_uri is required.');
        return { statusCode: 201, headers: HEADERS, body: JSON.stringify({
          client_id: crypto.randomUUID(),
          redirect_uris: body.redirect_uris,
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none'
        }) };
      }
      if (which === 'authorize' && event.httpMethod === 'GET') {
        auth.oauthSecret();
        const params = checkAuthorizeParams({
          response_type: (event.queryStringParameters || {}).response_type,
          client_id: (event.queryStringParameters || {}).client_id,
          redirect_uri: (event.queryStringParameters || {}).redirect_uri,
          code_challenge: (event.queryStringParameters || {}).code_challenge,
          code_challenge_method: (event.queryStringParameters || {}).code_challenge_method,
          state: (event.queryStringParameters || {}).state
        });
        return loginPage(params);
      }
      if (which === 'authorize') {
        const body = parseBody(event);
        auth.oauthSecret();
        const params = checkAuthorizeParams({
          response_type: 'code',
          client_id: body.client_id,
          redirect_uri: body.redirect_uri,
          code_challenge: body.code_challenge,
          code_challenge_method: 'S256',
          state: body.state
        });
        if (typeof body.refresh_token !== 'string' || !body.refresh_token) kb.fail(400, 'A TenderCrest session is required.');
        const config = configOf();
        const session = await auth.refreshSupabaseSession(config, body.refresh_token);
        const user = await auth.verifySupabaseToken(config, session.access_token);
        const code = auth.issueCode({ userId: user.id, clientId: params.client_id, redirectUri: params.redirect_uri, codeChallenge: params.code_challenge, refreshToken: session.refresh_token });
        const join = params.redirect_uri.includes('?') ? '&' : '?';
        const redirect = params.redirect_uri + join + 'code=' + encodeURIComponent(code) + (params.state ? '&state=' + encodeURIComponent(params.state) : '');
        return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ redirect }) };
      }
      if (which === 'token') {
        const body = parseTokenBody(event);
        auth.oauthSecret();
        const config = configOf();
        let session;
        if (body.grant_type === 'authorization_code') {
          if (typeof body.code !== 'string' || !body.code) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'invalid_grant', error_description: 'An authorization code is required.' }) };
          const payload = auth.decryptCode(body.code);
          if (payload.type !== 'mcp_auth_code' || payload.exp <= Date.now() || payload.clientId !== body.client_id || payload.redirectUri !== body.redirect_uri) {
            return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'invalid_grant', error_description: 'The authorization code is expired or does not match this client.' }) };
          }
          if (typeof body.code_verifier !== 'string' || auth.pkceChallenge(body.code_verifier) !== payload.codeChallenge) {
            return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'invalid_grant', error_description: 'The PKCE verifier does not match the challenge.' }) };
          }
          session = await auth.refreshSupabaseSession(config, payload.refreshToken);
        } else if (body.grant_type === 'refresh_token') {
          if (typeof body.refresh_token !== 'string' || !body.refresh_token) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'invalid_grant', error_description: 'A refresh token is required.' }) };
          session = await auth.refreshSupabaseSession(config, body.refresh_token);
        } else {
          return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'unsupported_grant_type', error_description: 'Only authorization_code and refresh_token are supported.' }) };
        }
        return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ access_token: session.access_token, token_type: 'Bearer', expires_in: session.expires_in || 3600, refresh_token: session.refresh_token, scope: auth.SCOPE }) };
      }
      return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Not found.' }) };
    } catch (e) {
      return { statusCode: (e && e.status) || 503, headers: HEADERS, body: JSON.stringify({ error: (e && e.message) || 'MCP OAuth is temporarily unavailable.' }) };
    }
  };
}

exports.handler = createHandler();
exports.createHandler = createHandler;
