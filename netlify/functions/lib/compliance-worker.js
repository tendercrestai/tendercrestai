// Server-side continuation of paid RFP analysis (F9).
// The browser drives analysis one chunk per `step` call while its tab is open;
// this worker continues Pending analyses (and lease-expired Processing ones)
// so closing the tab no longer stalls a large RFP. Sequential chunks only:
// one chunk at a time, at most 3 chunks per invocation, then it re-dispatches
// itself while work remains. The existing caps still bound the spend: the
// claim RPC enforces the 3-attempts-per-chunk budget and the daily AI budgets
// (500 global / 144 per user), and a chunk that fails AI/source validation is
// marked Failed for the user to retry explicitly, never auto-retried here.
// The worker only continues an analysis the user already reviewed: the first
// browser `step` records reviewed_hash, and an unreviewed analysis is left
// alone. The sweep only dispatches analyses idle for 5 minutes, so the worker
// does not race a tab that is actively stepping; the claim lease serializes
// any overlap that still occurs.
const { randomUUID } = require('node:crypto');
const kb = require('./knowledge-base');
const ai = require('./compliance-ai');
const { isTransientProviderError } = require('./free-tools');

const CHUNKS_PER_INVOCATION = 3;
const RETRY_DELAYS_MS = [250, 500];
const IDLE_MS = 5 * 60 * 1000;
const SWEEP_LIMIT = 10;
// Must match the message thrown by invalid() in compliance-ai.js.
const VALIDATION_MESSAGE = 'AI output failed source validation. Retry this chunk or review the source manually.';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function dispatch(id) {
  try {
    const { url, secret } = kb.workerSettings();
    const target = new URL('/.netlify/functions/compliance-worker-background', url);
    const r = await fetch(target, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-kb-worker-secret': secret }, body: JSON.stringify({ id }), signal: AbortSignal.timeout(5000) });
    return r.status === 202;
  } catch { return false; }
}

// Analyses the 15-minute sweep may hand to the worker: reviewed, inside the
// per-chunk attempt budget, idle for 5 minutes, and either Pending or
// Processing with an expired lease. Failed analyses are left for the user's
// explicit "Retry failed chunk" step.
function stalledQuery(now) {
  const idleBefore = new Date(now.getTime() - IDLE_MS).toISOString();
  const lease = encodeURIComponent(now.toISOString());
  return 'rfp_compliance_analyses?select=id,user_id,status,updated_at&attempts=lt.3&reviewed_hash=is.not.null&updated_at=lt.' + encodeURIComponent(idleBefore) + '&or=(status.eq.Pending,and(status.eq.Processing,lease_until.lt.' + lease + '))&order=updated_at.asc&limit=' + SWEEP_LIMIT;
}

async function analyzeWithRetries(analyze, chunk, documents) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await analyze(chunk, documents); }
    catch (error) {
      const validation = error && error.message === VALIDATION_MESSAGE;
      const retryable = validation ? attempt === 0 : isTransientProviderError(error, null);
      if (attempt === 2 || !retryable) throw error;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

async function processAnalysis(config, id, adapters = {}) {
  if (!process.env.COMPLIANCE_AI_API_KEY || !process.env.COMPLIANCE_AI_MODEL) kb.fail(503, 'Compliance AI configuration is unavailable.');
  const analyze = adapters.analyzeChunk || ai.analyzeChunk;
  const redispatch = adapters.dispatch || dispatch;
  let advanced = 0, done = false;
  for (let n = 0; n < CHUNKS_PER_INVOCATION; n++) {
    const rows = await kb.database(config, 'rfp_compliance_analyses?id=eq.' + kb.uuid(id) + '&select=id,user_id,fingerprint,reviewed_hash,status,attempts,lease_until', { service: true });
    const a = rows && rows[0];
    if (!a) return { id, done: false, advanced, stopped: 'not-found' };
    if (a.status === 'Completed' || a.status === 'Partial') { done = true; break; }
    if (a.status === 'Failed') break;
    if (!a.reviewed_hash) { console.error(JSON.stringify({ event: 'compliance_worker_unreviewed', analysisId: id })); break; }
    if (a.attempts >= 3) { console.error(JSON.stringify({ event: 'compliance_worker_attempts_exhausted', analysisId: id })); break; }
    const lease = randomUUID();
    let claimed;
    try {
      claimed = await kb.rpc(config, 'rfp_compliance_claim', { p_id: a.id, p_user: a.user_id, p_hash: a.fingerprint, p_lease: lease });
    } catch (e) {
      // 409: the browser (or another worker) holds the lease; leave it alone.
      // 429: chunk retry budget or daily AI budget reached; the sweep retries later.
      if (e.status !== 409) console.error(JSON.stringify({ event: 'compliance_worker_claim_failed', analysisId: id, status: e.status || null }));
      break;
    }
    if (claimed.done) { done = true; break; }
    let output;
    try {
      output = await analyzeWithRetries(analyze, claimed.chunk, claimed.documents);
    } catch (e) {
      await kb.rpc(config, 'rfp_compliance_finish', { p_id: a.id, p_user: a.user_id, p_lease: lease, p_requirements: [], p_facts: [], p_error: 'chunk_failed' });
      console.error(JSON.stringify({ event: 'compliance_worker_chunk_failed', analysisId: id }));
      break;
    }
    const saved = await kb.rpc(config, 'rfp_compliance_finish', { p_id: a.id, p_user: a.user_id, p_lease: lease, p_requirements: output.requirements, p_facts: output.facts, p_error: null });
    if (!saved) break;
    advanced++;
  }
  if (!done && advanced === CHUNKS_PER_INVOCATION) {
    // A full batch with no stop condition: confirm work remains before chaining,
    // since the last chunk may have completed the analysis.
    const rows = await kb.database(config, 'rfp_compliance_analyses?id=eq.' + kb.uuid(id) + '&select=status', { service: true });
    const current = rows && rows[0];
    if (current && (current.status === 'Completed' || current.status === 'Partial')) done = true;
    else if (current && (current.status === 'Pending' || current.status === 'Processing')) await redispatch(id);
  }
  return { id, done, advanced };
}

module.exports = { dispatch, stalledQuery, processAnalysis, CHUNKS_PER_INVOCATION, IDLE_MS, SWEEP_LIMIT };
