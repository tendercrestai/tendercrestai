const S=require('./lib/proposal-service');
const upgrade=require('./lib/customer-upgrade');
const {randomUUID}=require('node:crypto');
const {kb,core}=S;
const writable=['manager','author','reviewer'];
// Import-time structure suggestion (PR #76 catalogue): optional, gated on
// the reference flag, and never allowed to fail an import. A missing or
// unloadable catalogue, a failed load, or no matching template all leave
// the field null and the import proceeds exactly as before. The catalogue
// loader is injectable through adapters so tests can prove the failure
// path without touching the shipped catalogue.
function referenceRoot(){const path=require('node:path'),fs=require('node:fs');const roots=[path.resolve(process.cwd(),'reference-library'),path.resolve(__dirname,'../../reference-library')];return roots.find(p=>fs.existsSync(path.join(p,'catalogue.json')))||roots[0];}
function structureSuggestionFor(state,adapters){
 if(!S.isEnabled('reference'))return null;
 try{
  const catalogue=(adapters.structureCatalogue||(()=>require('./lib/reference-catalogue').load(referenceRoot(),'catalogue.json')))();
  return core.structureSuggestion(state,catalogue);
 }catch(e){console.error(JSON.stringify({event:'structure_suggestion_failed',error:String(e&&e.message||e)}));return null;}
}
function expected(payload,p){if(!Number.isSafeInteger(payload.revision)||payload.revision!==p.revision||payload.evidenceEpoch!==p.evidence_epoch)kb.fail(409,'This proposal changed. Reload saved changes before retrying.');}
function createHandler(adapters={}){return async event=>{
 try{
  S.enabled();const data=kb.parse(event,100000),config=kb.configuration(),{user,token}=await kb.authenticate(event,config);const action=data.action;await S.rpc(config,'admit',{p_org:null,p_user:user.id,p_action:'read'});
  if(action==='list'){
   kb.exact(data,['action','page','query','orgId']);const page=data.page??0;if(!Number.isSafeInteger(page)||page<0||page>1000||data.query!==undefined&&(typeof data.query!=='string'||data.query.length>200))kb.fail(400,'Invalid project search.');const query=new URLSearchParams({select:'id,org_id,title,revision,evidence_epoch,created_by,updated_at,state',order:'updated_at.desc,id.desc',limit:'51',offset:String(page*50)});if(data.query?.trim())query.set('title','ilike.*'+data.query.trim().replace(/[\*%]/g,'')+'*');if(data.orgId!==undefined)query.set('org_id','eq.'+kb.uuid(data.orgId));const rows=await kb.database(config,'pw_projects?'+query,{token});return kb.reply(200,{projects:rows.slice(0,50).map(({state,...p})=>({...p,grant:state?.grant===true})),page,hasMore:rows.length>50});
  }
  if(action==='create'){
   kb.exact(data,['action','orgId','title','company','grant']);const state=core.initial(data.title,data.company,data.grant===true);const id=await S.rpc(config,'create',{p_org:kb.uuid(data.orgId),p_user:user.id,p_title:state.title,p_state:state});return kb.reply(200,{id});
  }
  if(action==='clientUsage'){kb.exact(data,['action']);return kb.reply(200,await require('./lib/client-usage').clientUsage(config,user,token));}
  const readActions=['browse','get','trace','readiness','readinessReport','history','revision','download','job','preferences','notificationRead','referenceGuidance','amendments','amendmentReport'];const p=await S.project(config,user,data.projectId,(readActions.includes(action)||upgrade.READ.has(action))?undefined:writable);const memberRows=await S.members(config,p,user),me=memberRows.find(m=>m.user_id===user.id);if(!me)kb.fail(403,'Project access was removed.');const reviewer=['manager','reviewer'].includes(me.role)&&['owner','reviewer'].includes(me.orgRole);
  const enhanced=await upgrade.handle(data,{config,user,p,me,reviewer,expected});if(enhanced)return enhanced;
  if(action==='referenceGuidance'){
   kb.exact(data,['action','projectId','revision','evidenceEpoch','sectionId','jurisdiction','sector']);S.enabled('reference');expected(data,p);
   const result=(adapters.referenceGuidance||require('./lib/reference-guidance').guidance)(p,data);
   const current=await S.project(config,user,p.id);expected(data,current);return kb.reply(200,result);
  }
  if(action==='browse'){
   kb.exact(data,['action','projectId','kind','page']);const kinds={jobs:['pw_jobs','id,kind,revision,status,attempts,result,error_code,created_at'],files:['pw_files','id,name,kind,mime,size_bytes,revision,expires_at,created_at'],activity:['pw_events','id,action,revision,created_at'],notifications:['pw_notifications','id,kind,read_at,email_state,created_at'],assessments:['pw_assessments','id,revision,result,created_at'],approvals:['pw_approvals','id,section_id,revision,created_at']};const shape=kinds[data.kind],page=data.page??0;if(!Object.hasOwn(kinds,data.kind)||!shape||!Number.isSafeInteger(page)||page<0||page>1000)kb.fail(400,'Invalid saved-record page.');const query=new URLSearchParams({project_id:'eq.'+p.id,select:shape[1],order:'created_at.desc,id.desc',limit:'51',offset:String(page*50)});if(data.kind==='notifications')query.set('user_id','eq.'+user.id);const rows=await S.db(config,shape[0]+'?'+query);return kb.reply(200,{items:rows.slice(0,50),page,hasMore:rows.length>50});
  }
  if(action==='get'){kb.exact(data,['action','projectId']);return kb.reply(200,await S.workspace(config,user,p));}
  if(action==='trace'){kb.exact(data,['action','projectId']);return kb.reply(200,{trace:core.traceSummary(p.state,p.evidence_epoch),unresolved:core.unresolvedItems(p.state),revision:p.revision,evidenceEpoch:p.evidence_epoch});}
  if(action==='readiness'){kb.exact(data,['action','projectId']);return kb.reply(200,{readinessView:core.readinessView(p.state),revision:p.revision,evidenceEpoch:p.evidence_epoch});}
  if(action==='readinessReport'){kb.exact(data,['action','projectId']);return kb.reply(200,{report:require('./lib/proposal-export').readinessReportText({id:p.id,revision:p.revision,state:p.state}),filename:'readiness-report-rev'+p.revision+'.md',revision:p.revision,evidenceEpoch:p.evidence_epoch});}
  if(action==='amendments'){kb.exact(data,['action','projectId']);return kb.reply(200,{amendments:core.amendmentView(p.state),revision:p.revision,evidenceEpoch:p.evidence_epoch});}
  if(action==='amendmentReport'){kb.exact(data,['action','projectId','amendmentId']);return kb.reply(200,{report:require('./lib/proposal-export').amendmentImpactReportText({id:p.id,revision:p.revision,state:p.state},data.amendmentId||undefined),filename:'amendment-impact-report-rev'+p.revision+'.md',revision:p.revision,evidenceEpoch:p.evidence_epoch});}
  if(action==='history'){kb.exact(data,['action','projectId','page']);const page=data.page??0;if(!Number.isSafeInteger(page)||page<0||page>1000)kb.fail(400,'Invalid history page.');return kb.reply(200,{revisions:await S.db(config,'pw_revisions?project_id=eq.'+p.id+'&select=revision,actor_id,operation,evidence_epoch,created_at&order=revision.desc&limit=25&offset='+page*25),page});}
  if(action==='revision'){kb.exact(data,['action','projectId','revision']);if(!Number.isSafeInteger(data.revision)||data.revision<0)kb.fail(400,'Invalid revision.');const rows=await S.db(config,'pw_revisions?project_id=eq.'+p.id+'&revision=eq.'+data.revision+'&select=*');if(!rows[0])kb.fail(404,'Saved revision unavailable.');return kb.reply(200,{revision:rows[0]});}
  if(action==='download'){kb.exact(data,['action','projectId','fileId']);S.enabled('builder');return kb.reply(200,await S.signedFile(config,user,p,data.fileId));}
  if(action==='job'){kb.exact(data,['action','projectId','jobId']);const rows=await S.db(config,'pw_jobs?id=eq.'+kb.uuid(data.jobId)+'&project_id=eq.'+p.id+'&select=id,kind,revision,evidence_epoch,status,attempts,result,error_code');if(!rows[0])kb.fail(404,'Job not found.');return kb.reply(200,{job:rows[0]});}
  if(action==='preferences'){kb.exact(data,['action','projectId','email']);S.enabled('collaboration');if(typeof data.email!=='boolean')kb.fail(400,'Invalid preference.');await S.rpc(config,'preferences',{p_project:p.id,p_user:user.id,p_email:data.email});return kb.reply(200,{saved:true});}
  if(action==='notificationRead'){kb.exact(data,['action','projectId','notificationId']);await S.db(config,'pw_notifications?id=eq.'+kb.uuid(data.notificationId)+'&project_id=eq.'+p.id+'&user_id=eq.'+user.id,{method:'PATCH',body:{read_at:new Date().toISOString()}});return kb.reply(200,{saved:true});}
  if(action==='member'){
   kb.exact(data,['action','projectId','userId','role','remove']);S.enabled('collaboration');if(typeof data.remove!=='boolean')kb.fail(400,'Invalid membership state.');await S.rpc(config,'member',{p_project:p.id,p_user:user.id,p_target:kb.uuid(data.userId),p_role:data.role,p_remove:data.remove});return kb.reply(200,await S.workspace(config,user,await S.project(config,user,p.id)));
  }
  if(action==='delete'){
   kb.exact(data,['action','projectId','confirm']);if(me.role!=='manager'||p.created_by!==user.id||data.confirm!=='DELETE '+p.id)kb.fail(403,'Only the creator may explicitly delete this project.');const files=await S.db(config,'pw_files?project_id=eq.'+p.id+'&select=id,path');for(const f of files){if(f.path!==p.org_id+'/'+p.id+'/'+f.id)kb.fail(409,'Unexpected private path.');await S.storage(config,'object/'+S.BUCKET,'DELETE',JSON.stringify({prefixes:[f.path]}),'application/json');await S.db(config,'pw_files?id=eq.'+f.id+'&project_id=eq.'+p.id,{method:'DELETE'});}await S.rpc(config,'delete',{p_project:p.id,p_user:user.id});return kb.reply(200,{deleted:true});
  }
  expected(data,p);
  if(['saveSection','acceptDraft','generate','requestReview'].includes(action)){const section=p.state.sections.find(s=>s.id===data.sectionId);if(me.role==='author'&&section?.authorId&&section.authorId!==user.id)kb.fail(403,'This section is assigned to another author.');}
  if(action==='import'){
   kb.exact(data,['action','projectId','revision','evidenceEpoch','analysisId','confirmShare','amendment']);S.enabled('evidence');if(data.confirmShare!==true)kb.fail(400,'Confirm sharing this owned RFP snapshot and sources with project members.');if(!['owner','editor'].includes(me.orgRole))kb.fail(403,'Only an organization owner/editor may share source documents.');
   const legacy=await (adapters.compliance||require('./compliance').handler)({...event,body:JSON.stringify({action:'get',analysisId:kb.uuid(data.analysisId)})});if(legacy.statusCode!==200)kb.fail(legacy.statusCode,'The owned RFP analysis could not be imported.');const w=JSON.parse(legacy.body);S.verifyAnalysis(w);const state=core.imported(p.state,w,data.amendment===true);state.reviewedEpoch=p.evidence_epoch;
   state.structureSuggestion=structureSuggestionFor(state,adapters);
   const originalFiles=[];for(const doc of w.analysis.documents){const src=await kb.verifyDocument(config,token,user,doc.id,true);const file=await S.putFile(config,p,{name:doc.name,mime:src.mime_type||src.mime||kb.MIME[src.extension],bytes:src.bytes,kind:'source',sourceDocumentId:doc.id});originalFiles.push({id:file.id,documentId:doc.id});}
   state.inputFiles=originalFiles;const saved=await S.commit(config,user,p,state,data.amendment?'amendment':'import');return kb.reply(200,await S.workspace(config,user,saved));
  }
  if(action==='amendmentPropose'){
   // Capability 3: add a new solicitation version as a PROPOSED amendment.
   // Unlike import with amendment:true (which replaces the live snapshot),
   // this never touches the live requirements, responses, deadlines or
   // evidence links: it only records proposed changes for human review.
   // Documents come through the same supported upload/extraction pipeline
   // as import (owned analysis + verified source files stored as pw_files
   // kind source). The caller states whether the upload is a complete
   // replacement or a supplemental amendment; that choice decides whether an
   // absent requirement is "potentially removed" or merely "not mentioned".
   kb.exact(data,['action','projectId','revision','evidenceEpoch','analysisId','kind','confirmShare','versionNumber']);S.enabled('evidence');if(data.confirmShare!==true)kb.fail(400,'Confirm sharing this owned RFP snapshot and sources with project members.');if(!['owner','editor'].includes(me.orgRole))kb.fail(403,'Only an organization owner/editor may share source documents.');
   if(!core.AMENDMENT_KINDS.includes(data.kind))kb.fail(400,'Choose replacement or supplemental.');
   const legacy=await (adapters.compliance||require('./compliance').handler)({...event,body:JSON.stringify({action:'get',analysisId:kb.uuid(data.analysisId)})});if(legacy.statusCode!==200)kb.fail(legacy.statusCode,'The owned RFP analysis could not be imported.');const w=JSON.parse(legacy.body);S.verifyAnalysis(w);
   const newRequirements=core.normalizeAnalysisRequirements(w);
   const documentsCompared=w.analysis.documents.map(d=>({id:d.id,name:d.name}));
   // Deadline comparison: the pairwise requirement comparison cannot see
   // a deadline-only amendment, so pass the amendment's extracted
   // submission-deadline fact (with its source) through; the core
   // compares it with the project's stored deadline fact.
   const deadlineFact=(w.analysis.facts||[]).find(f=>f&&f.type==='Submission Deadline');
   let deadlineSources=[];
   if(deadlineFact){
    const segment=(w.analysis.documents||[]).flatMap(d=>(d.segments||[]).map(s=>({...s,document:d.name}))).find(s=>s.id===deadlineFact.segment_id);
    if(segment)deadlineSources=[{document:segment.document||'Source unavailable',section:segment.section||null,page:segment.page??null,quote:deadlineFact.quote||segment.text||''}];
   }
   // Documents the analysis reports but could not extract are named here;
   // a document missing from the analysis entirely cannot be named, and the
   // report says so instead of pretending the comparison was complete.
   const documentsUnprocessed=w.analysis.status==='Partial'?w.analysis.documents.filter(d=>!(d.segments&&d.segments.length)).map(d=>({id:d.id,name:d.name,reason:'No extracted segments in this analysis.'})):[];
   // Timetable fallback for the deadline: short amendment notices often
   // extract no Submission Deadline fact, so pass the analysis segment
   // text through on both sides and let the core read the response-due
   // row when the fact comparison cannot run. The project's stored
   // analysis is fetched the same way; a failed fetch only disables the
   // fallback, and proposing never fails on it.
   const amendmentTextSegments=(w.analysis.documents||[]).flatMap(d=>(d.segments||[]).map(s=>({...s,document:d.name})));
   let oldAnalysisTextSegments=null;
   try{
    if(p.state.analysis&&p.state.analysis.id){
     const prior=await (adapters.compliance||require('./compliance').handler)({...event,body:JSON.stringify({action:'get',analysisId:kb.uuid(p.state.analysis.id)})});
     if(prior.statusCode===200){const pw=JSON.parse(prior.body);oldAnalysisTextSegments=(pw.analysis.documents||[]).flatMap(d=>(d.segments||[]).map(s=>({...s,document:d.name})));}
    }
   }catch{/* Text fallback unavailable; the fact comparison still runs. */}
   const fileIds=[];for(const doc of w.analysis.documents){const src=await kb.verifyDocument(config,token,user,doc.id,true);const file=await S.putFile(config,p,{name:doc.name,mime:src.mime_type||src.mime||kb.MIME[src.extension],bytes:src.bytes,kind:'source',sourceDocumentId:doc.id});fileIds.push(file.id);}
   const state=core.proposeAmendment(p.state,{kind:data.kind,versionNumber:data.versionNumber??null,analysisId:w.analysis.id,sourceDocumentId:w.analysis.documents[0]?.id||null,fileIds,documentsCompared,documentsUnprocessed,newRequirements,amendmentFacts:w.analysis.facts||[],deadlineSources,amendmentTextSegments,oldAnalysisTextSegments},user.id);
   const amendment=state.amendments[state.amendments.length-1];
   const saved=await S.commit(config,user,p,state,'amendment.proposed',{amendmentId:amendment.id,versionNumber:amendment.versionNumber,kind:data.kind});
   return kb.reply(200,await S.workspace(config,user,saved));
  }
  if(action==='attachment'||action==='removeAttachment'){
   kb.exact(data,['action','projectId','revision','evidenceEpoch','documentId','requirementIds','fileId']);S.enabled('builder');const state=structuredClone(p.state);
   if(action==='removeAttachment'){state.attachments=state.attachments.filter(a=>a.fileId!==data.fileId);}
   else{if(!['owner','editor'].includes(me.orgRole))kb.fail(403,'An organization owner/editor must share attachments.');if(state.attachments.length>=10)kb.fail(400,'At most ten supporting attachments.');if(!Array.isArray(data.requirementIds)||data.requirementIds.some(id=>!state.requirements.some(r=>r.id===id)))kb.fail(400,'Choose current requirement IDs.');const docs=await S.db(config,'kb_documents?id=eq.'+kb.uuid(data.documentId)+'&org_id=eq.'+p.org_id+'&status=eq.Ready&select=*');const doc=docs[0];if(!doc)kb.fail(404,'Ready organization document unavailable.');const response=await S.storage(config,'object/authenticated/kb-documents/'+doc.storage_path);const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>10485760||require('node:crypto').createHash('sha256').update(bytes).digest('hex')!==doc.sha256)kb.fail(409,'Attachment integrity changed.');const file=await S.putFile(config,p,{name:doc.file_name,mime:doc.mime_type,bytes,kind:'attachment',sourceDocumentId:doc.id});state.attachments.push({fileId:file.id,documentId:doc.id,name:file.name,requirementIds:data.requirementIds});}
   state.finalApproval=null;return kb.reply(200,await S.workspace(config,user,await S.commit(config,user,p,state,'section.saved')));
  }
  if(action==='matchEvidence'){
   kb.exact(data,['action','projectId','revision','evidenceEpoch','requirementId']);S.enabled('evidence');const r=p.state.requirements.find(r=>r.id===data.requirementId);if(!r)kb.fail(404,'Requirement unavailable.');const values=await S.rpc(config,'candidates',{p_project:p.id,p_user:user.id,p_query:r.text.slice(0,2000)});const ranked=values.map(v=>core.candidateFlags(v,values));const state=structuredClone(p.state);const kept=core.mergeSuggestedEvidence(state,r.id,ranked);if(!kept){core.invalidateRequirement(state.requirements.find(x=>x.id===r.id),'Evidence suggestions replaced; review support and compliance.');state.requirements.find(x=>x.id===r.id).support=ranked.length?'needs review':'missing evidence';}core.evidenceSuggested(state,r.id,user.id);state.reviewedEpoch=p.evidence_epoch;state.finalApproval=null;if(state.assessment)state.assessment.stale=true;for(const section of state.sections.filter(x=>x.requirementIds.includes(r.id)))section.status='changes requested';const saved=await S.commit(config,user,p,state,'evidence.suggested',{requirementId:r.id});await S.recordTrace(config,saved,user.id,r.id);return kb.reply(200,await S.workspace(config,user,saved));
  }
  if(action==='linkEvidence'){
   kb.exact(data,['action','projectId','revision','evidenceEpoch','requirementId','answerId']);S.enabled('evidence');const r=p.state.requirements.find(r=>r.id===data.requirementId);if(!r)kb.fail(404,'Requirement unavailable.');
   // Permission-enforced lookup: pw_candidates requires explicit project
   // membership (pw_require) and only returns this org's approved answers.
   // An answer that is not returned here cannot be linked, whatever the caller sends.
   const values=await S.rpc(config,'candidates',{p_project:p.id,p_user:user.id,p_query:r.text.slice(0,2000)});
   const found=values.find(v=>v.answerId===data.answerId);if(!found)kb.fail(404,'Evidence is not available to this project.');
   const flagged=core.candidateFlags(found,values);const state=core.apply(p.state,'linkEvidence',{requirementId:r.id,evidence:{answerId:flagged.answerId,revision:flagged.revision,question:flagged.question,text:flagged.text,citations:flagged.citations||[]}},user.id,{reviewer,members:memberRows,evidenceEpoch:p.evidence_epoch});
   const saved=await S.commit(config,user,p,state,'evidence.reviewed',{requirementId:r.id});await S.recordTrace(config,saved,user.id,r.id);return kb.reply(200,await S.workspace(config,user,saved));
  }
  if(action==='generate'||action==='export'||action==='retryJob'){
   kb.exact(data,['action','projectId','revision','evidenceEpoch','sectionId','requestKey','draft','jobId','mode','consent']);S.enabled('builder');let job;
   if(action==='retryJob'){const rows=await S.db(config,'pw_jobs?id=eq.'+kb.uuid(data.jobId)+'&project_id=eq.'+p.id+'&requested_by=eq.'+user.id+'&select=*');job=rows[0];if(!job||!['Failed','Pending','Processing'].includes(job.status))kb.fail(409,'No retryable job found.');}
   else{
    if(action==='generate'&&data.mode){S.enabled('intelligence');if(data.consent!==true||!require('./lib/proposal-writing').MODES.includes(data.mode))kb.fail(400,'Confirm sending this section and its accepted excerpts to the configured AI provider.');}
    if(action==='generate'&&!p.state.sections.some(s=>s.id===data.sectionId))kb.fail(404,'Section unavailable.');const input=action==='generate'?{sectionId:data.sectionId,...(data.mode?{mode:data.mode,promptVersion:'proposal-writing-v1',language:core.normalizeDraftLanguage(p.state.draftLanguage)}:{})}:{draft:data.draft===true,contentHash:core.contentHash(p.state)};
    if(action==='export'&&data.draft!==true){upgrade.requireAudit(p);const view=await S.workspace(config,user,p);if(!view.readiness.ready||!p.state.finalApproval||p.state.finalApproval.contentHash!==core.contentHash(p.state))kb.fail(409,'Resolve the checklist and obtain final sign-off, or explicitly export a draft.');}
    job=await S.rpc(config,'enqueue',{p_project:p.id,p_user:user.id,p_revision:p.revision,p_epoch:p.evidence_epoch,p_kind:action==='generate'?'draft':'export',p_key:kb.uuid(data.requestKey),p_input:input});
   }return kb.reply(202,{job,dispatchPending:await S.dispatch(job)});
  }
  if(action==='acceptDraft'){
   kb.exact(data,['action','projectId','revision','evidenceEpoch','sectionId','jobId','confirmReplace']);S.enabled('builder');if(data.confirmReplace!==true)kb.fail(400,'Preview and explicitly accept replacing this section.');const rows=await S.db(config,'pw_jobs?id=eq.'+kb.uuid(data.jobId)+'&project_id=eq.'+p.id+'&kind=eq.draft&status=eq.Completed&select=*');const j=rows[0];if(!j||j.revision!==p.revision||j.evidence_epoch!==p.evidence_epoch||j.result.sectionId!==data.sectionId)kb.fail(409,'This preview is stale; regenerate against the saved revision.');const state=core.apply(p.state,'acceptDraft',{...data,preview:j.result},user.id);return kb.reply(200,await S.workspace(config,user,await S.commit(config,user,p,state,'draft.accepted',{sectionId:data.sectionId})));
  }
  if(action==='assess'){
   kb.exact(data,['action','projectId','revision','evidenceEpoch']);S.enabled('bid');const state=structuredClone(p.state);state.assessment=core.assessment(state,p.evidence_epoch);if(state.decision)state.decision.stale=state.decision.assessmentHash!==state.assessment.inputHash;const saved=await S.commit(config,user,p,state,'bid.assessed');await S.db(config,'pw_assessments',{method:'POST',body:{project_id:p.id,revision:saved.revision,evidence_epoch:p.evidence_epoch,input_hash:state.assessment.inputHash,inputs:{requirements:state.requirements,evidence:state.evidence,weights:state.weights,bidInputs:state.bidInputs},result:state.assessment,actor_id:user.id}});return kb.reply(200,await S.workspace(config,user,saved));
  }
  if(action==='finalApprove'){
   kb.exact(data,['action','projectId','revision','evidenceEpoch','reason']);S.enabled('collaboration');if(!reviewer)kb.fail(403,'An authorized manager/reviewer must sign off.');upgrade.requireAudit(p);const view=await S.workspace(config,user,p);if(!view.readiness.ready)kb.fail(409,'The submission checklist has unresolved blockers.');const state=structuredClone(p.state);state.finalApproval={actor:user.id,reason:core.text(data.reason,3000),contentHash:core.contentHash(state),evidenceEpoch:p.evidence_epoch,createdAt:new Date().toISOString()};return kb.reply(200,await S.workspace(config,user,await S.commit(config,user,p,state,'project.approved')));
  }
  const operations={settings:['section.saved','builder',['title','company','accent','draftLanguage','grant']],budget:['section.saved','builder',['rows','narrative']],applyStructureSuggestion:['section.saved','reference',[]],dismissStructureSuggestion:['section.saved','reference',[]],reviewWarnings:['evidence.reviewed','evidence',['reason']],saveSection:['section.saved','builder',['sectionId','sectionRevision','text']],reviewEvidence:['evidence.reviewed','evidence',['evidenceId','decision','support','reason','overrideConflict']],reviewRequirement:['evidence.reviewed','evidence',['requirementId','status','reason','disposition']],mergeDuplicate:['evidence.reviewed','evidence',['keeperId','duplicateId','reason']],assessCoverage:['evidence.reviewed','evidence',['requirementId','coverage','explanation']],approveResponse:['review.approved','collaboration',['requirementId','explanation']],readinessItem:['readiness.updated','collaboration',['itemId','status','owner','dueAt','naReason']],readinessAddManual:['readiness.manual-added','collaboration',['title','kind','category','mandatory','source']],readinessCorrect:['readiness.corrected','collaboration',['stableId','text','category','mandatory','note']],readinessDeleteManual:['readiness.manual-removed','collaboration',['itemId']],amendmentConfirm:['amendment.confirmed','collaboration',['amendmentId','changeId']],amendmentCorrect:['amendment.corrected','collaboration',['amendmentId','changeId','correction','targetStableId','correctedText','note']],amendmentReject:['amendment.rejected','collaboration',['amendmentId','changeId','reason']],requestReview:['review.requested','collaboration',['sectionId']],reviewSection:['review.approved','collaboration',['sectionId','sectionRevision','status','reason','confirmEvidence']],assign:['assignment.updated','collaboration',['sectionId','requirementId','authorId','reviewerId','dueAt']],comment:['comment.added','collaboration',['sectionId','requirementId','text','mentions']],bidInputs:['bid.assessed','bid',['inputs','weights']],bidDecision:['bid.decided','bid',['decision','reason']]};
  const operation=operations[action];if(!operation)kb.fail(400,'Unknown proposal action.');kb.exact(data,['action','projectId','revision','evidenceEpoch',...operation[2]]);S.enabled(operation[1]);
  if(action==='saveSection'){const section=p.state.sections.find(x=>x.id===data.sectionId);if(me.role==='author'&&section?.authorId&&section.authorId!==user.id)kb.fail(403,'This section is assigned to another author.');}
  const state=core.apply(p.state,action,data,user.id,{reviewer,members:memberRows,evidenceEpoch:p.evidence_epoch});const op=action==='reviewSection'&&data.status==='changes requested'?'review.changes':operation[0];const saved=await S.commit(config,user,p,state,op,{...(data.sectionId?{sectionId:data.sectionId}:{}),...(data.requirementId?{requirementId:data.requirementId}:{}),...(data.amendmentId?{amendmentId:data.amendmentId}:{}),...(data.changeId?{changeId:data.changeId}:{}),...(data.keeperId?{keeperId:data.keeperId}:{}),...(data.duplicateId?{duplicateId:data.duplicateId}:{})});
  if(['assessCoverage','approveResponse','reviewEvidence','mergeDuplicate'].includes(action))await S.recordTrace(config,saved,user.id,data.requirementId||data.keeperId||state.evidence.find(e=>e.id===data.evidenceId)?.requirementId);
  if(action.startsWith('amendment')){const am=saved.state.amendments?.find(x=>x.id===data.amendmentId);const ch=am?.changes.find(x=>x.id===data.changeId);if(ch?.oldRequirementId)await S.recordTrace(config,saved,user.id,ch.oldRequirementId);}
  return kb.reply(200,await S.workspace(config,user,saved));
 }catch(e){return kb.reply(e.status||503,{error:e.status?e.message:'Proposal workspace is temporarily unavailable. Saved work remains available.'});}
};}
exports.handler=createHandler();exports.createHandler=createHandler;
