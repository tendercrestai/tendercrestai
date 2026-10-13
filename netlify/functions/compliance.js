const { createHash, randomUUID } = require("node:crypto");
const security = require("./lib/rfp-security");
const { extractDocument, chunkDocuments } = require("./lib/compliance-document");
const { analyzeChunk, similarPairs, CATEGORIES } = require("./lib/compliance-ai");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (statusCode, body) => ({ statusCode, headers: {
  "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"
}, body: JSON.stringify(body) });
const fail = (status, message) => { throw new security.RequestError(status, message); };

async function db(config, token, path, options = {}, service = false) {
  const response = await fetch(config.url + "/rest/v1/" + path, {
    ...options, headers: { apikey: service ? config.serviceKey : config.key,
      Authorization: "Bearer " + (service ? config.serviceKey : token),
      "Content-Type": "application/json", ...options.headers },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (body.code === "P0002") fail(404, "Analysis not found.");
    if (body.code === "55P03") fail(409, "A chunk is already processing. Wait before checking again.");
    if (body.code === "P0001" || body.code === "23514") fail(429, "Analysis or AI retry budget reached. Contact support or try a new analysis tomorrow.");
    if (body.code === "22023") fail(400, "Invalid analysis request or changed source review.");
    fail(503, "Compliance data is temporarily unavailable.");
  }
  return response.status === 204 ? null : response.json();
}
const rpc = (config, token, name, args) => db(config, token, "rpc/" + name, { method: "POST", body: JSON.stringify(args) }, true);
async function getAnalysis(config, token, user, id) {
  if (!UUID.test(id || "")) fail(400, "Invalid analysis ID.");
  const rows = await db(config, token, "rfp_compliance_analyses?id=eq." + id + "&select=*");
  if (!rows[0] || rows[0].user_id !== user.id) fail(404, "Analysis not found.");
  return rows[0];
}
async function workspace(config, token, user, id) {
  const a = await getAnalysis(config, token, user, id);
  const requirements = [];
  for (let offset = 0; offset < 2000; offset += 500) {
    const rows = await db(config, token, "rfp_compliance_requirements?analysis_id=eq." + id +
      "&select=*&order=id&limit=500&offset=" + offset);
    if (rows.some(r => r.user_id !== user.id)) fail(404, "Analysis not found.");
    requirements.push(...rows);
    if (rows.length < 500) break;
  }
  return { analysis: { id: a.id, fingerprint: a.fingerprint, status: a.status,
    documents: a.documents, facts: a.facts, warnings: a.warnings,
    processed: a.cursor, total_chunks: a.chunks.length, attempts: a.attempts,
    error_code: a.error_code, processing_until: a.lease_until, created_at: a.created_at },
    requirements, similar_pairs: similarPairs(requirements) };
}
function validateReview(changes) {
  const fields = { requirement: 3000, evidence: 10000, evidence_reference: 1000, response_owner: 200, comments: 5000 };
  const allowed = [...Object.keys(fields), "category", "mandatory", "status"];
  if (!changes || typeof changes !== "object" || Array.isArray(changes) ||
      Object.keys(changes).length !== allowed.length || allowed.some(k => !Object.hasOwn(changes, k))) fail(400, "Invalid review fields.");
  for (const [key, max] of Object.entries(fields)) if (typeof changes[key] !== "string" || changes[key].length > max) fail(400, "Review field exceeds the supported length.");
  if (!changes.requirement.trim() || !CATEGORIES.includes(changes.category) ||
      !["Yes","No","Unclear"].includes(changes.mandatory) ||
      !["Compliant","Partial","Non-Compliant","Needs Review"].includes(changes.status)) fail(400, "Invalid requirement review.");
  if (changes.status === "Compliant" && (!changes.evidence.trim() || !changes.evidence_reference.trim()))
    fail(400, "Provide company evidence and a verifiable evidence reference before marking Compliant.");
  return changes;
}

// Injectable parsers/AI are used only by offline tests, never from request data.
function createHandler(adapters = {}) {
  return async event => {
    if (event.httpMethod !== "POST") {
      const response = reply(405, { error: "Method Not Allowed" }); response.headers.Allow = "POST"; return response;
    }
    if (event.isBase64Encoded || typeof event.body !== "string" || Buffer.byteLength(event.body) > 24000)
      return reply(413, { error: "Request exceeds the supported size." });
    try {
      if (process.env.COMPLIANCE_PREVIEW_ENABLED !== "true") fail(503, "Compliance preview is not enabled.");
      let payload;
      try { payload = JSON.parse(event.body); } catch { fail(400, "Invalid JSON."); }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail(400, "Invalid request.");
      const config = security.configuration(), { user, token } = await security.authenticate(event, config);
      if (payload.action === "list") {
        const rows = await db(config, token, "rfp_compliance_analyses?select=id,status,created_at&order=created_at.desc&limit=30");
        return reply(200, { analyses: rows });
      }
      if (payload.action === "prepare") {
        const ids = payload.documentIds;
        if (!Array.isArray(ids) || ids.length < 1 || ids.length > 6 ||
            ids.some(id => typeof id !== "string" || !UUID.test(id)) || new Set(ids).size !== ids.length)
          fail(400, "Choose one to six distinct uploaded RFP documents.");
        const documents = [];
        for (const id of ids) {
          const source = await security.verifyDocument(config, token, user, id, true);
          documents.push(await (adapters.extractDocument || extractDocument)(source));
        }
        const chunks = chunkDocuments(documents);
        const hash = createHash("sha256").update(JSON.stringify(["compliance-v1",
          documents.map(d => [d.id,d.sha256,d.segments])])).digest("hex");
        const warnings = documents.flatMap(d => d.warnings.map(w => d.name + ": " + w));
        const id = await rpc(config, token, "rfp_compliance_start", {
          p_user: user.id, p_fingerprint: hash, p_documents: documents, p_chunks: chunks, p_warnings: warnings
        });
        return reply(200, await workspace(config, token, user, id));
      }
      const a = await getAnalysis(config, token, user, payload.analysisId);
      if (payload.action === "get") return reply(200, await workspace(config, token, user, a.id));
      if (payload.action === "update") {
        if (!UUID.test(payload.requirementId || "") || !Number.isSafeInteger(payload.revision) || payload.revision < 0) fail(400, "Invalid review version.");
        const changes = validateReview(payload.changes);
        const rows = await db(config, token, "rfp_compliance_requirements?id=eq." + payload.requirementId +
          "&analysis_id=eq." + a.id + "&revision=eq." + payload.revision, {
          method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(changes)
        });
        if (!rows.length) fail(409, "This row changed in another session. Reload before saving.");
        return reply(200, { requirement: rows[0] });
      }
      if (payload.action !== "step") fail(400, "Unknown compliance action.");
      if (payload.reviewed !== true || payload.reviewHash !== a.fingerprint) fail(400, "Review the extracted source text and confirm before analyzing.");
      if (!process.env.COMPLIANCE_AI_API_KEY || !process.env.COMPLIANCE_AI_MODEL) fail(503, "Compliance AI configuration is unavailable.");
      const lease = randomUUID();
      const claimed = await rpc(config, token, "rfp_compliance_claim", {
        p_id: a.id, p_user: user.id, p_hash: payload.reviewHash, p_lease: lease
      });
      if (!claimed.done) {
        let output;
        try { output = await (adapters.analyzeChunk || analyzeChunk)(claimed.chunk, claimed.documents); }
        catch {
          await rpc(config, token, "rfp_compliance_finish", { p_id: a.id, p_user: user.id, p_lease: lease,
            p_requirements: [], p_facts: [], p_error: "chunk_failed" });
          return reply(502, { error: "This chunk failed AI/source validation. Saved results remain available. Retry is limited to three attempts per chunk." });
        }
        const saved = await rpc(config, token, "rfp_compliance_finish", {
          p_id: a.id, p_user: user.id, p_lease: lease,
          p_requirements: output.requirements, p_facts: output.facts, p_error: null
        });
        if (!saved) fail(409, "Processing lease changed. Reload the saved analysis.");
      }
      return reply(200, await workspace(config, token, user, a.id));
    } catch (error) {
      return reply(error instanceof security.RequestError ? error.status : 503, {
        error: error instanceof security.RequestError ? error.message : "Compliance preview is temporarily unavailable."
      });
    }
  };
}
exports.handler = createHandler();
exports.createHandler = createHandler;
exports.validateReview = validateReview;
