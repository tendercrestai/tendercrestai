const { test } = require('node:test');
const assert = require('node:assert/strict');
const { retrieve, loadEvidence, context } = require('../netlify/functions/lib/proposal-evidence');
const owner = '11111111-1111-4111-8111-111111111111';
const sector = 'Commercial / Enterprise RFP';
const row = (extra = {}) => ({ id: 'reference-1', user_id: owner, title: 'Cloud migration case study', kind: 'company_evidence',
  sector, content: 'Delivered cloud migration with documented acceptance tests.\nCustomer approved deployment report.',
  source_label: 'Project report, section 2', outcome: 'not_applicable', approved: true, rights_confirmed: true, ...extra });

test('excludes foreign, unapproved, unpermissioned, wrong-sector and unrelated evidence', () => {
  const rows = [row(), row({ user_id: 'other' }), row({ approved: false }), row({ rights_confirmed: false }),
    row({ sector: 'Public Sector / Gov (Section L&M)' }), row({ title: 'Catering', content: 'Prepared buffet menus.' })];
  const result = retrieve(rows, owner, sector, 'cloud migration acceptance');
  assert.ok(result.length); assert.ok(result.every(item => item.id === 'reference-1' && item.text.includes('cloud')));
});
test('preserves source roles, offsets and hashes with bounded diverse excerpts', () => {
  const rows = Array.from({ length: 30 }, (_, i) => row({ id: 'ref-' + i, content: 'Delivered cloud migration project number ' + i + '.', kind: i % 2 ? 'past_bid' : 'evaluator_feedback', outcome: 'won' }));
  const result = retrieve(rows, owner, sector, 'cloud migration');
  assert.equal(result.length, 8);
  assert.ok(result.reduce((n, item) => n + item.text.length, 0) <= 12000);
  const packet = JSON.parse(context('Current facts', result));
  assert.equal(packet.currentQualifications.citation, 'QUALIFICATIONS');
  assert.equal(packet.passages[0].outcome, 'won');
  assert.match(packet.passages[0].citation, /^EVIDENCE:ref-/);
  assert.equal(packet.passages[0].hash.length, 64);
  assert.match(packet.rules, /lessons only/);
});
test('oversized paragraphs are excluded rather than cut mid-claim', () => {
  assert.deepEqual(retrieve([row({ content: 'cloud ' + 'x'.repeat(3000) })], owner, sector, 'cloud'), []);
});
test('duplicate excerpts do not consume the retrieval budget repeatedly', () => {
  const result = retrieve([row(), row({ id: 'duplicate' })], owner, sector, 'cloud');
  assert.equal(result.length, 1);
});
test('citation offsets locate the exact retrieved text after indentation', () => {
  const source = row({ content: '  Cloud migration delivery.\nAnother topic.' });
  const result = retrieve([source], owner, sector, 'cloud')[0];
  assert.equal(source.content.slice(result.start, result.start + result.text.length), result.text);
});
test('uses customer JWT, never the service role, and fails closed on unavailable libraries', async () => {
  const original = global.fetch;
  try {
    global.fetch = async (url, options) => {
      assert.match(url, /user_id=eq/);
      assert.equal(options.headers.apikey, 'public');
      assert.equal(options.headers.Authorization, 'Bearer customer');
      return new Response(JSON.stringify([row(), row({ user_id: 'other' })]));
    };
    const config = { url: 'https://test.invalid', key: 'public', serviceKey: 'secret' };
    assert.ok((await loadEvidence(config, 'customer', { id: owner }, sector, 'cloud')).length);
    global.fetch = async () => new Response('{}', { status: 503 });
    await assert.rejects(loadEvidence(config, 'customer', { id: owner }, sector, 'cloud'), /could not be loaded/);
    global.fetch = async () => new Response('{}', { status: 401 });
    await assert.rejects(loadEvidence(config, 'customer', { id: owner }, sector, 'cloud'), /expired/);
    global.fetch = async () => new Response(JSON.stringify(Array.from({ length: 201 }, () => row())));
    await assert.rejects(loadEvidence(config, 'customer', { id: owner }, sector, 'cloud'), /200 approved/);
  } finally { global.fetch = original; }
});
