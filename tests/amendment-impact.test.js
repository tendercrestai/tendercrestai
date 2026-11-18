const {test,beforeEach,afterEach}=require('node:test'),assert=require('node:assert/strict');
const core=require('../netlify/functions/lib/proposal-core');
const E=require('../netlify/functions/lib/proposal-export');
const S=require('../netlify/functions/lib/proposal-service'),{createHandler}=require('../netlify/functions/proposals');

// Fictional RFP only. No real customer document is used anywhere in this file.
const DOC='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ANALYSIS='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const source=(text,section='Section L',page=2)=>({document_id:DOC,document:'Fictional RFP',segment_id:'s1',page,section,quote:text});
const reqShape=(id,text,mandatory='Yes',category='Technical',section='Section L',page=2)=>({id,fingerprint:undefined,original_requirement:text,requirement:text,mandatory,category,evaluation_weight:null,sources:[source(text,section,page)],uncertain:false,duplicate_count:0});
function workspaceFor(reqs,status='Completed',withSegments=true){
  const mapped=reqs.map((r,i)=>({...r,sources:r.sources.map(src=>({...src,segment_id:'s'+(i+1)}))}));
  const segments=withSegments?reqs.map((r,i)=>({id:'s'+(i+1),page:r.sources[0].page,section:r.sources[0].section,text:r.requirement})):[];
  return {analysis:{id:ANALYSIS,fingerprint:'fp',status,warnings:status==='Partial'?['One document had extraction gaps.']:[],documents:[{id:DOC,name:'Fictional RFP',segments}],facts:[]},requirements:mapped};
}
const ISO_TEXT='The vendor must hold ISO 27001 certification.';
const ISO_ID='11111111-1111-4111-8111-111111111111';
const INSURANCE_TEXT='The vendor must submit a signed certificate of insurance.';
const INSURANCE_ID='22222222-2222-4222-8222-222222222222';
const INSTRUCTION_TEXT='Submit the completed pricing form by November 20, 2026.';
const INSTRUCTION_ID='33333333-3333-4333-8333-333333333333';
const v1Reqs=()=>[reqShape(ISO_ID,ISO_TEXT),reqShape(INSURANCE_ID,INSURANCE_TEXT,'Yes','Attachment','Section M',3),reqShape(INSTRUCTION_ID,INSTRUCTION_TEXT,'Yes','Submission','Section N',1)];
function importedState(){return core.imported(core.initial('Fictional','Fictional'),workspaceFor(v1Reqs()));}
const ANSWER='33333333-3333-4333-8333-333333333333';
const evidenceObject=()=>({answerId:ANSWER,revision:2,question:'Do you hold ISO 27001?',
  text:'We hold ISO 27001 certification, valid until 2027-06-01.',
  citations:[{id:'c1',documentId:DOC,fileName:'evidence.pdf',page:1,section:'Certifications',quote:'ISO 27001 certified.',sha256:'a'.repeat(64)}]});
const reviewerOpts={reviewer:true,members:[],evidenceEpoch:0};
function approveSetup(){
  let s=importedState();const r=s.requirements[0],section=s.sections[0];
  s=core.apply(s,'saveSection',{sectionId:section.id,sectionRevision:0,text:'We hold ISO 27001 certification.'},'author-1',{});
  s=core.apply(s,'linkEvidence',{requirementId:r.id,evidence:evidenceObject()},'author-1',{});
  s=core.apply(s,'assessCoverage',{requirementId:r.id,coverage:'partially-supported',explanation:'Certificate covers the main scope.'},'reviewer-1',reviewerOpts);
  s=core.apply(s,'approveResponse',{requirementId:r.id,explanation:'Response matches the certificate excerpt.'},'reviewer-1',reviewerOpts);
  return s;
}
function propose(s,reqs,kind='supplemental',extra={}){
  const w=workspaceFor(reqs);
  return core.proposeAmendment(s,{kind,analysisId:ANALYSIS,sourceDocumentId:DOC,fileIds:['file-1'],documentsCompared:[{id:DOC,name:'Fictional Amendment 1'}],documentsUnprocessed:[],newRequirements:core.normalizeAnalysisRequirements(w),...extra},'author-1');
}
const amendmentOf=s=>s.amendments[s.amendments.length-1];
const changeOf=(s,type)=>amendmentOf(s).changes.find(c=>c.type===type);

test('identical wording reuses the stable ID and proposes no change',()=>{
  const s=propose(importedState(),v1Reqs());
  const a=amendmentOf(s);
  assert.equal(a.versionNumber,1);assert.equal(a.kind,'supplemental');assert.equal(a.status,'open');
  assert.deepEqual(a.documentsCompared,[{id:DOC,name:'Fictional Amendment 1'}]);
  assert.deepEqual(a.documentsUnprocessed,[]);
  assert.equal(a.changes.length,0);
  // Nothing was silently overwritten: live requirements, sections and traces are untouched.
  assert.equal(s.requirements.length,3);
  assert.equal(s.requirements[0].stableId,importedState().requirements[0].stableId);
  assert.equal(s.requirements[0].trace.responseApproval.status,'not-approved');
});

