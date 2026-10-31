// Reditus affiliate attribution requires its own informed opt-in.
// Existing usage/Google/OpenAI preferences never authorize sharing signup email.
const KEY='tendercrest.affiliate-consent.v1',DAYS=30*86400000;
let loaded=false,panel,status;const queued=new Set();
const privacy=()=>navigator.globalPrivacyControl===true||navigator.doNotTrack==='1';
function read(key){try{return JSON.parse(localStorage.getItem(key));}catch{return null;}}
function write(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
function safeURL(){const u=new URL(location.href);const sensitive=/^(?:access_token|refresh_token|id_token|token|code|email|password|token_hash)$/i;return ![...u.searchParams.keys()].some(k=>sensitive.test(k))&&!/(?:access_token|refresh_token|id_token|token_hash|password|code)=/i.test(u.hash);}
const allowed=()=>!privacy()&&safeURL()&&read(KEY)?.allowed===true&&read(KEY)?.expires>Date.now();
function load(){if(loaded||!allowed())return false;loaded=true;
 if(!window.gr){window.gr=function(){window.gr.ce=60;window.gr.q=window.gr.q||[];window.gr.q.push(arguments);};}
 const script=document.createElement('script');script.async=true;script.src='https://script.getreditus.com/v2.js';script.onerror=()=>{if(status){status.textContent='Affiliate tracking could not load. Your choice is saved; browser or network blocking may prevent attribution.';panel.hidden=false;}};document.head.append(script);
 window.gr('initCustomer','52151d93-4c26-4a39-9346-e17eb42d38b4');window.gr('track','pageview');return true;
}
// Only the purpose-specific visitor choice below invokes this in normal use.
export function setReditusConsent(accepted){if(typeof accepted!=='boolean')return false;if(!write(KEY,{allowed:accepted,expires:Date.now()+DAYS}))return false;if(!accepted&&loaded){location.reload();return true;}if(accepted)load();return true;}
export function trackReditusSignup(user){try{
 if(!allowed()||!user||typeof user.id!=='string'||!user.id||typeof user.email!=='string'||!user.email.includes('@')||!Array.isArray(user.identities)||!user.identities.length)return false;
 const marker='tendercrest.affiliate-signup.'+user.id;if(queued.has(marker)||read(marker))return false;
 load();window.gr('track','conversion',{email:user.email});queued.add(marker);write(marker,{queuedAt:Date.now()});return true;
 }catch{return false;}}
window.addEventListener('storage',event=>{if(event.key===KEY){if(loaded&&!allowed())location.reload();else if(allowed())load();}});
function init(){
 const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
 panel=element('section');panel.id='affiliate-choice';panel.setAttribute('aria-label','Optional affiliate attribution');panel.style.cssText='padding:16px;margin:16px 0;border:1px solid #94a3b8;border-radius:8px;background:#fff;color:#17243b';
 panel.append(element('h2','Optional affiliate attribution'),element('p','Allow Reditus affiliate attribution? Reditus may use page visits, including signed-in pages, browser information and affiliate cookies to credit the partner who referred you. If you create an account after allowing this, your signup email will be shared with Reditus to create a referral record. This choice is optional and separate from usage analytics, Google and OpenAI tracking.'));
 const link=element('a','Affiliate attribution privacy details');link.href='/security.html#affiliate-attribution';panel.append(link);
 status=element('p');status.setAttribute('role','status');panel.append(status);
 if(privacy())status.textContent='Your browser privacy signal prevents affiliate tracking from loading.';
 else if(!safeURL())status.textContent='Affiliate tracking is unavailable on this credential or callback URL. Open the standard homepage to manage your choice.';
 const actions=element('div');actions.style.cssText='display:flex;gap:12px;flex-wrap:wrap';
 for(const [label,yes]of [['Allow affiliate attribution',true],['Decline affiliate attribution',false]]){const button=element('button',label);button.type='button';button.style.cssText='font:inherit;padding:10px 14px;border:1px solid #64748b;border-radius:6px;cursor:pointer';if(yes&&(privacy()||!safeURL()))button.disabled=true;button.onclick=()=>{if(!setReditusConsent(yes)){status.textContent='Your choice could not be saved. Tracking stays disabled; check your browser storage settings.';return;}panel.hidden=true;};actions.append(button);}
 panel.append(actions);(document.querySelector('main')||document.body).prepend(panel);
 const settings=element('button','Affiliate attribution settings');settings.type='button';settings.style.cssText='font:inherit;padding:8px;border:1px solid currentColor;border-radius:6px;margin:8px';settings.onclick=()=>{panel.hidden=false;panel.querySelector('button').focus();};(document.querySelector('footer')||document.body).append(settings);
 const saved=read(KEY);panel.hidden=privacy()||!safeURL()||!!(saved&&saved.expires>Date.now());load();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
