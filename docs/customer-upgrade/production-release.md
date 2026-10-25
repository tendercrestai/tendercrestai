# Controlled production release

The owner authorized productionization after testing passes. The later conditional approval supersedes earlier instructions to keep this candidate staging-only, for the concrete release below. Earlier scope limitations remain: literal rather than exhaustive semantic contradiction checks, no global conversion collector or monetary token ledger, and no newly inferred contract duration/value. No claim of training on winning bids or improved award probability.

## Cleared provider gate

The replacement embedding key is active on the isolated site. Verified published rebuild `6ade2ee424903b22771ea3e1` (application tree includes diagnostic commit 88b1700 and report-only commits). Semantic search returns 200. A new fictional document was privately uploaded, embedded/indexed, cited in an approved answer and source metadata, matched to a fresh RFP, assembled into a reviewed proposal, audited, signed off, exported to Word/PDF with verified hashes and reused as a draft answer. All 13 assertions passed. The last test initially selected by category Technical; the model had selected another valid category. Selecting the actual approved source-backed section completed reuse without application changes. Previous provider-access failures are superseded, not erased.

## Backup and recovery review

Owner-held full private data/schema backup and successful restore confirmation: 2026-10-24T06:30:19.7245359Z, SHA256 4C84E8B9BF3BCE0D5BC6CEDF8A67EE2606651D786C5EBDC6921E6D4550023B36. Ownership/grants restoration was excluded; uploaded-object recovery was separately reported by the owner, not independently inspected. Production kb_documents has two rows, latest updated 2026-10-23T01:46:20.097817Z, predating that backup.

Fresh read-only snapshot captured the two affected document-metadata rows, organization FK context and prior pw_candidates definition. Restored those current rows into a private, network-disabled disposable PostgreSQL/pgvector container. The exact additive migration preserved every prior document field, and the prior candidate function restored successfully. Snapshot encrypted with AES-256-GCM; key private and separate from the ciphertext. Local recovery staging is not claimed as durable off-project retention or a replacement for the owner's full backup. Migration touches no uploaded object bytes and performs no existing-row updates/deletes. Normal rollback preserves the added column and metadata.

## Concrete production action

1. Retain rollback deployment 6add8b2a931dbf060daeb255, commit e592f9b7224138b4f60c872abeae2ea0552713ba.
2. Production site only: set PROPOSAL_INTELLIGENCE_ENABLED=false and replace only the expired Production KB_EMBEDDING_API_KEY with the isolated, successfully tested dedicated embedding key. Preserve every other credential, trial/billing setting and PROPOSAL_EMAIL_LIVE=false.
3. Apply only 20261025090000_customer_knowledge_metadata.sql to vfdwaqgfepvoujprtuww, transactionally with metadata/history existence guards, lock timeout and migration registration. Do not rerun old upload or other migrations. Verify service-only grants, RLS/private buckets and preservation of existing document fields.
4. Merge PR #19 normally only after required checks pass; do not bypass protections. Verify exact merged commit in the published production deploy with enhancements disabled.
5. Verify public demo, existing settings, anonymous denial and the already-authorized fictional Test1 owner. Confirm actual production embedding search using only a fictional query. Enable the new flag and redeploy the same commit only after initial verification.
6. Final smoke: role/access boundaries, new sections and audit gates, browser/mobile behavior, source exclusions, unchanged Stripe trial links and email state. No card charge, customer message, new account, generation automation or paid infrastructure.

Rollback: set PROPOSAL_INTELLIGENCE_ENABLED=false and redeploy the verified commit, or restore prior deploy if necessary. Keep the additive schema and customer records. Restore neither the expired credential nor a full database merely to roll back UI/code. Full disaster recovery is a separate action.

Execution result is recorded after the action; this preparation section alone does not claim production completion.
