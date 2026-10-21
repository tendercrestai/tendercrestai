# Source-bound AI extraction fix

A realistic PDF exposed a reliability problem missed by the initial small-fixture
checks: the model paraphrased some quoted requirements and summarized fact values
instead of copying exact source substrings. Strict validation correctly rejected
the entire chunk, but repeated retries could reproduce the same error.

The provider now selects server-owned excerpt IDs and unique fact-option IDs. The
server supplies original text, segment/page/section provenance and fact values.
The schema restricts selections to the current chunk; invented IDs, extra fields
and cross-source reassignment are rejected. PDF-wrapped sentences retain negation
and conditions. Existing exact-source validation, review evidence rules, retry
limits and spend reservations remain active. There are no fuzzy quote matches or
silent acceptance of paraphrases.

Explicit single scoring weights and labeled deadline/timezone data are retained
from literal source options. Ambiguous or missing information is not inferred.
Facts can contain an entire source sentence when no shorter literal option fits;
reviewers must still check semantic completeness and relevance.

The processing fingerprint is versioned as compliance-v2-references. Existing
analyses and review rows remain readable. Preparing the same sources with the new
engine creates a separately budgeted analysis; old retry counters are not reset.
An affected PDF completed with 19 verified requirements under the corrected
engine. Its exhausted original run was preserved. No source text or credentials
are included in this report.

Validation: 76 assertions on the PR branch (94 with current-main billing coverage),
20 real-provider synthetic cases recovered 100/100 labeled rows, all explicit
weights/timezones, plus actual isolated Netlify TXT/PDF/DOCX processing, real AI
persistence, account denial, browser review/conflicts/exports/handoff/sign-out.
The corrected realistic PDF also completed. Synthetic tests do not establish
expert-reviewed procurement completeness.

Only the independent test preview was deployed. Its Netlify team-login protection
was restored after testing. No production migration, PR merge or production deploy
was performed. Production remains subject to the previously documented operator
privacy/spend, secret-scope, migration and rollout approvals.
