const {test,beforeEach,afterEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const core=require('../netlify/functions/lib/proposal-core');
const S=require('../netlify/functions/lib/proposal-service'),{createHandler}=require('../netlify/functions/proposals');
const {load}=require('../netlify/functions/lib/reference-catalogue');

// Fictional RFPs only. No real customer document is used anywhere in this file.
const DOC='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let segN=0;
const source=(section,page,quote)=>({document_id:DOC,document:'Fictional RFP',segment_id:'seg-'+(++segN),page,section,quote});
const reqs=[
 {id:'11111111-1111-4111-8111-111111111111',text:'The vendor must meet the technical specification and hold current ISO 27001 certification.',mandatory:'Yes',category:'Technical',sources:[source('Section L',2,'The vendor must meet the technical specification and hold current ISO 27001 certification.')]},
 {id:'22222222-2222-4222-8222-222222222222',text:'The vendor must submit a signed certificate of insurance.',mandatory:'Yes',category:'Attachment',sources:[source('Section M',3,'The vendor must submit a signed certificate of insurance.')]},
 {id:'33333333-3333-4333-8333-333333333333',text:'Submit the completed pricing form by the deadline.',mandatory:'Yes',category:'Submission',sources:[source('Section N',1,'Submit the completed pricing form by the deadline.')]},
 {id:'44444444-4444-4333-8333-444444444444',text:'Proposals must be delivered in triplicate.',mandatory:'Unclear',category:'Submission',sources:[source('Section N',1,'Proposals must be delivered in triplicate.')]},
 {id:'55555555-5555-4333-8333-555555555555',text:'The vendor should describe its sustainability service program.',mandatory:'No',category:'Technical',sources:[source('Section O',4,'The vendor should describe its sustainability service program.')]},
];
const agileReqs=[
 {id:'66666666-6666-4666-8666-666666666666',text:'Discovery: interview users and map personas before building.',mandatory:'Yes',category:'Technical',sources:[source('Section A',1,'Discovery: interview users and map personas before building.')]},
 {id:'77777777-7777-4777-8777-777777777777',text:'Design mockups and a style guide for the prototype.',mandatory:'Yes',category:'Technical',sources:[source('Section B',2,'Design mockups and a style guide for the prototype.')]},
 {id:'88888888-8888-4888-8888-888888888888',text:'Development: build the prototype with unit tests before commit.',mandatory:'Yes',category:'Technical',sources:[source('Section C',3,'Development: build the prototype with unit tests before commit.')]},
 {id:'99999999-9999-4999-8999-999999999999',text:'Usability testing by independent testers before release.',mandatory:'Yes',category:'Technical',sources:[source('Section D',4,'Usability testing by independent testers before release.')]},
 {id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',text:'Deployment and monitoring in production after release.',mandatory:'Yes',category:'Technical',sources:[source('Section E',5,'Deployment and monitoring in production after release.')]},
];
const astronomyReqs=[
 {id:'bbbbbbbb-1111-4bbb-8bbb-bbbbbbbbbbbb',text:'The telescope must track deep-sky objects across the full night.',mandatory:'Yes',category:'Technical',sources:[source('Section A',1,'The telescope must track deep-sky objects across the full night.')]},
 {id:'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb',text:'The observatory dome must open and close in under ninety seconds.',mandatory:'Yes',category:'Technical',sources:[source('Section B',2,'The observatory dome must open and close in under ninety seconds.')]},
];
const fixtureWorkspace=(list=reqs)=>({analysis:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',fingerprint:'fp',status:'Completed',warnings:[],documents:[{id:DOC,name:'Fictional RFP',segments:list.map(r=>({id:r.sources[0].segment_id,page:r.sources[0].page,section:r.sources[0].section,text:r.sources[0].quote}))}],facts:[]},
 requirements:list.map(r=>({...r,fingerprint:undefined,original_requirement:r.text,requirement:r.text,evaluation_weight:null,uncertain:false,duplicate_count:0}))});
function importedState(list){return core.imported(core.initial('Fictional','Fictional'),fixtureWorkspace(list));}
const realCatalogue=()=>load(path.join(__dirname,'../reference-library'));
const sectionFor=(s,requirementId)=>s.sections.find(x=>x.requirementIds.includes(requirementId));

test('initial state carries an empty structure suggestion',()=>{assert.equal(core.initial('Fictional','Fictional').structureSuggestion,null);});

test('picks the state/local IT template for a pricing-and-technical RFP',()=>{
 const s=importedState(),sug=core.structureSuggestion(s,realCatalogue());
 assert.ok(sug);assert.equal(sug.patternId,'structure-template-state-local-it');assert.equal(sug.sourceId,'cisco-jp14001-response');
 assert.equal(sug.status,'suggested');assert.equal(sug.matchedGroups,2);assert.equal(sug.matchedSections,3);assert.equal(sug.totalSections,5);
 assert.equal(sug.canSupportCompliance,false);assert.equal(sug.requiresHumanReview,true);assert.equal(sug.permittedUse,'structure_guidance_only');
 assert.ok(sug.note.includes('Advisory only'));
 const byLabel=Object.fromEntries(sug.groups.map(g=>[g.label,g.sectionIds]));
 assert.deepEqual(byLabel['Requirements response'],[sectionFor(s,reqs[0].id).id,sectionFor(s,reqs[4].id).id]);
 assert.deepEqual(byLabel['Pricing and cost schedule'],[sectionFor(s,reqs[2].id).id]);
 assert.equal(sug.unmatchedSectionIds.length,2);
 assert.ok(!JSON.stringify(sug).match(/trained on winning bids|win-rate|learned from \d+ bids/i));
});

test('picks the agile delivery template for an agile RFP',()=>{
 const s=importedState(agileReqs),sug=core.structureSuggestion(s,realCatalogue());
 assert.ok(sug);assert.equal(sug.patternId,'structure-template-agile-delivery');assert.equal(sug.sourceId,'teralogics-agile-bpa-documentation');
 assert.equal(sug.matchedGroups,5);assert.equal(sug.matchedSections,5);
 const labels=sug.groups.map(g=>g.label);
 assert.deepEqual(labels,['Planning and discovery','Design','Development','Testing and quality','Deployment and operations']);
 assert.equal(sug.unmatchedSectionIds.length,0);
});

test('returns null when no template matches and for an invalid catalogue',()=>{
 const s=importedState(astronomyReqs);
 assert.equal(core.structureSuggestion(s,realCatalogue()),null);
 assert.equal(core.structureSuggestion(s,{}),null);
 assert.equal(core.structureSuggestion(s,null),null);
 assert.equal(core.structureSuggestion(s,undefined),null);
 assert.equal(core.structureSuggestion({requirements:[],sections:[]},realCatalogue()),null);
 assert.equal(core.structureSuggestion(null,realCatalogue()),null);
});

test('a section matching several groups joins the first group only',()=>{
 const list=[{id:'cccccccc-1111-4ccc-8ccc-cccccccccccc',text:'Submit the pricing form for the technical specification.',mandatory:'Yes',category:'Submission',sources:[source('Section A',1,'Submit the pricing form for the technical specification.')]},
  {id:'cccccccc-2222-4ccc-8ccc-cccccccccccc',text:'The vendor must meet the technical specification and hold current ISO 27001 certification.',mandatory:'Yes',category:'Technical',sources:[source('Section B',2,'The vendor must meet the technical specification and hold current ISO 27001 certification.')]},  {id:'cccccccc-3333-4ccc-8ccc-cccccccccccc',text:'Submit the completed cost schedule by Friday.',mandatory:'Yes',category:'Submission',sources:[source('Section C',3,'Submit the completed cost schedule by Friday.')]}];
 const s=importedState(list),sug=core.structureSuggestion(s,realCatalogue());
 assert.ok(sug);assert.equal(sug.patternId,'structure-template-state-local-it');
 const byLabel=Object.fromEntries(sug.groups.map(g=>[g.label,g.sectionIds]));
 // 'pricing' and 'technical' both match, but Requirements response comes first in the template.
 assert.deepEqual(byLabel['Requirements response'],[sectionFor(s,list[0].id).id,sectionFor(s,list[1].id).id]);
 assert.deepEqual(byLabel['Pricing and cost schedule'],[sectionFor(s,list[2].id).id]);
});

test('a requirement is never grouped by its category alone',()=>{
 const list=[
  {id:'dddddddd-1111-4ddd-8ddd-dddddddddddd',text:'If this contract is completely or partially terminated, the records must be retained for seven years.',mandatory:'Yes',category:'Administrative',sources:[source('Section A',1,'If this contract is completely or partially terminated, the records must be retained for seven years.')]},
  {id:'dddddddd-2222-4ddd-8ddd-dddddddddddd',text:'The vendor must meet the technical specification and hold current ISO 27001 certification.',mandatory:'Yes',category:'Technical',sources:[source('Section B',2,'The vendor must meet the technical specification and hold current ISO 27001 certification.')]},
  {id:'dddddddd-3333-4ddd-8ddd-dddddddddddd',text:'Submit the completed pricing form by the deadline.',mandatory:'Yes',category:'Submission',sources:[source('Section C',3,'Submit the completed pricing form by the deadline.')]},
  {id:'dddddddd-4444-4ddd-8ddd-dddddddddddd',text:'The observatory dome must open and close in under ninety seconds.',mandatory:'Yes',category:'Technical',sources:[source('Section D',4,'The observatory dome must open and close in under ninety seconds.')]},
 ];
 const s=importedState(list),sug=core.structureSuggestion(s,realCatalogue());
 assert.ok(sug);
 const byLabel=Object.fromEntries(sug.groups.map(g=>[g.label,g.sectionIds]));
 // The termination clause is Administrative, but its wording is about
 // termination, not cover letters or bidder forms.
 assert.deepEqual(byLabel['Cover letter and bidder forms'],[]);
 // The dome requirement is Technical, but its wording matches no group.
 assert.ok(!sug.groups.flatMap(g=>g.sectionIds).includes(sectionFor(s,list[3].id).id));
 assert.deepEqual(byLabel['Requirements response'],[sectionFor(s,list[1].id).id]);
 assert.deepEqual(byLabel['Pricing and cost schedule'],[sectionFor(s,list[2].id).id]);
});

test('apply reorders, renumbers and records the decision; text and links are untouched',()=>{
 const s=importedState(),sug=core.structureSuggestion(s,realCatalogue());
 const before=s.sections.map(x=>({id:x.id,title:x.title,text:x.text,requirementIds:x.requirementIds}));
 const applied=core.apply({...s,structureSuggestion:sug},'applyStructureSuggestion',{},'member-a',{});
 assert.equal(applied.structureSuggestion.status,'applied');assert.equal(applied.structureSuggestion.appliedBy,'member-a');assert.ok(applied.structureSuggestion.appliedAt);
 // Cisco order: Requirements response (ISO, sustainability) first, Pricing (pricing form) second, the rest keep their relative order.
 assert.deepEqual(applied.sections.map(x=>x.requirementIds[0]),[reqs[0].id,reqs[4].id,reqs[2].id,reqs[1].id,reqs[3].id]);
 assert.deepEqual(applied.sections.map(x=>x.title),['1. '+reqs[0].text,'2. '+reqs[4].text,'3. '+reqs[2].text,'4. '+reqs[1].text,'5. '+reqs[3].text]);
 assert.deepEqual(applied.sections.map(x=>x.text),before.map(x=>x.text));
 assert.deepEqual(applied.structureSuggestion.appliedOrder,applied.sections.map(x=>x.id));
 // Only the sections that moved get a revision bump and a review reason.
 assert.deepEqual(applied.sections.map(x=>x.revision),[0,1,0,1,1]);
 assert.equal(applied.sections[1].reviewReason,'Section order changed by an accepted structure suggestion.');
 assert.equal(applied.sections[0].reviewReason,'Source requirements imported or amended.');
});

test('dismiss leaves sections untouched and records the decision',()=>{
 const s=importedState(),sug=core.structureSuggestion(s,realCatalogue());
 const withAssessment={...s,structureSuggestion:sug,assessment:core.assessment(s,0),finalApproval:{contentHash:core.contentHash(s)}};
 const dismissed=core.apply(withAssessment,'dismissStructureSuggestion',{},'member-a',{});
 assert.equal(dismissed.structureSuggestion.status,'dismissed');assert.equal(dismissed.structureSuggestion.dismissedBy,'member-a');
 assert.deepEqual(dismissed.sections,s.sections);
 assert.equal(dismissed.assessment.stale,false); // no proposal content changed, so the assessment is not staled
 assert.equal(dismissed.finalApproval,null); // same conservative rule as every other mutation
});

test('apply or dismiss without a waiting suggestion fails, and a decision is final',()=>{
 const s=importedState();
 assert.throws(()=>core.apply(s,'applyStructureSuggestion',{},'member-a',{}),/No suggested section order/);
 assert.throws(()=>core.apply(s,'dismissStructureSuggestion',{},'member-a',{}),/No suggested section order/);
 const sug=core.structureSuggestion(s,realCatalogue());
 const applied=core.apply({...s,structureSuggestion:sug},'applyStructureSuggestion',{},'member-a',{});
 assert.throws(()=>core.apply(applied,'applyStructureSuggestion',{},'member-a',{}),/No suggested section order/);
 assert.throws(()=>core.apply(applied,'dismissStructureSuggestion',{},'member-a',{}),/No suggested section order/);
});

test('isEnabled reflects the reference flag without throwing',()=>{
 process.env.PROPOSAL_WORKSPACE_ENABLED='true';delete process.env.PROPOSAL_REFERENCE_ENABLED;
 assert.equal(S.isEnabled('reference'),false);
 process.env.PROPOSAL_REFERENCE_ENABLED='true';assert.equal(S.isEnabled('reference'),true);
 process.env.PROPOSAL_REFERENCE_ENABLED='false';assert.equal(S.isEnabled('reference'),false);
 process.env.PROPOSAL_WORKSPACE_ENABLED='false';process.env.PROPOSAL_REFERENCE_ENABLED='true';assert.equal(S.isEnabled('reference'),false);
});

// --- Handler-level tests: import computes the suggestion, and never fails because of it ---
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
let original,env,committed,p;
const event=body=>({httpMethod:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify(body)});
beforeEach(()=>{
 env={...process.env};
 for(const n of ['WORKSPACE','EVIDENCE','BUILDER','COLLABORATION','BID','REFERENCE'])process.env['PROPOSAL_'+n+'_ENABLED']='true';
 original={};
 for(const key of ['rpc','project','members','db','workspace','commit','notify','dispatch','putFile'])original[key]=S[key];
 original.config=S.kb.configuration;original.auth=S.kb.authenticate;original.verifyDocument=S.kb.verifyDocument;
 S.kb.configuration=()=>({});S.kb.authenticate=async e=>{if(!e.headers.authorization)S.kb.fail(401,'Sign in');return {user:{id},token:'test'};};
 S.kb.verifyDocument=async()=>({mime_type:'application/pdf',bytes:Buffer.from('x')});
 committed=null;const role='manager',orgRole='owner';
 p={id,org_id:other,created_by:id,revision:4,evidence_epoch:0,state:S.core.initial('Fictional','Fictional')};
 S.rpc=async()=>id;
 S.project=async(c,u,x,roles)=>{if(x!==id)S.kb.fail(403,'Denied');return structuredClone(p);};
 S.members=async()=>[{user_id:id,role,orgRole}];
 S.db=async()=>[];S.workspace=async(c,u,v)=>({project:v});
 S.commit=async(c,u,old,state,op)=>{committed=state;return {...old,state,revision:old.revision+1};};
 S.notify=async()=>{};S.dispatch=async()=>false;
 S.putFile=async(c,old,f)=>({id:'file-1',name:f.name});
});
afterEach(()=>{
 for(const [k,v]of Object.entries(original)){
  if(k==='config')S.kb.configuration=v;else if(k==='auth')S.kb.authenticate=v;else if(k==='verifyDocument')S.kb.verifyDocument=v;else S[k]=v;
 }
 process.env=env;
});
const complianceAdapter=()=>async()=>({statusCode:200,body:JSON.stringify(fixtureWorkspace())});
const importBody={action:'import',projectId:id,revision:4,evidenceEpoch:0,analysisId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',confirmShare:true,amendment:false};

test('import computes a suggestion from the shipped catalogue when reference is on',async()=>{
 const r=await createHandler({compliance:complianceAdapter()})(event(importBody));
 assert.equal(r.statusCode,200);
 assert.ok(committed);assert.equal(committed.structureSuggestion.status,'suggested');
 assert.equal(committed.structureSuggestion.patternId,'structure-template-state-local-it');
});

test('import still succeeds when the catalogue loader fails',async()=>{
 const r=await createHandler({compliance:complianceAdapter(),structureCatalogue:()=>{throw Error('catalogue unavailable');}})(event(importBody));
 assert.equal(r.statusCode,200);
 assert.ok(committed);assert.equal(committed.structureSuggestion,null);
 assert.equal(committed.requirements.length,5); // the import itself completed
});

test('import leaves the suggestion empty when reference is off',async()=>{
 delete process.env.PROPOSAL_REFERENCE_ENABLED;
 const r=await createHandler({compliance:complianceAdapter()})(event(importBody));
 assert.equal(r.statusCode,200);
 assert.ok(committed);assert.equal(committed.structureSuggestion,null);
});

test('apply and dismiss go through the reference-guarded operation',async()=>{
 const s=importedState();s.structureSuggestion=core.structureSuggestion(s,realCatalogue());
 p.state=s;
 const applied=await createHandler()(event({action:'applyStructureSuggestion',projectId:id,revision:4,evidenceEpoch:0}));
 assert.equal(applied.statusCode,200);
 assert.equal(committed.structureSuggestion.status,'applied');
 assert.deepEqual(committed.sections.map(x=>x.requirementIds[0]),[reqs[0].id,reqs[4].id,reqs[2].id,reqs[1].id,reqs[3].id]);
 p.state=s;
 const dismissed=await createHandler()(event({action:'dismissStructureSuggestion',projectId:id,revision:4,evidenceEpoch:0}));
 assert.equal(dismissed.statusCode,200);
 assert.equal(committed.structureSuggestion.status,'dismissed');
 assert.deepEqual(committed.sections,s.sections);
});

test('apply is refused when reference is off',async()=>{
 delete process.env.PROPOSAL_REFERENCE_ENABLED;
 const s=importedState();s.structureSuggestion=core.structureSuggestion(s,realCatalogue());
 p.state=s;
 const r=await createHandler()(event({action:'applyStructureSuggestion',projectId:id,revision:4,evidenceEpoch:0}));
 assert.equal(r.statusCode,503);
});
