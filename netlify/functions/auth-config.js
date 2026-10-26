// Public authentication configuration must follow the deployment, including staging.
exports.handler=async event=>{
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 if(event.httpMethod!=='GET')return {statusCode:405,headers:{...headers,Allow:'GET'},body:'{}'};
 const url=(process.env.SUPABASE_URL||'').replace(/\/$/,''),key=process.env.SUPABASE_PUBLISHABLE_KEY;
 if(!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url)||!/^sb_publishable_[A-Za-z0-9_.-]+$/.test(key||''))return {statusCode:503,headers,body:JSON.stringify({error:'Account connection is temporarily unavailable. Reload this page to retry.'})};
 return {statusCode:200,headers,body:JSON.stringify({url,key})};
};