// --- Deadline-only amendments: the deadline moves in the extracted facts
// while every requirement matches unchanged. The pairwise comparison
// surfaces nothing, so the facts are compared directly (finding #17).
function stateWithDeadline(value){
  const w=workspaceFor(v1Reqs());
  w.analysis.facts=[{type:'Submission Deadline',value,segment_id:'s1',quote:'Submission deadline: '+value}];
  return core.imported(core.initial('Fictional','Fictional'),w);
}
const deadlineFacts=(value)=>[{type:'Submission Deadline',value,segment_id:'s1',quote:'Submission deadline: '+value}];

test('deadline-only amendment surfaces one project-level deadline change',()=>{
  const s=propose(stateWithDeadline('September 1, 2026'),v1Reqs(),'supplemental',{amendmentFacts:deadlineFacts('December 31, 2026')});
  const a=amendmentOf(s);
  assert.equal(a.changes.length,1);
  const c=a.changes[0];
  assert.equal(c.type,'deadline-changed');
  assert.equal(c.matchMethod,'deadline-fact');
  assert.equal(c.oldRequirementId,null);
  assert.equal(c.oldText,'Submission deadline: September 1, 2026');
  assert.equal(c.newText,'Submission deadline: December 31, 2026');
  // No requirement was rewritten by the proposal.
  assert.deepEqual(s.requirements.map(r=>r.text),v1Reqs().map(r=>r.requirement));
  // The change is visible with empty affected work, not hidden.
  const view=core.amendmentView(s)[0].changes.find(x=>x.id===c.id);
  assert.equal(view.type,'deadline-changed');
  assert.deepEqual(view.affected.evidence,[]);
  assert.deepEqual(view.affected.sections,[]);
});

test('ISO deadline facts are compared as dates, not raw strings',()=>{
  const s=propose(stateWithDeadline('2026-09-01'),v1Reqs(),'supplemental',{amendmentFacts:deadlineFacts('2026-12-31')});
  assert.equal(amendmentOf(s).changes.length,1);
  assert.equal(amendmentOf(s).changes[0].type,'deadline-changed');
});

test('same deadline, or a missing deadline fact on either side, proposes no change',()=>{
  assert.equal(amendmentOf(propose(stateWithDeadline('September 1, 2026'),v1Reqs(),'supplemental',{amendmentFacts:deadlineFacts('September 1, 2026')})).changes.length,0);
  assert.equal(amendmentOf(propose(stateWithDeadline('September 1, 2026'),v1Reqs())).changes.length,0);
  assert.equal(amendmentOf(propose(importedState(),v1Reqs(),'supplemental',{amendmentFacts:deadlineFacts('December 31, 2026')})).changes.length,0);
});

// --- Timetable fallback: short amendment notices often extract no
// Submission Deadline fact at all, so the response-due row of the
// procurement timetable is read from the analysis text instead. The
// label anchors the row, so earlier timetable dates (questions due,
// intent to bid) are never mistaken for the deadline.
const TIMETABLE_OLD='SECTION 3. PROCUREMENT TIMETABLE\nEVENT DATE\nWritten Questions due January 16, 2026, by 5:00 pm\nNotice of Intent to Bid January 30, 2026\nElectronic Responses Due in the portal (Note: the portal calls this the Bid Opening Date) February 13, 2026, by 5:00 pm\nContract Start Date (Estimated) July 1, 2026';
const TIMETABLE_NEW=TIMETABLE_OLD.replace('February 13, 2026','December 31, 2026');
const TIMETABLE_SEP=TIMETABLE_OLD.replace('February 13, 2026','September 1, 2026');
const textSegments=(text)=>[{text,document:'Fictional RFP',section:'Section 3',page:6}];
const proposeText=(s,oldText,newText,extra={})=>propose(s,v1Reqs(),'supplemental',{amendmentTextSegments:textSegments(newText),oldAnalysisTextSegments:textSegments(oldText),...extra});

test('timetable fallback surfaces the deadline move when both facts are missing',()=>{
  const s=proposeText(importedState(),TIMETABLE_OLD,TIMETABLE_NEW);
  const a=amendmentOf(s);
  assert.equal(a.changes.length,1);
  const c=a.changes[0];
  assert.equal(c.type,'deadline-changed');
  assert.equal(c.matchMethod,'deadline-text');
  assert.equal(c.oldRequirementId,null);
  assert.equal(c.oldText,'Submission deadline: February 13, 2026');
  assert.equal(c.newText,'Submission deadline: December 31, 2026');
  assert.equal(c.newSources[0].document,'Fictional RFP');
  assert.ok(c.newSources[0].quote.includes('December 31, 2026'));
});

test('timetable fallback reads the intermediate step too',()=>{
  const s=proposeText(importedState(),TIMETABLE_OLD,TIMETABLE_SEP);
  const c=amendmentOf(s).changes[0];
  assert.equal(c.type,'deadline-changed');
  assert.equal(c.oldText,'Submission deadline: February 13, 2026');
  assert.equal(c.newText,'Submission deadline: September 1, 2026');
});

