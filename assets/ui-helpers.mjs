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
  let pending = null, timer = null, running = false;
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
    timer = setTimeout(() => {
      if (isBusy() && (!readMessage || readMessage() === startText)) notify("Working…");
    }, delayMs);
    try { await fn(); }
    finally {
      clearTimeout(timer);
      running = false;
      setBusy(false);
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
