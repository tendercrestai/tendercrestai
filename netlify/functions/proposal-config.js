exports.handler=async event=>{
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 if(event.httpMethod!=='GET')return {statusCode:405,headers,body:'{}'};
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_PUBLISHABLE_KEY;
 if(!url||!key)return {statusCode:503,headers,body:JSON.stringify({error:'Workspace configuration is unavailable.'})};
 const flags=Object.fromEntries(['evidence','builder','collaboration','bid','reference','intelligence'].map(n=>[n,process.env['PROPOSAL_'+n.toUpperCase()+'_ENABLED']==='true']));
 return {statusCode:200,headers,body:JSON.stringify({url,key,enabled:process.env.PROPOSAL_WORKSPACE_ENABLED==='true',features:flags})};
};
