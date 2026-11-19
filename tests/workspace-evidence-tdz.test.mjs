import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {truncate, matchEvidenceOutcome, countText, searchListItems, paginateList, pageRangeText} from "../assets/ui-helpers.mjs";

// Regression test for the Nov 18, 2026 Evidence-tab outage: the shipped
// evidence() renderer in assets/workspace.mjs read `t.coverage` in the
// per-requirement summary before `const t = r.trace || {}` was declared,
// throwing `ReferenceError: Cannot access 't' before initialization` on the
// first requirement and leaving the whole tab blank. The workspace module
// cannot be imported in Node (it imports the Supabase client from a CDN),
// so the test extracts the shipped function and runs it against stubbed DOM
// helpers, which is enough to reproduce the TDZ error on the old code and
// prove the fixed code renders.

const root = new URL("../", import.meta.url);

function makeEl(tag, text) {
  const el = {
    tag, textContent: text ?? '', children: [], dataset: {}, className: '',
    value: '', checked: false, type: '', href: '', rel: '', target: '', disabled: false,
    append(...kids) { this.children.push(...kids); return this; },
    appendChild(k) { this.children.push(k); return k; },
    replaceChildren(...kids) { this.children = kids; return this; },
    setAttribute() {}, addEventListener() {}, querySelector() { return null; },
    click() {}, select() {}, onsubmit: null, onclick: null, oninput: null, onchange: null,
  };
  return el;
}

async function loadEvidence() {
  const source = await readFile(new URL("assets/workspace.mjs", root), "utf8");
  const line = source.split("\n").find((l) => l.startsWith("function evidence(parent,s){"));
  assert.ok(line, "evidence() must exist in assets/workspace.mjs");
  const stubs = {
    node: (tag, text) => makeEl(tag, text),
    button: (t) => makeEl("button", t),
    card: (parent, title) => { const c = makeEl("article", title); parent.append(c); return c; },
    form: (parent, title) => { const f = makeEl("form"); if (title) f.append(makeEl("h3", title)); parent.append(f); return f; },
    select: (parent, label, values, value) => { const i = makeEl("select"); i.value = value ?? ""; i.options = []; return i; },
    field: (parent, label, type, value) => { const i = makeEl(type === "textarea" ? "textarea" : "input"); i.value = value ?? ""; return i; },
    sources: () => {},
    canWrite: () => true,
    canReview: () => true,
    mutate: async () => ({}),
    message: () => {},
    render: () => {},
    submit: (f, t) => { f.append(makeEl("button", t)); },
    // The evidence list is searched and paged in place (Nov 18, 2026
    // follow-up fixes); the pager only appends its range line here because
    // the test never clicks Previous/Next.
    appendPager: (container, page) => { container.append(makeEl("p", pageRangeText(page))); },
  };
  return new Function("node", "button", "card", "form", "select", "field", "sources",
    "canWrite", "canReview", "mutate", "message", "render", "submit",
    "truncate", "matchEvidenceOutcome", "countText",
    "searchListItems", "paginateList", "appendPager",
    "evListQuery", "evListCoverage", "evListPage",
    line + "; return evidence;")(
    stubs.node, stubs.button, stubs.card, stubs.form, stubs.select, stubs.field,
    stubs.sources, stubs.canWrite, stubs.canReview, stubs.mutate, stubs.message,
    stubs.render, stubs.submit, truncate, matchEvidenceOutcome, countText,
    searchListItems, paginateList, stubs.appendPager, "", "", 0);
}

function collectText(el, out = []) {
  if (typeof el.textContent === "string" && el.textContent) out.push(el.textContent);
  for (const c of el.children || []) collectText(c, out);
  return out;
}

test("evidence tab renders and shows trace coverage in each summary", async () => {
  const evidence = await loadEvidence();
  const parent = makeEl("div");
  const state = {
    requirements: [
      {
        id: "r1", stableId: "REQ-1",
        text: "The bidder must provide three references from similar work.",
        trace: { coverage: "supported", coverageSource: "human-confirmed", responseApproval: { status: "approved" } },
        support: "supported",
      },
      {
        id: "r2", stableId: "REQ-2",
        text: "The bidder must submit a price schedule.",
        support: "needs review",
      },
    ],
    evidence: [],
  };
  assert.doesNotThrow(() => evidence(parent, state));
  const texts = collectText(parent);
  assert.ok(texts.some((t) => t === "REQ-1 · supported · The bidder must provide three references from similar work."),
    "summary must show the traced coverage value");
  assert.ok(texts.some((t) => t === "REQ-2 · not-assessed · The bidder must submit a price schedule."),
    "a requirement without a trace must fall back to not-assessed");
  assert.ok(texts.some((t) => t.includes("coverage supported (human-confirmed)")),
    "detail line must show the trace coverage");
});

test("evidence tab renders a suggested mapping and its review note", async () => {
  const evidence = await loadEvidence();
  const parent = makeEl("div");
  const state = {
    requirements: [{
      id: "r1", stableId: "REQ-1",
      text: "The bidder must provide three references from similar work.",
      trace: { coverage: "supported" },
      support: "supported",
    }],
    evidence: [{
      id: "ev1", requirementId: "r1", question: "Past performance references",
      answerId: "ans1", revision: 2, text: "Three references from similar county work.",
      decision: "suggested", citations: [],
    }],
  };
  assert.doesNotThrow(() => evidence(parent, state));
  const texts = collectText(parent);
  assert.ok(texts.some((t) => t.includes("Mapping ev1 · approved answer ans1 revision 2")),
    "suggested mapping must render");
  assert.ok(texts.some((t) => t.includes("Suggested evidence: accept or reject it")),
    "suggested mapping must carry the review note");
});
