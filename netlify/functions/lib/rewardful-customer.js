// Read-only, authenticated proof that Stripe has actually created this user's customer.
// This associates a referral; Rewardful's Stripe integration decides paid commissions.
const crypto=require('node:crypto'),kb=require('./knowledge-base'),C=require('./customer-care');
const id=value=>typeof value==='string'?value:value?.id;
function createHandler(adapters={}){return async event=>{try{
 const p=kb.parse(event,500);kb.exact(p,['consent','since']);if(p.consent!==true||!Number.isSafeInteger(p.since)||p.since>Date.now()||p.since<Date.now()-30*86400000)kb.fail(400,'Current Rewardful consent is required.');
 const config=(adapters.configuration||kb.configuration)(),{user}=await(adapters.authenticate||kb.authenticate)(event,config);
 await(adapters.rpc||kb.rpc)(config,'pw_admit',{p_org:null,p_user:user.id,p_action:'read'});
 // Isolated/test deployments never associate test customers with the live affiliate program.
 if(config.url!=='https://vfdwaqgfepvoujprtuww.supabase.co'||process.env.CUSTOMER_CARE_TEST_MODE==='true')return kb.reply(200,{conversion:null});
 const db=adapters.db||C.db,fetcher=adapters.fetch||fetch;
 const bindings=await db(config,'cc_billing_bindings?user_id=eq.'+user.id+'&select=customer_id');if(bindings.length>1)kb.fail(409,'Billing identity needs review.');
 let customerId=bindings[0]?.customer_id;
 async function stripe(path,key){if(!key)kb.fail(503,'Billing customer verification is unavailable.');const r=await fetcher('https://api.stripe.com/v1/'+path,{headers:{Authorization:'Bearer '+key,'Stripe-Version':'2026-08-26.dahlia'},signal:AbortSignal.timeout(5000)});if(!r.ok)kb.fail(503,'Billing customer verification is unavailable.');return r.json();}
 if(!customerId){
  const rows=await db(config,'cc_checkouts?user_id=eq.'+user.id+'&state=eq.Created&select=provider_id');if(rows.length!==1||!/^cs_live_[A-Za-z0-9]+$/.test(rows[0]?.provider_id||''))return kb.reply(200,{conversion:null});
  const session=await stripe('checkout/sessions/'+encodeURIComponent(rows[0].provider_id),process.env.STRIPE_CHECKOUT_KEY);
  if(session.id!==rows[0].provider_id||session.client_reference_id!==user.id||session.livemode!==true||session.status!=='complete'||!/^cus_[A-Za-z0-9]+$/.test(id(session.customer)||''))return kb.reply(200,{conversion:null});customerId=id(session.customer);
 }
 if(!/^cus_[A-Za-z0-9]+$/.test(customerId||''))return kb.reply(200,{conversion:null});
 const customer=await stripe('customers/'+encodeURIComponent(customerId),process.env.STRIPE_READ_KEY);
 if(customer.id!==customerId||customer.deleted||customer.livemode!==true||!Number.isSafeInteger(customer.created)||customer.created<Math.floor(p.since/1000)||customer.created>Math.ceil(Date.now()/1000)||typeof customer.email!=='string'||customer.email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(customer.email))return kb.reply(200,{conversion:null});
 const secret=process.env.ANALYTICS_SIGNING_SECRET;if(!secret||secret.length<32)kb.fail(503,'Billing customer verification is unavailable.');
 return kb.reply(200,{conversion:{id:crypto.createHmac('sha256',secret).update('rewardful-customer:'+customerId).digest('hex'),email:customer.email}});
 }catch(error){return kb.reply(error.status||503,{error:error.status?error.message:'Billing customer verification is unavailable.'});}};}
module.exports={createHandler};
