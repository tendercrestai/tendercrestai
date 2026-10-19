# Validation record — 2026-10-13

## Executed

Node 24.19.0, npm 11.9.0. npm test directly executes isolated test files through
scripts/test.sh. Final run: **72 assertions passed, 0 failed**, across 10 files:

| Suite | Passed |
| --- | ---: |
| compliance-ai.test.js | 7 |
| compliance-api.test.js | 11 |
| compliance-document.test.js | 6 |
| compliance-export.test.mjs | 4 |
| production-config.test.mjs | 2 |
| proposal-status-tracker.test.mjs | 9 |
| proposal-status.test.js | 8 |
| rfp-document.test.mjs | 6 |
| submit-proposal.test.js | 13 |
| upload-attempt.test.mjs | 6 |

Real PDF/DOCX/TXT fictional fixtures were parsed by the implemented server code.
PDF physical pages and Section L/M were asserted. Image-only scans fail; mixed
scans retain warnings. PDF.js 5.6.205 and sax 1.6.1 were available preinstalled.
AI/API calls were mocked. Network mocks permit only fictional Supabase URLs and
assert that preview never calls Airtable, Stripe or email services.

Source-validation tests reject fabricated quotes, segment IDs, weights, fact
values, extra fields and attempted AI compliance statuses. Tests cover mandatory
language, conditional clauses, optional/negated language and quote fragments,
exact duplicate merging, uncertainty, truncated/refused/malformed AI output,
review evidence requirements, private-byte integrity and cross-account checks.
RPC mocks exercise overlapping calls, replay, failure, three-attempt limits and
optimistic review conflicts. These mocks do not establish real database locking.

Independent Python openpyxl loaded the generated XLSX and confirmed sheet names,
multiline comments, Partial status and formula-like strings stored as text.
CSV tests cover quotation, newline, comma and spreadsheet formula escaping.

JavaScript syntax and existing inline-page script checks passed. git diff --check
passed. npm install --package-lock-only --offline --ignore-scripts succeeded
using copied preinstalled dependencies; no package tarballs were downloaded.
The lock was normalized to registry URLs and exact optional-package versions,
with no machine-local paths. Registry integrity hashes remain to be refreshed.

The managed environment restricts Node child-process isolation: a normal
node --test invocation summarized files without running their nested tests.
Those file-level results were discarded; the numbers above come from direct
execution of each actual suite, which emits individual assertion results.

## Attempted but blocked / not executed

- Git clone and npm registry requests: unreachable/restricted session proxy.
  Main files and branch/PR metadata were retrieved with the GitHub connector.
- Supabase CLI/PostgreSQL are not installed. No local or remote SQL was executed.
  compliance-isolation.sql remains an executable disposable-project gate.
  Database RLS, trigger grants, RPC transactions, concurrent leases and budget
  enforcement have not been proven against a running database.
- Supabase documentation MCP was unavailable; current RLS documentation was read
  through the web tool. The lightweight changelog markdown fetch was unsupported.
- Chromium/Playwright launch was attempted. Chromium terminated with SIGTRAP
  after a sandbox setsockopt permission error. No rendered browser, keyboard,
  responsive layout, download or handoff end-to-end result is claimed.
- Clean npm ci/audit, Netlify esbuild/dependency packaging, worst-case synchronous
  function latency and manual deployed-preview workflow checks were not executed.
  After draft PR #6 was opened, Netlify reported its automatic deploy-preview
  status as success at https://deploy-preview-6--tendercrestai.netlify.app .
  This establishes an automatic preview build, not parser/worker packaging,
  configured auth/AI/SQL, or end-to-end feature readiness.
- No real AI call was made; provider/model compatibility, precision/recall and
  observed monetary cost require a configured isolated preview.
- No company evidence library integration with unmerged PR #4 was tested.
- No production migrations, customer documents, Airtable automation, emails,
  Stripe calls, production deployment or main merge occurred.

This is an implemented, regression-tested draft preview. Keep it disabled in
production and keep the PR draft until the above activation gates pass. Do not
describe unexecuted checks as successful or infer production readiness from
the mocked tests.

## Follow-up: connected test database validation

After the user authorized preview setup, the TenderCrest Supabase connection
became usable. The existing non-production project wcrrywzleylmdsqqlise
("test project") was confirmed distinct from production vfdwaqgfepvoujprtuww.
The additive compliance migration was applied there as recorded migration
20261013083103_compliance_matrix_preview. No production migration was run.

Executed successfully on the test database:

- compliance-isolation.sql: anonymous and cross-account denial, protected
  citation/owner columns, evidence requirement, reviewer version trigger,
  overlapping claims, stale lease rejection and final status.
- compliance-processing.sql: idempotent analysis reuse, three-new-analysis cap,
  three-attempt retry cap, expired-lease recovery, Partial completion, per-user
  and global attempt limits, transactional rollback on rejected claims.
- rfp-isolation.sql: existing metadata/submission/Storage isolation. Its first
  run failed because it inserted Storage metadata for every existing upload.
  The fixture was corrected to insert only its own two synthetic objects and
  the rerun passed. No existing object was overwritten.

All test transactions rolled back. Verification afterward found the original
7 upload records and 6 submission records unchanged, zero compliance analyses,
zero budget rows and no fixture users. The private bucket has a 10,485,760-byte
limit, the expected three MIME types, and only owner read/insert policies.

Security advisors report intentional INFO findings for the two service-only
budget tables (RLS enabled, no customer policies). Existing billing tables have
similar findings. The test project's leaked-password protection is disabled;
this pre-existing Auth setting was not changed. Reference:
https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

Netlify credential access and a test AI key remain unavailable. No Netlify
configuration, real AI request or browser end-to-end test was completed in this
follow-up. The shell proxy remains unreachable. The earlier database blockers
are now resolved through the connected Supabase tool; the remaining activation
gates still apply.
