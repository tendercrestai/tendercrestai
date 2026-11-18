import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  amendmentKindLabels,
  amendmentChangeTypeLabels,
  amendmentChangeStatusLabels,
  amendmentCounts,
} from "../assets/amendment-model.mjs";
import {createActionQueue} from "../assets/ui-helpers.mjs";

// Regression test for the Nov 18, 2026 "propose amendment" outage: after
// uploading and extracting PEP Amendment 7, the Amendments tab showed the
// two-step confirm ("Yes, propose this amendment") but clicking Yes never
// created a solicitation version. Root cause, in assets/workspace.mjs: the
// submit handler read `share.checked`, but `share` is the <label> wrapping
// the consent checkbox, not the checkbox itself (`shareBox`). A <label> has
// no `checked` property, so the payload carried confirmShare: undefined,
// JSON dropped the key, and the server rejected every propose with 400
// ("Confirm sharing this owned RFP snapshot and sources with project
// members."), shown only in the sticky banner — so from the panel the click
// looked like a silent no-op. The Nov 17 in-page-confirm refactor renamed
// the checkbox to `shareBox` without updating the handler. The fix reads
// `shareBox.checked`.
// The workspace module cannot be imported in Node (it imports the Supabase
// client from a CDN), so this test extracts the shipped amendmentsPanel plus
// the real one-line helpers it runs on (node, form, submit, button, run and
// friends) and drives them against a stub DOM that implements the browser's
// form-submission semantics: clicking a type=submit button dispatches the
// owning form's submit event. That is the exact seam the live defect sits
// on, so the test fails when the confirm wiring is broken and passes when
// the two submits reach mutate('amendmentPropose', ...) with the checkbox
// state.

const root = new URL("../", import.meta.url);

function makeEl(tag) {
  const el = {
    tagName: (tag || "div").toUpperCase(),
    children: [],
    parentNode: null,
    textContent: "",
    value: "",
    checked: false,
    type: "",
    className: "",
    dataset: {},
    hidden: false,
    disabled: false,
    href: "",
    rel: "",
    target: "",
    options: [],
    append(...kids) {
      for (const k of kids) {
        if (k == null) continue;
        k.parentNode = this;
        this.children.push(k);
        if (this.tagName === "SELECT" && k.constructor?.name === "Option") this.options.push(k);
      }
      return this;
    },
    appendChild(k) {
      k.parentNode = this;
      this.children.push(k);
      return k;
    },
    replaceChildren(...kids) {
      for (const k of this.children) k.parentNode = null;
      this.children = [];
      for (const k of kids) {
        if (k == null) continue;
        k.parentNode = this;
        this.children.push(k);
      }
      return this;
    },
    setAttribute(k, v) { this[k] = v; },
    getAttribute(k) { return this[k] ?? null; },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    // Browser semantics: a submit button's click dispatches the owning
    // form's submit event; a plain button's click runs its onclick.
    click() {
      if (this.tagName === "BUTTON" && this.type === "submit") {
        let n = this.parentNode;
        while (n && n.tagName !== "FORM") n = n.parentNode;
        if (n && typeof n.onsubmit === "function") {
          n.onsubmit({ preventDefault() {} });
          return;
        }
      }
      if (typeof this.onclick === "function") this.onclick();
    },
    onsubmit: null,
    onclick: null,
    oninput: null,
    onchange: null,
  };
  return el;
}

class Option {
  constructor(text, value) {
    this.text = text;
    this.value = value;
    this.selected = false;
  }
}

function extractFunction(source, startPrefix) {
  const lines = source.split("\n");
  const start = lines.findIndex((l) => l.startsWith(startPrefix));
  assert.ok(start >= 0, startPrefix + " must exist in assets/workspace.mjs");
  if (lines[start].includes("{") && lines[start].trimEnd().endsWith("}")) return lines[start];
  let depth = 0;
  let end = start;
  for (; end < lines.length; end++) {
    for (const ch of lines[end]) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    if (end > start && depth === 0) break;
  }
  assert.ok(depth === 0, startPrefix + " braces must balance");
  return lines.slice(start, end + 1).join("\n");
}

