# Integrated proposal release: observed verification

Status: **implemented and deployed to an isolated test preview; production launch blocked**. This report does not mark the four features live in production.

## Resumed access audit — 2026-10-24 UTC

Current observations supersede conflicting historical statements below.

- Connected GitHub app can read and update this repository. The shell proxy is unreachable and shell GitHub authentication fails. Branch recovery confirmed implementation commit `5fe47f6b5bd8d115b03481a11b57f033d32614f8`; GitHub main remains `53d3416f4bf92a1a4a3c3eab5ca8300f39a12a93`. Both PR search and the repository pull-request collection returned no release PR before creation. No AGENTS.md exists in the candidate tree.
- Reconstructed the owner-used backup helper fixes: explicit `desktop-linux` context, require local `npipe://` endpoint, pin every subsequent Docker invocation to that context, separate process-name/readiness commands, and accept `postgres` or `.postgres-wrapp`. Published helper commit: `ae1f612a3d6d4000cfa496391d95c9906526ab0e`. Windows execution and PowerShell syntax validation were not rerun in this runtime.
- Owner reports a private production backup created `2026-10-24T06:30:19.7245359Z`, 595530 bytes, SHA256 `4C84E8B9BF3BCE0D5BC6CEDF8A67EE2606651D786C5EBDC6921E6D4550023B36`. Dump, archive inspection, and full data/schema restore exited 0; temporary database removed. Ownership/grants and object bytes were excluded. This supersedes the earlier report of no full restore test. The archive remains private on the owner's Windows computer.
- Read-only Supabase queries confirm production has no `public.pw_projects`, six storage-object metadata records, and migration versions through `20261023010000`; test has `pw_projects` and version `20261023160000`. No production database mutation was performed. Schema history is consistent with no intervening migration, but intervening row changes and backup freshness at eventual deployment have not been established. Storage metadata is not proof of object-byte recovery; separate recovery verification remains pending.
- Recovered candidate text files through GitHub. Local DejaVu fonts match both candidate Git blob hashes. Static site build and whitespace check pass.
- Current Node execution: 16 of 18 suites pass; 141 assertions pass and two PDF extraction assertions fail in the incomplete dependency installation. The proposal-workspace suite cannot load `pdfkit`. These results do not establish a green full regression suite. Six notification mock checks and eleven proposal API checks pass. Online npm install cannot reach the configured proxy; offline installation lacks required cached packages.
- Disposable SQL checks cannot run because this non-root executor is denied access to its Docker socket. Hosted/browser, retention, export and three-person checks below remain historical; they were not rerun.
- No Netlify tool or runtime credential is available. Actual production/candidate deploy, deployed commit, flags, and provider configuration have not been reconfirmed. No Resend tool or configured runtime secret is available; real sandbox notification acceptance/delivery remains unverified. No email was sent.
- Production migration, merge, deployment and activation remain gated on storage recovery, complete current candidate validation, provider access/current-state verification, and live sandbox notification verification. Rollback remains: disable live proposal email if affected, set workspace and all four component flags false, redeploy previous verified production commit, and preserve additive tables/bucket.

## Historical audited baseline

- Repository/main and actual production deployment: `53d3416f4bf92a1a4a3c3eab5ca8300f39a12a93`, PR #12.
- Production Netlify deploy: `6adb7cffdaa7ef8d80b46dfe`.
- Production Supabase: `vfdwaqgfepvoujprtuww`, PostgreSQL 17.11, vector extension 0.8.2.
- Existing migration history: `20261013070336`, `20261013073847`, `20261022060000`, `20261022090000`, `20261023010000`.
- Existing secure RFP metadata, private upload buckets, compliance, knowledge, membership/invitations, billing/trial/credit and submission functions were inspected. Historical release notes were checked against deployed commit and schema metadata.
- No `pw_projects` table or `20261023160000` migration existed in production at the final read-only check. Main and the published deploy remained on the baseline commit.

## Isolated release candidate

Preview: https://kb1--tendercrestai-pr6-isolated-20261021.netlify.app/workspace.html

Candidate Netlify deploy: `6adb91e22ba37cf6fec35757` (isolated site only).

Separate Supabase project: `wcrrywzleylmdsqqlise`. New feature flags are enabled only on this isolated site. Signup/reset submissions and customer proposal-email delivery are disabled in the copied test UI/deployment. Tests use existing authorized fictional accounts, never real customers. No new subscriptions or service accounts were created.

