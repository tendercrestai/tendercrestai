exports.admit=(config,id)=>require('./knowledge-base').rpc(config,'cc_admit_reminder',{p_notification:id});
