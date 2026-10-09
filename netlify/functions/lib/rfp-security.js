const { createHash } = require("node:crypto");

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain"
};

const PUBLIC_KEY = "sb_publishable_7J1W7gPugOUuVnCWKpS24A_ozYw0KM3";
const URL = "https://vfdwaqgfepvoujprtuww.supabase.co";

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function configuration() {
  const url = (process.env.SUPABASE_URL || URL).replace(/\/$/, "");
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || PUBLIC_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceKey) {
    throw new RequestError(
      503,
      "Secure submission is temporarily unavailable."
    );
  }

  return { url, key, serviceKey };
}

async function request(
  config,
  path,
  token,
  options = {},
  service = false
) {
  return fetch(config.url + path, {
    ...options,
    headers: {
      apikey: service ? config.serviceKey : config.key,
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      ...options.headers
    },
    signal: AbortSignal.timeout(10000)
  });
}

async function authenticate(event, config) {
  const authorization =
    event.headers?.authorization ||
    event.headers?.Authorization ||
    "";

  if (!/^Bearer [^\s]+$/.test(authorization)) {
    throw new RequestError(
      401,
      "Please log in before submitting a proposal."
    );
  }

  const token = authorization.slice(7);
  const response = await request(config, "/auth/v1/user", token);

  if (response.status === 401 || response.status === 403) {
    throw new RequestError(
      401,
      "Your session has expired. Please log in again."
    );
  }

  if (!response.ok) {
    throw new RequestError(
      503,
      "Account verification is temporarily unavailable."
    );
  }

  const user = await response.json();

  if (!UUID.test(user.id) || !user.email || !user.email_confirmed_at) {
    throw new RequestError(
      401,
      "Please sign in with a verified email address."
    );
  }

  return { user, token };
}

async function verifyDocument(config, token, user, id) {
  if (!UUID.test(id)) {
    throw new RequestError(400, "Invalid document ID.");
  }

  const metadata = await request(
    config,
    "/rest/v1/rfp_uploads?id=eq." + id + "&select=*",
    token
  );

  if (!metadata.ok) {
    throw new RequestError(
      503,
      "Document verification is temporarily unavailable."
    );
  }

  const rows = await metadata.json();
  const doc = rows[0];

  if (!doc || doc.user_id !== user.id) {
    throw new RequestError(404, "Document not found.");
  }

  const extension = doc.storage_path.split(".").pop();

  if (
    !MIME[extension] ||
    doc.storage_path !== user.id + "/" + id + "/source." + extension ||
    doc.mime_type !== MIME[extension] ||
    doc.size_bytes < 1 ||
    doc.size_bytes > 10485760
  ) {
    throw new RequestError(400, "Invalid document metadata.");
  }

  // Customer JWT preserves Storage RLS inside the function.
  const object = await request(
    config,
    "/storage/v1/object/authenticated/rfp-documents/" + doc.storage_path,
    token
  );

  if (object.status === 404 || object.status === 400) {
    throw new RequestError(
      400,
      "Upload the document before submitting."
    );
  }

  if (!object.ok) {
    throw new RequestError(
      503,
      "Document verification is temporarily unavailable."
    );
  }

  const bytes = Buffer.from(await object.arrayBuffer());
  const mime = (object.headers.get("content-type") || "").split(";")[0];

  if (
    bytes.length !== doc.size_bytes ||
    mime !== doc.mime_type ||
    createHash("sha256").update(bytes).digest("hex") !== doc.sha256
  ) {
    throw new RequestError(
      400,
      "Uploaded document does not match its metadata."
    );
  }

  if (
    extension === "pdf" &&
    bytes.subarray(0, 5).toString() !== "%PDF-"
  ) {
    throw new RequestError(400, "Invalid PDF document.");
  }

  if (
    extension === "docx" &&
    (
      bytes.length < 4 ||
      bytes.readUInt32LE(0) !== 0x04034b50 ||
      !bytes.includes(Buffer.from("word/document.xml"))
    )
  ) {
    throw new RequestError(400, "Invalid DOCX document.");
  }

  if (extension === "txt") {
    let text;

    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new RequestError(400, "TXT documents must be UTF-8.");
    }

    if (/[\x00-\x08\x0e-\x1f]/.test(text)) {
      throw new RequestError(
        400,
        "TXT documents must contain readable text."
      );
    }
  }
}

async function claim(config, user, payload) {
  if (!UUID.test(payload.submissionId || "")) {
    throw new RequestError(
      400,
      "A valid submission ID is required."
    );
  }

  const fingerprint = createHash("sha256")
    .update(JSON.stringify([
      payload.proposalName,
      payload.submitterEmail,
      payload.organizationName,
      payload.proposalSector,
      payload.rfpText,
      payload.qualifications || "",
      payload.documentId || null
    ]))
    .digest("hex");

  const row = {
    id: payload.submissionId,
    user_id: user.id,
    document_id: payload.documentId || null,
    fingerprint,
    status: "processing"
  };

  const response = await request(
    config,
    "/rest/v1/rfp_submissions",
    config.serviceKey,
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(row)
    },
    true
  );

  if (response.ok) return { id: row.id };

  if (response.status !== 409) {
    throw new RequestError(
      503,
      "Submission reservation is temporarily unavailable."
    );
  }

  const query = payload.documentId
    ? "document_id=eq." + payload.documentId
    : "id=eq." + row.id;

  const existing = await request(
    config,
    "/rest/v1/rfp_submissions?user_id=eq." + user.id + "&" + query,
    config.serviceKey,
    {},
    true
  );

  if (!existing.ok) {
    throw new RequestError(
      503,
      "Submission status is temporarily unavailable."
    );
  }

  const saved = (await existing.json())[0];

  if (!saved || saved.fingerprint !== fingerprint) {
    throw new RequestError(
      409,
      "This submission ID or document has already been used. Restore the original inputs or start a new submission."
    );
  }

  if (saved.status === "queued") {
    return { id: saved.id, recordId: saved.record_id };
  }

  if (saved.status !== "retryable") {
    throw new RequestError(
      409,
      "This submission is processing or awaiting verification. Do not resubmit; contact support if it does not complete."
    );
  }

  const retry = await request(
    config,
    "/rest/v1/rfp_submissions?id=eq." + saved.id +
      "&status=eq.retryable",
    config.serviceKey,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ status: "processing" })
    },
    true
  );

  if (!retry.ok || !(await retry.json()).length) {
    throw new RequestError(
      409,
      "This submission is already processing."
    );
  }

  return { id: saved.id };
}

async function finish(config, id, status, recordId = null) {
  const response = await request(
    config,
    "/rest/v1/rfp_submissions?id=eq." + id,
    config.serviceKey,
    {
      method: "PATCH",
      body: JSON.stringify({
        status,
        record_id: recordId,
        updated_at: new Date().toISOString()
      })
    },
    true
  );

  if (!response.ok) {
    throw new RequestError(
      503,
      "Submission status could not be saved. Do not resubmit; contact support."
    );
  }
}

module.exports = {
  configuration,
  authenticate,
  verifyDocument,
  claim,
  finish,
  RequestError
};
