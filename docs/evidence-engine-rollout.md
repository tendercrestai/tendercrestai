# Evidence-grounded proposal engine: setup and validation

## Delivered

- Private Evidence Library at `/evidence-library.html`, linked from the existing workspace and upload page.
- PDF/DOCX/TXT text import with existing 10 MB checks; only reviewed text is saved. The original reference file is not uploaded or retained.
- Owner-only Supabase evidence records with permission confirmation, explicit approval, approval withdrawal and deletion. Content is immutable; delete and replace an entry to correct it, then review the replacement.
- Bounded, sector-aware lexical retrieval using the customer's JWT. Relevant excerpts carry source IDs, exact character offsets and hashes. Past bids and evaluator feedback are lessons, not evidence of current capabilities.
- Existing proposal-submission and idempotency workflow preserved. Excerpts are included in the existing `Proposal Specific Qualifications` field; no Airtable fields are added or renamed.
- Airtable generation upgrade: requirement/evidence matrix → criterion-based draft → AI review and revised draft with crosswalk, source appendix and human-review report.
- Public browser configuration follows Netlify environment settings, so preview authentication and evidence retrieval use the same Supabase project. Only publishable keys are returned. The existing auth forms, Supabase client version, billing, branding and free-trial behavior are preserved.
- Optional `AIRTABLE_BASE_ID` selects the proposal queue/status base. Production retains its original base by default. This option does not change Stripe webhook routing.

The generation upgrade is a prompt/retrieval implementation, not model training. Source citations and a second AI pass are not guarantees of correctness. See `evidence-engine-research.md` for sources and limitations.

## Drafts already prepared

The following Automation 1 configurations were saved and validated as **draft changes only** on 12 October 2026:

