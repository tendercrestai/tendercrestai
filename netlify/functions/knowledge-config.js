const publicConfig=require('./compliance-config');
exports.handler=async event=>{const result=await publicConfig.handler(event);if(result.statusCode!==200)return result;const data=JSON.parse(result.body);data.enabled=process.env.KB_ENABLED==='true';return {...result,body:JSON.stringify(data)};};
