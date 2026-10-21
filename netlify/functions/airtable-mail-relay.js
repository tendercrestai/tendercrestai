// Authenticated Airtable automation -> Resend relay. Set AIRTABLE_MAIL_RELAY_TOKEN in Netlify.
const crypto=require("crypto");
const reply=(statusCode,body)=>({statusCode,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},body:JSON.stringify(body)});
exports.handler=async(event)=>{
 if(event.httpMethod!=="POST")return reply(405,{error:"Method not allowed"});
 const secret=process.env.AIRTABLE_MAIL_RELAY_TOKEN;
 if(!secret||!process.env.RESEND_API_KEY)return reply(503,{error:"Mail relay not configured"});
 const auth=(event.headers?.authorization||event.headers?.Authorization||"").replace(/^Bearer\s+/i,"");
 const a=Buffer.from(auth),b=Buffer.from(secret);
 if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return reply(401,{error:"Unauthorized"});
 if((event.body||"").length>180000)return reply(413,{error:"Payload too large"});
 let d;try{d=JSON.parse(event.body||"{}")}catch{return reply(400,{error:"Invalid JSON"})}
 const email=String(d.to||"").trim(),subject=String(d.subject||"").trim(),message=String(d.message||"");
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!subject||subject.length>500||!message||message.length>150000)return reply(400,{error:"Invalid email payload"});
 const safe=message.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
 try{
  const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+process.env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:"TenderCrest AI <hello@tendercrestai.com>",reply_to:"hello@tendercrestai.com",to:[email],subject,text:message,html:"<div style=\"white-space:pre-wrap;font-family:Arial,sans-serif\">"+safe+"</div>"})});
  if(!r.ok){console.error("Resend failed",r.status,(await r.text()).slice(0,300));return reply(502,{error:"Delivery provider rejected request"})}
  const j=await r.json();return reply(200,{ok:true,id:j.id});
 }catch(e){console.error("Mail relay error",e.message);return reply(502,{error:"Delivery failed"})}
};