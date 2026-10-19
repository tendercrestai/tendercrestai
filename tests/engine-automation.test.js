const { test } = require('node:test');
const assert = require('node:assert/strict');
const { upgrade } = require('../engine/upgrade-automation.cjs');
const fixture = () => ({ name: 'Automation 1', description: 'Original', trigger: { type: 'recordCreated', inputs: { tableId: 'pipeline' } }, nodes: [
  { key: 'lookup', type: 'findRecords', inputs: { tableId: 'company' } },
  { key: 'publicExamples', type: 'findRecords', inputs: { tableId: 'examples' } },
  { key: 'quota', type: 'conditionalGroup', branches: [{ condition: { marker: 'keep-quota' }, nodes: [
    { key: 'wacdXcDkteb3p5YKr', type: 'aiGenerate', inputs: { prompt: { template: ['old matrix'] } } },
    { key: 'wacWrHdT7uTv8Tn6K', type: 'aiGenerate', inputs: { prompt: { template: ['old draft', { fn: 'first', args: ['approved example'] }] } } },
    { key: 'wac2SKzYZeUCOVTxt', type: 'updateRecord', inputs: { fields: { content: { template: [{ $ref: 'wacWrHdT7uTv8Tn6K', path: ['response'] }] } } } },
    { key: 'wacAiWZH8Xgd0sowA', type: 'gmailSendEmail', externalAccountId: 'existing', inputs: { to: ['original@example.invalid'], message: { template: [{ $ref: 'wacWrHdT7uTv8Tn6K', path: ['response'] }] } } }
  ] }, { condition: { marker: 'blocked' }, nodes: [{ key: 'quotaEmail', type: 'gmailSendEmail', inputs: { to: ['original@example.invalid'] } }] }] }
] });
test('preserves retrieval, quota gates, recipients and output fields while routing only revised draft', () => {
  const original = fixture(); const before = structuredClone(original);
  const result = upgrade(original);
  assert.deepEqual(original, before);
  assert.deepEqual(result.trigger, original.trigger);
  assert.deepEqual(result.nodes.slice(0, 2), original.nodes.slice(0, 2));
  const group = result.nodes[2]; const branch = group.branches[0];
  assert.deepEqual(group.branches[1], original.nodes[2].branches[1]);
  assert.deepEqual(branch.condition, original.nodes[2].branches[0].condition);
  const draft = branch.nodes[1]; const review = branch.nodes[2];
  assert.equal(review.key, 'evidenceReview');
  assert.ok(draft.inputs.prompt.template.some(item => item.$ref === branch.nodes[0].key));
  assert.equal(branch.nodes[3].inputs.fields.content.template[0].$ref, 'evidenceReview');
  assert.deepEqual(branch.nodes[4].inputs.to, ['original@example.invalid']);
  assert.equal(branch.nodes[4].externalAccountId, 'existing');
  assert.equal(branch.nodes[4].inputs.message.template[0].$ref, 'evidenceReview');
  const prompts = [branch.nodes[0], draft, review].map(node => JSON.stringify(node.inputs.prompt));
  for (const prompt of prompts) {
    assert.match(prompt, /NOT FOUND/); assert.match(prompt, /lessons only/);
    assert.match(prompt, /never invent/i); assert.match(prompt, /Human review is required/);
  }
  assert.throws(() => upgrade(result), /Already upgraded/);
  const normalized = structuredClone(result);
  normalized.nodes[2].branches[0].nodes[2].key = 'wacNormalizedByAirtable';
  assert.throws(() => upgrade(normalized), /Already upgraded/);
});
test('unexpected graphs fail without producing a partial replacement', () => {
  assert.throws(() => upgrade({ nodes: [] }), /not found/);
});

test('refreshing the current three-stage draft changes only prompts and description', () => {
  const {refresh}=require('../engine/refresh-quality-automation.cjs');
  const current=require('../engine/test-automation-before-quality.json');
  const updated=refresh(current);
  const strip=value=>{const clone=structuredClone(value);delete clone.description;
    const walk=nodes=>{for(const n of nodes){if(n.type==='aiGenerate')delete n.inputs.prompt;
      for(const b of n.branches || [])walk(b.nodes);}};walk(clone.nodes);return clone;};
  assert.deepEqual(strip(updated),strip(current));
  const prompts=JSON.stringify(updated);
  assert.match(prompts,/tendercrest-compliance-v1/);assert.match(prompts,/style-approach/);
  assert.deepEqual(refresh(updated),updated);
});
