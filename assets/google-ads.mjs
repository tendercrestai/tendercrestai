// Google measurement is independent of first-party usage and OpenAI consent.
// First-visit choice is collected through the shared consent banner
// (./consent-banner.mjs); this module only registers its option there.
import { registerConsentOption, showConsentBanner, setConsentStatus } from './consent-banner.mjs';
const KEY='tendercrest.google-ads-consent.v1',DAYS=30*86400000,ID='AW-18539401980',DEST=ID+'/5KPpCP7TuK0dEPylo4hF';
let loaded=false,token=null,busy=false;const queued=new Set();
const privacy=()=>navigator.globalPrivacyControl===true||navigator.doNotTrack==='1';
function read(k){try{return JSON.parse(localStorage.getItem(k));}catch{return null;}}
function write(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}
const choice=()=>{const c=read(KEY);return c?.allowed===true&&Number.isSafeInteger(c.since)&&c.since<=Date.now()&&c.expires>Date.now()?c:null;};
function publicPage(){return ['/','/index.html','/demo.html'].includes(location.pathname)&&['','#overview','#home','#features','#pricing','#product-film','#interactive-demo'].includes(location.hash);}
function safe(){return publicPage()&&[...new URLSearchParams(location.search)].every(([k,v])=>k==='gtm_debug'?/^[A-Za-z0-9_-]{1,32}$/.test(v):(/^utm_(source|medium|campaign|content|term)$/.test(k)||['gclid','gbraid','wbraid'].includes(k))&&/^[A-Za-z0-9_.~-]{1,250}$/.test(v));}
function measurementLocation(){const u=new URL(location.href);u.searchParams.delete('gtm_debug');u.hash='';return u.href;}

const allowed=()=>safe()&&!privacy()&&!!choice();
function load(){if(loaded||!allowed())return;loaded=true;window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){window.dataLayer.push(arguments);};
 window.gtag('consent','default',{ad_storage:'denied',analytics_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
 window.gtag('js',new Date());window.gtag('consent','update',{ad_storage:'granted',ad_user_data:'granted',ad_personalization:'denied',analytics_storage:'denied'});
 window.gtag('config',ID,{send_page_view:false,allow_google_signals:false,allow_enhanced_conversions:false,allow_ad_personalization_signals:false,page_location:measurementLocation(),page_referrer:''});
 const s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id='+ID;s.onerror=()=>{setConsentStatus('google','Google measurement could not load. Browser or network blocking may prevent it. Reload the page to retry; your consent choice is saved.');showConsentBanner('google');};document.head.append(s);
}
export async function identifyGooglePurchase(value){token=value||null;if(!token||busy||!allowed())return;load();busy=true;const current=token,c=choice();try{
 const r=await fetch('/.netlify/functions/google-ads-conversion',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+current},body:JSON.stringify({consent:true,since:c.since}),signal:AbortSignal.timeout(8000)});if(!r.ok)return;const d=(await r.json()).conversion;
 if(!allowed()||token!==current||!d||!/^[a-f0-9]{64}$/.test(d.transaction_id)||typeof d.value!=='number'||!Number.isFinite(d.value)||d.value<=0||d.currency!=='USD')return;
 const key='tendercrest.google-paid.'+d.transaction_id;if(read(key)||queued.has(key))return;queued.add(key);
 window.gtag('event','conversion',{send_to:DEST,value:d.value,currency:d.currency,transaction_id:d.transaction_id,event_callback:()=>write(key,{processedAt:Date.now()}),page_location:location.origin+location.pathname,page_referrer:''});
 }catch{/* Optional advertising must not interrupt the product. */}finally{busy=false;}}
function init(){if(!publicPage())return;
 // A saved choice must stop prompting even on an unsafe URL: measurement
 // is disabled there anyway, and Allow is not offered there (canAllow is
 // false), so prompting on !safe() meant the banner could never dismiss on
 // such a URL — Allow all skipped Google and Decline all still prompted.
 registerConsentOption({id:'google',title:'Google advertising measurement',summary:'Allow Google advertising measurement? Google may use page visits, ad click identifiers and cookies to attribute your first paid subscription. If you return signed in after payment, we send a pseudonymous transaction ID, amount and currency. No proposal content or email address is sent. This is separate from usage analytics and OpenAI tracking.',detailsHref:'/security.html#google-advertising',detailsText:'Google measurement details',readChoice:()=>{const c=read(KEY);return c&&c.expires>Date.now()?c:null;},saveChoice:(allowed)=>{const existing=choice();write(KEY,{allowed,since:allowed&&existing&&existing.since>Date.now()-DAYS?existing.since:Date.now(),expires:Date.now()+DAYS});},onDecision:(allowed)=>{if(loaded&&!allowed){location.reload();return;}if(allowed){load();void identifyGooglePurchase(token);}},shouldPrompt:()=>{const c=read(KEY);const saved=!!(c&&c.expires>Date.now());return !privacy()&&!saved;},canAllow:()=>safe()&&!privacy(),getStatus:()=>{if(!safe())return 'Measurement is disabled for this URL because it contains unsupported parameters.';if(privacy())return 'Your browser privacy signal prevents Google measurement from loading.';return '';},statusLink:{href:'/',text:'Open standard homepage'},showStatusLink:()=>!safe()});
 const settings=document.createElement('button');settings.type='button';settings.textContent='Google advertising settings';settings.style.cssText='font:inherit;display:inline-block;width:auto;background:transparent;border:1px solid currentColor;border-radius:6px;padding:8px;color:inherit;cursor:pointer';settings.onclick=()=>showConsentBanner('google');(document.querySelector('footer')||document.body).append(settings);
 if(allowed())load();
 window.addEventListener('hashchange',()=>{if(loaded&&!safe())location.reload();});window.addEventListener('storage',e=>{if(e.key===KEY&&loaded&&!allowed())location.reload();});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