test('timetable fallback proposes nothing when the dates agree, or the row is absent',()=>{
  assert.equal(amendmentOf(proposeText(importedState(),TIMETABLE_OLD,TIMETABLE_OLD)).changes.length,0);
  const noRow='SECTION 3. PROCUREMENT TIMETABLE\nEVENT DATE\nWritten Questions due January 16, 2026, by 5:00 pm\nNotice of Intent to Bid January 30, 2026\nContract Start Date (Estimated) July 1, 2026';
  assert.equal(amendmentOf(proposeText(importedState(),TIMETABLE_OLD,noRow)).changes.length,0);
  assert.equal(amendmentOf(proposeText(importedState(),noRow,TIMETABLE_NEW)).changes.length,0);
});

test('a response-due label with no date nearby proposes nothing',()=>{
  const noDate='SECTION 3. PROCUREMENT TIMETABLE\nElectronic Responses Due in the portal (see the timetable for the date)\nContract Start Date (Estimated) July 1, 2026';
  assert.equal(amendmentOf(proposeText(importedState(),TIMETABLE_OLD,noDate)).changes.length,0);
});

test('facts win over timetable text when both sides state a deadline',()=>{
  const s=proposeText(stateWithDeadline('September 1, 2026'),TIMETABLE_OLD,TIMETABLE_NEW,{amendmentFacts:deadlineFacts('December 31, 2026')});
  const c=amendmentOf(s).changes[0];
  assert.equal(c.type,'deadline-changed');
  assert.equal(c.matchMethod,'deadline-fact');
  assert.equal(c.oldText,'Submission deadline: September 1, 2026');
  assert.equal(c.newText,'Submission deadline: December 31, 2026');
});

test('confirming a project-level deadline change resolves it without touching requirements',()=>{
  let s=propose(stateWithDeadline('September 1, 2026'),v1Reqs(),'supplemental',{amendmentFacts:deadlineFacts('December 31, 2026')});
  const a=amendmentOf(s),c=a.changes[0];
  s=core.apply(s,'amendmentConfirm',{amendmentId:a.id,changeId:c.id},'author-1',{});
  assert.equal(amendmentOf(s).changes[0].status,'confirmed');
  assert.equal(amendmentOf(s).status,'resolved');
  assert.deepEqual(s.requirements.map(r=>r.text),v1Reqs().map(r=>r.requirement));
});

test('reworded requirement is a detected change; confirming reuses the stable ID and flags reconfirmation',()=>{
  let s=approveSetup();
  const before=s.requirements[0].trace;
  const originalStableId=s.requirements[0].stableId;
  assert.equal(before.responseApproval.status,'approved');
  s=propose(s,[reqShape(ISO_ID,'The vendor must hold current ISO 27001 certification.'),reqShape(INSURANCE_ID,INSURANCE_TEXT,'Yes','Attachment','Section M',3),reqShape(INSTRUCTION_ID,INSTRUCTION_TEXT,'Yes','Submission','Section N',1)]);
  const c=changeOf(s,'changed');
  assert.ok(c);assert.equal(c.matchMethod,'similarity');assert.ok(c.similarity>=0.5);
  assert.equal(c.stableId,s.requirements[0].stableId); // old stable ID carried on the change
  assert.equal(c.oldText,ISO_TEXT);assert.equal(c.newText,'The vendor must hold current ISO 27001 certification.');
  // Proposing flagged the approval; the original approval stays in history.
  const flagged=s.requirements[0].trace;
  assert.equal(flagged.responseApproval.status,'needs-reconfirmation');
  assert.equal(flagged.needsReconfirmation,true);
  assert.ok(flagged.history.some(h=>h.action==='response-approved'));
  assert.ok(flagged.history.some(h=>h.action==='amendment-change-proposed'));
  // Affected work is visible on the change before anyone confirms it.
  const view=core.amendmentView(s)[0].changes.find(x=>x.id===c.id);
  assert.equal(view.affected.evidence[0].answerId,ANSWER);
  assert.equal(view.affected.sections.length,1);
  assert.equal(view.affected.responseApproval,'needs-reconfirmation');
  // Confirming applies the new wording, keeps the stable ID, bumps the revision.
  s=core.apply(s,'amendmentConfirm',{amendmentId:amendmentOf(s).id,changeId:c.id},'author-1',{});
  const r=s.requirements[0];
  assert.equal(r.text,'The vendor must hold current ISO 27001 certification.');
  assert.equal(r.stableId,originalStableId); // reworded wording keeps the old stable ID
  assert.equal(r.stableId,c.stableId);
  assert.equal(r.revision,1);
  assert.equal(r.trace.responseApproval.status,'needs-reconfirmation'); // still needs a fresh approval
  assert.ok(r.trace.history.some(h=>h.action==='amendment-change-confirmed'));
  assert.equal(amendmentOf(s).status,'resolved');
  // A second decision on the same change is rejected.
  assert.throws(()=>core.apply(s,'amendmentConfirm',{amendmentId:amendmentOf(s).id,changeId:c.id},'author-1',{}),/already decided/);
});

