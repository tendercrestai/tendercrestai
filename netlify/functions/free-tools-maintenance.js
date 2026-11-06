const kb=require('./lib/knowledge-base'),F=require('./lib/free-tools');
async function run(){if(!F.enabled())return;const c=kb.configuration();const leads=await F.db(c,'ft_leads?or=(customer_state.eq.Pending,admin_state.eq.Pending)&created_at=gt.'+encodeURIComponent(new Date(Date.now()-23*3600000).toISOString())+'&limit=10');for(const lead of leads){try{await F.mail(c,await F.job(c,F.sign(lead.id)),lead);}catch{}}await kb.rpc(c,'ft_cleanup',{});}
exports.run=run;
exports.handler=async event=>{try{kb.verifyWorker(event);await run();return kb.reply(200,{complete:true});}catch(e){return kb.reply(e.status||503,{error:'Maintenance unavailable.'});}};
