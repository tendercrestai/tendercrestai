# Isolated hosted validation — 2026-10-22

Status: partially complete. The newly published environment can reach the `kb1` preview. Its deployed embedding credential currently fails with OpenAI 401/invalid_api_key; do not merge or enable production from this report.

## Separate-environment observation — 2026-10-22 (historical)

This section preserves an independent continuation in a different environment. Its access blockers and diagnostic status describe that environment at that time; the subsequently published environment and current kb1 results below supersede those recovery requirements.

The feature branch was independently fetched and resolved to `71ae180b504b0466ccfd9d9b4d371c128fe1d39a`. The previous `/workspace/scratch/knowledge-base-hosted/` artifacts and `/workspace/tendercrestai-knowledge-base` checkout did not transfer. A new feature worktree was restored at that checkout path; no prior deployment archive, fictional-user credentials or diagnostic-function source was recovered.

Current environment inspection reports no configured Netlify/Supabase secrets or runtime variables, no outbound identities and no custom allowed hosts. Network-policy readiness is `unknown`, not `enforced`. Actual HTTPS probes through the inherited proxy returned tunnel `403 Forbidden` for `api.netlify.com`, `api.supabase.com`, `api.openai.com`, `wcrrywzleylmdsqqlise.supabase.co`, and `kb1--tendercrestai-pr6-isolated-20261021.netlify.app`. `cdn.jsdelivr.net` also returned tunnel 403 despite appearing in the package-manager preset. GitHub HTTPS and `registry.npmjs.org` returned 200; authenticated Git fetch succeeded. GitHub API access through `gh api` returned Forbidden, so PR existence remains unverified.

These are environment-access failures, not new application/provider failures. No hosted check, diagnostic invocation, embedding request, migration or deployment was performed in this continuation. The temporary diagnostic remains unverified and must still be inspected and removed from the isolated artifact after use. Previous completed results above are historical evidence; they were not rerun.

Recovery requirements, before resuming the remaining gates:

1. Provide effective HTTPS access to the five blocked service/test hosts above and `cdn.jsdelivr.net`; preserve GitHub and required package-registry access. Verify policy readiness and actual requests after the environment configuration is activated. The currently inspected draft has no custom rules; the older saved network draft is not present here. Saving a draft alone does not activate it. No environment configuration was changed or published in this continuation.
2. Bind a Netlify API credential as `NETLIFY_AUTH_TOKEN`, scoped through the environment credential mechanism to `api.netlify.com`, with access to the existing isolated site `6e9deecc-bd7c-45c1-be22-ff1dd016e1f5`. Inspect that site's existing Branch deploys bindings before requesting additional credentials. Do not replace `KB_EMBEDDING_API_KEY`, copy it into another persistent context, or use a generic site ID for writes. No additional OpenAI credential is needed to test the existing runtime key.
3. Recover the isolated deployment source/manifest and safely inspect its protected `kb-runtime-check` implementation and test bindings. If it cannot be recovered through authorized Netlify access, report that specific gap before reconstructing it. Reuse test-project bindings for hosted validation; only request a Supabase management credential if a verified task actually requires management access. Existing migrations do not need reapplication.
4. Continue with bounded runtime/query checks and the new fictional-document browser flow on actual branch `kb1`, preserving durable retry counters. Remove the diagnostic function when finished. Recheck production deployment metadata read-only once API access is available; no current baseline comparison is claimed here.

Review status remains blocked on hosted evidence. No PR creation, merge, production change, subscription change or customer email is claimed.

The owner explicitly authorized test deployment, test-only migrations and limited real embedding calls using fictional data. Test Supabase project: wcrrywzleylmdsqqlise. Netlify test site: tendercrestai-pr6-isolated-20261021. Completed hosted checks used the `pr6` preview. The replacement actual branch preview is https://kb1--tendercrestai-pr6-isolated-20261021.netlify.app/knowledge.html; Netlify reported deploy `6ada4179dccb3d7b458960ce` ready. Network access was subsequently published and real runtime/browser checks on that hostname completed as described below.

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

The owner updated KB_EMBEDDING_API_KEY for Branch deploys on the isolated Netlify site. Direct requests from the managed environment returned HTTP 200 and valid 1536-dimensional embeddings. Those results do not prove the Netlify runtime credential works: outbound credential handling differs from the deployed runtime. Do not overwrite it from the older chat credential. Persistent credential contexts were not broadened.

Netlify routing checks found a manual `pr6` alias colliding with an actual deployed `pr6` branch: ready manual deployments did not serve their diagnostic function at that hostname. A separate actual source branch `kb1` was built successfully, with KB_WORKER_ORIGIN pointing to its exact origin. After environment publication, a worker-secret-protected diagnostic verified that the runtime key matches the saved Branch deploys value and that the model is text-embedding-3-small. OpenAI rejected the deployed credential with 401/invalid_api_key. Safe format inspection also found that the saved value lacks the expected sk- prefix; no key values were printed. The authenticated application search returned the expected sanitized 503 configuration error. The temporary diagnostic was removed by isolated source rebuild `6ada9bbb4b6fb5852e31de8e`. Netlify reports it ready, its function list excludes the diagnostic, and the public diagnostic path returns 404. The workspace and public configuration still return 200. A final read-only comparison confirmed the production published deploy is unchanged.

Provider-error handling now distinguishes denied key/model access (503), provider quota/rate limits (429), and other upstream failures (502), without exposing upstream messages. Regression coverage for 401/403/429/500 passed as part of the 114-test suite.

Remaining gates: verify stable hosted query access with the refreshed test key; finish full browser upload/index/search/draft/approve/download flow and live query-based approved/draft retrieval. Existing review/download/approval browser checks and database retrieval checks are already complete. The network publication gate is resolved. Replace only KB_EMBEDDING_API_KEY in the isolated site Branch deploys context with the actual embedding-capable OpenAI key, then rebuild the kb1 source branch and resume bounded live checks. No additional key contexts, plan upgrades or production edits are needed. Retain durable retry counters; never reset them to make tests pass.

Nine additional real mobile Chromium checks passed on the newly reachable kb1 hostname: password login, organization/source access, exact source quotation, byte-identical private download, audit history, responsive layout, logout denial, absence of production/email/payment requests, and absence of JavaScript errors. These checks do not claim the unfinished AI upload/search/approval flow passed.

Production's published deployment was compared before/after and remained unchanged. No production database migrations, environment edits, merges or subscription upgrades were made. Initial incomplete test uploads remain unpublished; attempted cleanup was rejected by the service with HTTP 405 and successful preview deployments were preserved.
