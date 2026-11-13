// MCP endpoint: POST /mcp (Streamable HTTP transport, stateless). One JSON-RPC
// message per request; the server answers with a single JSON response.
// initialize, ping, and tools/list are public. tools/call on an account tool
// needs a Bearer token: a TenderCrest (Supabase) access token, verified the
// same way the web app verifies a signed-in user. A presented token that does
// not verify is rejected; an account tool called without one answers 401.
// No session is required or created: the server is stateless.
const kb = require('./lib/knowledge-base');
const protocol = require('./lib/mcp-protocol');
const { listTools, createToolRunner } = require('./lib/mcp-tools');

const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const MAX_BODY = 4000000;

function bearerToken(event) {
  const header = event.headers?.authorization || event.headers?.Authorization || '';
  const match = /^Bearer ([^\s]+)$/.exec(header);
  return match ? match[1] : null;
}

function createHandler(adapters = {}) {
  const runner = adapters.toolRunner || createToolRunner(adapters.tools);
  const authenticate = adapters.authenticate || ((event, config) => kb.authenticate(event, config));
  return async (event) => {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: { ...HEADERS, Allow: 'POST' }, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }
    if (event.isBase64Encoded || typeof event.body !== 'string' || Buffer.byteLength(event.body) > MAX_BODY) {
      return { statusCode: 413, headers: HEADERS, body: JSON.stringify({ error: 'Request exceeds the supported size.' }) };
    }
    let message = null;
    try {
      message = JSON.parse(event.body);
    } catch {
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify(protocol.errorPayload(null, protocol.PARSE_ERROR, 'Parse error.')) };
    }
    if (Array.isArray(message)) {
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify(protocol.errorPayload(null, protocol.INVALID_REQUEST, 'Batch requests are not supported.')) };
    }
    try {
      let user = null, token = null;
      if (bearerToken(event)) {
        const config = kb.configuration();
        const auth = await authenticate(event, config);
        user = auth.user;
        token = auth.token;
      }
      const toolEvent = { ...event, headers: { ...(event.headers || {}), authorization: token ? 'Bearer ' + token : undefined } };
      const outcome = await protocol.dispatch(message, {
        user,
        listTools: () => listTools(),
        callTool: (name, args) => runner.callTool(name, args, { event: toolEvent, user, token })
      });
      if (outcome.kind === 'notification') return { statusCode: 202, headers: HEADERS, body: '' };
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify(outcome.payload) };
    } catch (e) {
      if (e && e.code === protocol.UNAUTHORIZED) {
        return { statusCode: 401, headers: HEADERS, body: JSON.stringify(protocol.errorPayload(message && message.id, protocol.UNAUTHORIZED, e.message)) };
      }
      return { statusCode: (e && e.status) || 503, headers: HEADERS, body: JSON.stringify({ error: (e && e.message) || 'MCP service is temporarily unavailable.' }) };
    }
  };
}

exports.handler = createHandler();
exports.createHandler = createHandler;
