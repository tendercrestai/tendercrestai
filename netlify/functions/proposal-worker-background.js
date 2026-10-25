const {randomUUID}=require('node:crypto');
const S=require('./lib/proposal-service');
async function run(config,id){
 const lease=randomUUID(),claimed=await S.rpc(config,'claim',{p_job:S.kb.uuid(id),p_lease:lease});if(claimed.done)return {done:true};const {job,project}=claimed;
 try{
  S.enabled(job.kind==='draft'?'builder':'builder');const current=await S.project(config,{id:job.requested_by},project.id);if(current.revision!==job.revision||current.evidence_epoch!==job.evidence_epoch)throw Error('revision_changed');let result;
  if(job.kind==='draft'){if(job.input.mode){S.enabled('intelligence');await S.rpc(config,'admit',{p_org:current.org_id,p_user:job.requested_by,p_action:'draft'});result=await require('./lib/proposal-writing').write(current.state,job.input.sectionId,job.input.mode);}else result=S.core.draftSection(current.state,job.input.sectionId);}
  else{
   const attachments=[];for(const f of current.state.attachments){const records=await S.db(config,'pw_files?id=eq.'+S.kb.uuid(f.fileId)+'&project_id=eq.'+project.id+'&kind=eq.attachment&select=*');const record=records[0];if(!record)throw Error('attachment_unavailable');const docs=await S.db(config,'kb_documents?id=eq.'+S.kb.uuid(record.source_document_id)+'&org_id=eq.'+project.org_id+'&status=eq.Ready&select=id');if(!docs[0])throw Error('attachment_source_changed');const r=await S.storage(config,'object/authenticated/'+S.BUCKET+'/'+record.path);const bytes=Buffer.from(await r.arrayBuffer());if(require('node:crypto').createHash('sha256').update(bytes).digest('hex')!==record.sha256)throw Error('attachment_integrity');attachments.push({id:record.id,name:record.name,bytes});}
   const output=await require('./lib/proposal-export').packageFiles(current,{draft:job.input.draft,attachments});await S.project(config,{id:job.requested_by},project.id);
   const file=await S.putFile(config,current,{id:job.id,name:'submission-r'+job.revision+'.zip',mime:'application/zip',bytes:output.zip,kind:'export',expiresAt:new Date(Date.now()+7*86400000).toISOString()});
   result={fileId:file.id,revision:job.revision,evidenceEpoch:job.evidence_epoch,contentHash:output.measured.contentHash,pages:output.measured.pages,submissionReady:output.manifest.submissionReady,unresolvedItems:output.manifest.unresolvedItems,draft:output.manifest.draft};
  }
  const saved=await S.rpc(config,'finish',{p_job:job.id,p_lease:lease,p_result:result,p_error:null});return {saved};
 }catch{
  await S.rpc(config,'finish',{p_job:job.id,p_lease:lease,p_result:null,p_error:'job_failed'});return {failed:true};
 }
}
exports.handler=async event=>{try{S.enabled();S.kb.verifyWorker(event);const body=S.kb.parse(event,2000);S.kb.exact(body,['jobId']);await run(S.kb.configuration(),body.jobId);return S.kb.reply(200,{accepted:true});}catch(e){return S.kb.reply(e.status||503,{error:e.status?e.message:'Background job failed; saved work remains available.'});}};
exports.run=run;
