// Scheduled worker: bounded cleanup, due-date reminders and opt-in delivery.
// No proposal text or titles are sent to the email provider.
const S=require('./lib/proposal-service');
const budget=require('./lib/reminder-budget');
exports.run=async function run(config,{send=fetch,now=new Date()}={}){
 S.enabled('collaboration');let removed=0,sent=0;
 const orphans=await S.rpc(config,'orphan_files',{});for(const f of orphans){if(!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(f.path))continue;await S.storage(config,'object/'+S.BUCKET,'DELETE',JSON.stringify({prefixes:[f.path]}),'application/json');removed++;}
 const expired=await S.db(config,'pw_files?expires_at=lt.'+encodeURIComponent(now.toISOString())+'&select=*&limit=50');
 for(const f of expired){if(f.path!==f.org_id+'/'+f.project_id+'/'+f.id)continue;await S.storage(config,'object/'+S.BUCKET,'DELETE',JSON.stringify({prefixes:[f.path]}),'application/json');await S.db(config,'pw_files?id=eq.'+f.id,{method:'DELETE'});removed++;}
 await S.rpc(config,'reminders',{});
 const live=process.env.PROPOSAL_EMAIL_LIVE==='true',start=process.env.PROPOSAL_EMAIL_START_AT;
 if(live&&(!start||!Number.isFinite(Date.parse(start))))throw Error('Future-only reminder activation time is required');
 // Old opt-ins/backlogs are never swept into a newly enabled email channel.
 const pending=await S.db(config,'pw_notifications?email_state=in.(Pending,Failed,Sending)'+(live?'&created_at=gte.'+encodeURIComponent(new Date(start).toISOString()):'')+'&order=created_at.asc&limit=20');
 for(const n of pending){const target=await S.rpc(config,'notification_targets',{p_id:n.id,p_claim:true});if(!target)continue;const allowed=(process.env.PROPOSAL_EMAIL_TEST_RECIPIENTS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);const live=process.env.PROPOSAL_EMAIL_LIVE==='true';
  if(!process.env.RESEND_API_KEY||!live&&!allowed.includes(target.email.toLowerCase())){await S.db(config,'pw_notifications?id=eq.'+n.id,{method:'PATCH',body:{email_state:'Suppressed',lease_until:null}});continue;}
  // Recheck current access immediately before provider request. Leased/idempotent within provider's 24-hour window.
  try{await S.project(config,{id:n.user_id},n.project_id);const eligible=await S.db(config,'pw_members?project_id=eq.'+n.project_id+'&user_id=eq.'+n.user_id+'&email_opt_in=eq.true&select=user_id');if(!eligible.length){await S.db(config,'pw_notifications?id=eq.'+n.id,{method:'PATCH',body:{email_state:'Suppressed',lease_until:null}});continue;}if(live&&!await budget.admit(config,n.id)){await S.db(config,'pw_notifications?id=eq.'+n.id,{method:'PATCH',body:{email_state:'Pending',lease_until:null}});break;}const origin=process.env.PROPOSAL_PUBLIC_ORIGIN;if(!origin||!/^https:\/\/(?:www\.tendercrestai\.com|[a-z0-9-]+\.netlify\.app)$/.test(origin))throw Error('origin_missing');const r=await send('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'pw-'+n.id},body:JSON.stringify({from:'TenderCrest AI <hello@tendercrestai.com>',to:[target.email],subject:'TenderCrest AI: project update',text:'There is an update or due item in a proposal project you can access. Sign in to review it: '+origin+'/workspace.html#'+n.project_id+'\nYou can turn off email reminders in the project Overview.'}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('delivery_failed');const result=await r.json();if(typeof result.id!=='string'||!result.id)throw Error('receipt_missing');await S.db(config,'pw_notifications?id=eq.'+n.id,{method:'PATCH',body:{email_state:'Sent',delivery_id:result.id,lease_until:null}});sent++;}catch{await S.db(config,'pw_notifications?id=eq.'+n.id,{method:'PATCH',body:{email_state:'Failed',lease_until:null}});}
 }
 return {removed,sent};
};
exports.handler=async event=>{if(event?.httpMethod){try{S.kb.verifyWorker(event);}catch{return {statusCode:403,body:'Forbidden'};}}if(process.env.PROPOSAL_WORKSPACE_ENABLED!=='true')return {statusCode:200,body:'Disabled'};try{await exports.run(S.kb.configuration());return {statusCode:200,body:'Complete'};}catch{return {statusCode:503,body:'Maintenance will retry'};}};

