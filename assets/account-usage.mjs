// Account-only rendering. Never accepts a client company ID or billing email.
export function createAccountUsage(container,getSession){
 let epoch=0,current=null;
 const node=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
 function clear(){epoch++;current=null;container.replaceChildren();}
 async function show(user){
  const run=++epoch;current=user;container.replaceChildren(node('h3','Proposal allowance'),node('p','Loading your current allowance…'));
  const refresh=node('button','Refresh allowance');refresh.type='button';refresh.className='secondary';refresh.onclick=()=>{if(current)void show(current);};
  try{
   const {data,error}=await getSession();if(error||!data.session||data.session.user.id!==user.id)throw Error('Please sign in again to view your allowance.');
   const r=await fetch('/.netlify/functions/account-usage',{headers:{Authorization:'Bearer '+data.session.access_token},cache:'no-store',signal:AbortSignal.timeout(20000)});
   const usage=await r.json();if(!r.ok)throw Error(usage.error||'Your allowance is temporarily unavailable.');if(run!==epoch)return;
   container.replaceChildren(node('h3','Proposal allowance'));
   if(usage.plan)container.append(node('p','Plan: '+usage.plan));
   if(!usage.available){container.append(node('p',usage.message));if(usage.state==='no_plan'){const a=node('a','View plans and trial terms');a.href='/#pricing';container.append(a);}}
   else{
    container.append(node('p',usage.remaining+' of '+usage.allowance+' proposals remaining'),node('p',usage.used+' used or in progress this '+(usage.state==='trial'?'trial':'billing period')+'.'));
    const date=new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(usage.periodEnd));
    container.append(node('p',usage.state==='trial'?'Trial ends: '+date+'. The allowance does not reset during the trial.':'Next billing reset: '+date+' (after successful renewal).'));
    if(!usage.remaining)container.append(node('p','Your proposal allowance has been reached.'));
    container.append(node('p','This balance covers the emailed AI-draft service. Workspace editing and exports do not use these credits.'));
    container.append(node('p','Checked '+new Intl.DateTimeFormat(undefined,{timeStyle:'short'}).format(new Date(usage.asOf))+'. Pending proposals count toward usage; failed proposals are excluded.'));
   }
  }catch(e){if(run!==epoch)return;container.replaceChildren(node('h3','Proposal allowance'),node('p',e.message||'Your allowance is temporarily unavailable.'));}
  if(run===epoch)container.append(refresh);
 }
 return {show,clear};
}