test('new requirement gets a new stable ID on confirm and becomes a mandatory readiness item',()=>{
  let s=importedState();
  s=propose(s,[...v1Reqs(),reqShape('44444444-4444-4333-8333-444444444444','The vendor must hold CMMC Level 2 certification.')]);
  const c=changeOf(s,'added');
  assert.ok(c);assert.equal(c.newText,'The vendor must hold CMMC Level 2 certification.');
  assert.notEqual(c.stableId,s.requirements[0].stableId);
  assert.match(c.stableId,/^REQ-[0-9A-F]{12}$/);
  assert.equal(core.readinessItems(s).length,3); // not a readiness item until confirmed
  s=core.apply(s,'amendmentConfirm',{amendmentId:amendmentOf(s).id,changeId:c.id},'author-1',{});
  assert.equal(s.requirements.length,4);
  const added=s.requirements.find(r=>r.id==='44444444-4444-4333-8333-444444444444');
  assert.equal(added.stableId,c.stableId);assert.equal(added.status,'Needs Review');
  const items=core.readinessItems(s);
  assert.equal(items.length,4);
  const item=items.find(i=>i.stableId===c.stableId);
  assert.equal(item.mandatory,'Yes');assert.equal(item.kind,'requirement');assert.equal(item.status,'not-started');
});

test('supplemental amendment: absence does not mean removed; approval untouched',()=>{
  let s=approveSetup();
  s=propose(s,[reqShape(INSURANCE_ID,INSURANCE_TEXT,'Yes','Attachment','Section M',3),reqShape(INSTRUCTION_ID,INSTRUCTION_TEXT,'Yes','Submission','Section N',1)],'supplemental');
  const a=amendmentOf(s);
  assert.equal(a.changes.filter(c=>c.type==='potentially-removed').length,0);
  assert.equal(a.notMentioned.length,1);
  assert.equal(a.notMentioned[0].stableId,s.requirements[0].stableId);
  assert.equal(a.notMentioned[0].text,ISO_TEXT);
  // The ISO approval was not touched: the requirement simply was not mentioned.
  assert.equal(s.requirements[0].trace.responseApproval.status,'approved');
  assert.equal(s.requirements[0].trace.needsReconfirmation,false);
  const report=E.amendmentImpactReportText({id:'x',revision:5,state:s});
  assert.ok(report.includes('NOT MENTIONED IN THIS SUPPLEMENTAL AMENDMENT (1)'));
  assert.ok(report.includes('Absence from a supplemental amendment does not mean a requirement was removed.'));
});

test('replacement: absent requirement is potentially removed, never auto-deleted; reject restores the approval',()=>{
  let s=approveSetup();
  s=propose(s,[reqShape(INSURANCE_ID,INSURANCE_TEXT,'Yes','Attachment','Section M',3),reqShape(INSTRUCTION_ID,INSTRUCTION_TEXT,'Yes','Submission','Section N',1)],'replacement');
  const c=changeOf(s,'potentially-removed');
  assert.ok(c);assert.equal(c.oldText,ISO_TEXT);
  assert.equal(s.requirements.length,3); // still in the project
  assert.equal(s.requirements[0].trace.responseApproval.status,'needs-reconfirmation');
  assert.equal(s.requirements[0].trace.needsReconfirmation,true);
  // Rejecting restores the prior approval state, with the reason recorded.
  s=core.apply(s,'amendmentReject',{amendmentId:amendmentOf(s).id,changeId:c.id,reason:'The buyer confirmed the certification still applies.'},'author-1',{});
  assert.equal(s.requirements[0].trace.responseApproval.status,'approved');
  assert.equal(s.requirements[0].trace.needsReconfirmation,false);
  assert.ok(s.requirements[0].trace.history.some(h=>h.action==='amendment-change-rejected'));
  assert.equal(changeOf(s,'potentially-removed').status,'rejected');
  // Confirming a removal keeps the requirement and its history, but drops it from readiness and trace.
  let s2=approveSetup();
  s2=propose(s2,[reqShape(INSURANCE_ID,INSURANCE_TEXT,'Yes','Attachment','Section M',3),reqShape(INSTRUCTION_ID,INSTRUCTION_TEXT,'Yes','Submission','Section N',1)],'replacement');
  const c2=changeOf(s2,'potentially-removed');
  s2=core.apply(s2,'amendmentConfirm',{amendmentId:amendmentOf(s2).id,changeId:c2.id},'author-1',{});
  assert.equal(s2.requirements.length,3);
  assert.ok(s2.requirements[0].removedByAmendment);
  assert.equal(s2.requirements[0].removedByAmendment.versionNumber,1);
  assert.equal(core.readinessItems(s2).length,2);
  assert.equal(core.unresolvedItems(s2).filter(i=>i.stableId===s2.requirements[0].stableId).length,0);
  assert.ok(s2.requirements[0].trace.history.some(h=>h.action==='amendment-removal-confirmed'));
});

