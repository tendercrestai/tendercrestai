// Pure UI helpers for the Nov 18, 2026 end-to-end sweep fixes.
// No DOM access here: browser modules import these, and node tests cover
// them directly. Every helper is deliberately small so a UI fix can be
// regression-tested without a browser.

// --- Action queue (sweep finding #3) -------------------------------------
// Long async actions used to drop a second click with "Please wait —
// finishing the last action…" and no other feedback. The queue runs one
// action at a time, keeps only the latest queued action, and shows a
// delayed "Working…" message when the action has not reported progress
// on its own. `isBusy`/`setBusy` are callbacks so pages that also set the
// same flag elsewhere (for example the workspace autosave) share one
// source of truth instead of a second flag that can disagree with it.
export function createActionQueue({isBusy, setBusy, notify, readMessage, delayMs = 800}) {
  let pending = null, timer = null, running = false, showedWorking = false;
  function drain() {
    if (isBusy() || !pending) return;
    const next = pending; pending = null;
    void run(next);
  }
  async function run(fn) {
    if (isBusy()) { pending = fn; return; }
    running = true;
    setBusy(true);
    const startText = readMessage ? readMessage() : null;
    if (timer) clearTimeout(timer);
    showedWorking = false;
    timer = setTimeout(() => {
      if (isBusy() && (!readMessage || readMessage() === startText)) { showedWorking = true; notify("Working…"); }
    }, delayMs);
    try { await fn(); }
    finally {
      clearTimeout(timer);
      running = false;
      setBusy(false);
      // A "Working…" banner that is never cleared leaves the last action
      // looking stuck and covers content. Restore the message that was
      // showing before the slow action, but only when nothing else has
      // reported progress since (an action that set its own message keeps
      // it, and a queued action's own message is not clobbered).
      if (showedWorking && readMessage && readMessage() === "Working…") notify(startText ?? "");
      showedWorking = false;
      drain();
    }
  }
  // Callers that hold the same busy flag outside the queue (the workspace
  // autosave) drain through here instead of clearing the flag themselves
  // while a queued action is running.
  return {run, drain, isRunning: () => running};
}

// --- Display truncation (sweep finding #6) -------------------------------
export function truncate(text, max) {
  const value = String(text ?? "");
  return value.length > max ? value.slice(0, max) + "…" : value;
}
// Word-boundary truncation: never cut a word in half, so agency names and
// titles end on a whole word. Falls back to a hard cut for one long word.
export function truncateWord(text, max) {
  const value = String(text ?? "");
  if (value.length <= max) return value;
  const cut = value.lastIndexOf(" ", max);
  if (cut <= 0) return value.slice(0, max) + "…";
  return value.slice(0, cut) + "…";
}
// SAM.gov agency paths are dot-joined ALL-CAPS hierarchies
// ("DEPT OF DEFENSE.DEPT OF THE ARMY..."). Show the most specific segment
// (the last one) in readable title case.
const SMALL_WORDS = new Set(["of", "the", "and", "for", "to", "in", "on", "at", "by"]);
export function formatAgencyName(value) {
  const raw = String(value || "").split(".").map((s) => s.trim()).filter(Boolean).pop() || "";
  if (!raw) return "Agency not supplied";
  const words = raw.toLowerCase().split(/\s+/).map((w, i) =>
    (i > 0 && SMALL_WORDS.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1));
  return truncateWord(words.join(" "), 120);
}
// Opportunities feed count line: say how many are on this page, how many
// exist in total, and the page size, so "8 on page 1" is never confused
// with "25 per page".
export function opportunityCountLine(shown, total, page, pageSize = 25) {
  const totalText = Number.isSafeInteger(total) ? " of " + total : "";
  return shown + totalText + " open opportunities · page " + (page + 1) + " (" + pageSize + " per page)";
}

// --- Draft preview with no draftable evidence (sweep finding #4) ---------
// A preview whose text is only [NEEDS INPUT:...] / [NEEDS REVIEW:...]
// placeholders means no requirement had approved, current evidence.
const PLACEHOLDER = /\[NEEDS (?:INPUT|REVIEW)[^\]]*\]/g;
export function isNeedsInputOnly(text) {
  const value = String(text ?? "").replace(PLACEHOLDER, "").trim();
  return value.length === 0;
}

