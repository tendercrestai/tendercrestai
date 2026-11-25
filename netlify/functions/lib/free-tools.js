const crypto=require('node:crypto'),kb=require('./knowledge-base'),doc=require('./compliance-document'),ai=require('./compliance-ai');
const enabled=()=>process.env.FREE_TOOLS_ENABLED==='true';
const db=(c,p,o={})=>kb.database(c,p,{...o,service:true,fetcher:(url,options)=>fetch(url,{...options,headers:{...options.headers,Prefer:'return=representation'}})});
function mac(value){const s=process.env.ANALYTICS_SIGNING_SECRET;if(!s||s.length<32)kb.fail(503,'Free tools are temporarily unavailable.');return crypto.createHmac('sha256',s).update('free-tools:'+value).digest('hex');}
function ip(event){const v=event.headers?.['x-nf-client-connection-ip'];if(typeof v!=='string'||!/^[a-fA-F0-9:.]{1,100}$/.test(v))kb.fail(400,'Request could not be admitted.');return mac(new Date().toISOString().slice(0,10)+':'+v);}
function sign(id){return id+'.'+mac('job:'+id);}
function verify(t){if(typeof t!=='string'||t.length>150)kb.fail(401,'Result link is invalid.');const [id,sig,...extra]=t.split('.');if(!kb.UUID.test(id)||extra.length||!sig||!/^[a-f0-9]{64}$/.test(sig)||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(mac('job:'+id))))kb.fail(401,'Result link is invalid.');return id;}
async function job(config,token){const id=verify(token),rows=await db(config,'ft_jobs?id=eq.'+id+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString()));if(!rows[0])kb.fail(404,'This result expired. Start a new shred.');return rows[0];}
async function dispatch(id){try{const {url,secret}=kb.workerSettings();const target=new URL('/.netlify/functions/free-tools-worker-background',url);const r=await fetch(target,{method:'POST',headers:{'Content-Type':'application/json','x-kb-worker-secret':secret},body:JSON.stringify({id}),signal:AbortSignal.timeout(5000)});return r.status===202;}catch{return false;}}
function view(j){return {token:sign(j.id),status:j.status,processed:j.processed,total:j.chunks.length,title:j.title,source:j.source,warnings:j.warnings,error:j.error,requirements:j.status==='Completed'?j.requirements.map((r,i)=>({number:i+1,requirement:r.requirement,mandatory:r.mandatory,category:r.category,sources:r.sources})):[],gapPreview:j.status==='Completed'?j.requirements.slice(0,5).map(r=>({requirement:r.requirement,flag:r.recommendation,status:'Needs human review; response and evidence not supplied'})):[],gapCount:j.status==='Completed'?j.requirements.length:0};}
async function prepare(p){const id=crypto.randomUUID();let bytes,extension,name;
 if(p.file){kb.exact(p.file,['name','extension','data']);extension=p.file.extension;if(!['pdf','docx'].includes(extension)||typeof p.file.data!=='string'||p.file.data.length>2800000||!/^[A-Za-z0-9+/]*={0,2}$/.test(p.file.data)||typeof p.file.name!=='string'||p.file.name.length>200)kb.fail(413,'Upload a PDF or DOCX up to 2 MB.');bytes=Buffer.from(p.file.data,'base64');if(bytes.length>2*1024*1024)kb.fail(413,'Upload a PDF or DOCX up to 2 MB.');name=p.file.name;if(name.split('.').pop().toLowerCase()!==extension)kb.fail(400,'Document extension mismatch.');
 }else{if(typeof p.text!=='string'||p.text.trim().length<40||p.text.length>doc.MAX_TEXT)kb.fail(413,'Paste 40 to '+doc.MAX_TEXT.toLocaleString('en-US')+' characters. This tool reuses the existing parser limit.');bytes=Buffer.from(p.text);extension='txt';name=p.title||'Pasted solicitation';}
 if(!bytes.length)kb.fail(400,'The input is empty.');const document=await doc.extractDocument({bytes,extension,metadata:{id,file_name:name,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}});return {documents:[document],chunks:doc.chunkDocuments([document]),warnings:document.warnings};
}
const VALIDATION_MESSAGE = 'AI output failed source validation. Retry this chunk or review the source manually.';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Transient provider failures (rate limits, 5xx, timeouts) are worth one or two
// quick retries inside the per-chunk 3-attempt budget; source-validation failures
// keep exactly one retry, as before. Anything else fails the chunk immediately.
// providerStatus is the real HTTP status seen by the fetcher wrapper: analyzeChunk
// collapses every non-OK provider response to RequestError 502, so the status
// alone cannot tell a 429 from a validation 502 (the validation message can).
function isTransientProviderError(error, providerStatus) {
  if (error && error.message === VALIDATION_MESSAGE) return false;
  if (providerStatus === 429 || (Number.isInteger(providerStatus) && providerStatus >= 500)) return true;
  if (!error) return false;
  if (error.name === 'TimeoutError') return true;
  if (error.status === 429 || (Number.isInteger(error.status) && error.status >= 500)) return true;
  return /timeout|timed out|ECONNRESET|EAI_AGAIN|socket hang up|network/i.test(error.message || '');
}
// A job may be re-dispatched while work remains: Pending, lease-expired
// Processing, or Failed with chunks left (the ft_claim migration bounds Failed
// re-claims to the 3-claim budget; without it, re-dispatch of a Failed job is a
// harmless no-op because ft_claim ignores Failed jobs).
function resumable(j) {
  return !!j && (j.status === 'Pending' || j.status === 'Failed' ||
    (j.status === 'Processing' && Date.parse(j.lease_until) < Date.now()));
}
async function processJob(config,id){let j=await kb.rpc(config,'ft_claim',{p_id:kb.uuid(id)});if(!j)return;let providerStatus=null,outputSummary='';try{
 for(let n=0;n<3&&j.processed<j.chunks.length;n++){
  let result;for(let attempt=0;attempt<3;attempt++){providerStatus=null;await kb.rpc(config,'ft_admit',{p_ip:j.ip_hash,p_kind:'ai',p_limit:16,p_global:24});try{result=await ai.analyzeChunk(j.chunks[j.processed],j.documents,async(...args)=>{const response=await fetch(...args);providerStatus=response.status;if(response.ok){try{const choice=(await response.clone().json()).choices?.[0];let parsed;try{parsed=JSON.parse(choice?.message?.content);}catch{}outputSummary=' Finish '+String(choice?.finish_reason||'unknown').replace(/[^a-z_]/g,'').slice(0,20)+', requirements '+(Array.isArray(parsed?.requirements)?parsed.requirements.length:'unreadable')+', facts '+(Array.isArray(parsed?.facts)?parsed.facts.length:'unreadable')+'.';}catch{}}return response;},
  // A shred started from a Grants.gov notice uses the NOFO-tuned prompt:
  // the job source is the Grants.gov opportunity URL. Anything else keeps
  // the procurement prompt. The job row persists the source, so every
  // chunk of the same shred uses the same prompt.
  {grant:typeof j.source==='string'&&/grants\.gov/i.test(j.source)});break;}catch(error){const validation=error.message===VALIDATION_MESSAGE;const retryable=validation?attempt===0:isTransientProviderError(error,providerStatus);if(attempt===2||!retryable)throw error;await sleep(250*Math.pow(2,attempt));}}j.requirements=ai.deduplicate([...j.requirements,...result.requirements]);j.processed++;
  await db(config,'ft_jobs?id=eq.'+id,{method:'PATCH',body:{requirements:j.requirements,processed:j.processed}});
 }
 const complete=j.processed===j.chunks.length;await db(config,'ft_jobs?id=eq.'+id,{method:'PATCH',body:{status:complete?'Completed':'Pending',lease_until:null,...(complete?{error:null}:{})}});if(!complete)await dispatch(id);
 }catch(e){const reason=providerStatus&&providerStatus!==200?' AI provider HTTP '+providerStatus+'.':e.message===VALIDATION_MESSAGE?' Source validation did not pass.'+outputSummary:e.name==='TimeoutError'?' The AI request timed out.':e.status===503?' AI or database configuration is unavailable.':'';await db(config,'ft_jobs?id=eq.'+id,{method:'PATCH',body:{status:'Failed',lease_until:null,error:'Analysis could not finish.'+reason+' No compliance result is implied. Try later or use the source manually.'}});}}
