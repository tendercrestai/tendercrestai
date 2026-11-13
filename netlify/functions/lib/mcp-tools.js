// TenderCrest MCP tools. This module defines the tools and executes them by
// delegating to the site's existing Netlify function handlers through
// synthetic events, so every tool reuses the web app's validation, rate
// limits, admission checks, and per-user ownership enforcement exactly. No
// business logic is duplicated here and no new data access path is invented.
// Free tools need no sign-in. Evidence and proposal tools are read-only and
// need a verified TenderCrest account; there are no write tools in this pass.
const { UNAUTHORIZED } = require('./mcp-protocol');

const FILE_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'File name, ending in .pdf or .docx.' },
    extension: { type: 'string', enum: ['pdf', 'docx'] },
    data: { type: 'string', description: 'Base64 file contents, up to 2 MB.' }
  },
  required: ['name', 'extension', 'data'],
  additionalProperties: false
};
const ANSWERS_SCHEMA = {
  type: 'object',
  properties: {
    deadline: { type: 'string', description: 'Response deadline, YYYY-MM-DD.' },
    hours: { type: 'number', description: 'Team hours available, 0 to 100000.' },
    eligibility: { type: 'string', enum: ['yes', 'no', 'unsure'] },
    performance: { type: 'string', enum: ['similar', 'related', 'none'] },
    evidence: { type: 'string', enum: ['most', 'some', 'little'] }
  },
  required: ['deadline', 'hours', 'eligibility', 'performance', 'evidence'],
  additionalProperties: false
};

