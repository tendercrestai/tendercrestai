# Validation — 19 October 2026

- 116 automated tests pass across the combined evidence, compliance, submission,
  billing, export and new proposal-quality suites. Test suites execute directly;
  individual assertions were run, not just discovered.
- Real fictional PDF/DOCX/TXT extraction was tested. A Windows font-path separator
  issue was corrected; PDF and DOCX fixtures are marked binary in Git.
- Pinned bundled dependencies: pdfjs-dist 5.6.205, sax 1.6.1. Optional canvas came
  from the bundled runtime via NODE_PATH. Clean npm installation/Netlify bundling
  remains a preview gate.
- Headless installed Edge passed mocked handoff checks at 1280px and 390px:
  source text loaded, linked ID/hash present, partial extraction warnings visible,
  changing source text detaches the matrix. No page JavaScript errors occurred.
  This is not live Supabase/Airtable end-to-end validation.
- Test Airtable draft update passed provider validation. A subsequent read verified
  that its published configuration is unchanged. No automation was executed and
  no customer email was sent. Production Airtable was not modified.
- New tests cover server-side ownership checks with customer JWTs, stale review
  digests, changed source text, unavailable integration, packet size bounds,
  invalid source references, requirement-aware retrieval, actual queued context,
  paired evaluation completeness, fabricated citations and holdout separation.
- Source whitespace checks pass. No production migrations, merge or deployment
  occurred. Live SQL checks were not rerun in this session.
- No baseline/candidate AI outputs were generated or expert-scored here. The 20
  cases and four editorial examples await tender-expert validation. No measured
  quality uplift, editing-time reduction or win-rate improvement is claimed.
