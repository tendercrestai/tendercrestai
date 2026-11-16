'use strict';
// F12: the stale-evidence check fetched the first 1,000 knowledge documents
// and marked evidence against that list, so a cited document past the cutoff
// was wrongly treated as unavailable (evidence dropped, spurious warnings,
// final approval cleared). The fetch now asks PostgREST for exactly the
// cited document IDs, in batches of 200.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../netlify/functions/lib/proposal-service');
const C = S.core;

const PROJECT_ID = '99000000-0000-4000-8000-000000000001';
const ORG_ID = '99000000-0000-4000-8000-000000000002';

function makeDocs(count, overrides = {}) {
  return Array.from({ length: count }, (_, i) => {
    const id = 'doc-' + String(i + 1).padStart(4, '0');
    return { id, status: 'Ready', metadata: { status: 'approved' }, ...(overrides[id] || {}) };
  });
}

function stateWithEvidence(citations, attachments = []) {
  const state = C.initial('Fictional project', 'Fictional Co');
  state.evidence = [{ answerId: 'e1', requirementId: 'req-1', text: 'Fictional answer.', citations, facts: [], decision: 'accepted' }];
  state.attachments = attachments;
  state.finalApproval = { contentHash: 'fictional' };
  return state;
}

function installStubs(docs, calls) {
  const originalRpc = S.kb.rpc;
  const originalDatabase = S.kb.database;
  let row;
  S.kb.rpc = async (config, name) => {
    assert.equal(name, 'pw_require');
    return [row];
  };
  // Emulate PostgREST: a limit=1000 query returns only the first 1,000 rows,
  // an id=in.(...) query returns exactly the matching rows.
  S.kb.database = async (config, path) => {
    calls.push(path);
    assert.ok(path.startsWith('kb_documents?org_id=eq.' + ORG_ID));
    if (path.includes('limit=1000')) return docs.slice(0, 1000);
    const match = path.match(/id=in\.\(([^)]*)\)/);
    assert.ok(match, 'expected an id=in.(...) filter, got ' + path);
    const wanted = new Set(match[1].split(',').map(decodeURIComponent));
    return docs.filter((d) => wanted.has(d.id));
  };
  return {
    withRow(state) {
      row = { id: PROJECT_ID, org_id: ORG_ID, revision: 1, evidence_epoch: 0, created_by: 'user-1', state };
    },
    restore() {
      S.kb.rpc = originalRpc;
      S.kb.database = originalDatabase;
    },
  };
}

test('project loads cited documents past the first 1,000 instead of the old limit', async () => {
  const originalEnv = process.env.PROPOSAL_INTELLIGENCE_ENABLED;
  process.env.PROPOSAL_INTELLIGENCE_ENABLED = 'true';
  const docs = makeDocs(1050);
  const calls = [];
  const stubs = installStubs(docs, calls);
  try {
    const state = stateWithEvidence([{ id: 'c1', documentId: 'doc-1001', quote: 'Fictional quote.' }], [{ documentId: 'doc-1001' }]);
    stubs.withRow(state);
    const p = await S.project({}, { id: 'user-1' }, PROJECT_ID);
    assert.equal(calls.length, 1);
    assert.ok(!calls[0].includes('limit=1000'), 'must not use the old limit=1000 fetch');
    assert.ok(calls[0].includes('id=in.(doc-1001)'), 'must fetch the cited document by id');
    assert.equal(p.state.evidence[0].metadataUnavailable, undefined);
    assert.deepEqual(p.state.evidence[0].citations[0].metadata, { status: 'approved' });
    assert.deepEqual(p.state.sourceWarnings, []);
    assert.ok(p.state.finalApproval, 'a current approved attachment must not clear final approval');
  } finally {
    stubs.restore();
    if (originalEnv === undefined) delete process.env.PROPOSAL_INTELLIGENCE_ENABLED;
    else process.env.PROPOSAL_INTELLIGENCE_ENABLED = originalEnv;
  }
});

test('project still flags a cited document that is not Ready', async () => {
  const originalEnv = process.env.PROPOSAL_INTELLIGENCE_ENABLED;
  process.env.PROPOSAL_INTELLIGENCE_ENABLED = 'true';
  const docs = makeDocs(1050, { 'doc-1001': { status: 'Draft', metadata: {} } });
  const calls = [];
  const stubs = installStubs(docs, calls);
  try {
    const state = stateWithEvidence([{ id: 'c1', documentId: 'doc-1001', quote: 'Fictional quote.' }]);
    stubs.withRow(state);
    const p = await S.project({}, { id: 'user-1' }, PROJECT_ID);
    assert.equal(p.state.evidence[0].metadataUnavailable, true);
  } finally {
    stubs.restore();
    if (originalEnv === undefined) delete process.env.PROPOSAL_INTELLIGENCE_ENABLED;
    else process.env.PROPOSAL_INTELLIGENCE_ENABLED = originalEnv;
  }
});

test('project batches cited-document lookups in groups of 200', async () => {
  const originalEnv = process.env.PROPOSAL_INTELLIGENCE_ENABLED;
  process.env.PROPOSAL_INTELLIGENCE_ENABLED = 'true';
  const docs = makeDocs(1050);
  const calls = [];
  const stubs = installStubs(docs, calls);
  try {
    const citations = Array.from({ length: 450 }, (_, i) => ({ id: 'c' + i, documentId: 'doc-' + String(i + 1).padStart(4, '0'), quote: 'Fictional quote.' }));
    const state = stateWithEvidence(citations);
    stubs.withRow(state);
    const p = await S.project({}, { id: 'user-1' }, PROJECT_ID);
    assert.equal(calls.length, 3);
    for (const path of calls) assert.ok(path.includes('id=in.('));
    assert.equal(p.state.evidence[0].citations.filter((c) => c.metadata).length, 450);
    assert.equal(p.state.evidence[0].metadataUnavailable, undefined);
  } finally {
    stubs.restore();
    if (originalEnv === undefined) delete process.env.PROPOSAL_INTELLIGENCE_ENABLED;
    else process.env.PROPOSAL_INTELLIGENCE_ENABLED = originalEnv;
  }
});

test('project skips the document fetch when no document is cited', async () => {
  const originalEnv = process.env.PROPOSAL_INTELLIGENCE_ENABLED;
  process.env.PROPOSAL_INTELLIGENCE_ENABLED = 'true';
  const docs = makeDocs(10);
  const calls = [];
  const stubs = installStubs(docs, calls);
  try {
    const state = stateWithEvidence([]);
    stubs.withRow(state);
    const p = await S.project({}, { id: 'user-1' }, PROJECT_ID);
    assert.equal(calls.length, 0);
    assert.equal(p.state.evidence[0].metadataUnavailable, undefined);
  } finally {
    stubs.restore();
    if (originalEnv === undefined) delete process.env.PROPOSAL_INTELLIGENCE_ENABLED;
    else process.env.PROPOSAL_INTELLIGENCE_ENABLED = originalEnv;
  }
});
