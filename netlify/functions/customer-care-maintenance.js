const kb=require('./lib/knowledge-base'),C=require('./lib/customer-care'),{sweepStrandedJobs}=require('./lib/job-sweeper');
exports.run=async(config,{fetcher=fetch,now=new Date(),invocation='operator'}={})=>{
 const origin=process.env.PROPOSAL_PUBLIC_ORIGIN||process.env.URL;if(!/^https:\/\/(?:www\.tendercrestai\.com|[a-z0-9-]+\.netlify\.app)$/.test(origin||''))kb.fail(503,'Health origin is not configured.');
 const checks=[];for(const [name,path]of [['public_pages','/'],['auth_config','/.netlify/functions/auth-config']]){try{const r=await fetcher(origin+path,{signal:AbortSignal.timeout(8000)});let okay=r.ok;if(okay&&name==='auth_config'){const d=await r.json();okay=d.url===config.url;}checks.push({name,status:okay?'passed':'failed',observed_at:now.toISOString(),detail:okay?'HTTP and deployment checks passed':'HTTP or deployment checks failed'});}catch{checks.push({name,status:'failed',observed_at:now.toISOString(),detail:'Request unavailable or timed out'});}}
 checks.push({name:'worker_config',status:process.env.KB_WORKER_SECRET?.length>=32?'passed':'failed',observed_at:now.toISOString(),detail:'Background credential presence only; not an end-to-end processing claim'});
 // Cheap dependency pings (F10): no new service, no PII. OpenAI via the
 // models endpoint, Airtable via one base row read; Resend has no cheap ping,
 // so config presence plus the last accepted/delivered timestamp is enough.
 if(process.env.KB_EMBEDDING_API_KEY){
  try{const r=await fetcher('https://api.openai.com/v1/models',{headers:{Authorization:'Bearer '+process.env.KB_EMBEDDING_API_KEY},signal:AbortSignal.timeout(8000)});checks.push({name:'openai_models',status:r.ok?'passed':'failed',observed_at:now.toISOString(),detail:r.ok?'Embedding provider models endpoint reachable':'Embedding provider models endpoint returned HTTP '+r.status});}
  catch{checks.push({name:'openai_models',status:'failed',observed_at:now.toISOString(),detail:'Embedding provider models endpoint unavailable or timed out'});}
 }else checks.push({name:'openai_models',status:'failed',observed_at:now.toISOString(),detail:'Embedding provider key is not configured'});
 let airtable=null;try{airtable=require('./lib/billing-source').billingSource();}catch{airtable=null;}
 if(airtable&&airtable.pat){
  try{const r=await fetcher(airtable.root+'/'+airtable.company+'?maxRecords=1',{headers:{Authorization:'Bearer '+airtable.pat},signal:AbortSignal.timeout(8000)});checks.push({name:'airtable_base',status:r.ok?'passed':'failed',observed_at:now.toISOString(),detail:r.ok?'Billing base read succeeded':'Billing base read returned HTTP '+r.status});}
  catch{checks.push({name:'airtable_base',status:'failed',observed_at:now.toISOString(),detail:'Billing base read unavailable or timed out'});}
 }else checks.push({name:'airtable_base',status:'failed',observed_at:now.toISOString(),detail:'Billing base credentials are not configured'});
 if(!process.env.RESEND_API_KEY)checks.push({name:'resend_delivery',status:'failed',observed_at:now.toISOString(),detail:'Resend key is not configured'});
 else{
  let last=null,queried=false;
  try{const rows=await C.db(config,'cc_deliveries?status=in.(Accepted,Delivered)&order=updated_at.desc&limit=1&select=updated_at');queried=true;last=rows&&rows[0];}catch{queried=false;}
  checks.push({name:'resend_delivery',status:queried?'passed':'failed',observed_at:now.toISOString(),detail:queried?(last?'Resend key present; last accepted delivery '+last.updated_at:'Resend key present; no accepted delivery recorded yet'):'Resend delivery history could not be read'});
 }
 let lastScheduledAt=invocation==='scheduled'?now.toISOString():null;
 if(!lastScheduledAt){const previous=await C.db(config,'cc_health?name=eq.worker_config&select=detail,observed_at');const old=previous[0];lastScheduledAt=old?.detail?.match(/Last native scheduler: ([0-9T:.Z-]+)/)?.[1]||(old?.detail?.startsWith('Scheduled invocation: ')?new Date(old.observed_at).toISOString():null);}
 for(const check of checks)check.detail=(invocation==='scheduled'?'Scheduled invocation: ':'Operator invocation: ')+check.detail+(check.name==='worker_config'&&lastScheduledAt?' Last native scheduler: '+lastScheduledAt:'');
 await C.db(config,'cc_reminder_budget?day=lt.'+new Date(now.getTime()-90*86400000).toISOString().slice(0,10),{method:'DELETE'});
 await C.db(config,'cc_delivery_events?observed_at=lt.'+encodeURIComponent(new Date(now.getTime()-90*86400000).toISOString()),{method:'DELETE'});
 await C.db(config,'cc_deliveries?status=eq.Sending&lease_until=lt.'+encodeURIComponent(now.toISOString()),{method:'PATCH',body:{status:'Uncertain',lease_until:null,updated_at:now.toISOString()}});
 await C.db(config,'cc_deliveries?expires_at=lt.'+encodeURIComponent(now.toISOString()),{method:'DELETE'});
 // Stranded-job sweep (F5): re-dispatch Pending / lease-expired Processing
 // jobs. A sweeper failure must never fail the maintenance run.
 let swept=null;
 try{swept=await sweepStrandedJobs(config,{db:(path,options)=>C.db(config,path,options),fetcher,now});}
 catch{console.error(JSON.stringify({event:'sweep_failed'}));swept={pw:{found:0,redispatched:0,failed:0},kb:{found:0,redispatched:0,failed:0},ft:{found:0,redispatched:0,failed:0},compliance:{found:0,redispatched:0,failed:0}};}
 // Publish a successful run only after every cleanup step completed.
 await C.db(config,'cc_health',{method:'POST',body:checks,fetcher:(url,init)=>fetcher(url,{...init,headers:{...init.headers,Prefer:'resolution=merge-duplicates,return=representation'}})});
 return {checks:checks.map(c=>({name:c.name,status:c.status})),retentionCleanup:true,swept};
};
exports.handler=async event=>{if(event?.httpMethod){try{kb.verifyWorker(event);}catch{return kb.reply(403,{error:'Forbidden'});}}if(!C.enabled())return kb.reply(200,{disabled:true});try{return kb.reply(200,await exports.run(kb.configuration()));}catch{console.error(JSON.stringify({event:'customer_operations_failed'}));return kb.reply(503,{error:'Customer operations check will retry.'});}};

