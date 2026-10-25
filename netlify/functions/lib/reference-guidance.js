// Read-only project guidance. No generation, evidence approval, credits or provider calls.
const path=require('node:path'),fs=require('node:fs');
const {load}=require('./reference-catalogue'),{retrieve}=require('./reference-patterns'),kb=require('./knowledge-base');
function root(){
 const roots=[path.resolve(process.cwd(),'reference-library'),path.resolve(__dirname,'../../../reference-library')];
 const found=roots.find(p=>fs.existsSync(path.join(p,'production.json')));if(!found)throw Error('Reference library unavailable');return found;
}
function guidance(project,input,{libraryRoot}={}){
 const section=project.state.sections.find(s=>s.id===input.sectionId);if(!section)kb.fail(404,'Saved proposal section unavailable.');
 const requirements=project.state.requirements.filter(r=>section.requirementIds.includes(r.id));if(!requirements.length)kb.fail(409,'Link this section to saved RFP requirements before requesting guidance.');
 const query=requirements.map(r=>r.text).join('\n');if(query.length>30000)kb.fail(413,'This requirement set is too large for reference guidance. Use a smaller section.');
 const catalogue=load(libraryRoot||root(),'production.json');
 if(catalogue.records.some(r=>r.reviewStatus!=='approved'||r.approvalScope!=='production'))throw Error('Reference release contains unapproved sources');
 let suggestions;try{suggestions=retrieve(catalogue,{jurisdiction:input.jurisdiction,sector:input.sector,query,limit:3,mode:'production'});}catch(error){if(error.message.startsWith('Reference catalogue: invalid retrieval query'))kb.fail(400,'Choose a supported reference market and sector.');throw error;}
 return {sectionId:section.id,revision:project.revision,evidenceEpoch:project.evidence_epoch,guidance:suggestions,modelCalled:false,readOnly:true,notice:'Optional structure guidance from public government guidance and historical technical documentation. Not verified winning proposals, buyer requirements or bidder evidence. No draft text, compliance decision or approval has been changed.'};
}
module.exports={guidance};
