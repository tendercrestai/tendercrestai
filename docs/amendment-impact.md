# Amendment impact review (Capability 3)

Customer promise: "When the solicitation changes, see what needs another look."

## What it does

1. A user adds a new solicitation version to an existing proposal from an
   analyzed amendment document (same supported upload and extraction pipeline
   as the initial import). They state whether the upload is a **complete
   replacement solicitation** or a **supplemental amendment**.
2. The original version and its review history stay intact: prior versions
   live in `pw_revisions` (full state snapshots per revision) and in
   `pw_projects.state.requirements` until a change is confirmed.
3. The new version is compared deterministically against the live
   requirements and proposes changes: **added**, **changed**,
   **deadline-changed**, **instruction-changed**, **potentially-removed**,
   **uncertain-match**. Every proposed change shows old and new wording side
   by side with source references, plus the linked evidence, draft responses
   and approvals it affects.
4. Affected approvals are marked **needs reconfirmation** when a deterministic
   change is proposed; the previous approval stays in trace history.
   Rejecting a change restores the prior approval state.
5. Each proposed change is confirmed, corrected or rejected individually.
   Unconfirmed changes stay visible as pending. Nothing is silently
   overwritten: no requirement, response, deadline or evidence link is
   deleted by proposing an amendment.
6. An amendment impact report lists the changes and unresolved reviews, and
   states exactly which documents were compared and which could not be
   processed. It is included in every submission package as
   `amendment-impact-report.md` once an amendment exists.

## Replacement vs supplemental

- Complete replacement: a requirement absent from the new version is
  **potentially removed** — it stays in the project until a person confirms
  the removal (then it is kept with a `removedByAmendment` marker and drops
  out of readiness and trace, never deleted).
- Supplemental amendment: an absent requirement is **not mentioned** — it is
  listed as unchanged, never treated as removed, and its approvals are
  untouched.

## Comparison rules (deterministic; no model call)

- Match by stable requirement ID first, then by word-set (Jaccard)
  similarity for reworded requirements: >= 0.50 is a detected change,
  0.25–0.50 is an **uncertain match** for human review, below 0.25 is a new
  requirement. Short requirements (3 or fewer tokens) match only on
  identical wording.
- Deadline/instruction changes are detected by comparing extracted dates
  (ISO dates and "Month D, YYYY") and the `Submission` category.
- No model call is made in this version: ambiguous pairs go to a human
  instead of being guessed. No other customer's evidence is ever sent into
  a comparison.

## API

- `amendmentPropose` (writable project role + organization owner/editor,
  same sharing rule as import): `{analysisId, kind, confirmShare,
  versionNumber?}` — version number auto-assigns when omitted.
- `amendmentConfirm`, `amendmentCorrect`, `amendmentReject` (any writable
  project role; a viewer cannot propose or decide changes).
- `amendments`, `amendmentReport` (read; viewers included).
- Workspace `get` includes `amendments` (changes enriched with affected
  evidence, draft responses and approval state). The workspace UI has an
  Amendments tab with the same confirm/correct/reject flows and a report
  download.

## Manual production steps

**None.** All amendment state lives in `pw_projects.state.amendments`
(JSONB); activity history comes from `pw_events` via commit and trace
history from the state mirror. No migration is needed, and the code does not
depend on the Capability 1 audit tables (`pw_requirement_traces`,
`pw_trace_links`, migration `20261115090000`, still unapplied in production
as of Nov 15, 2026) — trace writes for amendment decisions reuse the
existing best-effort `recordTrace` and are swallowed when those tables do
not exist.

States, per the production-steps rule:

- Code merged: this PR (not merged yet).
- Code live: after merge + Netlify deploy of the merge commit.
- Production step applied: none required.

## Limits and estimated incremental operating cost

- At most 50 solicitation versions per project; at most 1000 requirements
  per amendment; at most 1000 proposed changes per amendment.
- **Estimated incremental cost: $0/month.** The comparison is deterministic
  CPU inside the existing Netlify functions; no model call, no new paid
  service, no new storage beyond the existing JSONB state and the `pw_files`
  source rows the import pipeline already stores.
- Usage assumption (same base as Capabilities 1–2, plus an amendment rate):
  50 active workspaces, 10 proposals per workspace per month, 40
  requirements per proposal, amendments on 1 in 5 proposals — about 100
  amendments/month, each a bounded in-memory comparison (stable-ID match
  first, then at most 1000 x 1000 token-set comparisons). Documents are never
  silently truncated: the extraction pipeline's 1000-requirement limit still
  applies and is reported as an error, not a silent cut.
- Combined ceiling for Capabilities 1 + 2 + 3 is $100/month incremental;
  Capabilities 1 and 2 are $0/month, so the combined total stays $0/month.

## Tests

`tests/amendment-impact.test.js` (13 tests): version matching and stable-ID
reuse, reworded-requirement reconfirmation with history preserved, new
requirement + derived mandatory readiness item, supplemental vs replacement
handling, approval invalidation and restore on reject, deadline/instruction
detection, uncertain-match correct-as-same / correct-as-different, reword
correction, impact-report contents, package inclusion, viewer permissions,
and the acceptance test (amendment changes a submission instruction and
adds a required certification).

## Rollback

Revert the merge. Amendment state already stored in `pw_projects.state`
is inert JSONB: the UI reads it only through the new code, and no migration
or external state was created. Requirements confirmed as removed keep their
`removedByAmendment` marker (history is preserved, not deleted).
