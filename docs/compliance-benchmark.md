# Compliance preview benchmark

This is a functional acceptance benchmark, not a measured comparison of AI
accuracy or a claim of feature parity. Requested comparators: Loopio,
Responsive, AutoRFP.ai and RocketDocs.

The repository's competitive assessment branch already documents Loopio's
approved library/project collaboration and Responsive's content/team response
management, with official source links. Private libraries and organization
collaboration exceed this preview's scope. Stripe Directory is required by the
available lookup skill before new vendor comparison research. Its CLI is not
installed, shell network access is blocked, and its setup page could not be
read through the available web tool. Therefore AutoRFP.ai/RocketDocs capabilities
were not independently verified during this implementation.

| Workflow target | Implemented acceptance behavior | Evidence |
| --- | --- | --- |
| Import and understand an RFP | PDF/DOCX/TXT; multiple sources/amendments; exact extracted text review | Real fictional extraction tests |
| Government compliance | Section L/M headings; mandatory language; explicit scores only | PDF and AI validator tests |
| Commercial/vendor evaluation | Qualifications, technical, service-level, pricing and contractual categories | DOCX fixture and structured schema |
| Trustworthy traceability | Exact source quote; server-assigned source/page/section; original download | Extraction and API tests |
| Review/collaboration | Editable rows, owner labels, notes, version conflicts | API review tests; owner labels do not grant team access |
| Evidence gaps | Needs Review initially; evidence/reference required for Compliant | API and metrics tests |
| Amendment/duplicate handling | Exact duplicates merge; similar/conflicting rows stay visible | Pure merge tests; SQL transition test pending |
| Usable output | Search/filter/sort; summary metrics; CSV and genuine XLSX | Export/model tests and independent openpyxl read |
| Preserve commercial workflow | Preview never writes Airtable, sends email or changes billing | Network allowlist mocks and existing regression suite |

Suggested quality benchmark before enabling production: have procurement
reviewers label 20 synthetic government/commercial/SaaS/nonprofit RFPs, including
conditional mandatory clauses, negations, tables, scanned pages and amendments.
Measure atomic requirement precision/recall, mandatory classification,
exact-citation validity, explicit-weight accuracy, missing-evidence behavior,
latency and cost. Use the same documents and expert rubric when legally
evaluating any comparator. No quality, win-rate or time-saving uplift has been
measured in this change.
