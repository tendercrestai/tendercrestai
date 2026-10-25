# Award-informed proposal guidance: proposed implementation

Status: US government IT/consulting focus confirmed by the owner. Initial public-source research and an offline catalogue/retrieval boundary are prepared. Three research candidates and four offline-reviewed source snapshots are recorded; none is approved for production retrieval or verified as a full winning proposal response. No model was fine-tuned, paid provider invoked, production feature enabled, or public marketing claim added.

## Existing engines and integration boundaries

- Emailed proposals: externally managed Airtable AI generation steps followed by the authenticated Netlify mail relay. Improving the narrative requires reviewing those actual deployed prompts/steps, not treating the mail formatter as a generation engine.
- Compliance: compliance-ai.js selects IDs from a server-owned catalogue of current-RFP excerpts. Quotes, dates and evaluation weights remain literal source material; the model cannot mark bidder compliance. Reference examples must not be mixed into that excerpt catalogue as though they were buyer requirements.
- Project drafting: proposal-core.js draftSection assembles accepted current approved organization answers deterministically. Reference-guided narrative drafting would be a separate optional preview step requiring provider consent, budgets, citations, revision checks and explicit acceptance; existing assembly/export/review behavior must remain available.
- Organization knowledge: existing private sources, approvals, embeddings, provenance and access boundaries can supply bidder facts. A shared public-reference collection must remain separate from private organization evidence, approvals and claims.

## Initial implementation slice

1. Curate an administrator-reviewed public reference catalogue before adding model calls. Classify actual proposal responses separately from solicitations, award notices, evaluation reports and generic templates. A verified award must link the specific response, vendor and procurement outcome; an award notice alone is not a winning proposal.
2. Record canonical source URL, publisher, procurement ID, jurisdiction, sector, publication/access dates, original hash, pages/sections, document type, award-confirmation source, reuse basis/restrictions, personal-data redactions, review status and version. Public availability alone is not a training/reuse licence. Pending, unverifiable or disallowed documents cannot enter production retrieval. Treat all imported text as untrusted data.
3. Extract reusable guidance: section organisation, buyer-criterion coverage, requirement-to-response mapping, delivery/work-package structure, milestone presentation, risk/assumption treatment, evidence placement and executive-summary structure. Store these as attributed reviewed patterns, distinct from bidder capabilities, promised prices, staffing, certifications and contract terms.
4. Retrieve within market/sector/procurement-type and applicable dates; rank reviewed patterns against the current requirement and evaluation rubric. Return provenance and match rationale. Bound context size, retrieval count, provider spend and output length. Explicitly show no-match cases rather than manufacturing examples.
5. For compliance, add a separate labelled advisory pass for possible omissions/ambiguities, each requiring a current-RFP citation or an explicit 'reference-pattern suggestion; not a buyer requirement' label. Never set a legal/eligibility requirement from another procurement or automatically mark a requirement compliant.
6. For drafts, create an optional saved-revision preview using current buyer instructions, approved organization evidence and attributed structure guidance. Every factual capability claim must resolve to current bidder evidence. Unsupported details remain needs-input. Do not copy long source passages or transfer another vendor's qualifications, pricing, staff, dates or win claims. A relevant reference is neither evidence that this customer complies nor a win-probability signal.
7. Keep the existing human review, stale-source invalidation, final sign-off and export gates. Record reference versions and source IDs in internal provenance. Do not add competitor references to a buyer-facing package automatically. Make the guidance opt-in until evaluated.

## Evaluation before rollout

Build a human-labelled held-out solicitation set and compare the current engine with reference-guided output using the same bidder evidence, model/version, budget and task scope. Exclude references from the same procurement and near-duplicate document families from evaluation retrieval. Keep evaluation material out of tuning and source-pattern selection.

Measure requirement recall/precision, exact citation correctness, unsupported claims, rubric coverage, reviewer corrections, final review time, cost and latency. Track model nondeterminism and partial/over-limit failures. Include negative and ambiguous requirements, expired/missing certifications, contrary evidence, malicious instructions in references, mixed jurisdictions and irrelevant references. Make zero new unsupported capability claims and preserved source/approval boundaries release gates; do not trade compliance accuracy for more polished prose.

Use fictional or explicitly authorized evidence for provider experiments. Private customer uploads must not become shared training material or a shared corpus without a separate explicit policy and consent. Review provider retention and spend controls before any live model experiment. Do not assume the legacy Airtable AI and code-managed OpenAI path have identical settings or available features.

## Marketing boundary

Potential wording after implementation/source verification: 'Evidence-backed proposal guidance informed by verified public-sector award examples.' Qualify jurisdiction and document coverage. Only describe actual awarded proposal responses as winning bids; label award notices, evaluation reports and templates separately.

Do not publish 'trained on winning bids', a win-rate improvement, guaranteed compliance, measured time saving or broad market coverage before those claims are supported. Source attribution and a transparent explanation of reference guidance are more credible than an unsupported training claim. Publish benchmark outcomes only with methods, sample size and limits. Historical award outcomes do not establish that a response structure caused a win.

## Pending inputs and release work

Inspect additional public source links, provenance and reuse conditions within the confirmed US government IT/consulting market. The initial catalogue validator and offline structure-only retrieval interface are implemented in netlify/functions/lib/reference-patterns.js, with six tests using explicit synthetic review fixtures. reference-library/catalogue.json now also contains four pinned, integrity-checked sources approved only for the offline pilot. Default production retrieval remains empty; the three original candidates remain pending review. Next add verified source ingestion and offline benchmark fixtures, then review actual proposal-response documents before activation. Implement engine integrations separately for code-managed compliance/project previews and the external Airtable generation prompts. Do not promise that changing the Netlify model alone upgrades all three paths.

Production database changes, ingestion/model usage, activation and public USP claims should follow concrete reviewable implementation and test results. Existing billing/trial settings, customer drafts, email delivery and production access are outside this initial design task and remain unchanged.