test('deadline and instruction changes are detected separately from wording changes',()=>{
  assert.deepEqual(core.extractAmendmentDates('Due November 20, 2026 and 2026-12-04.'),['2026-11-20','2026-12-04']);
  // Deadline moved: same instruction, new date.
  let s=importedState();
  s=propose(s,[reqShape(ISO_ID,ISO_TEXT),reqShape(INSURANCE_ID,INSURANCE_TEXT,'Yes','Attachment','Section M',3),reqShape(INSTRUCTION_ID,'Submit the completed pricing form by December 4, 2026.','Yes','Submission','Section N',1)]);
  const d=changeOf(s,'deadline-changed');
  assert.ok(d);assert.equal(d.oldText,INSTRUCTION_TEXT);assert.equal(d.newText,'Submit the completed pricing form by December 4, 2026.');
  assert.equal(d.deadlineChanged,true);
  // Wording changed, date unchanged: an instruction change, not a deadline change.
  let s2=importedState();
  s2=propose(s2,[reqShape(ISO_ID,ISO_TEXT),reqShape(INSURANCE_ID,INSURANCE_TEXT,'Yes','Attachment','Section M',3),reqShape(INSTRUCTION_ID,'Submit the completed pricing form in duplicate by November 20, 2026.','Yes','Submission','Section N',1)]);
  const i=changeOf(s2,'instruction-changed');
  assert.ok(i);assert.equal(i.deadlineChanged,false);
  assert.equal(changeOf(s2,'deadline-changed'),undefined);
});

test('uncertain matches are not guessed: no approval flag until a human corrects the match',()=>{
  const refsText='The vendor must provide three client references from the past five years.';
  const refsState=()=>core.imported(core.initial('Fictional','Fictional'),workspaceFor([reqShape(ISO_ID,refsText),reqShape(INSURANCE_ID,INSURANCE_TEXT,'Yes','Attachment','Section M',3),reqShape(INSTRUCTION_ID,INSTRUCTION_TEXT,'Yes','Submission','Section N',1)]));
  const vague='The vendor must provide client references and a list of past projects.';
  const vagueReqs=()=>[reqShape('55555555-5555-4333-8333-555555555555',vague),reqShape(INSURANCE_ID,INSURANCE_TEXT,'Yes','Attachment','Section M',3),reqShape(INSTRUCTION_ID,INSTRUCTION_TEXT,'Yes','Submission','Section N',1)];
  // Approve the response to the references requirement first.
  let s=refsState();
  s=core.apply(s,'saveSection',{sectionId:s.sections[0].id,sectionRevision:0,text:'Three client references provided.'},'author-1',{});
  s=core.apply(s,'approveResponse',{requirementId:ISO_ID,explanation:'References response verified.'},'reviewer-1',reviewerOpts);
  assert.equal(s.requirements[0].trace.responseApproval.status,'approved');
  s=propose(s,vagueReqs());
  const u=changeOf(s,'uncertain-match');
  assert.ok(u);assert.ok(u.similarity>=0.25&&u.similarity<0.5);
  assert.equal(u.oldText,refsText);
  assert.equal(u.newText,vague);
  assert.equal(s.requirements[0].trace.responseApproval.status,'approved'); // not flagged: match unconfirmed
  assert.equal(s.requirements[0].trace.needsReconfirmation,false);
  // Correct as "same": applies the wording, reuses the stable ID, flags the approval.
  s=core.apply(s,'amendmentCorrect',{amendmentId:amendmentOf(s).id,changeId:u.id,correction:'same',targetStableId:s.requirements[0].stableId,correctedText:null,note:'Same references requirement, reworded by the buyer.'},'author-1',{});
  const corrected=changeOf(s,'changed');
  assert.ok(corrected);assert.equal(corrected.status,'corrected');
  assert.equal(s.requirements[0].text,vague);
  assert.equal(s.requirements[0].trace.responseApproval.status,'needs-reconfirmation');
  // Correct as "different": the match was wrong; it becomes a proposed addition.
  let s2=refsState();
  s2=propose(s2,vagueReqs());
  const u2=changeOf(s2,'uncertain-match');
  assert.ok(u2);
  s2=core.apply(s2,'amendmentCorrect',{amendmentId:amendmentOf(s2).id,changeId:u2.id,correction:'different',targetStableId:null,correctedText:null,note:'References and past projects are separate requirements here.'},'author-1',{});
  const asAdded=amendmentOf(s2).changes.find(c=>c.id===u2.id);
  assert.equal(asAdded.type,'added');assert.equal(asAdded.status,'proposed'); // still needs a confirm
  assert.equal(s2.requirements[0].text,refsText); // old wording untouched
});

