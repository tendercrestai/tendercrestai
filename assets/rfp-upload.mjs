import { createBrowserClient } from './supabase-client.mjs';

import { createProposalStatusTracker } from "./proposal-status.mjs";
import { uploadAttemptKey, beginNewUpload, mayStartNew } from "./upload-attempt.mjs";

import {
  extractText,
  validateFile,
  MAX_TEXT
} from "./rfp-document.mjs";

const supabase = await createBrowserClient();

const $ = id => document.getElementById(id);

let user;
let selected;
let pending;
let busy = false;
let generation = 0;
let completed = false;
let canStartNew = false;

function notify(message, error = false) {
  $("message").textContent = message;
  $("message").className =
    "alert-banner " + (error ? "alert-error" : "alert-success");
}

function requireLogin() {
  statusTracker.stop();
  user = null;
  selected = null;
  pending = null;
  canStartNew = false;
  $("another").hidden = true;
  generation++;

  $("review-text").value = "";
  $("qualifications").value = "";
  $("proposal-name").value = "";
  $("company-name").value = "";
  $("document").value = "";

  $("upload-form").hidden = true;
  $("login-prompt").hidden = false;
  $("signed-in-email").textContent = "";

  notify(
    "Your session has expired. Log in again, then select your document to continue.",
    true
  );
}

async function session() {
  const { data, error } = await supabase.auth.getSession();

  if (
    error ||
    !data.session ||
    data.session.user.id !== user?.id
  ) {
    requireLogin();
    throw new Error("Please log in again before continuing.");
  }

  const verified = await supabase.auth.getUser();

  if (
    verified.error ||
    verified.data.user?.id !== user.id
  ) {
    if (
      verified.error?.status === 401 ||
      verified.error?.status === 403 ||
      !verified.error
    ) {
      requireLogin();
    }

    throw new Error(
      "Your session could not be verified. Check your connection or log in again."
    );
  }

  return data.session;
}

async function hash(value) {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : value;

  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(
    new Uint8Array(digest),
    byte => byte.toString(16).padStart(2, "0")
  ).join("");
}

function savePending() {
  // Persist IDs and hashes only, never document text or tokens.
  try {
    sessionStorage.setItem(pending.key, JSON.stringify(pending));
  } catch {
    throw new Error(
      "Enable session storage so upload retries can be handled safely."
    );
  }
}

const statusTracker = createProposalStatusTracker({
  supabase,
  storageKey: "tendercrest-upload-status",
  onUpdate(progress) {
    completed = true;
    $("upload-fields").disabled = true;
    if (progress.status) canStartNew = mayStartNew(progress.status);
    $("another").hidden = !canStartNew;
    notify(progress.message, progress.error);
    if (progress.label) $("submit").textContent = progress.label;
  },
  onAuthExpired: requireLogin
});
$("another").addEventListener("click", async event => {
  event.preventDefault();
  if (busy || !user || !canStartNew) return;
  busy = true;
  try {
    await session();
    beginNewUpload(user.id);
    statusTracker.forget(user.id);
    generation++;
    selected = null;
    pending = null;
    completed = false;
    canStartNew = false;
    $("document").value = "";
    $("review-text").value = "";
    $("proposal-name").value = "";
    $("qualifications").value = "";
    $("review-confirmation").checked = false;
    $("review").hidden = true;
    $("another").hidden = true;
    $("upload-fields").disabled = false;
    $("submit").textContent = "Upload and submit RFP";
    notify("New proposal started. Select your document again; you can use the same file. Submitting creates a separate draft and uses your proposal allowance.");
  } catch (error) {
    notify(error.message || "A new proposal could not be started. Try again.", true);
  } finally {
    busy = false;
  }
});

function count() {
  const length = $("review-text").value.trim().length;

  $("text-count").textContent =
    length.toLocaleString() + " / 100,000 characters" +
    (
      length > MAX_TEXT
        ? " — shorten the text before submitting."
        : ""
    );

  $("review-confirmation").checked = false;
}

$("review-text").addEventListener("input", count);

$("document").addEventListener("change", async () => {
  if (busy || completed) return;

  const current = ++generation;

  selected = null;
  pending = null;
  $("review").hidden = true;
  $("review-text").value = "";

  const file = $("document").files[0];
  if (!file) return;

  busy = true;
  $("upload-fields").disabled = true;
  notify("Extracting document text for your review…");

  try {
    await session();

    const { extension, mime } = validateFile(file);
    const text = await extractText(file);
    const fileHash = await hash(await file.arrayBuffer());

    if (current !== generation || !user) return;

    const key = uploadAttemptKey(user.id, fileHash);
    const stored = sessionStorage.getItem(key);
    let previous;

    try {
      previous = JSON.parse(stored);
    } catch {
      // Ignore damaged local retry state.
    }

    pending =
      previous?.key === key &&
      previous?.documentId &&
      previous?.submissionId
        ? previous
        : {
            key,
            documentId: crypto.randomUUID(),
            submissionId: crypto.randomUUID()
          };

    savePending();

    selected = {
      file,
      extension,
      mime,
      fileHash,
      userId: user.id
    };

    $("review-text").value = text;

    if (!$("proposal-name").value) {
      $("proposal-name").value = file.name
        .replace(/\.[^.]+$/, "")
        .slice(0, 300);
    }

    count();
    $("review").hidden = false;

    notify(
      "Text extracted. Review it below before uploading and submitting."
    );
  } catch (error) {
    notify(
      error.message ||
        "This document could not be read. Try another file.",
      true
    );
  } finally {
    busy = false;
    $("upload-fields").disabled = completed;
  }
});