const TOOL_DEFINITIONS = [
  {
    name: 'shred_rfp',
    title: 'Shred an RFP',
    annotations: { readOnlyHint: true },
    description: 'Shred an RFP or solicitation into a numbered requirement list with a gap preview. Paste text or upload a PDF or DOCX. AI extraction can miss requirements and every requirement needs human review. This starts an analysis job and returns a result token; call get_shred_result with the token to read the requirements. Free, no sign-in. Limited to 3 shreds per day, shared with the web shredder.',
    requiresAuth: false,
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Solicitation text, 40 to 100000 characters. Provide text or file.' },
        file: FILE_SCHEMA,
        title: { type: 'string', description: 'Short title for the solicitation, up to 200 characters.' },
        source: { type: 'string', description: 'Where the solicitation came from, up to 500 characters.' },
        processingConsent: { type: 'boolean', description: 'Must be true: confirms the source may be processed to extract requirements.' }
      },
      required: ['processingConsent'],
      additionalProperties: false
    }
  },
  {
    name: 'get_shred_result',
    title: 'Read a shred result',
    annotations: { readOnlyHint: true },
    description: 'Read the result of a shred_rfp job using its result token. Returns the status and, when complete, the numbered requirements, the gap preview, and any warnings. Free, no sign-in.',
    requiresAuth: false,
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Result token returned by shred_rfp.' },
        resume: { type: 'boolean', description: 'Set true to restart a stalled job.' }
      },
      required: ['token'],
      additionalProperties: false
    }
  },
  {
    name: 'check_bid_fit',
    title: 'Check bid fit',
    annotations: { readOnlyHint: true },
    description: 'Run a bid/no-bid fit check on a solicitation: five questions scored 0 to 2, for a fit read of Strong fit, Worth a closer look, or Likely pass. This is a fit score, never a win prediction. Needs the solicitation text or file plus a short title, source, and the five answers. Starts an analysis job and returns a result token; call get_bid_check_result with the token to read the verdict. Free, no sign-in.',
    requiresAuth: false,
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Solicitation text, 40 to 100000 characters. Provide text or file.' },
        file: FILE_SCHEMA,
        title: { type: 'string', description: 'Short title for the bid, up to 200 characters.' },
        source: { type: 'string', description: 'Where the solicitation came from, up to 500 characters.' },
        answers: ANSWERS_SCHEMA,
        processingConsent: { type: 'boolean', description: 'Must be true: confirms the source may be processed.' }
      },
      required: ['title', 'source', 'answers', 'processingConsent'],
      additionalProperties: false
    }
  },
  {
    name: 'get_bid_check_result',
    title: 'Read a bid check result',
    annotations: { readOnlyHint: true },
    description: 'Read the result of a check_bid_fit job using its result token. Returns the status and, when complete, the fit verdict, the score out of 10, the factor breakdown, the top reasons, and the top gaps. Free, no sign-in.',
    requiresAuth: false,
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Result token returned by check_bid_fit.' },
        resume: { type: 'boolean', description: 'Set true to restart a stalled job.' }
      },
      required: ['token'],
      additionalProperties: false
    }
  },
  {
    name: 'search_opportunities',
    title: 'Search SAM.gov opportunities',
    annotations: { readOnlyHint: true },
    description: 'Search live SAM.gov federal opportunities from the past 364 days. Returns up to 25 notices per page with title, agency, deadline, NAICS, PSC, set-aside, and the canonical SAM.gov link. Federal notices only; no contract value bands are published. Free, no sign-in. Limited to 10 searches per day, shared with the web feed.',
    requiresAuth: false,
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Keyword search, up to 100 characters.' },
        naics: { type: 'string', description: '6-digit NAICS code.' },
        psc: { type: 'string', description: '4-character product service code.' },
        setAside: { type: 'string', description: 'Set-aside type code, up to 12 characters.' },
        page: { type: 'integer', description: 'Results page, 0 to 9. Default 0.' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_opportunity',
    title: 'Read a SAM.gov opportunity',
    annotations: { readOnlyHint: true },
    description: 'Read one SAM.gov opportunity by its notice URL or 32-character notice ID, including the notice description text when SAM.gov returns it. Descriptions are not complete solicitation packages; attachments are not imported. Free, no sign-in.',
    requiresAuth: false,
    inputSchema: {
      type: 'object',
      properties: {
        notice: { type: 'string', description: 'SAM.gov notice URL or 32-character notice ID.' }
      },
      required: ['notice'],
      additionalProperties: false
    }
  },
  {
    name: 'list_organizations',
    title: 'List organizations',
    annotations: { readOnlyHint: true },
    description: 'List the knowledge organizations (company evidence libraries) the signed-in TenderCrest user belongs to. Needs a TenderCrest account.',
    requiresAuth: true,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'list_evidence',
    title: 'List evidence',
    annotations: { readOnlyHint: true },
    description: 'List the signed-in user\'s own company evidence for one organization: uploaded source documents and saved answers with their approval state. Only returns evidence the user\'s organization owns. Needs a TenderCrest account.',
    requiresAuth: true,
    inputSchema: {
      type: 'object',
      properties: { orgId: { type: 'string', description: 'Organization ID from list_organizations.' } },
      required: ['orgId'],
      additionalProperties: false
    }
  },
  {
    name: 'read_evidence_source',
    title: 'Read an evidence source',
    annotations: { readOnlyHint: true },
    description: 'Read one evidence source document and its extracted text chunks, for the signed-in user\'s own organization. Needs a TenderCrest account.',
    requiresAuth: true,
    inputSchema: {
      type: 'object',
      properties: {
        orgId: { type: 'string', description: 'Organization ID from list_organizations.' },
        documentId: { type: 'string', description: 'Document ID from list_evidence.' }
      },
      required: ['orgId', 'documentId'],
      additionalProperties: false
    }
  },
  {
    name: 'search_evidence',
    title: 'Search evidence',
    annotations: { readOnlyHint: true },
    description: 'Search the signed-in user\'s own company evidence for one organization by meaning, using the same semantic search as the web app. Returns matching evidence with citations. Needs a TenderCrest account.',
    requiresAuth: true,
    inputSchema: {
      type: 'object',
      properties: {
        orgId: { type: 'string', description: 'Organization ID from list_organizations.' },
        query: { type: 'string', description: 'Search text, up to 2000 characters.' }
      },
      required: ['orgId', 'query'],
      additionalProperties: false
    }
  },
  {
    name: 'list_proposals',
    title: 'List proposals',
    annotations: { readOnlyHint: true },
    description: 'List the signed-in TenderCrest user\'s own proposals (projects), newest first. Needs a TenderCrest account.',
    requiresAuth: true,
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'integer', description: 'Results page, 0 to 1000. Default 0.' },
        query: { type: 'string', description: 'Title search, up to 200 characters.' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'read_proposal',
    title: 'Read a proposal',
    annotations: { readOnlyHint: true },
    description: 'Read one of the signed-in user\'s own proposals in full: project state, sections, requirements, evidence decisions, jobs, files, activity, approvals, and readiness. Read-only. Needs a TenderCrest account.',
    requiresAuth: true,
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string', description: 'Proposal ID from list_proposals.' } },
      required: ['projectId'],
      additionalProperties: false
    }
  },
  {
    name: 'list_proposal_records',
    title: 'List proposal records',
    annotations: { readOnlyHint: true },
    description: 'List saved records for one of the signed-in user\'s own proposals: jobs, files, activity, notifications, assessments, or approvals. Read-only. Needs a TenderCrest account.',
    requiresAuth: true,
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Proposal ID from list_proposals.' },
        kind: { type: 'string', enum: ['jobs', 'files', 'activity', 'notifications', 'assessments', 'approvals'] },
        page: { type: 'integer', description: 'Results page, 0 to 1000. Default 0.' }
      },
      required: ['projectId', 'kind'],
      additionalProperties: false
    }
  },
  {
    name: 'get_proposal_revision',
    title: 'Read a proposal revision',
    annotations: { readOnlyHint: true },
    description: 'Read one saved revision of the signed-in user\'s own proposal. Read-only. Needs a TenderCrest account.',
    requiresAuth: true,
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Proposal ID from list_proposals.' },
        revision: { type: 'integer', description: 'Revision number, 0 or higher.' }
      },
      required: ['projectId', 'revision'],
      additionalProperties: false
    }
  }
];

