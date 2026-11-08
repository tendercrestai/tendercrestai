const kb=require('./lib/knowledge-base'),F=require('./lib/free-tools'),NYC=require('./lib/nyc-opportunities');
exports.handler=async event=>{try{
 const p=kb.parse(event,2000);if(!F.enabled())kb.fail(503,'The opportunity feed is not active on this deployment.');
 NYC.available();
 if(p.action==='search'){kb.exact(p,['action','keyword','page']);return kb.reply(200,await NYC.search(kb.configuration(),event,p));}
 if(p.action==='detail'){kb.exact(p,['action','notice']);return kb.reply(200,await NYC.detail(kb.configuration(),event,p.notice));}
 kb.fail(400,'Unknown action.');
}catch(e){return kb.reply(e.status||503,{error:e.status?e.message:'NYC opportunities are temporarily unavailable. No notices are implied.'});}};
