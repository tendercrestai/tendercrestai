const crypto = require('node:crypto');
const ROOT = 'https://api.airtable.com/v0/appsaqdp3UZdhB2VH/tbliWnP6ThqA02G5L';
const PLANS = {
  price_1UJqs7FinOspVJZ4xHjda0xZ: ['Pro ($299/mo)', 29900],
  price_1UJquQFinOspVJZ4MQWPDG5c: ['Growth ($699/mo)', 69900],
  price_1UJqwTFinOspVJZ4VPhpCVcG: ['Enterprise ($1,299/mo)', 129900]
};
const EVENTS = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed']);
const response = (statusCode, message) => ({statusCode, headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({message})});
const id = value => typeof value === 'string' ? value : value?.id;
function verified(body, signature, secret) {
  const parts = String(signature || '').split(',').map(x=>x.split('='));
  const timestamp = parts.find(x=>x[0]==='t')?.[1];
  if (!/^\d+$/.test(timestamp || '') || Math.abs(Date.now()/1000-Number(timestamp))>300) return false;
  const expected = crypto.createHmac('sha256',secret).update(timestamp+'.'+body).digest();
  return parts.filter(x=>x[0]==='v1').some(x=>/^[a-f0-9]{64}$/i.test(x[1]||'') && crypto.timingSafeEqual(expected,Buffer.from(x[1],'hex')));
}
async function request(url, options) {
  const res=await fetch(url,{...options,signal:AbortSignal.timeout(10000)});
  if(!res.ok) throw new Error('Upstream request failed');
  return res.json();
}
exports.handler = async event => {
  if(event.httpMethod!=='POST') return response(405,'Method not allowed');
  const {STRIPE_WEBHOOK_SECRET, STRIPE_READ_KEY, AIRTABLE_PAT} = process.env;
  if(!STRIPE_WEBHOOK_SECRET || !STRIPE_READ_KEY || !AIRTABLE_PAT) return response(503,'Billing synchronization is not configured');
  const raw=event.isBase64Encoded ? Buffer.from(event.body||'','base64') : Buffer.from(event.body||'','utf8');
  if(raw.length>1000000) return response(413,'Request too large');
  const signature=Object.entries(event.headers||{}).find(([key])=>key.toLowerCase()==='stripe-signature')?.[1];
  if(!verified(raw,signature,STRIPE_WEBHOOK_SECRET)) return response(400,'Invalid signature');
  let hook;
  try {hook=JSON.parse(raw.toString('utf8'));} catch {return response(400,'Invalid payload');}
  if(hook.livemode!==true) return response(400,'Live billing events required');
  if(!EVENTS.has(hook.type)) return response(200,'Event ignored');
  try {
    const object=hook.data?.object;
    const subscriptionId=hook.type.startsWith('customer.subscription.') ? object?.id : id(object?.subscription) || id(object?.parent?.subscription_details?.subscription);
    if(!subscriptionId || !/^sub_[A-Za-z0-9]+$/.test(subscriptionId)) return response(200,'No subscription to synchronize');
    const stripe = path => request('https://api.stripe.com/v1/'+path,{headers:{Authorization:'Bearer '+STRIPE_READ_KEY,'Stripe-Version':'2026-08-26.dahlia'}});
    // Fetch current Stripe state: event order and retries never dictate entitlements.
    const sub=await stripe('subscriptions/'+encodeURIComponent(subscriptionId)+'?expand%5B%5D=latest_invoice');
    if(sub.livemode!==true || id(sub.customer) === undefined) throw new Error('Unexpected subscription');
    const customerId=id(sub.customer);
    const customer=await stripe('customers/'+encodeURIComponent(customerId));
    if(customer.deleted || !customer.email) throw new Error('Billing customer requires review');
    const items=sub.items?.data||[];
    const plan=items.length===1 && items[0].quantity===1 && PLANS[id(items[0].price)];
    if(!plan) throw new Error('Unsupported price requires review');
    const enabled=['active','trialing'].includes(sub.status);
    const paid=sub.latest_invoice?.paid===true || sub.latest_invoice?.status==='paid';
    // A paid Checkout event alone never grants an unpaid/currently inactive subscription.
    const state=sub.pause_collection ? 'Past Due' : sub.status==='trialing' ? 'Trialing' : sub.status==='active' && paid ? 'Active' : ['past_due','unpaid','active'].includes(sub.status) ? 'Past Due' : 'Canceled';
    if(enabled) {
      const all=await stripe('subscriptions?customer='+encodeURIComponent(customerId)+'&status=all&limit=100');
      if(all.has_more || all.data.filter(s=>['active','trialing'].includes(s.status)).length!==1) throw new Error('Multiple subscriptions require review');
    }
    const email=customer.email.trim().toLowerCase();
    const literal=value=>"'"+value.replace(/\\/g,'\\\\').replace(/'/g,"\\'")+"'";
    const formula='OR({Stripe Subscription ID}='+literal(subscriptionId)+',{Stripe Customer ID}='+literal(customerId)+',LOWER(TRIM({Billing Email}))='+literal(email)+')';
    const headers={Authorization:'Bearer '+AIRTABLE_PAT,'Content-Type':'application/json'};
    const found=await request(ROOT+'?maxRecords=2&filterByFormula='+encodeURIComponent(formula),{headers});
    if(!Array.isArray(found.records) || found.records.length>1) throw new Error('Ambiguous company requires review');
    const existing=found.records[0];
    if(existing && ((existing.fields['Stripe Subscription ID'] && existing.fields['Stripe Subscription ID']!==subscriptionId) || (existing.fields['Stripe Customer ID'] && existing.fields['Stripe Customer ID']!==customerId))) throw new Error('Conflicting company identity');
    // Never create inactive accounts; canceled events still update an existing account by ID.
    if(!existing && !['Active','Trialing'].includes(state)) return response(200,'No eligible account to provision');
    const fields={'Billing Email':email,'Stripe Customer ID':customerId,'Stripe Subscription ID':subscriptionId,'Subscription Tier':plan[0],'Status':state};
    // Existing legacy quota formulas use minor units, despite the currency field display.
    // Preserve that representation until an explicit schema migration is performed.
    fields['Amount Paid']=plan[1];
    if(!existing) fields['Company Name']=customer.name || email;
    if(paid && Number.isFinite(sub.latest_invoice?.status_transitions?.paid_at)) fields['Last Billing Date']=new Date(sub.latest_invoice.status_transitions.paid_at*1000).toISOString().slice(0,10);
    if(sub.canceled_at) fields['Cancellation Date']=new Date(sub.canceled_at*1000).toISOString().slice(0,10);
    const record=existing ? {id:existing.id,fields} : {fields};
    const body={records:[record],typecast:false};
    if(!existing) body.performUpsert={fieldsToMergeOn:['Stripe Subscription ID']};
    await request(ROOT,{method:'PATCH',headers,body:JSON.stringify(body)});
    return response(200,'Billing synchronized');
  } catch {
    // Stripe retries non-2xx deliveries. Do not acknowledge failed Airtable writes.
    console.error('Billing synchronization failed; inspect Stripe delivery and Airtable account mapping.');
    return response(503,'Billing synchronization requires retry or account review');
  }
};
