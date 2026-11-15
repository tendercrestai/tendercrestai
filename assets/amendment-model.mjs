// Amendment impact review model (Capability 3). Pure helpers shared by the
// workspace UI; the server (proposal-core.js) is the source of truth for
// comparison, change state and the report. Every proposed change is a
// suggestion until a person confirms or corrects it; absence from a
// supplemental amendment never means a requirement was removed.
export const amendmentKindLabels = {
  replacement: "Complete replacement solicitation",
  supplemental: "Supplemental amendment"
};
export const amendmentChangeTypeLabels = {
  added: "Added requirement",
  changed: "Changed requirement",
  "deadline-changed": "Changed deadline",
  "instruction-changed": "Changed submission instruction",
  "potentially-removed": "Potentially removed requirement",
  "uncertain-match": "Uncertain match — needs human review"
};
export const amendmentChangeStatusLabels = {
  proposed: "Proposed — needs review",
  confirmed: "Confirmed",
  corrected: "Corrected",
  rejected: "Rejected"
};
export function isAmendmentChangeUnresolved(change) {
  return change.status === "proposed";
}
export function unresolvedAmendmentChanges(amendment) {
  return (amendment.changes || []).filter(isAmendmentChangeUnresolved);
}
export function amendmentCounts(amendment) {
  const byType = {};
  for (const c of amendment.changes || []) byType[c.type] = (byType[c.type] || 0) + 1;
  return {total: (amendment.changes || []).length, unresolved: unresolvedAmendmentChanges(amendment).length, byType, notMentioned: (amendment.notMentioned || []).length};
}
export function sourceLabel(ref) {
  return (ref.document || "Source unavailable") + " · " + (ref.section || "Section unavailable") +
    " · " + (ref.page === null || ref.page === undefined ? "Page unavailable" : "PDF page " + ref.page);
}