test('reword correction edits the proposal without applying it; invalid corrections fail',()=>{
  let s=importedState();
  s=propose(s,[reqShape(ISO_ID,'The vendor must hold current ISO 27001 certification.'),reqShape(INSURANCE_ID,INSURANCE_TEXT,'Yes','Attachment','Section M',3),reqShape(INSTRUCTION_ID,INSTRUCTION_TEXT,'Yes','Submission','Section N',1)]);
  const c=changeOf(s,'changed');
  s=core.apply(s,'amendmentCorrect',{amendmentId:amendmentOf(s).id,changeId:c.id,correction:'reword',targetStableId:null,correctedText:'The vendor must hold ISO 27001 certification, current at submission.',note:'Buyer wording is "current at submission", not "current".'},'author-1',{});
  const edited=changeOf(s,'changed');
  assert.equal(edited.newText,'The vendor must hold ISO 27001 certification, current at submission.');
  assert.equal(edited.status,'proposed'); // still needs a confirm
  assert.equal(s.requirements[0].text,ISO_TEXT); // live requirement untouched by a correction
  assert.throws(()=>core.apply(s,'amendmentCorrect',{amendmentId:amendmentOf(s).id,changeId:c.id,correction:'bogus',targetStableId:null,correctedText:null,note:'x'},'author-1',{}),/Choose how to correct/);
  assert.throws(()=>core.apply(s,'amendmentCorrect',{amendmentId:amendmentOf(s).id,changeId:c.id,correction:'reword',targetStableId:null,correctedText:null,note:''},'author-1',{}),/missing/);
  assert.throws(()=>core.proposeAmendment(s,{kind:'side-letter',newRequirements:core.normalizeAnalysisRequirements(workspaceFor(v1Reqs())),documentsCompared:[{id:DOC,name:'x'}]},'author-1'),/replacement or supplemental/);
  assert.throws(()=>core.proposeAmendment(s,{kind:'supplemental',versionNumber:1,newRequirements:core.normalizeAnalysisRequirements(workspaceFor(v1Reqs())),documentsCompared:[{id:DOC,name:'x'}]},'author-1'),/unused positive version/);
});

test('impact report states compared and unprocessed documents, side-by-side wording, and unresolved reviews',()=>{
  let s=approveSetup();
  const w=workspaceFor([reqShape(ISO_ID,'The vendor must hold current ISO 27001 certification.'),reqShape(INSURANCE_ID,INSURANCE_TEXT,'Yes','Attachment','Section M',3),reqShape(INSTRUCTION_ID,'Submit the completed pricing form by December 4, 2026.','Yes','Submission','Section N',1)],'Partial',false);
  s=core.proposeAmendment(s,{kind:'replacement',analysisId:ANALYSIS,sourceDocumentId:DOC,fileIds:['file-1'],documentsCompared:[{id:DOC,name:'Fictional Amendment 1'}],documentsUnprocessed:[{id:DOC,name:'Fictional Amendment 1',reason:'No extracted segments in this analysis.'}],newRequirements:core.normalizeAnalysisRequirements(w)},'author-1');
  const p={id:'11111111-1111-4111-8111-111111111111',revision:9,state:s};
  const report=E.amendmentImpactReportText(p);
  assert.ok(report.includes('solicitation version 1 (complete replacement solicitation)'));
  assert.ok(report.includes('Documents compared (1)'));
  assert.ok(report.includes('Fictional Amendment 1'));
  assert.ok(report.includes('Documents that could not be processed (1)'));
  assert.ok(report.includes('No extracted segments in this analysis.'));
  assert.ok(report.includes('CHANGED REQUIREMENTS (1)'));
  assert.ok(report.includes('CHANGED DEADLINES (1)'));
  assert.ok(report.includes('OLD: '+ISO_TEXT));
  assert.ok(report.includes('NEW: The vendor must hold current ISO 27001 certification.'));
  assert.ok(report.includes('OLD: '+INSTRUCTION_TEXT));
  assert.ok(report.includes('NEW: Submit the completed pricing form by December 4, 2026.'));
  assert.ok(report.includes('Affected evidence: '+ANSWER));
  assert.ok(report.includes('NEEDS RECONFIRMATION'));
  assert.ok(report.includes('UNRESOLVED REVIEWS (2)'));
  assert.ok(report.includes('suggestion until a person confirms'));
  // Confirming everything empties the unresolved section honestly.
  for(const c of [...amendmentOf(s).changes])s=core.apply(s,'amendmentConfirm',{amendmentId:amendmentOf(s).id,changeId:c.id},'author-1',{});
  const done=E.amendmentImpactReportText({id:p.id,revision:10,state:s});
  assert.ok(done.includes('UNRESOLVED REVIEWS (0)'));
  assert.ok(done.includes('None. Every proposed change has been confirmed, corrected or rejected.'));
});

test('submission package includes the amendment impact report and its summary in the manifest',async()=>{
  let s=importedState();
  s=propose(s,[...v1Reqs(),reqShape('44444444-4444-4333-8333-444444444444','The vendor must hold CMMC Level 2 certification.')]);
  s.sections[0].text='Fictional certification is current.';
  const p={id:'11111111-1111-4111-8111-111111111111',revision:12,evidence_epoch:0,state:s};
  const out=await E.packageFiles(p,{draft:true});
  assert.ok(out.files['amendment-impact-report.md']);
  assert.ok(out.files['amendment-impact-report.md'].toString().includes('ADDED REQUIREMENTS (1)'));
  assert.equal(out.manifest.amendmentImpact.total,1);
  assert.equal(out.manifest.amendmentImpact.kind,'supplemental');
  // A project with no amendments has no impact report file and a null summary.
  const clean=await E.packageFiles({id:p.id,revision:1,evidence_epoch:0,state:importedState()},{draft:true});
  assert.equal(clean.files['amendment-impact-report.md'],undefined);
  assert.equal(clean.manifest.amendmentImpact,null);
});

