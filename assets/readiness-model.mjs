// Submission-readiness checklist model (Capability 2). Pure helpers shared by
// the workspace UI; the server (proposal-core.js) is the source of truth for
// item derivation, summary counts and the report. Mandatory status is a
// property of the requirement; task status is the checklist state — filters
// keep them separate.
export const readinessStatuses = ["not-started", "in-progress", "needs-review", "done", "not-applicable"];
export const readinessStatusLabels = {
  "not-started": "Not started",
  "in-progress": "In progress",
  "needs-review": "Needs review",
  done: "Done",
  "not-applicable": "Not applicable"
};
export const readinessKindLabels = {
  requirement: "Mandatory requirement",
  document: "Required document",
  form: "Required form",
  instruction: "Submission instruction",
  other: "Other"
};
export function isUnresolved(item) {
  return item.status !== "done" && item.status !== "not-applicable";
}
export function filterReadinessItems(items, filters = {}) {
  return items.filter(i =>
    (!filters.mandatory || i.mandatory === filters.mandatory) &&
    (!filters.owner || (filters.owner === "unassigned" ? !i.owner : i.owner === filters.owner)) &&
    (!filters.category || i.category === filters.category) &&
    (!filters.status || i.status === filters.status));
}
export function sourceLabel(ref) {
  return (ref.document || "Source unavailable") + " · " + (ref.section || "Section unavailable") +
    " · " + (ref.page === null || ref.page === undefined ? "Page unavailable" : "PDF page " + ref.page);
}