- [Test Airtable draft](https://airtable.com/appsDmtQ1XOE8Gjtr/wflnDbTiFkkyVdmTY)
- [Production Airtable draft](https://airtable.com/appsaqdp3UZdhB2VH/wflnDbTiFkkyVdmTY)

Their deployed versions were not changed. No automation run or customer email was triggered during implementation. Do not apply the production draft until test validation is complete.

`engine/current-automation.json` records the configuration inspected before this change. `engine/proposed-automation.json` is the complete proposed replacement. They contain configuration and public identifiers, not customer records or API keys. If the automation has been edited since this snapshot, compare the latest graph before replacing it.

To regenerate the proposed configuration locally:

```sh
node engine/upgrade-automation.cjs engine/current-automation.json engine/proposed-automation.json
```

This command only writes a JSON file. It does not apply or run an automation.

## Test setup, in order

1. Open the **test** Supabase project → SQL Editor → New query.
2. Copy the complete contents of `supabase/migrations/202610120001_private_proposal_evidence.sql`, paste them into the editor, and click Run once. The existing secure-upload migration must already be installed for proposal submissions.
3. Run `supabase/tests/evidence-isolation.sql` in that test project. It creates temporary fixtures inside a transaction, checks owner visibility, foreign approval/deletion/insertion denial, immutable content and anonymous permissions, then rolls back. Success means no SQL error. If it fails, do not enable retrieval; inspect the error and policies first.
4. In Netlify → site configuration → Environment variables, configure these values for **Deploy Previews only**:

   | Variable | Preview value |
   | --- | --- |
   | `SUPABASE_URL` | Test Supabase project URL |
   | `SUPABASE_PUBLISHABLE_KEY` | Test project's `sb_publishable_…` key |
   | `SUPABASE_SERVICE_ROLE_KEY` | Test project's existing server-only service-role key |
   | `AIRTABLE_PAT` | Token authorized for the test base |
   | `AIRTABLE_BASE_ID` | `appsDmtQ1XOE8Gjtr` |
   | `EVIDENCE_ENGINE_ENABLED` | `true` |

   Make all six variables available to Netlify Functions at runtime. Keep private keys server-only. The configuration function returns only the publishable key and project URL. The new public-configuration endpoint expects a publishable key, not a legacy JWT anon key or a secret key. Do not paste keys into GitHub, this document or chat.

5. Open the test Airtable draft above. Review Automation 1's new prompts and review step. Apply the draft using Airtable's Update control in the **test base**. The existing generation and delivery actions will run for subsequent test submissions, so use a controlled test account and synthetic documents.
6. Redeploy the PR preview after changing environment variables. The authentication pages now read preview settings at runtime; manual edits to hardcoded frontend project IDs are unnecessary.
7. Open the preview → sign in with a test-project account → Private Evidence Library. If login takes you back to the homepage, click the library link again.
8. Save one company-evidence entry, one past-bid entry and one evaluator-feedback entry. Provide source/date labels and permission confirmation. Leave one entry unapproved initially. Use fictional data, not customer confidential material, for this test.
9. Submit a synthetic RFP with overlapping terms. Check the test base's `Proposal Specific Qualifications` field: it should contain the JSON evidence packet and only approved, relevant passages belonging to your account. Confirm the RFP field remains unchanged.
10. Inspect the generated matrix and revised draft. Check requirement IDs, exact source support, missing-evidence flags, crosswalk, evidence appendix and separate HUMAN REVIEW REPORT. Confirm the existing email arrives, and that status still says ready without implying verified email delivery.
11. Withdraw an entry's approval, then start a **new** proposal. Its excerpt should be absent. Replaying a queued submission should return the existing proposal rather than regenerate it. Deleting a source does not remove its snapshot from older proposals.
12. Sign in as a second test user. The first user's references must be absent; SQL isolation must pass. Also check file-import errors, expired-session handling, an unsuccessful save/retry, and approve/delete controls. New-library browser interaction and real Supabase isolation were not executed automatically here.

No new OpenAI API key, Stripe payment or manual trial activation is required. Generation continues using the existing Airtable AI service. The third generation step can increase latency and AI-credit usage.

## Compare output quality before claiming improvement

Use the five synthetic cases in `engine/benchmark-cases.json`, covering missing certifications, quotation pricing, cross-bid contamination, grant eligibility and conflicting deadlines. These are authored fixtures, not winning bids.

Generate baseline and proposed-engine results separately in the test base. Keep the same inputs, company evidence and reference records for both runs. Avoid editing the deployed production automation. Retain the outputs as:

```json
{
  "public-missing-certification": { "matrix": "...", "draft": "..." },
  "commercial-quote-no-price": { "matrix": "...", "draft": "..." },
  "saas-reference-contamination": { "matrix": "...", "draft": "..." },
  "grant-eligibility-gap": { "matrix": "...", "draft": "..." },
  "conflicting-amendment": { "matrix": "...", "draft": "..." }
}
```

For the contamination case, add its referenceLesson as an approved past-bid entry using matching SaaS terms. Check that its malicious instruction and other bidder's credentials are not adopted.

Run the structural precheck:

```sh
node engine/check-benchmark-output.cjs proposed-outputs.json
```

That script checks output presence, requirement IDs, review-report headings, visible gaps and citation markers only. It does not validate truth, citation support, requirement completeness or injection resistance.

Have a knowledgeable reviewer compare anonymized outputs without knowing which engine produced them. Use each case's reviewChecks and score requirement coverage, evidence support, correctness, clarity and editing effort on a 1–5 scale. Count unsupported facts separately; any invented certification, experience, current price or deadline is a critical failure. Record editing minutes and generation latency. Add permissioned real cases later, keeping benchmark cases out of the reference library to avoid test leakage. Do not advertise higher win rates from this benchmark.

## Production activation, after successful testing and approval

1. Apply the same new migration once in the production Supabase project. Do not run fixture SQL in production.
2. Review and apply the production Airtable Automation 1 draft. Its current inputs work with the old submission format as well as the new evidence packet, but verify one controlled run after activation.
3. Merge the feature PR only after approval. Confirm Netlify publishes the new production commit.
4. Keep production Supabase and Airtable credentials set to their original production values. Set `AIRTABLE_BASE_ID` to `appsaqdp3UZdhB2VH` or leave it unset for the original default.
5. Set `EVIDENCE_ENGINE_ENABLED=true` for Production and redeploy. Enable this only after the production evidence table and upgraded automation are ready. Until enabled, the library may save references but submissions use the existing qualifications behavior.
6. Perform a controlled upload and a pasted-text proposal, inspect the output and confirm delivery. Review actual AI-credit use and processing time before broader rollout.

The feature branch and Airtable drafts do not themselves activate production changes.

## Rollback

- Set `EVIDENCE_ENGINE_ENABLED=false` and redeploy to stop new private evidence retrieval. Existing drafts keep their saved evidence snapshots.
- Restore the prior Airtable prompts/graph from `engine/current-automation.json` after comparing it with intervening changes, then apply the restored draft in Airtable.
- Keep the evidence table and private records for review; no destructive rollback or table deletion is required.
- Disabling retrieval does not erase approved excerpts already transferred into Airtable proposal records or delivered outputs. Their retention follows the existing proposal workflow. This feature does not create a cross-customer training corpus.

## Verification completed in implementation

57 local test cases passed, including existing authentication enforcement, uploads, quota/free trial, idempotency, status tracking and new evidence/configuration/automation checks. Script syntax and whitespace checks passed. Airtable accepted both proposed drafts as valid; deployed versions remained unchanged.

Not executed: Supabase migration or SQL isolation against a live database, authenticated browser library interactions, full AI-generation benchmark, email delivery for the new engine, or production deployment. No Supabase admin connection or model-run tool was available. These are activation checks above, not claimed passes.
