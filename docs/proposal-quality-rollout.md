# TenderCrest proposal quality integration

This branch combines the evidence library from PR #4 and compliance workspace from
PR #6 with current main (603b06d). It adds a real handoff to the existing proposal
queue, requirement-aware evidence retrieval, revised generation/review prompts,
and an offline evaluation toolkit. This is prompt and evidence engineering;
no base model was trained or fine-tuned, and no output-quality uplift has been measured.

## What changed

The portal loads a compliance analysis through an authenticated server request.
The server checks ownership, processing status, exact source quotations and source
locations, then hashes a stable snapshot of the reviewed rows. Submitting the
proposal reloads the snapshot and rejects stale reviews or changed RFP text before
reserving a submission or credit. Editing source text detaches the matrix visibly.
Ordinary unlinked submissions keep their previous retry fingerprints.

The existing qualifications field carries a bounded JSON packet containing current
qualifications, approved company evidence, original/reviewed requirements, source
references, reviewer status, evidence notes, gaps and extraction warnings. No new
Airtable field is required. Company-digest fallback and billing reservations remain
in place. A reviewer marking a row Compliant does not verify bidder capabilities.

Retrieval still uses at most 200 approved entries, eight excerpts, two excerpts per
source and 12,000 excerpt characters. It now favours coverage of individual reviewed
requirements within those limits. Lexical matches are candidates, not semantic
proof. Missing retrieval matches remain visible in the packet.

The three Airtable AI stages build a matrix, draft by criterion, then revise against
the source. Four synthetic weak/better answer examples teach specificity, proposed
methods, evidence and pricing gaps. They are editorial seeds awaiting expert review;
they are not customer evidence, winning bids or a fine-tuning dataset.

## Preview activation

Use an isolated Supabase test project and the existing TenderCrest AI Test Airtable
base. Do not run synthetic cases through production email delivery. The existing
test automation includes delivery nodes; publishing or testing it can send email.
Before any live test, inspect every recipient and use a controlled test mailbox or
a separate evaluation workflow with delivery removed. No automation was run here.

1. Apply missing prerequisite migrations to the test project, in repository order:
   secure RFP uploads, private proposal evidence, compliance matrix, and billing
   credits. Check migration history first; do not reapply existing migrations.
2. Run the matching SQL isolation/processing tests from `supabase/tests`. No new
   schema is introduced by this integration. The expanded test session ran all five SQL suites successfully after preparing the missing test evidence table.
3. Configure preview-only server settings:
   `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `AIRTABLE_PAT`, `AIRTABLE_BASE_ID`, `COMPLIANCE_AI_API_KEY`,
   `COMPLIANCE_AI_MODEL`. Set `EVIDENCE_ENGINE_ENABLED=true`,
   `COMPLIANCE_PREVIEW_ENABLED=true`, `PROPOSAL_QUALITY_ENABLED=true` only there.
4. Install pinned dependencies with `npm ci`; run `npm test` and a Netlify bundle
   check. Local verification used bundled matching pdfjs-dist 5.6.205/sax 1.6.1,
   with bundled canvas available through NODE_PATH; it was not a clean npm install.
5. Review the validated test Airtable draft at
   https://airtable.com/appsDmtQ1XOE8Gjtr/wflnDbTiFkkyVdmTY.
   This session updated only the draft. Published configuration was reread and
   verified unchanged. Production Airtable was not edited.
6. In preview, use fictional files to check upload, source review, analysis, row
   edits, export, handoff, stale-edit rejection, account isolation and queue status.
   Twenty local Edge scenarios covered source review, editing, exports, errors and account changes at 320/390/768/1280px using
   mocked API/auth responses. They did not validate a deployed end-to-end flow.

## Build evidence for the USP

`engine/quality-benchmark.json` contains 20 synthetic holdout cases across government,
commercial, SaaS and nonprofit tenders, with explicit review checks. Keep it out of
generation prompts and training data. The four style examples are separate.

Capture the current system and candidate outputs using the same case inputs,
source material, model settings and evaluation conditions. Record engine version,
model/provider where available, run date, generation time and AI cost alongside
the run. Do not fabricate outputs for a passing score. Save sensitive real-case
outputs privately rather than committing them to this public repository.

Create a JSON scorecard with:

```
node engine/evaluate-quality.cjs --template
node engine/evaluate-quality.cjs candidate-run.json
node engine/evaluate-quality.cjs candidate-run.json baseline-run.json
```

The first command prints a blank template; save it to a private file. A run needs
the matching dataset version, every case exactly once, an explicit factual-claim
inventory, requirement crosswalk, and independent expert review. Exact citation
checks do not establish entailment: the reviewer must check whether each source
supports the claim and identify uncited claims the AI omitted from its inventory.
The checker rejects incomplete reviews and critical errors before comparison.

Blind/randomise candidate and baseline labels where practical. For each case,
score accuracy, completeness, relevance, specificity and evidence support from 0
to 4: 0 = unusable/wrong; 1 = major corrections; 2 = substantial editing; 3 = minor
editing; 4 = acceptable on this dimension after expert verification. Separately
record editing minutes, critical errors and every case-specific review check.
Preserve disagreements and obtain a second review for material differences.

The tool reports descriptive paired differences only. Its readiness flag means
the evaluation records are complete, not that the proposal is ready to submit.
Twenty synthetic cases do not establish win rates or general customer outcomes.
Have a tender expert approve/correct the examples, then add permissioned real-world
cases, including difficult and failed outputs. Keep a separate unseen test set.

Target USP, pending validation: "TenderCrest AI turns tender requirements and your
company's evidence into traceable proposal drafts, highlighting gaps before you
submit." Only publish percentage/time-saving claims after recording the sample,
baseline, conditions, reviewer method and actual measured results.

Evaluation approach informed by official OpenAI guidance:
https://developers.openai.com/api/docs/guides/evaluation-best-practices

## Rollback and production decision

Disable `PROPOSAL_QUALITY_ENABLED` to block linked-matrix handoffs. Existing unlinked
submissions continue. Disable the evidence/compliance flags separately only if those
workflows also need disabling; communicate that linked proposals then cannot submit.
Revert the deployment to its last known-good commit to restore the previous app.
Do not drop tables or delete evidence to roll back application behaviour.

`engine/test-automation-before-quality.json` is the test draft snapshot before this
change. It is not the deployed version. Restoring it only restores the test draft;
do not publish it as a production rollback. `refresh-quality-automation.cjs` updates
prompts on a freshly fetched recognised three-stage graph while preserving all
other nodes. Fetch the current production graph before preparing a production
candidate; do not copy test account connections or assume old snapshots are current.

Production merge, migrations, prompt publication and deployment remain separate
approval steps after live preview checks and expert-reviewed output evaluation.
