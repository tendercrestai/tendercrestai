// Separate advertising consent. Never import this module on authenticated/product pages.
// First-visit choice is collected through the shared consent banner
// (./consent-banner.mjs); this module only registers its option there.
import { registerConsentOption, showConsentBanner } from './consent-banner.mjs';
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
 window.oaiq('measure','page_viewed',{type:'contents'});
}
function init(){
 if(!safeLocation())return;
 registerConsentOption({id:'openai',title:'OpenAI advertising tracking',summary:'Allow the OpenAI advertising pixel on public demo and homepage pages to measure advertising effectiveness? This third-party SDK may process browser/device information, identifiers and page visits under OpenAI’s policies. This is separate from usage analytics and never authorizes model training.',detailsHref:'/security.html#advertising-tracking',detailsText:'Advertising tracking details',readChoice:()=>read(),saveChoice:(allowed)=>save(allowed),onDecision:(allowed)=>{if(loaded&&!allowed){location.reload();return;}if(allowed)load();},shouldPrompt:()=>!read()&&!blocked(),canAllow:()=>!blocked()});
 // The three consent settings buttons (analytics, advertising, Rewardful)
// used to land as separate buttons in the footer flow. Group them under
// one labeled "Privacy choices" container instead.
function privacyChoices(){let c=document.getElementById('privacy-choices');if(!c){c=document.createElement('div');c.id='privacy-choices';const label=document.createElement('span');label.textContent='Privacy choices: ';c.append(label);(document.querySelector('footer')||document.body).append(c);}return c;}
const settings=document.createElement('button');settings.type='button';settings.textContent='Advertising tracking settings';settings.style.cssText='font:inherit;display:inline-block;width:auto;background:transparent;border:1px solid currentColor;border-radius:6px;padding:8px;color:inherit;cursor:pointer';settings.onclick=()=>showConsentBanner('openai');privacyChoices().append(settings);
 if(read()?.allowed)load();
 // Leaving public marketing sections (e.g. opening sign-in) unloads the third-party runtime.
 window.addEventListener('hashchange',()=>{if(loaded&&!safeLocation())location.reload();});
 window.addEventListener('storage',e=>{if(e.key===KEY&&loaded&&read()?.allowed!==true)location.reload();});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
