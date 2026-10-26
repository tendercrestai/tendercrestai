const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PROGRESS = Object.freeze({
  queued: { label: "✓ Queued for generation", message: "Your proposal is queued. This page will update automatically." },
  processing: { label: "Processing…", message: "Your proposal is processing. This page will update automatically." },
  parsing: { label: "Reading requirements…", message: "Your RFP requirements are being analyzed." },
  drafting: { label: "Generating draft…", message: "Your proposal draft is being generated." },
  ready: { label: "✓ Draft ready — check your email", message: "Your proposal draft is ready. Check your email for delivery; inbox receipt is not confirmed by this page.", terminal: true },
  failed: { label: "Generation failed", message: "Proposal generation failed. Contact support before submitting it again.", terminal: true, error: true },
  quota_exceeded: { label: "Proposal allowance reached", message: "Your proposal allowance has been reached. Check your account before submitting again.", terminal: true, error: true },
  uncertain: { label: "Awaiting verification", message: "Your submission is awaiting verification. Contact support before submitting it again.", terminal: true, error: true },
  retryable: { label: "Submission not queued", message: "Your submission was not queued. Retry with the same document and inputs.", terminal: true, error: true }
});

export function createProposalStatusTracker({
  supabase, storageKey, onUpdate, onAuthExpired,
  environment = {
    fetch: (...args) => globalThis.fetch(...args),
    storage: () => globalThis.sessionStorage,
    document: globalThis.document,
    setTimeout: (...args) => globalThis.setTimeout(...args),
    clearTimeout: id => globalThis.clearTimeout(id)
  }
}) {
  let active = null, timer = null, controller = null, epoch = 0, failures = 0;
  const key = owner => storageKey + ":" + owner;
  function clearTimer() {
    if (timer !== null) environment.clearTimeout(timer);
    timer = null;
  }
  function stop() {
    epoch++;
    clearTimer();
    controller?.abort();
    controller = null;
    active = null;
  }
  function forget(owner) {
    stop();
    try { environment.storage().removeItem(key(owner)); } catch { /* best effort */ }
  }
  function schedule(delay) {
    clearTimer();
    if (active && !environment.document?.hidden) {
      timer = environment.setTimeout(() => { timer = null; void poll(); }, delay);
    }
  }
  async function poll() {
    if (!active || controller || environment.document?.hidden) return;
    const current = epoch;
    const tracked = active;
    controller = new AbortController();
    const requestController = controller;
    const timeout = environment.setTimeout(() => requestController.abort(), 10000);
    try {
      const { data, error } = await supabase.auth.getSession();
      if (current !== epoch) return;
      if (error || !data.session || data.session.user.id !== tracked.owner) {
        stop();
        onAuthExpired?.();
        return;
      }
      const response = await environment.fetch(
        "/.netlify/functions/proposal-status?submissionId=" + encodeURIComponent(tracked.id),
        {
          headers: { Authorization: "Bearer " + data.session.access_token },
          signal: requestController.signal,
          cache: "no-store"
        }
      );
      if (current !== epoch) return;
      if (response.status === 401) {
        stop();
        onAuthExpired?.();
        return;
      }
      if (response.status === 404) {
        forget(tracked.owner);
        onUpdate({ label: "Submission not found", message: "This submission could not be found in your account. Contact support before submitting again. Support reference: " + tracked.id + ".", error: true });
        return;
      }
      if (!response.ok) throw new Error("Status unavailable");
      const result = await response.json();
      if (current !== epoch) return;
      const progress = PROGRESS[result.status];
      if (!progress) throw new Error("Unknown status");
      failures = 0;
      onUpdate({ ...progress, status: result.status, reference: tracked.id, message: progress.error ? progress.message + ' Support reference: ' + tracked.id + '.' : progress.message });
      if (progress.terminal) {
        stop();
        return;
      }
      schedule(10000);
    } catch {
      if (current !== epoch) return;
      failures++;
      onUpdate({
        label: null,
        message: "Your submission is saved. Status is temporarily unavailable; checking again shortly.",
        error: false
      });
      schedule(Math.min(60000, 10000 * 2 ** Math.min(failures, 3)));
    } finally {
      environment.clearTimeout(timeout);
      if (current === epoch) controller = null;
    }
  }
  function start(id, owner) {
    if (!UUID.test(id || "") || !UUID.test(owner || "")) return false;
    if (active?.id === id && active?.owner === owner) return true;
    stop();
    active = { id, owner };
    failures = 0;
    try { environment.storage().setItem(key(owner), id); } catch { /* polling still works */ }
    void poll();
    return true;
  }
  function resume(owner) {
    let id;
    try { id = environment.storage().getItem(key(owner)); } catch { return false; }
    if (!UUID.test(id || "")) {
      if (active && active.owner !== owner) stop();
      return false;
    }
    return start(id, owner);
  }
  function visibilityChanged() {
    if (environment.document?.hidden) clearTimer();
    else if (active && !controller) void poll();
  }
  environment.document?.addEventListener("visibilitychange", visibilityChanged);
  return {
    start, resume, stop, forget,
    destroy() {
      stop();
      environment.document?.removeEventListener("visibilitychange", visibilityChanged);
    }
  };
}
