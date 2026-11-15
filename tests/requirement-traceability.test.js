const {test,beforeEach,afterEach}=require('node:test'),assert=require('node:assert/strict');
const core=require('../netlify/functions/lib/proposal-core');
const {csv,exportRows}=require('../assets/compliance-export.mjs');
const {stableRequirementId}=require('../assets/compliance-model.mjs');
const S=require('../netlify/functions/lib/proposal-service'),{createHandler}=require('../netlify/functions/proposals');

const ANSWER='33333333-3333-4333-8333-333333333333';
const fixtureWorkspace=(text='The vendor must hold ISO 27001 certification.')=>({
  analysis:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',fingerprint:'fp',status:'Completed',warnings:[],
    documents:[{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',name:'Fictional RFP'}],facts:[]},
  requirements:[{id:'11111111-1111-4111-8111-111111111111',fingerprint:undefined,original_requirement:text,
    requirement:text,mandatory:'Yes',category:'Technical',evaluation_weight:null,
    sources:[{document_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',document:'Fictional RFP',segment_id:'s1',page:2,section:'Section L',quote:text}],
    uncertain:false,duplicate_count:0}]});
function importedState(text){const s=core.initial('Fictional','Fictional');return core.imported(s,fixtureWorkspace(text));}
const evidenceObject=()=>({answerId:ANSWER,revision:2,question:'Do you hold ISO 27001?',
  text:'We hold ISO 27001 certification, valid until 2027-06-01.',
  citations:[{id:'c1',documentId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',fileName:'evidence.pdf',page:1,section:'Certifications',quote:'ISO 27001 certified.',sha256:'a'.repeat(64)}]});
const reviewerOpts={reviewer:true,members:[],evidenceEpoch:3};
function approveSetup(){
  let s=importedState();const r=s.requirements[0],section=s.sections[0];
  s=core.apply(s,'saveSection',{sectionId:section.id,sectionRevision:0,text:'We hold ISO 27001 certification.'},'author-1',{});
  s=core.apply(s,'linkEvidence',{requirementId:r.id,evidence:evidenceObject()},'author-1',{});
  s=core.apply(s,'assessCoverage',{requirementId:r.id,coverage:'partially-supported',explanation:'Certificate covers the main scope; surveillance audit pending.'},'reviewer-1',reviewerOpts);
  s=core.apply(s,'approveResponse',{requirementId:r.id,explanation:'Response matches the certificate excerpt.'},'reviewer-1',reviewerOpts);
  return s;
}

test('stable IDs are deterministic, content-anchored, and survive amendments',()=>{
  const a=importedState(),b=importedState();
  assert.equal(a.requirements[0].stableId,b.requirements[0].stableId);
  assert.match(a.requirements[0].stableId,/^REQ-[0-9A-F]{12}$/);
  assert.notEqual(importedState('The vendor must hold ISO 9001 certification.').requirements[0].stableId,a.requirements[0].stableId);
  // Same wording re-extracted after an amendment keeps the ID and the review history.
  const amended=core.imported(a,fixtureWorkspace(),'amendment');
  assert.equal(amended.requirements[0].stableId,a.requirements[0].stableId);
  assert.equal(amended.requirements[0].id,a.requirements[0].id);
  // Reworded requirement keeps its ID but is flagged for reconfirmation.
  const reworded=core.imported(a,fixtureWorkspace('The vendor must hold current ISO 27001 certification.'),'amendment');
  assert.equal(reworded.requirements[0].stableId,a.requirements[0].stableId);
  assert.equal(reworded.requirements[0].trace.needsReconfirmation,true);
  // Legacy rows without a fingerprint still get a stable ID from the wording.
  const {createHash}=require('node:crypto');
  const fp=createHash('sha256').update('the vendor must hold iso 27001 certification.').digest('hex');
  assert.equal(core.stableRequirementId({text:'The vendor must hold ISO 27001 certification.'}),a.requirements[0].stableId);
  assert.equal(core.stableRequirementId({text:'The vendor must hold ISO 27001 certification.'}),'REQ-'+fp.slice(0,12).toUpperCase());
  assert.equal(stableRequirementId({fingerprint:fp}),a.requirements[0].stableId);
  assert.match(stableRequirementId({requirement:'The vendor must hold ISO 27001 certification.'}),/^REQ-[0-9A-F]{12}$/);
});

test('linking existing evidence suggests partial coverage; duplicates and unknown shapes fail',()=>{
  let s=importedState();const r=s.requirements[0];
  s=core.apply(s,'linkEvidence',{requirementId:r.id,evidence:evidenceObject()},'author-1',{});
  assert.equal(s.evidence.length,1);assert.equal(s.evidence[0].decision,'suggested');
  assert.equal(s.requirements[0].trace.coverage,'partially-supported');
  assert.equal(s.requirements[0].trace.coverageSource,'ai-suggested');
  assert.equal(s.evidence[0].citations[0].quote,'ISO 27001 certified.');
  assert.throws(()=>core.apply(s,'linkEvidence',{requirementId:r.id,evidence:evidenceObject()},'author-1',{}),/already linked/);
  assert.throws(()=>core.apply(s,'linkEvidence',{requirementId:r.id,evidence:{answerId:'x'}},'author-1',{}),/existing approved/);
  assert.throws(()=>core.apply(s,'linkEvidence',{requirementId:'missing',evidence:evidenceObject()},'author-1',{}),/Requirement not found/);
});

test('coverage assessment is reviewer-only, human-confirmed, and records reviewer, time and versions',()=>{
  let s=importedState();const r=s.requirements[0];
  assert.throws(()=>core.apply(s,'assessCoverage',{requirementId:r.id,coverage:'supported',explanation:'Checked.'},'author-1',{}),/authorized reviewer/);
  assert.throws(()=>core.apply(s,'assessCoverage',{requirementId:r.id,coverage:'fully',explanation:'Checked.'},'reviewer-1',reviewerOpts),/Invalid evidence coverage/);
  assert.throws(()=>core.apply(s,'assessCoverage',{requirementId:r.id,coverage:'supported',explanation:''},'reviewer-1',reviewerOpts),/missing/);
  s=core.apply(s,'assessCoverage',{requirementId:r.id,coverage:'supported',explanation:'Certificate verified against the source.'},'reviewer-1',reviewerOpts);
  const t=s.requirements[0].trace;
  assert.equal(t.coverage,'supported');assert.equal(t.coverageSource,'human-confirmed');
  assert.equal(t.reviewedBy,'reviewer-1');assert.ok(t.reviewedAt);assert.equal(t.reviewedEvidenceEpoch,3);
  assert.equal(t.reviewedRequirementRevision,0);assert.equal(t.history.at(-1).action,'coverage-assessed');
});

test('response approval is separate from coverage; changing the response invalidates it without deleting history',()=>{
  const s=approveSetup();const r=s.requirements[0],section=s.sections[0];
  // Partial coverage did not block response approval: the two fields are separate.
  assert.equal(r.trace.coverage,'partially-supported');
  assert.equal(r.trace.responseApproval.status,'approved');
  assert.equal(r.trace.responseApproval.reviewedBy,'reviewer-1');
  assert.ok(r.trace.responseApproval.responseHash);
  const historyLength=r.trace.history.length;
  const changed=core.apply(s,'saveSection',{sectionId:section.id,sectionRevision:section.revision,text:'We hold ISO 27001 certification, renewed 2026.'},'author-1',{});
  const after=changed.requirements[0].trace;
  assert.equal(after.responseApproval.status,'needs-reconfirmation');
  assert.equal(after.coverage,'partially-supported'); // coverage untouched by the response edit
  assert.ok(after.history.length>historyLength);
  assert.equal(after.history.find(h=>h.action==='response-approved').actor,'reviewer-1');
  assert.ok(after.history.some(h=>h.action==='response-invalidated'));
  // A no-op save does not invalidate.
  const noop=core.apply(s,'saveSection',{sectionId:section.id,sectionRevision:section.revision,text:section.text},'author-1',{});
  assert.equal(noop.requirements[0].trace.responseApproval.status,'approved');
});

test('accepting linked evidence after approval invalidates the response and flags coverage for reconfirmation',()=>{
  const s=approveSetup();const r=s.requirements[0],mapping=s.evidence[0];
  const reviewed=core.apply(s,'reviewEvidence',{evidenceId:mapping.id,decision:'accepted',support:'supported',reason:'Certificate excerpt matches the requirement.'},'reviewer-1',reviewerOpts);
  const t=reviewed.requirements[0].trace;
  assert.equal(t.responseApproval.status,'needs-reconfirmation');
  assert.equal(t.coverage,'supported');assert.equal(t.coverageSource,'human-confirmed');
  assert.equal(t.needsReconfirmation,false); // the reviewer just re-confirmed coverage here
});

test('trace summary keeps unsupported statements visible as unresolved items',()=>{
  const s=approveSetup();const summary=core.traceSummary(s,3),items=core.unresolvedItems(s);
  assert.equal(summary[0].stableId,s.requirements[0].stableId);
  assert.equal(summary[0].evidence[0].answerId,ANSWER);
  assert.equal(summary[0].evidence[0].excerpt,'We hold ISO 27001 certification, valid until 2027-06-01.');
  assert.equal(summary[0].unresolved,true); // partial coverage: still unresolved
  assert.equal(items.length,1);assert.equal(items[0].reasons.length,1);
  assert.ok(items[0].reasons[0].includes('partially-supported'));
  // Supported coverage plus an approved response resolves the item.
  let resolved=core.apply(s,'assessCoverage',{requirementId:s.requirements[0].id,coverage:'supported',explanation:'Full scope verified.'},'reviewer-1',reviewerOpts);
  resolved=core.apply(resolved,'approveResponse',{requirementId:resolved.requirements[0].id,explanation:'Approved after re-review.'},'reviewer-1',reviewerOpts);
  assert.equal(core.unresolvedItems(resolved).length,0);
  // Legacy state without any trace field degrades safely instead of crashing.
  const legacy=core.initial('Legacy','Legacy');legacy.requirements=[{id:'r1',text:'Do the thing.',mandatory:'Yes',category:'Technical',sources:[],status:'Needs Review',support:'needs review'}];
  legacy.sections=[];legacy.evidence=[];
  assert.equal(core.traceSummary(legacy,0)[0].coverage,'not-assessed');
  assert.equal(core.unresolvedItems(legacy).length,1);
  // An excluded requirement is never listed as unresolved.
  legacy.requirements[0].disposition='not applicable';legacy.requirements[0].reviewReason='Out of scope.';legacy.requirements[0].reviewedBy='reviewer-1';
  assert.equal(core.unresolvedItems(legacy).length,0);
});

test('evidence-epoch change marks human-confirmed reviews as needing reconfirmation',()=>{
  const s=approveSetup();const refreshed=core.refresh(s,4); // epoch moved 3 -> 4
  const t=refreshed.requirements[0].trace;
  assert.equal(t.needsReconfirmation,true);
  assert.equal(t.responseApproval.status,'needs-reconfirmation');
  assert.ok(t.history.some(h=>h.action==='coverage-needs-reconfirmation'));
});

// --- Handler-level permission tests (same stub pattern as proposal-api.test.js) ---
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
let original,env,calls,role,orgRole,p,candidates,denyCandidates;
const event=body=>({httpMethod:'POST',headers:{authorization:'Bearer x'},body:JSON.stringify(body)});
beforeEach(()=>{env={...process.env};for(const n of ['WORKSPACE','EVIDENCE','BUILDER','COLLABORATION','BID'])process.env['PROPOSAL_'+n+'_ENABLED']='true';
  original={};for(const key of ['rpc','project','members','db','workspace','commit','notify','dispatch'])original[key]=S[key];
  original.config=S.kb.configuration;original.auth=S.kb.authenticate;
  S.kb.configuration=()=>({});S.kb.authenticate=async()=>({user:{id},token:'test'});
  calls=[];role='manager';orgRole='owner';candidates=[evidenceObject()];denyCandidates=false;
  p={id,org_id:other,created_by:id,revision:4,evidence_epoch:0,state:importedState()};
  S.rpc=async(c,n,args)=>{calls.push(n);if(n==='candidates'){if(denyCandidates)S.kb.fail(403,'Project access denied');return candidates;}return id;};
  S.project=async(c,u,x,roles)=>{if(x!==id)S.kb.fail(403,'Denied');if(roles&&!roles.includes(role))S.kb.fail(403,'Denied');return structuredClone(p);};
  S.members=async()=>[{user_id:id,role,orgRole}];S.db=async()=>[];S.workspace=async(c,u,v)=>({project:v});
  S.commit=async(c,u,old,state,op)=>{calls.push(op);return {...old,state,revision:old.revision+1};};S.notify=async()=>{};S.dispatch=async()=>false;});
afterEach(()=>{for(const [k,v]of Object.entries(original)){if(k==='config')S.kb.configuration=v;else if(k==='auth')S.kb.authenticate=v;else S[k]=v;}process.env=env;});
const run=body=>createHandler()(event({projectId:id,...body}));
const reqId=()=>p.state.requirements[0].id;

test('evidence lookup is denied without a project role; an unreturned answer cannot be linked',async()=>{
  denyCandidates=true;
  let r=await run({action:'linkEvidence',revision:4,evidenceEpoch:0,requirementId:reqId(),answerId:ANSWER});
  assert.equal(r.statusCode,403);assert.ok(!calls.includes('evidence.reviewed'));
  denyCandidates=false;candidates=[];
  r=await run({action:'linkEvidence',revision:4,evidenceEpoch:0,requirementId:reqId(),answerId:ANSWER});
  assert.equal(r.statusCode,404);assert.ok(!calls.includes('evidence.reviewed'));
  candidates=[evidenceObject()];
  r=await run({action:'linkEvidence',revision:4,evidenceEpoch:0,requirementId:reqId(),answerId:ANSWER});
  assert.equal(r.statusCode,200);assert.ok(calls.includes('evidence.reviewed'));
});

test('viewer can read the trace but cannot assess coverage or approve a response',async()=>{
  role='viewer';orgRole='viewer';
  assert.equal((await run({action:'trace'})).statusCode,200);
  const trace=JSON.parse((await run({action:'trace'})).body);
  assert.equal(trace.unresolved.length,1);assert.equal(trace.trace[0].coverage,'not-assessed');
  for(const action of ['assessCoverage','approveResponse'])
    assert.equal((await run({action,revision:4,evidenceEpoch:0,requirementId:reqId(),coverage:'supported',explanation:'x'})).statusCode,403);
});

test('reviewer can assess coverage and approve a response through the API',async()=>{
  const r=await run({action:'assessCoverage',revision:4,evidenceEpoch:0,requirementId:reqId(),coverage:'partially-supported',explanation:'Certificate on file.'});
  assert.equal(r.statusCode,200);assert.ok(calls.includes('evidence.reviewed'));
});

// --- Export: trace columns survive; legacy rows degrade honestly ---
const source={document:'Fictional RFP',section:'Section L',page:2,quote:'The vendor must provide references.'};
const tracedRow={id:'row-1',stableId:'REQ-ABCDEF123456',fingerprint:'abcdef1234567890',requirement:'Provide references.',original_requirement:source.quote,category:'Eligibility',
  mandatory:'Yes',status:'Partial',evidence:'Reference list',evidence_reference:'Section 2',response_owner:'Pat',
  comments:'',recommendation:'Verify evidence.',sources:[source],evaluation_weight:null,uncertain:false,duplicate_count:0,
  trace:{coverage:'partially-supported',coverageSource:'human-confirmed',explanation:'Two of three references verified.',needsReconfirmation:false,responseApproval:{status:'approved'}},
  traceEvidence:[{answerId:ANSWER,revision:2,excerpt:'Client A reference.',decision:'accepted'}]};
const legacyRow={...tracedRow,id:'row-2',stableId:undefined,fingerprint:'123456abcdef7890',trace:undefined,traceEvidence:undefined};
const workspace={analysis:{id:'fictional-analysis',status:'Completed',processed:1,total_chunks:1,warnings:[],facts:[],documents:[]},requirements:[tracedRow,legacyRow],similar_pairs:[]};
test('compliance export carries stable ID, source reference, evidence refs, coverage and review status',()=>{
  const rows=exportRows(workspace);
  assert.equal(rows[0].length,25);
  for(const h of ['Stable Requirement ID','Source Reference','Evidence References','Evidence Coverage','Coverage Source','Review Status','Response Approval'])assert.ok(rows[0].includes(h));
  const traced=rows[1],legacy=rows[2];
  assert.equal(traced[18],'REQ-ABCDEF123456');
  assert.ok(traced[19].includes('Fictional RFP · Section L · PDF page 2'));
  assert.ok(traced[20].includes(ANSWER));assert.ok(traced[20].includes('Client A reference.'));
  assert.equal(traced[21],'partially-supported');assert.equal(traced[22],'Human-confirmed');
  assert.equal(traced[23],'Reviewed');assert.equal(traced[24],'approved');
  // Legacy row: no invented coverage, source reference still exact.
  assert.equal(legacy[18],'REQ-123456ABCDEF');
  assert.ok(legacy[19].includes('PDF page 2'));
  assert.equal(legacy[21],'not-assessed');assert.equal(legacy[22],'Unrecorded');
  assert.equal(legacy[23],'Not assessed');assert.equal(legacy[24],'not-approved');
  assert.ok(csv(workspace).includes('REQ-ABCDEF123456'));
});
