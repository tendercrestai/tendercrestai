import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  searchListItems, paginateList, pageRangeText, checklistCountsLine,
  readableBlocker, blockerSearchText,
} from "../assets/ui-helpers.mjs";

// Regression test for the PR #99 checklist gap (Nov 18, 2026): PR #99 wired
// readableBlocker into the Overview checklist only as the search-text
// extractor, while the rendered <li> still used the raw blocker string, so
// the checklist kept showing raw UUIDs live even though searching
// "Mandatory" narrowed the list. The shipped checklist() renderer is
// extracted from assets/workspace.mjs and run against stubbed DOM helpers,
// the same pattern as the Evidence-tab TDZ test: on the old code the
// rendered items contain the raw UUIDs and a "Missing evidence" search
// matches nothing.
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

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

const REQ_A = {id: "11111111-1111-1111-1111-111111111111", stableId: "REQ-A1B2C3D4E5F6", text: "Submit proof of insurance of at least $1,000,000 with your proposal.", mandatory: "Yes", status: "Needs Review", category: "Eligibility", trace: {coverage: "missing-evidence"}};
const REQ_B = {id: "22222222-2222-2222-2222-222222222222", stableId: "REQ-B2C3D4E5F6A7", text: "The bidder must include a signed cover letter.", mandatory: "Yes", status: "Needs Review", category: "Submission", trace: {coverage: "supported"}};
const SEC_A = {id: "33333333-3333-3333-3333-333333333333", title: "Cover letter and bidder forms", status: "changes requested"};

function makeView() {
  return {
    readiness: {
      ready: false,
      blockers: [
        "Mandatory/unclear requirement needs verified evidence and compliance review: " + REQ_A.id,
        "Mandatory/unclear requirement needs verified evidence and compliance review: " + REQ_B.id,
        "Section needs content or revision approval: " + SEC_A.id,
        "Bid assessment is stale.",
      ],
      wordCount: 0,
      pageCount: null,
    },
    project: {state: {requirements: [REQ_A, REQ_B], sections: [SEC_A]}},
  };
}

async function loadChecklist(view, query = "", page = 0) {
  const source = await readFile(new URL("assets/workspace.mjs", root), "utf8");
  const line = source.split("\n").find((l) => l.startsWith("function checklist(parent){"));
  assert.ok(line, "checklist() must exist in assets/workspace.mjs");
  const stubs = {
    node: (tag, text) => makeEl(tag, text),
    card: (parent, title) => { const c = makeEl("article", title); parent.append(c); return c; },
    field: (parent, label, type, value) => { const i = makeEl(type === "textarea" ? "textarea" : "input"); i.value = value ?? ""; return i; },
    appendPager: (container, pg) => { container.append(makeEl("p", pageRangeText(pg))); },
  };
  const checklist = new Function("node", "card", "field",
    "searchListItems", "paginateList", "appendPager",
    "readableBlocker", "blockerSearchText", "checklistCountsLine",
    "view", "checklistQuery", "checklistPage",
    line + "; return checklist;")(
    stubs.node, stubs.card, stubs.field,
    searchListItems, paginateList, stubs.appendPager,
    readableBlocker, blockerSearchText, checklistCountsLine,
    view, query, page);
  const parent = makeEl("div");
  checklist(parent);
  return parent;
}

function listItems(el, out = []) {
  if (el.tag === "li") out.push(el.textContent);
  for (const c of el.children || []) listItems(c, out);
  return out;
}

test("checklist renders readable REQ labels and section titles, never raw UUIDs", async () => {
  const items = listItems(await loadChecklist(makeView()));
  assert.equal(items.length, 4);
  assert.ok(items.some((t) => t === "Mandatory/unclear requirement needs verified evidence and compliance review: REQ-A1B2C3D4E5F6 · Submit proof of insurance of at least $1,000,000 with your proposal."),
    "requirement blocker must show the REQ label and requirement text");
  assert.ok(items.some((t) => t === "Mandatory/unclear requirement needs verified evidence and compliance review: REQ-B2C3D4E5F6A7 · The bidder must include a signed cover letter."),
    "second requirement blocker must resolve the same way");
  assert.ok(items.some((t) => t === "Section needs content or revision approval: Cover letter and bidder forms"),
    "section blocker must show the section title");
  assert.ok(items.includes("Bid assessment is stale."),
    "blockers without a UUID render unchanged");
  assert.ok(items.every((t) => !UUID_PATTERN.test(t)), "no rendered checklist item may contain a raw UUID");
});

test("checklist search finds blockers by coverage status words", async () => {
  const missing = listItems(await loadChecklist(makeView(), "Missing evidence"));
  assert.equal(missing.length, 1);
  assert.ok(missing[0].includes("REQ-A1B2C3D4E5F6"), "only the blocker for the requirement with missing evidence matches");
  const mandatory = listItems(await loadChecklist(makeView(), "Mandatory"));
  assert.equal(mandatory.length, 2);
  const none = listItems(await loadChecklist(makeView(), "nothing matches here"));
  assert.equal(none.length, 0);
});

test("blocker search text carries status words for the referenced entity", () => {
  const a = blockerSearchText("Mandatory/unclear requirement needs verified evidence and compliance review: " + REQ_A.id, [REQ_A, REQ_B], [SEC_A]);
  assert.ok(a.includes("REQ-A1B2C3D4E5F6"), "search text uses the readable label");
  assert.ok(a.includes("Missing evidence"), "search text carries the coverage label in words");
  assert.ok(a.includes("Eligibility") && a.includes("Needs Review"), "search text carries category and status");
  const b = blockerSearchText("Mandatory/unclear requirement needs verified evidence and compliance review: " + REQ_B.id, [REQ_A, REQ_B], [SEC_A]);
  assert.ok(b.includes("Supported") && !b.includes("Missing evidence"), "a supported requirement does not match a missing-evidence search");
  const sec = blockerSearchText("Section needs content or revision approval: " + SEC_A.id, [REQ_A], [SEC_A]);
  assert.ok(sec.includes("Cover letter and bidder forms"), "section blockers search on the section title");
  const unknown = "11111111-9999-9999-9999-999999999999";
  assert.equal(blockerSearchText("Section needs content or revision approval: " + unknown, [REQ_A], [SEC_A]),
    "Section needs content or revision approval: " + unknown);
  assert.equal(blockerSearchText("Bid assessment is stale.", [REQ_A], [SEC_A]), "Bid assessment is stale.");
});
