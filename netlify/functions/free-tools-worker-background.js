const kb=require('./lib/knowledge-base'),F=require('./lib/free-tools');
exports.handler=async event=>{try{kb.verifyWorker(event);if(!F.enabled())kb.fail(503,'Disabled');const p=kb.parse(event,300);await F.processJob(kb.configuration(),p.id);return kb.reply(200,{processed:true});}catch(e){return kb.reply(e.status||503,{error:'Background request unavailable.'});}};
