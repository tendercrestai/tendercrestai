# Requirement-to-evidence traceability (Capability 1)

Customer promise: "See what supports every response and what still needs evidence."

## What was built

- **Stable requirement IDs.** `REQ-` + first 12 hex chars of the extraction
  fingerprint (sha256 of the normalized requirement wording). Content-anchored,
  not document-anchored: source document IDs are per-upload UUIDs and do not
  survive a re-upload, while the wording fingerprint does. The same wording
  keeps the same ID across revisions, amendments and re-uploads; the persistent
  per-project uuid mapping in `imported()` additionally preserves identity when
  wording is edited (the prior stable ID is carried over and the review is
  flagged for reconfirmation). Source-document identity is preserved separately
  in the source-reference column of every export. See `stableRequirementId` in
  `netlify/functions/lib/proposal-core.js` and `assets/compliance-model.mjs`.
- **Source preservation.** Document, extracted wording, section and page are
  carried from extraction through import and export. Where a page/section is
  unavailable the UI and export say "Page unavailable" / "Section
  unavailable"; references are never invented.
- **Linking evidence.** Any project member with write access can link an
  existing company evidence item to a requirement (`linkEvidence` in
  `netlify/functions/proposals.js`). The lookup goes through `pw_candidates`,
  which enforces explicit project membership and returns only the project's
  own org's approved answers; an answer the lookup does not return cannot be
  linked. Linked evidence starts as a `suggested` mapping.
- **Coverage.** `not-assessed` / `supported` / `partially-supported` /
  `missing-evidence`, shown with its origin: `AI-suggested` or
  `human-confirmed`. AI suggestions reuse existing extraction/match results
  only (a matched candidate suggests at most `partially-supported`, never full
  support), are computed once when evidence is linked or rematched, cached in
  `pw_projects.state`, and never trigger a model call on read. A reviewer
  accepts or rejects a suggestion (existing evidence review) or records a
  coverage assessment with a short explanation (`assessCoverage`).
- **Response approval is separate from coverage.** A well-supported
  requirement can still have an unapproved response, and a response can be
  approved while coverage is partial. `approveResponse` records the reviewer,
  time, and reviewed versions (requirement revision, evidence epoch, response
  revision, response content hash).
- **Invalidation without history loss.** Changing linked evidence, the
  response text, or the evidence epoch after a review marks the review as
  needing reconfirmation (`needs-reconfirmation` / `needsReconfirmation`) and
  appends to `trace.history` (capped at 50 entries). Prior approvals stay in
  history. Unsupported statements stay visible in the Overview
  "Unresolved traceability items" list and in `GET /.netlify/functions/proposals`
  (`trace` action) until coverage is supported and the response is approved.
- **Export.** The compliance matrix (CSV and XLSX, in the compliance page and
  in the proposal submission package) gains seven columns: Stable Requirement
  ID, Source Reference, Evidence References, Evidence Coverage, Coverage
  Source, Review Status, Response Approval. Source references survive exports.
  Rows without a trace (legacy analyses, free-tool exports) degrade honestly
  to `not-assessed` / `Unrecorded` instead of inventing coverage.
- **Permissions.** All trace actions run through the existing workspace
  membership checks (`pw_require` / `pw_role`); coverage assessment and
  response approval additionally require a manager/reviewer with an
  owner/reviewer org role, like other reviews. Evidence lookups are denied
  without a project role (tested).

## Manual production steps (do these after merge; merged != live != applied)

1. **Apply the migration** in the Supabase dashboard SQL Editor, production
   project `vfdwaqgfepvoujprtuww`: run the full contents of
   `supabase/migrations/20261115090000_requirement_traceability.sql`. It
   creates `pw_requirement_traces` and `pw_trace_links` plus RLS (SELECT for
   authenticated project members via `pw_role`, all writes service-role only).
   Verify with:
   `select count(*) from public.pw_requirement_traces;` (should return 0, not
   an error) and confirm both tables appear under Authentication > Policies
   with their `_read` policies.
2. **Deploy** the merged code (Netlify production deploy). No environment
   variable changes, no Stripe/price/checkout/affiliate/consent changes.
3. **Re-run the acceptance test below** against the deployed workspace before
   demonstrating traceability to a customer.

**States:** PR merged (code in `main`) / code live (Netlify deploy includes the
PR) / migration applied (tables exist in production). Do not report the
capability as live until all three hold.

### Safe degradation if the migration is not applied

Trace data lives in the `trace` object on each requirement inside
`pw_projects.state` (the JSONB mirror), which the UI, the `trace` API action
and the export all read. The durable tables are written best-effort only
(`recordTrace` in `netlify/functions/lib/proposal-service.js`): if the tables
do not exist, PostgREST answers 404 and the write is swallowed, so no
user-visible save ever fails. The UI keeps working; only the queryable audit
copy is missing until the migration is applied. Legacy projects imported
before this capability get a default `not-assessed` trace on first read
(`ensureTrace`), so nothing crashes on old state.

