const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {validate,retrieve,structureTemplates,winningResponse}=require('../netlify/functions/lib/reference-patterns');
function source(overrides={}){return {id:'fictional-reference',title:'Synthetic reviewed example',sourceUrl:'https://reference.example.invalid/source',supportingUrls:[],publisher:'Fictional publisher',jurisdiction:'US federal',sector:'IT',documentType:'proposal_response',reviewStatus:'approved',approvalScope:'production',reuseStatus:'permitted',licenceEvidenceUrl:'https://reference.example.invalid/licence',reuseBasis:'Synthetic test material only',reviewedBy:'fictional-reviewer',reviewedAt:'2026-10-25',sha256:'a'.repeat(64),awardStatus:'verified',awardEvidenceUrl:'https://reference.example.invalid/award',vendorName:'Fictional vendor',procurementId:'FICTIONAL-001',awardRationale:'Synthetic matching evidence fixture, not a real award',patterns:[{id:'delivery',title:'Delivery structure',guidance:'Describe work packages, acceptance criteria and dependencies using your own evidence.',locator:'Section 2',tags:['delivery','acceptance','milestones']}],...overrides};}
const catalogue=(records=[source()])=>({schema:1,market:'US government IT and consulting',records});
const query={jurisdiction:'US federal',sector:'IT',query:'delivery acceptance milestones'};
test('real catalogue has no production-approved context or verified winning proposal responses',()=>{const real=JSON.parse(fs.readFileSync(path.join(__dirname,'../reference-library/catalogue.json'),'utf8'));validate(real);assert.equal(retrieve(real,query).length,0);assert.ok(real.records.every(r=>!winningResponse(r)));});
test('retrieval returns bounded attributed guidance, never bidder evidence or compliance decisions',()=>{const results=retrieve(catalogue(),query);assert.equal(results.length,1);const r=results[0];assert.equal(r.permittedUse,'structure_guidance_only');assert.equal(r.canSupportCompliance,false);assert.equal(r.requiresHumanReview,true);assert.equal(r.untrustedReferenceData,true);assert.equal(r.sourceId,'fictional-reference');assert.ok(r.locator);assert.equal(r.verifiedWinningResponse,true);assert.ok(!('vendorName' in r));});
test('missing reuse, review, identity or award linkage blocks approval',()=>{for(const change of [{reuseStatus:'pending'},{reviewedBy:''},{sha256:''},{awardEvidenceUrl:''},{reviewedAt:'2026-02-30'}])assert.throws(()=>validate(catalogue([source(change)])),/Reference catalogue/);assert.throws(()=>validate(catalogue([source(),source()])),/duplicate/);});
test('award notices and prototype documentation are never labelled full winning proposal responses',()=>{for(const type of ['award_notice','award_list','technical_submission_documentation','government_guidance','solicitation','template']){const r=source({documentType:type});assert.equal(winningResponse(r),false);if(['award_notice','award_list','solicitation','template'].includes(type))assert.equal(retrieve(catalogue([r]),query).length,0);}});
test('market mismatch, absent match and same-procurement holdout exclusions produce no guidance',()=>{for(const q of [{...query,sector:'consulting'},{...query,jurisdiction:'US state/local'},{...query,query:'unrelated astronomy'},{...query,excludeProcurementIds:['FICTIONAL-001']}])assert.equal(retrieve(catalogue(),q).length,0);});
test('unreviewed or rejected sources and unsafe source URLs cannot enter retrieval',()=>{assert.equal(retrieve(catalogue([source({reviewStatus:'candidate',reuseStatus:'pending'})]),query).length,0);assert.equal(retrieve(catalogue([source({reviewStatus:'rejected'})]),query).length,0);for(const url of ['javascript:alert(1)','https://user:secret@example.invalid/source'])assert.throws(()=>validate(catalogue([source({sourceUrl:url})])),/metadata/);});
test('offline-reviewed patterns require explicit offline mode and never silently enter production',()=>{
 const c=catalogue([source({approvalScope:'offline_pilot',documentType:'government_guidance',awardStatus:'not_applicable'})]);assert.equal(retrieve(c,query).length,0);
 const result=retrieve(c,{...query,mode:'offline_pilot'});assert.equal(result.length,1);assert.equal(result[0].approvalScope,'offline_pilot');assert.equal(result[0].verifiedWinningResponse,false);
 assert.throws(()=>retrieve(c,{...query,mode:'anything'}),/invalid retrieval query/);
});
test('structureTemplates returns only structure-template patterns, in offline mode, with the same bounds and holdout',()=>{
 const templ=source({id:'template-source',approvalScope:'offline_pilot',procurementId:'P1',patterns:[{id:'template-1',title:'Template',guidance:'Structure only',locator:'Sections',tags:['structure-template','structure','sections'],groups:[{label:'Discovery',keywords:['discovery','research']}]},{id:'non-template',title:'Guidance',guidance:'Guidance only',locator:'Notes',tags:['structure','guidance']}]});
 const c=catalogue([templ]);
 assert.equal(structureTemplates(c,{jurisdiction:'US federal',sector:'IT'}).length,0);
 const result=structureTemplates(c,{jurisdiction:'US federal',sector:'IT',mode:'offline_pilot'});
 assert.equal(result.length,1);assert.equal(result[0].patternId,'template-1');assert.equal(result[0].isStructureTemplate,true);assert.equal(result[0].groups.length,1);assert.equal(result[0].groups[0].label,'Discovery');assert.equal(result[0].canSupportCompliance,false);assert.equal(result[0].requiresHumanReview,true);
 assert.equal(structureTemplates(c,{jurisdiction:'US state/local',sector:'IT',mode:'offline_pilot'}).length,0);
 assert.equal(structureTemplates(c,{jurisdiction:'US federal',sector:'consulting',mode:'offline_pilot'}).length,0);
 assert.equal(structureTemplates(c,{jurisdiction:'US federal',sector:'IT',mode:'offline_pilot',excludeProcurementIds:['P1']}).length,0);
 assert.throws(()=>structureTemplates(c,{jurisdiction:'US federal',sector:'IT',mode:'offline_pilot',limit:6}),/invalid structure template query/);
 assert.throws(()=>structureTemplates(c,{jurisdiction:'US federal',sector:'IT',mode:'offline_pilot',limit:0}),/invalid structure template query/);
 assert.throws(()=>structureTemplates(c,{jurisdiction:'EU',sector:'IT',mode:'offline_pilot'}),/invalid structure template query/);
});
test('structureTemplates rejects a template pattern whose groups are malformed',()=>{
 const bad=source({approvalScope:'offline_pilot',patterns:[{id:'template-bad',title:'Bad',guidance:'Bad groups',locator:'Sections',tags:['structure-template'],groups:[{label:'Too many keywords',keywords:['a','b','c','d','e','f','g','h','i','j','k','l','m','n','o','p','q','r','s','t','u']}]}]});
 assert.throws(()=>structureTemplates(catalogue([bad]),{jurisdiction:'US federal',sector:'IT',mode:'offline_pilot'}),/pattern groups are invalid/);
});
test('real catalogue templates: TeraLogics for federal IT and Cisco for state/local IT, never in production, holdout removes each',()=>{
 const {load}=require('../netlify/functions/lib/reference-catalogue');
 const c=load(path.join(__dirname,'../reference-library'));
 const federal=structureTemplates(c,{jurisdiction:'US federal',sector:'IT',mode:'offline_pilot'});
 assert.equal(federal.length,1);assert.equal(federal[0].sourceId,'teralogics-agile-bpa-documentation');assert.equal(federal[0].groups.length,5);assert.equal(federal[0].awardStatus,'unverified');assert.equal(federal[0].verifiedWinningResponse,false);
 const state=structureTemplates(c,{jurisdiction:'US state/local',sector:'IT',mode:'offline_pilot'});
 assert.equal(state.length,1);assert.equal(state[0].sourceId,'cisco-jp14001-response');assert.equal(state[0].groups.length,5);assert.equal(state[0].awardStatus,'verified');assert.equal(state[0].verifiedWinningResponse,false);
 assert.equal(structureTemplates(c,{jurisdiction:'US federal',sector:'IT'}).length,0);
 assert.equal(structureTemplates(c,{jurisdiction:'US state/local',sector:'IT'}).length,0);
 assert.equal(structureTemplates(c,{jurisdiction:'US federal',sector:'IT',mode:'offline_pilot',excludeProcurementIds:['4QTFHS150004']}).length,0);
 assert.equal(structureTemplates(c,{jurisdiction:'US state/local',sector:'IT',mode:'offline_pilot',excludeProcurementIds:['JP14001']}).length,0);
 assert.ok(c.records.filter(r=>r.reviewStatus==='approved').every(r=>!r.patterns.some(p=>/trained on winning bids|win-rate|learned from \d+ bids/i.test(p.title+' '+p.guidance))));
});
