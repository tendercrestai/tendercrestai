# Isolated hosted validation — 2026-10-22

Status: partially complete; real embedding access is blocked. Do not merge or enable production from this report.

The owner explicitly authorized deployment to an isolated test site, test-only migrations and limited real embedding calls using fictional data. Test Supabase project: wcrrywzleylmdsqqlise. Netlify test site: tendercrestai-pr6-isolated-20261021. Preview: https://pr6--tendercrestai-pr6-isolated-20261021.netlify.app/knowledge.html.

## Completed

- Credential access verified through actual test Auth, management and Netlify API requests. The additive KB migration was applied only to the separate test project; hosted pgvector is 0.8.2.
- Deployed the KB workspace and functions. Existing submission/email/payment functions are absent from this isolated artifact. Test signup/reset email actions are disabled. Only fictional, administratively confirmed users and synthetic TXT/PDF/DOCX files were provisioned.
- Real password authentication, anonymous/invalid-token rejection, organization bootstrap, membership reads, foreign-organization API denial and direct database RLS isolation passed.
- Real private Storage uploads in all three supported formats passed. Public downloads, foreign-user downloads and overwriting existing originals were denied. Provider processing without explicit consent was rejected.
- Real mobile Chromium login, organization loading, layout and logout passed. A verified 60-second test JWT was allowed to expire naturally: the hosted API rejected it, and Chromium automatically refreshed it using the real refresh endpoint while preserving viewer restrictions. Test Auth token lifetime was restored to 3600 seconds immediately after creating the short session.
- Background self-dispatch, pre-provider hash verification, three durable failed attempts, the retry ceiling, hosted usage admission, immediate membership revocation and direct RLS denial after revocation passed.
- All 112 Node tests pass after adding coverage for the explicit worker origin (95 existing regressions +17 KB tests). Prior local PostgreSQL/pgvector and offline browser results remain applicable.

## Fixes found during hosted setup

Large function ZIP transfers reset the connection, including after omitting maps/unused platform files. Netlify successfully built the small isolated source archive on its existing infrastructure; no subscription upgrade was made.

The isolated site's Netlify team-login gate blocked requests before Supabase Auth. That gate was disabled only on the test site; application authentication and private Storage/RLS remain enforced.

Branch worker dispatch needed a stable, explicitly configured alias instead of relying on the runtime's default URL. KB_WORKER_ORIGIN now supports a server-configured HTTPS origin under the same trusted-origin checks. Its regression test rejects HTTP, unrelated domains and path injection. Deployments should set it to the exact preview origin.

## Provider blocker and pending checks

The configured OpenAI key authenticates, but /v1/models lists no embedding models. A real text-embedding-3-small request returns HTTP 403, code model_not_found. A test source safely remains Failed/embedding_failed; its durable retry state is retained. This is not a successful AI test.

The project owner needs to enable text-embedding-3-small under the owning project's model limits, grant the key Embeddings permission, or configure an embedding-capable test API key through environment secrets. No key values are included in this report. There is no ChatGPT subscription upgrade requirement; API project access/billing is separate.

After access is fixed: finish real TXT/PDF/DOCX extraction and indexing, pgvector relevance/citation checks, approved-answer retrieval/edit/archive invalidation, cross-organization semantic search, and full browser upload/search/approval/download flows. Paid-provider outage behavior remains covered by mocks unless separately exercised in the hosted test. No production rollout is approved by this test authorization.

Production's published deployment was compared before/after and remained unchanged. No production database migrations, environment edits, merges or subscription upgrades were made.
