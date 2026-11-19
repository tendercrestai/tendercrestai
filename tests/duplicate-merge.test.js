const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../netlify/functions/lib/proposal-core');
const U='11111111-1111-4111-8111-111111111111',R='22222222-2222-4222-8222-222222222222';
function fixture(){
  const s=C.initial('Fictional library response','Cedar Archive Services');
  const keeper={id:'req-keeper',stableId:'REQ-KEEPER',text:'Joint venture partners must submit a joint venture agreement.',mandatory:'Yes',category:'Eligibility',status:'Needs Review',support:'needs review',sources:[{quote:'Joint venture partners must submit a joint venture agreement.',page:3,section:'Section L',document_id:U,segment_id:'seg-1'}]};
  const dup={id:'req-dup',stableId:'REQ-DUP',text:'Joint venture partners must submit a joint venture agreement today.',mandatory:'Yes',category:'Eligibility',status:'Needs Review',support:'needs review',sources:[{quote:'Joint venture partners must submit a joint venture agreement today.',page:3,section:'Section L',document_id:U,segment_id:'seg-1'}]};
  s.requirements=[keeper,dup];
  s.sections=[
    {id:'sec-keeper',title:'1. Joint venture',requirementIds:['req-keeper'],text:'',revision:0,status:'draft',claims:[],unverified:true},
    {id:'sec-dup',title:'2. Joint venture',requirementIds:['req-dup'],text:'',revision:0,status:'draft',claims:[{text:'Fictional agreement.',answerId:U,answerRevision:2,requirementId:'req-dup',citations:[]}],unverified:true},
  ];
  s.evidence=[
    {id:'map-dup',answerId:U,revision:2,requirementId:'req-dup',text:'Fictional joint venture agreement.',decision:'accepted',stale:false,expired:false,conflicts:[],citations:[]},
    {id:'map-keeper',answerId:R,revision:1,requirementId:'req-keeper',text:'Fictional certification.',decision:'accepted',stale:false,expired:false,conflicts:[],citations:[]},
  ];
  return s;
}
test('reviewer merge links the duplicate, re-points evidence and sections, and drops it from readiness',()=>{
  const s=fixture();
  const n=C.apply(s,'mergeDuplicate',{keeperId:'req-keeper',duplicateId:'req-dup',reason:'Same joint-venture obligation, reworded.'},U,{reviewer:true});
  const dup=n.requirements.find(r=>r.id==='req-dup'),keeper=n.requirements.find(r=>r.id==='req-keeper');
  assert.equal(dup.duplicateOf,'REQ-KEEPER');
  assert.equal(dup.disposition,'extraction error');
  assert.equal(C.excluded(dup),true);
  assert.equal(dup.reviewedBy,U);
  assert.match(dup.reviewReason,/Same joint-venture obligation/);
  assert.equal(n.evidence.find(e=>e.id==='map-dup').requirementId,'req-keeper');
  assert.deepEqual(n.sections.find(x=>x.id==='sec-dup').requirementIds,['req-keeper']);
  assert.equal(n.sections.find(x=>x.id==='sec-dup').claims[0].requirementId,'req-keeper');
  assert.equal(n.sections.find(x=>x.id==='sec-dup').status,'changes requested');
  assert.equal(n.sections.find(x=>x.id==='sec-keeper').status,'draft');
  assert.ok(!C.readiness(n,0).blockers.some(b=>b.includes('req-dup')));
  assert.ok(keeper.trace.history.some(h=>h.action==='duplicate-merged-into'));
  assert.ok(dup.trace.history.some(h=>h.action==='duplicate-merged'));
  // Nothing is deleted: the duplicate requirement and its original text stay
  // in the project, linked to the keeper.
  assert.equal(n.requirements.length,2);
  assert.equal(dup.text,'Joint venture partners must submit a joint venture agreement today.');
});
test('merge refuses non-reviewers, same requirement, missing requirements and already-merged pairs',()=>{
  const s=fixture();
  assert.throws(()=>C.apply(s,'mergeDuplicate',{keeperId:'req-keeper',duplicateId:'req-dup',reason:'Same.'},U),/reviewer/);
  assert.throws(()=>C.apply(s,'mergeDuplicate',{keeperId:'req-keeper',duplicateId:'req-keeper',reason:'Same.'},U,{reviewer:true}),/different/);
  assert.throws(()=>C.apply(s,'mergeDuplicate',{keeperId:'req-keeper',duplicateId:'missing',reason:'Same.'},U,{reviewer:true}),/not found/);
  assert.throws(()=>C.apply(s,'mergeDuplicate',{keeperId:'req-keeper',duplicateId:'req-dup',reason:''},U,{reviewer:true}),/missing|exceeds/);
  const merged=C.apply(s,'mergeDuplicate',{keeperId:'req-keeper',duplicateId:'req-dup',reason:'Same.'},U,{reviewer:true});
  assert.throws(()=>C.apply(merged,'mergeDuplicate',{keeperId:'req-keeper',duplicateId:'req-dup',reason:'Again.'},U,{reviewer:true}),/already merged/);
  assert.throws(()=>C.apply(merged,'mergeDuplicate',{keeperId:'req-dup',duplicateId:'req-keeper',reason:'Reverse.'},U,{reviewer:true}),/itself a duplicate/);
});
test('merge does not duplicate an evidence mapping the keeper already has',()=>{
  const s=fixture();
  s.evidence.push({id:'map-keeper-same',answerId:U,revision:2,requirementId:'req-keeper',text:'Fictional joint venture agreement.',decision:'accepted',stale:false,expired:false,conflicts:[],citations:[]});
  const n=C.apply(s,'mergeDuplicate',{keeperId:'req-keeper',duplicateId:'req-dup',reason:'Same.'},U,{reviewer:true});
  assert.equal(n.evidence.filter(e=>e.requirementId==='req-keeper'&&e.answerId===U&&e.revision===2).length,1);
  assert.equal(n.evidence.find(e=>e.id==='map-dup').requirementId,'req-dup');
});
test('changing a merged duplicate disposition back clears the duplicate link',()=>{
  const s=fixture();
  const merged=C.apply(s,'mergeDuplicate',{keeperId:'req-keeper',duplicateId:'req-dup',reason:'Same.'},U,{reviewer:true});
  const n=C.apply(merged,'reviewRequirement',{requirementId:'req-dup',status:'Needs Review',reason:'Actually a separate obligation.',disposition:'applicable'},U,{reviewer:true});
  assert.equal(n.requirements.find(r=>r.id==='req-dup').duplicateOf,undefined);
  assert.equal(n.requirements.find(r=>r.id==='req-dup').disposition,'applicable');
});
