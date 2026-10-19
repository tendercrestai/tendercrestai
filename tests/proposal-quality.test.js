const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { buildPacket, loadHandoff } = require('../netlify/functions/lib/proposal-compliance');
const { context } = require('../netlify/functions/lib/proposal-evidence');
const quality = require('../engine/evaluate-quality.cjs');
const source = { document_id:'document',segment_id:'s1',page:2,section:'Section L',quote:'Supply proof of insurance.' };
const analysis = { id:'11111111-1111-4111-8111-111111111111',user_id:'owner',status:'Partial',fingerprint:'a'.repeat(64),warnings:['Appendix unreadable'],
  documents:[{id:'document',segments:[{id:'s1',text:source.quote,page:2,section:'Section L'}]}] };
const row = { id:'row-1',analysis_id:analysis.id,user_id:'owner',revision:1,original_requirement:source.quote,requirement:source.quote,
  category:'Legal',mandatory:'Yes',evaluation_weight:null,sources:[source],status:'Needs Review',evidence:'',evidence_reference:'',response_owner:'',comments:'' };
const originalFetch = global.fetch, env = {...process.env};
afterEach(() => {global.fetch=originalFetch;process.env={...env};});
test('handoff retains original sources, edits and gaps without claiming verified compliance', () => {
  const output=buildPacket(analysis,[{...row,requirement:'Provide current insurance proof',status:'Compliant',evidence:'Reviewer assertion',evidence_reference:'Manual note'}],'owner');
  assert.equal(output.packet.analysisStatus,'Partial');assert.deepEqual(output.packet.warnings,['Appendix unreadable']);
  assert.equal(output.packet.requirements[0].originalRequirement,source.quote);
  assert.equal(output.packet.requirements[0].reviewStatus,'Compliant');
  assert.match(output.packet.rules,/opinions, not verified/);assert.equal(output.sourceText,source.quote);
  assert.equal(JSON.parse(context('Facts',[],output.packet)).compliance.analysisId,analysis.id);
});
test('review digest is deterministic and changes when evidence or status changes', () => {
  const digest=buildPacket(analysis,[row],'owner').reviewHash;
  assert.equal(digest,buildPacket(analysis,[row],'owner').reviewHash);
  for(const change of [{comments:'changed'},{revision:2},{evidence:'New proof'},{status:'Partial'}])
    assert.notEqual(digest,buildPacket(analysis,[{...row,...change}],'owner').reviewHash);
});
test('foreign ownership, unfinished analyses, invented quotes and oversized context fail closed', () => {
  for (const [a,rows] of [[{...analysis,user_id:'other'},[row]],[analysis,[{...row,user_id:'other'}]],
    [{...analysis,status:'Processing'},[row]],[analysis,[{...row,sources:[{...source,quote:'Invented proof'}]}]],
    [analysis,[{...row,sources:[{...source,page:5}]}]],[analysis,[]],
    [analysis,Array.from({length:101},(_,i)=>({...row,id:String(i)}))],
    [analysis,[{...row,comments:'x'.repeat(45000)}]]]) assert.throws(()=>buildPacket(a,rows,'owner'));
});
test('server reads use customer JWT, explicit ownership predicates and no service key', async () => {
  process.env.PROPOSAL_QUALITY_ENABLED=process.env.COMPLIANCE_PREVIEW_ENABLED=process.env.EVIDENCE_ENGINE_ENABLED='true';
  let calls=0;
  global.fetch=async(url,options)=>{calls++;assert.equal(options.headers.Authorization,'Bearer customer');
    assert.equal(options.headers.apikey,'public');assert.match(url,/user_id=eq.owner/);
    return new Response(JSON.stringify(url.includes('rfp_compliance_analyses')?[analysis]:[row]));};
  const value=await loadHandoff({url:'https://example.invalid',key:'public',serviceKey:'secret'},'customer',{id:'owner'},analysis.id);
  assert.equal(calls,2);assert.equal(value.packet.requirements.length,1);
});
test('disabled handoff makes no data calls', async () => {
  delete process.env.PROPOSAL_QUALITY_ENABLED;global.fetch=()=>{throw Error('Must not fetch');};
  await assert.rejects(loadHandoff({},'customer',{id:'owner'},analysis.id),/not enabled/);
});
test('twenty holdout cases stay separate from four prompt examples', () => {
  const cases=require('../engine/quality-benchmark.json').cases, examples=require('../engine/quality-examples.json').examples;
  assert.equal(cases.length,20);assert.equal(new Set(cases.map(c=>c.id)).size,20);
  assert.ok(cases.every(c=>!examples.some(e=>e.id===c.id)));
  const proposed=JSON.stringify(require('../engine/proposed-automation.json'));
  assert.ok(cases.every(c=>!proposed.includes(c.id)));
});
test('empty or unreviewed evaluation outputs cannot establish an improvement', () => {
  const template=quality.template();assert.equal(quality.evaluate(template).readyForComparison,false);
  assert.throws(()=>quality.compare(template,template),/completed expert reviews/);
  const bad=structuredClone(template);bad.outputs.push(bad.outputs[0]);assert.throws(()=>quality.evaluate(bad),/duplicate/);
  assert.throws(()=>quality.evaluate({...template,datasetVersion:'other'}),/version mismatch/);
});
function reviewedRun() {
  const run=quality.template();
  for(const out of run.outputs){out.response='Proposed approach. HUMAN REVIEW REPORT: needs review.';
    out.humanReview={reviewer:'Fictional test reviewer',claimInventoryComplete:true,citationsSupportClaims:true,criticalErrors:0,
      reviewChecks:out.humanReview.reviewChecks.map(()=>true),scores:Object.fromEntries(quality.dimensions.map(d=>[d,3])),editingMinutes:10};}
  return run;
}
test('valid paired reviews report descriptive score and editing-time differences', () => {
  const baseline=reviewedRun(),candidate=reviewedRun();
  for(const out of candidate.outputs){out.humanReview.scores.specificity=4;out.humanReview.editingMinutes=7;}
  const comparison=quality.compare(candidate,baseline);assert.equal(comparison.scoreDelta.specificity,1);assert.equal(comparison.editingMinutesSaved,3);
});
test('fabricated citations, lessons as bidder facts and duplicated coverage invalidate runs', () => {
  for(const citation of ['INVENTED','REFERENCE','RFP']){
    const run=reviewedRun(),out=run.outputs[0];out.claims=[{text:'Proposed approach.',citation,quote:'invented'}];
    assert.equal(quality.evaluate(run).readyForComparison,false);
  }
  const run=reviewedRun();run.outputs[0].coverage.push(run.outputs[0].coverage[0]);
  assert.equal(quality.evaluate(run).readyForComparison,false);
  run.outputs[0].claims=[{text:'An omitted assertion',citation:'QUALIFICATIONS',quote:'Completed'}];
  assert.equal(quality.evaluate(run).readyForComparison,false);
});

test('malformed evaluation records fail with clear validation errors',()=>{
  for(const value of [null,42,[],false])assert.throws(()=>quality.evaluate({...quality.template(),outputs:[value]}),/object with a case ID/);
  for(const [field,value,message] of [['response',{},/Response must be text/],['claims',[null],/Invalid claim/],['coverage',[null],/Invalid coverage/]]){
    const run=reviewedRun();run.outputs[0][field]=value;assert.throws(()=>quality.evaluate(run),message);
  }
  const run=reviewedRun();run.outputs[0].humanReview.reviewChecks='invalid';
  assert.equal(quality.evaluate(run).readyForComparison,false);
});
