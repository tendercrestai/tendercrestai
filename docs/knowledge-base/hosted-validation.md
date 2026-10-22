# Isolated hosted validation — 2026-10-22

Status: partially complete. Real indexing and baseline semantic search passed, but provider access is inconsistent; do not merge or enable production from this report.

The owner explicitly authorized test deployment, test-only migrations and limited real embedding calls using fictional data. Test Supabase project: wcrrywzleylmdsqqlise. Netlify test site: tendercrestai-pr6-isolated-20261021. Completed hosted checks used the `pr6` preview. The replacement actual branch preview is https://kb1--tendercrestai-pr6-isolated-20261021.netlify.app/knowledge.html; Netlify reports deploy `6ada4179dccb3d7b458960ce` ready, but runtime checks on that hostname await environment network-policy publication.

## Verified hosted results

- Actual credential access through test Auth, management and Netlify APIs. Both KB migrations applied only to the separate test project; hosted pgvector is 0.8.2.
- KB workspace/functions deployed. Existing submission/email/payment functions are absent from the isolated artifact. Test signup/reset email actions are disabled. Only fictional, administratively confirmed users and synthetic TXT/PDF/DOCX files were provisioned.
- Real password authentication, anonymous/invalid-token rejection, organization bootstrap, membership reads, foreign-organization API denial and direct database RLS isolation passed.
- Actual private Storage uploads in all supported formats passed. Public downloads, foreign-user downloads and overwriting existing originals were denied. Processing without explicit consent was rejected.
- TXT, PDF and DOCX background extraction/indexing succeeded with real embeddings. PDF physical-page citations and DOCX source evidence were verified. Semantic retrieval returned the expected AES-256 quotation without foreign-organization evidence. Completed-document dispatch does not consume additional ingestion attempts.
- Background self-dispatch, pre-provider hash verification, three durable failed attempts, retry ceiling, hosted usage admission, immediate membership revocation and direct RLS denial after revocation passed.
- API role controls, exact-revision approvals, stale-revision rejection, foreign-citation rejection and privileged audit visibility passed. Real pgvector RPC retrieval with previously generated genuine vectors verified draft exclusion, approved-answer citations and edit/archive invalidation. This database retrieval check is distinct from embedding a new live query.
- A DOCX-cited answer was approved, retrieved, then invalidated by archiving its source. Both source viewing and original download were denied afterward.
- Real mobile Chromium login/logout, organization loading, editable cited answers, approval invalidation/reapproval, exact source viewing/download and audit display passed. A confirmed 60-second JWT expired naturally: the hosted API rejected it and Chromium refreshed through real Auth while preserving viewer restrictions. The test Auth lifetime was immediately restored to 3600 seconds.
- All 114 Node tests pass (95 existing +19 KB). Both migrations pass the disposable PostgreSQL/pgvector suite (30 named assertions plus negative privilege blocks). Static build succeeds. No production/email/payment host was contacted during browser tests.

## Fixes found by hosted checks

Large function ZIP uploads reset the connection. Netlify successfully built the small isolated source archive on its existing infrastructure; no subscription upgrade was made.

The isolated site's Netlify team-login gate blocked access before Supabase Auth. It was disabled only on the test site; app authentication and Storage/RLS remain enforced.

Branch worker dispatch required a stable alias. KB_WORKER_ORIGIN now supports a server-configured HTTPS preview origin under the same trusted-origin validation, with a regression test rejecting HTTP/unrelated domains/path injection.

Stale business revisions used serialization_failure (40001), which the hosted REST/database path retried until requests timed out. The additive 20261022090000_kb_business_conflicts.sql migration switches only the three affected KB functions to PT409, preserving grants. The API maps this to HTTP 409. Direct hosted verification returned 409/PT409 in approximately 0.7 seconds; the full stale-approval/lifecycle suite then passed. The applied base migration is preserved.

## Remaining provider gate

Initially text-embedding-3-small returned 403/model_not_found and was absent from the model list. The owner enabled it. It became visible, readiness returned a genuine 1536-dimensional vector, and all supported document formats indexed successfully. Some subsequent embedding requests still return errors (direct provider model_not_found; hosted API 502). The same valid natural-language query has both succeeded and failed. Session expiry and application admission limits were ruled out for a reproduced failure. These errors are retained as failures, not reclassified as passing searches.

The owner updated KB_EMBEDDING_API_KEY for Branch deploys on the isolated Netlify site. A direct check using that saved key succeeded with HTTP 200 and a valid 1536-dimensional embedding. Do not overwrite it from the older chat credential. Persistent credential contexts were not broadened.

Netlify routing checks found a manual `pr6` alias colliding with an actual deployed `pr6` branch: ready manual deployments did not serve their diagnostic function at that hostname. A separate actual source branch `kb1` was built successfully, with KB_WORKER_ORIGIN pointing to its exact origin. A temporary worker-secret-protected diagnostic is present only in the isolated deployment to verify the runtime key and one fixed fictional embedding; remove it after verification. This new hostname is added to the saved environment network draft but is not yet in the active policy. No runtime success on `kb1` is claimed.

Provider-error handling now distinguishes denied key/model access (503), provider quota/rate limits (429), and other upstream failures (502), without exposing upstream messages. Regression coverage for 401/403/429/500 passed as part of the 114-test suite.

Remaining gates: verify stable hosted query access with the refreshed test key; finish full browser upload/index/search/draft/approve/download flow and live query-based approved/draft retrieval. Existing review/download/approval browser checks and database retrieval checks are already complete. Publish the prepared network-only environment draft before accessing the new preview, then run bounded calls using the refreshed branch key. Retain durable retry counters; never reset them to make tests pass.

Production's published deployment was compared before/after and remained unchanged. No production database migrations, environment edits, merges or subscription upgrades were made. Initial incomplete test uploads remain unpublished; attempted cleanup was rejected by the service with HTTP 405 and successful preview deployments were preserved.
