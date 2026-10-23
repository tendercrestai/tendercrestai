# Public website: discovery, sample outputs and data handling

This change updates public content and build allowlists only. No server Function, database migration, dependency lockfile, billing/contact handler, email automation or secret is changed.

## Changes

- Correct homepage canonical/Open Graph URLs and robots sitemap reference to `https://www.tendercrestai.com`. Add canonical tags to the public security/contact pages.
- Include homepage, product walkthrough, sample deliverables, security and contact pages in the sitemap. Account, knowledge, compliance and upload workspaces are excluded; account/knowledge now explicitly use noindex, matching existing upload/compliance behavior. Noindex is a search hint, not an access-control mechanism.
- Add accessible `/product.html` and `/samples.html`, link them from homepage navigation, hero and footer, and expose the Knowledge Base account-return link in the homepage feature card.
- Explain the actual current manual handoff between KB evidence, compliance fields and proposal inputs. Do not advertise automatic KB-to-RFP mapping, project-level assignments/sign-off, a proposal editor or general DOCX/PDF export as live features.
- Expand security disclosure for private KB storage, extracted text/embeddings, consent, OpenAI indexing/AI queries, text search, compliance processing, organization access, downstream processing and archival versus deletion. Existing Airtable/Resend proposal disclosure remains. No new blanket zero-retention, certification, or confidentiality promise is introduced.
- Provide six explicit fictional files: RFP/evidence TXT, review matrix CSV/XLSX and prepared draft DOCX/PDF. Every file identifies its fictional nature; the unsupported certification stays unresolved. These are manually prepared sample assets, not customer documents, live AI outputs or proof of general export functionality.
- Copy each fictional asset by exact allowlisted filename. Build continues to exclude internal source, SQL, tests, documentation and credentials.

## Owner-supplied launch activity

The owner supplied this statement for the website in chat on 23 October 2026:

> Within 2 weeks of launch, about 139 proposal leads (560+ pageviews) tested the workflow, mostly noting the straightforward UX and how quickly it flags mandatory evaluation gaps.

Published copy uses approximately 139 proposal leads and 560+ pageviews in the first two weeks, explicitly attributed to the founder and labeled approximate/not independently audited. Informal feedback is summarized without fabricated quotation marks, customer names/logos, measured time savings, accuracy percentages, completed-proposal counts, unique-user counts, customer-conversion rates or contract-win claims. These are activity figures, not a verified customer case study. No customer-specific endorsements or outcomes were supplied.

For a future case study, obtain the participant's publication permission, exact approved wording, named/anonymous preference, measurement dates, denominator, baseline, methodology, and supporting analytics. Review that evidence before publishing outcome metrics or testimonials; do not replace this attribution with an audited-results claim without evidence.

## Sample maintenance

Files under `/samples/` are committed and copied by the normal Node build. The optional `python scripts/generate-public-samples.py` regeneration tool needs python-docx, openpyxl and reportlab locally. These are not production runtime dependencies; Netlify does not install/run the Python script. It has no network requests, model/API calls or customer inputs. Review regenerated binaries before committing them.

## Validation

- 126 existing Node regression tests passed (`npm test`), including public allowlist/dependency checks.
- 20 offline/mobile Chromium checks passed against a temporary loopback static server, with external Auth/fonts intercepted: navigation, walkthrough expansion, six byte-identical browser downloads, attribution, responsive layout, security disclosures, pricing and account entry, no JavaScript errors or application API calls.
- 17 independent SEO/artifact checks passed: exactly one canonical per public page, five production sitemap URLs, private workspace noindex, robots reference, Word/Excel/PDF/CSV readers and unresolved sample evidence gap.
- Mobile screenshots were inspected. No real accounts, emails, proposals, payments or AI calls were used for these checks.
- Evidence: `/workspace/scratch/public-site-fixes/` (not published).

## Publication and follow-up

Publish the reviewed content through the normal PR/main/Netlify flow. No migration or environment change is needed. Verify live canonical/sitemap URLs, all six public downloads, security text and intended source artifact hashes. Preserve all 11 server Functions and existing customer workflows. The preceding production deployment is the rollback target; no database rollback is involved.

After publication, the owner can submit the new sitemap in their verified webmaster/search-console account and monitor indexing. No search-console connection is available here; sitemap submission, index selection and search ranking are not claimed completed or guaranteed. Third-party/provider retention should continue to be checked against the current agreements and configured accounts.
