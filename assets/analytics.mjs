// Optional first-party metrics only. No form/document text, email, URL or referrer collection.
// First-visit choice is collected through the shared consent banner
// (./consent-banner.mjs); this module only registers its option there.
import { registerConsentOption, showConsentBanner } from './consent-banner.mjs';
const PENDING_WITHDRAWALS='tendercrest.usage.withdrawals.v1';
const CHOICE='tendercrest.usage.choice.v1',VISITOR='tendercrest.usage.visitor.v1',DAYS=30*86400000;
const CHANNELS=['direct','google','reddit','linkedin','other'],CAMPAIGNS=['direct','us_gov_proposal_pilot','government_it_pilot','other'];
let pageEnabled=document.documentElement.dataset.usageAnalytics==='enabled',choice,visitor,epoch=0,startPromise,pendingToken=null,linked='',privacyButton;
const privacySignal=()=>navigator.globalPrivacyControl===true||navigator.doNotTrack==='1';
function read(key){try{return JSON.parse(localStorage.getItem(key));}catch{return null;}}
function write(key,value){try{if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,JSON.stringify(value));}catch{/* Storage denial must not break the product. */}}
choice=read(CHOICE);if(!choice||choice.expires<=Date.now())choice=null;visitor=read(VISITOR);
const allowed=()=>pageEnabled&&!privacySignal()&&choice?.allowed===true&&choice.expires>Date.now();
async function api(body,token){const r=await fetch('/.netlify/functions/analytics',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body),keepalive:true,signal:AbortSignal.timeout(1800)});if(!r.ok){const e=Error('Optional usage request failed');e.status=r.status;throw e;}return r.json();}
async function retryWithdrawals(){
 const pending=read(PENDING_WITHDRAWALS);if(!Array.isArray(pending))return;
 for(const old of pending.slice(0,20)){
  if(!old||typeof old.token!=='string'||!Number.isFinite(old.at))continue;
  let removed=old.at<Date.now()-95*86400000;
  if(!removed)try{await api({action:'withdraw',token:old.token});removed=true;}catch{/* Retain only the signed deletion token so the next page/online event can retry. */}
  if(removed){const current=read(PENDING_WITHDRAWALS);if(Array.isArray(current))write(PENDING_WITHDRAWALS,current.filter(x=>x.token!==old.token));}
 }
}
async function withdraw(){epoch++;const old=visitor;visitor=null;linked='';write(VISITOR,null);
 if(old?.token){const pending=read(PENDING_WITHDRAWALS);const list=Array.isArray(pending)?pending:[];if(!list.some(x=>x.token===old.token))list.push({token:old.token,at:Date.now()});write(PENDING_WITHDRAWALS,list);}
 await retryWithdrawals();
}
async function getVisitor(){if(!allowed())return null;if(visitor?.expires>Date.now())return visitor;if(startPromise)return startPromise;const current=epoch;startPromise=(async()=>{const params=new URLSearchParams(location.search),raw=params.get('utm_source')||'direct',campaign=params.get('utm_campaign')||'direct';const result=await api({action:'start',consent:true,channel:CHANNELS.includes(raw)?raw:'other',campaign:CAMPAIGNS.includes(campaign)?campaign:'other'});if(current!==epoch||!allowed()){try{await api({action:'withdraw',token:result.token});}catch{}return null;}visitor={token:result.token,expires:result.expires};write(VISITOR,visitor);return visitor;})();try{return await startPromise;}finally{startPromise=null;}}
export async function trackUsage(name,scenario='none'){if(!allowed())return;const current=epoch;try{const v=await getVisitor();if(!v||current!==epoch||!allowed())return;await api({action:'event',token:v.token,name,scenario});}catch(e){if([401,404].includes(e.status)){visitor=null;linked='';write(VISITOR,null);}}}
export async function identifyUsage(token){if(!pageEnabled||privacySignal())return;pendingToken=token||null;if(!token){linked='';return;}if(!allowed())return;try{const v=await getVisitor();if(!v||!allowed()||pendingToken!==token||linked===v.token+token)return;await api({action:'identify',token:v.token},token);linked=v.token+token;}catch(e){if([401,404,409].includes(e.status)){visitor=null;linked='';write(VISITOR,null);}}}
function element(tag,text){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;}
function init(){void retryWithdrawals();window.addEventListener('online',()=>{void retryWithdrawals();});if(!pageEnabled&&!choice&&!visitor)return;
 registerConsentOption({id:'analytics',title:'Usage analytics',summary:'Allow first-party usage analytics to help us understand demo, signup and product conversion? We use a random browser ID and may link it to your verified account. No proposal text, passwords, emails or full URLs are collected as analytics attributes. Reporting covers 90 days; daily cleanup removes older records. This does not authorize model training.',detailsHref:'/security.html#usage-analytics',detailsText:'Usage analytics and privacy details',readChoice:()=>choice,saveChoice:(allowed)=>{choice={allowed,expires:Date.now()+DAYS};write(CHOICE,choice);},onDecision:async(allowed)=>{if(!allowed||privacySignal()){await withdraw();return;}epoch++;await getVisitor().catch(()=>null);void identifyUsage(pendingToken);void trackUsage('page_view');document.dispatchEvent(new CustomEvent('tendercrest:analytics-enabled'));},shouldPrompt:()=>!choice&&!privacySignal()&&pageEnabled,canAllow:()=>!privacySignal()&&pageEnabled});
 // The three consent settings buttons (analytics, advertising, Rewardful)
// used to land as separate buttons in the footer flow. Group them under
// one labeled "Privacy choices" container instead.
function privacyChoices(){let c=document.getElementById('privacy-choices');if(!c){c=document.createElement('div');c.id='privacy-choices';const label=document.createElement('span');label.textContent='Privacy choices: ';c.append(label);(document.querySelector('footer')||document.body).append(c);}return c;}
privacyButton=element('button','Usage analytics settings');privacyButton.type='button';privacyButton.style.cssText='font:inherit;display:inline-block;width:auto;background:transparent;border:1px solid currentColor;border-radius:6px;padding:8px;color:inherit;cursor:pointer';privacyButton.onclick=()=>showConsentBanner('analytics');privacyChoices().append(privacyButton);
 if(privacySignal()){choice={allowed:false,expires:Date.now()+DAYS};write(CHOICE,choice);void withdraw();}else if(allowed())void trackUsage('page_view');
 document.addEventListener('tendercrest:demo',e=>{const name=e.detail?.name;if(['demo_started','demo_completed'].includes(name))void trackUsage(name,['it','marketing','consulting'].includes(e.detail.scenario)?e.detail.scenario:'none');});
 document.addEventListener('submit',e=>{if(e.target.id==='signupForm')void trackUsage('signup_started');},true);
 document.addEventListener('click',e=>{const t=e.target.closest?.('a,button');if(!t)return;if(t.dataset.view==='signup')void trackUsage('signup_started');const href=t.getAttribute('href')||'';if(href.startsWith('/auth.html')&&/create/i.test(t.textContent))void trackUsage('signup_started');if(href==='#pricing'||href==='/#pricing')void trackUsage(/trial/i.test(t.textContent)?'trial_cta_clicked':'pricing_viewed');if(href.startsWith('https://buy.stripe.com/'))void trackUsage('trial_cta_clicked');},true);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
