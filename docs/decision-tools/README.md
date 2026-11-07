# Bid checker and public teardown preview

Production baseline: e810356. Routes: `/tools/bid-check`, `/teardowns` and three curated child pages. No production merge, migration, credentials or environment changes are authorized by this build. Owner requested preview review first.

## Bid checker

Uses `F.prepare`, the existing source-validated compliance analyzer and unchanged worker. Atomic `ft_bidcheck_start` calls the same `ft_admit(...,'shred',3,10)` then creates the job and private detail in one transaction. No new paid usage allowance. Answers and the computed verdict live only in `ft_bidchecks`, linked by job UUID with ON DELETE CASCADE. Existing `ft_jobs` data/expiry and `ft_cleanup` are unchanged. Expired capability links cannot read a bid check; hourly existing cleanup removes its detail with the source job.

The five answers are validated server-side. UTC scoring date is set by the database at job creation, displayed with the result, and remains stable across retries/midnight. Mandatory means the extractor's `Yes` rows. A zero-requirement extraction returns no verdict rather than a reassuring score. Ties in top reasons follow factor order. Forced-pass reasons are displayed above the factor list, separate from the highest-scoring top three reasons.

The spec's final override rule is followed: only an already-passed deadline or eligibility No forces a pass. A short window with at least 15 mandatory rows scores zero for deadline, but does not override the total by itself. Consequently that case can still total eight with four other two-point factors; tests make this explicit. This is a fit score, never an award forecast.

The full written report is a UTF-8 `.txt` document with verdict, every score/working line, reasons, complete review flags and the real requirement CSV appendix produced by the existing compliance exporter. The free result shows the prescribed summary and three gap flags. Report requests reuse `ft_lead`, signed job capability, email honeypot, owner notification, provider idempotency and existing test-mode recipient restriction. The shared mail helper resolves bid detail for scheduled pending-lead retries so a bid request receives a verdict report rather than a matrix. Failed mail lookup or provider acceptance leaves persisted pending states; a download is available after lead storage. Provider acceptance never claims inbox delivery.

Metrics reuse first-party usage consent exactly as free tools already do. Bid start/email gate use existing event names; only `bidcheck_completed` is added. No separate tracker. No requests before the email gate send email.

## Owner-approved teardown decisions

Owner explicitly chose authored fictional illustrations, with no claims of real-source extraction results and no exact $2M figure. The index title/intro and federal title were corrected accordingly. The specified 47/28/19 counts, 31/19/12 mandatory counts and 9/6/5 gap counts are editorial fiction, not measured usage or extraction statistics. Every card/page discloses this. The category splits and example gaps are illustrative editorial content using existing category/flag vocabulary.

Owner also approved an additive `ft_leads.teardown_opt_in boolean not null default false`, and a compatible four-argument overload of `ft_lead`. The existing three-argument RPC stays unchanged, without overload defaults that would confuse PostgREST. A matrix request records the optional interest independently of marketing. Existing source/title/email data are preserved. Interest is not publication permission; there is no API/code path that creates content files or triggers publication. Source retention stays 24 hours, lead metadata 90 days. Human review and separate explicit submitter confirmation remain mandatory before publishing a visitor's material.

## Curated content and validation

Add one JSON file under `content/teardowns`, matching `content/teardowns.schema.json`. Rebuild to generate its page, index card, explicit `_redirects` entry and sitemap entry. No visitor data request is used for filters. `teardown-template.html` is the single page template; generated pages use the same `decorateHTML` injection helper as other public pages.

Ajv validates the fixed schema at build and test time. Additional checks enforce category totals, fact consistency, approved type/band values, illustrative provenance, slug uniqueness, and obvious identifier/date/company-suffix/exact-price patterns. Fixed schema rejects fields such as agencyName, noticeId and raw solicitation text. Pattern checks cannot establish complete anonymization of arbitrary prose: a human must check for names, locations, identifying dates, copied text and contextual details before merging any content. Do not publish an example that cannot be anonymized. Do not label authored counts as extractor output.

## Verification and preview

Run `npm ci`, `node scripts/build-site.mjs`, `npm test`, `bash scripts/test-bid-check-sql.sh`, `python scripts/test-bid-teardowns-browser.py`, existing free-tools/comparison/customer journey browser regressions. Docker SQL checks use a disposable networkless database. Browser checks use fictional fixtures and mocked provider calls; they are not proof of actual sending. Hosted preview must separately verify actual sample extraction and lead/report notification in test mode only.

The deliberately malformed JSON fixture test must fail, then remove the fixture. Fourth-file generation is exercised in a temporary copy, including its route and sitemap. Protected-file review covers billing/auth/demo/samples/trackers/consent and the SAM backend. Existing opportunities HTML changes are navigation/footer links only. Existing shredder copy is preserved except the owner-approved opt-in checkbox and navigation links.

Migration `20261107090000_bid_checks.sql` belongs on the isolated test project for preview first. It creates the detail table/RPC, extends the event-name constraint, and adds the owner-approved lead-interest column/overload. Production application is a separate reviewed release step. No environment-value change is needed.

Rollback: revert the PR. Keep additive schema inert rather than drop retained lead metadata. After new bid jobs expire, the detail table/start RPC can be removed if desired; the existing event constraint and default-false column/compatible overload may remain. Before reverting shared mail routing, finish or explicitly suspend pending notifications for new bid-check leads so legacy maintenance does not send them a matrix. No existing customer/job rows need modification as part of applying the migration.
