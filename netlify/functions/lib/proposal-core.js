// Pure, deterministic evidence/decision logic shared by API, jobs and tests.
const {createHash,randomUUID}=require('node:crypto');
const kb=require('./knowledge-base');
const clone=value=>structuredClone(value);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text=(value,max=5000,empty=false)=>{if(typeof value!=='string'||value.length>max||(!empty&&!value.trim())||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))kb.fail(400,'Text is missing or exceeds the supported length.');return value.trim();};
function date(value){if(!value)return null;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000')||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)kb.fail(400,'Use an explicit valid YYYY-MM-DD date.');return value;}
// --- Requirement-to-evidence traceability (Capability 1) ---
// Stable IDs are content-anchored, not document-anchored: source document IDs
// are per-upload UUIDs and do not survive a re-upload, while the extraction
// fingerprint (sha256 of the normalized requirement wording) does. The same
// wording therefore keeps the same stable ID across revisions, amendments and
// re-uploads; the persistent per-project uuid mapping in imported() additionally
// preserves internal identity when wording is edited. Source-document identity
// is preserved separately in the source-reference column of every export.
const COVERAGES=['not-assessed','supported','partially-supported','missing-evidence'];
const TRACE_HISTORY_LIMIT=50,TRACE_EXCERPT_LIMIT=1000;
const contentFingerprint=text=>createHash('sha256').update(String(text||'').replace(/\s+/g,' ').trim().toLowerCase()).digest('hex');
function stableRequirementId(r){const fp=(r&&r.fingerprint)||contentFingerprint((r&&(r.originalText||r.text||r.requirement))||'');return 'REQ-'+String(fp).slice(0,12).toUpperCase();}
function defaultTrace(){return {coverage:'not-assessed',coverageSource:null,explanation:'',reviewedBy:null,reviewedAt:null,reviewedRequirementRevision:null,reviewedEvidenceEpoch:null,reviewedResponseRevision:null,needsReconfirmation:false,responseApproval:{status:'not-approved',reviewedBy:null,reviewedAt:null,reviewedRequirementRevision:null,reviewedEvidenceEpoch:null,reviewedResponseRevision:null,responseHash:null},history:[]};}
function ensureTrace(r){if(!r)return defaultTrace();if(!r.trace||typeof r.trace!=='object')r.trace=defaultTrace();if(!r.trace.responseApproval||typeof r.trace.responseApproval!=='object')r.trace.responseApproval=defaultTrace().responseApproval;if(!Array.isArray(r.trace.history))r.trace.history=[];if(!r.stableId)r.stableId=stableRequirementId(r);return r.trace;}
function traceHistoryPush(trace,entry){trace.history=[...trace.history.slice(-(TRACE_HISTORY_LIMIT-1)),{...entry,at:new Date().toISOString()}];}
function responseSections(s,requirementId){return s.sections.filter(x=>x.requirementIds.includes(requirementId));}
function responseHash(s,requirementId){return hash(responseSections(s,requirementId).map(x=>x.text).join('\n\n'));}
function responseRevision(s,requirementId){const sections=responseSections(s,requirementId);return sections.length?Math.max(...sections.map(x=>x.revision)):null;}
// AI-suggested coverage reuses existing extraction/match results only: a matched
// candidate is never claimed as full support. No model call is made here; the
// suggestion is cached in state (computed only when evidence is linked or
// rematched, never on read) and a human must confirm or change it.
function suggestCoverage(mappings){return mappings.length?'partially-supported':'missing-evidence';}
function invalidateResponseApproval(s,requirementId,actor,reason,force=false){const r=s.requirements.find(x=>x.id===requirementId);if(!r)return;const t=ensureTrace(r);if(t.responseApproval.status!=='approved')return;if(!force&&t.responseApproval.responseHash&&t.responseApproval.responseHash===responseHash(s,requirementId))return;const prior={...t.responseApproval};t.responseApproval={...t.responseApproval,status:'needs-reconfirmation'};traceHistoryPush(t,{action:'response-invalidated',actor,reason,requirementRevision:r.revision,responseRevision:responseRevision(s,requirementId),priorStatus:prior.status});}
function markCoverageReconfirmation(s,requirementId,actor,reason){const r=s.requirements.find(x=>x.id===requirementId);if(!r)return;const t=ensureTrace(r);if(t.coverageSource!=='human-confirmed'||t.needsReconfirmation)return;t.needsReconfirmation=true;traceHistoryPush(t,{action:'coverage-needs-reconfirmation',actor,reason,requirementRevision:r.revision});}
function evidenceSuggested(s,requirementId,actor){const r=s.requirements.find(x=>x.id===requirementId);if(!r)return;const t=ensureTrace(r);const mappings=s.evidence.filter(e=>e.requirementId===requirementId&&e.decision!=='rejected');if(t.coverageSource!=='human-confirmed'){t.coverage=suggestCoverage(mappings);t.coverageSource='ai-suggested';t.explanation='';t.reviewedBy=null;t.reviewedAt=null;}else markCoverageReconfirmation(s,requirementId,actor,'Linked evidence changed after human coverage confirmation.');invalidateResponseApproval(s,requirementId,actor,'Linked evidence changed after response approval.',true);traceHistoryPush(t,{action:'evidence-suggested',actor,coverage:t.coverage,coverageSource:t.coverageSource,requirementRevision:r.revision});}
function traceSummary(s,epoch){return s.requirements.map(r=>{const t=ensureTrace(r);const evidence=s.evidence.filter(e=>e.requirementId===r.id).map(e=>({id:e.id,answerId:e.answerId,revision:e.revision,excerpt:String(e.text||'').slice(0,200),decision:e.decision,stale:!!e.stale}));const unresolved=!excluded(r)&&(t.coverage!=='supported'||t.responseApproval.status!=='approved');return {requirementId:r.id,stableId:r.stableId||stableRequirementId(r),text:r.text,category:r.category,mandatory:r.mandatory,coverage:t.coverage,coverageSource:t.coverageSource,needsReconfirmation:!!t.needsReconfirmation,reviewStatus:t.coverageSource?(t.needsReconfirmation?'needs-reconfirmation':'current'):'not-assessed',responseApproval:t.responseApproval.status,responseReviewedBy:t.responseApproval.reviewedBy,responseReviewedAt:t.responseApproval.reviewedAt,evidence,sources:r.sources||[],unresolved};});}
function unresolvedItems(s){return traceSummary(s).filter(x=>x.unresolved).map(x=>({stableId:x.stableId,requirementId:x.requirementId,text:x.text,coverage:x.coverage,coverageSource:x.coverageSource,responseApproval:x.responseApproval,reasons:[...(x.coverage!=='supported'?['Evidence coverage is '+x.coverage]:[]),...(x.responseApproval!=='approved'?['Response approval is '+x.responseApproval]:[])]}));}
// --- Submission readiness (Capability 2) ---
// Readiness is a checklist derived from the extracted requirements already in
// state (Capability 1 trace data). No second extraction pass runs. Mandatory
// status is a property of the requirement (from extraction, correctable); task
// status is the checklist state — the two are stored and shown separately
// everywhere, including filters and the report. Readiness covers only the
// supplied and successfully processed materials; it never labels a proposal
// "certified compliant" or "guaranteed ready" and never assigns a win
// probability. All readiness state lives in pw_projects.state.readiness
// (JSONB), so the view works before any migration; pw_events (via commit)
// is the activity history. No migration is needed for this capability.
const READINESS_STATUSES=['not-started','in-progress','needs-review','done','not-applicable'];
const READINESS_KINDS=['requirement','document','form','instruction','other'];
const READINESS_MANUAL_LIMIT=200;
const READINESS_SCOPE_NOTE='Readiness covers only the supplied and successfully processed materials. It does not certify compliance and does not guarantee readiness.';
function readinessState(s){const r=(s&&s.readiness&&typeof s.readiness==='object'&&!Array.isArray(s.readiness))?s.readiness:{};return {items:(r.items&&typeof r.items==='object'&&!Array.isArray(r.items))?r.items:{},corrections:(r.corrections&&typeof r.corrections==='object'&&!Array.isArray(r.corrections))?r.corrections:{},manual:Array.isArray(r.manual)?r.manual:[]};}
function readinessKindFor(r){if(r.category==='Attachment')return 'document';if(r.category==='Submission')return /\bform\b/i.test(r.text||'')?'form':'instruction';return 'requirement';}
function readinessSources(r){return (r.sources||[]).map(src=>({document:src.document||src.document_name||'Source unavailable',section:src.section||null,page:src.page??null,quote:src.quote||''}));}
function readinessItemUnresolved(i){return i.status!=='done'&&i.status!=='not-applicable';}
function readinessItems(s){
 const rd=readinessState(s),items=[];
 for(const r of s.requirements||[]){
  if(excluded(r))continue; // explicitly out of scope: not readiness work
  const t=ensureTrace(r),sid=r.stableId||stableRequirementId(r),corr=rd.corrections[sid]||{};
  const view={text:corr.text||r.text,category:corr.category||r.category,mandatory:corr.mandatory||r.mandatory};
  const override=rd.items['readiness:'+sid]||{};
  const coverage=t.coverage||'not-assessed';
  items.push({id:'readiness:'+sid,stableId:sid,requirementId:r.id,kind:readinessKindFor(view),category:view.category,title:view.text,mandatory:view.mandatory,sourceReferences:readinessSources(r),manual:false,corrected:Object.keys(corr).length>0,correctionNote:corr.note||null,status:override.status||'not-started',owner:override.owner||null,dueAt:override.dueAt||null,naReason:override.naReason||null,evidenceGap:coverage==='missing-evidence'||coverage==='not-assessed',responseReviewPending:t.responseApproval.status!=='approved',coverage,coverageSource:t.coverageSource||null,responseApproval:t.responseApproval.status});
 }
 for(const m of rd.manual)items.push({...m,stableId:null,requirementId:null,manual:true,corrected:false,correctionNote:null,sourceReferences:[{document:m.source||'Manual addition — no extracted source.',section:null,page:null,quote:''}],evidenceGap:false,responseReviewPending:false,coverage:null,coverageSource:null,responseApproval:null});
 return items;
}
function readinessSummary(s){
 const items=readinessItems(s),unresolved=items.filter(readinessItemUnresolved);
 const plural=(n,one,many)=>n+' '+ (n===1?one:many);
 const summary={total:items.length,unresolved:unresolved.length,done:items.filter(i=>i.status==='done').length,notApplicable:items.filter(i=>i.status==='not-applicable').length,
  mandatoryUnresolved:unresolved.filter(i=>i.mandatory!=='No').length,
  documentsMissing:unresolved.filter(i=>i.kind==='document'||i.kind==='form').length,
  responsesAwaitingApproval:unresolved.filter(i=>i.responseReviewPending).length,
  evidenceGaps:unresolved.filter(i=>i.evidenceGap).length,byOwner:{}};
 for(const i of unresolved){const k=i.owner||'unassigned';summary.byOwner[k]=(summary.byOwner[k]||0)+1;}
 summary.lines=[plural(summary.mandatoryUnresolved,'mandatory item unresolved','mandatory items unresolved')+'.',plural(summary.documentsMissing,'required document missing','required documents missing')+'.',plural(summary.responsesAwaitingApproval,'response awaiting approval','responses awaiting approval')+'.',plural(summary.evidenceGaps,'evidence gap','evidence gaps')+'.'];
 return summary;
}
function readinessView(s){return {items:readinessItems(s),summary:readinessSummary(s),scopeNote:READINESS_SCOPE_NOTE};}
function initial(title,company){return {schema:1,title:text(title,200),company:{name:text(company||title,200),accent:'#1d4ed8'},requirements:[],sections:[],evidence:[],comments:[],facts:[],bidInputs:{},weights:{experience:25,certifications:25,capacity:20,timeline:15,strategy:15},decision:null,assessment:null,finalApproval:null,reviewedEpoch:0,sourceWarnings:[],analysis:null,attachments:[],archivedResponses:[],readiness:{items:{},corrections:{},manual:[]}};}function excluded(r){return ['not applicable','extraction error'].includes(r.disposition)&&!!r.reviewReason&&!!r.reviewedBy;}
function procedural(r){return ['Submission','Attachment','Evaluation'].includes(r.category)&&!/\b(?:certif|licen[cs]|experience|insurance|revenue|employee|eligib|accredit|clearance)/i.test(r.text);}
function invalidateRequirement(r,reason){if(!r||excluded(r))return;if(r.status!=='Needs Review')r.previousCompliance={status:r.status,reason:r.reviewReason,reviewedBy:r.reviewedBy};r.status='Needs Review';r.support='needs review';r.reviewReason=reason;}
function expired(e){return e.expired||e.metadataUnavailable||(e.citations||[]).some(c=>c.metadata&&Object.keys(c.metadata).length&&(c.metadata.status!=='approved'||c.metadata.expiresAt&&c.metadata.expiresAt<new Date().toISOString().slice(0,10)))||(e.facts||[]).some(f=>f.key==='explicit.expiry'&&f.value<new Date().toISOString().slice(0,10));}
function activeEvidence(s,requirementId){return s.evidence.filter(e=>e.requirementId===requirementId&&e.decision==='accepted'&&!e.stale&&!expired(e)&&(!e.conflicts?.length||!!e.conflictResolution));}
function refresh(s,epoch){
 s=clone(s);for(const e of s.evidence){if(expired(e)&&!e.expired){e.expired=true;invalidateRequirement(s.requirements.find(r=>r.id===e.requirementId),'Evidence has an explicitly expired date. Review current support.');invalidateResponseApproval(s,e.requirementId,null,'Linked evidence expired after response approval.',true);markCoverageReconfirmation(s,e.requirementId,null,'Linked evidence expired after human coverage confirmation.');s.finalApproval=null;for(const section of s.sections.filter(x=>x.requirementIds.includes(e.requirementId)))section.status='changes requested';if(s.assessment)s.assessment.stale=true;if(s.decision)s.decision.stale=true;}}if(s.reviewedEpoch!==epoch){s.finalApproval=null;for(const e of s.evidence)e.stale=true;for(const r of s.requirements){invalidateRequirement(r,'Relevant company evidence changed; review the prior compliance decision.');markCoverageReconfirmation(s,r.id,null,'Company evidence changed after human coverage confirmation.');invalidateResponseApproval(s,r.id,null,'Company evidence changed after response approval.',true);}for(const section of s.sections){section.status='changes requested';section.reviewReason='Evidence changed; rematch sources and review this revision.';}if(s.assessment)s.assessment.stale=true;if(s.decision)s.decision.stale=true;}
 return s;
}
function candidateFlags(e,all,today=new Date().toISOString().slice(0,10)){
 const facts=[];const source=[{text:e.text,ref:'answer'},...(e.citations||[]).map(c=>({text:c.quote,ref:c.id}))];
 for(const item of source){
  for(const m of item.text.matchAll(/\b(?:expires?|expiry(?: date)?|valid until)\s*[:\-]?\s*(\d{4}-\d{2}-\d{2})\b/gi)){try{date(m[1]);facts.push({key:'explicit.expiry',value:m[1],quote:m[0],reference:item.ref});}catch{/* Invalid source date remains uncertain, never inferred. */}}
  for(const m of item.text.matchAll(/\b(employee count|staff count|annual revenue|years of experience)\s*:\s*([A-Z]{3}\s*)?([0-9][0-9,.]*)/gi))facts.push({key:m[1].toLowerCase(),value:(m[2]||'')+m[3],quote:m[0],reference:item.ref});
 }
 const conflicts=[];for(const f of facts.filter(f=>f.key!=='explicit.expiry'))if(facts.some(other=>other.key===f.key&&other.value!==f.value)&&!conflicts.some(c=>c.answerId===e.answerId&&c.key===f.key))conflicts.push({answerId:e.answerId,key:f.key,reason:'Possible contradictory facts within this answer or its cited excerpts; verify the reporting period and scope.'});for(const f of facts.filter(f=>f.key!=='explicit.expiry'))for(const other of all){if(other.answerId===e.answerId)continue;const re=new RegExp(f.key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*:\\s*([A-Z]{3}\\s*)?([0-9][0-9,.]*)','i');const found=(other.text+' '+(other.citations||[]).map(c=>c.quote).join(' ')).match(re);if(found&&((found[1]||'')+found[2])!==f.value)conflicts.push({answerId:other.answerId,key:f.key,reason:'Possible contradictory facts; verify the reporting period and scope.'});}
 return {...e,facts,expired:facts.some(f=>f.key==='explicit.expiry'&&f.value<today),conflicts};
}
function imported(s,workspace,amendment=false){
 s=clone(s);if(s.requirements.length&&!amendment)kb.fail(409,'Use Import amendment to replace the reviewed RFP snapshot.');
 if(!['Completed','Partial'].includes(workspace.analysis.status)||!workspace.requirements.length||workspace.requirements.length>500)kb.fail(400,'Complete a nonempty analysis with at most 500 requirements.');
 const previousAnalysisId=s.analysis?.id||null;const previousRequirements=clone(s.requirements),previousSections=clone(s.sections),old=new Map(s.requirements.map(r=>[r.id,r]));const normalized=t=>t.replace(/\s+/g,' ').trim().toLowerCase();const prior=r=>old.get(r.id)||((previousRequirements.filter(x=>normalized(x.text)===normalized(r.requirement)).length===1)&&previousRequirements.find(x=>normalized(x.text)===normalized(r.requirement)))||null;
 s.requirements=workspace.requirements.map(r=>({id:prior(r)?.id||r.id,stableId:prior(r)?.stableId||stableRequirementId(r),analysisRequirementId:r.id,fingerprint:r.fingerprint,originalText:r.original_requirement||r.requirement,revision:prior(r)&&amendment?(prior(r).revision??0)+1:(r.revision??0),text:r.requirement,mandatory:r.mandatory,category:r.category,evaluationWeight:r.evaluation_weight||null,sources:r.sources,status:'Needs Review',reviewReason:'',support:'needs review',trace:prior(r)&&amendment?ensureTrace(prior(r)):defaultTrace(),authorId:prior(r)?.authorId||null,reviewerId:prior(r)?.reviewerId||null,dueAt:prior(r)?.dueAt||null}));
 if(amendment)for(const r of s.requirements){const prev=previousRequirements.find(x=>x.id===r.id);if(prev&&prev.text!==r.text){const t=ensureTrace(r);t.needsReconfirmation=true;if(t.responseApproval.status==='approved')t.responseApproval.status='needs-reconfirmation';traceHistoryPush(t,{action:'requirement-amended',actor:null,reason:'Requirement wording changed in an amendment; prior review needs reconfirmation.',requirementRevision:r.revision});}}
 s.analysis={id:workspace.analysis.id,fingerprint:workspace.analysis.fingerprint,status:workspace.analysis.status,documents:workspace.analysis.documents.map(({segments,...d})=>d),facts:workspace.analysis.facts};s.sourceWarnings=[...workspace.analysis.warnings,...(workspace.analysis.status==='Partial'?['RFP analysis has extraction gaps; review the originals.']:[])];
 s.sections=s.requirements.map((r,i)=>({id:old.has(r.id)&&s.sections.find(x=>x.requirementIds.includes(r.id))?.id||randomUUID(),title:`${i+1}. ${r.text.slice(0,100)}`,requirementIds:[r.id],text:s.sections.find(x=>x.requirementIds.includes(r.id))?.text||'',revision:(s.sections.find(x=>x.requirementIds.includes(r.id))?.revision??-1)+1,status:'draft',claims:[],unverified:true,authorId:r.authorId,reviewerId:r.reviewerId,dueAt:r.dueAt,reviewReason:'Source requirements imported or amended.'}));
 const retained=previousSections.filter(section=>!section.requirementIds.some(id=>s.requirements.some(r=>r.id===id)));if(amendment&&retained.length)s.archivedResponses=[...(s.archivedResponses||[]).slice(-4),{analysisId:previousAnalysisId,archivedAt:new Date().toISOString(),sections:retained,requirements:previousRequirements.filter(r=>retained.some(x=>x.requirementIds.includes(r.id)))}];
 s.evidence=[];s.finalApproval=null;s.assessment=null;s.decision=null;return s;
}
function draftSection(s,sectionId){
 const section=s.sections.find(x=>x.id===sectionId);if(!section)kb.fail(404,'Section not found.');const claims=[],parts=[],gaps=[];
 for(const id of section.requirementIds){const r=s.requirements.find(x=>x.id===id);if(excluded(r)){parts.push('Requirement '+id+' was explicitly excluded from scope by an authorized reviewer.');continue;}const evidence=activeEvidence(s,id);if(procedural(r)){parts.push('[NEEDS INPUT: describe how this submission instruction is satisfied: '+r.text+']');gaps.push(id);continue;}if(!evidence.length){const gap=`[NEEDS INPUT: approved, current evidence for requirement ${id}]`;parts.push(gap);gaps.push(id);continue;}
  for(const e of evidence){parts.push(e.text);claims.push({text:e.text,answerId:e.answerId,answerRevision:e.revision,requirementId:id,citations:e.citations});}
  if(r.support!=='supported'){parts.push(`[NEEDS REVIEW: evidence only ${r.support} for requirement ${id}]`);gaps.push(id);}
 }
 if(parts.join('\n\n').length>60000)return {sectionId,baseRevision:section.revision,text:'[NEEDS INPUT: selected evidence exceeds the section length limit. Select fewer accepted answers.]',claims:[],gaps:section.requirementIds,method:'approved-evidence assembly'};
 return {sectionId,baseRevision:section.revision,text:parts.join('\n\n'),claims,gaps,method:'approved-evidence assembly',generatedAt:new Date().toISOString()};
}
function words(s){return (s.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)||[]).length;}
function contentHash(s){return hash({company:s.company,requirements:s.requirements,sections:s.sections.map(({id,title,text,claims,requirementIds})=>({id,title,text,claims,requirementIds})),evidence:s.evidence,attachments:s.attachments});}
function explicitLimits(s){const limits=[];for(const r of s.requirements){for(const source of r.sources||[]){for(const m of source.quote.matchAll(/\b(?:maximum(?: of)?|no more than|not exceed|limited to)\s+(\d{1,5})\s+(words?|pages?)\b/gi))limits.push({requirementId:r.id,kind:m[2].toLowerCase().startsWith('word')?'words':'pages',limit:Number(m[1]),source,documentScope:/\b(?:entire|total|complete)\s+(?:proposal|response)|\bproposal\s+(?:must|shall|may)\b/i.test(source.quote)});}}return limits;}
function readiness(s,epoch,rendered){
 const blockers=[];if(!s.requirements.length)blockers.push('Import and review the RFP requirements.');if(s.reviewedEpoch!==epoch)blockers.push('Company evidence changed; rematch evidence and review the affected content.');
 if(s.warningReview?.fingerprint!==hash(s.sourceWarnings))for(const warning of s.sourceWarnings)blockers.push('Extraction review: '+warning);
 for(const r of s.requirements){if(excluded(r))continue;if(r.mandatory!=='No'&&(r.status!=='Compliant'||r.support!=='supported'||(!procedural(r)&&!activeEvidence(s,r.id).length)))blockers.push('Mandatory/unclear requirement needs verified evidence and compliance review: '+r.id);if(r.category==='Attachment'&&r.mandatory!=='No'&&!s.attachments.some(a=>a.requirementIds.includes(r.id)))blockers.push('Required attachment missing: '+r.id);}
 for(const section of s.sections){if(section.claims.some(c=>!activeEvidence(s,c.requirementId).some(e=>e.answerId===c.answerId&&e.revision===c.answerRevision)))blockers.push('Generated claim references evidence that is no longer accepted: '+section.id);if(!section.text.trim()||section.unverified||/\[NEEDS (?:INPUT|REVIEW)/.test(section.text)||section.status!=='approved')blockers.push('Section needs content or revision approval: '+section.id);}
 const wc=words(s.sections.map(x=>x.text).join('\n'));
 for(const limit of explicitLimits(s)){
  if(limit.kind==='words'){const count=limit.documentScope?wc:words(s.sections.filter(x=>x.requirementIds.includes(limit.requirementId)).map(x=>x.text).join('\n'));if(count>limit.limit)blockers.push(`Explicit word limit exceeded for ${limit.requirementId}: ${count}/${limit.limit}`);}
  else if(!limit.documentScope)blockers.push('Section page-limit scope needs manual confirmation: '+limit.requirementId);
  else if(!rendered||rendered.contentHash!==contentHash(s)||rendered.evidenceEpoch!==epoch)blockers.push('Render the saved proposal to measure PDF pages: '+limit.requirementId);
  else if(rendered.pages>limit.limit)blockers.push(`Rendered PDF page limit exceeded: ${rendered.pages}/${limit.limit}`);
 }
 if(s.assessment?.stale)blockers.push('Bid assessment is stale.');return {ready:blockers.length===0,blockers:[...new Set(blockers)],wordCount:wc,pageCount:rendered?.contentHash===contentHash(s)?rendered.pages:null,pageCountScope:'Rendered PDF only; DOCX pagination is not measured.'};
}
function assessment(s,epoch){
 const factors=[];let numerator=0,denominator=0,known=0;for(const key of Object.keys(s.weights)){const w=s.weights[key];if(!Number.isInteger(w)||w<0||w>100)kb.fail(400,'Weights must be whole numbers from 0 to 100.');denominator+=w;let input=s.bidInputs[key]||{value:'unknown',reason:'No verified input supplied.'};if(input.sources?.some(id=>!s.evidence.some(e=>e.id===id&&e.decision==='accepted'&&!e.stale&&!expired(e)&&(!e.conflicts?.length||!!e.conflictResolution))))input={value:'unknown',reason:'Referenced evidence changed or is no longer eligible.'};if(['yes','partial'].includes(input.value)&&!input.sources?.length&&!input.explicitInput)input={value:'unknown',reason:'Supply eligible evidence or explicitly record this as a human input.'};if(!['yes','partial','no','unknown'].includes(input.value))kb.fail(400,'Invalid bid factor.');const score={yes:100,partial:50,no:0,unknown:0}[input.value];numerator+=w*score;if(input.value!=='unknown')known+=w;factors.push({key,weight:w,value:input.value,score,reason:input.reason||'No rationale supplied.',sources:input.sources||[],assumption:input.assumption===true});}
 if(!denominator)kb.fail(400,'At least one factor weight must be positive.');const hard=s.requirements.filter(r=>!excluded(r)&&r.mandatory==='Yes'&&r.status==='Non-Compliant').map(r=>({requirementId:r.id,reason:r.reviewReason,sources:r.sources}));const unknown=s.requirements.filter(r=>!excluded(r)&&r.mandatory!=='No'&&(r.status!=='Compliant'||r.support!=='supported'||(!procedural(r)&&!activeEvidence(s,r.id).length))).map(r=>r.id);const score=Math.floor(numerator/denominator);const result={recommendation:hard.length?'pass':unknown.length||known<denominator?'review':score>=70?'pursue':score<40?'pass':'review',fitScore:score,knownWeightPercent:Math.floor(100*known/denominator),hardDisqualifiers:hard,unknownRequirements:unknown,factors,nextActions:[...(hard.length?['Resolve explicit eligibility blockers before pursuing.']:[]),...(unknown.length?['Supply evidence and review the listed mandatory requirements.']:[]),...(known<denominator?['Complete unknown fit factors; unknown values contribute zero to the total.']:[])],rulesVersion:'fit-v1',evidenceEpoch:epoch,contentHash:contentHash(s),stale:false,notWinProbability:true};return {...result,inputHash:hash({requirements:s.requirements,evidence:s.evidence,inputs:s.bidInputs,weights:s.weights,rulesVersion:result.rulesVersion})};
}
function apply(s,action,p,user,{reviewer=false,members=[],evidenceEpoch=null}={}){
 s=clone(s);const beforeSectionText=new Map(s.sections.map(x=>[x.id,x.text]));const findSection=()=>{const x=s.sections.find(x=>x.id===p.sectionId);if(!x)kb.fail(404,'Section not found.');return x;};
 const requireReviewer=()=>{if(!reviewer)kb.fail(403,'An authorized reviewer is required.');};
 if(action==='saveSection'){const section=findSection();if(section.revision!==p.sectionRevision)kb.fail(409,'Section changed; reload before saving.');section.text=text(p.text,60000,true);section.revision++;section.status='draft';section.unverified=true;section.claims=[];section.editedBy=user;section.reviewReason='Manual text needs evidence verification.';}
 else if(action==='acceptDraft'){const section=findSection(),d=p.preview;if(section.revision!==d.baseRevision)kb.fail(409,'Section changed since generation.');section.text=text(d.text,60000,true);section.claims=d.claims;section.unverified=d.gaps.length>0;section.revision++;section.status='draft';section.editedBy=user;}
 else if(action==='requestReview'){const section=findSection();if(!section.text.trim())kb.fail(400,'Write or accept a draft first.');section.status='in review';}
 else if(action==='reviewSection'){
  requireReviewer();const section=findSection();if(section.revision!==p.sectionRevision)kb.fail(409,'Section changed; reload.');if(section.reviewerId&&section.reviewerId!==user)kb.fail(403,'The assigned reviewer must decide this revision.');const reason=text(p.reason,3000);if(!['approved','changes requested'].includes(p.status))kb.fail(400,'Invalid review state.');
  if(p.status==='approved'){
   if(p.confirmEvidence!==true||!section.text.trim()||/\[NEEDS (?:INPUT|REVIEW)/.test(section.text))kb.fail(400,'Resolve placeholders and confirm factual evidence before approval.');
   if(section.requirementIds.some(id=>!excluded(s.requirements.find(r=>r.id===id))&&!procedural(s.requirements.find(r=>r.id===id))&&!activeEvidence(s,id).length))kb.fail(400,'Current, accepted evidence is required for every linked requirement.');
   if(section.claims.some(c=>!activeEvidence(s,c.requirementId).some(e=>e.answerId===c.answerId&&e.revision===c.answerRevision)))kb.fail(409,'Generated claims have outdated evidence mappings. Regenerate or edit and verify the text.');section.unverified=false;
  }section.status=p.status;section.reviewReason=reason;section.reviewedBy=user;section.reviewedRevision=section.revision;
 }
 else if(action==='reviewEvidence'){
  requireReviewer();const e=s.evidence.find(x=>x.id===p.evidenceId);if(!e)kb.fail(404,'Evidence mapping not found.');if(!['accepted','rejected'].includes(p.decision)||!['supported','partially supported','missing evidence','needs review'].includes(p.support))kb.fail(400,'Invalid evidence decision.');if(e.stale)kb.fail(409,'Rematch changed evidence first.');if(p.decision==='accepted'&&expired(e))kb.fail(400,'Replace the explicitly expired source before accepting evidence.');if(p.decision==='accepted'&&e.conflicts?.length){if(p.overrideConflict!==true)kb.fail(400,'Review the contradictory sources and explicitly record a resolution before acceptance.');e.conflictResolution={reason:text(p.reason,3000),actor:user,createdAt:new Date().toISOString()};}e.decision=p.decision;e.reason=text(p.reason,3000);e.reviewedBy=user;const r=s.requirements.find(r=>r.id===e.requirementId);r.support=p.support;r.status='Needs Review';
 }
 else if(action==='reviewRequirement'){
  requireReviewer();const r=s.requirements.find(x=>x.id===p.requirementId);if(!r)kb.fail(404,'Requirement not found.');if(!['Compliant','Partial','Non-Compliant','Needs Review'].includes(p.status))kb.fail(400,'Invalid compliance decision.');if(r.reviewerId&&r.reviewerId!==user)kb.fail(403,'The assigned reviewer must decide this requirement.');if(p.disposition&&!['applicable','not applicable','extraction error'].includes(p.disposition))kb.fail(400,'Invalid requirement disposition.');r.disposition=p.disposition||'applicable';if(p.status==='Compliant'&&!excluded({...r,reviewReason:p.reason,reviewedBy:user})&&!procedural(r)&&(r.support!=='supported'||(!procedural(r)&&!activeEvidence(s,r.id).length)))kb.fail(400,'Supported current evidence is required; matching text alone is insufficient.');if(procedural(r)&&p.status==='Compliant')r.support='supported';r.status=p.status;r.reviewReason=text(p.reason,3000);r.reviewedBy=user;
 }
 else if(action==='assign'){
  const item=p.sectionId?findSection():s.requirements.find(x=>x.id===p.requirementId);if(!item)kb.fail(404,'Assignment target not found.');for(const [key,roles] of [['authorId',['manager','author']],['reviewerId',['manager','reviewer']]]){const id=p[key]||null;if(id&&!members.some(m=>m.user_id===id&&roles.includes(m.role)))kb.fail(400,'Choose an authorized current project member.');item[key]=id;}item.dueAt=date(p.dueAt);item.assignmentVersion=(item.assignmentVersion||0)+1;
 }
 else if(action==='comment'){
  if(s.comments.length>=1000)kb.fail(429,'Comment limit reached.');if(p.sectionId)findSection();if(p.requirementId&&!s.requirements.some(r=>r.id===p.requirementId))kb.fail(404,'Requirement unavailable.');const mentions=p.mentions||[];if(!Array.isArray(mentions)||mentions.length>20||mentions.some(id=>!members.some(m=>m.user_id===id)))kb.fail(400,'Mentions must be current project members.');s.comments.push({id:randomUUID(),sectionId:p.sectionId||null,requirementId:p.requirementId||null,text:text(p.text,5000),mentions,actor:user,createdAt:new Date().toISOString()});
 }
 else if(action==='bidInputs'){
  for(const key of Object.keys(p.inputs||{})){if(!Object.hasOwn(s.weights,key))kb.fail(400,'Unknown fit factor.');const x=p.inputs[key];if(!['yes','partial','no','unknown'].includes(x.value))kb.fail(400,'Invalid factor state.');s.bidInputs[key]={value:x.value,reason:text(x.reason,2000),assumption:x.assumption===true,explicitInput:x.explicitInput===true,sources:Array.isArray(x.sources)?x.sources.map(id=>{const e=s.evidence.find(e=>e.id===id);if(!e||e.stale||e.decision!=='accepted')kb.fail(400,'Use current accepted evidence.');return id;}):[],recordedBy:user};}
  if(p.weights){for(const [key,w] of Object.entries(p.weights)){if(!Object.hasOwn(s.weights,key)||!Number.isInteger(w)||w<0||w>100)kb.fail(400,'Invalid weight.');s.weights[key]=w;}}if(s.assessment)s.assessment.stale=true;if(s.decision)s.decision.stale=true;
 }
 else if(action==='linkEvidence'){
  // p.evidence is a full candidate object already validated by the API layer
  // against pw_candidates (project-role enforced); core only re-checks shape
  // and that the same answer revision is not already linked to this requirement.
  const r=s.requirements.find(x=>x.id===p.requirementId);if(!r)kb.fail(404,'Requirement not found.');
  const e=p.evidence;if(!e||typeof e!=='object'||typeof e.answerId!=='string'||!e.answerId.trim()||!Number.isSafeInteger(e.revision)||typeof e.text!=='string'||!e.text.trim()||!Array.isArray(e.citations))kb.fail(400,'Link an existing approved company evidence item.');
  if(s.evidence.some(x=>x.requirementId===r.id&&x.answerId===e.answerId&&x.revision===e.revision&&x.decision!=='rejected'))kb.fail(409,'This evidence revision is already linked to the requirement.');
  const cleanCitations=e.citations.slice(0,20).map(c=>({id:c.id||null,documentId:c.documentId||null,fileName:String(c.fileName||c.file_name||c.document||'').slice(0,200),page:c.page??null,section:c.section?String(c.section).slice(0,200):null,quote:String(c.quote||'').slice(0,TRACE_EXCERPT_LIMIT),sha256:c.sha256||null}));
  s.evidence.push({...candidateFlags({answerId:e.answerId,question:e.question||'',text:e.text.slice(0,5000),revision:e.revision,citations:cleanCitations},s.evidence),id:randomUUID(),requirementId:r.id,decision:'suggested',reason:'Linked as a suggestion; a reviewer must accept or reject it.',stale:false});
  evidenceSuggested(s,r.id,user);
 }
 else if(action==='assessCoverage'){
  requireReviewer();const r=s.requirements.find(x=>x.id===p.requirementId);if(!r)kb.fail(404,'Requirement not found.');
  if(!COVERAGES.includes(p.coverage))kb.fail(400,'Invalid evidence coverage.');const explanation=text(p.explanation,1000);
  const t=ensureTrace(r);t.coverage=p.coverage;t.coverageSource='human-confirmed';t.explanation=explanation;t.reviewedBy=user;t.reviewedAt=new Date().toISOString();t.reviewedRequirementRevision=r.revision;t.reviewedEvidenceEpoch=evidenceEpoch;t.reviewedResponseRevision=responseRevision(s,r.id);t.needsReconfirmation=false;
  traceHistoryPush(t,{action:'coverage-assessed',actor:user,coverage:p.coverage,coverageSource:'human-confirmed',explanation,requirementRevision:r.revision,evidenceEpoch,responseRevision:t.reviewedResponseRevision});
 }
 else if(action==='approveResponse'){
  requireReviewer();const r=s.requirements.find(x=>x.id===p.requirementId);if(!r)kb.fail(404,'Requirement not found.');
  const explanation=text(p.explanation,1000);const sections=responseSections(s,r.id);
  if(!sections.length)kb.fail(400,'No draft response is linked to this requirement yet.');
  if(sections.some(x=>!x.text.trim()||/\[NEEDS (?:INPUT|REVIEW)/.test(x.text)))kb.fail(400,'Resolve placeholders in the linked response before approving it.');
  const t=ensureTrace(r);t.responseApproval={status:'approved',reviewedBy:user,reviewedAt:new Date().toISOString(),reviewedRequirementRevision:r.revision,reviewedEvidenceEpoch:evidenceEpoch,reviewedResponseRevision:responseRevision(s,r.id),responseHash:responseHash(s,r.id)};
  traceHistoryPush(t,{action:'response-approved',actor:user,explanation,requirementRevision:r.revision,evidenceEpoch,responseRevision:t.responseApproval.reviewedResponseRevision,coverage:t.coverage,coverageSource:t.coverageSource});
 }
 else if(action==='reviewWarnings'){requireReviewer();s.warningReview={fingerprint:hash(s.sourceWarnings),reason:text(p.reason,3000),actor:user,createdAt:new Date().toISOString()};}
 else if(action==='readinessItem'){
  // Checklist state only: mandatory status is untouched here. Any writable
  // project member may update a task; a viewer is blocked by the API layer
  // (mutations require a writable pw_role). Owner must be a current member.
  const rd=s.readiness=readinessState(s);
  if(typeof p.itemId!=='string'||!p.itemId.trim())kb.fail(400,'Choose a readiness item.');
  const manual=rd.manual.find(m=>m.id===p.itemId);
  if(!manual&&!readinessItems(s).some(i=>i.id===p.itemId))kb.fail(404,'Readiness item not found.');
  const current=manual||rd.items[p.itemId]||{};
  const next={status:p.status!==undefined?p.status:current.status||'not-started',owner:p.owner!==undefined?p.owner:current.owner||null,dueAt:p.dueAt!==undefined?date(p.dueAt):current.dueAt||null,naReason:p.naReason!==undefined?p.naReason:current.naReason||null};
  if(!READINESS_STATUSES.includes(next.status))kb.fail(400,'Invalid readiness task status.');
  if(next.owner!==null&&(typeof next.owner!=='string'||!members.some(m=>m.user_id===next.owner)))kb.fail(400,'Assign a current project member.');
  if(next.status==='not-applicable'){if(typeof next.naReason!=='string'||!next.naReason.trim())kb.fail(400,'Give a reason for Not applicable.');next.naReason=text(next.naReason,500);}
  else next.naReason=null;
  next.updatedBy=user;next.updatedAt=new Date().toISOString();
  if(manual)Object.assign(manual,next);else rd.items[p.itemId]={...(rd.items[p.itemId]||{}),...next};
 }
 else if(action==='readinessAddManual'){
  const rd=s.readiness=readinessState(s);
  if(rd.manual.length>=READINESS_MANUAL_LIMIT)kb.fail(400,'At most 200 manual readiness items per project.');
  if(!READINESS_KINDS.includes(p.kind))kb.fail(400,'Invalid readiness item kind.');
  if(!['Yes','Unclear','No'].includes(p.mandatory))kb.fail(400,'Invalid mandatory status.');
  rd.manual.push({id:'manual-'+randomUUID(),title:text(p.title,500),kind:p.kind,category:text(p.category||'Other',100),mandatory:p.mandatory,source:p.source===undefined||p.source===null?'':text(p.source,500,true),status:'not-started',owner:null,dueAt:null,naReason:null,createdBy:user,createdAt:new Date().toISOString()});
 }
 else if(action==='readinessCorrect'){
  // Correct an extraction mistake on a derived item. Stored as an override
  // keyed by stable ID (survives amendments); the item is labelled corrected
  // in the UI and the report, and the change is recorded in activity history
  // via the commit operation. The underlying requirement text is unchanged;
  // marking a requirement an extraction error stays reviewer-only.
  const rd=s.readiness=readinessState(s);
  const r=s.requirements.find(x=>(x.stableId||stableRequirementId(x))===p.stableId);if(!r)kb.fail(404,'Requirement not found.');
  const sid=r.stableId||stableRequirementId(r),corr=rd.corrections[sid]||{};
  const next={text:p.text!==undefined?text(p.text,5000):corr.text,category:p.category!==undefined?text(p.category,100):corr.category,mandatory:p.mandatory!==undefined?p.mandatory:corr.mandatory,note:text(p.note,1000)};
  if(next.mandatory!==undefined&&!['Yes','Unclear','No'].includes(next.mandatory))kb.fail(400,'Invalid mandatory status.');
  if(next.text===undefined&&next.category===undefined&&next.mandatory===undefined)kb.fail(400,'Describe the extraction correction.');
  next.correctedBy=user;next.correctedAt=new Date().toISOString();
  rd.corrections[sid]={...corr,...next};
 }
 else if(action==='readinessDeleteManual'){
  const rd=s.readiness=readinessState(s);
  const before=rd.manual.length;rd.manual=rd.manual.filter(m=>m.id!==p.itemId);
  if(rd.manual.length===before)kb.fail(404,'Manual readiness item not found.');
  s.readiness=rd;
 }
 else if(action==='settings'){s.title=text(p.title,200);s.company={name:text(p.company,200),accent:/^#[a-f0-9]{6}$/i.test(p.accent)?p.accent:'#1d4ed8'};}
 else if(action==='bidDecision'){if(!['pursue','review','pass'].includes(p.decision)||!s.assessment||s.assessment.stale)kb.fail(400,'Run a current assessment before deciding.');s.decision={value:p.decision,reason:text(p.reason,3000),actor:user,assessmentHash:s.assessment.inputHash,createdAt:new Date().toISOString()};}
 else kb.fail(400,'Unknown project operation.');
 if(['reviewEvidence','reviewRequirement'].includes(action)){const req=action==='reviewEvidence'?s.evidence.find(e=>e.id===p.evidenceId)?.requirementId:p.requirementId;for(const section of s.sections.filter(x=>x.requirementIds.includes(req))){section.status='changes requested';section.unverified=true;}}
 if(action==='reviewEvidence'){const req=s.evidence.find(e=>e.id===p.evidenceId)?.requirementId,r=s.requirements.find(x=>x.id===req);
  if(r){const t=ensureTrace(r);const map={supported:'supported','partially supported':'partially-supported','missing evidence':'missing-evidence','needs review':'not-assessed'};t.coverage=map[p.support]||'not-assessed';t.coverageSource='human-confirmed';t.explanation=p.reason;t.reviewedBy=user;t.reviewedAt=new Date().toISOString();t.reviewedRequirementRevision=r.revision;t.reviewedEvidenceEpoch=evidenceEpoch;t.reviewedResponseRevision=responseRevision(s,r.id);t.needsReconfirmation=false;traceHistoryPush(t,{action:'coverage-assessed',actor:user,coverage:t.coverage,coverageSource:'human-confirmed',explanation:p.reason,requirementRevision:r.revision,evidenceEpoch,responseRevision:t.reviewedResponseRevision});invalidateResponseApproval(s,req,user,'Linked evidence decision changed after response approval.',true);}}
 if(action==='saveSection'||action==='acceptDraft'){const section=s.sections.find(x=>x.id===p.sectionId);if(section&&beforeSectionText.get(section.id)!==section.text)for(const reqId of section.requirementIds)invalidateResponseApproval(s,reqId,user,'Response text changed after approval; previous approval is preserved in history.');}
 s.finalApproval=null;if(!['bidDecision','comment'].includes(action)){if(s.assessment)s.assessment.stale=true;if(s.decision)s.decision.stale=true;}return s;
}
module.exports={invalidateRequirement,expired,excluded,procedural,initial,imported,apply,refresh,candidateFlags,draftSection,readiness,assessment,activeEvidence,explicitLimits,contentHash,hash,text,date,words,stableRequirementId,contentFingerprint,defaultTrace,ensureTrace,suggestCoverage,evidenceSuggested,invalidateResponseApproval,markCoverageReconfirmation,traceSummary,unresolvedItems,responseHash,responseRevision,COVERAGES,READINESS_STATUSES,READINESS_KINDS,READINESS_MANUAL_LIMIT,READINESS_SCOPE_NOTE,readinessState,readinessItems,readinessSummary,readinessView,readinessItemUnresolved};
