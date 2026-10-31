// Prepared integration. A distinct affiliate consent choice must be wired before release.
// Existing usage/Google/OpenAI preferences never authorize sharing signup email.
const KEY='tendercrest.affiliate-consent.v1',DAYS=30*86400000;
let loaded=false;const queued=new Set();
const privacy=()=>navigator.globalPrivacyControl===true||navigator.doNotTrack==='1';
function read(key){try{return JSON.parse(localStorage.getItem(key));}catch{return null;}}
function write(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
function safeURL(){const u=new URL(location.href);const sensitive=/^(?:access_token|refresh_token|id_token|token|code|email|password|token_hash)$/i;return ![...u.searchParams.keys()].some(k=>sensitive.test(k))&&!/(?:access_token|refresh_token|id_token|token_hash|password|code)=/i.test(u.hash);}
const allowed=()=>!privacy()&&safeURL()&&read(KEY)?.allowed===true&&read(KEY)?.expires>Date.now();
function load(){if(loaded||!allowed())return false;loaded=true;
 if(!window.gr){window.gr=function(){window.gr.ce=60;window.gr.q=window.gr.q||[];window.gr.q.push(arguments);};}
 const script=document.createElement('script');script.async=true;script.src='https://script.getreditus.com/v2.js';document.head.append(script);
 window.gr('initCustomer','52151d93-4c26-4a39-9346-e17eb42d38b4');window.gr('track','pageview');return true;
}
// Only a purpose-specific, informed visitor choice may invoke this. No UI is added here.
export function setReditusConsent(accepted){if(typeof accepted!=='boolean')return false;if(!write(KEY,{allowed:accepted,expires:Date.now()+DAYS}))return false;if(!accepted&&loaded){location.reload();return true;}if(accepted)load();return true;}
export function trackReditusSignup(user){try{
 if(!allowed()||!user||typeof user.id!=='string'||!user.id||typeof user.email!=='string'||!user.email.includes('@')||!Array.isArray(user.identities)||!user.identities.length)return false;
 const marker='tendercrest.affiliate-signup.'+user.id;if(queued.has(marker)||read(marker))return false;
 load();window.gr('track','conversion',{email:user.email});queued.add(marker);write(marker,{queuedAt:Date.now()});return true;
 }catch{return false;}}
window.addEventListener('storage',event=>{if(event.key===KEY){if(loaded&&!allowed())location.reload();else if(allowed())load();}});
load();
