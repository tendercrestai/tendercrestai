# Submission readiness (Capability 2)

Customer promise: "Know exactly what still blocks submission."

## What was built

- **Readiness view.** A `Readiness` tab on every proposal (plus an
  "Outstanding work" summary on Overview). Items are derived from the
  extracted requirements already in `pw_projects.state` (Capability 1 trace
  data: coverage, review status, approvals). No second extraction pass runs.
- **Item kinds from the same requirement set.** Category `Attachment` →
  required document; category `Submission` with "form" in the wording →
  required form, otherwise a submission instruction; anything else → a
  requirement item. Evidence gaps and outstanding response reviews are live
  flags on the same items (coverage `missing-evidence`/`not-assessed`;
  response approval not `approved`), not separate items.
- **Source reference on every extracted item.** Document, section and page
  from the requirement's sources; where a page/section is unavailable the
  view and the report say so. References are never invented.
- **Corrections and manual items.** Any writable member can correct an
  extraction mistake (text, category, mandatory status, with a required
  note). The correction is stored as an override keyed by stable ID, so it
  survives amendments, and the item is labelled "Corrected extraction".
  Manual items can be added (title, kind, category, mandatory, optional
  source) and are labelled "Manual addition — no extracted source"; they can
  be removed again. The underlying requirement text is unchanged; marking a
  requirement an extraction error stays reviewer-only (`reviewRequirement`).
- **Owner and due date.** Each item takes an owner (must be a current
  project member) and an optional due date (valid `YYYY-MM-DD`).
- **Task statuses.** `Not started` / `In progress` / `Needs review` /
  `Done` / `Not applicable`. `Not applicable` requires a reason, stored on
  the item and shown in the view and report; the reason clears if the status
  changes away from `Not applicable`.
- **Mandatory status is separate from task status.** Mandatory (`Yes` /
  `Unclear` / `No`) is a property of the requirement; task status is the
  checklist state. They are separate fields in state, in the filters and in
  the report. Confirming coverage or approving a response does not
  auto-resolve a task.
- **Outstanding-work summary.** Plain lines, e.g. "4 mandatory items
  unresolved.", "2 required documents missing.", "3 responses awaiting
  approval.", plus evidence gaps and per-owner counts. No "certified
  compliant", "guaranteed ready", or win-probability language anywhere; the
  scope note on the view and in the report states readiness covers only the
  supplied and successfully processed materials.
- **Filters.** By mandatory status, owner (including Unassigned), category
  and task status (`assets/readiness-model.mjs`, shared by the UI and tests).
- **Readiness report.** Downloadable from the Readiness tab
  (`readinessReport` API action, Markdown) and included as
  `readiness-report.md` in every submission package (draft and final).
  Unresolved items first; unresolved MANDATORY items in their own prominent
  first section with source references, owners and due dates. The package
  manifest also carries `readinessSummary`. No new hard block on existing
  exports in V1: readiness flags unresolved work, it does not gate the
  draft export.
- **Activity history.** Every readiness change commits through the existing
  `pw_commit` path, so it appears in `pw_events` (Reviews tab activity
  feed) with operation names `readiness.updated`,
  `readiness.manual-added`, `readiness.corrected`,
  `readiness.manual-removed`.
- **Permissions.** Readiness mutations are API mutations, so they require a
  writable project role (`pw_require` with `manager`/`author`/`reviewer`):
  a viewer can read the view and download the report but gets 403 on any
  change (tested at handler level). Owner assignment additionally requires
  the owner to be a current project member.

## Manual production steps (do these after merge; merged != live != applied)

**No migration is needed for this capability.** All readiness state lives
in the `readiness` object inside `pw_projects.state` (JSONB), and history
uses the existing `pw_events` table. There is nothing for Archit to run in
the Supabase dashboard for Capability 2.

1. **Deploy** the merged code (Netlify production deploy). No environment
   variable changes, no Stripe/price/checkout/affiliate/consent changes.
2. **Re-run the acceptance test below** against the deployed workspace
   before demonstrating readiness to a customer.

**States:** PR merged (code in its base branch) / code live (Netlify deploy
includes the PR) / no production step applies. Do not report the capability
as live until the deploy is verified. Note Capability 1's migration
(`20261115090000_requirement_traceability.sql`) is still unapplied in
production; readiness works without it because it reads the state mirror,
and only the queryable audit copy is missing until Archit applies it.

### Safe degradation if Capability 1's migration is unapplied

