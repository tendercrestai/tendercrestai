# Validation and deployment evidence — 2026-10-25

## Release state

- Branch: `feature/customer-intelligence-upgrade`.
- Draft PR: https://github.com/tendercrestai/tendercrestai/pull/19 — not merged.
- Tested application commit: `53337a3391f9c9d75d092ecce0be92f37010426e`. Subsequent report-only changes do not change application code.
- Full isolated deployment: `6addd018eba0b597dae5ecfe`, repository-built on Netlify with all 15 functions; test Supabase only.
- Integrated preview: https://tendercrestai-pr6-isolated-20261021.netlify.app . Anonymous demo: `/demo.html#interactive-demo`; authenticated enhancements: `/workspace.html` with approved isolated test identities.
- Repository PR preview: https://deploy-preview-19--tendercrestai.netlify.app . This separate preview uses the production site's existing preview policy; new authenticated flag remains off there. Use the isolated site for enhanced authenticated testing.
- Isolated repository connection reuses the existing authorized GitHub connection, tracks this feature branch and has private build logs. Automatic builds were stopped after the verified candidate to freeze this review environment. An intentional future staging build requires re-enabling builds on this isolated site; never change the actual production site's branch or secrets.
- Metadata migration `20261025090000` applied and recorded only in TEST `wcrrywzleylmdsqqlise`.
- Final read-only verification: production remains deploy `6add8b2a931dbf060daeb255`, commit `e592f9b7224138b4f60c872abeae2ea0552713ba`. New flag not enabled, new migration absent, email disabled. No production secrets or source deployment changed.

## Executed checks

| Check | Observed result |
|---|---|
| `npm test` | 256 passed, zero failed; existing upload, login-related security/session, Stripe/webhook/credits, contact/email, parsing/extraction, knowledge, workspace, Word/PDF export and new intelligence/audit/writing/security suites |
| `python scripts/test-customer-upgrade-browser.py` | 28 Chromium checks passed; all three anonymous scenarios at 390/768/1280; owner/viewer fixtures at 390/1280. External auth/API intercepted, not claimed as hosted-auth checks |
| `bash scripts/test-customer-upgrade-sql.sh` | 53 PASS assertions, disposable no-network Postgres 17/pgvector; RLS, membership revocation, service-only RPCs, metadata CAS/approval controls, retrieval filtering, invalidation, transactional knowledge reuse |
| Public build / function packaging | Build succeeds, explicit allowlist excludes private source; all 15 functions package locally and full Netlify repository build succeeds |
| Isolated authenticated API/security/export journey | 31 passed; existing owner, uninvited-member/anonymous/stale/injection denials, profile, original RFP import, strategy/decision, preview/acceptance, audit/final gate, metrics, metadata reads, draft Word/PDF exports and independent readers/hash validation |
| Fresh uploads and optional AI-writing job | 9 passed; real private PDF/DOCX/TXT extraction, review checkpoint, consented writing preview, source-review flag/provenance/usage, no saved-text replacement |
| Fresh small RFP AI extraction | 3 passed; source reviewed, existing provider completes extraction, verbatim source citations remain human-review required |
| Returning customer using existing approved fictional knowledge | 11 passed; fresh RFP uploaded/analyzed, approved evidence retrieved/reviewed, draft generated/accepted/reviewed, current clean audit, final signoff and final DOCX/PDF ZIP, hashes, approved section reused transactionally as an unapproved knowledge answer |
| Live conflict workflow | 4 passed; both passages retained, viewer cannot resolve, reviewer rationale/provenance recorded, later text change invalidates the resolution |
| Live metadata writes | 3 passed; draft metadata saved/versioned, stale metadata CAS rejected, organization evidence invalidated |
| Hosted actual-auth browser | 28 passed; owner/viewer at 390/1280, all enhanced areas, onboarding, audit findings, safe preview, metadata, trial disclosures, no browser errors, no unexpected mutation requests |
| Hosted public pages | Five pages at mobile/desktop passed; image/local-link/access checks, no mutations/browser errors, existing Stripe links and six samples preserved |

Hosted checks use synthetic documents and existing authorized fictional identities only. No new user account, customer email, card checkout, payment, Airtable generation automation or shared-model training was triggered. New optional provider writing was explicitly exercised once; legacy extraction was exercised twice on small fictional inputs. Existing data/approvals remain in immutable revisions. A failed fictional KB source remains failed/retryable rather than falsely Ready.

## Failed / blocked scenario

**Fresh knowledge upload → embedding → Ready failed.** Private upload succeeded; the existing ingestion worker recorded `embedding_failed`. A synchronous organization-scoped semantic-search diagnosis returned HTTP 503: “Embedding access is denied. Ask your organization administrator to verify the provider key and model.” This establishes provider-access denial, not which exact permission/project setting is wrong. The configured test `KB_EMBEDDING_API_KEY` must have embeddings endpoint access and its project must allow `text-embedding-3-small`, with sufficient quota. Do not replace production credentials, invent vectors or weaken indexing checks. The same document can be retried within existing job limits after the owner fixes test provider access. A follow-up question was sent; no confirmation received at report time. Fresh indexing and semantic search are **not passed**.

The complete final-export/reuse journey above uses the independently existing approved fictional library. It does not convert the failed fresh-indexing case into a pass. Production activation remains blocked pending that fix and retest.

## Resolved test/environment failures

- Initial offline browser assertion expected zero even though the defined literal-consistency component contributed 20 points. Expected score now derives from the actual fixture calculation; this is not semantic-consistency proof.
- Hosted Chromium initially rejected the environment proxy CA. Imported the provided CA into the browser trust store and reran successfully with TLS verification enabled.
- Manual large parser uploads reset at the session proxy; attempted pruning was reverted. Final source retains the original parser/configuration. Full repository-hosted Netlify build, using the existing authorized GitHub connection, resolved deployment. Incomplete manual attempts are not release candidates.
- A repository build initially lacked a valid GitHub connection and failed host-key verification; the isolated site now reuses the existing authorized connection. No production repository setting was changed.

## Not executed / limitations requiring review

- No live paid Stripe transaction, new signup/password-reset email or real contact/customer email. Existing behaviors are covered by regression mocks, actual existing-auth tests and unchanged settings, not a newly observed delivery/payment.
- No exhaustive semantic contradiction detection or factual verification of every sentence, global anonymous→signup→paid analytics collector, organization monetary token ledger, or statistical learning from outcomes. Those requirements remain partial and must not be advertised as complete.
- Contract duration/value are not newly inferred fields: existing source-backed contract/pricing facts are displayed and unextracted fields remain visibly missing.
- Current public vendor-by-vendor comparison could not be verified under available network access. No competitive superiority claim is made.
- No production load test, all-browser compatibility claim, OCR for scanned PDFs, perfect DOCX pagination/fidelity, or independent compliance certification.
- Production migration requires explicit approval plus the current backup/restore procedure and scoped release review. This branch is not a production approval request while the embedding blocker is open.
