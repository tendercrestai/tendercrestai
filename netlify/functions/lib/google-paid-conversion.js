const crypto=require('node:crypto'),kb=require('./knowledge-base'),C=require('./customer-care');
function createHandler(adapters={}){return async event=>{try{
 const p=kb.parse(event,500);kb.exact(p,['consent','since']);if(p.consent!==true||!Number.isSafeInteger(p.since)||p.since>Date.now()||p.since<Date.now()-30*86400000)kb.fail(400,'Current advertising consent is required.');
 const config=kb.configuration();const {user}=await (adapters.authenticate||kb.authenticate)(event,config);
 await (adapters.rpc||kb.rpc)(config,'pw_admit',{p_org:null,p_user:user.id,p_action:'read'});
 if(config.url!=='https://vfdwaqgfepvoujprtuww.supabase.co'||process.env.CUSTOMER_CARE_TEST_MODE==='true')return kb.reply(200,{conversion:null});
 const rows=await (adapters.db||C.db)(config,'cc_billing_bindings?user_id=eq.'+user.id+'&select=customer_id,subscription_id');const binding=rows[0];
 if(rows.length!==1||!/^cus_[A-Za-z0-9]+$/.test(binding?.customer_id||'')||!/^sub_[A-Za-z0-9]+$/.test(binding?.subscription_id||''))return kb.reply(200,{conversion:null});
 const key=process.env.STRIPE_READ_KEY,secret=process.env.ANALYTICS_SIGNING_SECRET;if(!key||!secret||secret.length<32)kb.fail(503,'Payment verification unavailable.');
 const response=await (adapters.fetch||fetch)('https://api.stripe.com/v1/invoices?customer='+encodeURIComponent(binding.customer_id)+'&status=paid&limit=100',{headers:{Authorization:'Bearer '+key,'Stripe-Version':'2026-08-26.dahlia'},signal:AbortSignal.timeout(5000)});
 if(!response.ok)kb.fail(503,'Payment verification unavailable.');const list=await response.json();if(list.has_more!==false||!Array.isArray(list.data))return kb.reply(200,{conversion:null});
 const invoices=list.data.filter(x=>x.status==='paid'&&x.paid!==false&&x.livemode===true&&x.customer===binding.customer_id&&/^in_[A-Za-z0-9]+$/.test(x.id||'')&&Number.isSafeInteger(x.amount_paid)&&x.amount_paid>0&&Number.isSafeInteger(x.status_transitions?.paid_at)).sort((a,b)=>a.status_transitions.paid_at-b.status_transitions.paid_at||a.id.localeCompare(b.id));
 const inv=invoices[0],sub=inv?.parent?.subscription_details?.subscription||inv?.subscription;
 if(!inv||sub!==binding.subscription_id||inv.currency!=='usd'||inv.status_transitions.paid_at*1000<p.since||inv.status_transitions.paid_at*1000>Date.now())return kb.reply(200,{conversion:null});
 return kb.reply(200,{conversion:{transaction_id:crypto.createHmac('sha256',secret).update('google-ads-first-payment:'+inv.id).digest('hex'),value:inv.amount_paid/100,currency:'USD'}});
 }catch(e){return kb.reply(e.status||503,{error:e.status?e.message:'Payment verification unavailable.'});}};}
module.exports={createHandler};
