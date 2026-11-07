const kb=require('./lib/knowledge-base'),F=require('./lib/free-tools'),B=require('./lib/bid-check'),crypto=require('node:crypto');
exports.handler=async event=>{try{const p=kb.parse(event,2900000);if(!F.enabled())kb.fail(503,'Free tools are not available on this deployment yet.');const c=kb.configuration();
 if(p.action==='event'){kb.exact(p,['action','name','consent','id']);if(p.consent!==true||!['shred_started','shred_completed','shred_email_gate','bidcheck_completed'].includes(p.name))kb.fail(400,'Usage consent is required.');kb.uuid(p.id);await kb.rpc(c,'ft_admit',{p_ip:F.ip(event),p_kind:'event',p_limit:50,p_global:1000});await F.db(c,'ft_events',{method:'POST',body:{id:p.id,name:p.name}});return kb.reply(200,{saved:true});}
 if(p.action==='bid-start'){
  kb.exact(p,['action','text','file','title','source','processingConsent','answers']);
  if(p.processingConsent!==true)kb.fail(400,'Confirm source processing first.');
  if(typeof p.title!=='string'||!p.title.trim()||p.title.length>200||typeof p.source!=='string'||p.source.length>500)kb.fail(400,'Use a short title/source.');
  const answers=B.answers(p.answers),prepared=await F.prepare(p),id=crypto.randomUUID();
  await kb.rpc(c,'ft_bidcheck_start',{p_id:id,p_ip:F.ip(event),p_title:p.title.trim(),p_source:p.source,...Object.fromEntries(Object.entries(prepared).map(([key,value])=>['p_'+key,value])),p_answers:answers});
  return kb.reply(202,{token:F.sign(id),status:'Pending',dispatched:await F.dispatch(id)});
 }
 if(p.action==='bid-status'){
  kb.exact(p,['action','token','resume']);const j=await F.job(c,p.token),row=await B.find(c,j.id);if(!row)kb.fail(404,'Bid check not found.');
  if(p.resume===true&&(j.status==='Pending'||(j.status==='Processing'&&Date.parse(j.lease_until)<Date.now())))await F.dispatch(j.id);
  return kb.reply(200,{...F.view(j),bidcheck:await B.result(c,j,row)});
 }
 if(p.action==='bid-report'){
  kb.exact(p,['action','token','email','website','marketing']);
  if(p.website||typeof p.email!=='string'||p.email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(p.email))kb.fail(400,'Enter a valid email address.');
  const j=await F.job(c,p.token);if(j.status!=='Completed')kb.fail(409,'Complete the bid check first.');
  const row=await B.find(c,j.id),verdict=await B.result(c,j,row),document=await B.report(j,verdict);
  const lead=await kb.rpc(c,'ft_lead',{p_id:j.id,p_email:p.email.trim().toLowerCase(),p_marketing:p.marketing===true}),delivery=await B.send(c,j,lead,row);
  return kb.reply(200,{leadStored:true,delivery,document,notice:delivery.customer==='Accepted'?'Email accepted for sending; this is not delivery confirmation.':'Email is not confirmed. Your full breakdown is available here; retry this same request later.',adminNotice:delivery.admin==='Accepted'?'Owner notification accepted.':'Owner notification is pending; no notification is claimed.'});
 }
 if(p.action==='start'){kb.exact(p,['action','text','file','title','source','processingConsent']);if(p.processingConsent!==true)kb.fail(400,'Confirm source processing first.');if(typeof p.title!=='string'||p.title.length>200||typeof p.source!=='string'||p.source.length>500)kb.fail(400,'Use a short title/source.');await kb.rpc(c,'ft_admit',{p_ip:F.ip(event),p_kind:'shred',p_limit:3,p_global:10});const prepared=await F.prepare(p),id=crypto.randomUUID();await F.db(c,'ft_jobs',{method:'POST',body:{id,ip_hash:F.ip(event),title:p.title||'Solicitation',source:p.source,...prepared}});const dispatched=await F.dispatch(id);return kb.reply(202,{token:F.sign(id),status:'Pending',dispatched});}
 if(p.action==='status'){kb.exact(p,['action','token','resume']);const j=await F.job(c,p.token);if(p.resume===true&&(j.status==='Pending'||(j.status==='Processing'&&Date.parse(j.lease_until)<Date.now())))await F.dispatch(j.id);return kb.reply(200,F.view(j));}
 if(p.action==='matrix'){kb.exact(p,['action','token','email','website','marketing','teardown']);if(p.teardown!==undefined&&typeof p.teardown!=='boolean')kb.fail(400,'Choose whether to request a teardown.');if(p.website||typeof p.email!=='string'||p.email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(p.email))kb.fail(400,'Enter a valid email address.');const j=await F.job(c,p.token);if(j.status!=='Completed')kb.fail(409,'Complete the shred first.');if(await B.find(c,j.id))kb.fail(400,'Use the bid-check breakdown form for this result.');const lead=await kb.rpc(c,'ft_lead',{p_id:j.id,p_email:p.email.trim().toLowerCase(),p_marketing:p.marketing===true,p_teardown:p.teardown===true});const delivery=await F.mail(c,j,lead);const {csv}=await import('../../assets/compliance-export.mjs');const matrix=csv({analysis:{id:j.id,status:'Completed',warnings:j.warnings,facts:[]},requirements:j.requirements.map((r,i)=>({...r,id:String(i+1),original_requirement:r.requirement,duplicate_count:r.duplicate_count||0}))});return kb.reply(200,{leadStored:true,delivery,matrix,notice:delivery.customer==='Accepted'?'Email accepted for sending; this is not delivery confirmation.':'Email is not confirmed. Your full matrix is available here; retry this same request later.',adminNotice:delivery.admin==='Accepted'?'Owner notification accepted.':'Owner notification is pending; no notification is claimed.'});}
 kb.fail(400,'Unknown tool action.');}catch(e){return kb.reply(e.status||503,{error:e.status===429?'Free tool daily capacity reached. You can shred up to three times per IP per UTC day, subject to shared pilot limits. Try after the daily reset or explore a trial.':e.status?e.message:'The free tool is temporarily unavailable. No result is implied.'});}};
