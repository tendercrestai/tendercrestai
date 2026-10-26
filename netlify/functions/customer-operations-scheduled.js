// This entry point is private to Netlify Scheduled Functions (public HTTP is 404).
// Keep operator HTTP authorization in customer-care, rather than rejecting native scheduler events.
const C=require('./lib/customer-care'),kb=require('./lib/knowledge-base');
exports.handler=async()=>{if(!C.enabled())return kb.reply(200,{disabled:true});try{return kb.reply(200,await require('./customer-care-maintenance').run(kb.configuration(),{invocation:'scheduled'}));}catch{return kb.reply(503,{error:'Scheduled operations will retry.'});}};
