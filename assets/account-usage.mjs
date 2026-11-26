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
    if(usage.periodStart)container.append(node('p',usage.state==='trial'?'Trial started: '+new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(usage.periodStart))+'.':'This billing period started '+new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(usage.periodStart))+'. Submissions before then were in the previous period.'));
    if(!usage.remaining)container.append(node('p','Your proposal allowance has been reached.'));
    container.append(node('p','This balance covers the emailed AI-draft service. Workspace editing and exports do not use these credits. Grant projects in the workspace do not draw on this balance; it covers emailed AI drafts only.'));
    // Nov 25 full-site review, logged-in #9: the pricing FAQ used to say a
    // customer holds either a grant plan or an RFP plan, which reads as a
    // contradiction for an RFP-plan account that holds a grant project.
    // One subscription covers emailed drafts of either kind; grant-priced
    // plans are the lower-volume options.
    if(usage.plan&&!usage.plan.startsWith('Grant'))container.append(node('p','Your plan covers emailed drafts for RFP and grant projects alike; grant-priced plans (Grant Starter $19, Grant Plus $49, Grant Pro $99 per month) are the lower-volume options.'));
    container.append(node('p','Checked '+new Intl.DateTimeFormat(undefined,{timeStyle:'short'}).format(new Date(usage.asOf))+'. Pending proposals count toward usage; failed proposals are excluded.'));
    container.append(node('h3','Usage history'),node('p','Review proposal credits by job or project.'));
    const ledgerStatus=node('p','Loading your usage history…');ledgerStatus.setAttribute('role','status');const ledgerList=node('div');container.append(ledgerStatus,ledgerList);
    let ledgerPage=0,ledgerLoading=false;const ledgerButton=node('button','View the complete ledger');ledgerButton.type='button';ledgerButton.className='secondary';
    const ledgerDate=value=>{const at=Date.parse(value||'');return Number.isFinite(at)?new Date(at).toLocaleString():null;};
    const ledgerRef=id=>{const v=String(id||'');return v.length>8?v.slice(0,8)+'…':v;};
    async function loadLedger(page){
     if(ledgerLoading)return;ledgerLoading=true;ledgerButton.disabled=true;
     try{
      const {data:sessionData,error:sessionError}=await getSession();if(sessionError||!sessionData.session||sessionData.session.user.id!==user.id)throw Error('Please sign in again to view your usage history.');
      const r=await fetch('/.netlify/functions/account-ledger?page='+page,{headers:{Authorization:'Bearer '+sessionData.session.access_token},cache:'no-store',signal:AbortSignal.timeout(20000)});
      const d=await r.json();if(!r.ok)throw Error(d.error||'Usage history is temporarily unavailable.');if(run!==epoch)return;
      if(page===0){ledgerList.replaceChildren();if(d.missingLinkedRecords)ledgerList.append(node('p',d.missingLinkedRecords+' linked proposal record(s) could not be found. The entries below count the records that exist.'));}
      if(!d.entries.length&&page===0)ledgerStatus.textContent='No proposal credits have been used yet.';
      else ledgerStatus.textContent=d.total+' proposal credit '+(d.total===1?'entry':'entries')+' in your usage history.';
      for(const e of d.entries){const row=node('article');row.append(node('p',[ledgerDate(e.date),e.label,e.status,e.inCurrentPeriod===false?'(earlier billing period)':null,e.reference?'reference '+ledgerRef(e.reference):null].filter(Boolean).join(' · ')));ledgerList.append(row);}
      ledgerPage=page;
      if(d.hasMore){ledgerButton.disabled=false;if(!ledgerButton.parentNode)container.append(ledgerButton);}
      else ledgerButton.remove();
     }catch(e){if(run!==epoch)return;ledgerStatus.textContent=e.message||'Usage history is temporarily unavailable.';ledgerButton.disabled=false;}
     finally{ledgerLoading=false;}
    }
    ledgerButton.onclick=()=>{void loadLedger(ledgerPage+1);};
    void loadLedger(0);
   }
  }catch(e){if(run!==epoch)return;container.replaceChildren(node('h3','Proposal allowance'),node('p',e.message||'Your allowance is temporarily unavailable.'));}
  if(run===epoch)container.append(refresh);
 }
 return {show,clear};
}
