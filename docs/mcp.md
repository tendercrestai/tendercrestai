# TenderCrest MCP server

One MCP server lets Claude, ChatGPT, and Muse connect to TenderCrest AI.
It speaks the MCP Streamable HTTP transport (the current standard; the
deprecated SSE transport is not used) and is stateless: no session is
required or created.

## Endpoint

- MCP endpoint: `https://www.tendercrestai.com/mcp`
  (rewritten to the `mcp` Netlify function)
- OAuth metadata: `https://www.tendercrestai.com/.well-known/oauth-authorization-server`
- Authorize: `https://www.tendercrestai.com/oauth/authorize`
- Token: `https://www.tendercrestai.com/oauth/token`
- Register: `https://www.tendercrestai.com/oauth/register`

Protocol versions supported: `2025-06-18` and `2025-03-26` (negotiated from
the client's `initialize` request). Each request is one JSON-RPC message and
gets one JSON response. Notifications get `202` with no body. `GET /mcp`
answers `405`; batch requests are rejected.

## Tools

Free tools need no sign-in. Account tools are read-only and need a verified
TenderCrest account.

| Tool | Sign-in | What it does |
| --- | --- | --- |
| `shred_rfp` | No | Start shredding an RFP (pasted text or PDF/DOCX upload) into a numbered requirement list. Returns a result token. |
| `get_shred_result` | No | Read a shred result by token: status, requirements, gap preview, warnings. |
| `check_bid_fit` | No | Start a bid/no-bid fit check (five questions, 0 to 2 each). Returns a result token. |
| `get_bid_check_result` | No | Read a bid-check result by token: verdict, score out of 10, factors, reasons, gaps. |
| `search_opportunities` | No | Search live SAM.gov federal opportunities (past 364 days), 25 per page. |
| `get_opportunity` | No | Read one SAM.gov notice by URL or 32-character ID, with description text when SAM.gov returns it. |
| `list_organizations` | Yes | List the user's knowledge organizations. |
| `list_evidence` | Yes | List the user's own evidence documents and saved answers for one organization. |
| `read_evidence_source` | Yes | Read one evidence source and its extracted text chunks. |
| `search_evidence` | Yes | Semantic search over the user's own evidence for one organization. |
| `list_proposals` | Yes | List the user's own proposals, newest first. |
| `read_proposal` | Yes | Read one of the user's own proposals in full (state, sections, evidence, jobs, files, readiness). |
| `list_proposal_records` | Yes | List saved records (jobs, files, activity, notifications, assessments, approvals) for one proposal. |
| `get_proposal_revision` | Yes | Read one saved revision of the user's own proposal. |

Every tool calls the site's existing function handlers, so validation, rate
limits, admission checks, and per-user ownership are exactly the web app's.
Nothing is invented: requirements, opportunities, proposals, and prices all
come from the real logic.

Honest limits, stated in the tool descriptions: AI extraction can miss
requirements and every requirement needs human review; the bid checker gives
a fit read, never a win prediction; opportunities are federal notices only,
with no contract value bands.

## How to connect

### Claude (remote MCP)

1. In Claude, open Settings, Connectors, Add custom connector.
2. Name: `TenderCrest AI`. Remote MCP server URL: `https://www.tendercrestai.com/mcp`.
3. When prompted, sign in with a TenderCrest account. The free tools work
   without signing in; the evidence and proposal tools need the sign-in.
4. Confirm the tools appear (14 tools). Ask Claude to shred a solicitation
   or search opportunities to try it.

### ChatGPT (developer mode)

1. ChatGPT's MCP support is narrower than Claude's: it works in developer
   mode on Team, Enterprise, and Education plans. Open Settings, Apps, or
   the developer-mode connector list, depending on the current ChatGPT UI.
2. Add a connector with server URL `https://www.tendercrestai.com/mcp`.
   ChatGPT discovers OAuth from
   `https://www.tendercrestai.com/.well-known/oauth-authorization-server`.
3. Sign in with a TenderCrest account when prompted. The free tools work
   without signing in.

### Muse (custom MCP connector)

1. Follow the `custom_connector_setup` skill: connect the service through
   its MCP server.
2. Server URL: `https://www.tendercrestai.com/mcp`. OAuth discovery URL:
   `https://www.tendercrestai.com/.well-known/oauth-authorization-server`.
3. Keep the credential in Muse's secure connection flow, never in chat.

### Manual connection (no OAuth)

If OAuth is not configured yet, a client that accepts a static Bearer token
can still use the account tools: sign in at tendercrestai.com, copy the
access token from the browser session (`supabase.auth.getSession()` in
developer tools, or the `sb-*-auth-token` localStorage entry), and pass it
as the `Authorization: Bearer` header. The server verifies it the same way
the web app does. Treat the token like a password and do not share it.

## OAuth setup (Archit, one manual step)

Set this Netlify environment variable in Production scope, then redeploy:

- `MCP_OAUTH_SIGNING_SECRET` — at least 32 characters, random. It encrypts
  authorization codes. Rotating it invalidates outstanding codes only.

No database migration is needed. No Supabase, Stripe, or other secret is
exposed to clients, and no token is ever logged.

How the flow works: the client registers dynamically (public client, PKCE
S256 only), the user signs in on TenderCrest's own sign-in page, the server
issues a 10-minute authorization code (AES-256-GCM encrypted, bound to one
client, one redirect URI, and one PKCE challenge), and the token endpoint
exchanges it for real Supabase access and refresh tokens. The MCP endpoint
verifies those tokens exactly as the web app does, so per-user ownership and
revocation follow Supabase. Redirect URIs must be `https`, or loopback
`http` for desktop clients.

## Limits

- Shredder: 3 shreds per IP per UTC day, same as the web shredder.
- SAM.gov search: 10 searches per day, same as the web feed.
- MCP clients connect from shared provider IPs, so the per-IP budget is
  shared across that provider's users. This is inherent to unauthenticated
  public tools; the limit still applies, it is just shared.
- The free MCP result is the same as the web's free result (requirements
  plus gap preview). The emailed compliance matrix stays web-only.
- Shred and bid-check jobs are asynchronous: start the job, then poll the
  result tool with the token until the status is `Completed`.

## What is deliberately left out

- No write tools. The account tools are read-only in this pass; the site
  already has write APIs, but exposing proposal edits through MCP is a
  separate decision.
- No emailed compliance matrix or bid-check report through MCP (web-only).
- No server-side revocation list for OAuth codes or refresh tokens beyond
  Supabase's own session handling. Rotating `MCP_OAUTH_SIGNING_SECRET`
  invalidates outstanding authorization codes.
- No CORS headers on `/mcp`. Claude, ChatGPT, and Muse connect server-side;
  if a browser-based client needs CORS, that is a follow-up.
- The deploy preview is behind Netlify Team Protection, so the preview was
  not tested live; see the PR for what was verified locally instead.

## Verification

- `node scripts/build-site.mjs` passes.
- `bash scripts/test.sh` passes (395 checks, 0 failures), including the new
  `tests/mcp.test.js` (13 tests): initialize handshake, tools/list, a free
  tool call, an account tool call without a token (401), a bad Bearer token
  (401), a verified token through the real verification path, rate-limit
  admission for shreds and SAM.gov searches, and the OAuth endpoints.
- The MCP handler was invoked locally with node for initialize, tools/list,
  and a free `search_opportunities` call, all answering correctly.
