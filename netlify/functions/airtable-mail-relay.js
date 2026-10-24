// Authenticated Airtable automation -> Resend relay. Set AIRTABLE_MAIL_RELAY_TOKEN in Netlify.
const crypto=require("crypto");
const {presentation,validXMLText}=require('./lib/proposal-email');
const reply=(statusCode,body)=>({statusCode,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},body:JSON.stringify(body)});
exports.handler=async(event)=>{
 if(event.httpMethod!=="POST")return reply(405,{error:"Method not allowed"});
 const secret=process.env.AIRTABLE_MAIL_RELAY_TOKEN;
 if(!secret||!process.env.RESEND_API_KEY)return reply(503,{error:"Mail relay not configured"});
 const auth=(event.headers?.authorization||event.headers?.Authorization||"").replace(/^Bearer\s+/i,"");
 const a=Buffer.from(auth),b=Buffer.from(secret);
 if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return reply(401,{error:"Unauthorized"});
 if(event.isBase64Encoded||typeof event.body!=="string")return reply(400,{error:"Invalid email payload"});
 if(Buffer.byteLength(event.body,'utf8')>600000||event.body.length>180000)return reply(413,{error:"Payload too large"});
 let d;try{d=JSON.parse(event.body||"{}")}catch{return reply(400,{error:"Invalid JSON"})}
 if(!d||typeof d!=="object"||Array.isArray(d)||['to','subject','message'].some(key=>typeof d[key]!=="string"))return reply(400,{error:"Invalid email payload"});
 const email=String(d.to||"").trim(),subject=String(d.subject||"").trim(),message=String(d.message||"");
 if(!/^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[^\s@<>(),;:"\\]+$/.test(email)||email.length>254||/[\x00-\x1f\x7f]/.test(email)||!subject||subject.length>500||!message.trim()||message.length>150000||/[\r\n\x00-\x1f\x7f]/.test(subject)||!validXMLText(subject)||!validXMLText(message))return reply(400,{error:"Invalid email payload"});
 let dispatched=false;
 try{
  const output=await presentation(subject,message);
  dispatched=true;
  const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+process.env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:"TenderCrest AI <hello@tendercrestai.com>",reply_to:"hello@tendercrestai.com",to:[email],subject:output.subject,text:output.text,html:output.html,attachments:[output.attachment]}),signal:AbortSignal.timeout(15000)});
  if(!r.ok){console.error("Resend rejected proposal email",r.status);return reply(502,{error:"Delivery provider rejected request"})}
  const j=await r.json();if(typeof j?.id!=="string"||!j.id.trim())return reply(502,{deliveryState:"uncertain",error:"Delivery acceptance could not be confirmed. Verify before retrying."});return reply(200,{ok:true,id:j.id});
 }catch(e){if(e.statusCode===413)return reply(413,{error:"Proposal structure exceeds delivery limits"});console.error("Mail relay delivery failed");return reply(502,dispatched?{deliveryState:"uncertain",error:"Delivery outcome could not be confirmed. Verify before retrying."}:{error:"Delivery failed"})}
};
