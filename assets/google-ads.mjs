// Google measurement is independent of first-party usage and OpenAI consent.
const KEY='tendercrest.google-ads-consent.v1',DAYS=30*86400000,ID='AW-18539401980',DEST=ID+'/5KPpCP7TuK0dEPylo4hF';
let loaded=false,token=null,busy=false,panel;const queued=new Set();
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
 const s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id='+ID;s.onerror=()=>{if(!panel)return;const note=document.createElement('p');note.setAttribute('role','status');note.textContent='Google measurement could not load. Browser or network blocking may prevent it. Reload the page to retry; your consent choice is saved.';panel.append(note);panel.hidden=false;};document.head.append(s);
}
export async function identifyGooglePurchase(value){token=value||null;if(!token||busy||!allowed())return;load();busy=true;const current=token,c=choice();try{
 const r=await fetch('/.netlify/functions/google-ads-conversion',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+current},body:JSON.stringify({consent:true,since:c.since}),signal:AbortSignal.timeout(8000)});if(!r.ok)return;const d=(await r.json()).conversion;
 if(!allowed()||token!==current||!d||!/^[a-f0-9]{64}$/.test(d.transaction_id)||typeof d.value!=='number'||!Number.isFinite(d.value)||d.value<=0||d.currency!=='USD')return;
 const key='tendercrest.google-paid.'+d.transaction_id;if(read(key)||queued.has(key))return;queued.add(key);
 window.gtag('event','conversion',{send_to:DEST,value:d.value,currency:d.currency,transaction_id:d.transaction_id,event_callback:()=>write(key,{processedAt:Date.now()}),page_location:location.origin+location.pathname,page_referrer:''});
 }catch{/* Optional advertising must not interrupt the product. */}finally{busy=false;}}
function init(){if(!publicPage())return;
 panel=document.createElement('section');panel.setAttribute('aria-label','Optional Google advertising measurement');panel.style.cssText='padding:16px;margin:16px 0;border:1px solid #94a3b8;border-radius:8px;background:white;color:#17243b';
 const p=document.createElement('p');p.textContent='Allow Google advertising measurement? Google may use page visits, ad click identifiers and cookies to attribute your first paid subscription. If you return signed in after payment, we send a pseudonymous transaction ID, amount and currency. No proposal content or email address is sent. This is separate from usage analytics and OpenAI tracking.';panel.append(p);
 if(!safe()){const notice=document.createElement('p');notice.textContent='Measurement is disabled for this URL because it contains unsupported parameters. Open the standard homepage to manage your choice.';const home=document.createElement('a');home.href='/';home.textContent='Open standard homepage';panel.append(notice,home);}
 if(privacy()){const notice=document.createElement('p');notice.textContent='Your browser privacy signal prevents Google measurement from loading.';panel.append(notice);}
 const link=document.createElement('a');link.href='/security.html#google-advertising';link.textContent='Google measurement details';panel.append(link);
 for(const [label,yes]of [['Allow Google ad measurement',true],['Decline Google ad measurement',false]]){const b=document.createElement('button');b.type='button';b.textContent=label;if(yes&&(!safe()||privacy()))b.disabled=true;b.style.cssText='margin:8px;padding:10px;font:inherit';b.onclick=()=>{const existing=choice();write(KEY,{allowed:yes,since:yes&&existing&&existing.since>Date.now()-DAYS?existing.since:Date.now(),expires:Date.now()+DAYS});if(loaded&&!yes){location.reload();return;}panel.hidden=true;if(yes){load();void identifyGooglePurchase(token);}};panel.append(b);}
 const settings=document.createElement('button');settings.type='button';settings.textContent='Google advertising settings';settings.onclick=()=>{panel.hidden=false;panel.querySelector('button').focus();};(document.querySelector('footer')||document.body).append(settings);(document.querySelector('main')||document.body).prepend(panel);
 const stored=read(KEY);panel.hidden=safe()&&(privacy()||!!(stored&&stored.expires>Date.now()));if(allowed())load();
 window.addEventListener('hashchange',()=>{if(loaded&&!safe())location.reload();});window.addEventListener('storage',e=>{if(e.key===KEY&&loaded&&!allowed())location.reload();});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
