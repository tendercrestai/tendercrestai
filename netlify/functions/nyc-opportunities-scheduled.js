// Native Netlify scheduled function: keep the public-data snapshot warm even
// without visitors. The same database lease/budget controls all refresh callers.
exports.handler=async()=>{
 const NYC=require('./lib/nyc-opportunities'),F=require('./lib/free-tools'),kb=require('./lib/knowledge-base');
 if(!F.enabled()||!NYC.enabled())return {statusCode:200,body:'NYC feed disabled'};
 try{
  const result=await NYC.search(kb.configuration(),{nycScheduled:true},{page:0});
  if(result.stale)console.warn('NYC snapshot refresh deferred; serving last successful snapshot.');
  return {statusCode:200,body:JSON.stringify({stale:result.stale,checkedAt:result.checkedAt})};
 }catch(error){console.warn('NYC snapshot refresh unavailable',{status:error.status||503});return {statusCode:503,body:'NYC snapshot refresh unavailable'};}
};
