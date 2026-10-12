# Start a separate proposal using the same document

Previously, Upload another RFP cleared the status tracker but left the file's retry IDs in sessionStorage. Selecting the same document with changed inputs reused its original reservation and raised the restore-inputs error.

The link is now Start a new proposal. Its explicit action verifies the session, starts a fresh account-scoped attempt mode, stops old progress tracking, and resets the upload form. Selecting the same file then receives fresh document/submission IDs. Previous private sources, ledger rows, and retry state remain intact.

Reloading or retrying the new attempt keeps its IDs stable; changed inputs still cannot silently reset a reserved submission. If changed inputs are detected for an older file, the client checks the owner's ledger. It offers Start a new proposal only when the earlier submission is confirmed queued. Processing/uncertain reservations still require reconciliation rather than blind resubmission.

This creates a separate generation, not an email resend, and uses the account's proposal allowance. No SQL migration, new environment variable, Airtable field, or automation change is required.

Validation: 44 individual Node tests pass, including six new attempt-state checks and the existing status/privacy/submission regressions. Live browser confirmation remains required after deployment.