## Estimated incremental operating cost

**Usage assumption (stated):** 50 active workspaces; 10 proposals per
workspace per month; average 40 requirements per proposal; 2 evidence
suggestions reviewed per requirement. That is ~20,000 requirements/month and
~40,000 trace events/month.

- **Model (AI) cost: $0/month.** Coverage suggestions are a deterministic
  keyword-overlap heuristic over already-extracted requirements and already
  matched evidence. No new model call is made by this capability, and no
  other customer's evidence is ever sent into a proposal's analysis.
- **Database:** ~20,000 trace rows + ~40,000 link rows/month at well under
  1 KB each (excerpts capped at 1,000 chars, history capped at 50 entries per
  requirement) is roughly 40–60 MB/month before any retention cleanup, inside
  the existing Supabase plan; no new paid tier is required.
- **Compute/bandwidth:** trace reads are computed from already-loaded project
  state; no new background jobs, no new scheduled functions.

**Estimated incremental total: $0/month** under the stated assumption, and
under $5/month even at 10x that volume (storage only). Well inside the
$100/month ceiling for all three capabilities combined.

## Per-workspace limits and overall processing cap

- Reuses existing workspace limits: at most 1000 requirements and 1000 sections
  per project, at most 200 projects per org, state capped at 3 MB
  (enforced by `pw_commit`).
- Trace-specific bounds: history capped at 50 entries per requirement;
  evidence excerpts capped at 1,000 chars in trace rows (5,000 in state);
  at most 20 citations stored per linked evidence item; at most 10 candidate
  evidence mappings per requirement per rematch (existing `pw_candidates`
  limit). Documents are never truncated silently: limits are enforced by
  explicit errors at import/match time, as before.
- Request budgets are the existing `pw_admit` budgets (read/write per user
  per minute, per org per day); trace actions consume the same `write` budget
  as other reviews. No separate cap is needed because no new model or
  third-party call is introduced.

## Acceptance test (fictional documents only)

Run with `node /tmp/acceptance-traceability.cjs` (script kept in the task
record; the same steps are covered by `tests/requirement-traceability.test.js`).
Fictional RFP: "The vendor must hold current ISO 27001 certification."
(Section L, page 2) and "The vendor must provide three client references
from the last three years." Fictional evidence: "We hold ISO 27001
certification, valid until 2027-06-01." Results, all PASS on 2026-11-15:

1. Import assigns stable IDs (`REQ-2D7993E48082`, `REQ-009E56A8E230`);
   source document, wording, section and page preserved.
2. Linking evidence shows the excerpt alongside the requirement; suggestion
   is labelled AI-suggested with partial coverage (never full support).
3. Reviewer confirms partial coverage with an explanation; reviewer, time
   and reviewed versions recorded.
4. Response approved while coverage stays partial (separate fields); the
   second requirement remains visible as unresolved (missing evidence).
5. CSV export carries the stable ID, source reference, evidence reference,
   coverage, coverage source and approval status.
6. Changing the response marks the approval `needs-reconfirmation`; history
   still contains the original approval and the invalidation entry.

## Known limitations

- AI-suggested coverage is a deterministic heuristic over matched evidence,
  not a model judgment; it can suggest `partially-supported` for a weak match
  and must be human-confirmed before it counts as assessed.
- The durable audit tables are only populated after the manual migration is
  applied; before that, history lives only in the state mirror (which is
  still exported and still shown in the UI).
- Stable IDs are content-anchored: if a requirement is reworded so heavily
  that it no longer matches a prior requirement by ID or wording, it gets a
  new stable ID (the old one remains in the prior revision snapshot).
- The compliance-matrix export from a legacy analysis (pre-traceability)
  shows `not-assessed` / `Unrecorded` for trace columns; it does not
  backfill reviews that never happened.
- `recordTrace` upserts are best-effort and swallow errors, so a silent
  failure mode exists if the tables are later dropped or the service key
  loses access; the state mirror remains correct in that case.

## Rollback

- **Code:** revert the merge commit on `main`. The UI, API actions and
  export columns disappear; existing projects keep working because all new
  state fields are additive and read through `ensureTrace` defaults.
- **Migration:** additive, so no data loss on rollback. If the migration was
  already applied, `pw_requirement_traces` and `pw_trace_links` stay behind
  with their rows (queryable audit copies) but stop receiving new rows; the
  state mirror in `pw_projects.state` keeps every trace review. Dropping the
  tables is optional and only discards the audit copies.
