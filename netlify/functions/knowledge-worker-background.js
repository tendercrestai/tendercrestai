const {randomUUID}=require('node:crypto');
const kb=require('./lib/knowledge-base');
const {extractDocument}=require('./lib/compliance-document');
// Knowledge documents are evidence sources, not free-tool RFPs, so they get
// higher extraction limits: 700,000 characters / 500 citation chunks covers
// a ~580,000-character 188-page winning proposal with headroom. Embedding
// cost at that size is a fraction of a cent. The matching database bound
// (kb_finish_job, 80 chunks) is raised to 500 by migration
// 20261117010000_kb_large_documents.sql, which must be applied in the
// Supabase dashboard before a large document can finish processing.
const KB_MAX_TEXT=700000,KB_MAX_CHUNKS=500;
function createHandler(adapters={}) {
 const extract=adapters.extractDocument||extractDocument,embed=adapters.embed||kb.embed;
 return async event=>{
  let config,jobId,lease,claimed=false,errorCode='source_invalid';
  try {
   kb.enabled();kb.verifyWorker(event);const p=kb.parse(event,1024);kb.exact(p,['jobId']);jobId=kb.uuid(p.jobId);kb.embeddingSettings();config=kb.configuration();lease=randomUUID();const doc=await kb.rpc(config,'kb_claim_job',{p_job:jobId,p_lease:lease});if(!doc)return kb.reply(200,{processed:false});claimed=true;
   const source=await kb.originalBytes(config,doc);errorCode='extraction_failed';const document=await extract(source,{maxText:KB_MAX_TEXT});const chunks=kb.citationChunks(document,{maxChunks:KB_MAX_CHUNKS});errorCode='embedding_failed';
   for(let i=0;i<chunks.length;i+=16){const vectors=await embed(chunks.slice(i,i+16).map(c=>c.content));if(vectors.length!==Math.min(16,chunks.length-i))kb.fail(502,'Invalid embedding batch.');vectors.forEach((v,j)=>{chunks[i+j].embedding=kb.vector(v);});}
   const warnings=document.warnings.slice(0,30).map(w=>w.slice(0,300));if(document.warnings.length>30)warnings[29]='Additional extraction warnings omitted; review the original source.';
   const saved=await kb.rpc(config,'kb_finish_job',{p_job:jobId,p_lease:lease,p_chunks:chunks,p_warnings:warnings});return kb.reply(saved?200:409,{processed:saved});
  }catch(e){
   if(claimed){try{await kb.rpc(config,'kb_fail_job',{p_job:jobId,p_lease:lease,p_error:errorCode});}catch{console.error(JSON.stringify({event:'knowledge_job_fail_failed',jobId:jobId||null,error:errorCode}));}}
   // Structured failure log: job id + sanitized error class only, never
   // source text or secrets (errorCode is one of three allowlisted codes).
   console.error(JSON.stringify({event:'knowledge_job_failed',jobId:jobId||null,error:errorCode}));
   return kb.reply(e.status||503,{error:e.status?e.message:'Background processing failed. Inspect the saved job before retrying.'});
  }
 };
}
exports.handler=createHandler();exports.createHandler=createHandler;exports.KB_MAX_TEXT=KB_MAX_TEXT;exports.KB_MAX_CHUNKS=KB_MAX_CHUNKS;
