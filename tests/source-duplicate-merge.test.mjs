import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  sourceNeedsReview, sourceReviewNote, requirementSourceNeedsReview,
  mergeablePairs, sectionLooksLikeFragment, looksLikeHeading, sourceLineText,
} from "../assets/ui-helpers.mjs";

// Regression tests for sweep findings #18 (generic/wrong source snippets)
// and #20 (near-duplicate requirements), Nov 18, 2026. The server check in
// netlify/functions/lib/compliance-ai.js and the client mirror in
// assets/ui-helpers.mjs must agree, and the shipped workspace renderers
// (sources() and duplicatePairs()) are extracted from assets/workspace.mjs
// and run against stubbed DOM helpers, the same pattern as the checklist
// labels test: on the old code the flag paragraph never renders and the
// merge card does not exist at all.
const root = new URL("../", import.meta.url);
const REQ_TEXT = "The vendor must provide three references.";

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

function extractFunction(source, name) {
  const start = source.indexOf("function " + name + "(");
  assert.ok(start >= 0, name + "() must exist in assets/workspace.mjs");
  let depth = 0, i = start;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return source.slice(start, i);
}

function paraTexts(el, out = []) {
  if (el.tag === "p") out.push(el.textContent);
  for (const c of el.children || []) paraTexts(c, out);
  return out;
}

test("client citation check matches the server verdicts", () => {
  assert.equal(sourceNeedsReview({section: "Section L", quote: REQ_TEXT}, REQ_TEXT), null);
  assert.equal(sourceNeedsReview({section: "33 if-", quote: REQ_TEXT}, REQ_TEXT), "fragment-section");
  assert.equal(sourceNeedsReview({section: "1. One (1) PDF copy of the invoice billed according to contract line items and rates.", quote: REQ_TEXT}, REQ_TEXT), "fragment-section");
  assert.equal(sourceNeedsReview({section: "section of the System for Award Management (SAM) and its other data in SAM is current.", quote: REQ_TEXT}, REQ_TEXT), "fragment-section");
  assert.equal(sourceNeedsReview({section: "Section L", quote: "31."}, REQ_TEXT), "fragment-quote");
  assert.equal(sourceNeedsReview({section: "Section L", quote: "Ship number."}, REQ_TEXT), "quote-mismatch");
  assert.equal(sourceNeedsReview(null, REQ_TEXT), null);
  assert.equal(sourceNeedsReview({section: "Section L", quote: ""}, REQ_TEXT), null);
  assert.equal(sectionLooksLikeFragment("Section L"), false);
  assert.equal(sectionLooksLikeFragment("Appendix A"), false);
  assert.equal(looksLikeHeading("2. Submission Instructions"), true);
  assert.equal(looksLikeHeading("33 if-"), false);
  assert.ok(sourceReviewNote("fragment-section").startsWith("Source needs review:"));
});

test("requirementSourceNeedsReview flags a fragment section shared by many requirements", () => {
  const frag = {section: "33 if-", quote: REQ_TEXT};
  const reqs = [
    {id: "r1", text: REQ_TEXT, sources: [frag]},
    {id: "r2", text: "The vendor must submit proof of insurance.", sources: [{section: "33 if-", quote: "The vendor must submit proof of insurance."}]},
    {id: "r3", text: "The vendor must provide a certificate.", sources: [{section: "33 if-", quote: "The vendor must provide a certificate."}]},
  ];
  const notes = requirementSourceNeedsReview(reqs[0], reqs);
  assert.ok(notes.some((n) => n.includes("fragment")), "fragment section note");
  assert.ok(notes.some((n) => n.includes("cited by 3 requirements")), "shared section note");
  const clean = {id: "r4", text: REQ_TEXT, sources: [{section: "Section L", quote: REQ_TEXT}]};
  assert.deepEqual(requirementSourceNeedsReview(clean, [clean]), []);
  // A legitimate section shared by many requirements is not flagged.
  const shared = [
    {id: "r5", text: REQ_TEXT, sources: [{section: "Section L", quote: REQ_TEXT}]},
    {id: "r6", text: "The vendor must submit proof of insurance.", sources: [{section: "Section L", quote: "The vendor must submit proof of insurance."}]},
    {id: "r7", text: "The vendor must provide a certificate.", sources: [{section: "Section L", quote: "The vendor must provide a certificate."}]},
  ];
  assert.deepEqual(requirementSourceNeedsReview(shared[0], shared), []);
});

test("mergeablePairs keeps live pairs and drops merged, excluded, missing and reversed duplicates", () => {
  const keeper = {id: "a", stableId: "REQ-A", text: "Joint venture partners must submit a joint venture agreement."};
  const dup = {id: "b", stableId: "REQ-B", text: "Joint venture partners must submit a joint venture agreement today."};
  const merged = {id: "c", stableId: "REQ-C", text: "Joint venture partners must submit a joint venture agreement.", duplicateOf: "REQ-A"};
  const excluded = {id: "d", stableId: "REQ-D", text: "Joint venture partners must submit a joint venture agreement.", disposition: "extraction error", reviewReason: "Not a requirement.", reviewedBy: "u1"};
  const reqs = [keeper, dup, merged, excluded];
  assert.deepEqual(mergeablePairs([["a", "b"]], reqs), [[keeper, dup]]);
  assert.deepEqual(mergeablePairs([["a", "b"], ["b", "a"]], reqs), [[keeper, dup]]);
  assert.deepEqual(mergeablePairs([["a", "c"], ["a", "d"], ["a", "missing"], ["a", "a"]], reqs), []);
  assert.deepEqual(mergeablePairs(null, reqs), []);
  // Nov 25 full-site review, logged-in #12: the same requirement in several
  // pairs reads as several different duplicates. Each requirement appears in
  // at most one kept pair; the dropped pair reappears after a merge.
  const third = {id: "e", stableId: "REQ-E", text: "Joint venture partners must submit a joint venture agreement now."};
  assert.deepEqual(mergeablePairs([["a", "b"], ["a", "e"], ["b", "e"]], [...reqs, third]), [[keeper, dup]]);
});