function listTools() {
  return TOOL_DEFINITIONS.map(({ requiresAuth, ...tool }) => tool);
}

function textResult(value) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}
function errorResult(message) {
  return { content: [{ type: 'text', text: String(message || 'The tool call failed.') }], isError: true };
}
function unauthorized() {
  const error = new Error('Sign in with a TenderCrest account to use this tool. Connect with OAuth, or pass a TenderCrest access token as a Bearer token.');
  error.status = 401;
  error.code = UNAUTHORIZED;
  return error;
}

// Invoke an existing function handler with a synthetic event carrying the
// same headers the web app would send, and return its parsed JSON body.
// Handler errors become tool errors (isError), never invented data.
async function invoke(handler, event, payload) {
  const headers = {};
  if (event.headers) {
    for (const name of ['authorization', 'Authorization', 'x-nf-client-connection-ip', 'X-Nf-Client-Connection-Ip']) {
      if (event.headers[name]) headers[name] = event.headers[name];
    }
  }
  const response = await handler({ httpMethod: 'POST', headers, body: JSON.stringify(payload) });
  let parsed = null;
  try { parsed = JSON.parse(response.body); } catch { /* fall through */ }
  if (!response || response.statusCode >= 400) {
    const message = parsed && typeof parsed.error === 'string' ? parsed.error : 'The tool call failed.';
    const error = new Error(message);
    error.status = response ? response.statusCode : 503;
    throw error;
  }
  return parsed;
}

function createToolRunner(adapters = {}) {
  const handlers = {
    freeTools: adapters.freeTools || require('../free-tools').handler,
    opportunities: adapters.opportunities || require('../opportunities').handler,
    knowledge: adapters.knowledge || require('../knowledge').handler,
    proposals: adapters.proposals || require('../proposals').handler
  };
  const run = {
    shred_rfp: (event, args) => invoke(handlers.freeTools, event, { action: 'start', text: args.text, file: args.file, title: args.title || '', source: args.source || '', processingConsent: args.processingConsent }),
    get_shred_result: (event, args) => invoke(handlers.freeTools, event, { action: 'status', token: args.token, resume: args.resume }),
    check_bid_fit: (event, args) => invoke(handlers.freeTools, event, { action: 'bid-start', text: args.text, file: args.file, title: args.title, source: args.source, processingConsent: args.processingConsent, answers: args.answers }),
    get_bid_check_result: (event, args) => invoke(handlers.freeTools, event, { action: 'bid-status', token: args.token, resume: args.resume }),
    search_opportunities: (event, args) => invoke(handlers.opportunities, event, { action: 'search', keyword: args.keyword || '', naics: args.naics || '', psc: args.psc || '', setAside: args.setAside || '', page: args.page }),
    get_opportunity: (event, args) => invoke(handlers.opportunities, event, { action: 'detail', notice: args.notice }),
    list_organizations: (event) => invoke(handlers.knowledge, event, { action: 'organizations' }),
    list_evidence: (event, args) => invoke(handlers.knowledge, event, { action: 'list', orgId: args.orgId }),
    read_evidence_source: (event, args) => invoke(handlers.knowledge, event, { action: 'source', orgId: args.orgId, documentId: args.documentId }),
    search_evidence: (event, args) => invoke(handlers.knowledge, event, { action: 'search', orgId: args.orgId, query: args.query }),
    list_proposals: (event, args) => invoke(handlers.proposals, event, { action: 'list', page: args.page, query: args.query }),
    read_proposal: (event, args) => invoke(handlers.proposals, event, { action: 'get', projectId: args.projectId }),
    list_proposal_records: (event, args) => invoke(handlers.proposals, event, { action: 'browse', projectId: args.projectId, kind: args.kind, page: args.page }),
    get_proposal_revision: (event, args) => invoke(handlers.proposals, event, { action: 'revision', projectId: args.projectId, revision: args.revision })
  };
  async function callTool(name, args, ctx) {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === name);
    if (!tool) {
      const error = new Error('Unknown tool: ' + name);
      error.status = 404;
      throw error;
    }
    if (tool.requiresAuth && !ctx.user) throw unauthorized();
    try {
      return textResult(await run[name](ctx.event, args));
    } catch (e) {
      if (e && e.code === UNAUTHORIZED) throw e;
      return errorResult(e && e.message ? e.message : 'The tool call failed.');
    }
  }
  return { callTool };
}

module.exports = { TOOL_DEFINITIONS, listTools, createToolRunner, unauthorized };
