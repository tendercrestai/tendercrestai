// Independent provider-specific opt-in for Rewardful affiliate attribution.
// First-visit choice is collected through the shared consent banner
// (./consent-banner.mjs); this module only registers its option there.
import { registerConsentOption, showConsentBanner, setConsentStatus } from './consent-banner.mjs';
const KEY='tendercrest.rewardful-consent.v1',DAYS=30*86400000;
let loaded=false,ready=false,token=null,busy=false,status;const queued=new Set();
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
  if(script.src){script.onload=()=>{ready=true;void identifyRewardfulCustomer(token);};script.onerror=()=>{setConsentStatus('rewardful','Rewardful tracking could not load. Your choice is saved; browser or network blocking may prevent attribution.');showConsentBanner('rewardful');};}
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
 registerConsentOption({id:'rewardful',title:'Rewardful affiliate attribution',summary:'Allow Rewardful affiliate attribution? Rewardful may use page visits, including signed-in pages, browser information and affiliate cookies to credit the partner who referred you. After Stripe creates your billing customer, we share that customer’s billing email with Rewardful to associate the referral. This is optional and separate from usage analytics, Google and OpenAI tracking.',detailsHref:'/security.html#rewardful-attribution',detailsText:'Rewardful attribution privacy details',readChoice:()=>{const c=read(KEY);return c&&c.expires>Date.now()?c:null;},saveChoice:(allowed)=>setRewardfulConsent(allowed),onDecision:()=>{},shouldPrompt:()=>{const c=read(KEY);const saved=!!(c&&c.expires>Date.now());return !privacy()&&safeURL()&&!saved;},canAllow:()=>safeURL()&&!privacy(),getStatus:()=>{if(privacy())return 'Your browser privacy signal prevents Rewardful tracking from loading.';if(!safeURL())return 'Rewardful tracking is unavailable on this credential or callback URL. Open the standard homepage to manage your choice.';return '';},statusLink:{href:'/',text:'Open standard homepage'},showStatusLink:()=>!safeURL()});
 // The three consent settings buttons (analytics, advertising, Rewardful)
// used to land as separate buttons in the footer flow. Group them under
// one labeled "Privacy choices" container instead.
function privacyChoices(){let c=document.getElementById('privacy-choices');if(!c){c=document.createElement('div');c.id='privacy-choices';const label=document.createElement('span');label.textContent='Privacy choices: ';c.append(label);(document.querySelector('footer')||document.body).append(c);}return c;}
const settings=element('button','Rewardful attribution settings');settings.type='button';settings.style.cssText='font:inherit;display:inline-block;width:auto;background:transparent;padding:8px;border:1px solid currentColor;border-radius:6px;margin:8px;color:inherit;cursor:pointer';settings.onclick=()=>showConsentBanner('rewardful');privacyChoices().append(settings);
 load();
 window.addEventListener('storage',event=>{if(event.key===KEY){if(loaded&&!allowed()){token=null;location.reload();}else if(allowed())load();}});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
