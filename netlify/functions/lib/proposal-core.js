// Pure, deterministic evidence/decision logic shared by API, jobs and tests.
const {createHash,randomUUID}=require('node:crypto');
const kb=require('./knowledge-base');
const clone=value=>structuredClone(value);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text=(value,max=5000,empty=false)=>{if(typeof value!=='string'||value.length>max||(!empty&&!value.trim())||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))kb.fail(400,'Text is missing or exceeds the supported length.');return value.trim();};
function date(value){if(!value)return null;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000')||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)kb.fail(400,'Use an explicit valid YYYY-MM-DD date.');return value;}
// Draft language (per project): only the generated draft prose follows it.
// Requirement text, evidence and the compliance matrix stay in the source
// language. Stored on the project state JSON, so no migration is needed.
const DRAFT_LANGUAGES=['en','es'];
function normalizeDraftLanguage(v){if(v===undefined||v===null)return 'en';if(!DRAFT_LANGUAGES.includes(v))kb.fail(400,'Draft language must be English or Spanish.');return v;}
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
// Re-matching evidence ("Find approved evidence") must not destroy a
// reviewer's accepted decisions: keep accepted, non-stale mappings for the
// requirement, drop the rest, and append only fresh suggestions that are
// not already kept. Returns the kept count; the caller only invalidates
// the requirement and resets support when nothing was kept.
function mergeSuggestedEvidence(s,requirementId,ranked){
 const kept=(s.evidence||[]).filter(e=>e.requirementId===requirementId&&e.decision==='accepted'&&!e.stale);
 const keptKeys=new Set(kept.map(e=>e.answerId+'|'+e.revision));
 s.evidence=(s.evidence||[]).filter(e=>e.requirementId!==requirementId||kept.includes(e));
 for(const e of ranked||[]){if(!keptKeys.has(e.answerId+'|'+e.revision))s.evidence.push({...e,id:randomUUID(),requirementId,decision:'suggested',reason:'',stale:false});}
 return kept.length;
}
function traceSummary(s,epoch){return s.requirements.map(r=>{const t=ensureTrace(r);const evidence=s.evidence.filter(e=>e.requirementId===r.id).map(e=>({id:e.id,answerId:e.answerId,revision:e.revision,excerpt:String(e.text||'').slice(0,200),decision:e.decision,stale:!!e.stale}));const unresolved=!excluded(r)&&!amendmentRemoved(r)&&(t.coverage!=='supported'||t.responseApproval.status!=='approved');return {requirementId:r.id,stableId:r.stableId||stableRequirementId(r),text:r.text,category:r.category,mandatory:r.mandatory,coverage:t.coverage,coverageSource:t.coverageSource,needsReconfirmation:!!t.needsReconfirmation,reviewStatus:t.coverageSource?(t.needsReconfirmation?'needs-reconfirmation':'current'):'not-assessed',responseApproval:t.responseApproval.status,responseReviewedBy:t.responseApproval.reviewedBy,responseReviewedAt:t.responseApproval.reviewedAt,evidence,sources:r.sources||[],unresolved};});}
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
  if(amendmentRemoved(r))continue; // confirmed removed by an amendment: kept for history, not readiness work
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
  nonMandatoryUnresolved:unresolved.filter(i=>i.mandatory==='No').length,
  documentsMissing:unresolved.filter(i=>i.kind==='document'||i.kind==='form').length,
  responsesAwaitingApproval:unresolved.filter(i=>i.responseReviewPending).length,
  evidenceGaps:unresolved.filter(i=>i.evidenceGap).length,
  evidenceGapsMissing:unresolved.filter(i=>i.evidenceGap&&i.coverage==='missing-evidence').length,
  evidenceGapsUnassessed:unresolved.filter(i=>i.evidenceGap&&i.coverage==='not-assessed').length,byOwner:{}};
 for(const i of unresolved){const k=i.owner||'unassigned';summary.byOwner[k]=(summary.byOwner[k]||0)+1;}
 // The Evidence tab counts only coverage "missing-evidence", while the
 // readiness "evidence gaps" line counts missing AND not-yet-assessed, so
 // the two numbers disagree until the split is shown. The mandatory line
 // counts mandatory-or-unclear items only, so non-mandatory unresolved
 // items need their own line, and one item can appear in several lines at
 // once (it can need evidence, a response approval, and a document).
 summary.lines=[plural(summary.mandatoryUnresolved,'mandatory or unclear item unresolved','mandatory or unclear items unresolved')+'.',plural(summary.documentsMissing,'required document missing','required documents missing')+'.',plural(summary.responsesAwaitingApproval,'response awaiting approval','responses awaiting approval')+'.',plural(summary.evidenceGaps,'evidence gap','evidence gaps')+' ('+summary.evidenceGapsMissing+' confirmed missing, '+summary.evidenceGapsUnassessed+' not yet assessed).'];
 if(summary.nonMandatoryUnresolved)summary.lines.push(plural(summary.nonMandatoryUnresolved,'non-mandatory item also unresolved','non-mandatory items also unresolved')+'.');
 summary.lines.push('One item can appear in several lines above: it can need evidence, a response approval, and a document at the same time.');
 return summary;
}
function readinessView(s){return {items:readinessItems(s),summary:readinessSummary(s),scopeNote:READINESS_SCOPE_NOTE,factorCoverage:factorCoverage(s)};}
// --- Evaluation-factor coverage (advisory only) ---
// The buyer's evaluation factors are the requirements that carry an
// evaluation weight or are categorised Evaluation. A factor counts as
// covered when at least one section mapped to it has drafted response
// text: real words, not an empty section and not a section whose text is
// only [NEEDS INPUT / [NEEDS REVIEW] placeholders. A section with drafted
// words plus a gap marker still counts: the draft exists, the gap is a
// separate concern. Draft text counts; approval is a separate readiness
// concern. Coverage never changes a compliance status, a readiness
// blocker, a summary line or an export: it is a count shown next to them,
// not an input to them. When the RFP carries no evaluation factors the
// percentage is null, never a fabricated 100%.
const FACTOR_COVERAGE_NOTE='Advisory only: this counts drafted response text against the buyer\u2019s evaluation factors. A factor counts as covered when at least one section mapped to it has drafted response text; approval is separate. It is not a compliance verdict and does not change readiness or exports.';
function draftedResponseText(text){
 if(typeof text!=='string')return false;
 return text.replace(/\[(?:NEEDS INPUT|NEEDS REVIEW)[^\]]*\]/gi,'').trim().length>0;
}
function factorCoverage(s){
 const requirements=Array.isArray(s&&s.requirements)?s.requirements.filter(r=>!excluded(r)&&!amendmentRemoved(r)):[];
 const sections=Array.isArray(s&&s.sections)?s.sections:[];
 const factors=requirements.filter(r=>r.evaluationWeight!=null||r.category==='Evaluation');
 const uncovered=[];
 let covered=0;
 for(const r of factors){
  const drafted=sections.some(x=>(x.requirementIds||[]).includes(r.id)&&draftedResponseText(x.text));
  if(drafted)covered++;
  else uncovered.push({requirementId:r.id,stableId:r.stableId||stableRequirementId(r),text:r.text,evaluationWeight:r.evaluationWeight??null,category:r.category||null});
 }
 return {total:factors.length,covered,uncovered,coveragePercent:factors.length?Math.round(covered/factors.length*100):null,note:FACTOR_COVERAGE_NOTE};
}
// --- Import-time structure suggestion (winning-bid structure patterns) ---
// A structure template is an ordered section map from a reviewed historical
// example (PR #76 catalogue). The suggestion is computed at import from the
// imported sections only: it reorders nothing by itself. A person accepts
// (reorders sections) or dismisses it; the suggestion never blocks import,
// never writes draft text, never changes a compliance decision, and never
// claims a structure caused a win. Each template rests on one historical
// example, so the suggestion is labelled advisory and scoped to that
// example's market and sector. The current RFP's procurement ID is not
// known at import, so the same-procurement holdout cannot apply here; the
// template is matched on section wording alone, and a match is a
// suggestion, not evidence about this RFP.
const STRUCTURE_SUGGESTION_NOTE='Advisory only: this section order comes from one reviewed historical example, not from your RFP. Accepting only reorders your sections; no text changes and no compliance decision changes.';
const STRUCTURE_TEMPLATE_JURISDICTIONS=['US federal','US state/local'];
const STRUCTURE_TEMPLATE_SECTORS=['IT','consulting'];
function suggestionTokens(value){return new Set(String(value||'').toLowerCase().match(/[a-z0-9]{3,}/g)||[]);}
function structureSuggestion(state,catalogue){
 try{
  const sections=Array.isArray(state&&state.sections)?state.sections:[];
  const requirements=Array.isArray(state&&state.requirements)?state.requirements.filter(r=>!excluded(r)&&!amendmentRemoved(r)):[];
  if(!sections.length||!requirements.length)return null;
  const {structureTemplates}=require('./reference-patterns');
  const seen=new Set(),templates=[];
  for(const jurisdiction of STRUCTURE_TEMPLATE_JURISDICTIONS)for(const sector of STRUCTURE_TEMPLATE_SECTORS){
   for(const t of structureTemplates(catalogue,{jurisdiction,sector,limit:5,mode:'offline_pilot'})){
    const key=t.sourceId+'/'+t.patternId;if(seen.has(key))continue;seen.add(key);templates.push({...t,jurisdiction,sector});
   }
  }
  if(!templates.length)return null;
  const sectionTexts=sections.map(section=>{
   // Match on the section title and the linked requirement wording only.
   // The requirement category (Technical, Submission and so on) is
   // extraction metadata, not bidder text, and the template groups are
   // keyed on category words such as "administrative": matching on it
   // claimed unrelated sections for a group, for example a contract
   // termination clause filed under "Cover letter and bidder forms".
   const linked=(section.requirementIds||[]).map(id=>requirements.find(r=>r.id===id)).filter(Boolean);
   return suggestionTokens([section.title||'',...linked.map(r=>r.text||'')].join('\n'));
  });
  let best=null;
  for(const t of templates){
   const groups=(t.groups||[]).map(g=>({label:g.label,keywords:Array.isArray(g.keywords)?g.keywords.map(k=>String(k).toLowerCase()):[],sectionIds:[]}));
   const assigned=new Set();
   // Assign each section to its BEST-matching group, not the first group
   // sharing a word: first-match filed a section under an early group on
   // one shared word even when a later group matched it better. The group
   // with the most keyword hits wins; ties keep the template's first group.
   // Short requirement texts legitimately match on a single distinctive
   // keyword ("pricing form"), so one hit is enough to join. Sections
   // matching no group stay unmatched instead of being forced in.
   sections.forEach((section,i)=>{
    if(assigned.has(section.id))return;
    let bestGroup=null,bestHits=0;
    for(const g of groups){
     if(!g.keywords.length)continue;
     let hits=0;for(const k of g.keywords)if(sectionTexts[i].has(k))hits++;
     if(hits>bestHits){bestGroup=g;bestHits=hits;}
    }
    if(bestGroup){bestGroup.sectionIds.push(section.id);assigned.add(section.id);}
   });
   const matchedGroups=groups.filter(g=>g.sectionIds.length).length;
   if(matchedGroups<2)continue;
   const score={matchedGroups,matchedSections:assigned.size};
   if(!best||score.matchedGroups>best.score.matchedGroups||(score.matchedGroups===best.score.matchedGroups&&score.matchedSections>best.score.matchedSections))best={template:t,groups,score};
  }
  if(!best)return null;
  const assigned=new Set(best.groups.flatMap(g=>g.sectionIds));
  const unmatchedSectionIds=sections.filter(x=>!assigned.has(x.id)).map(x=>x.id);
  const t=best.template;
  return {status:'suggested',patternId:t.patternId,sourceId:t.sourceId,title:t.title,guidance:t.guidance,sourceUrl:t.sourceUrl,locator:t.locator,sha256:t.sha256,awardStatus:t.awardStatus,jurisdiction:t.jurisdiction,sector:t.sector,groups:best.groups,unmatchedSectionIds,matchedGroups:best.score.matchedGroups,matchedSections:best.score.matchedSections,totalSections:sections.length,createdAt:new Date().toISOString(),permittedUse:'structure_guidance_only',canSupportCompliance:false,requiresHumanReview:true,note:STRUCTURE_SUGGESTION_NOTE};
 }catch{return null;}
}
// --- Amendment impact review (Capability 3) ---
// When the solicitation changes, the user adds the new version as a proposed
// amendment; the original version and its review history stay intact in
// pw_revisions (full state snapshots per revision) and in state.requirements
// until a change is confirmed. Comparison is deterministic text matching:
// stable-ID match first, then word-set similarity for reworded requirements.
// No model call is made: genuinely ambiguous pairs are flagged
// "uncertain-match" for a human instead of being guessed by a model, and no
// other customer's evidence is ever sent into a comparison. Every proposed
// change starts as a suggestion: confirming applies it, correcting adjusts
// the match or wording, rejecting restores the prior approval state. Nothing
// is silently overwritten or deleted — a "potentially removed" requirement
// stays in the project until a person confirms the removal, and absence from
// a supplemental amendment never means removal. All amendment state lives in
// pw_projects.state.amendments (JSONB); activity history comes from
// pw_events via commit and trace history in the state mirror, so NO migration
// is needed for this capability.
const AMENDMENT_KINDS=['replacement','supplemental'];
const AMENDMENT_CHANGE_TYPES=['added','changed','deadline-changed','instruction-changed','potentially-removed','uncertain-match'];
const AMENDMENT_CHANGE_STATUSES=['proposed','confirmed','corrected','rejected'];
const AMENDMENT_MAX_PER_PROJECT=50,AMENDMENT_MAX_REQUIREMENTS=1000;
const AMENDMENT_MATCH_THRESHOLD=0.5,AMENDMENT_UNCERTAIN_THRESHOLD=0.25;
const AMENDMENT_SCOPE_NOTE='Amendment comparison is deterministic text matching on the supplied documents. Every proposed change is a suggestion until a person confirms or corrects it; nothing is silently overwritten, and no requirement, response, deadline or evidence link is deleted by proposing an amendment. Absence from a supplemental amendment does not mean a requirement was removed.';
function amendmentsState(s){const list=(s&&Array.isArray(s.amendments))?s.amendments:[];return list;}
function amendmentRemoved(r){return !!(r&&r.removedByAmendment&&typeof r.removedByAmendment==='object');}
function amendmentNormalize(text){return String(text||'').replace(/\s+/g,' ').trim().toLowerCase();}
function amendmentTokens(text){return new Set(amendmentNormalize(text).replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean));}
function amendmentSimilarity(a,b){const x=amendmentTokens(a),y=amendmentTokens(b);if(!x.size||!y.size)return 0;let shared=0;for(const t of x)if(y.has(t))shared++;return shared/(x.size+y.size-shared);}
const AMENDMENT_MONTHS={january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12};
function extractAmendmentDates(text){
 const found=new Set();const src=String(text||'');
 for(const m of src.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)){try{found.add(date(m[0]));}catch{/* Not a valid calendar date; never inferred. */}}
 for(const m of src.matchAll(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi)){const iso=`${m[3]}-${String(AMENDMENT_MONTHS[m[1].toLowerCase()]).padStart(2,'0')}-${String(Number(m[2])).padStart(2,'0')}`;try{found.add(date(iso));}catch{/* Not a valid calendar date. */}}
 return [...found].sort();
}
function amendmentDatesRemoved(text){return amendmentNormalize(text).replace(/\b\d{4}-\d{2}-\d{2}\b/g,'').replace(/\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b/g,'').replace(/\s+/g,' ').trim();}
// A submission deadline is only comparable when it was extracted as an
// explicit fact on both sides. Dates are pulled out of the fact value
// (which may read "2026-09-01" or "September 1, 2026") and compared as
// dates, never as raw strings; a missing fact means the fact comparison
// cannot run, and the timetable fallback below gets its turn.
function amendmentDeadlineFromFacts(facts){
 const fact=(facts||[]).find(f=>f&&f.type==='Submission Deadline');
 if(!fact||typeof fact.value!=='string')return null;
 const dates=extractAmendmentDates(fact.value);
 return dates.length?{value:fact.value.trim(),dates}:null;
}
// Timetable fallback: short amendment notices often extract no Submission
// Deadline fact at all, so read the response-due row of the procurement
// timetable straight from the analysis segment text. The row is anchored
// on the response-submission label ("Electronic Responses", "Quotes Due",
// "Bid Opening") and the first date within a short window after the label
// is the deadline; every other timetable row (questions due, intent to
// bid, contract start) carries a different label and never matches, and a
// date that follows another row's event label belongs to that row, not to
// the response row. A missing label, or no date nearby, means no
// comparison is possible — the deadline is never inferred from
// requirement text.
const AMENDMENT_DEADLINE_LABELS=[/electronic responses/i,/quotes?\s+due/i,/bid opening/i];
const AMENDMENT_MONTH_NAMES=['January','February','March','April','May','June','July','August','September','October','November','December'];
function firstAmendmentDate(text){
 const src=String(text||'');let best=null;
 const consider=(idx,iso)=>{if(best===null||idx<best.idx)best={idx,iso};};
 for(const m of src.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)){try{date(m[0]);consider(m.index,m[0]);}catch{/* Not a valid calendar date. */}}
 for(const m of src.matchAll(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi)){const iso=`${m[3]}-${String(AMENDMENT_MONTHS[m[1].toLowerCase()]).padStart(2,'0')}-${String(Number(m[2])).padStart(2,'0')}`;try{date(iso);consider(m.index,iso);}catch{/* Not a valid calendar date. */}}
 return best;
}
// A date belongs to another timetable row when another row's event label
// sits between the response label and that date (for example the contract
// start row following a dateless response row); such a date is never the
// response deadline.
const AMENDMENT_OTHER_ROW=/written questions|notice of intent|contract start|announcement of intent|rfr issued/i;
function amendmentDeadlineFromTimetable(segments){
 const list=(segments||[]).filter(s=>s&&typeof s.text==='string'&&s.text.trim());
 if(!list.length)return null;
 let joined='',spans=[];
 for(const s of list){const start=joined.length;joined+=(joined?'\n':'')+s.text;spans.push({start,end:joined.length,segment:s});}
 for(const label of AMENDMENT_DEADLINE_LABELS){
  for(const m of joined.matchAll(new RegExp(label.source,'gi'))){
   const window=joined.slice(m.index,m.index+m[0].length+400);
   const found=firstAmendmentDate(window);
   if(!found)continue;
   if(AMENDMENT_OTHER_ROW.test(window.slice(m[0].length,found.idx)))continue;
   const iso=found.iso;const [y,mo,d]=iso.split('-').map(Number);
   const span=spans.find(x=>m.index>=x.start&&m.index<x.end)||spans[0];
   return {value:AMENDMENT_MONTH_NAMES[mo-1]+' '+d+', '+y,dates:[iso],source:{document:span.segment.document||'Source unavailable',section:span.segment.section||null,page:span.segment.page??null,quote:window.replace(/\s+/g,' ').trim().slice(0,300)}};
  }
 }
 return null;
}
// Same mapping as imported(): the stable ID of a freshly extracted requirement
// is its content-anchored ID; prior identity is preserved by matching, below.
function normalizeAnalysisRequirements(w){
 if(!w||!Array.isArray(w.requirements)||!w.requirements.length||w.requirements.length>AMENDMENT_MAX_REQUIREMENTS)kb.fail(400,'Complete a nonempty analysis with at most 1000 requirements.');
 return w.requirements.map(r=>({id:r.id,stableId:stableRequirementId(r),text:r.requirement,originalText:r.original_requirement||r.requirement,mandatory:r.mandatory,category:r.category,evaluationWeight:r.evaluation_weight||null,sources:Array.isArray(r.sources)?r.sources:[],fingerprint:r.fingerprint||null}));
}
function amendmentSourceRefs(r){return (r.sources||[]).map(src=>({document:src.document||src.document_name||'Source unavailable',section:src.section||null,page:src.page??null,quote:src.quote||''}));}
function classifyAmendmentPair(oldReq,newReq){
 const datesOld=extractAmendmentDates(oldReq.text),datesNew=extractAmendmentDates(newReq.text);
 const deadlineChanged=JSON.stringify(datesOld)!==JSON.stringify(datesNew);
 const category=(newReq.category||oldReq.category||'');
 if(deadlineChanged&&(category==='Submission'||amendmentDatesRemoved(oldReq.text)===amendmentDatesRemoved(newReq.text)))return {type:'deadline-changed',deadlineChanged};
 if(category==='Submission')return {type:'instruction-changed',deadlineChanged};
 return {type:'changed',deadlineChanged};
}
function amendmentChangeFields(pair){
 return {oldRequirementId:pair.oldReq.id,newRequirementId:pair.newReq.id,stableId:pair.oldReq.stableId||stableRequirementId(pair.oldReq),oldText:pair.oldReq.text,newText:pair.newReq.text,oldSources:amendmentSourceRefs(pair.oldReq),newSources:amendmentSourceRefs(pair.newReq),oldMandatory:pair.oldReq.mandatory,newMandatory:pair.newReq.mandatory,oldCategory:pair.oldReq.category,newCategory:pair.newReq.category,similarity:pair.similarity??null,matchMethod:pair.matchMethod,deadlineChanged:!!pair.deadlineChanged};
}
function compareRequirements(oldReqs,newReqs,kind){
 if(!AMENDMENT_KINDS.includes(kind))kb.fail(400,'Choose replacement or supplemental.');
 const oldList=(oldReqs||[]).filter(r=>!amendmentRemoved(r)).map(r=>({id:r.id,stableId:r.stableId||stableRequirementId(r),text:r.text,mandatory:r.mandatory,category:r.category,sources:r.sources||[]}));
 const newList=(newReqs||[]).map(r=>({id:r.id,stableId:r.stableId||stableRequirementId(r),text:r.text,mandatory:r.mandatory,category:r.category,sources:r.sources||[]}));
 const changes=[],notMentioned=[],usedOld=new Set(),usedNew=new Set();
 const pair=(oldReq,newReq,matchMethod,similarity)=>{const c=classifyAmendmentPair(oldReq,newReq);return {...c,oldReq,newReq,matchMethod,similarity};};
 // 1. Stable-ID match: same content-anchored ID. Identical wording is
 // unchanged (no change record); edited wording is a detected change.
 const oldByStable=new Map(oldList.map(r=>[r.stableId,r]));
 for(const n of newList){const o=oldByStable.get(n.stableId);if(!o||usedOld.has(o.id))continue;usedOld.add(o.id);usedNew.add(n.id);if(amendmentNormalize(o.text)!==amendmentNormalize(n.text)){const p=pair(o,n,'stable-id',null);changes.push({id:randomUUID(),type:p.type,status:'proposed',...amendmentChangeFields(p)});}}
 // 2. Similarity match for reworded requirements whose wording (and therefore
 // stable ID) changed. Short requirements match only on identical wording,
 // which step 1 already handled; similarity is too noisy for them.
 for(const n of newList.filter(x=>!usedNew.has(x.id))){
  let best=null,bestScore=0;
  for(const o of oldList.filter(x=>!usedOld.has(x.id))){
   if(Math.min(amendmentTokens(o.text).size,amendmentTokens(n.text).size)<=3)continue;
   const score=amendmentSimilarity(o.text,n.text);if(score>bestScore){bestScore=score;best=o;}
  }
  if(best&&bestScore>=AMENDMENT_MATCH_THRESHOLD){usedOld.add(best.id);usedNew.add(n.id);const p=pair(best,n,'similarity',bestScore);changes.push({id:randomUUID(),type:p.type,status:'proposed',...amendmentChangeFields(p)});}
  else if(best&&bestScore>=AMENDMENT_UNCERTAIN_THRESHOLD){usedOld.add(best.id);usedNew.add(n.id);changes.push({id:randomUUID(),type:'uncertain-match',status:'proposed',...amendmentChangeFields({oldReq:best,newReq:n,matchMethod:'similarity',similarity:bestScore}),deadlineChanged:JSON.stringify(extractAmendmentDates(best.text))!==JSON.stringify(extractAmendmentDates(n.text))});}
 }
 // 3. Unmatched new requirements are additions. Unmatched old requirements
 // are potentially removed ONLY for a complete replacement; for a supplemental
 // amendment they are simply not mentioned — never treated as removed.
 for(const n of newList.filter(x=>!usedNew.has(x.id)))changes.push({id:randomUUID(),type:'added',status:'proposed',stableId:n.stableId,oldRequirementId:null,newRequirementId:n.id,oldText:null,newText:n.text,oldSources:[],newSources:amendmentSourceRefs(n),oldMandatory:null,newMandatory:n.mandatory,oldCategory:null,newCategory:n.category,similarity:null,matchMethod:'none',deadlineChanged:false});
 for(const o of oldList.filter(x=>!usedOld.has(x.id))){
  if(kind==='replacement')changes.push({id:randomUUID(),type:'potentially-removed',status:'proposed',stableId:o.stableId,oldRequirementId:o.id,newRequirementId:null,oldText:o.text,newText:null,oldSources:amendmentSourceRefs(o),newSources:[],oldMandatory:o.mandatory,newMandatory:null,oldCategory:o.category,newCategory:null,similarity:null,matchMethod:'none',deadlineChanged:false});
  else notMentioned.push({stableId:o.stableId,requirementId:o.id,text:o.text});
 }
 return {changes,notMentioned};
}
function amendmentSummary(a){
 const byType={},byStatus={};for(const c of a.changes||[]){byType[c.type]=(byType[c.type]||0)+1;byStatus[c.status]=(byStatus[c.status]||0)+1;}
 return {versionNumber:a.versionNumber,kind:a.kind,status:a.status,total:(a.changes||[]).length,proposed:byStatus.proposed||0,confirmed:byStatus.confirmed||0,corrected:byStatus.corrected||0,rejected:byStatus.rejected||0,byType,notMentioned:(a.notMentioned||[]).length,unresolved:(a.changes||[]).filter(c=>c.status==='proposed').length};
}
function amendmentAffectedWork(s,change){
 const r=change.oldRequirementId?(s.requirements||[]).find(x=>x.id===change.oldRequirementId):null;
 if(!r)return {requirementId:change.oldRequirementId||null,stableId:change.stableId||null,evidence:[],sections:[],responseApproval:null,coverage:null,coverageSource:null,needsReconfirmation:false};
 const t=ensureTrace(r);
 return {requirementId:r.id,stableId:r.stableId||stableRequirementId(r),
  evidence:(s.evidence||[]).filter(e=>e.requirementId===r.id).map(e=>({id:e.id,answerId:e.answerId,revision:e.revision,excerpt:String(e.text||'').slice(0,200),decision:e.decision,stale:!!e.stale})),
  sections:responseSections(s,r.id).map(x=>({id:x.id,title:x.title,status:x.status,revision:x.revision})),
  responseApproval:t.responseApproval.status,coverage:t.coverage,coverageSource:t.coverageSource,needsReconfirmation:!!t.needsReconfirmation};
}
function amendmentView(s){return amendmentsState(s).map(a=>({...a,summary:amendmentSummary(a),changes:(a.changes||[]).map(c=>({...c,affected:amendmentAffectedWork(s,c)}))}));}
// Flag an affected approval as needing reconfirmation when a deterministic
// change is detected. The prior state is stored on the change so rejecting
// the change restores it; the approval history in the trace is preserved.
function flagAmendmentChange(s,change,actor,reason){
 const r=(s.requirements||[]).find(x=>x.id===change.oldRequirementId);if(!r)return;const t=ensureTrace(r);
 if(change.priorApprovalStatus===undefined){change.priorApprovalStatus=t.responseApproval.status;change.priorNeedsReconfirmation=!!t.needsReconfirmation;}
 if(t.responseApproval.status==='approved')t.responseApproval={...t.responseApproval,status:'needs-reconfirmation'};
 t.needsReconfirmation=true;
 traceHistoryPush(t,{action:'amendment-change-proposed',actor,reason,requirementRevision:r.revision,priorStatus:change.priorApprovalStatus});
}
function unflagAmendmentChange(s,change,actor,reason){
 const r=(s.requirements||[]).find(x=>x.id===change.oldRequirementId);if(!r)return;const t=ensureTrace(r);
 // Only restore when nothing else has already re-approved or re-flagged it
 // since the proposal: never clobber a newer human decision.
 if(t.responseApproval.status==='needs-reconfirmation'&&change.priorApprovalStatus!==undefined)t.responseApproval={...t.responseApproval,status:change.priorApprovalStatus};
 if(change.priorNeedsReconfirmation!==undefined)t.needsReconfirmation=!!change.priorNeedsReconfirmation;
 traceHistoryPush(t,{action:'amendment-change-rejected',actor,reason,requirementRevision:r.revision});
}
function proposeAmendment(s,input,actor){
 s=clone(s);const list=amendmentsState(s);
 if(list.length>=AMENDMENT_MAX_PER_PROJECT)kb.fail(400,'At most 50 solicitation versions per project.');
 if(!AMENDMENT_KINDS.includes(input.kind))kb.fail(400,'Choose replacement or supplemental.');
 const versionNumber=input.versionNumber??(list.reduce((m,a)=>Math.max(m,a.versionNumber||0),0)+1);
 if(!Number.isSafeInteger(versionNumber)||versionNumber<1||list.some(a=>a.versionNumber===versionNumber))kb.fail(400,'Choose an unused positive version number.');
 if(!Array.isArray(input.newRequirements)||!input.newRequirements.length||input.newRequirements.length>AMENDMENT_MAX_REQUIREMENTS)kb.fail(400,'Complete a nonempty analysis with at most 1000 requirements.');
 if(!Array.isArray(input.documentsCompared)||!input.documentsCompared.length)kb.fail(400,'State which documents were compared.');
 const {changes,notMentioned}=compareRequirements(s.requirements,input.newRequirements,input.kind);
 // A deadline-only amendment (for example one that only moves the response
 // deadline) matches no requirement pair, so the pairwise comparison
 // surfaces nothing. Compare the extracted submission-deadline facts
 // first: when both sides state a deadline and they differ, record one
 // project-level deadline change with no requirement attached. When the
 // fact comparison cannot run because a fact is missing on either side,
 // fall back to the response-due row of the procurement timetable in the
 // analysis text; facts still win whenever both sides state one. The
 // deadline is never inferred from requirement text.
 const oldDeadline=amendmentDeadlineFromFacts(s.analysis?.facts);
 const newDeadline=amendmentDeadlineFromFacts(input.amendmentFacts);
 if(oldDeadline&&newDeadline&&JSON.stringify(oldDeadline.dates)!==JSON.stringify(newDeadline.dates)){
  changes.push({id:randomUUID(),type:'deadline-changed',status:'proposed',stableId:null,oldRequirementId:null,newRequirementId:null,oldText:'Submission deadline: '+oldDeadline.value,newText:'Submission deadline: '+newDeadline.value,oldSources:[],newSources:Array.isArray(input.deadlineSources)?input.deadlineSources:[],oldMandatory:null,newMandatory:null,oldCategory:null,newCategory:null,similarity:null,matchMethod:'deadline-fact',deadlineChanged:true});
 }else if(!(oldDeadline&&newDeadline)){
  const oldText=amendmentDeadlineFromTimetable(input.oldAnalysisTextSegments);
  const newText=amendmentDeadlineFromTimetable(input.amendmentTextSegments);
  if(oldText&&newText&&JSON.stringify(oldText.dates)!==JSON.stringify(newText.dates)){
   changes.push({id:randomUUID(),type:'deadline-changed',status:'proposed',stableId:null,oldRequirementId:null,newRequirementId:null,oldText:'Submission deadline: '+oldText.value,newText:'Submission deadline: '+newText.value,oldSources:oldText.source?[oldText.source]:[],newSources:newText.source?[newText.source]:[],oldMandatory:null,newMandatory:null,oldCategory:null,newCategory:null,similarity:null,matchMethod:'deadline-text',deadlineChanged:true});
  }
 }
 if(changes.length>AMENDMENT_MAX_REQUIREMENTS)kb.fail(400,'This amendment proposes more than 1000 changes; narrow the supplied documents.');
 const amendment={id:randomUUID(),versionNumber,kind:input.kind,analysisId:input.analysisId||null,sourceDocumentId:input.sourceDocumentId||null,fileIds:Array.isArray(input.fileIds)?input.fileIds:[],documentsCompared:input.documentsCompared,documentsUnprocessed:Array.isArray(input.documentsUnprocessed)?input.documentsUnprocessed:[],status:'open',createdAt:new Date().toISOString(),createdBy:actor||null,changes,notMentioned};
 s.amendments=[...list,amendment];
 // Deterministic detections flag affected approvals now; uncertain matches do
 // not, because the match itself is still only a suggestion.
 for(const c of changes)if(['changed','deadline-changed','instruction-changed','potentially-removed'].includes(c.type))flagAmendmentChange(s,c,actor,'Amendment version '+versionNumber+' ('+input.kind+') proposed a '+c.type+' change; prior approval needs reconfirmation.');
 return s;
}
function findAmendmentChange(s,amendmentId,changeId){
 const a=amendmentsState(s).find(x=>x.id===amendmentId);if(!a)kb.fail(404,'Amendment not found.');
 const c=(a.changes||[]).find(x=>x.id===changeId);if(!c)kb.fail(404,'Amendment change not found.');
 return {amendment:a,change:c};
}
function resolveAmendmentStatus(a){a.status=(a.changes||[]).every(c=>c.status!=='proposed')?'resolved':'open';}
function applyAmendmentChange(s,amendment,change,actor){
 const version=amendment.versionNumber;
 if(change.type==='added'){
  if((s.requirements||[]).some(r=>r.id===change.newRequirementId))kb.fail(409,'This requirement is already in the project.');
  const n={id:change.newRequirementId,stableId:change.stableId,analysisRequirementId:change.newRequirementId,fingerprint:null,originalText:change.newText,revision:0,text:change.newText,mandatory:change.newMandatory,category:change.newCategory,evaluationWeight:null,sources:change.newSources.map(src=>({document_id:null,document:src.document,segment_id:null,page:src.page,section:src.section,quote:src.quote})),status:'Needs Review',reviewReason:'',support:'needs review',trace:defaultTrace(),authorId:null,reviewerId:null,dueAt:null};
  s.requirements=[...(s.requirements||[]),n];
  s.sections=[...(s.sections||[]),{id:randomUUID(),title:`${s.requirements.length}. ${change.newText.slice(0,100)}`,requirementIds:[n.id],text:'',revision:0,status:'draft',claims:[],unverified:true,authorId:null,reviewerId:null,dueAt:null,reviewReason:'Added by confirmed amendment version '+version+'.'}];
 }else if(['changed','deadline-changed','instruction-changed','uncertain-match'].includes(change.type)){
  // A project-level deadline change has no requirement to rewrite: the
  // decision is recorded by the caller, and the stored deadline fact only
  // changes when the RFP snapshot itself is re-imported.
  if(change.type==='deadline-changed'&&!change.oldRequirementId)return;
  const r=(s.requirements||[]).find(x=>x.id===change.oldRequirementId);if(!r)kb.fail(404,'Requirement not found.');
  const newText=change.correctedText||change.newText;
  invalidateRequirement(r,'Wording changed in amendment version '+version+'; review the prior compliance decision.');
  r.text=newText;r.originalText=newText;r.revision=(r.revision??0)+1;
  r.sources=change.newSources.map(src=>({document_id:null,document:src.document,segment_id:null,page:src.page,section:src.section,quote:src.quote}));
  r.mandatory=change.newMandatory;r.category=change.newCategory;
  const idx=s.requirements.indexOf(r);
  for(const section of (s.sections||[]).filter(x=>x.requirementIds.includes(r.id)))section.title=`${idx+1}. ${newText.slice(0,100)}`;
  const t=ensureTrace(r);traceHistoryPush(t,{action:'amendment-change-confirmed',actor,reason:'Confirmed '+change.type+' change from amendment version '+version+'. Prior approval stays needs-reconfirmation until re-approved.',requirementRevision:r.revision});
 }else if(change.type==='potentially-removed'){
  const r=(s.requirements||[]).find(x=>x.id===change.oldRequirementId);if(!r)kb.fail(404,'Requirement not found.');
  r.removedByAmendment={amendmentId:amendment.id,versionNumber:version,confirmedBy:actor,confirmedAt:new Date().toISOString()};
  invalidateRequirement(r,'Confirmed removed by amendment version '+version+'.');
  const t=ensureTrace(r);traceHistoryPush(t,{action:'amendment-removal-confirmed',actor,reason:'Removal confirmed in amendment version '+version+'. The requirement and its history are kept in this project.',requirementRevision:r.revision});
 }
}
function initial(title,company){return {schema:1,title:text(title,200),company:{name:text(company||title,200),accent:'#1d4ed8'},draftLanguage:'en',requirements:[],sections:[],evidence:[],comments:[],facts:[],bidInputs:{},weights:{experience:25,certifications:25,capacity:20,timeline:15,strategy:15},decision:null,assessment:null,finalApproval:null,reviewedEpoch:0,sourceWarnings:[],analysis:null,attachments:[],archivedResponses:[],amendments:[],readiness:{items:{},corrections:{},manual:[]},structureSuggestion:null};}function excluded(r){return ['not applicable','extraction error'].includes(r.disposition)&&!!r.reviewReason&&!!r.reviewedBy;}
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
 if(!['Completed','Partial'].includes(workspace.analysis.status)||!workspace.requirements.length||workspace.requirements.length>AMENDMENT_MAX_REQUIREMENTS)kb.fail(400,'Complete a nonempty analysis with at most 1000 requirements.');
 const previousAnalysisId=s.analysis?.id||null;const previousRequirements=clone(s.requirements),previousSections=clone(s.sections),old=new Map(s.requirements.map(r=>[r.id,r]));const normalized=t=>t.replace(/\s+/g,' ').trim().toLowerCase();const prior=r=>old.get(r.id)||((previousRequirements.filter(x=>normalized(x.text)===normalized(r.requirement)).length===1)&&previousRequirements.find(x=>normalized(x.text)===normalized(r.requirement)))||null;
 s.requirements=workspace.requirements.map(r=>({id:prior(r)?.id||r.id,stableId:prior(r)?.stableId||stableRequirementId(r),analysisRequirementId:r.id,fingerprint:r.fingerprint,originalText:r.original_requirement||r.requirement,revision:prior(r)&&amendment?(prior(r).revision??0)+1:(r.revision??0),text:r.requirement,mandatory:r.mandatory,category:r.category,evaluationWeight:r.evaluation_weight||null,sources:r.sources,status:'Needs Review',reviewReason:'',support:'needs review',trace:prior(r)&&amendment?ensureTrace(prior(r)):defaultTrace(),authorId:prior(r)?.authorId||null,reviewerId:prior(r)?.reviewerId||null,dueAt:prior(r)?.dueAt||null}));
 if(amendment)for(const r of s.requirements){const prev=previousRequirements.find(x=>x.id===r.id);if(prev&&prev.text!==r.text){const t=ensureTrace(r);t.needsReconfirmation=true;if(t.responseApproval.status==='approved')t.responseApproval.status='needs-reconfirmation';traceHistoryPush(t,{action:'requirement-amended',actor:null,reason:'Requirement wording changed in an amendment; prior review needs reconfirmation.',requirementRevision:r.revision});}}
 s.analysis={id:workspace.analysis.id,fingerprint:workspace.analysis.fingerprint,status:workspace.analysis.status,documents:workspace.analysis.documents.map(({segments,...d})=>d),facts:workspace.analysis.facts,processed:Number.isSafeInteger(workspace.analysis.processed)?workspace.analysis.processed:null,total_chunks:Number.isSafeInteger(workspace.analysis.total_chunks)?workspace.analysis.total_chunks:null};s.sourceWarnings=[...workspace.analysis.warnings,...(workspace.analysis.status==='Partial'?['RFP analysis has extraction gaps; review the originals.']:[])];
 s.sections=s.requirements.map((r,i)=>({id:old.has(r.id)&&s.sections.find(x=>x.requirementIds.includes(r.id))?.id||randomUUID(),title:`${i+1}. ${r.text.slice(0,100)}`,requirementIds:[r.id],text:s.sections.find(x=>x.requirementIds.includes(r.id))?.text||'',revision:(s.sections.find(x=>x.requirementIds.includes(r.id))?.revision??-1)+1,status:'draft',claims:[],unverified:true,authorId:r.authorId,reviewerId:r.reviewerId,dueAt:r.dueAt,reviewReason:'Source requirements imported or amended.'}));
 const retained=previousSections.filter(section=>!section.requirementIds.some(id=>s.requirements.some(r=>r.id===id)));if(amendment&&retained.length)s.archivedResponses=[...(s.archivedResponses||[]).slice(-4),{analysisId:previousAnalysisId,archivedAt:new Date().toISOString(),sections:retained,requirements:previousRequirements.filter(r=>retained.some(x=>x.requirementIds.includes(r.id)))}];
 if(amendment){
  // A direct import replaces the live snapshot without per-change review.
  // Record it as an applied amendment version so the replacement, and
  // exactly which documents were compared, stay visible in the amendment
  // history and impact report instead of silently bypassing review.
  // Routing through proposeAmendment would remove the direct-replace
  // capability the share flow relies on, so this records rather than reroutes.
  const prior=amendmentsState(s);
  if(prior.length<AMENDMENT_MAX_PER_PROJECT){
   const versionNumber=prior.reduce((m,a)=>Math.max(m,a.versionNumber||0),0)+1;
   s.amendments=[...prior,{id:randomUUID(),versionNumber,kind:'replacement',analysisId:workspace.analysis.id||null,sourceDocumentId:workspace.analysis.documents[0]?.id||null,fileIds:[],documentsCompared:(workspace.analysis.documents||[]).map(d=>({id:d.id,name:d.name})),documentsUnprocessed:workspace.analysis.status==='Partial'?(workspace.analysis.documents||[]).filter(d=>!(d.segments&&d.segments.length)).map(d=>({id:d.id,name:d.name,reason:'No extracted segments in this analysis.'})):[],status:'applied',appliedDirectly:true,createdAt:new Date().toISOString(),createdBy:null,changes:[],notMentioned:[]}];
  }
 }
 s.evidence=[];s.finalApproval=null;s.assessment=null;s.decision=null;return s;
}
function draftSection(s,sectionId){
 const section=s.sections.find(x=>x.id===sectionId);if(!section)kb.fail(404,'Section not found.');const claims=[],parts=[],gaps=[],gapKinds=[];
 for(const id of section.requirementIds){const r=s.requirements.find(x=>x.id===id);if(excluded(r)){parts.push('Requirement '+id+' was explicitly excluded from scope by an authorized reviewer.');continue;}const evidence=activeEvidence(s,id);if(procedural(r)){parts.push('[NEEDS INPUT: describe how this submission instruction is satisfied: '+r.text+']');gaps.push(id);gapKinds.push('procedural');continue;}if(!evidence.length){const gap=`[NEEDS INPUT: approved, current evidence for requirement ${id}]`;parts.push(gap);gaps.push(id);gapKinds.push('no-evidence');continue;}
  for(const e of evidence){parts.push(e.text);claims.push({text:e.text,answerId:e.answerId,answerRevision:e.revision,requirementId:id,citations:e.citations});}
  if(r.support!=='supported'){parts.push(`[NEEDS REVIEW: evidence only ${r.support} for requirement ${id}]`);gaps.push(id);gapKinds.push('other');}
 }
 const gapReason=!gaps.length?null:gapKinds.every(k=>k==='procedural')?'procedural':gapKinds.every(k=>k==='no-evidence')?'no-evidence':gapKinds.every(k=>k==='procedural'||k==='no-evidence')?'mixed':null;
 if(parts.join('\n\n').length>60000)return {sectionId,baseRevision:section.revision,text:'[NEEDS INPUT: selected evidence exceeds the section length limit. Select fewer accepted answers.]',claims:[],gaps:section.requirementIds,method:'approved-evidence assembly',gapReason};
 return {sectionId,baseRevision:section.revision,text:parts.join('\n\n'),claims,gaps,method:'approved-evidence assembly',gapReason,generatedAt:new Date().toISOString()};
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
 if(s.assessment?.stale)blockers.push('Bid assessment is stale.');
 const unique=[...new Set(blockers)];
 return {ready:unique.length===0,blockers:unique,blockerCounts:countBlockers(unique),wordCount:wc,pageCount:rendered?.contentHash===contentHash(s)?rendered.pages:null,pageCountScope:'Rendered PDF only; DOCX pagination is not measured.'};}
