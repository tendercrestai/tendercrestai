const kb=require('./lib/knowledge-base'),C=require('./lib/customer-care');
exports.handler=async event=>{try{
 const p=kb.parse(event,12000);if(!C.enabled())kb.fail(503,'Customer continuity features are not active for this deployment.');const config=kb.configuration();if(process.env.CUSTOMER_CARE_TEST_MODE==='true'&&config.url!=='https://wcrrywzleylmdsqqlise.supabase.co')kb.fail(503,'Test continuity must use the isolated database.');
 if(p.action==='replayTestBilling'){
  kb.exact(p,['action','subscriptionId']);kb.verifyWorker(event);if(process.env.CUSTOMER_CARE_TEST_MODE!=='true'||config.url!=='https://wcrrywzleylmdsqqlise.supabase.co'||!/^sub_[A-Za-z0-9]+$/.test(p.subscriptionId||'')||!process.env.STRIPE_TEST_WEBHOOK_SECRET)kb.fail(403,'Isolated signed test replay only.');
  const crypto=require('node:crypto'),at=String(Math.floor(Date.now()/1000)),body=JSON.stringify({livemode:false,type:'customer.subscription.updated',data:{object:{id:p.subscriptionId}}});const signature=crypto.createHmac('sha256',process.env.STRIPE_TEST_WEBHOOK_SECRET).update(at+'.'+body).digest('hex');return require('./stripe-webhook').handler({httpMethod:'POST',headers:{'stripe-signature':'t='+at+',v1='+signature},body});
 }
 if(p.action==='setupNativeTestWebhook'){
  kb.exact(p,['action']);kb.verifyWorker(event);const key=process.env.STRIPE_TEST_KEY;if(process.env.CUSTOMER_CARE_TEST_MODE!=='true'||config.url!=='https://wcrrywzleylmdsqqlise.supabase.co'||! /^(sk|rk)_test_/.test(key||''))kb.fail(403,'Test-mode webhook setup only.');
  const data=new URLSearchParams({url:'https://tendercrestai-pr6-isolated-20261021.netlify.app/.netlify/functions/stripe-webhook',description:'TenderCrest isolated customer continuity verification'});for(const type of ['checkout.session.completed','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','invoice.paid','invoice.payment_failed'])data.append('enabled_events[]',type);
  const r=await fetch('https://api.stripe.com/v1/webhook_endpoints',{method:'POST',headers:{Authorization:'Bearer '+key,'Idempotency-Key':'tc-isolated-continuity-webhook-v1','Content-Type':'application/x-www-form-urlencoded'},body:data,signal:AbortSignal.timeout(15000)});if(!r.ok)return kb.reply(503,{error:'Test webhook setup requires the appropriate test-key permission.',providerHTTP:r.status});const d=await r.json();if(d.livemode!==false||typeof d.secret!=='string'||!d.secret.startsWith('whsec_'))kb.fail(503,'Test webhook response could not be verified.');return kb.reply(200,{id:d.id,secret:d.secret,livemode:false});
 }
 if(p.action==='testCredentialReadiness'){
  kb.exact(p,['action']);kb.verifyWorker(event);if(process.env.CUSTOMER_CARE_TEST_MODE!=='true'||config.url!=='https://wcrrywzleylmdsqqlise.supabase.co')kb.fail(403,'Isolated credential checks only.');
  const pat=process.env.AIRTABLE_TEST_PAT;let testAirtableStatus=null,productionAirtableStatus=null;if(pat){for(const [base,test]of [['appsDmtQ1XOE8Gjtr',true],['appsaqdp3UZdhB2VH',false]]){const r=await fetch('https://api.airtable.com/v0/'+base+'/Companies?maxRecords=1&fields%5B%5D=Company%20Name',{headers:{Authorization:'Bearer '+pat},signal:AbortSignal.timeout(10000)});if(test)testAirtableStatus=r.status;else productionAirtableStatus=r.status;}}
  return kb.reply(200,{testStripeKeyMode:/^(sk|rk)_test_/.test(process.env.STRIPE_TEST_KEY||'')?'test':'invalid',testAirtableStatus,productionAirtableDenied:[403,404].includes(productionAirtableStatus),testWebhookSecretConfigured:!!process.env.STRIPE_TEST_WEBHOOK_SECRET});
 }
 if(p.action==='runHealthChecks'){kb.exact(p,['action']);kb.verifyWorker(event);return kb.reply(200,await require('./customer-care-maintenance').run(config));}
 if(p.action==='health'){kb.exact(p,['action']);kb.verifyWorker(event);const rows=await C.db(config,'cc_health?select=name,status,observed_at,detail&order=name');return kb.reply(200,{checks:rows,notice:'Only recorded checks are shown. An absent or stale check is not a pass.'});}
 const {user,token}=await kb.authenticate(event,config);user.token=token;await kb.rpc(config,'pw_admit',{p_org:null,p_user:user.id,p_action:p.action==='download'?'export':p.action==='checkout'?'create':['requestDeletion','deleteUnusedPersonalSource'].includes(p.action)?'write':'read'});
 const page=p.page??0;if(!Number.isSafeInteger(page)||page<0||page>1000)kb.fail(400,'Invalid page.');
 if(p.action==='history'){
  kb.exact(p,['action','page']);const [deliveries,submissions]=await Promise.all([
   C.db(config,'cc_deliveries?user_id=eq.'+user.id+'&select=id,subject,status,created_at,expires_at&order=created_at.desc,id.desc&limit=21&offset='+page*20),
   C.db(config,'rfp_submissions?user_id=eq.'+user.id+'&select=id,status,created_at&order=created_at.desc,id.desc&limit=21&offset='+page*20)]);
  return kb.reply(200,{deliveries:deliveries.slice(0,20),submissions:submissions.slice(0,20),page,hasMore:deliveries.length>20||submissions.length>20,notice:'Protected downloads exist only for retained deliveries recorded after this feature was enabled. Accepted means the provider accepted a request, not inbox delivery.'});
 }
 if(p.action==='submissionStatus'){
  kb.exact(p,['action','submissionId']);kb.uuid(p.submissionId);return require('./proposal-status').handler({...event,httpMethod:'GET',queryStringParameters:{submissionId:p.submissionId}});
 }
 if(p.action==='download'){
  kb.exact(p,['action','deliveryId']);const rows=await C.db(config,'cc_deliveries?id=eq.'+kb.uuid(p.deliveryId)+'&user_id=eq.'+user.id+'&select=subject,body,expires_at');const d=rows[0];if(!d||Date.parse(d.expires_at)<=Date.now())kb.fail(404,'Retained proposal unavailable or expired.');const result=await require('./lib/proposal-email').presentation(d.subject,d.body);return kb.reply(200,{attachment:result.attachment});
 }
 if(p.action==='documents'){
  kb.exact(p,['action','page']);const rows=await C.db(config,'rfp_uploads?user_id=eq.'+user.id+'&select=id,file_name,created_at&order=created_at.desc,id.desc&limit=21&offset='+page*20);return kb.reply(200,{documents:rows.slice(0,20),hasMore:rows.length>20,page});
 }
 if(p.action==='requestDeletion'){
  kb.exact(p,['action','documentId','kind','reason','confirm']);if(p.confirm!=='REQUEST DELETION')kb.fail(400,'Explicit deletion-request confirmation required.');const result=await C.requestDeletion(config,user,p);return kb.reply(200,{request:result,notice:'Request recorded for dependency and retention review. Data has not been deleted. Archive, shared project copies, billing records and provider/email retention are separate.'});
 }
 if(p.action==='deleteUnusedPersonalSource'){
  kb.exact(p,['action','requestId','confirm']);if(process.env.CUSTOMER_DELETION_EXECUTION_ENABLED!=='true')kb.fail(503,'Deletion execution is not enabled; your request remains recorded for review.');kb.uuid(p.requestId);if(p.confirm!=='DELETE SOURCE '+p.requestId)kb.fail(400,'Confirm the exact personal source request.');
  const plan=await kb.rpc(config,'cc_claim_source_deletion',{p_user:user.id,p_request:p.requestId});if(plan.completed)return kb.reply(200,{deleted:true,scope:'Personal original source only.'});
  if(typeof plan.path!=='string'||!plan.path.startsWith(user.id+'/'+plan.documentId+'/'))kb.fail(503,'Source storage path needs review.');
  const r=await fetch(config.url+'/storage/v1/object/rfp-documents',{method:'DELETE',headers:{apikey:config.serviceKey,Authorization:'Bearer '+config.serviceKey,'Content-Type':'application/json'},body:JSON.stringify({prefixes:[plan.path]}),signal:AbortSignal.timeout(10000)});if(!r.ok)kb.fail(503,'Source removal needs retry. The request remains in progress.');
  await kb.rpc(config,'cc_finish_source_deletion',{p_user:user.id,p_request:p.requestId});return kb.reply(200,{deleted:true,scope:'Unused personal original source and its upload metadata. Other project copies, provider data and received emails were not deleted.'});
 }
 if(p.action==='deletions'){
  kb.exact(p,['action','page']);const rows=await C.db(config,'cc_deletion_requests?user_id=eq.'+user.id+'&select=id,document_id,kind,state,created_at,updated_at&order=created_at.desc,id.desc&limit=21&offset='+page*20);return kb.reply(200,{requests:rows.slice(0,20),hasMore:rows.length>20,page});
 }
 if(p.action==='checkoutStatus'){
  kb.exact(p,['action']);const rows=await C.db(config,'cc_checkouts?user_id=eq.'+user.id+'&select=provider_id');const id=rows[0]?.provider_id;if(!/^cs_(?:test_|live_)?[A-Za-z0-9]+$/.test(id||''))kb.fail(404,'No verified checkout session is recorded.');const test=process.env.CUSTOMER_CARE_TEST_MODE==='true',key=test?process.env.STRIPE_TEST_KEY:process.env.STRIPE_CHECKOUT_KEY;const r=await fetch('https://api.stripe.com/v1/checkout/sessions/'+id,{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(10000)});if(!r.ok)kb.fail(503,'Checkout status is unavailable.');const d=await r.json();if(d.client_reference_id!==user.id||d.livemode!==!test)kb.fail(403,'Checkout identity mismatch.');return kb.reply(200,{status:d.status,paymentStatus:d.payment_status,subscriptionId:typeof d.subscription==='string'?d.subscription:null,notice:'Checkout completion is not an application entitlement until current billing has synchronized.'});
 }
 if(p.action==='checkout'){kb.exact(p,['action','plan','requestKey']);return kb.reply(200,await C.checkout(user,p));}
 kb.fail(400,'Unknown customer continuity action.');
}catch(e){return kb.reply(e.status||503,{error:e.status?e.message:'Customer continuity is temporarily unavailable. Saved work is unchanged.'});}};
