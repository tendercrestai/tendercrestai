// TenderCrest AI contact intake. Secrets belong in Netlify environment variables.
const crypto = require("crypto");
const json=(statusCode,body)=>({statusCode,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},body:JSON.stringify(body)});
const clean=(v,max)=>typeof v==="string"?v.trim().slice(0,max):"";
const esc=s=>s.replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const buckets=new Map();
const LIMIT=4, WINDOW=15*60*1000;
function limited(key){
 const now=Date.now();if(buckets.size>1500){for(const [k,v] of buckets){if(v.reset<=now)buckets.delete(k)}}
 const b=buckets.get(key);if(!b||b.reset<=now){buckets.set(key,{count:1,reset:now+WINDOW});return false}
 b.count++;return b.count>LIMIT;
}
async function resend(apiKey,payload){
 const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},body:JSON.stringify(payload)});
 if(!response.ok)throw new Error("Resend "+response.status);
}
async function saveLead(data){
 const token=process.env.AIRTABLE_PAT;
 if(!token)return false;
 const base="appsaqdp3UZdhB2VH",table="tblI6dID4rlSUn8CF";
 const fields={"Contact Name":data.name,"Email":data.email,"Company":data.company,"Message":data.message,"Status":"New","Source":"Website Contact Form","Submitted At":new Date().toISOString(),"Follow-up Due":new Date(Date.now()+24*60*60*1000).toISOString()};
 const response=await fetch("https://api.airtable.com/v0/"+base+"/"+table,{method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({records:[{fields}]})});
 if(!response.ok)throw new Error("Airtable "+response.status);
 return true;
}
async function verifyTurnstile(token,ip){
 const secret=process.env.TURNSTILE_SECRET_KEY;
 if(!secret)return true; // Remains backward compatible until Cloudflare keys are configured.
 if(typeof token!=="string"||!token||token.length>2048)return false;
 const body=new URLSearchParams({secret,response:token});
 if(ip&&ip!=="unknown")body.set("remoteip",ip);
 try{
  const response=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{method:"POST",body,signal:AbortSignal.timeout(8000)});
  if(!response.ok)return false;
  const result=await response.json();
  return result.success===true && (!result.hostname||["www.tendercrestai.com","tendercrestai.com","tendercrestai.netlify.app"].includes(result.hostname));
 }catch(e){console.error("Turnstile verification unavailable",e.message);return false}
}
exports.handler=async(event)=>{
 if(event.httpMethod!=="POST")return json(405,{error:"Method not allowed"});
 if(!process.env.RESEND_API_KEY)return json(503,{error:"Contact email service is not configured yet."});
 const origin=event.headers?.origin||event.headers?.Origin;
 if(origin && !["https://www.tendercrestai.com","https://tendercrestai.com","https://tendercrestai.netlify.app"].includes(origin))return json(403,{error:"Invalid origin"});
 let data;try{if((event.body||"").length>12000)return json(413,{error:"Message too large"});data=JSON.parse(event.body||"{}")}catch{return json(400,{error:"Invalid request"})}
 if(data.website||data["bot-field"])return json(200,{ok:true});
 const name=clean(data.name,120),email=clean(data.email,254),company=clean(data.company,160),message=clean(data.message,5000);
 if(!name||!message||message.length<2||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json(400,{error:"Please enter a valid name, email and message."});
 // Per-IP and per-email abuse throttles. Best effort in-memory only: instances may reset or scale out.
 const ip=(event.headers?.["x-nf-client-connection-ip"]||event.headers?.["client-ip"]||event.headers?.["x-forwarded-for"]||"unknown").split(",")[0].trim();
 const hash=v=>crypto.createHash("sha256").update(v).digest("hex").slice(0,24);
 if(limited("ip:"+hash(ip))||limited("email:"+hash(email.toLowerCase())))return json(429,{error:"Too many messages. Please try again in 15 minutes."});
 if(!(await verifyTurnstile(data["cf-turnstile-response"],ip)))return json(403,{error:"Security verification failed. Please refresh the page and try again."});
 const html='<h2>New TenderCrest AI inquiry</h2><p><b>Name:</b> '+esc(name)+'</p><p><b>Email:</b> '+esc(email)+'</p><p><b>Company:</b> '+esc(company||"Not provided")+'</p><p><b>Message:</b></p><p style="white-space:pre-wrap">'+esc(message)+'</p>';
 try{
  await resend(process.env.RESEND_API_KEY,{from:"TenderCrest AI Website <contact@tendercrestai.com>",to:["hello@tendercrestai.com"],reply_to:email,subject:"Website inquiry from "+name,html});
 }catch(e){console.error("Contact notification failed",e.message);return json(502,{error:"Unable to deliver message. Please email hello@tendercrestai.com."})}
 try{await saveLead({name,email,company,message})}catch(e){console.error("Lead storage failed",e.message)}
 // Acknowledgment is best-effort; failure must not cause duplicate customer submissions.
 try{await resend(process.env.RESEND_API_KEY,{from:"TenderCrest AI <contact@tendercrestai.com>",to:[email],reply_to:"hello@tendercrestai.com",subject:"We received your TenderCrest AI inquiry",html:"<p>Hi "+esc(name)+",</p><p>Thanks for contacting TenderCrest AI. We've received your message and will review it shortly.</p><p>Best,<br>TenderCrest AI Team</p><p><small>This is an automatic acknowledgment. If you did not contact us, you can disregard this message.</small></p>"})}catch(e){console.error("Acknowledgment failed",e.message)}
 return json(200,{ok:true});
};