async function mail(config,j,lead,report=null){if(!process.env.RESEND_API_KEY)return {customer:'Unavailable',admin:'Unavailable'};
 const states={customer:lead.customer_state,admin:lead.admin_state};
 if((states.customer==='Accepted'&&states.admin==='Accepted')||(process.env.CUSTOMER_CARE_TEST_MODE==='true'&&lead.email!=='hello@tendercrestai.com'))return states;
 if(!report){const B=require('./bid-check');let row;try{row=await B.find(config,j.id);}catch{return states;}if(row)return B.send(config,j,lead,row);}

 const {csv}=await import('../../../assets/compliance-export.mjs');const workspace={analysis:{id:j.id,status:'Completed',processed:j.processed,total_chunks:j.chunks.length,warnings:j.warnings,facts:[]},requirements:j.requirements.map((r,i)=>({...r,id:String(i+1),original_requirement:r.requirement,duplicate_count:r.duplicate_count||0}))};
 const attachment=report?{filename:report.filename,content:Buffer.from(report.document).toString('base64')}:{filename:'compliance-matrix.csv',content:Buffer.from(csv(workspace)).toString('base64')};const results={customer:lead.customer_state,admin:lead.admin_state};
 for(const kind of ['customer','admin']){if(results[kind]==='Accepted')continue;
  if(process.env.CUSTOMER_CARE_TEST_MODE==='true'&&lead.email!=='hello@tendercrestai.com')continue;
  const payload=kind==='customer'?{to:[lead.email],subject:'Your TenderCrest AI compliance matrix',text:'Your requested matrix is attached. '+j.requirements.length+' extracted requirements. Every row needs human review: no proposal response or company evidence was supplied. Check the original solicitation and all attachments. This is not a compliance certification.',attachments:[attachment]}:{to:['hello@tendercrestai.com'],subject:'New free RFP shredder lead',text:'Email: '+lead.email+'\nSolicitation: '+lead.title+'\nSource: '+lead.source+'\nRequested: '+lead.created_at+'\nMarketing opt-in: '+(lead.marketing_opt_in?'Yes':'No')+'\nPublic teardown interest: '+(lead.teardown_opt_in?'Yes':'No')+'\nThis request is for a matrix, not a paid subscription.'};
  if(report){payload.subject=kind==='customer'?report.customerSubject:report.adminSubject;if(kind==='customer')payload.text=report.customerText;else payload.text=payload.text.replace('This request is for a matrix, not a paid subscription.','This request is for a bid-check breakdown, not a paid subscription.')+report.adminExtra;}
  if(process.env.CUSTOMER_CARE_TEST_MODE==='true')payload.subject='[FICTIONAL PREVIEW TEST] '+payload.subject;
  try{const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':(report?report.prefix:'free-matrix')+'-'+kind+'-'+j.id},body:JSON.stringify({from:'TenderCrest AI <hello@tendercrestai.com>',reply_to:'hello@tendercrestai.com',...payload}),signal:AbortSignal.timeout(10000)});if(r.ok){const receipt=await r.json();if(receipt.id){results[kind]='Accepted';await db(config,'ft_leads?id=eq.'+j.id,{method:'PATCH',body:{[kind+'_state']:'Accepted'}});}}else console.error('Free-tools mail failed',JSON.stringify({jobId:j.id,kind,status:r.status}));}catch(error){console.error('Free-tools mail failed',JSON.stringify({jobId:j.id,kind,status:'fetch_error',error:error&&error.name?error.name:'Error'}));/* Persisted lead can retry with stable provider idempotency. */}
 }
 return results;
}
module.exports={enabled,db,mac,ip,sign,verify,job,dispatch,view,prepare,processJob,mail,resumable,isTransientProviderError};
