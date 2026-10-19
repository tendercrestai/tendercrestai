# Evidence-grounded proposal research

Research date: 12 October 2026. This is a first implementation, not proof of improved win rates.

## Findings and implementation decisions

- [FAR 15.305](https://www.acquisition.gov/far/15.305) describes evaluation against the solicitation's factors and consideration of relevant past performance. Implementation: criterion-level requirement IDs, current-RFP citations, evidence mapping and no invented scoring weights. FAR rules are context for US procurement, not universal rules for every sector or jurisdiction.
- [FAR 15.506](https://www.acquisition.gov/far/15.506) describes debriefing information and protects proprietary information. Implementation: use permissioned evaluator feedback and distinguish it from bidder credentials; do not assume competitors' full winning bids are publicly reusable.
- [GAO: Practical Solutions, B-419152](https://www.gao.gov/products/b-419152) discusses an award to a higher-rated, higher-priced proposal. Implementation lesson: explain supported technical value and risk, rather than assume the lowest price wins. The public decision is not the full winning proposal and does not prove that a writing style caused the award.
- [GAO: DLT Solutions, B-412237](https://www.gao.gov/products/b-412237,b-412237.2,b-412237.3) discusses rejection for material solicitation-instruction deviations. Implementation lesson: mandatory instructions and pricing formats deserve explicit checks, separate from narrative polish.
- [UK assessment-summary guidance](https://www.gov.uk/government/publications/procurement-act-2023-guidance-documents-procure-phase/guidance-assessment-summaries-html) explains criterion-level feedback under its procurement framework. Implementation: retain evaluator feedback as lessons, with source and outcome metadata, rather than treating every historical winner as a gold-standard answer.
- [NIST SP 1326](https://csrc.nist.gov/pubs/sp/1326/final) addresses supplier due diligence. Implementation: SaaS/security claims need supplied evidence; references cannot establish a customer's certification or security posture.

Commercial proposals are frequently confidential. No authorized commercial winning-proposal corpus was available for this implementation. Existing Airtable commercial references are selection case studies, including sponsored/vendor-authored sources; they are not represented as full winning proposals or independent performance evidence. No new third-party proposal text was copied or automatically approved.

## What already existed

The deployed Airtable automation already retrieved the highest-priority approved example within the submission's sector. Its approved-reference filter checked award verification, reuse review, approval and nonempty AI reference text. These filters are preserved. Its matrix and narrative had grounding instructions, but the narrative did not consume the matrix and there was no independent review stage.

## What changes

Private, customer-approved evidence retrieval supplements the existing reference system. Exact lexical overlap ranks short paragraphs within the correct sector, including All-sector entries. Bid history and feedback are lessons only. The draft consumes the matrix; a third AI stage checks and revises the complete draft, adds a crosswalk/source appendix and exposes remaining gaps. Source approval is customer review, not TenderCrest verification. This does not fine-tune a model.

## Known limits

- Lexical retrieval can miss synonyms, non-English terms or requirements with little keyword overlap. It selects at most eight passages, at most two per source, with a 12,000-character text budget. Paragraphs over 3,000 characters are excluded. It is not a complete evidence audit.
- Past bids are deliberately not factual evidence. Extract current, verified credentials into a separate company-evidence entry if appropriate.
- Outcome labels are customer-reported, not verified awards. No automatic promotion of won bids into approved evidence.
- Prompt instructions reduce risks but cannot guarantee resistance to prompt injection, correct citations or truthful output. AI review can repeat the first model's mistakes; it is not independent expert assurance.
- Current RFP text may omit scanned content, attachments, tables or amendments. Existing extraction limits remain; no OCR or XLSX parser is added.
- Public references remain sector/priority-based; no change to their existing approval workflow. The new private retrieval is paragraph-based and relevance-ranked.
- The additional AI step can increase latency and Airtable AI-credit usage. No new paid vendor is provisioned.
- Quality improvement must be measured with expert review using the included held-out synthetic benchmark and later permissioned real cases. No live AI evaluation or measured quality uplift is claimed by the code tests.