async function loadSources() {
  const source = await readFile(new URL("assets/workspace.mjs", root), "utf8");
  const code = extractFunction(source, "sources");
  return new Function("node", "shortId", "sourceLineText", "sourceNeedsReview", "sourceReviewNote", code + "; return sources;")(
    (tag, text) => makeEl(tag, text),
    (id) => String(id || "").slice(0, 8),
    sourceLineText,
    sourceNeedsReview, sourceReviewNote);
}

test("sources() flags a fragment-section citation and leaves clean and evidence citations alone", async () => {
  const sources = await loadSources();
  const frag = {document: "Fictional RFP", page: 8, section: "33 if-", quote: REQ_TEXT, segment_id: "s1"};
  const clean = {document: "Fictional RFP", page: 4, section: "Section L", quote: REQ_TEXT, segment_id: "s2"};
  const flagged = makeEl("div");
  sources(flagged, [frag], REQ_TEXT);
  assert.ok(paraTexts(flagged).some((t) => t.includes("Source needs review:")), "fragment-section source must carry the flag");
  const ok = makeEl("div");
  sources(ok, [clean], REQ_TEXT);
  assert.ok(!paraTexts(ok).some((t) => t.includes("Source needs review")), "clean source must not be flagged");
  // Evidence citations carry no requirement text and are never flagged here.
  const evidence = makeEl("div");
  sources(evidence, [frag]);
  assert.ok(!paraTexts(evidence).some((t) => t.includes("Source needs review")), "a citation without requirement text is not flagged");
});

async function loadDuplicatePairs(view, calls, messages, fields, buttons, canReview) {
  const source = await readFile(new URL("assets/workspace.mjs", root), "utf8");
  const code = extractFunction(source, "duplicatePairs");
  const stubs = {
    node: (tag, text) => makeEl(tag, text),
    card: (parent, title) => { const c = makeEl("article", title); parent.append(c); return c; },
    field: (parent, label, type) => { const i = makeEl(type === "textarea" ? "textarea" : "input"); i.value = ""; fields.push(i); parent.append(i); return i; },
    button: (t, fn) => { const b = makeEl("button", t); b._click = fn; buttons.push(b); return b; },
    mutate: async (action, payload) => { calls.push({action, ...payload}); return {}; },
    render: () => {},
    message: (t) => { messages.push(t); },
  };
  return new Function("node", "card", "field", "button", "canReview", "mergeablePairs", "view", "mutate", "render", "message",
    code + "; return duplicatePairs;")(
    stubs.node, stubs.card, stubs.field, stubs.button, canReview, mergeablePairs, view, stubs.mutate, stubs.render, stubs.message);
}

const KEEPER = {id: "req-keeper", stableId: "REQ-KEEPER", text: "Joint venture partners must submit a joint venture agreement.", mandatory: "Yes", category: "Eligibility"};
const DUP = {id: "req-dup", stableId: "REQ-DUP", text: "Joint venture partners must submit a joint venture agreement today.", mandatory: "Yes", category: "Eligibility"};

test("duplicatePairs shows the pair side by side and merges the picked keeper with a reason", async () => {
  const calls = [], messages = [], fields = [], buttons = [];
  const view = {similarPairs: [["req-keeper", "req-dup"]]};
  const duplicatePairs = await loadDuplicatePairs(view, calls, messages, fields, buttons, () => true);
  const parent = makeEl("div");
  duplicatePairs(parent, {requirements: [KEEPER, DUP]});
  assert.ok(parent.children.some((c) => c.textContent === "Possible duplicate requirements (1)"), "merge card must render with the pair count");
  assert.equal(buttons.length, 2, "one Keep button per side");
  assert.equal(buttons[0].textContent, "Keep REQ-KEEPER");
  assert.equal(buttons[1].textContent, "Keep REQ-DUP");
  fields[0].value = "Same joint-venture obligation.";
  await buttons[0]._click();
  assert.deepEqual(calls, [{action: "mergeDuplicate", keeperId: "req-keeper", duplicateId: "req-dup", reason: "Same joint-venture obligation."}]);
  assert.ok(messages.some((t) => t.includes("Merged as a duplicate of REQ-KEEPER")));
});

test("duplicatePairs refuses to merge without a reason and hides from viewers", async () => {
  const calls = [], messages = [], fields = [], buttons = [];
  const view = {similarPairs: [["req-keeper", "req-dup"]]};
  const duplicatePairs = await loadDuplicatePairs(view, calls, messages, fields, buttons, () => true);
  const parent = makeEl("div");
  duplicatePairs(parent, {requirements: [KEEPER, DUP]});
  await buttons[1]._click();
  assert.deepEqual(calls, [], "no merge without a reason");
  assert.ok(messages.some((t) => t.includes("Give a reason before merging")));
  const hiddenCalls = [], hiddenMessages = [], hiddenFields = [], hiddenButtons = [];
  const hidden = await loadDuplicatePairs(view, hiddenCalls, hiddenMessages, hiddenFields, hiddenButtons, () => false);
  const hiddenParent = makeEl("div");
  hidden(hiddenParent, {requirements: [KEEPER, DUP]});
  assert.equal(hiddenParent.children.length, 0, "viewers never see merge controls");
  assert.equal(hiddenButtons.length, 0);
});
