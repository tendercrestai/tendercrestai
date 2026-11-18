const { timingSafeEqual, createHash } = require('node:crypto');
const security = require('./rfp-security');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME = {pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',txt:'text/plain'};
function configuration() {
 if(!process.env.SUPABASE_URL||!process.env.SUPABASE_PUBLISHABLE_KEY)fail(503,'Knowledge database is not explicitly configured.');
 const config=security.configuration();
 let url;try{url=new URL(config.url);}catch{fail(503,'Knowledge database configuration is invalid.');}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash)fail(503,'Knowledge database configuration is invalid.');
 return config;
}
const fail = (status,message) => { throw new security.RequestError(status,message); };
const reply = (statusCode,body) => ({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},body:JSON.stringify(body)});
function uuid(value) { if(typeof value!=='string'||!UUID.test(value)) fail(400,'A valid identifier is required.'); return value; }
function text(value,max) {if(typeof value!=='string'||!value.trim()||value.length>max) fail(400,'Text is missing or exceeds the supported limit.');return value.trim();}
function exact(value,keys) {if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail(400,'Unexpected request fields.');}
function enabled() {if(process.env.KB_ENABLED!=='true')fail(503,'Knowledge base is not enabled for this deployment.');}
function parse(event,max=40000) {
 if(event.httpMethod!=='POST')fail(405,'Method Not Allowed');
 if(event.isBase64Encoded||typeof event.body!=='string'||Buffer.byteLength(event.body)>max)fail(413,'Request exceeds the supported size.');
 try {const p=JSON.parse(event.body);if(!p||typeof p!=='object'||Array.isArray(p))fail(400,'Invalid request.');return p;}catch(e){if(e.status)throw e;fail(400,'Invalid JSON.');}
}
async function database(config,path,{token,method='GET',body,service=false,fetcher=fetch}={}) {
 const key=service?config.serviceKey:config.key;
 const response=await fetcher(config.url+'/rest/v1/'+path,{method,headers:{apikey:key,Authorization:'Bearer '+(service?config.serviceKey:token),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 if(!response.ok){const error=await response.json().catch(()=>({}));const codes={'42501':403,'P0002':404,'40001':409,'PT409':409,'55P03':409,'P0001':429,'22023':400,'23514':400,'23505':409};const status=codes[error.code]||503;fail(status,{403:'Organization access denied.',404:'Knowledge record not found.',409:'The record changed or is no longer available. Reload before retrying.',429:'Knowledge usage or retry limit reached.',400:'Invalid knowledge request.'}[status]||'Knowledge data is temporarily unavailable.');}
 return response.status===204?null:response.json();
}
const rpc=(config,name,body,fetcher=fetch)=>database(config,'rpc/'+name,{method:'POST',body,service:true,fetcher});
async function membership(config,token,user,org) {
 const rows=await database(config,'kb_memberships?org_id=eq.'+uuid(org)+'&user_id=eq.'+user.id+'&active=eq.true&select=role',{token});
 if(!rows[0])fail(403,'Organization access denied.');return rows[0].role;
}
function workerSettings() {
 const secret=process.env.KB_WORKER_SECRET;if(!secret||secret.length<32)fail(503,'Knowledge background processing is not configured.');
 let origin;try{origin=new URL(process.env.KB_WORKER_ORIGIN||process.env.DEPLOY_PRIME_URL||process.env.URL);}catch{fail(503,'Knowledge background processing is not configured.');}
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.port||origin.pathname!=='/'||!(origin.hostname.endsWith('.netlify.app')||origin.hostname==='www.tendercrestai.com'))fail(503,'Knowledge background deployment is invalid.');
 return {secret,url:new URL('/.netlify/functions/knowledge-worker-background',origin).href};
}
function verifyWorker(event) {
 const expected=process.env.KB_WORKER_SECRET,actual=event.headers?.['x-kb-worker-secret']||event.headers?.['X-Kb-Worker-Secret'];
 if(!expected||expected.length<32||typeof actual!=='string'||Buffer.byteLength(expected)!==Buffer.byteLength(actual)||!timingSafeEqual(Buffer.from(expected),Buffer.from(actual)))fail(401,'Unauthorized background invocation.');
}
// An HTTP header value may hold visible ASCII, spaces/tabs and bytes
// 0x80-0xFF, but no other control character and nothing above U+00FF:
// Node's fetch throws synchronously on such a value, before any request
// leaves, and the embedding retry loop then burns ~1.25s and records a
// misleading embedding_failed. A pasted provider key can invisibly carry
// one (a BOM, a zero-width space, NUL/DEL, a stray CR/LF), which no
// visual check of the stored value can see. Trim surrounding whitespace,
// then reject a value that cannot be sent, so the failure names the
// configuration instead of the provider.
function headerSafe(value){for(let i=0;i<value.length;i++){const c=value.charCodeAt(i);if((c<0x20&&c!==0x09)||c===0x7F||c>0xFF)return false;}return true;}
function embeddingSettings() {
 const key=(process.env.KB_EMBEDDING_API_KEY||'').trim(),model=(process.env.KB_EMBEDDING_MODEL||'').trim();
 if(!key||model!=='text-embedding-3-small'||!headerSafe(key)){const error=new security.RequestError(503,'Knowledge embeddings are not configured.');error.configError='embedding_settings';throw error;}
 return {key,model};
}
function vector(value) {if(!Array.isArray(value)||value.length!==1536||value.some(n=>typeof n!=='number'||!Number.isFinite(n))||!value.some(n=>n!==0))fail(502,'Invalid embedding response.');return value;}
const EMBED_RETRY_DELAYS_MS=[250,1000];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Retry transient embedding failures (429/5xx/network) with backoff, up to 3
// attempts total per batch. The 3-attempt job budget in kb_claim_job is
// untouched: these retries happen inside one claimed attempt, so a brief
// provider outage no longer burns all 3 job attempts. 401/403 and other 4xx
// fail immediately; malformed responses are never retried.
async function embed(inputs,fetcher=fetch,options={}) {
 const {key,model}=embeddingSettings();if(!Array.isArray(inputs)||!inputs.length||inputs.length>16||inputs.some(s=>typeof s!=='string'||!s.trim()||s.length>2000))fail(400,'Invalid embedding input.');
 const delays=Array.isArray(options.retryDelays)&&options.retryDelays.length?options.retryDelays:EMBED_RETRY_DELAYS_MS;
 for(let attempt=0;attempt<3;attempt++){
  let response;
  try{
   response=await fetcher('https://api.openai.com/v1/embeddings',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model,input:inputs,dimensions:1536,encoding_format:'float'}),signal:AbortSignal.timeout(30000)});
  }catch(err){
   if(attempt<2){await sleep(delays[attempt]??delays[delays.length-1]);continue;}
   // The fetch threw before any provider request left (an unsendable
   // header, DNS, a socket error): keep the original error name on the
   // failure, so the worker log can name it instead of misreading this
   // 502 as a provider outage.
   const error=new security.RequestError(502,'Embedding service is temporarily unavailable.');error.transportError=typeof err?.name==='string'&&err.name?err.name:'Error';throw error;
  }
  if(response.ok){
   const data=await response.json();
   if(!Array.isArray(data.data)||data.data.length!==inputs.length)fail(502,'Invalid embedding response.');const sorted=[...data.data].sort((a,b)=>a.index-b.index);
   if(sorted.some((d,i)=>d.index!==i))fail(502,'Invalid embedding response.');return sorted.map(d=>vector(d.embedding));
  }
  if(response.status===401||response.status===403)fail(503,'Embedding access is denied (provider HTTP '+response.status+'). Ask your organization administrator to verify the provider key and model.');
  if(response.status===429||response.status>=500){
   if(attempt<2){
    const retryAfter=response.headers?.get?.('retry-after'),parsed=retryAfter?Math.round(Number(retryAfter)*1000):NaN;
    await sleep(Number.isFinite(parsed)&&parsed>0?Math.min(parsed,5000):(delays[attempt]??delays[delays.length-1]));
    continue;
   }
   if(response.status===429)fail(429,'Embedding provider quota or rate limit reached. Try again later.');
   fail(502,'Embedding service is temporarily unavailable.');
  }
  fail(502,'Embedding service is temporarily unavailable.');
 }
}
function citationChunks(document, options = {}) {
 // Citation chunks are capped so one document cannot flood the index. The
 // knowledge worker raises the cap for long source documents (see
 // KB_MAX_CHUNKS); the 80 default is unchanged for every other caller.
 const maxChunks = Number.isSafeInteger(options.maxChunks) && options.maxChunks > 0 ? options.maxChunks : 80;
 const chunks=[];
 for(const s of document.segments){
  for(let start=0;start<s.text.length;){let end=Math.min(start+1500,s.text.length);if(end<s.text.length&&/[\uDC00-\uDFFF]/.test(s.text[end]))end--;
   const raw=s.text.slice(start,end),content=raw.trim();if(content)chunks.push({content,page:s.page,section:s.section,segment_id:s.id,start_offset:start+raw.length-raw.trimStart().length});
   if(chunks.length>maxChunks)fail(413,'Source exceeds '+maxChunks+' citation chunks. Split the document.');if(end===s.text.length)break;start=end-200;if(/[\uDC00-\uDFFF]/.test(s.text[start]))start--;
  }
 }
 if(!chunks.length)fail(422,'No searchable source text was extracted.');return chunks;
}
async function originalBytes(config,doc,fetcher=fetch) {
 if(!UUID.test(doc.id)||!UUID.test(doc.org_id)||!MIME[doc.extension]||doc.storage_path!==doc.org_id+'/'+doc.id+'/source.'+doc.extension||doc.mime_type!==MIME[doc.extension]||!Number.isInteger(doc.size_bytes)||doc.size_bytes<1||doc.size_bytes>10485760)fail(400,'Invalid source metadata.');
 const response=await fetcher(config.url+'/storage/v1/object/authenticated/kb-documents/'+doc.storage_path,{headers:{apikey:config.serviceKey,Authorization:'Bearer '+config.serviceKey},signal:AbortSignal.timeout(20000)});
 if(!response.ok)fail(400,'Original source is unavailable.');const bytes=Buffer.from(await response.arrayBuffer());
 if(bytes.length!==doc.size_bytes||(response.headers.get('content-type')||'').split(';')[0]!==doc.mime_type||createHash('sha256').update(bytes).digest('hex')!==doc.sha256)fail(400,'Original source failed integrity verification.');
 if(doc.extension==='pdf'&&bytes.subarray(0,5).toString()!=='%PDF-')fail(400,'Invalid PDF source.');
 if(doc.extension==='docx'&&(bytes.length<4||bytes.readUInt32LE(0)!==0x04034b50||!bytes.includes(Buffer.from('word/document.xml'))))fail(400,'Invalid DOCX source.');
 return {bytes,extension:doc.extension,metadata:doc};
}
module.exports={...security,configuration,UUID,MIME,fail,reply,uuid,text,exact,enabled,parse,database,rpc,membership,workerSettings,verifyWorker,embeddingSettings,vector,embed,citationChunks,originalBytes};