// The checklist total alone ("313 items") explains nothing. Classify each
// blocker by its kind so the UI can show the split; the prefixes are the
// blocker strings pushed above.
function countBlockers(blockers){
 const counts={requirements:0,attachments:0,sections:0,other:0,total:0};
 for(const b of blockers||[]){
  counts.total++;
  const text=String(b||'');
  if(text.startsWith('Mandatory/unclear requirement needs'))counts.requirements++;
  else if(text.startsWith('Required attachment missing'))counts.attachments++;
  else if(text.startsWith('Section needs content')||text.startsWith('Generated claim references'))counts.sections++;
  else counts.other++;
 }
 return counts;
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
  requireReviewer();const r=s.requirements.find(x=>x.id===p.requirementId);if(!r)kb.fail(404,'Requirement not found.');if(!['Compliant','Partial','Non-Compliant','Needs Review'].includes(p.status))kb.fail(400,'Invalid compliance decision.');if(r.reviewerId&&r.reviewerId!==user)kb.fail(403,'The assigned reviewer must decide this requirement.');if(p.disposition&&!['applicable','not applicable','extraction error'].includes(p.disposition))kb.fail(400,'Invalid requirement disposition.');r.disposition=p.disposition||'applicable';if(r.disposition!=='extraction error')delete r.duplicateOf;if(p.status==='Compliant'&&!excluded({...r,reviewReason:p.reason,reviewedBy:user})&&!procedural(r)&&(r.support!=='supported'||(!procedural(r)&&!activeEvidence(s,r.id).length)))kb.fail(400,'Supported current evidence is required; matching text alone is insufficient.');if(procedural(r)&&p.status==='Compliant')r.support='supported';r.status=p.status;r.reviewReason=text(p.reason,3000);r.reviewedBy=user;
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
 else if(action==='amendmentConfirm'){
  // Confirm one proposed change and apply it. The original version, its
  // review history and its approval history stay intact: wording changes
  // keep the stable ID and bump the requirement revision, approvals already
  // flagged needs-reconfirmation stay flagged until re-approved, and a
  // confirmed removal keeps the requirement in the project with a
  // removedByAmendment marker instead of deleting it. A confirmed addition
  // becomes a normal requirement, so a new mandatory readiness item derives
  // from it automatically. Any writable project member may confirm; a viewer
  // is blocked by the API layer.
  const {amendment,change}=findAmendmentChange(s,p.amendmentId,p.changeId);
  if(change.status!=='proposed')kb.fail(409,'This amendment change was already decided.');
  applyAmendmentChange(s,amendment,change,user);
  change.status='confirmed';change.decidedBy=user;change.decidedAt=new Date().toISOString();
  resolveAmendmentStatus(amendment);
 }
 else if(action==='amendmentCorrect'){
  // Correct a proposed change. 'reword' edits the proposed new wording (the
  // change stays proposed, re-classified if the dates changed). 'same'
  // resolves an uncertain match by linking it to a requirement the user
  // names, then applies the wording like a confirmed change and flags the
  // approval. 'different' says an uncertain match was wrong: the new
  // requirement becomes a proposed addition instead. A note is required so
  // the correction is reviewable later.
  const {amendment,change}=findAmendmentChange(s,p.amendmentId,p.changeId);
  if(change.status!=='proposed')kb.fail(409,'This amendment change was already decided.');
  const note=text(p.note,1000);
  if(p.correction==='reword'){
   if(!['changed','deadline-changed','instruction-changed','uncertain-match'].includes(change.type))kb.fail(400,'Only a wording change can be reworded.');
   change.newText=text(p.correctedText,5000);change.correctedText=change.newText;change.correctionNote=note;change.correctedBy=user;change.correctedAt=new Date().toISOString();
   const oldReq=(s.requirements||[]).find(x=>x.id===change.oldRequirementId);
   if(oldReq){const c=classifyAmendmentPair(oldReq,{text:change.newText,category:change.newCategory});change.type=c.type;change.deadlineChanged=c.deadlineChanged;}
  }else if(p.correction==='same'){
   if(change.type!=='uncertain-match')kb.fail(400,'Only an uncertain match can be linked to a named requirement.');
   const target=(s.requirements||[]).find(x=>(x.stableId||stableRequirementId(x))===p.targetStableId);
   if(!target)kb.fail(404,'Named requirement not found.');
   if(p.correctedText!==undefined&&p.correctedText!==null)change.newText=text(p.correctedText,5000);
   change.oldRequirementId=target.id;change.stableId=target.stableId||stableRequirementId(target);change.oldText=target.text;change.oldSources=amendmentSourceRefs(target);change.oldMandatory=target.mandatory;change.oldCategory=target.category;
   const c=classifyAmendmentPair(target,{text:change.newText,category:change.newCategory});change.type=c.type;change.deadlineChanged=c.deadlineChanged;change.matchMethod='human-corrected';change.similarity=null;
   flagAmendmentChange(s,change,user,'Uncertain match corrected to '+change.stableId+' by '+user+'; prior approval needs reconfirmation.');
   applyAmendmentChange(s,amendment,change,user);
   change.status='corrected';change.decidedBy=user;change.decidedAt=new Date().toISOString();change.correctionNote=note;change.correctedBy=user;change.correctedAt=new Date().toISOString();
   resolveAmendmentStatus(amendment);
  }else if(p.correction==='different'){
   if(change.type!=='uncertain-match')kb.fail(400,'Only an uncertain match can be split into a new requirement.');
   change.type='added';change.oldRequirementId=null;change.oldText=null;change.oldSources=[];change.oldMandatory=null;change.oldCategory=null;change.matchMethod='human-corrected';change.similarity=null;change.deadlineChanged=false;
   change.correctionNote=note;change.correctedBy=user;change.correctedAt=new Date().toISOString();
   // Stays proposed as an addition, so the user still confirms the new
   // requirement itself; the correction is recorded, not silently applied.
  }else kb.fail(400,'Choose how to correct the change.');
 }
 else if(action==='amendmentReject'){
  // Reject a proposed change. Nothing is applied, and an approval flagged
  // when the change was proposed is restored to its prior state (unless a
  // newer human decision has already replaced it). The rejection and its
  // reason stay on the change and in trace history.
  const {amendment,change}=findAmendmentChange(s,p.amendmentId,p.changeId);
  if(change.status!=='proposed')kb.fail(409,'This amendment change was already decided.');
  const reason=text(p.reason,1000);
  unflagAmendmentChange(s,change,user,'Amendment change rejected: '+reason);
  change.status='rejected';change.decidedBy=user;change.decidedAt=new Date().toISOString();change.decisionNote=reason;
  resolveAmendmentStatus(amendment);
 }
 else if(action==='applyStructureSuggestion'){
  // Accepting only reorders sections into the suggested template order and
  // renumbers titles to match; no section text, requirement link or
  // approval is touched. Sections the template does not cover keep their
  // relative order at the end. Anything missing from the saved sections
  // (for example after a re-import) is skipped, never invented.
  const suggestion=s.structureSuggestion;
  if(!suggestion||suggestion.status!=='suggested')kb.fail(409,'No suggested section order is waiting for a decision.');
  const byId=new Map(s.sections.map(x=>[x.id,x]));
  const ordered=[];
  for(const g of suggestion.groups||[])for(const id of g.sectionIds||[]){const x=byId.get(id);if(x&&!ordered.includes(x))ordered.push(x);}
  for(const id of suggestion.unmatchedSectionIds||[]){const x=byId.get(id);if(x&&!ordered.includes(x))ordered.push(x);}
  for(const x of s.sections)if(!ordered.includes(x))ordered.push(x);
  ordered.forEach((section,i)=>{
   const oldIndex=s.sections.indexOf(section);
   const requirement=s.requirements.find(r=>section.requirementIds.includes(r.id));
   section.title=`${i+1}. ${(requirement?requirement.text:section.title.replace(/^\d+\.\s*/,'')).slice(0,100)}`;
   if(oldIndex!==i){section.revision=(section.revision??0)+1;section.reviewReason='Section order changed by an accepted structure suggestion.';}
  });
  s.sections=ordered;
  s.structureSuggestion={...suggestion,status:'applied',appliedBy:user,appliedAt:new Date().toISOString(),appliedOrder:ordered.map(x=>x.id)};
 }
 else if(action==='dismissStructureSuggestion'){
  const suggestion=s.structureSuggestion;
  if(!suggestion||suggestion.status!=='suggested')kb.fail(409,'No suggested section order is waiting for a decision.');
  s.structureSuggestion={...suggestion,status:'dismissed',dismissedBy:user,dismissedAt:new Date().toISOString()};
 }
 else if(action==='mergeDuplicate'){
  // Reviewer-only merge of two near-identical requirements (sweep finding
  // #20, Nov 18, 2026). Nothing is deleted: the non-keeper is marked a
  // linked duplicate of the keeper (disposition 'extraction error' with a
  // recorded reason), so readiness, audit and trace counts drop it via
  // excluded(), and its evidence and section links move to the keeper. No
  // auto-merge at import; a human picks the keeper in the workspace. The
  // link lives in the project state JSON, so no migration is needed. A
  // reviewer can un-merge by changing the duplicate's disposition back in
  // reviewRequirement, which clears duplicateOf (evidence stays with the
  // keeper; re-merge if the links must move back).
  requireReviewer();
  const keeper=s.requirements.find(x=>x.id===p.keeperId),dup=s.requirements.find(x=>x.id===p.duplicateId);
  if(!keeper||!dup)kb.fail(404,'Requirement not found.');
  if(keeper.id===dup.id)kb.fail(400,'Choose two different requirements to merge.');
  if(dup.duplicateOf)kb.fail(409,'This requirement was already merged as a duplicate.');
  if(keeper.duplicateOf)kb.fail(409,'The kept requirement is itself a duplicate; keep the original instead.');
  const reason=text(p.reason,1000);
  const keeperStable=keeper.stableId||stableRequirementId(keeper);
  dup.duplicateOf=keeperStable;dup.disposition='extraction error';dup.reviewReason='Duplicate of '+keeperStable+' (merged by reviewer: '+reason+')';dup.reviewedBy=user;dup.status='Needs Review';
  for(const e of s.evidence.filter(e=>e.requirementId===dup.id)){
    if(s.evidence.some(x=>x.requirementId===keeper.id&&x.answerId===e.answerId&&x.revision===e.revision&&x.decision!=='rejected'))continue;
    e.requirementId=keeper.id;
  }
  for(const section of s.sections){
    const hadDup=section.requirementIds.includes(dup.id);
    section.requirementIds=[...new Set(section.requirementIds.map(id=>id===dup.id?keeper.id:id))];
    for(const c of section.claims||[])if(c.requirementId===dup.id)c.requirementId=keeper.id;
    if(hadDup){section.status='changes requested';section.unverified=true;}
  }
  evidenceSuggested(s,keeper.id,user);
  traceHistoryPush(ensureTrace(dup),{action:'duplicate-merged',actor:user,keeperStableId:keeperStable,reason,requirementRevision:dup.revision});
  traceHistoryPush(ensureTrace(keeper),{action:'duplicate-merged-into',actor:user,duplicateStableId:dup.stableId||stableRequirementId(dup),reason,requirementRevision:keeper.revision});
 }
 else if(action==='settings'){s.title=text(p.title,200);s.company={name:text(p.company,200),accent:/^#[a-f0-9]{6}$/i.test(p.accent)?p.accent:'#1d4ed8'};if(p.draftLanguage!==undefined)s.draftLanguage=normalizeDraftLanguage(p.draftLanguage);}
 else if(action==='bidDecision'){if(!['pursue','review','pass'].includes(p.decision)||!s.assessment||s.assessment.stale)kb.fail(400,'Run a current assessment before deciding.');s.decision={value:p.decision,reason:text(p.reason,3000),actor:user,assessmentHash:s.assessment.inputHash,createdAt:new Date().toISOString()};}
 else kb.fail(400,'Unknown project operation.');
 if(['reviewEvidence','reviewRequirement'].includes(action)){const req=action==='reviewEvidence'?s.evidence.find(e=>e.id===p.evidenceId)?.requirementId:p.requirementId;for(const section of s.sections.filter(x=>x.requirementIds.includes(req))){section.status='changes requested';section.unverified=true;}}
 if(action==='reviewEvidence'){const req=s.evidence.find(e=>e.id===p.evidenceId)?.requirementId,r=s.requirements.find(x=>x.id===req);
  if(r){const t=ensureTrace(r);const map={supported:'supported','partially supported':'partially-supported','missing evidence':'missing-evidence','needs review':'not-assessed'};t.coverage=map[p.support]||'not-assessed';t.coverageSource='human-confirmed';t.explanation=p.reason;t.reviewedBy=user;t.reviewedAt=new Date().toISOString();t.reviewedRequirementRevision=r.revision;t.reviewedEvidenceEpoch=evidenceEpoch;t.reviewedResponseRevision=responseRevision(s,r.id);t.needsReconfirmation=false;traceHistoryPush(t,{action:'coverage-assessed',actor:user,coverage:t.coverage,coverageSource:'human-confirmed',explanation:p.reason,requirementRevision:r.revision,evidenceEpoch,responseRevision:t.reviewedResponseRevision});invalidateResponseApproval(s,req,user,'Linked evidence decision changed after response approval.',true);}}
 if(action==='saveSection'||action==='acceptDraft'){const section=s.sections.find(x=>x.id===p.sectionId);if(section&&beforeSectionText.get(section.id)!==section.text)for(const reqId of section.requirementIds)invalidateResponseApproval(s,reqId,user,'Response text changed after approval; previous approval is preserved in history.');}
 s.finalApproval=null;if(!['bidDecision','comment','dismissStructureSuggestion'].includes(action)){if(s.assessment)s.assessment.stale=true;if(s.decision)s.decision.stale=true;}return s;
}
module.exports={invalidateRequirement,expired,excluded,procedural,initial,imported,apply,refresh,candidateFlags,draftSection,readiness,assessment,activeEvidence,explicitLimits,contentHash,hash,text,date,words,stableRequirementId,contentFingerprint,defaultTrace,ensureTrace,suggestCoverage,evidenceSuggested,mergeSuggestedEvidence,invalidateResponseApproval,markCoverageReconfirmation,traceSummary,unresolvedItems,responseHash,responseRevision,COVERAGES,READINESS_STATUSES,READINESS_KINDS,READINESS_MANUAL_LIMIT,READINESS_SCOPE_NOTE,readinessState,readinessItems,readinessSummary,readinessView,readinessItemUnresolved,factorCoverage,structureSuggestion,AMENDMENT_KINDS,AMENDMENT_CHANGE_TYPES,AMENDMENT_CHANGE_STATUSES,AMENDMENT_MAX_PER_PROJECT,AMENDMENT_MAX_REQUIREMENTS,AMENDMENT_MATCH_THRESHOLD,AMENDMENT_UNCERTAIN_THRESHOLD,AMENDMENT_SCOPE_NOTE,amendmentsState,amendmentRemoved,amendmentNormalize,amendmentSimilarity,extractAmendmentDates,normalizeAnalysisRequirements,amendmentSourceRefs,compareRequirements,amendmentSummary,amendmentAffectedWork,amendmentView,proposeAmendment,amendmentDeadlineFromTimetable,DRAFT_LANGUAGES,normalizeDraftLanguage};
