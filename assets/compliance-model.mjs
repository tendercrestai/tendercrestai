export const statuses = ["Compliant", "Partial", "Non-Compliant", "Needs Review"];
export const categories = ["Technical", "Legal", "Financial", "Administrative", "Eligibility", "Submission", "Attachment", "Evaluation", "Service Level", "Other"];
export function metrics(rows) {
  const covered = rows.filter(r => r.evidence.trim() && r.evidence_reference.trim()).length;
  return { total: rows.length, mandatory: rows.filter(r => r.mandatory === "Yes").length,
    review: rows.filter(r => r.status === "Needs Review").length,
    noncompliant: rows.filter(r => r.status === "Non-Compliant").length,
    evidence: rows.length ? Math.round(covered * 100 / rows.length) : 0 };
}
export function sourceLabel(s) {
  return s.document + " · " + (s.section || "Section unavailable") +
    " · " + (s.page === null ? "Page unavailable" : "PDF page " + s.page);
}
// Synchronous fallback hash for legacy rows without a server fingerprint.
// Canonical IDs come from the extraction fingerprint (sha256 of the normalized
// wording); see proposal-core stableRequirementId. Same wording, same ID.
function fallbackHash(text) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}
export function stableRequirementId(r) {
  if (r.stableId) return r.stableId;
  const fp = r.fingerprint || (r.trace && r.trace.stableId);
  if (fp && /^[a-f0-9]{12,}$/i.test(fp)) return "REQ-" + fp.slice(0, 12).toUpperCase();
  return "REQ-" + fallbackHash((r.original_requirement || r.requirement || "").replace(/\s+/g, " ").trim().toLowerCase()).slice(0, 12).toUpperCase();
}
export function sourceReference(r) {
  return (r.sources || []).length ? r.sources.map(sourceLabel).join(" | ") : "Source unavailable";
}
// Trace columns for the compliance matrix export. Rows without a trace (legacy
// analyses, free-tool exports) degrade honestly: coverage is "Not assessed",
// never invented from the presence of evidence text.
export function traceRow(r) {
  const t = r.trace || {};
  const evidenceRefs = (r.traceEvidence || []).length
    ? r.traceEvidence.map(e => e.answerId + " rev " + e.revision + " (" + e.decision + "): " + (e.excerpt || "")).join("\n")
    : (r.evidence_reference || "");
  return {
    stableId: stableRequirementId(r),
    sourceReference: sourceReference(r),
    evidenceReferences: evidenceRefs,
    coverage: t.coverage || "not-assessed",
    coverageSource: t.coverageSource === "human-confirmed" ? "Human-confirmed"
      : t.coverageSource === "ai-suggested" ? "AI-suggested" : "Unrecorded",
    reviewStatus: t.needsReconfirmation ? "Needs reconfirmation"
      : t.coverageSource ? "Reviewed" : "Not assessed",
    responseApproval: (t.responseApproval && t.responseApproval.status) || "not-approved"
  };
}
export function filterRows(rows, filters) {
  const q = (filters.search || "").toLowerCase();
  const selected = rows.filter(r => (!filters.status || r.status === filters.status) &&
    (!filters.category || r.category === filters.category) &&
    (!filters.mandatory || r.mandatory === filters.mandatory) &&
    [r.requirement,r.evidence,r.evidence_reference,r.response_owner,r.comments,...r.sources.map(sourceLabel)]
      .join(" ").toLowerCase().includes(q));
  return selected.sort((a,b) => filters.sort === "mandatory"
    ? ["Yes","Unclear","No"].indexOf(a.mandatory) - ["Yes","Unclear","No"].indexOf(b.mandatory) || a.id.localeCompare(b.id)
    : filters.sort === "status" ? statuses.indexOf(a.status) - statuses.indexOf(b.status) || a.id.localeCompare(b.id)
    : filters.sort === "requirement" ? a.requirement.localeCompare(b.requirement) || a.id.localeCompare(b.id)
    : a.id.localeCompare(b.id));
}
export function alerts(workspace) {
  const { analysis, requirements, similar_pairs = [] } = workspace;
  const result = [...analysis.warnings];
  if (analysis.status !== "Completed") result.push("Analysis is " + analysis.status + ". These results are incomplete; review the source documents.");
  if (!requirements.length && ["Completed","Partial"].includes(analysis.status)) result.push("No requirements were extracted. Verify the source manually before relying on this result.");
  const missing = requirements.filter(r => !r.evidence.trim() || !r.evidence_reference.trim()).length;
  if (missing) result.push(missing + " requirements have missing company evidence or evidence references.");
  const attachments = requirements.filter(r => r.category === "Attachment" && (!r.evidence.trim() || !r.evidence_reference.trim())).length;
  if (attachments) result.push(attachments + " required attachment rows are unverified. Confirm each document is present.");
  const uncertain = requirements.filter(r => r.uncertain || r.mandatory === "Unclear").length;
  if (uncertain) result.push(uncertain + " requirements have uncertain language or classification.");
  const duplicates = requirements.reduce((n,r) => n + r.duplicate_count, 0);
  if (duplicates) result.push(duplicates + " exact duplicates merged; every source reference is retained.");
  if (similar_pairs.length) result.push(similar_pairs.length + " possible duplicate/conflicting pairs retained for amendment review.");
  const factTypes = new Set(analysis.facts.map(f => f.type));
  for (const type of ["Submission Deadline","Deadline Timezone","Evaluation Criteria"]) {
    if (!factTypes.has(type)) result.push(type + " was not explicitly found. Request clarification if needed.");
  }
  return result;
}
