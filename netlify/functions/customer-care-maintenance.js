const kb=require('./lib/knowledge-base'),C=require('./lib/customer-care');
exports.run=async(config,{fetcher=fetch,now=new Date()}={})=>{
 const origin=process.env.PROPOSAL_PUBLIC_ORIGIN||process.env.URL;if(!/^https:\/\/(?:www\.tendercrestai\.com|[a-z0-9-]+\.netlify\.app)$/.test(origin||''))kb.fail(503,'Health origin is not configured.');
 const checks=[];for(const [name,path]of [['public_pages','/'],['auth_config','/.netlify/functions/auth-config']]){try{const r=await fetcher(origin+path,{signal:AbortSignal.timeout(8000)});let okay=r.ok;if(okay&&name==='auth_config'){const d=await r.json();okay=d.url===config.url;}checks.push({name,status:okay?'passed':'failed',observed_at:now.toISOString(),detail:okay?'HTTP and deployment checks passed':'HTTP or deployment checks failed'});}catch{checks.push({name,status:'failed',observed_at:now.toISOString(),detail:'Request unavailable or timed out'});}}
 checks.push({name:'worker_config',status:process.env.KB_WORKER_SECRET?.length>=32?'passed':'failed',observed_at:now.toISOString(),detail:'Background credential presence only; not an end-to-end processing claim'});
 await C.db(config,'cc_health',{method:'POST',body:checks,fetcher:(url,init)=>fetcher(url,{...init,headers:{...init.headers,Prefer:'resolution=merge-duplicates,return=representation'}})});
 await C.db(config,'cc_delivery_events?observed_at=lt.'+encodeURIComponent(new Date(now.getTime()-90*86400000).toISOString()),{method:'DELETE'});
 await C.db(config,'cc_deliveries?status=eq.Sending&lease_until=lt.'+encodeURIComponent(now.toISOString()),{method:'PATCH',body:{status:'Uncertain',lease_until:null,updated_at:now.toISOString()}});
 await C.db(config,'cc_deliveries?expires_at=lt.'+encodeURIComponent(now.toISOString()),{method:'DELETE'});
 return {checks:checks.map(c=>({name:c.name,status:c.status})),retentionCleanup:true};
};
exports.handler=async event=>{if(event?.httpMethod){try{kb.verifyWorker(event);}catch{return kb.reply(403,{error:'Forbidden'});}}if(!C.enabled())return kb.reply(200,{disabled:true});try{return kb.reply(200,await exports.run(kb.configuration()));}catch{return kb.reply(503,{error:'Customer operations check will retry.'});}};
exports.config={schedule:'37 * * * *'};