// --- Job lists (sweep findings #4 and #19) -------------------------------
// Exports mixed export and draft jobs in server order. Partition them and
// show newest first so the latest package is on top.
export function partitionJobs(jobs) {
  const sorted = [...(jobs || [])].sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0));
  return {exports: sorted.filter((j) => j.kind !== "draft"), drafts: sorted.filter((j) => j.kind === "draft")};
}
// Proposal Studio kept one card per completed draft job, so re-generating
// a section produced duplicates. Keep only the latest job per
// section + revision + status.
export function dedupeDraftJobs(jobs) {
  const latest = new Map();
  for (const j of jobs || []) {
    const key = [j.result?.sectionId || "", j.revision, j.status].join("|");
    const kept = latest.get(key);
    if (!kept || Date.parse(j.created_at || 0) >= Date.parse(kept.created_at || 0)) latest.set(key, j);
  }
  return [...latest.values()].sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0));
}

// --- Evidence matching (sweep finding #9) --------------------------------
// "Find approved evidence" claimed success even when the organization had
// no approved answers to suggest. Report the honest count so the UI can
// say so and stay on the requirement instead of bouncing to an empty tab.
export function matchEvidenceOutcome(state, requirementId) {
  const suggested = (state?.evidence || []).filter(
    (e) => e.requirementId === requirementId && e.decision === "suggested"
  ).length;
  return {suggested, found: suggested > 0};
}

// --- Source review record (sweep finding #13) ----------------------------
export function formatWarningReview(warningReview) {
  if (!warningReview) return null;
  const when = warningReview.createdAt ? new Date(warningReview.createdAt).toLocaleString() : "date unavailable";
  return "Source review recorded " + when + ": " + (warningReview.reason || "");
}

// --- Submission checklist counts (sweep finding #20) ---------------------
export function checklistCountsLine(wordCount, pageCount) {
  if (!wordCount) return "No response text drafted yet. Response words and PDF pages will be counted once sections have text.";
  return wordCount + " response words · " + (pageCount ?? "unmeasured") + " PDF pages. DOCX pagination is not measured.";
}

// --- Activity log readability (sweep finding #20) ------------------------
// The activity feed showed raw UTC timestamps and full UUIDs.
export function formatActivityDate(iso) {
  const parsed = new Date(iso || "");
  return Number.isNaN(parsed.getTime()) ? String(iso || "") : parsed.toLocaleString();
}
export function shortId(id) {
  const value = String(id || "");
  return value.length > 8 ? value.slice(0, 8) + "…" : value;
}
// Prefer a member's display name over a truncated ID in activity, approval
// and reviewer lines. Unknown IDs still show as a short ID, never invented.
export function memberLabel(members, userId) {
  const found = (members || []).find((m) => m.user_id === userId);
  return (found && (found.label || found.email)) || shortId(userId);
}
// --- Submission checklist breakdown (final sweep finding #6) -------------
// The server classifies readiness blockers (proposal-core.js readiness())
// and ships the counts with the view; this renders the split ("313 items:
// 151 requirement items, 162 section items") so a long checklist explains
// itself instead of showing one unexplained total.
export function blockerBreakdownLine(counts) {
  const c = counts || {};
  const total = c.total || 0;
  if (!total) return "";
  const parts = [];
  if (c.requirements) parts.push(countText(c.requirements, "requirement item", "requirement items"));
  if (c.attachments) parts.push(countText(c.attachments, "attachment item", "attachment items"));
  if (c.sections) parts.push(countText(c.sections, "section item", "section items"));
  if (c.other) parts.push(countText(c.other, "other item", "other items"));
  return total + " items: " + parts.join(", ") + ".";
}

