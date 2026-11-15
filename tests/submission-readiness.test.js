const {test,beforeEach,afterEach}=require('node:test'),assert=require('node:assert/strict');
const core=require('../netlify/functions/lib/proposal-core');
const E=require('../netlify/functions/lib/proposal-export');
const {filterReadinessItems}=require('../assets/readiness-model.mjs');
const S=require('../netlify/functions/lib/proposal-service'),{createHandler}=require('../netlify/functions/proposals');

// Fictional RFP only. No real customer document is used anywhere in this file.
const source=(section,page,quote)=>({document_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',document:'Fictional RFP',segment_id:'s1',page,section,quote});
const reqs=[
 {id:'11111111-1111-4111-8111-111111111111',text:'The vendor must hold current ISO 27001 certification.',mandatory:'Yes',category:'Technical',sources:[source('Section L',2,'The vendor must hold current ISO 27001 certification.')]},
 {id:'22222222-2222-4222-8222-222222222222',text:'The vendor must submit a signed certificate of insurance.',mandatory:'Yes',category:'Attachment',sources:[source('Section M',3,'The vendor must submit a signed certificate of insurance.')]},
 {id:'33333333-3333-4333-8333-333333333333',text:'Submit the completed pricing form by the deadline.',mandatory:'Yes',category:'Submission',sources:[source('Section N',1,'Submit the completed pricing form by the deadline.')]},
 {id:'44444444-4444-4333-8333-444444444444',text:'Proposals must be delivered in triplicate.',mandatory:'Unclear',category:'Submission',sources:[source('Section N',1,'Proposals must be delivered in triplicate.')]},
 {id:'55555555-5555-4333-8333-555555555555',text:'The vendor should describe its sustainability program.',mandatory:'No',category:'Technical',sources:[source('Section O',4,'The vendor should describe its sustainability program.')]},
];
const fixtureWorkspace=()=>({analysis:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',fingerprint:'fp',status:'Completed',warnings:[],documents:[{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',name:'Fictional RFP'}],facts:[]},
 requirements:reqs.map(r=>({...r,fingerprint:undefined,original_requirement:r.text,requirement:r.text,evaluation_weight:null,uncertain:false,duplicate_count:0}))});
function importedState(){return core.imported(core.initial('Fictional','Fictional'),fixtureWorkspace());}
const ANSWER='33333333-3333-4333-8333-333333333333';
const members=[{user_id:'member-a',role:'author'},{user_id:'member-b',role:'author'}];
const reviewerOpts={reviewer:true,members,evidenceEpoch:0};
const itemId=sid=>'readiness:'+sid;
const sidOf=(s,i)=>s.requirements[i].stableId;