The additive migration was tested in fresh PostgreSQL 17/pgvector containers with networking disabled, then applied only to the separate test project. Subsequent unreleased function fixes were tested there. Test schema/function behavior was checked again against the final migration source.

## Observed passing checks

| Check | Observed result |
| --- | --- |
| Complete Node regression suite | 165 tests, zero failures; includes prior billing, trials, credits, duplicate protection, auth/upload/compliance and knowledge tests |
| Disposable database suite | 41 assertions: two tenants, explicit project access, viewers, role boundaries, RLS, private storage guard, immutable snapshots, CAS, idempotent jobs, leases/retries, approved-only evidence, source changes, opt-in notifications, atomic outbox, scheduled reminder deduplication and revoked-worker cancellation |
| Hosted browser suite | 18 checks: real login, account navigation, all workflow destinations, autosave/reload, preserved conflicting text, unchanged winning revision, stale assessments, blocked readiness, exact sources, mobile layout, viewer restrictions and no browser exceptions |
| Hosted final security pass | 20 checks: static source exclusion, private worker no-op without secret, private original download, cross-tenant denials, direct RLS, immediate revocation and creator-only deletion of abandoned empty test projects |
| Hosted retention/deletion | Six checks: private attachment copy/download, creator deletion, deleted-object denial and preservation of the original knowledge document |
| Final hosted export/evidence pass | 16 checks: saved-revision package, independent DOCX/PDF/XLSX readers, exact source excerpts, internal-comment exclusion, actual PDF count, approval invalidation and stale final-download denial |
| Real provider ingestion/analysis | One fictional company document processed through real embeddings; one multi-section fictional RFP analyzed through the existing AI service, producing nine requirements |
| Three-person hosted journey | Owner, author and reviewer completed source matching, evidence review, changes requested, edits, section approvals, cited fit assessment, human decision, rendered checklist, final sign-off and final ZIP |
| Independent DOCX rendering | LibreOffice opened and rendered the generated fictional DOCX; visible contents, headings and response text verified |
| PDF pagination | Independent PDF reader agreed with manifest; representative final hosted package had five rendered PDF pages |
| XLSX validity | Independent openpyxl reader opened the matrix and summary sheets |
| Dependency audit | Zero reported vulnerabilities after pinning fflate 0.8.3 |
| Static publication allowlist | Server source, SQL, fixtures, tests, fonts and internal docs excluded from public assets |

The fictional RFP includes mandatory security and certification criteria, delivery/experience, an attachment, evaluation weighting, a page limit, conflicting timeline wording, an explicit amendment, and an untrusted instruction appendix. The amendment explicitly resolves the timeline conflict. The generated proposal never invents a company claim from that appendix. Separate tests cover explicitly expired certifications, contradictory company figures, unsupported claims, partial mandatory eligibility and unknown factors.

The final package includes editable DOCX, PDF, compliance XLSX/CSV, a private supporting attachment, source references and a manifest. Its readiness flag was true only after actual rendering and authorized final sign-off. A subsequent approved-answer edit immediately made the project stale and blocked its old final package. Reapproving that answer did not silently revive project approval. The retained preview intentionally demonstrates this needs-review state after the invalidation test.

These are observed synthetic engineering checks, not proof of real-world procurement completeness, certification authenticity, legal sufficiency or win outcomes. DOCX pagination remains unmeasured. Deterministic drafting copies approved answers and clearly marks missing input; it is not a free-form claim-writing model.

## Unfinished external gates

1. **Recoverable production backup:** available provider metadata listed no backups. The environment has no `BACKUP_DB_URL`/database-password credential. The owner previously reported a private Windows archive with successful dump and archive inspection, but no full restore test and no storage-object files. A fresh restore-verified backup and storage recovery confirmation remain required before production migration/deployment. No dump should be uploaded to the public repository or pasted into chat.
2. **Live email sandbox verification:** six mocked notification tests passed, including provider idempotency, timeout/retry, opt-in allowlisting and removed-member suppression. The real request to the provider-defined `delivered@resend.dev` sandbox was blocked by the environment's HTTPS policy before a provider response. A draft adding `api.resend.com` was saved and requires environment review/save/publish. No live delivery success is claimed and no customer message was sent.
3. **Production release and smoke:** merge, production migration, deployment/feature activation and controlled production journey have not happened. Existing production behavior remains unchanged. Use authorized production test identities; do not create new accounts or contact customers without authorization.

Production authorization already exists for the coordinated release after checks pass; these are verification prerequisites, not a request for a new blanket deployment approval. Follow the migration, backup and rollback gates in [the release runbook](integrated-proposal-release.md).
