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
function embeddingSettings() {
 const key=process.env.KB_EMBEDDING_API_KEY,model=process.env.KB_EMBEDDING_MODEL;
 if(!key||model!=='text-embedding-3-small')fail(503,'Knowledge embeddings are not configured.');return {key,model};
}
function vector(value) {if(!Array.isArray(value)||value.length!==1536||value.some(n=>typeof n!=='number'||!Number.isFinite(n))||!value.some(n=>n!==0))fail(502,'Invalid embedding response.');return value;}
async function embed(inputs,fetcher=fetch) {
 const {key,model}=embeddingSettings();if(!Array.isArray(inputs)||!inputs.length||inputs.length>16||inputs.some(s=>typeof s!=='string'||!s.trim()||s.length>2000))fail(400,'Invalid embedding input.');
 const response=await fetcher('https://api.openai.com/v1/embeddings',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model,input:inputs,dimensions:1536,encoding_format:'float'}),signal:AbortSignal.timeout(30000)});
 if(!response.ok)fail(502,'Embedding service is unavailable.');const data=await response.json();
 if(!Array.isArray(data.data)||data.data.length!==inputs.length)fail(502,'Invalid embedding response.');const sorted=[...data.data].sort((a,b)=>a.index-b.index);
 if(sorted.some((d,i)=>d.index!==i))fail(502,'Invalid embedding response.');return sorted.map(d=>vector(d.embedding));
}
function citationChunks(document) {
 const chunks=[];
 for(const s of document.segments){
  for(let start=0;start<s.text.length;){let end=Math.min(start+1500,s.text.length);if(end<s.text.length&&/[\uDC00-\uDFFF]/.test(s.text[end]))end--;
   const raw=s.text.slice(start,end),content=raw.trim();if(content)chunks.push({content,page:s.page,section:s.section,segment_id:s.id,start_offset:start+raw.length-raw.trimStart().length});
   if(chunks.length>80)fail(413,'Source exceeds 80 citation chunks. Split the document.');if(end===s.text.length)break;start=end-200;if(/[\uDC00-\uDFFF]/.test(s.text[start]))start--;
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
