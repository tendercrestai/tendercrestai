const kb=require('./lib/knowledge-base');
exports.handler=async event=>{if(event?.httpMethod){try{kb.verifyWorker(event);}catch{return kb.reply(403,{error:'Forbidden'});}}if(!process.env.ANALYTICS_SIGNING_SECRET)return kb.reply(200,{disabled:true});try{await kb.rpc(kb.configuration(),'growth_purge',{});return kb.reply(200,{complete:true});}catch{return kb.reply(503,{error:'Usage-retention cleanup will retry.'});}};

