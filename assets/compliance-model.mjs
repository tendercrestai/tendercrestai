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