Readiness reads the same JSONB state mirror as Capability 1, so it works
fully with the migration unapplied. Legacy projects imported before this
capability get an empty readiness state on first read (`readinessState`
defaults), so nothing crashes on old state.

## Estimated incremental operating cost

**Usage assumption (stated, same as Capability 1):** 50 active workspaces;
10 proposals per workspace per month; average 40 requirements per proposal.
That is ~20,000 proposals' worth of requirements/month; readiness adds one
derived checklist per requirement, computed from already-loaded state.

- **Model (AI) cost: $0/month.** Items are derived deterministically from
  already-extracted requirements. No new model call is made by this
  capability.
- **Database:** readiness state is a few hundred bytes per item inside the
  existing 3 MB state cap (overrides, corrections, at most 200 manual items
  per project); no new tables, no new rows. Inside the existing Supabase
  plan; no new paid tier is required.
- **Compute/bandwidth:** items and summary are computed from already-loaded
  project state; the report is plain text generated on demand; no new
  background jobs, no new scheduled functions.

**Estimated incremental total: $0/month** under the stated assumption, and
under $5/month even at 10x that volume (storage only). Combined with
Capability 1 ($0/month), the total for both is $0/month — well inside the
$100/month ceiling for all three capabilities combined.

## Per-workspace limits and overall processing cap

- Reuses existing workspace limits: at most 500 requirements and 500
  sections per project, at most 200 projects per org, state capped at 3 MB
  (enforced by `pw_commit`).
- Readiness-specific bounds: at most 200 manual items per project; task
  override and correction text capped (reason 500 chars, correction note
  1,000 chars, manual title 500 chars). Documents are never truncated
  silently: limits are enforced by explicit errors, as before.
- Request budgets are the existing `pw_admit` budgets (read/write per user
  per minute, per org per day); readiness actions consume the same `write`
  budget as other reviews. No separate cap is needed because no new model
  or third-party call is introduced.

## Acceptance test (fictional documents only)

Run with `node /tmp/acceptance-readiness.cjs` (script kept in the task
record; the same steps are covered by `tests/submission-readiness.test.js`).
Fictional RFP: ISO 27001 certification (Section L, page 2), certificate of
insurance (Section M, page 3), pricing form (Section N, page 1), triplicate
delivery (Section N, page 1), sustainability program (Section O, page 4).
Results, all PASS on 2026-11-15:

1. Import derives 5 readiness items (requirement/document/form/
   instruction) with source references; no second extraction pass.
2. Summary reads "4 mandatory items unresolved. / 2 required documents
   missing. / 5 responses awaiting approval. / 5 evidence gaps."
3. Mandatory status (Yes) stays separate from task status (Done).
4. Two members divide work (A: cert + insurance, B: pricing form +
   triplicate), resolve 2 items, refresh shows "2 mandatory items
   unresolved. / 1 required document missing." with per-owner counts.
5. Not applicable without a reason is rejected; with a reason it saves.
6. Extraction correction is labelled on the item; manual addition is
   labelled with no extracted source.
7. Filters by mandatory / owner / category / task status return the right
   items.
8. Report lists unresolved first; the insurance certificate (unresolved
   mandatory) is in the prominent first section with its source reference;
   no certified/guaranteed/win-probability language.
9. Draft submission package includes `readiness-report.md` and the manifest
   readiness summary; no new hard block on exports in V1.

## Known limitations

- Readiness items are only as good as the extraction: if a requirement was
  missed or misworded by extraction, its item is missed or misworded too,
  until a user corrects it or adds a manual item. The scope note says
  readiness covers only supplied and successfully processed materials.
- Kind derivation is a rule over category and wording (`Attachment` →
  document; `Submission` → form/instruction). A document requirement filed
  under another category appears as a requirement item, not a document item,
  until corrected.
- The summary counts items, not buyer points: a single requirement can
  surface as one item even if the buyer scores it in several places.
- Readiness does not gate the draft export and does not change the final
  sign-off checklist (`core.readiness` blockers); a team can still export a
  draft with unresolved mandatory items, by design in V1.
- Corrections override the displayed text/category/mandatory only; the
  underlying extracted requirement and its stable ID are unchanged, and a
  later amendment that rewords the requirement flags the trace for
  reconfirmation while the correction stays attached to the stable ID.

## Rollback

- **Code:** revert the merge commit on the base branch. The UI tab, API
  actions and report disappear; existing projects keep working because all
  new state fields are additive and read through `readinessState` defaults.
  The `readiness` object in state is inert without the code.
- **Migration:** none was added for this capability, so there is nothing to
  roll back in the database.
