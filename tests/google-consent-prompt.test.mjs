// Regression: the consent banner could never dismiss on a URL with
// unsupported parameters (google-ads.mjs shouldPrompt returned true
// whenever !safe(), even with a saved choice). Allow all skipped Google
// via canAllow, and even Decline all left shouldPrompt true, so the
// banner reappeared on every load of such a URL. A saved choice must
// stop prompting; measurement is disabled on those URLs anyway.
import { test } from "node:test";
import assert from "node:assert/strict";

function makeElement(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    id: "",
    children: [],
    style: { cssText: "", display: "" },
    attributes: {},
    textContent: "",
    hidden: false,
    disabled: false,
    type: "",
    href: "",
    onclick: null,
    offsetHeight: 0,
    append(...nodes) {
      for (const n of nodes) el.children.push(n);
      return el;
    },
    removeChild(n) {
      const i = el.children.indexOf(n);
      if (i >= 0) el.children.splice(i, 1);
      return n;
    },
    setAttribute(k, v) {
      el.attributes[k] = String(v);
    },
    getAttribute(k) {
      return el.attributes[k] ?? null;
    },
    querySelector() {
      return null;
    },
    focus() {},
  };
  Object.defineProperty(el, "firstChild", { get() { return el.children[0] || null; } });
  return el;
}

const store = new Map();
function defineGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
defineGlobal("localStorage", {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
});
defineGlobal("navigator", {});
defineGlobal("location", {
  pathname: "/",
  hash: "",
  search: "?fbclid=abc123",
  href: "https://www.tendercrestai.com/?fbclid=abc123",
});
defineGlobal("window", { addEventListener() {} });
const body = makeElement("body");
defineGlobal("document", {
  createElement: (tag) => makeElement(tag),
  body,
  querySelector: () => null,
  readyState: "complete",
});

const KEY = "tendercrest.google-ads-consent.v1";
const tick = () => new Promise((r) => setTimeout(r, 10));
function bannerElement() {
  return body.children.find((c) => c.id === "consent-banner") || null;
}

test("Decline all dismisses the banner on a URL with unsupported parameters", async () => {
  await import("../assets/google-ads.mjs");
  await tick();
  const banner = bannerElement();
  assert.ok(banner, "banner renders");
  assert.equal(banner.hidden, false, "banner prompts while undecided");
  const actions = banner.children[banner.children.length - 1];
  const declineAll = actions.children.find((c) => c.textContent === "Decline all");
  assert.ok(declineAll, "Decline all button exists");
  declineAll.onclick();
  assert.equal(banner.hidden, true, "banner hides after Decline all");
  assert.equal(banner.style.display, "none", "banner display none when hidden");
  const saved = JSON.parse(store.get(KEY));
  assert.equal(saved.allowed, false, "Google choice saved as declined");
});

test("A saved Google choice keeps the banner hidden on a URL with unsupported parameters", async () => {
  store.set(KEY, JSON.stringify({ allowed: true, since: Date.now(), expires: Date.now() + 86400000 }));
  await import("../assets/google-ads.mjs?saved-choice");
  await tick();
  const banner = bannerElement();
  assert.ok(banner, "banner renders");
  assert.equal(banner.hidden, true, "banner stays hidden with a saved choice");
  assert.equal(banner.style.display, "none", "banner display none when hidden");
});
