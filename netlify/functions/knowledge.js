const kb=require('./lib/knowledge-base');
function createHandler(adapters={}) {
 const embed=adapters.embed||kb.embed;
 return async event=>{
  try {
   kb.enabled();const p=kb.parse(event);const config=kb.configuration();const {user,token}=await kb.authenticate(event,config);
   if(p.action==='organizations') {kb.exact(p,['action']);const rows=await kb.database(config,'kb_memberships?user_id=eq.'+user.id+'&active=eq.true&select=org_id,role,kb_organizations(id,name)',{token});return kb.reply(200,{organizations:rows});}
   if(p.action==='bootstrap') {kb.exact(p,['action','name']);const id=await kb.rpc(config,'kb_bootstrap',{p_user:user.id,p_name:kb.text(p.name,200)});return kb.reply(200,{id});}
   const org=kb.uuid(p.orgId);const role=await kb.membership(config,token,user,org);
   const actor={p_org:org,p_user:user.id};
   if(p.action==='list') {
    kb.exact(p,['action','orgId']);const [documents,answers]=await Promise.all([kb.database(config,'kb_documents?org_id=eq.'+org+'&select=id,file_name,status,warnings,error_code,created_at&order=created_at.desc&limit=100',{token}),kb.database(config,'kb_answers?org_id=eq.'+org+'&select=id,question,answer,revision,approved_revision,approved_by,approved_at,kb_answer_citations(chunk_id)&order=updated_at.desc&limit=100',{token})]);return kb.reply(200,{role,documents,answers});
   }
   if(p.action==='audit') {kb.exact(p,['action','orgId']);return kb.reply(200,{events:await kb.database(config,'kb_audit_events?org_id=eq.'+org+'&select=action,target_id,revision,created_at,actor_id&order=created_at.desc&limit=100',{token})});}
   if(p.action==='register') {
    kb.exact(p,['action','orgId','name','extension','mime','size','sha256']);const name=kb.text(p.name,200);if(/[\\/\x00-\x1f\x7f]/.test(name)||!Object.hasOwn(kb.MIME,p.extension)||p.mime!==kb.MIME[p.extension]||!Number.isInteger(p.size)||p.size<1||p.size>10485760||typeof p.sha256!=='string'||!/^[a-f0-9]{64}$/.test(p.sha256))kb.fail(400,'Invalid source metadata.');
    return kb.reply(200,{document:await kb.rpc(config,'kb_register',{...actor,p_name:name,p_extension:p.extension,p_mime:p.mime,p_size:p.size,p_hash:p.sha256})});
   }
   if(p.action==='process') {
    kb.exact(p,['action','orgId','documentId','consent']);if(p.consent!==true)kb.fail(400,'Confirm consent to send extracted source text to the embedding provider.');const settings=kb.workerSettings();kb.embeddingSettings();const job=await kb.rpc(config,'kb_enqueue',{...actor,p_document:kb.uuid(p.documentId)});let dispatchPending=false;
    if(!job.done){try{const r=await fetch(settings.url,{method:'POST',headers:{'Content-Type':'application/json','x-kb-worker-secret':settings.secret},body:JSON.stringify({jobId:job.job_id}),signal:AbortSignal.timeout(5000)});dispatchPending=!r.ok;}catch{dispatchPending=true;}}
    return kb.reply(202,{...job,dispatchPending});
   }
   if(p.action==='source') {
    kb.exact(p,['action','orgId','documentId']);const id=kb.uuid(p.documentId);const docs=await kb.database(config,'kb_documents?id=eq.'+id+'&org_id=eq.'+org+'&status=eq.Ready&select=id,file_name,storage_path,warnings',{token});if(!docs[0])kb.fail(404,'Source not found.');const chunks=await kb.database(config,'kb_chunks?document_id=eq.'+id+'&org_id=eq.'+org+'&select=id,content,page,section,segment_id,start_offset&order=ordinal&limit=80',{token});return kb.reply(200,{document:docs[0],chunks});
   }
   if(p.action==='search') {
    kb.exact(p,['action','orgId','query']);const query=kb.text(p.query,2000);kb.embeddingSettings();await kb.rpc(config,'kb_search_admit',actor);const [embedding]=await embed([query]);return kb.reply(200,await kb.rpc(config,'kb_search',{...actor,p_embedding:embedding}));
   }
   if(p.action==='saveAnswer') {
    kb.exact(p,['action','orgId','id','revision','question','answer','chunkIds']);if(p.id!==null&&p.id!==undefined)kb.uuid(p.id);if(!Number.isSafeInteger(p.revision)||p.revision<0||!Array.isArray(p.chunkIds)||p.chunkIds.length<1||p.chunkIds.length>10||new Set(p.chunkIds).size!==p.chunkIds.length)kb.fail(400,'Invalid answer revision or citations.');p.chunkIds.forEach(kb.uuid);
    return kb.reply(200,{answer:await kb.rpc(config,'kb_save_answer',{...actor,p_id:p.id||null,p_revision:p.revision,p_question:kb.text(p.question,1000),p_answer:kb.text(p.answer,12000),p_chunks:p.chunkIds})});
   }
   if(p.action==='approve') {
    kb.exact(p,['action','orgId','id','revision']);if(!Number.isSafeInteger(p.revision)||p.revision<0)kb.fail(400,'Invalid revision.');return kb.reply(200,{answer:await kb.rpc(config,'kb_approve_answer',{...actor,p_id:kb.uuid(p.id),p_revision:p.revision})});
   }
   if(p.action==='archive') {kb.exact(p,['action','orgId','documentId']);await kb.rpc(config,'kb_archive',{...actor,p_document:kb.uuid(p.documentId)});return kb.reply(200,{archived:true});}
   kb.fail(400,'Unknown knowledge action.');
  }catch(e){return kb.reply(e.status||503,{error:e.status?e.message:'Knowledge service is temporarily unavailable.'});}
 };
}
exports.handler=createHandler();exports.createHandler=createHandler;
