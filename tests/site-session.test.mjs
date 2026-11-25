// Header session state (assets/site-session.mjs): the shared header is
// rendered statically at build time, so it said "Log in" on the pricing
// and shredder pages even while signed in. A stored Supabase session must
// flip it to "My account"; anything else leaves it exactly as built.
import { test } from "node:test";
import assert from "node:assert/strict";

function fakeStorage(entries) {
  const map = new Map(entries);
  const keys = [...map.keys()];
  return {
    length: keys.length,
    key: (i) => keys[i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
  };
}
function fakeDoc(link) {
  return { querySelector: (sel) => (sel === ".site-login-link" ? link : null) };
}

const { syncSiteHeaderSessionLink } = await import("../assets/site-session.mjs");

test("stored Supabase session flips the header link to My account", () => {
  const link = { textContent: "Log in" };
  const storage = fakeStorage([
    ["sb-vfdwaqgfepvoujprtuww-auth-token", JSON.stringify({ access_token: "eyJ.test", expires_at: 9999999999 })],
  ]);
  assert.equal(syncSiteHeaderSessionLink(fakeDoc(link), storage), true);
  assert.equal(link.textContent, "My account");
});

test("no session token leaves the header as Log in", () => {
  const link = { textContent: "Log in" };
  assert.equal(syncSiteHeaderSessionLink(fakeDoc(link), fakeStorage([])), false);
  assert.equal(link.textContent, "Log in");
});

test("unparseable or token-less storage leaves the header as Log in", () => {
  const link = { textContent: "Log in" };
  const bad = fakeStorage([["sb-abc-auth-token", "not json{"]]);
  assert.equal(syncSiteHeaderSessionLink(fakeDoc(link), bad), false);
  const empty = fakeStorage([["sb-abc-auth-token", JSON.stringify({ refresh_token: "x" })]]);
  assert.equal(syncSiteHeaderSessionLink(fakeDoc(link), empty), false);
  assert.equal(link.textContent, "Log in");
});

test("a page without the header link is a no-op", () => {
  const storage = fakeStorage([
    ["sb-abc-auth-token", JSON.stringify({ access_token: "eyJ.test" })],
  ]);
  assert.equal(syncSiteHeaderSessionLink({ querySelector: () => null }, storage), false);
});
