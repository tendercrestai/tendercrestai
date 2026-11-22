// Consent coordinator (assets/consent-banner.mjs): one combined banner for
// the four opt-in providers, with a minimal DOM stub. No browser needed.
import { test } from "node:test";
import assert from "node:assert/strict";

function makeElement(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    id: "",
    children: [],
    style: { cssText: "" },
    dataset: {},
    attributes: {},
    textContent: "",
    hidden: false,
    disabled: false,
    type: "",
    href: "",
    onclick: null,
    _focused: false,
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
      if (k === "data-consent-id") el.dataset.consentId = String(v);
    },
    getAttribute(k) {
      return el.attributes[k] ?? null;
    },
    querySelector(sel) {
      const rowMatch = sel.match(/^\[data-consent-id="([^"]+)"\] button$/);
      const walk = (node, inRow) => {
        for (const c of node.children) {
          const row = inRow || (c.attributes["data-consent-id"] === (rowMatch && rowMatch[1]) ? c : null);
          if (row && c.tagName === "BUTTON") return c;
          if (!rowMatch && sel === "button" && c.tagName === "BUTTON") return c;
          const found = walk(c, row || inRow);
          if (found) return found;
        }
        return null;
      };
      return walk(el, null);
    },
    focus() {
      el._focused = true;
    },
  };
  Object.defineProperty(el, "firstChild", { get() { return el.children[0] || null; } });
  return el;
}

const body = makeElement("body");
globalThis.document = {
  createElement: (tag) => makeElement(tag),
  body,
  querySelector: () => null,
};
const banner = await import("../assets/consent-banner.mjs");

function fakeOption(id, saved) {
  const state = { saved: saved || null, decisions: [] };
  return {
    id,
    title: id,
    summary: id + " summary",
    detailsHref: "/security.html",
    state,
    readChoice: () => state.saved,
    saveChoice: (allowed) => {
      state.saved = { allowed, expires: Date.now() + 1000 };
      return true;
    },
    onDecision: (allowed) => { state.decisions.push(allowed); },
    shouldPrompt: () => !state.saved,
    canAllow: () => true,
  };
}
const tick = () => new Promise((r) => setTimeout(r, 10));
function bannerElement() {
  return body.children.find((c) => c.id === "consent-banner") || null;
}
function bannerRows(el) {
  const wrap = el.children.find((c) => /overflow-y:auto/.test(c.style.cssText));
  assert.ok(wrap, "provider rows live in a scrolling wrapper");
  return wrap.children;
}
function bannerActions(el) {
  return el.children[el.children.length - 1];
}

test("consent coordinator renders one banner for all providers and hides once every choice is saved", async () => {
  const options = ["analytics", "openai", "google", "rewardful"].map((id) => fakeOption(id));
  for (const option of options) banner.registerConsentOption(option);
  await tick();
  const el = bannerElement();
  assert.ok(el, "one banner element is created");
  assert.equal(body.children.filter((c) => c.id === "consent-banner").length, 1);
  assert.equal(el.hidden, false, "banner shows while choices are pending");
  // h2 + intro + rows wrapper + actions
  assert.equal(el.children.length, 4);
  const rows = bannerRows(el).filter((c) => c.attributes["data-consent-id"]);
  assert.deepEqual(rows.map((r) => r.attributes["data-consent-id"]), ["analytics", "openai", "google", "rewardful"]);

  // Decline all saves a choice for every provider and hides the banner.
  const actions = bannerActions(el);
  assert.equal(actions.children.length, 2);
  actions.children[1].onclick(); // Decline all
  for (const option of options) {
    assert.deepEqual(option.state.saved.allowed, false, option.id + " declined");
    assert.deepEqual(option.state.decisions, [false]);
  }
  assert.equal(el.hidden, true, "banner hides once every provider has a choice");

  // A footer settings button reopens the banner, focused on that provider.
  banner.showConsentBanner("google");
  assert.equal(el.hidden, false, "settings button reopens the banner");
  const googleButton = el.querySelector('[data-consent-id="google"] button');
  assert.ok(googleButton && googleButton._focused, "focus lands on the Google row");

  // Allowing the last undecided provider hides the banner again.
  googleButton.onclick();
  assert.equal(options[2].state.saved.allowed, true, "google allowed");
  assert.equal(el.hidden, true);
});

test("consent coordinator shows a saved status and does not prompt for decided providers", async () => {
  const decided = fakeOption("decided", { allowed: true, expires: Date.now() + 1000 });
  banner.registerConsentOption(decided);
  await tick();
  const el = bannerElement();
  assert.equal(el.hidden, true, "banner stays hidden when every provider is decided");
  banner.showConsentBanner("decided");
  const row = bannerRows(el).find((c) => c.attributes["data-consent-id"] === "decided");
  assert.ok(row, "decided provider row renders on demand");
  assert.match(row.children[0].children[0].textContent, /Allowed/);
  banner.setConsentStatus("decided", "Test status note.");
  const updated = bannerRows(el).find((c) => c.attributes["data-consent-id"] === "decided");
  const status = updated.children[0].children.find((c) => c.attributes.role === "status");
  assert.ok(status, "status note renders");
  assert.equal(status.textContent, "Test status note.");
});

test("banner pins Allow all / Decline all below a scrolling rows area", async () => {
  const el = bannerElement();
  banner.showConsentBanner();
  // Panel is a flex column, not a scrolling box: the panel itself must
  // not scroll, or the pinned actions would scroll away with the rows.
  assert.match(el.style.cssText, /display:flex/);
  assert.match(el.style.cssText, /flex-direction:column/);
  assert.doesNotMatch(el.style.cssText, /overflow:auto/);
  // Rows live in a flex:1 wrapper that scrolls on its own.
  const wrap = el.children.find((c) => /overflow-y:auto/.test(c.style.cssText));
  assert.ok(wrap, "rows wrapper exists");
  assert.match(wrap.style.cssText, /flex:1/);
  assert.match(wrap.style.cssText, /min-height:0/);
  // Actions are the last child, pinned with flex:none and a solid
  // background matching the panel so rows cannot bleed through.
  const actions = bannerActions(el);
  assert.equal(actions.children.length, 2);
  assert.match(actions.children[0].textContent, /Allow all/);
  assert.match(actions.children[1].textContent, /Decline all/);
  assert.match(actions.style.cssText, /flex:none/);
  assert.match(actions.style.cssText, /background:#fff/);
  // Heading and intro stay fixed above the rows area.
  assert.match(el.children[0].style.cssText, /flex:none/);
  assert.match(el.children[1].style.cssText, /flex:none/);
});

test("banner reserves bottom space while visible so the footer stays reachable", async () => {
  const el = bannerElement();
  el.offsetHeight = 420;
  banner.showConsentBanner();
  assert.equal(document.body.style.paddingBottom, "420px", "visible banner reserves its height as bottom padding");
  assert.match(el.style.cssText, /max-height:52vh/);
  assert.match(el.style.cssText, /padding:8px 16px/);
  const row = bannerRows(el).find((c) => c.attributes["data-consent-id"] === "google");
  assert.match(row.style.cssText, /padding:6px 0/);
  // Hiding the banner releases the reserved space again.
  const actions = bannerActions(el);
  actions.children[1].onclick(); // Decline all
  assert.equal(el.hidden, true);
  assert.equal(document.body.style.paddingBottom, "", "hidden banner releases the reserved space");
});