$("upload-form").addEventListener("submit", async event => {
  event.preventDefault();

  if (busy || completed || !selected || !pending) return;

  busy = true;
  $("upload-fields").disabled = true;
  $("submit").textContent = "Uploading and submitting…";

  try {
    const auth = await session();
    const owner = user.id;

    if (selected.userId !== owner) {
      throw new Error("Select your document again.");
    }

    const payload = {
      proposalName: $("proposal-name").value.trim(),
      submitterEmail: user.email,
      organizationName: $("company-name").value.trim(),
      proposalSector: $("proposal-sector").value,
      rfpText: $("review-text").value.trim(),
      qualifications: $("qualifications").value.trim(),
      documentId: pending.documentId,
      submissionId: pending.submissionId
    };

    if (
      !payload.rfpText ||
      payload.rfpText.length > MAX_TEXT
    ) {
      throw new Error(
        "Review between 1 and 100,000 characters before submitting."
      );
    }

    if (
      !payload.proposalName ||
      !payload.organizationName ||
      !$("review-confirmation").checked
    ) {
      throw new Error(
        "Complete all required fields and confirm your review."
      );
    }

    const fingerprint = await hash(JSON.stringify(payload));

    if (
      pending.fingerprint &&
      pending.fingerprint !== fingerprint
    ) {
      const saved = await supabase.from("rfp_submissions")
        .select("status,record_id")
        .eq("id", pending.submissionId)
        .eq("user_id", owner)
        .maybeSingle();
      canStartNew = !saved.error && saved.data?.status === "queued" && Boolean(saved.data.record_id);
      $("another").hidden = !canStartNew;
      throw new Error(
        canStartNew
          ? "This file belongs to an earlier queued proposal. Restore the original inputs to retry, or click Start a new proposal to use this file for a separate proposal."
          : "Restore the inputs from your previous submission before retrying. This document is already reserved; contact support if its status is uncertain."
      );
    }

    const path =
      owner + "/" + pending.documentId +
      "/source." + selected.extension;

    const existing = await supabase
      .from("rfp_uploads")
      .select("*")
      .eq("id", pending.documentId)
      .maybeSingle();

    if (existing.error) throw existing.error;

    if (!existing.data) {
      const inserted = await supabase.from("rfp_uploads").insert({
        id: pending.documentId,
        user_id: owner,
        file_name: selected.file.name,
        sha256: selected.fileHash,
        mime_type: selected.mime,
        size_bytes: selected.file.size,
        storage_path: path
      });

      if (inserted.error) throw inserted.error;
    } else if (
      existing.data.user_id !== owner ||
      existing.data.storage_path !== path ||
      existing.data.size_bytes !== selected.file.size ||
      existing.data.mime_type !== selected.mime ||
      existing.data.sha256 !== selected.fileHash
    ) {
      throw new Error(
        "This document does not match the previous upload. Select the original document."
      );
    }

    const uploaded = await supabase.storage
      .from("rfp-documents")
      .upload(path, selected.file, {
        contentType: selected.mime,
        upsert: false
      });

    // Existing sources are never overwritten.
    if (
      uploaded.error &&
      String(uploaded.error.statusCode) !== "409" &&
      uploaded.error.error !== "Duplicate" &&
      uploaded.error.message !== "The resource already exists"
    ) {
      throw uploaded.error;
    }

    await session();

    if (!pending || user?.id !== owner) {
      throw new Error(
        "Your account changed. Log in and select the document again."
      );
    }

    pending.fingerprint = fingerprint;
    savePending();

    const response = await fetch(
      "/.netlify/functions/submit-proposal",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + auth.access_token
        },
        body: JSON.stringify(payload)
      }
    );

    const result = await response.json().catch(() => {
      throw new Error(
        "The server response could not be read. Retry with the same inputs to check submission status."
      );
    });

    if (response.status === 401) {
      requireLogin();
      throw new Error(result.error);
    }

    if (!response.ok) {
      throw new Error(
        result.error || "The proposal could not be submitted."
      );
    }

    completed = true;
    canStartNew = true;

    notify(
      "✓ Solicitation queued. Your draft will be delivered to " +
      payload.submitterEmail +
      ". Processing time varies with solicitation scope."
    );

    $("submit").textContent = "✓ Queued in Engine";
    $("another").hidden = false;
    statusTracker.start(payload.submissionId, owner);
  } catch (error) {
    notify(
      error.message ||
        "Upload failed. Check your connection and retry with the same document and inputs.",
      true
    );
  } finally {
    busy = false;
    $("upload-fields").disabled = completed;

    if (!completed) {
      $("submit").textContent = "Upload and submit RFP";
    }
  }
});

supabase.auth.onAuthStateChange(event => {
  if (event === "SIGNED_OUT") {
    setTimeout(requireLogin, 0);
  }
});

try {
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    requireLogin();
  } else {
    user = data.user;

    $("signed-in-email").textContent =
      "Signed in as: " + user.email +
      " (draft delivery and billing)";

    $("upload-form").hidden = false;
    notify("Choose an RFP document to begin.");
    statusTracker.resume(user.id);
  }
} catch {
  notify(
    "Account verification failed. Check your connection and reload.",
    true
  );
}
