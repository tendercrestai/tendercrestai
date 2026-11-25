// In-page confirm/prompt/notice dialogs (assets/in-page-confirm.mjs):
// they must work with native JS dialogs suppressed — the trial-checkout
// bug (Nov 24, 2026) was exactly that window.confirm() silently returned
// false in dialog-suppressing browsers, so the click did nothing at all.
// These tests run with throwing confirm/prompt/alert globals, proving the
// flows never touch a native dialog.
import { test } from "node:test";
import assert from "node:assert/strict";

function makeElement(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    children: [],
    style: { cssText: "" },
    attributes: {},
    textContent: "",
    hidden: false,
    disabled: false,
    type: "",
    value: "",
    placeholder: "",
    className: "",
    onclick: null,
    parent: null,
    _listeners: {},
    _focused: false,
    append(...nodes) {
      for (const n of nodes) { n.parent = el; el.children.push(n); }
      return el;
    },
    replaceChildren(...nodes) {
      el.children = [];
      for (const n of nodes) { n.parent = el; el.children.push(n); }
      return el;
    },
    remove() {
      if (!el.parent) return;
      const i = el.parent.children.indexOf(el);
      if (i >= 0) el.parent.children.splice(i, 1);
      el.parent = null;
    },
    setAttribute(k, v) { el.attributes[k] = String(v); },
    getAttribute(k) { return el.attributes[k] ?? null; },
    addEventListener(type, fn) { el._listeners[type] = fn; },
    removeEventListener(type) { delete el._listeners[type]; },
    focus() { el._focused = true; },
  };
  return el;
}
function findButton(root, label) {
  const walk = (node) => {
    for (const c of node.children) {
      if (c.tagName === "BUTTON" && c.textContent === label) return c;
      const found = walk(c);
      if (found) return found;
    }
    return null;
  };
  return walk(root);
}
function findInput(root) {
  const walk = (node) => {
    for (const c of node.children) {
      if (c.tagName === "INPUT") return c;
      const found = walk(c);
      if (found) return found;
    }
    return null;
  };
  return walk(root);
}
function dialogErrorText(root) {
  const walk = (node) => {
    for (const c of node.children) {
      if (c.tagName === "P" && c.attributes.role === "alert") return c.textContent;
      const found = walk(c);
      if (found) return found;
    }
    return null;
  };
  return walk(root);
}

const body = makeElement("body");
globalThis.document = {
  createElement: (tag) => makeElement(tag),
  body,
  addEventListener(type, fn) { (this._listeners ??= {})[type] = fn; },
  removeEventListener(type) { if (this._listeners) delete this._listeners[type]; },
};
// Native dialogs are suppressed here (throwing): any call to one fails
// the test, proving the flows do not depend on them.
globalThis.confirm = () => { throw new Error("native confirm called"); };
globalThis.prompt = () => { throw new Error("native prompt called"); };
globalThis.alert = () => { throw new Error("native alert called"); };

const { askConfirm, askText, showNotice } = await import("../assets/in-page-confirm.mjs");

test("askConfirm resolves true on Confirm and false on Cancel", async () => {
  const yes = askConfirm("Proceed?");
  findButton(body, "Confirm").onclick();
  assert.equal(await yes, true);
  assert.equal(body.children.length, 0, "dialog is removed after Confirm");
  const no = askConfirm("Proceed?");
  findButton(body, "Cancel").onclick();
  assert.equal(await no, false);
  assert.equal(body.children.length, 0, "dialog is removed after Cancel");
});

test("askConfirm resolves false on backdrop click and on Escape", async () => {
  const backdrop = askConfirm("Proceed?");
  const overlay = body.children[0];
  overlay._listeners.click({ target: overlay });
  assert.equal(await backdrop, false);
  const escape = askConfirm("Proceed?");
  globalThis.document._listeners.keydown({ key: "Escape" });
  assert.equal(await escape, false);
});

test("askText resolves the typed value, null on Cancel, and blocks empty input", async () => {
  const typed = askText("Explain why.");
  const field = findInput(body);
  field.value = "  because it is needed  ";
  findButton(body, "Continue").onclick();
  assert.equal(await typed, "because it is needed");
  const empty = askText("Explain why.");
  const emptyField = findInput(body);
  emptyField.value = "   ";
  findButton(body, "Continue").onclick();
  assert.equal(body.children.length, 1, "empty input keeps the dialog open");
  emptyField.value = "filled in";
  findButton(body, "Continue").onclick();
  assert.equal(await empty, "filled in");
  const cancelled = askText("Explain why.");
  findButton(body, "Cancel").onclick();
  assert.equal(await cancelled, null);
});

test("askText with an expected value rejects mismatches and keeps the dialog open", async () => {
  const p = askText("Type DELETE to confirm.", { expected: "DELETE", confirmLabel: "Delete" });
  const field = findInput(body);
  field.value = "delete";
  findButton(body, "Delete").onclick();
  assert.equal(body.children.length, 1, "wrong value keeps the dialog open");
  assert.match(dialogErrorText(body), /does not match/);
  field.value = "DELETE";
  findButton(body, "Delete").onclick();
  assert.equal(await p, "DELETE");
  assert.equal(body.children.length, 0, "correct value closes the dialog");
});

test("showNotice resolves when dismissed", async () => {
  const p = showNotice("All mandatory fields are required.");
  assert.ok(findButton(body, "OK"), "notice has an OK button");
  findButton(body, "OK").onclick();
  await p;
  assert.equal(body.children.length, 0, "notice is removed after OK");
});

test("a second dialog supersedes the first as cancelled", async () => {
  const first = askConfirm("First?");
  const second = askConfirm("Second?");
  assert.equal(await first, false, "superseded dialog resolves as cancelled");
  assert.equal(body.children.length, 1, "only the second dialog remains");
  findButton(body, "Confirm").onclick();
  assert.equal(await second, true);
});
