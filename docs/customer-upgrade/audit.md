# Phase 0 audit — 2026-10-25

Baseline e592f9b7224138b4f60c872abeae2ea0552713ba. Tracked repository inventory: 180 files. Static HTML/CSS/browser ESM, Node >=22.13 CommonJS Netlify functions, Postgres/Supabase. No application framework or separate vector service. Build uses an explicit public-file allowlist, Netlify esbuild. Dependencies: docx, pdfkit, fflate, pdfjs-dist, sax. No GitHub Actions workflows; Netlify repository builds are the release path.

## Existing feature inventory
| Capability | Classification | Reused implementation / evidence |
|---|---|---|
| Authentication/signup/reset | Implemented; hosted regression pending for this change | auth.html, Supabase auth; existing session validation |
| Upload/parsing | Implemented with limits | private-rfp-upload, rfp-document, compliance-document; PDF/DOCX/TXT, scanned PDFs expose extraction gaps |
| Source-backed requirement extraction | Implemented | compliance-ai selects server-owned excerpts; validated categories, evaluation weights and source facts |
| Compliance matrix | Implemented | compliance API/model/export; human review separate from matching |
| Bid fit | Partial vs requested | proposal-core.assessment; five legacy dimensions, human input, evidence, disqualifiers; lacks requested new default dimensions/report |
| Strategy dashboard | Partial | assessment and decisions exist; practical exportable strategy report missing |
| Quality audit | Partial | final checklist, limited numeric company-fact conflicts, expiry; aggregate quality scoring and cross-passage findings missing |
| Knowledge library | Implemented; metadata partial | organization-scoped documents/chunks/answers, approved revisions, citations, vector/full-text retrieval; structured freshness/type metadata incomplete |
| Proposal studio | Partial | per-section deterministic approved-evidence assembly, editor, previews, job queue, CAS; whole-proposal preview and reuse/outcomes missing |
| Collaboration | Implemented | explicit project grants intersect organization roles, assignments/comments/reviews, immutable history; email reminders disabled |
| Word/PDF | Implemented | proposal-export worker; saved-revision ZIP, tables, branding, measured PDF pagination; DOCX fidelity not guaranteed |
| Billing | Implemented | Stripe webhook -> Airtable; existing submission/credit RPCs; card-required 14-day selected-plan trials |
| Delivery/contact | Implemented | authenticated Airtable relay -> Resend DOCX/HTML; contact endpoint; no change authorized to sending state |
| Anonymous demo | Partial | screenshot tour and downloadable fictional files; no three-scenario interactive journey |
| Onboarding | Partial | library checklist computed in browser; no saved project-wide guided setup |
| Analytics | Partial | project events/job timestamps; no integrated conversion view or anonymous event collector |
| Duplication/obsolete | Research-only legacy evidence table exists in test | Do not use test-only proposal_evidence or rerun old upload migration for missing history |

“Implemented” describes source and prior release evidence, not a fresh end-to-end pass for this release. New test report records checks actually run.

## Read-only live schema audit
Management API access succeeded against production vfdwaqgfepvoujprtuww and test wcrrywzleylmdsqqlise. All public tables observed have RLS enabled; rfp-documents, kb-documents and proposal-artifacts are private in both. Production records compliance, billing, knowledge and integrated-workspace migrations. Older upload history is absent although objects exist: do not rerun it. Test has extra historical migrations/table; do not assume schemas identical. No production mutation performed.

## Integrations and controls
Existing OpenAI chat completion configuration: COMPLIANCE_AI_API_KEY/MODEL; embeddings KB_EMBEDDING_API_KEY with text-embedding-3-small. Knowledge ingestion and proposal exports use existing leased/retryable background functions. New deterministic work must not create additional model costs or invented confidence. Airtable submission/generation automations and Stripe trials must remain untouched. No secret values copied to documentation.

Runtime Netlify/Supabase bindings are configured but readiness reports unknown; actual management read succeeded. Google/competitor sites are not configured destinations. Attempts to access competitor websites failed through the normal proxy; no access bypass attempted. Current public competitor claims cannot be verified here. Benchmark matrix is explicitly provisional, using capability categories rather than unverified feature/price assertions.

## Coordinated implementation approach
Reuse versioned project state for strategy, quality audits, onboarding, profile and outcomes; existing pw_revisions and pw_events retain history. Extend source metadata on existing kb_documents rather than duplicate storage. Keep any new metadata migration additive and test-only until approved. Anonymous demo uses bundled fictional precomputed data, no auth/AI/endpoints. Preserve screenshot tour. Gate authenticated enhancements behind one default-off server feature flag. No production secrets, migration, deployment, billing or outbound messages changed.
