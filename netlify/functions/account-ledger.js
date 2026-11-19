const security=require('./lib/rfp-security'),credits=require('./lib/credits');
const reply=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},body:JSON.stringify(body)});
exports.handler=async event=>{
 if(event.httpMethod!=='GET')return {...reply(405,{error:'Method Not Allowed'}),headers:{...reply(405,{}).headers,Allow:'GET'}};
 const params=event.queryStringParameters||{};
 const keys=Object.keys(params);
 if(keys.length>1||(keys.length===1&&keys[0]!=='page'))return reply(400,{error:'Unexpected request fields.'});
 let page=0;
 if(params.page!==undefined){if(!/^(0|[1-9][0-9]*)$/.test(params.page))return reply(400,{error:'Invalid ledger page.'});page=Number(params.page);if(!Number.isSafeInteger(page)||page>1000)return reply(400,{error:'Invalid ledger page.'});}
 try{
  const config=security.configuration(),{user}=await security.authenticate(event,config);
  const source=require('./lib/billing-source').billingSource();if(!source.pat)throw new security.RequestError(503,'Usage history is temporarily unavailable.');
  const root=source.root,headers={Authorization:'Bearer '+source.pat};
  const bound=await require('./lib/customer-care').boundCompany(config,user,root,headers);
  let company=bound;
  if(!company){
   const email=user.email.trim().toLowerCase().replace(/\\/g,'\\\\').replace(/'/g,"\\'");
   const q=new URLSearchParams({filterByFormula:"LOWER(TRIM({Billing Email})) = '"+email+"'",maxRecords:'2'});
   const r=await fetch(root+'/'+source.company+'?'+q,{headers,signal:AbortSignal.timeout(10000)});
   if(!r.ok)throw new security.RequestError(503,'Usage history is temporarily unavailable.');
   const data=await r.json();if(!Array.isArray(data.records)||data.records.length>1)throw new security.RequestError(503,'Your billing account needs review. Please contact support.');
   if(!data.records.length)return reply(200,{entries:[],page,hasMore:false,total:0});
   company=data.records[0];
  }
  return reply(200,await credits.ledger(config,company,user,root,headers,page));
 }catch(e){return reply(e.status||503,{error:e.status?e.message:'Usage history is temporarily unavailable. Please try again.'});}
};
