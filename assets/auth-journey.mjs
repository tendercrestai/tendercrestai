const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const DESTINATIONS={checkout:'/auth.html#checkout',workspace:'/workspace.html',knowledge:'/knowledge.html',compliance:'/compliance.html','rfp-upload':'/rfp-upload.html','email-draft':'/#portal'};
export function authDestination(search=''){
 const p=new URLSearchParams(search),next=p.get('next');if(!Object.hasOwn(DESTINATIONS,next))return null;
 if(next==='checkout')return '/auth.html'+(['pro','growth','enterprise'].includes(p.get('plan'))?'?plan='+p.get('plan'):'')+'#checkout';const project=p.get('project'),analysis=p.get('compliance');if(next==='email-draft'&&UUID.test(analysis||''))return '/?compliance='+analysis+'#portal';return DESTINATIONS[next]+(next==='workspace'&&UUID.test(project||'')?'#'+project:'');
}
export function authReturnQuery(search=''){
 const p=new URLSearchParams(search),next=p.get('next');if(!authDestination(search))return '';
 const q=new URLSearchParams({next});if(next==='checkout'&&['pro','growth','enterprise'].includes(p.get('plan')))q.set('plan',p.get('plan'));if(next==='workspace'&&UUID.test(p.get('project')||''))q.set('project',p.get('project'));if(next==='email-draft'&&UUID.test(p.get('compliance')||''))q.set('compliance',p.get('compliance'));return '?'+q;
}
export async function loadAuthConfig(fetcher=fetch){
 try{const r=await fetcher('/.netlify/functions/auth-config',{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error();const c=await r.json();if(!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(c.url)||!/^sb_publishable_[A-Za-z0-9_.-]+$/.test(c.key||''))throw Error();const result={url:c.url,key:c.key};for(const key of ['customerCare','authenticatedCheckout','personalDeletion'])if(typeof c[key]==='boolean')result[key]=c[key];return result;}
 catch{throw Error('Account connection is temporarily unavailable. Reload this page to retry.');}
}
export function showAuthUnavailable(error){
 const box=document.getElementById('message')||document.getElementById('status-alert');
 if(box){box.textContent=error.message;box.setAttribute('role','alert');box.style.display='block';const b=document.createElement('button');b.type='button';b.textContent='Retry account connection';b.onclick=()=>location.reload();box.append(document.createElement('br'),b);}
 document.querySelectorAll('#loginForm button,#signupForm button,#forgotForm button,#resetForm button').forEach(b=>b.disabled=true);
}
