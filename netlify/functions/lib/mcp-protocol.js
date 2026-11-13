// Minimal MCP (Model Context Protocol) JSON-RPC handling for the Streamable
// HTTP transport. This module is transport-agnostic and has no I/O: the
// Netlify function in ../mcp.js owns HTTP, auth, and tool execution, and this
// module owns protocol shape only. It deliberately implements the small
// surface the server needs (initialize, ping, tools/list, tools/call) rather
// than depending on the MCP SDK, so the function keeps the repo's existing
// no-framework, esbuild-bundled style.
const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26'];
const SERVER_INFO = { name: 'tendercrest-mcp', version: '0.1.0' };
const PARSE_ERROR = -32700, INVALID_REQUEST = -32600, METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602, INTERNAL_ERROR = -32603, UNAUTHORIZED = -32001;

function negotiateVersion(clientVersion) {
  if (typeof clientVersion === 'string' && SUPPORTED_VERSIONS.includes(clientVersion)) return clientVersion;
  return SUPPORTED_VERSIONS[0];
}
function isNotification(message) {
  return message && typeof message === 'object' && !Array.isArray(message) &&
    typeof message.method === 'string' && message.id === undefined;
}
function errorPayload(id, code, message) {
  return { jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } };
}
function resultPayload(id, result) {
  return { jsonrpc: '2.0', id, result };
}

// Dispatch one JSON-RPC message. Returns { kind: 'response', payload } for a
// request, { kind: 'notification' } for a notification (no reply), or throws
// an error shaped { status, code, message } for auth failures so the HTTP
// layer can answer 401. context: { user, listTools(), callTool(name, args) }.
async function dispatch(message, context) {
  if (!message || typeof message !== 'object' || Array.isArray(message) ||
      message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return { kind: 'response', payload: errorPayload(message && message.id, INVALID_REQUEST, 'Invalid JSON-RPC request.') };
  }
  if (isNotification(message)) return { kind: 'notification' };
  const id = message.id;
  if (typeof id !== 'string' && typeof id !== 'number') {
    return { kind: 'response', payload: errorPayload(null, INVALID_REQUEST, 'A request id is required.') };
  }
  const params = message.params === undefined ? {} : message.params;
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    return { kind: 'response', payload: errorPayload(id, INVALID_PARAMS, 'Request params must be an object.') };
  }
  try {
    if (message.method === 'initialize') {
      const version = negotiateVersion(params.protocolVersion);
      return { kind: 'response', payload: resultPayload(id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: 'TenderCrest AI tools. Free tools need no sign-in. Evidence and proposal tools need a TenderCrest account: sign in at tendercrestai.com, then connect with OAuth. AI extraction can miss requirements and every requirement needs human review. Bid checks give a fit read, never a win prediction.'
      }) };
    }
    if (message.method === 'ping') return { kind: 'response', payload: resultPayload(id, {}) };
    if (message.method === 'tools/list') {
      return { kind: 'response', payload: resultPayload(id, { tools: context.listTools() }) };
    }
    if (message.method === 'tools/call') {
      if (typeof params.name !== 'string' || !params.name) {
        return { kind: 'response', payload: errorPayload(id, INVALID_PARAMS, 'A tool name is required.') };
      }
      const args = params.arguments === undefined ? {} : params.arguments;
      if (args === null || typeof args !== 'object' || Array.isArray(args)) {
        return { kind: 'response', payload: errorPayload(id, INVALID_PARAMS, 'Tool arguments must be an object.') };
      }
      const result = await context.callTool(params.name, args);
      return { kind: 'response', payload: resultPayload(id, result) };
    }
    return { kind: 'response', payload: errorPayload(id, METHOD_NOT_FOUND, 'Method not supported: ' + message.method) };
  } catch (e) {
    if (e && e.code === UNAUTHORIZED) throw e;
    return { kind: 'response', payload: errorPayload(id, INTERNAL_ERROR, e && e.status ? e.message : 'The MCP tool call failed.') };
  }
}

module.exports = { SUPPORTED_VERSIONS, SERVER_INFO, PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND, INVALID_PARAMS, INTERNAL_ERROR, UNAUTHORIZED, negotiateVersion, isNotification, errorPayload, resultPayload, dispatch };