// --- Acceptance test: an amendment changes a submission instruction and adds
// a required certification. Both are identified, affected work is shown, and
// reconfirmation is requested without losing the original proposal or approvals.
test('acceptance: amendment changes an instruction and adds a required certification',()=>{
  let s=importedState();
  // The team drafted and approved the response to the submission instruction.
  const section=s.sections.find(x=>x.requirementIds.includes(INSTRUCTION_ID));
  s=core.apply(s,'saveSection',{sectionId:section.id,sectionRevision:0,text:'The completed pricing form is submitted by November 20, 2026.'},'author-1',{});
  s=core.apply(s,'approveResponse',{requirementId:INSTRUCTION_ID,explanation:'Instruction response verified against the source.'},'reviewer-1',reviewerOpts);
  const originalText=s.requirements.find(r=>r.id===INSTRUCTION_ID).text;
  const originalApproval=s.requirements.find(r=>r.id===INSTRUCTION_ID).trace.responseApproval;
  assert.equal(originalApproval.status,'approved');
  // Amendment 1 (supplemental): deadline moves to December 4, 2026, and a
  // required CMMC Level 2 certification is added.
  s=propose(s,[reqShape(ISO_ID,ISO_TEXT),reqShape(INSURANCE_ID,INSURANCE_TEXT,'Yes','Attachment','Section M',3),reqShape(INSTRUCTION_ID,'Submit the completed pricing form by December 4, 2026.','Yes','Submission','Section N',1),reqShape('44444444-4444-4333-8333-444444444444','The vendor must hold CMMC Level 2 certification.')],'supplemental');
  const a=amendmentOf(s);
  assert.equal(a.versionNumber,1);assert.equal(a.kind,'supplemental');
  const deadline=changeOf(s,'deadline-changed'),added=changeOf(s,'added');
  assert.ok(deadline,'deadline change identified');
  assert.ok(added,'added certification identified');
  assert.equal(deadline.oldText,originalText);
  // Affected work is shown: the draft response and its approval.
  const view=core.amendmentView(s)[0].changes.find(c=>c.id===deadline.id);
  assert.equal(view.affected.sections.length,1);
  assert.equal(view.affected.responseApproval,'needs-reconfirmation');
  // Reconfirmation was requested, but the original proposal and its approval
  // history were not lost.
  const instr=s.requirements.find(r=>r.id===INSTRUCTION_ID);
  assert.equal(instr.text,originalText); // not silently overwritten
  assert.equal(s.sections.find(x=>x.id===section.id).text,'The completed pricing form is submitted by November 20, 2026.');
  assert.ok(instr.trace.history.some(h=>h.action==='response-approved'));
  assert.equal(instr.trace.responseApproval.status,'needs-reconfirmation');
  // Confirming both applies them; the new certification becomes a mandatory
  // readiness item and the report records the outcome.
  s=core.apply(s,'amendmentConfirm',{amendmentId:a.id,changeId:deadline.id},'author-1',{});
  s=core.apply(s,'amendmentConfirm',{amendmentId:a.id,changeId:added.id},'author-1',{});
  assert.equal(s.requirements.find(r=>r.id===INSTRUCTION_ID).text,'Submit the completed pricing form by December 4, 2026.');
  assert.ok(s.requirements.some(r=>r.text==='The vendor must hold CMMC Level 2 certification.'));
  assert.ok(core.readinessItems(s).some(i=>i.title==='The vendor must hold CMMC Level 2 certification.'&&i.mandatory==='Yes'));
  assert.equal(amendmentOf(s).status,'resolved');
  const report=E.amendmentImpactReportText({id:'x',revision:6,state:s});
  assert.ok(report.includes('CHANGED DEADLINES (1)'));
  assert.ok(report.includes('ADDED REQUIREMENTS (1)'));
  assert.ok(report.includes('UNRESOLVED REVIEWS (0)'));
});

