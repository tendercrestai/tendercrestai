// The shared site header is rendered statically at build time
// (scripts/lib/site-chrome.mjs), so it says "Log in" on every public page
// even while signed in — the account hub on auth.html knows the session,
// the header never did. That is why the pricing and shredder pages showed
// "Log in" for a signed-in account.
//
// Swap the header link to "My account" when a Supabase session token is
// stored locally. No network call: the Supabase JS client keeps the
// session in localStorage under sb-<project-ref>-auth-token, so reading
// it here is synchronous and runs before first paint in practice (module
// scripts are deferred, the header is already parsed). A parseable token
// with an access_token means signed in — sign-out removes the token, and
// an expired token still resolves to the account page, where auth.html
// refreshes the session or shows sign-in. Any failure leaves the header
// exactly as built ("Log in").
//
// Nov 25 full-site review, logged-in #11: a signed-in account must never
// be offered a trial for a plan it may already hold. When signed in, the
// header trial link becomes "Open workspace" pointing at /workspace.html
// instead — the hub trial section and the pricing page still serve a
// signed-in account with no plan, so nothing is hidden, only retargeted.
// Logged-in #10: the shredder reads the same stored session through
// hasStoredSession() to acknowledge a signed-in user.
export function hasStoredSession(storage = globalThis.localStorage) {
  try {
    if (!storage) return false;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key || !key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      let session = null;
      try { session = JSON.parse(storage.getItem(key)); } catch { continue; }
      if (session && typeof session.access_token === "string" && session.access_token) return true;
    }
  } catch {}
  return false;
}
export function syncSiteHeaderSessionLink(doc = document, storage = globalThis.localStorage) {
  try {
    const link = doc.querySelector(".site-login-link");
    if (!link || !storage) return false;
    if (!hasStoredSession(storage)) return false;
    link.textContent = "My account";
    const trial = doc.querySelector(".site-trial-link");
    if (trial) {
      trial.textContent = "Open workspace";
      trial.href = "/workspace.html";
    }
    return true;
  } catch {}
  return false;
}
try { syncSiteHeaderSessionLink(); } catch {}
