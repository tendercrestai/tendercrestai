// Trial checkout in the account hub (assets/customer-hub.mjs): with native
// JS dialogs suppressed — the exact environment that killed the checkout
// on Nov 24, 2026 (window.confirm() silently returned false, so the click
// did nothing at all) — clicking a plan button must still show the in-page
// confirm, and confirming must still reach the Stripe redirect.
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

const body = makeElement("body");
globalThis.document = {
  createElement: (tag) => makeElement(tag),
  body,
  addEventListener(type, fn) { (this._listeners ??= {})[type] = fn; },
  removeEventListener(type) { if (this._listeners) delete this._listeners[type]; },
};
// Native dialogs suppressed (throwing): the checkout must not call one.
globalThis.confirm = () => { throw new Error("native confirm called"); };
globalThis.prompt = () => { throw new Error("native prompt called"); };
globalThis.alert = () => { throw new Error("native alert called"); };

let assigned = null;
let failCheckout = false;
globalThis.location = { assign: (url) => { assigned = url; } };
globalThis.fetch = async (url) => {
  if (String(url).includes("/auth-config")) {
    return { ok: true, json: async () => ({ customerCare: true, authenticatedCheckout: true }) };
  }
  if (String(url).includes("/account-usage")) {
    return { ok: false, json: async () => ({}) };
  }
  if (String(url).includes("/customer-care")) {
    if (failCheckout) return { ok: false, json: async () => ({ error: "Invalid knowledge request." }) };
    return { ok: true, json: async () => ({ url: "https://checkout.stripe.com/pay/cs_test_grant_starter" }) };
  }
  throw new Error("unexpected fetch: " + url);
};
const getSession = async () => ({ data: { session: { user: { id: "user-1" }, access_token: "token-1" } } });

const { createCustomerHub } = await import("../assets/customer-hub.mjs");

async function openHub() {
  assigned = null;
  body.replaceChildren();
  const container = makeElement("div");
  const hub = createCustomerHub(container, getSession);
  await hub.show({ id: "user-1" });
  return container;
}

test("grant-starter checkout reaches the Stripe redirect with dialogs suppressed", async () => {
  const container = await openHub();
  const planButton = findButton(container, "Continue to grant-starter checkout");
  assert.ok(planButton, "grant-starter checkout button renders");
  // Fire the click without awaiting: it waits on the in-page confirm.
  const clicked = planButton.onclick();
  const confirmButton = findButton(body, "Continue to Stripe");
  assert.ok(confirmButton, "in-page confirm appears instead of a native dialog");
  confirmButton.onclick();
  await clicked;
  assert.equal(assigned, "https://checkout.stripe.com/pay/cs_test_grant_starter");
});

test("cancelling the in-page confirm never calls checkout", async () => {
  const container = await openHub();
  const planButton = findButton(container, "Continue to grant-plus checkout");
  assert.ok(planButton, "grant-plus checkout button renders");
  const clicked = planButton.onclick();
  const cancelButton = findButton(body, "Cancel");
  assert.ok(cancelButton, "in-page confirm offers Cancel");
  cancelButton.onclick();
  await clicked;
  assert.equal(assigned, null, "no redirect after Cancel");
  assert.equal(planButton.disabled, false, "plan button is usable again after Cancel");
});

test("every plan button uses the in-page confirm, not a native dialog", async () => {
  const container = await openHub();
  for (const plan of ["pro", "growth", "enterprise", "grant-starter", "grant-plus", "grant-pro"]) {
    const button = findButton(container, "Continue to " + plan + " checkout");
    assert.ok(button, plan + " checkout button renders");
  }
  assert.equal(body.children.length, 0, "no dialog is open before any click");
});

function findAlert(root) {
  const walk = (node) => {
    for (const c of node.children) {
      if (c.attributes.role === "alert") return c;
      const found = walk(c);
      if (found) return found;
    }
    return null;
  };
  return walk(root);
}

test("a failed checkout shows the server error next to the plan buttons and leaves the button usable", async () => {
  // Nov 25, 2026: 11 checkout attempts failed with 'Invalid knowledge
  // request.' (the grant plans were rejected by the checkout database
  // function) and the failure landed only in the shared status line at the
  // top of the hub, far from the buttons — nothing near the buttons said so.
  // The error must now appear in the checkout section itself.
  failCheckout = true;
  try {
    const container = await openHub();
    const planButton = findButton(container, "Continue to grant-starter checkout");
    assert.ok(planButton, "grant-starter checkout button renders");
    const clicked = planButton.onclick();
    const confirmButton = findButton(body, "Continue to Stripe");
    assert.ok(confirmButton, "in-page confirm appears");
    confirmButton.onclick();
    await clicked;
    assert.equal(assigned, null, "no redirect after a failed checkout");
    assert.equal(planButton.disabled, false, "plan button is usable again after a failed checkout");
    const alert = findAlert(container);
    assert.ok(alert, "checkout error line renders in the checkout section");
    assert.match(alert.textContent, /Checkout failed: Invalid knowledge request\./);
  } finally {
    failCheckout = false;
  }
});
