const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const modeKey = owner => "tendercrest-new-upload:" + owner;

export function uploadAttemptKey(owner, fileHash, storage = globalThis.sessionStorage) {
  const intent = storage.getItem(modeKey(owner));
  // Existing retries keep their original key until the user explicitly starts new.
  return "tendercrest-rfp:" + owner + ":" +
    (UUID.test(intent || "") ? intent + ":" : "") + fileHash;
}

export function beginNewUpload(
  owner,
  storage = globalThis.sessionStorage,
  createId = () => crypto.randomUUID()
) {
  const intent = createId();
  if (!UUID.test(owner || "") || !UUID.test(intent || "")) {
    throw new Error("Please sign in again before starting a new proposal.");
  }
  // Keep older attempts intact. A reload/retry of the new attempt uses this same mode.
  storage.setItem(modeKey(owner), intent);
  return intent;
}

export function mayStartNew(status) {
  return ["queued", "parsing", "drafting", "ready", "failed", "quota_exceeded"].includes(status);
}
