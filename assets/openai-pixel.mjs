// Separate advertising consent. Never import this module on authenticated/product pages.
const KEY='tendercrest.openai-ad-consent.v1',TTL=30*86400000;
const blocked=()=>navigator.globalPrivacyControl===true||navigator.doNotTrack==='1';
const publicHashes=new Set(['','#home','#features','#pricing','#product-film','#interactive-demo']);
const safeLocation=()=>['/','/index.html','/demo.html'].includes(location.pathname)&&publicHashes.has(location.hash)&&[...new URLSearchParams(location.search)].every(([k,v])=>/^utm_(source|medium|campaign|content|term)$/.test(k)&&/^[a-zA-Z0-9_-]{1,100}$/.test(v));
function read(){try{const c=JSON.parse(localStorage.getItem(KEY));return c?.expires>Date.now()?c:null;}catch{return null;}}
function save(allowed){try{localStorage.setItem(KEY,JSON.stringify({allowed,expires:Date.now()+TTL}));}catch{}}
let loaded=false;
function load(){
 if(loaded||blocked()||!safeLocation())return;
 loaded=true;
 if(!window.oaiq){const q=function(){q.q.push(arguments);};q.q=[];window.oaiq=q;
 const script=document.createElement('script');script.async=true;script.src='https://bzrcdn.openai.com/sdk/oaiq.min.js';document.head.append(script);}
 window.oaiq('init',{pixelId:'EXKpttMHWwqpN1QAmAU1eP',debug:false});
}
function init(){
 if(!safeLocation())return;
 const panel=document.createElement('section');panel.setAttribute('aria-label','Optional OpenAI advertising tracking');panel.style.cssText='padding:16px;margin:16px 0;border:1px solid #94a3b8;border-radius:8px;background:#fff;color:#17243b';
 const text=document.createElement('p');text.textContent='Optional OpenAI advertising tracking: allow the OpenAI advertising pixel on public demo and homepage pages to measure advertising effectiveness? This third-party SDK may process browser/device information, identifiers and page visits under OpenAI’s policies. This is separate from usage analytics and never authorizes model training.';panel.append(text);
 const link=document.createElement('a');link.href='/security.html#advertising-tracking';link.textContent='Advertising tracking details';panel.append(link);
 for(const [label,yes]of [['Allow OpenAI advertising tracking',true],['Decline advertising tracking',false]]){
 const button=document.createElement('button');button.type='button';button.textContent=label;button.style.cssText='margin:8px;padding:10px;font:inherit';button.onclick=()=>{save(yes);if(loaded&&!yes){location.reload();return;}panel.hidden=true;if(yes)load();};panel.append(button);
 }
 const settings=document.createElement('button');settings.type='button';settings.textContent='Advertising tracking settings';settings.onclick=()=>{panel.hidden=false;panel.querySelector('button').focus();};(document.querySelector('footer')||document.body).append(settings);
 (document.querySelector('main')||document.body).prepend(panel);
 const choice=read();panel.hidden=!!choice||blocked();if(choice?.allowed)load();
 // Leaving public marketing sections (e.g. opening sign-in) unloads the third-party runtime.
 window.addEventListener('hashchange',()=>{if(loaded&&!safeLocation())location.reload();});
 window.addEventListener('storage',e=>{if(e.key===KEY&&loaded&&read()?.allowed!==true)location.reload();});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