test('derived items: kinds, source references, mandatory separate from task status',()=>{
 const s=importedState(),items=core.readinessItems(s);
 assert.equal(items.length,5);
 const byKind=Object.fromEntries(items.map(i=>[i.kind+':'+i.mandatory,i]));
 assert.equal(byKind['requirement:Yes'].title,reqs[0].text);
 assert.equal(byKind['document:Yes'].title,reqs[1].text);
 assert.equal(byKind['form:Yes'].title,reqs[2].text);
 assert.equal(byKind['instruction:Unclear'].title,reqs[3].text);
 assert.equal(byKind['requirement:No'].title,reqs[4].text);
 assert.equal(items[0].mandatory,'Yes');assert.equal(items[0].status,'not-started'); // mandatory ≠ task status
 assert.equal(items[0].sourceReferences[0].document,'Fictional RFP');
 assert.equal(items[0].sourceReferences[0].section,'Section L');
 assert.equal(items[0].sourceReferences[0].page,2);
 assert.equal(items[0].sourceReferences[0].quote,reqs[0].text);
 assert.equal(items[0].manual,false);assert.equal(items[0].corrected,false);
 assert.equal(items[0].evidenceGap,true); // not-assessed coverage is a gap
 assert.equal(items[0].responseReviewPending,true);
 // Supported coverage + approved response clears the flags but not the task.
 let resolved=core.apply(s,'saveSection',{sectionId:s.sections[0].id,sectionRevision:0,text:'We hold ISO 27001 certification.'},'member-a',{});
 resolved=core.apply(resolved,'linkEvidence',{requirementId:resolved.requirements[0].id,evidence:{answerId:ANSWER,revision:2,question:'Do you hold ISO 27001?',text:'We hold ISO 27001 certification, valid until 2027-06-01.',citations:[{id:'c1',documentId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',fileName:'evidence.pdf',page:1,section:'Certifications',quote:'ISO 27001 certified.',sha256:'a'.repeat(64)}]}},'member-a',{});
 resolved=core.apply(resolved,'assessCoverage',{requirementId:resolved.requirements[0].id,coverage:'supported',explanation:'Certificate verified.'},'reviewer-1',reviewerOpts);
 resolved=core.apply(resolved,'approveResponse',{requirementId:resolved.requirements[0].id,explanation:'Response matches the certificate.'},'reviewer-1',reviewerOpts);
 const first=core.readinessItems(resolved)[0];
 assert.equal(first.evidenceGap,false);assert.equal(first.responseReviewPending,false);
 assert.equal(first.status,'not-started'); // task still open until someone marks it done
 assert.equal(core.readinessSummary(resolved).mandatoryUnresolved,4); // R1–R4 tasks still open: coverage/approval do not auto-resolve a task
});

test('summary lines count outstanding work; excluded requirements are omitted',()=>{
 const s=importedState(),sum=core.readinessSummary(s);
 assert.deepEqual(sum.lines,['4 mandatory items unresolved.','2 required documents missing.','5 responses awaiting approval.','5 evidence gaps.']);
 assert.equal(sum.total,5);assert.equal(sum.unresolved,5);
 const excluded=core.apply(s,'reviewRequirement',{requirementId:s.requirements[4].id,status:'Needs Review',reason:'Out of scope for this bid.',disposition:'not applicable'},'reviewer-1',reviewerOpts);
 assert.equal(core.readinessItems(excluded).length,4);
 assert.equal(core.readinessSummary(excluded).total,4);
});

test('two members divide work, resolve items, and see an accurate shared summary after refresh',()=>{
 let s=importedState();
 const [a,b,c,d]=[0,1,2,3].map(i=>itemId(sidOf(s,i)));
 s=core.apply(s,'readinessItem',{itemId:a,owner:'member-a'},'member-a',{members});
 s=core.apply(s,'readinessItem',{itemId:b,owner:'member-a'},'member-a',{members});
 s=core.apply(s,'readinessItem',{itemId:c,owner:'member-b'},'member-b',{members});
 s=core.apply(s,'readinessItem',{itemId:d,owner:'member-b'},'member-b',{members});
 // Member A finishes the certification item; member B works the pricing form.
 s=core.apply(s,'readinessItem',{itemId:a,status:'done'},'member-a',{members});
 s=core.apply(s,'readinessItem',{itemId:c,status:'in-progress'},'member-b',{members});
 s=core.apply(s,'readinessItem',{itemId:c,status:'done'},'member-b',{members});
 // Simulate both members refreshing: the persisted state is reloaded from JSON.
 const refreshed=JSON.parse(JSON.stringify(s));
 const sum=core.readinessSummary(refreshed);
 assert.deepEqual(sum.lines,['2 mandatory items unresolved.','1 required document missing.','3 responses awaiting approval.','3 evidence gaps.']);
 assert.deepEqual(sum.byOwner,{'member-a':1,'member-b':1,unassigned:1});
 assert.equal(sum.done,2);assert.equal(sum.unresolved,3);
 const items=core.readinessItems(refreshed);
 assert.equal(items.find(i=>i.id===a).status,'done');
 assert.equal(items.find(i=>i.id===c).owner,'member-b');
});

test('Not applicable requires a reason; the reason clears when the status changes',()=>{
 let s=importedState();const id=itemId(sidOf(s,4));
 assert.throws(()=>core.apply(s,'readinessItem',{itemId:id,status:'not-applicable'},'member-a',{members}),/reason for Not applicable/);
 assert.throws(()=>core.apply(s,'readinessItem',{itemId:id,status:'not-applicable',naReason:'  '},'member-a',{members}),/reason for Not applicable/);
 s=core.apply(s,'readinessItem',{itemId:id,status:'not-applicable',naReason:'Sustainability section is optional for this buyer.'},'member-a',{members});
 const item=core.readinessItems(s).find(i=>i.id===id);
 assert.equal(item.status,'not-applicable');assert.equal(item.naReason,'Sustainability section is optional for this buyer.');
 assert.equal(core.readinessSummary(s).unresolved,4);
 s=core.apply(s,'readinessItem',{itemId:id,status:'done'},'member-a',{members});
 assert.equal(core.readinessItems(s).find(i=>i.id===id).naReason,null);
 assert.throws(()=>core.apply(s,'readinessItem',{itemId:id,status:'finished'},'member-a',{members}),/Invalid readiness task status/);
 assert.throws(()=>core.apply(s,'readinessItem',{itemId:id,owner:'not-a-member'},'member-a',{members}),/current project member/);
 assert.throws(()=>core.apply(s,'readinessItem',{itemId:id,dueAt:'2026-02-30'},'member-a',{members}),/valid YYYY-MM-DD/);
 assert.throws(()=>core.apply(s,'readinessItem',{itemId:'readiness:REQ-NOSUCH'},'member-a',{members}),/not found/);
 s=core.apply(s,'readinessItem',{itemId:id,owner:'member-b',dueAt:'2026-11-20'},'member-a',{members});
 assert.equal(core.readinessItems(s).find(i=>i.id===id).owner,'member-b');
 assert.equal(core.readinessItems(s).find(i=>i.id===id).dueAt,'2026-11-20');
});

test('manual items are labelled and carry no extracted source; corrections are labelled',()=>{
 let s=importedState();
 s=core.apply(s,'readinessAddManual',{title:'Book the courier for the paper submission.',kind:'instruction',category:'Submission',mandatory:'Yes',source:''},'member-a',{members});
 let items=core.readinessItems(s);
 assert.equal(items.length,6);
 const manual=items.find(i=>i.manual);
 assert.equal(manual.title,'Book the courier for the paper submission.');
 assert.equal(manual.sourceReferences[0].document,'Manual addition — no extracted source.');
 assert.equal(manual.status,'not-started');
 assert.equal(core.readinessSummary(s).mandatoryUnresolved,5);
 assert.throws(()=>core.apply(s,'readinessAddManual',{title:'x',kind:'task',category:'Other',mandatory:'No'},'member-a',{members}),/Invalid readiness item kind/);
 assert.throws(()=>core.apply(s,'readinessAddManual',{title:'',kind:'other',category:'Other',mandatory:'No'},'member-a',{members}),/missing/);
 // Correct an extraction mistake: the triplicate instruction was misread.
 assert.throws(()=>core.apply(s,'readinessCorrect',{stableId:sidOf(s,3),text:'Proposals must be delivered in duplicate.',note:''},'member-a',{members}),/missing/);
 s=core.apply(s,'readinessCorrect',{stableId:sidOf(s,3),text:'Proposals must be delivered in duplicate.',category:'Submission',mandatory:'No',note:'Extraction read "triplicate"; the source says "duplicate".'},'member-a',{members});
 items=core.readinessItems(s);
 const corrected=items.find(i=>i.stableId===sidOf(s,3));
 assert.equal(corrected.title,'Proposals must be delivered in duplicate.');
 assert.equal(corrected.mandatory,'No');assert.equal(corrected.corrected,true);
 assert.equal(corrected.correctionNote,'Extraction read "triplicate"; the source says "duplicate".');
 assert.equal(core.readinessSummary(s).mandatoryUnresolved,4); // corrected item is no longer mandatory
 // The correction survives an amendment because it is keyed by stable ID.
 const amended=core.imported(s,fixtureWorkspace(),'amendment');
 assert.equal(core.readinessItems(amended).find(i=>i.stableId===sidOf(s,3)).corrected,true);
 // A manual item can be removed again; a derived item cannot be deleted this way.
 const manualId=core.readinessItems(s).find(i=>i.manual).id;
 s=core.apply(s,'readinessDeleteManual',{itemId:manualId},'member-a',{members});
 assert.equal(core.readinessItems(s).filter(i=>i.manual).length,0);
 assert.throws(()=>core.apply(s,'readinessDeleteManual',{itemId:manualId},'member-a',{members}),/not found/);
 // Legacy state without a readiness key degrades instead of crashing.
 const legacy=core.initial('Legacy','Legacy');delete legacy.readiness;legacy.requirements=[{id:'r1',text:'Do the thing.',mandatory:'Yes',category:'Technical',sources:[],status:'Needs Review',support:'needs review'}];legacy.sections=[];legacy.evidence=[];
 assert.equal(core.readinessItems(legacy).length,1);
 assert.equal(core.readinessSummary(legacy).mandatoryUnresolved,1);
});

test('filters keep mandatory status separate from task status',()=>{
 const s=importedState(),items=core.readinessItems(s);
 assert.equal(filterReadinessItems(items,{mandatory:'Yes'}).length,3);
 assert.equal(filterReadinessItems(items,{mandatory:'No'}).length,1);
 assert.equal(filterReadinessItems(items,{category:'Submission'}).length,2);
 assert.equal(filterReadinessItems(items,{status:'not-started'}).length,5);
 const owned=core.apply(s,'readinessItem',{itemId:itemId(sidOf(s,0)),owner:'member-a',status:'done'},'member-a',{members});
 const after=core.readinessItems(owned);
 assert.equal(filterReadinessItems(after,{owner:'member-a'}).length,1);
 assert.equal(filterReadinessItems(after,{owner:'unassigned'}).length,4);
 assert.equal(filterReadinessItems(after,{status:'done'}).length,1);
 assert.equal(filterReadinessItems(after,{mandatory:'Yes',status:'done'}).length,1);
});

test('readiness report lists unresolved items first with mandatory items prominent',()=>{
 const s=importedState(),p={id:'11111111-1111-4111-8111-111111111111',revision:7,state:s};
 const report=E.readinessReportText(p);
 const mandatoryAt=report.indexOf('UNRESOLVED MANDATORY ITEMS'),otherAt=report.indexOf('OTHER UNRESOLVED ITEMS'),doneAt=report.indexOf('DONE / NOT APPLICABLE');
 assert.ok(mandatoryAt>0&&mandatoryAt<otherAt&&otherAt<doneAt);
 assert.ok(report.includes('UNRESOLVED MANDATORY ITEMS (4)'));
 assert.ok(report.slice(mandatoryAt,otherAt).includes('The vendor must hold current ISO 27001 certification.'));
 assert.ok(report.includes('Fictional RFP · Section L · PDF page 2'));
 assert.ok(report.includes('4 mandatory items unresolved.'));
 assert.ok(report.includes('2 required documents missing.'));
 assert.ok(report.includes('5 responses awaiting approval.'));
 assert.ok(!/certified compliant|guaranteed ready|win probability/i.test(report));
 assert.ok(report.includes('covers only the supplied and successfully processed materials'));
 // Resolving every mandatory item empties the prominent section honestly.
 let done=s;
 for(let i=0;i<4;i++)done=core.apply(done,'readinessItem',{itemId:itemId(sidOf(done,i)),status:'done'},'member-a',{members});
 const doneReport=E.readinessReportText({id:p.id,revision:8,state:done});
 assert.ok(doneReport.includes('UNRESOLVED MANDATORY ITEMS (0)'));
 assert.ok(doneReport.includes('None. No mandatory item is currently unresolved.'));
});

test('submission package includes the readiness report and its summary in the manifest',async()=>{
 const s=importedState();s.sections[0].text='Fictional certification is current.';
 const p={id:'11111111-1111-4111-8111-111111111111',revision:12,evidence_epoch:0,state:s};
 const out=await E.packageFiles(p,{draft:true});
 assert.ok(out.files['readiness-report.md']);
 assert.ok(out.files['readiness-report.md'].toString().includes('UNRESOLVED MANDATORY ITEMS (4)'));
 assert.equal(out.manifest.readinessSummary.mandatoryUnresolved,4);
 assert.equal(out.manifest.readinessSummary.documentsMissing,2);
});

// --- Handler-level permission tests (same stub pattern as requirement-traceability.test.js) ---
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
let original,env,calls,role,orgRole,p;
const event=body=>({httpMethod:'POST',headers:{authorization:'Bearer x'},body:JSON.stringify(body)});
beforeEach(()=>{env={...process.env};for(const n of ['WORKSPACE','EVIDENCE','BUILDER','COLLABORATION','BID'])process.env['PROPOSAL_'+n+'_ENABLED']='true';
  original={};for(const key of ['rpc','project','members','db','workspace','commit','notify','dispatch'])original[key]=S[key];
  original.config=S.kb.configuration;original.auth=S.kb.authenticate;
  S.kb.configuration=()=>({});S.kb.authenticate=async()=>({user:{id},token:'test'});
  calls=[];role='manager';orgRole='owner';
  p={id,org_id:other,created_by:id,revision:4,evidence_epoch:0,state:importedState()};
  S.rpc=async(c,n,args)=>{calls.push(n);return id;};
  S.project=async(c,u,x,roles)=>{if(x!==id)S.kb.fail(403,'Denied');if(roles&&!roles.includes(role))S.kb.fail(403,'Denied');return structuredClone(p);};
  S.members=async()=>[{user_id:id,role,orgRole}];S.db=async()=>[];S.workspace=async(c,u,v)=>({project:v});
  S.commit=async(c,u,old,state,op)=>{calls.push(op);return {...old,state,revision:old.revision+1};};S.notify=async()=>{};S.dispatch=async()=>false;});
afterEach(()=>{for(const [k,v]of Object.entries(original)){if(k==='config')S.kb.configuration=v;else if(k==='auth')S.kb.authenticate=v;else S[k]=v;}process.env=env;});
const run=body=>createHandler()(event({projectId:id,...body}));

test('viewer can read readiness and download the report but cannot change task status',async()=>{
  role='viewer';orgRole='viewer';
  const read=await run({action:'readiness'});
  assert.equal(read.statusCode,200);
  const view=JSON.parse(read.body);
  assert.equal(view.readinessView.items.length,5);
  assert.equal(view.readinessView.summary.mandatoryUnresolved,4);
  assert.ok(view.readinessView.scopeNote.includes('supplied and successfully processed'));
  const report=await run({action:'readinessReport'});
  assert.equal(report.statusCode,200);
  assert.ok(JSON.parse(report.body).report.includes('UNRESOLVED MANDATORY ITEMS (4)'));
  for(const action of ['readinessItem','readinessAddManual','readinessCorrect','readinessDeleteManual']){
    const r=await run({action,revision:4,evidenceEpoch:0,itemId:'x',title:'x',kind:'other',category:'Other',mandatory:'No',stableId:'REQ-000000000000',note:'x'});
    assert.equal(r.statusCode,403);
  }
  assert.ok(!calls.includes('readiness.updated'));
});

test('a writable member updates a readiness item through the API and the change is committed',async()=>{
  const r=await run({action:'readinessItem',revision:4,evidenceEpoch:0,itemId:itemId(p.state.requirements[0].stableId),status:'in-progress',owner:id,dueAt:'2026-11-20'});
  assert.equal(r.statusCode,200);assert.ok(calls.includes('readiness.updated'));
  const saved=JSON.parse(r.body).project.state;
  const override=saved.readiness.items[itemId(p.state.requirements[0].stableId)];
  assert.equal(override.status,'in-progress');assert.equal(override.owner,id);assert.equal(override.dueAt,'2026-11-20');
  // N/A without a reason is rejected at the API layer too.
  const denied=await run({action:'readinessItem',revision:4,evidenceEpoch:0,itemId:itemId(p.state.requirements[0].stableId),status:'not-applicable'});
  assert.equal(denied.statusCode,400);
});
