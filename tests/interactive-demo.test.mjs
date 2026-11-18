import {test} from 'node:test';import assert from 'node:assert/strict';import {scenarios,proposalFor,bidBreakdown,sampleSolicitationText} from '../assets/demo-data.mjs';

test('fictional sample text reuses the demo scenario without new claims',()=>{
 const text=sampleSolicitationText(scenarios[0]);
 assert.match(text,/Fictional/);
 assert.ok(text.includes(scenarios[0].requirements[0].text));
 assert.ok(text.includes(scenarios[0].requirements[1].text));
 assert.ok(text.length>=40);
});

test('fictional sample works for every scenario',()=>{
 for(const scenario of scenarios){
  const text=sampleSolicitationText(scenario);
  assert.ok(text.includes(scenario.buyer));
  assert.ok(text.includes(scenario.title));
 }
});
test('three fictional scenarios include evidence gaps, source references and six proposal sections',()=>{assert.equal(scenarios.length,3);for(const s of scenarios){assert.match(s.company,/Fictional/);assert.match(s.buyer,/Fictional/);assert.equal(proposalFor(s).length,6);assert.ok(s.requirements.some(r=>r.status==='Missing'));assert.ok(s.requirements.every(r=>r.source&&r.action&&r.evidence));assert.equal(Math.floor(bidBreakdown(s).reduce((n,f)=>n+f.score*f.weight,0)/100),s.score);}});