// --- Counts and factor labels (sweep finding #16) ------------------------
export function countText(n, singular, plural) {
  return n + " " + (n === 1 ? singular : plural);
}
export function pluralDays(n) {
  return countText(n, "day", "days");
}
export const BID_FACTOR_LABELS = {
  eligibility: "Eligibility",
  technical: "Technical alignment",
  pastPerformance: "Past performance",
  readiness: "Delivery readiness",
  commercial: "Commercial fit",
};
export function bidFactorLabel(key) {
  return BID_FACTOR_LABELS[key] || String(key || "");
}

// --- Trial upsell (sweep finding #14) ------------------------------------
// The account page showed "Start a card-required 14-day trial" to an
// Enterprise customer. The checkout section is only for accounts with no
// active allowance; an unavailable usage lookup fails open so a no-plan
// account is never locked out of starting a trial by a usage outage.
export function shouldShowTrialCheckout(usage) {
  if (!usage || typeof usage.available !== "boolean") return true;
  return usage.available === false;
}

// --- Free-tool source lines (sweep finding #6) ---------------------------
// Pasted-text sources have no section and no page, so the result printed
// "Section unavailable · Page unavailable". Omit the line entirely then.
export function sourceLineText(source) {
  const section = source?.section || null;
  const page = source?.page ?? null;
  if (!section && (page === null || page === undefined)) return null;
  return (section || "Section unavailable") + " · " + (page ? "PDF page " + page : "Page unavailable");
}

// --- List search and pagination (sweep findings #7 and #8) --------------
// The workspace rendered every requirement, evidence mapping and section
// review at once (162 disclosure triangles per tab) and the audit rendered
// all 965 findings. Lists are searched and paged in place: the controls
// stay mounted while only the list container is redrawn, so typing never
// loses focus to a full re-render.
export function searchListItems(items, query, toText) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [...(items || [])];
  return (items || []).filter((item) => String(toText(item) ?? "").toLowerCase().includes(q));
}
export function paginateList(items, page, pageSize = 25) {
  const list = [...(items || [])];
  const size = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 25;
  const totalPages = Math.max(1, Math.ceil(list.length / size));
  const safePage = Math.min(Math.max(0, Number.isInteger(page) ? page : 0), totalPages - 1);
  const start = safePage * size;
  return {items: list.slice(start, start + size), page: safePage, pageSize: size, total: list.length, totalPages};
}
export function pageRangeText(page) {
  if (!page || !page.total) return "No items match.";
  const from = page.page * page.pageSize + 1;
  const to = Math.min(page.total, (page.page + 1) * page.pageSize);
  return "Showing " + from + " to " + to + " of " + page.total + ".";
}

// --- Readable requirement and section labels (sweep findings #7 and #8) --
// Readiness blockers and audit readiness messages embed raw UUIDs
// ("...: <uuid>"). Replace the UUID with the requirement's REQ label or
// the section title so the checklist reads instead of showing raw IDs.
// Unknown IDs are left untouched: a label is never invented.
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
export function requirementLabel(r) {
  if (!r) return "";
  return (r.stableId || r.id) + (r.text ? " · " + truncate(r.text, 100) : "");
}
export function sectionLabel(section) {
  if (!section) return "";
  return section.title || section.id || "";
}
export function readableBlocker(blocker, requirements, sections) {
  const text = String(blocker || "");
  const match = text.match(UUID_PATTERN);
  if (!match) return text;
  const id = match[0];
  const requirement = (requirements || []).find((r) => r.id === id);
  if (requirement) return text.replace(id, requirementLabel(requirement));
  const section = (sections || []).find((x) => x.id === id);
  if (section) return text.replace(id, sectionLabel(section));
  return text;
}
// Checklist search text (PR #99 follow-up): the search must match what the
// checklist shows, plus the status words a user would search for. A blocker
// for a requirement with no evidence is found by "Missing evidence" even
// though those words are not in the blocker sentence itself; the same
// applies to the other coverage states, the mandatory value, the compliance
// status and the category. Unknown IDs search on the raw text only.
const COVERAGE_LABELS = {"missing-evidence": "Missing evidence", "not-assessed": "Not assessed", supported: "Supported", "partially-supported": "Partially supported"};
export function blockerSearchText(blocker, requirements, sections) {
  const label = readableBlocker(blocker, requirements, sections);
  const match = String(blocker || "").match(UUID_PATTERN);
  if (!match) return label;
  const id = match[0];
  const requirement = (requirements || []).find((r) => r.id === id);
  if (requirement) {
    const coverage = (requirement.trace || {}).coverage;
    return [label, requirement.mandatory, requirement.status, requirement.category, COVERAGE_LABELS[coverage] || ""].filter(Boolean).join(" ");
  }
  const section = (sections || []).find((x) => x.id === id);
  if (section) return [label, section.status].filter(Boolean).join(" ");
  return label;
}
export function findingEntityLabel(finding, requirements, sections) {
  if (finding?.requirementId) {
    const r = (requirements || []).find((x) => x.id === finding.requirementId);
    return "Requirement " + (r ? requirementLabel(r) : finding.requirementId);
  }
  if (finding?.sectionId) {
    const section = (sections || []).find((x) => x.id === finding.sectionId);
    return "Section " + (section ? sectionLabel(section) : finding.sectionId);
  }
  return null;
}

