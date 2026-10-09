import { createClient } from
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/+esm";

import {
  extractText,
  validateFile,
  MAX_TEXT
} from "./rfp-document.mjs";

const supabase = createClient(
  "https://vfdwaqgfepvoujprtuww.supabase.co",
  "sb_publishable_7J1W7gPugOUuVnCWKpS24A_ozYw0KM3"
);

const $ = id => document.getElementById(id);

let user;
let selected;
let pending;
let busy = false;
let generation = 0;
let completed = false;

function notify(message, error = false) {
  $("message").textContent = message;
  $("message").className =
    "alert-banner " + (error ? "alert-error" : "alert-success");
}

function requireLogin() {
  user = null;
  selected = null;
  pending = null;
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

    const key = "tendercrest-rfp:" + user.id + ":" + fileHash;
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
      throw new Error(
        "Restore the inputs from your previous submission before retrying. This document is already reserved for that submission."
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

    notify(
      "✓ Solicitation queued. Your draft will be delivered to " +
      payload.submitterEmail +
      ". Processing time varies with solicitation scope."
    );

    $("submit").textContent = "✓ Queued in Engine";
    $("another").hidden = false;
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
  }
} catch {
  notify(
    "Account verification failed. Check your connection and reload.",
    true
  );
}
