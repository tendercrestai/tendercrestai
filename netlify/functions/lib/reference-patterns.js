// Offline reference-catalogue boundary. Not wired into any production engine.
// References can guide organisation; they never establish bidder compliance.
const TYPES=new Set(['proposal_response','technical_submission_documentation','government_guidance','award_list','award_notice','solicitation','evaluation_report','template']);
const REVIEW=new Set(['candidate','approved','rejected']);
const REUSE=new Set(['pending','permitted','restricted']);
const AWARD=new Set(['unverified','verified','not_applicable']);
function fail(message){throw new Error('Reference catalogue: '+message);}
function text(value,max){return typeof value==='string'&&value.trim()&&value.length<=max;}
function url(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash;}catch{return false;}}
function validate(catalogue){
 if(catalogue?.schema!==1||catalogue.market!=='US government IT and consulting'||!Array.isArray(catalogue.records)||catalogue.records.length>1000)fail('invalid manifest');
 const ids=new Set();
 for(const r of catalogue.records){
  if(!text(r.id,100)||!/^[a-z0-9-]+$/.test(r.id)||ids.has(r.id))fail('invalid/duplicate identity');ids.add(r.id);
  if(!text(r.title,300)||!text(r.publisher,300)||!url(r.sourceUrl)||!['US federal','US state/local'].includes(r.jurisdiction)||!['IT','consulting'].includes(r.sector)||!TYPES.has(r.documentType)||!REVIEW.has(r.reviewStatus)||!REUSE.has(r.reuseStatus)||!AWARD.has(r.awardStatus))fail('invalid source metadata');
  if(!Array.isArray(r.supportingUrls)||r.supportingUrls.length>10||r.supportingUrls.some(u=>!url(u)))fail('invalid supporting URLs');
  if(!Array.isArray(r.patterns)||r.patterns.length>20||r.patterns.some(p=>!text(p.id,100)||!text(p.title,200)||!text(p.guidance,2000)||!text(p.locator,300)||!Array.isArray(p.tags)||p.tags.length>20||p.tags.some(t=>!text(t,50))))fail('invalid patterns');
  if(r.reviewStatus==='approved'){
   if(!['offline_pilot','production'].includes(r.approvalScope)||r.reuseStatus!=='permitted'||!url(r.licenceEvidenceUrl)||!text(r.reuseBasis,2000)||!text(r.reviewedBy,100)||!/^\d{4}-\d{2}-\d{2}$/.test(r.reviewedAt||'')||!Number.isFinite(Date.parse(r.reviewedAt))||new Date(r.reviewedAt).toISOString().slice(0,10)!==r.reviewedAt||!/^[a-f0-9]{64}$/.test(r.sha256||''))fail('approved source lacks review/reuse/integrity evidence');
  }
  if(r.awardStatus==='verified'&&(!url(r.awardEvidenceUrl)||!text(r.vendorName,300)||!text(r.procurementId,200)||!text(r.awardRationale,2000)))fail('award verification lacks matching evidence');
 }
 return catalogue;
}
function eligible(r,mode='production'){return r.reviewStatus==='approved'&&r.reuseStatus==='permitted'&&(r.approvalScope==='production'||mode==='offline_pilot'&&r.approvalScope==='offline_pilot')&&['proposal_response','technical_submission_documentation','government_guidance'].includes(r.documentType);}
function winningResponse(r){return eligible(r)&&r.documentType==='proposal_response'&&r.awardStatus==='verified';}
function retrieve(catalogue,{jurisdiction,sector,query,limit=3,excludeProcurementIds=[],mode='production'}){
 validate(catalogue);
 if(!['production','offline_pilot'].includes(mode)||!['US federal','US state/local'].includes(jurisdiction)||!['IT','consulting'].includes(sector)||typeof query!=='string'||!query.trim()||query.length>30000||!Number.isInteger(limit)||limit<1||limit>5||!Array.isArray(excludeProcurementIds)||excludeProcurementIds.some(id=>!text(id,200)))fail('invalid retrieval query');
 const tokens=new Set(query.toLowerCase().match(/[a-z0-9]{3,}/g)||[]);
 const suggestions=[];
 for(const r of catalogue.records){
  if(!eligible(r,mode)||r.jurisdiction!==jurisdiction||r.sector!==sector||excludeProcurementIds.includes(r.procurementId))continue;
  for(const p of r.patterns){
   const tags=new Set(p.tags.flatMap(t=>t.toLowerCase().match(/[a-z0-9]{3,}/g)||[]));const matches=[...tokens].filter(t=>tags.has(t));if(!matches.length)continue;
   suggestions.push({sourceId:r.id,patternId:p.id,title:p.title,guidance:p.guidance,sourceUrl:r.sourceUrl,locator:p.locator,sha256:r.sha256,documentType:r.documentType,approvalScope:r.approvalScope,verifiedWinningResponse:winningResponse(r),matchedTerms:matches,permittedUse:'structure_guidance_only',canSupportCompliance:false,requiresHumanReview:true,untrustedReferenceData:true});
  }
 }
 return suggestions.sort((a,b)=>b.matchedTerms.length-a.matchedTerms.length||a.sourceId.localeCompare(b.sourceId)||a.patternId.localeCompare(b.patternId)).slice(0,limit);
}
module.exports={validate,retrieve,winningResponse};
