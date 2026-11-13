// Independent provider-specific opt-in for Rewardful affiliate attribution.
const KEY='tendercrest.rewardful-consent.v1',DAYS=30*86400000;
let loaded=false,ready=false,token=null,busy=false,panel,status;const queued=new Set();
const privacy=()=>navigator.globalPrivacyControl===true||navigator.doNotTrack==='1';
function read(key){try{return JSON.parse(localStorage.getItem(key));}catch{return null;}}
function write(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
function safeURL(){const u=new URL(location.href),sensitive=/^(?:access_token|refresh_token|id_token|token|code|email|password|token_hash)$/i;return ![...u.searchParams.keys()].some(k=>sensitive.test(k))&&!/(?:access_token|refresh_token|id_token|token_hash|password|code)=/i.test(u.hash);}
function choice(){const c=read(KEY);return c?.allowed===true&&Number.isSafeInteger(c.since)&&c.since<=Date.now()&&c.expires>Date.now()?c:null;}
const allowed=()=>!privacy()&&safeURL()&&!!choice();
function load(){if(loaded||!allowed())return;const template=document.getElementById('rewardful-tracking');if(!template)return;
 loaded=true;
 // Recreate the supplied scripts verbatim, in order, only after this provider's opt-in.
 for(const original of template.content.querySelectorAll('script')){const script=document.createElement('script');for(const a of original.attributes)script.setAttribute(a.name,a.value);script.textContent=original.textContent;
  if(script.src){script.onload=()=>{ready=true;void identifyRewardfulCustomer(token);};script.onerror=()=>{if(status){status.textContent='Rewardful tracking could not load. Your choice is saved; browser or network blocking may prevent attribution.';panel.hidden=false;}};}
  document.head.append(script);
 }
}
export function setRewardfulConsent(accepted){if(typeof accepted!=='boolean')return false;const prior=choice();if(!write(KEY,{allowed:accepted,since:accepted&&prior?prior.since:Date.now(),expires:Date.now()+DAYS}))return false;if(!accepted&&loaded){token=null;location.reload();return true;}if(accepted){load();void identifyRewardfulCustomer(token);}return true;}
// Called from the existing signed-in checkout return/account callback. No signup-only conversion.
export async function identifyRewardfulCustomer(value){token=value||null;if(!token||busy||!allowed())return false;load();if(!ready)return false;
 const current=token,c=choice();busy=true;try{
  const r=await fetch('/.netlify/functions/rewardful-customer',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+current},body:JSON.stringify({consent:true,since:c.since}),signal:AbortSignal.timeout(15000)});if(!r.ok)return false;const d=(await r.json()).conversion;
  if(!allowed()||token!==current||!d||!/^[a-f0-9]{64}$/.test(d.id)||typeof d.email!=='string'||!/^\S+@[^\s@]+\.[^\s@]+$/.test(d.email))return false;
  const marker='tendercrest.rewardful-customer.'+d.id;if(queued.has(marker)||read(marker))return false;
  // Stripe's verified customer email is forwarded unchanged. No invoice/purchase is fabricated.
  window.rewardful('convert',{email:d.email});queued.add(marker);write(marker,{queuedAt:Date.now()});return true;
 }catch{return false;}finally{busy=false;if(token&&token!==current&&allowed())void identifyRewardfulCustomer(token);}}
function init(){
 const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
 panel=element('section');panel.id='rewardful-choice';panel.setAttribute('aria-label','Optional Rewardful affiliate attribution');panel.style.cssText='padding:16px;margin:16px 0;border:1px solid #94a3b8;border-radius:8px;background:#fff;color:#17243b';
 panel.append(element('h2','Optional Rewardful affiliate attribution'),element('p','Allow Rewardful affiliate attribution? Rewardful may use page visits, including signed-in pages, browser information and affiliate cookies to credit the partner who referred you. After Stripe creates your billing customer, we share that customer’s billing email with Rewardful to associate the referral. This is optional and separate from usage analytics, Google and OpenAI tracking.'));
 const link=element('a','Rewardful attribution privacy details');link.href='/security.html#rewardful-attribution';panel.append(link);status=element('p');status.setAttribute('role','status');panel.append(status);
 if(privacy())status.textContent='Your browser privacy signal prevents Rewardful tracking from loading.';else if(!safeURL())status.textContent='Rewardful tracking is unavailable on this credential or callback URL. Open the standard homepage to manage your choice.';
 const actions=element('div');actions.style.cssText='display:flex;gap:12px;flex-wrap:wrap';
 for(const [label,yes]of [['Allow Rewardful attribution',true],['Decline Rewardful attribution',false]]){const b=element('button',label);b.type='button';b.style.cssText='font:inherit;padding:10px 14px;border:1px solid #64748b;border-radius:6px;cursor:pointer';if(yes&&(privacy()||!safeURL()))b.disabled=true;b.onclick=()=>{if(!setRewardfulConsent(yes)){status.textContent='Your choice could not be saved. Rewardful stays disabled; check your browser storage settings.';return;}panel.hidden=true;};actions.append(b);}
 panel.append(actions);(document.querySelector('main')||document.body).prepend(panel);
 const settings=element('button','Rewardful attribution settings');settings.type='button';settings.style.cssText='font:inherit;padding:8px;border:1px solid currentColor;border-radius:6px;margin:8px';settings.onclick=()=>{panel.hidden=false;panel.querySelector('button').focus();};(document.querySelector('footer')||document.body).append(settings);
 const saved=read(KEY);panel.hidden=privacy()||!safeURL()||!!(saved&&saved.expires>Date.now());load();
 window.addEventListener('storage',event=>{if(event.key===KEY){if(loaded&&!allowed()){token=null;location.reload();}else if(allowed())load();}});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
