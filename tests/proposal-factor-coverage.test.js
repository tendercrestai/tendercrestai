// Evaluation-factor coverage check (PR 3): advisory only. Factors are the
// requirements carrying an evaluation weight or categorised Evaluation.
// A factor is covered when a linked section has drafted response text.
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const core=require('../netlify/functions/lib/proposal-core');
const DOC='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let segN=0;
const source=(section,page,quote)=>({document_id:DOC,document:'Fictional RFP',segment_id:'seg-'+(++segN),page,section,quote});
const reqs=[
 {id:'11111111-1111-4111-8111-111111111111',text:'The vendor must hold current ISO 27001 certification.',mandatory:'Yes',category:'Technical',weight:30,sources:[source('Section L',2,'The vendor must hold current ISO 27001 certification.')]},
 {id:'22222222-2222-4222-8222-222222222222',text:'The vendor must submit a signed certificate of insurance.',mandatory:'Yes',category:'Attachment',weight:null,sources:[source('Section M',3,'The vendor must submit a signed certificate of insurance.')]},
 {id:'33333333-3333-4333-8333-333333333333',text:'Submit the completed pricing form by the deadline.',mandatory:'Yes',category:'Submission',weight:25,sources:[source('Section N',1,'Submit the completed pricing form by the deadline.')]},
 {id:'44444444-4444-4333-8333-444444444444',text:'Proposals must be delivered in triplicate.',mandatory:'Unclear',category:'Submission',weight:null,sources:[source('Section N',1,'Proposals must be delivered in triplicate.')]},
 {id:'55555555-5555-4333-8333-555555555555',text:'The vendor should describe its sustainability program.',mandatory:'No',category:'Technical',weight:null,sources:[source('Section O',4,'The vendor should describe its sustainability program.')]},
 {id:'66666666-6666-4666-8666-666666666666',text:'The vendor must show a delivery approach the buyer can score.',mandatory:'Yes',category:'Evaluation',weight:null,sources:[source('Section P',5,'The vendor must show a delivery approach the buyer can score.')]},
];
const fixtureWorkspace=(list=reqs)=>({analysis:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',fingerprint:'fp',status:'Completed',warnings:[],documents:[{id:DOC,name:'Fictional RFP',segments:list.map(r=>({id:r.sources[0].segment_id,page:r.sources[0].page,section:r.sources[0].section,text:r.sources[0].quote}))}],facts:[]},requirements:list.map(r=>({...r,fingerprint:undefined,original_requirement:r.text,requirement:r.text,evaluation_weight:r.weight??null,uncertain:false,duplicate_count:0}))});
const importedState=(list=reqs)=>core.imported(core.initial('Fictional','Fictional'),fixtureWorkspace(list));
const sectionFor=(s,requirementId)=>s.sections.find(x=>x.requirementIds.includes(requirementId));
const draftedState=()=>{
 const s=importedState();
 sectionFor(s,reqs[0].id).text='We hold current ISO 27001 certification, scope attached.';
 sectionFor(s,reqs[2].id).text='[NEEDS INPUT: pricing form details]';
 return s;
};

test('counts factors by weight or category, and only drafted text covers',()=>{
 const s=draftedState(),fc=core.factorCoverage(s);
 assert.equal(fc.total,3);assert.equal(fc.covered,1);assert.equal(fc.coveragePercent,33);
 assert.deepEqual(fc.uncovered.map(u=>u.requirementId),[reqs[2].id,reqs[5].id]);
 assert.equal(fc.uncovered[0].stableId,s.requirements.find(r=>r.id===reqs[2].id).stableId);
 assert.equal(fc.uncovered[0].evaluationWeight,25);assert.equal(fc.uncovered[0].category,'Submission');
 assert.equal(fc.uncovered[1].evaluationWeight,null);assert.equal(fc.uncovered[1].category,'Evaluation');
 assert.ok(fc.note.includes('Advisory only'));
 assert.ok(!JSON.stringify(fc).match(/trained on winning bids|win-rate|learned from \d+ bids/i));
});

test('placeholder-only text does not cover; drafted words plus a gap marker do',()=>{
 const s=draftedState();
 assert.equal(core.factorCoverage(s).covered,1); // pricing section is placeholder-only
 sectionFor(s,reqs[2].id).text='Pricing form attached. [NEEDS INPUT: final rates]';
 assert.equal(core.factorCoverage(s).covered,2); // drafted words count, the gap marker does not erase them
 assert.equal(core.factorCoverage(s).coveragePercent,67);
 sectionFor(s,reqs[2].id).text='[NEEDS REVIEW: evidence only partial for this requirement]';
 assert.equal(core.factorCoverage(s).covered,1); // a section that is only a placeholder does not cover
 sectionFor(s,reqs[5].id).text='   ';
 assert.equal(core.factorCoverage(s).covered,1); // whitespace is not drafted text
});

test('no factors means a null percentage, never a fabricated 100%',()=>{
 const s=importedState(reqs.filter(r=>r.weight==null&&r.category!=='Evaluation'));
 const fc=core.factorCoverage(s);
 assert.equal(fc.total,0);assert.equal(fc.covered,0);assert.equal(fc.coveragePercent,null);assert.deepEqual(fc.uncovered,[]);
 assert.equal(core.factorCoverage(null).coveragePercent,null);
 assert.equal(core.factorCoverage({}).coveragePercent,null);
});

test('excluded and amendment-removed requirements are not factors',()=>{
 const s=draftedState();
 const iso=s.requirements.find(r=>r.id===reqs[0].id);
 iso.disposition='not applicable';iso.reviewReason='Out of scope for this bid.';iso.reviewedBy='member-a';
 const evalReq=s.requirements.find(r=>r.id===reqs[5].id);
 evalReq.removedByAmendment={amendmentId:'a1',versionNumber:2};
 const fc=core.factorCoverage(s);
 assert.equal(fc.total,1);assert.equal(fc.covered,0);assert.equal(fc.coveragePercent,0);
 assert.deepEqual(fc.uncovered.map(u=>u.requirementId),[reqs[2].id]);
});

test('readinessView carries the coverage; summary lines and blockers are unchanged by it',()=>{
 const before=draftedState();
 const after=JSON.parse(JSON.stringify(before)); // same state, same section ids
 sectionFor(after,reqs[2].id).text='Pricing form attached, rates confirmed.';
 const fcBefore=core.factorCoverage(before),fcAfter=core.factorCoverage(after);
 assert.notEqual(fcBefore.coveragePercent,fcAfter.coveragePercent); // coverage moved 33% -> 67%
 assert.deepEqual(core.readinessView(before).factorCoverage,fcBefore);
 assert.ok(!('factorCoverage' in core.readinessSummary(before)));
 assert.ok(!JSON.stringify(core.readinessSummary(before)).match(/factorCoverage|coveragePercent/i));
 assert.deepEqual(core.readinessSummary(before),core.readinessSummary(after));
 // Drafting text changes the word count, which is not a blocker; the
 // blockers and the ready verdict must be identical.
 assert.deepEqual(core.readiness(before,0).blockers,core.readiness(after,0).blockers);
 assert.equal(core.readiness(before,0).ready,core.readiness(after,0).ready);
 assert.ok(!core.readiness(before,0).blockers.some(b=>/factor|coverage/i.test(b)));
});

test('factorCoverage is exported, pure and does not mutate the state',()=>{
 assert.equal(typeof core.factorCoverage,'function');
 const s=draftedState(),snapshot=JSON.stringify(s);
 const first=core.factorCoverage(s),second=core.factorCoverage(s);
 assert.deepEqual(first,second);
 assert.equal(JSON.stringify(s),snapshot);
});