// --- Handler-level permission tests (same stub pattern as submission-readiness.test.js) ---
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
let original,env,calls,role,orgRole,p,analysisWorkspace;
const event=body=>({httpMethod:'POST',headers:{authorization:'Bearer x'},body:JSON.stringify(body)});
beforeEach(()=>{env={...process.env};for(const n of ['WORKSPACE','EVIDENCE','BUILDER','COLLABORATION','BID'])process.env['PROPOSAL_'+n+'_ENABLED']='true';
  original={};for(const key of ['rpc','project','members','db','workspace','commit','notify','dispatch','putFile'])original[key]=S[key];
  original.config=S.kb.configuration;original.auth=S.kb.authenticate;original.verifyDocument=S.kb.verifyDocument;
  S.kb.configuration=()=>({});S.kb.authenticate=async()=>({user:{id},token:'test'});
  S.kb.verifyDocument=async()=>({mime_type:'application/pdf',bytes:Buffer.from('fictional amendment')});
  S.putFile=async()=>({id:'file-1'});
  calls=[];role='manager';orgRole='owner';
  p={id,org_id:other,created_by:id,revision:4,evidence_epoch:0,state:importedState()};
  analysisWorkspace=workspaceFor([reqShape(ISO_ID,'The vendor must hold current ISO 27001 certification.'),reqShape(INSURANCE_ID,INSURANCE_TEXT,'Yes','Attachment','Section M',3),reqShape(INSTRUCTION_ID,INSTRUCTION_TEXT,'Yes','Submission','Section N',1)]);
  S.rpc=async(c,n,args)=>{calls.push(n);return id;};
  S.project=async(c,u,x,roles)=>{if(x!==id)S.kb.fail(403,'Denied');if(roles&&!roles.includes(role))S.kb.fail(403,'Denied');return structuredClone(p);};
  S.members=async()=>[{user_id:id,role,orgRole}];S.db=async()=>[];S.workspace=async(c,u,v)=>({project:v});
  S.commit=async(c,u,old,state,op)=>{calls.push(op);return {...old,state,revision:old.revision+1};};S.notify=async()=>{};S.dispatch=async()=>false;});
afterEach(()=>{for(const [k,v]of Object.entries(original)){if(k==='config')S.kb.configuration=v;else if(k==='auth')S.kb.authenticate=v;else if(k==='verifyDocument')S.kb.verifyDocument=v;else S[k]=v;}process.env=env;});
const run=(body,adapters)=>createHandler(adapters||{})(event({projectId:id,...body}));
const complianceAdapter={compliance:async()=>({statusCode:200,body:JSON.stringify(analysisWorkspace)})};
const proposedState=()=>{const s=propose(structuredClone(p.state),[reqShape(ISO_ID,'The vendor must hold current ISO 27001 certification.'),reqShape(INSURANCE_ID,INSURANCE_TEXT,'Yes','Attachment','Section M',3),reqShape(INSTRUCTION_ID,INSTRUCTION_TEXT,'Yes','Submission','Section N',1)]);return s;};

test('viewer can read amendments and the impact report but cannot propose or decide changes',async()=>{
  role='viewer';orgRole='viewer';
  p.state=proposedState();
  const read=await run({action:'amendments'});
  assert.equal(read.statusCode,200);
  assert.equal(JSON.parse(read.body).amendments.length,1);
  assert.equal(JSON.parse(read.body).amendments[0].changes[0].type,'changed');
  const report=await run({action:'amendmentReport'});
  assert.equal(report.statusCode,200);
  assert.ok(JSON.parse(report.body).report.includes('CHANGED REQUIREMENTS (1)'));
  const a=p.state.amendments[0],c=a.changes[0];
  for(const body of [{action:'amendmentPropose',revision:4,evidenceEpoch:0,analysisId:ANALYSIS,kind:'supplemental',confirmShare:true,versionNumber:null},
    {action:'amendmentConfirm',revision:4,evidenceEpoch:0,amendmentId:a.id,changeId:c.id},
    {action:'amendmentCorrect',revision:4,evidenceEpoch:0,amendmentId:a.id,changeId:c.id,correction:'reword',targetStableId:null,correctedText:'x',note:'x'},
    {action:'amendmentReject',revision:4,evidenceEpoch:0,amendmentId:a.id,changeId:c.id,reason:'x'}])
    assert.equal((await run(body,complianceAdapter)).statusCode,403);
  assert.ok(!calls.includes('amendment.proposed'));
});

test('a writable member proposes an amendment and confirms a change through the API',async()=>{
  const r=await run({action:'amendmentPropose',revision:4,evidenceEpoch:0,analysisId:ANALYSIS,kind:'supplemental',confirmShare:true,versionNumber:null},complianceAdapter);
  assert.equal(r.statusCode,200);assert.ok(calls.includes('amendment.proposed'));
  const saved=JSON.parse(r.body).project.state;
  assert.equal(saved.amendments.length,1);
  assert.equal(saved.amendments[0].changes[0].type,'changed');
  assert.equal(saved.amendments[0].documentsCompared[0].name,'Fictional RFP');
  // Confirm the change through the API; the new wording lands, the stable ID stays.
  p.state=saved;
  const a=saved.amendments[0],c=a.changes[0];
  const confirmed=await run({action:'amendmentConfirm',revision:4,evidenceEpoch:0,amendmentId:a.id,changeId:c.id});
  assert.equal(confirmed.statusCode,200);assert.ok(calls.includes('amendment.confirmed'));
  const after=JSON.parse(confirmed.body).project.state;
  assert.equal(after.requirements[0].text,'The vendor must hold current ISO 27001 certification.');
  assert.equal(after.requirements[0].stableId,saved.requirements[0].stableId);
  assert.equal(after.amendments[0].status,'resolved');
});