async function loadAmendmentsPanel() {
  const source = await readFile(new URL("assets/workspace.mjs", root), "utf8");
  const line = (prefix) => {
    const found = source.split("\n").find((l) => l.startsWith(prefix));
    assert.ok(found, prefix + " must exist in assets/workspace.mjs");
    return found;
  };
  const registry = {};
  const documentStub = {
    createElement: (tag) => makeEl(tag),
    getElementById: (id) => (registry[id] ||= makeEl("div")),
  };
  const calls = { mutate: [], render: 0, messages: [] };
  const view = {
    project: { id: "a1841edc-a2fb-4178-87f1-13af20238e4a", revision: 2, evidence_epoch: 0 },
    role: "manager",
    orgRole: "owner",
    amendments: [],
  };
  const analysis = {
    analysis: { id: "38b4d138-a0d4-462b-a660-3ec985970bcb", status: "Completed" },
  };
  const stubs = {
    canWrite: () => view.role !== "viewer",
    canReview: () => true,
    mutate: async (action, payload) => {
      calls.mutate.push({ action, payload });
      return {};
    },
    render: () => { calls.render++; },
    api: async () => { throw new Error("api must not be called for an empty amendment list"); },
  };
  const body = [
    "let busy=false,dirty=false,accountEpoch=0;",
    "let view=__view,analysis=__analysis;",
    line("const $=id=>document.getElementById(id),node="),
    line("function message(t,error=false){"),
    line("function throwSafe(t){"),
    line("const actionQueue=createActionQueue("),
    line("async function run(fn){"),
    line("function button(t,fn,secondary=false){"),
    line("function field(parent,label,type="),
    line("function select(parent,label,values,value){"),
    line("function card(parent,title){"),
    line("function form(parent,title,fn){"),
    line("function submit(f,t){"),
    extractFunction(source, "function amendmentsPanel(parent,s){"),
    "return {amendmentsPanel,__registry:__registry};",
  ].join("\n");
  const factory = new Function(
    "document", "Option", "__view", "__analysis", "__registry",
    "canWrite", "canReview", "mutate", "render", "api",
    "amendmentKindLabels", "amendmentChangeTypeLabels",
    "amendmentChangeStatusLabels", "amendmentCounts",
    "createActionQueue",
    body,
  );
  const loaded = factory(
    documentStub, Option, view, analysis, registry,
    stubs.canWrite, stubs.canReview, stubs.mutate, stubs.render, stubs.api,
    amendmentKindLabels, amendmentChangeTypeLabels,
    amendmentChangeStatusLabels, amendmentCounts,
    createActionQueue,
  );
  return { ...loaded, calls, registry, view, analysis };
}

function collectTag(el, tag, out = []) {
  for (const c of el.children || []) {
    if (c.tagName === tag) out.push(c);
    collectTag(c, tag, out);
  }
  return out;
}

