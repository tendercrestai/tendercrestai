# Weekly teardown pipeline

## Reconciliation before implementation

The November 7 export e810356 predates the feature implementation. The repository already contains content/teardowns, teardown-template.html, content/teardowns.schema.json and scripts/lib/teardowns.mjs. Commit 27773d5 implemented the library/bid checker; PR #39 merged it at e0cf88a. Current production 056e62a additionally contains the NYC feed. Earlier instructions in this session authorized those releases. The stale export is not evidence that the implementation was absent from the current repository. This work reuses that library and does not delete or overwrite a live production page.

The existing generator already creates routes and sitemap entries for JSON-only additions and injects the existing consent-gated tracker/analytics modules. These capabilities are reused. Existing launch examples remain explicitly fictional and their authored counts are not relabeled as measurements.

## Runbook

1. Create the ignored working directory with `mkdir -p work`. `node scripts/pick-teardown-candidates.mjs --pages 3 > work/candidates.json` queries the deployed public feed. The server retains its SAM key, one-hour cache and normal admission limits. Set NODE_USE_ENV_PROXY=1 only if this execution environment requires its inherited proxy. No production credential is read by the picker. At most ten supported pages may be requested; never rotate IPs or bypass a limit.
2. A human chooses 2–3 different shapes for a normal week. SAM is federal-only; it cannot provide State/Local diversity. Vary NAICS and verified value bands where available. The current feed does not provide value bands. Unknown values are not inferred from titles, procurement methods or thresholds. The owner approved an explicit unknown-value option for the proof example; it is excluded from all three known-value filters.
3. Append picks/skips to content/teardowns/_weekly-log.md. Never overwrite prior entries. The initial proof run deliberately picked one source, rather than padding a week with thin attachment pointers.
4. Use the unmodified live shredder UI, its processing-consent checkbox and normal limits. Save the completed status JSON privately (the UI network response is enough; remove bearer job tokens before sharing). Do not request an email gate solely to obtain public counts, and do not invoke extraction internals. Sources with fewer than 15 extracted rows or no supported deal-breaker are rejected by the scaffolder/human review.
5. Prepare facts JSON: agencyType, verified valueBand (or explicitly unknown), naicsArea (two digits), responseWindowDays, generic lowercase-hyphenated shape, private source_notice_id and source_picked_date (inputs only), dealBreakerNumbers (1–3 numbered rows), optional short dealBreakerSummary, and bidder answers if a band is wanted. Scoring calls the existing pure bid-check score function; it does not run another shred or modify checker logic. A missing bidder profile stays pending and cannot be marked reviewed.
6. `node scripts/scaffold-teardown.mjs --shred work/private-shred.json --facts work/private-facts.json` creates a schema-valid draft with TODO description/lesson and selected real deal-breaker rows. It refuses malformed input, mismatched counts, duplicate notices and existing files. This is not publication. Keep private input/output outside the public repository and build.
7. Complete the prose from the actual source and anonymize all extracted wording. Public gap previews are anonymized paraphrases, not verbatim quotations. Verify every number and the scope of source coverage. “Gap” flags without responses/evidence are review flags, not proof of noncompliance. Read the original formal solicitation/attachments before claiming full solicitation coverage.
8. Complete REVIEW-CHECKLIST.md as a human, record the reviewer/date and checklist completion in humanReview, and change publicationStatus to reviewed only after actual review. An assistant must not forge a human sign-off. Reviewed content with TODOs or identifying details is rejected.
9. Normal builds validate drafts but exclude them from pages, index, routes and sitemap. An isolated review build may use TEARDOWN_REVIEW_PREVIEW=true to include anonymized drafts with a review warning and noindex/nofollow. Never set this on production. The private source trace and review identities are never rendered or copied into dist. Unknown-value cards remain visible under All values, not a known-value filter.
10. Build/test, open a normal PR and share an isolated preview. Human preview approval precedes merge. This task performs no production deploy, production setting/credential change, schema migration or auto-publication. Rollback is reverting the PR.
11. After the reviewed page is live, use PROMOTION-CHECKLIST.md. Prepare one company-page LinkedIn post per teardown, no more than one/day, with its link in the first comment. No post is sent before publication.

## Measurements

The existing usage tracker sends page_view without path or URL, and existing free-tool events are not linked to a teardown visit. It cannot currently produce the three requested per-teardown attribution measures. Record them as unavailable in the weekly log, rather than adding events or using aggregate site counts as attributed conversions. Existing consent and tracker code is unchanged.

## Proof run and review boundary

A live notice description was processed through the unchanged production shredder UI using one anonymous use: 23 extracted rows, 10 mandatory, 23 review flags; category totals are recorded in the draft. The source references formal solicitation attachments that were not imported. Qualification evidence and on-site warranty-service evidence are the supported deal-breakers, selected from extracted rows 9 and 16.

The owner supplied an example bidder profile: 200 hours, eligible yes, related past performance, most evidence. The existing scoring function returns Strong fit; all four assumptions appear alongside the band. The unknown value label was also explicitly approved. Neither approval is a completed human review of the final teardown. The final human checklist remains pending; no reviewer signature, publication or promotion is invented.

The automated browser used unmodified production HTML/assets and live public endpoints through a fixed verified-TLS local forwarder because Chromium's local certificate trust rejected hosted navigation. No API mock, quota override, database access or worker-internal invocation was used. Raw extraction and the initial TODO scaffold remain private verification artifacts outside the repository.

## Public-repository privacy correction approved by the owner

The repository is public. A field omitted from HTML is still public if committed to Git. The owner therefore approved replacing the specified source_notice_id/source_picked_date JSON fields with only source_fingerprint (SHA-256 of the normalized notice ID). Actual IDs and picked dates go to .private/teardown-sources.json, which is gitignored, and raw shred/facts inputs must stay in .private or outside the repository. Back up the private source index securely outside Git for human traceability; the fingerprint supports deduplication even when that index is unavailable. No raw source identifier/date is committed to source, PR summary or public artifacts. Fingerprints also never render in page HTML, JSON-LD or the index.

## Isolated preview verification

PR #41 contains the pipeline and proof draft. The isolated preview serves four index cards and the source-based page with the expected 23/10/23 counts, example bidder assumptions, noindex marker and generated sitemap route. Hosted HTML/sitemap contain neither actual source IDs nor fingerprints. The private source index is gitignored and was not committed. Normal builds still contain only the three reviewed launch illustrations until the owner approves the human review gate.