// --- Audit grouping (sweep finding #8) -----------------------------------
// The 965 findings are articles, not distinct issues: the same 162 section
// UUIDs repeat across the incomplete-section, unverified-claims, readiness
// and approval groups, and the same 151 mandatory requirement UUIDs repeat
// in the requirement and readiness groups. Group by the underlying entity
// (requirement or section) so one group holds every finding about it.
// A readiness finding carries its entity only inside its message text, so
// the UUID is resolved against the project state to join the right group.
const SEVERITY_RANK = {critical: 0, high: 1, medium: 2, low: 3};
export function groupAuditFindings(findings, requirements, sections) {
  const groups = new Map();
  for (const f of findings || []) {
    let key = null, requirementId = f?.requirementId || null, sectionId = f?.sectionId || null;
    if (requirementId) key = "req:" + requirementId;
    else if (sectionId) key = "sec:" + sectionId;
    else if (f?.type === "readiness") {
      const match = String(f.message || "").match(UUID_PATTERN);
      if (match) {
        const id = match[0];
        if ((requirements || []).some((r) => r.id === id)) { key = "req:" + id; requirementId = id; }
        else if ((sections || []).some((x) => x.id === id)) { key = "sec:" + id; sectionId = id; }
        else key = "blocker:" + id.toLowerCase();
      } else key = "readiness:general";
    } else if (f?.type === "potential-conflict") key = "conflict:" + String(f.message || "").split(":")[0];
    else key = "general:" + (f?.type || "finding");
    let group = groups.get(key);
    if (!group) { group = {key, requirementId, sectionId, findings: []}; groups.set(key, group); }
    if (!group.findings.some((x) => x.id === f.id)) group.findings.push(f);
  }
  const sorted = [...groups.values()];
  sorted.sort((a, b) => {
    const rank = (g) => Math.min(...g.findings.map((x) => SEVERITY_RANK[x.severity] ?? 3));
    return rank(a) - rank(b) || String(a.key).localeCompare(String(b.key));
  });
  return sorted;
}
export function auditGroupLabel(group, requirements, sections) {
  if (group.requirementId) {
    const r = (requirements || []).find((x) => x.id === group.requirementId);
    return r ? requirementLabel(r) : "Requirement " + group.requirementId;
  }
  if (group.sectionId) {
    const section = (sections || []).find((x) => x.id === group.sectionId);
    return section ? sectionLabel(section) : "Section " + group.sectionId;
  }
  if (group.key.startsWith("conflict:")) return "Potential conflict: " + group.key.slice("conflict:".length);
  if (group.key.startsWith("readiness")) return "Readiness items";
  if (group.key.startsWith("blocker:")) return "Readiness item " + group.key.slice("blocker:".length, "blocker:".length + 8) + "…";
  return "Audit findings";
}
export function auditSummary(findings, requirements, sections) {
  const list = findings || [];
  const groups = groupAuditFindings(list, requirements, sections);
  const bySeverity = {}, byType = {};
  for (const f of list) {
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
    byType[f.type] = (byType[f.type] || 0) + 1;
  }
  return {total: list.length, distinct: groups.length, bySeverity, byType};
}
