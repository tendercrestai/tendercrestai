const security=require('./lib/rfp-security'),credits=require('./lib/credits');
const reply=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},body:JSON.stringify(body)});
exports.handler=async event=>{
 if(event.httpMethod!=='GET')return {...reply(405,{error:'Method Not Allowed'}),headers:{...reply(405,{}).headers,Allow:'GET'}};
 if(Object.keys(event.queryStringParameters||{}).length)return reply(400,{error:'Unexpected request fields.'});
 try{
  const config=security.configuration(),{user}=await security.authenticate(event,config);
  if(!process.env.AIRTABLE_PAT)throw new security.RequestError(503,'Account usage is temporarily unavailable.');
  const root='https://api.airtable.com/v0/appsaqdp3UZdhB2VH',headers={Authorization:'Bearer '+process.env.AIRTABLE_PAT};
  const email=user.email.trim().toLowerCase().replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  const q=new URLSearchParams({filterByFormula:"LOWER(TRIM({Billing Email})) = '"+email+"'",maxRecords:'2'});
  const r=await fetch(root+'/tbliWnP6ThqA02G5L?'+q,{headers,signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw new security.RequestError(503,'Account usage is temporarily unavailable.');
  const data=await r.json();if(!Array.isArray(data.records)||data.records.length>1)throw new security.RequestError(503,'Your billing account needs review. Please contact support.');
  if(!data.records.length)return reply(200,{available:false,state:'no_plan',message:'No proposal subscription is linked to your verified sign-in email. If you already subscribed using another billing email, contact support to link your account.'});
  return reply(200,await credits.summary(config,data.records[0],root,headers));
 }catch(e){return reply(e.status||503,{error:e.status?e.message:'Account usage is temporarily unavailable. Please try again.'});}
};