function findButton(el, text) {
  for (const c of collectTag(el, "BUTTON")) {
    if (c.textContent === text) return c;
  }
  return null;
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

test("propose amendment: Yes button submits amendmentPropose on second submit", async () => {
  const { amendmentsPanel, calls, registry } = await loadAmendmentsPanel();
  const parent = makeEl("div");
  amendmentsPanel(parent, {});
  const form = collectTag(parent, "FORM")[0];
  assert.ok(form, "amendments form must render");
  const inputs = collectTag(form, "INPUT");
  const analysisInput = inputs.find((i) => i.type === "text");
  assert.ok(analysisInput, "analysis ID field must render");
  analysisInput.value = "38b4d138-a0d4-462b-a660-3ec985970bcb";
  const kindSelect = collectTag(form, "SELECT")[0];
  assert.ok(kindSelect, "kind select must render");
  kindSelect.value = "supplemental";
  const shareBox = inputs.find((i) => i.type === "checkbox");
  assert.ok(shareBox, "share consent checkbox must render");
  shareBox.checked = true;

  // First submit: shows the in-page confirm, does not call mutate.
  const proposeBtn = findButton(parent, "Propose amendment for review");
  assert.ok(proposeBtn, "Propose button must render");
  assert.equal(proposeBtn.type, "submit");
  proposeBtn.click();
  await flush();
  assert.equal(calls.mutate.length, 0, "first submit must only show the confirm");
  const yesBtn = findButton(parent, "Yes, propose this amendment");
  assert.ok(yesBtn, "Yes button must appear after the first submit");
  assert.equal(yesBtn.type, "submit", "Yes must be a submit button in the form");
  let n = yesBtn.parentNode;
  while (n && n.tagName !== "FORM") n = n.parentNode;
  assert.ok(n, "Yes button must sit inside the form so its click submits it");

  // Second submit: the confirm Yes must reach mutate('amendmentPropose').
  yesBtn.click();
  await flush();
  assert.equal(calls.mutate.length, 1, "clicking Yes must submit exactly once");
  assert.equal(calls.mutate[0].action, "amendmentPropose");
  assert.equal(calls.mutate[0].payload.analysisId, "38b4d138-a0d4-462b-a660-3ec985970bcb");
  assert.equal(calls.mutate[0].payload.kind, "supplemental");
  assert.equal(calls.mutate[0].payload.confirmShare, true);
  assert.equal(calls.mutate[0].payload.versionNumber, null);
  assert.ok(calls.render >= 1, "panel must re-render after proposing");
  assert.match(registry.message.textContent, /Amendment proposed/);
});

test("propose amendment: confirmShare tracks the consent checkbox, not the label", async () => {
  // The Nov 18 defect: the handler read `share.checked` off the <label>,
  // which has no checked state, so confirmShare was never true. The fix
  // reads the checkbox itself, so the payload must follow its tick.
  const { amendmentsPanel, calls } = await loadAmendmentsPanel();
  const parent = makeEl("div");
  amendmentsPanel(parent, {});
  const form = collectTag(parent, "FORM")[0];
  const inputs = collectTag(form, "INPUT");
  const analysisInput = inputs.find((i) => i.type === "text");
  analysisInput.value = "38b4d138-a0d4-462b-a660-3ec985970bcb";
  collectTag(form, "SELECT")[0].value = "supplemental";
  const shareBox = inputs.find((i) => i.type === "checkbox");
  // Unticked: the payload must carry false, not a constant true.
  shareBox.checked = false;
  findButton(parent, "Propose amendment for review").click();
  await flush();
  findButton(parent, "Yes, propose this amendment").click();
  await flush();
  assert.equal(calls.mutate.length, 1);
  assert.equal(calls.mutate[0].payload.confirmShare, false);
});

test("propose amendment: Cancel clears the confirm without submitting", async () => {
  const { amendmentsPanel, calls } = await loadAmendmentsPanel();
  const parent = makeEl("div");
  amendmentsPanel(parent, {});
  findButton(parent, "Propose amendment for review").click();
  await flush();
  const cancelBtn = findButton(parent, "Cancel");
  assert.ok(cancelBtn, "Cancel button must appear with the confirm");
  cancelBtn.click();
  await flush();
  assert.equal(calls.mutate.length, 0, "Cancel must not submit");
  assert.equal(findButton(parent, "Yes, propose this amendment"), null, "confirm must clear after Cancel");
  // A fresh Propose after Cancel must show the confirm again, not submit.
  findButton(parent, "Propose amendment for review").click();
  await flush();
  assert.equal(calls.mutate.length, 0);
  assert.ok(findButton(parent, "Yes, propose this amendment"), "confirm must reappear on a fresh Propose");
});
