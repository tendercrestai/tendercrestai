// Netlify serverless contact email handler. Configure RESEND_API_KEY in Netlify.
const json=(statusCode,body)=>({statusCode,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},body:JSON.stringify(body)});
const clean=(v,max)=>typeof v==="string"?v.trim().slice(0,max):"";
exports.handler=async(event)=>{
 if(event.httpMethod!=="POST")return json(405,{error:"Method not allowed"});
 if(!process.env.RESEND_API_KEY)return json(503,{error:"Contact email service is not configured yet."});
 let data;try{if((event.body||"").length>12000)return json(413,{error:"Message too large"});data=JSON.parse(event.body||"{}")}catch{return json(400,{error:"Invalid request"})}
 if(data.website||data["bot-field"])return json(200,{ok:true});
 const name=clean(data.name,120),email=clean(data.email,254),company=clean(data.company,160),message=clean(data.message,5000);
 if(!name||!message||message.length<2||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json(400,{error:"Please enter a valid name, email and message."});
 const esc=s=>s.replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
 const html='<h2>New TenderCrest AI inquiry</h2><p><b>Name:</b> '+esc(name)+'</p><p><b>Email:</b> '+esc(email)+'</p><p><b>Company:</b> '+esc(company||"Not provided")+'</p><p><b>Message:</b></p><p style="white-space:pre-wrap">'+esc(message)+'</p>';
 try{
  const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+process.env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:"TenderCrest AI Website <contact@tendercrestai.com>",to:["hello@tendercrestai.com"],reply_to:email,subject:"Website inquiry from "+name,html})});
  if(!response.ok){console.error("Resend email error",response.status);return json(502,{error:"Unable to deliver message. Please email hello@tendercrestai.com."})}
  return json(200,{ok:true});
 }catch(e){console.error("Contact email delivery failure",e.message);return json(502,{error:"Unable to deliver message. Please email hello@tendercrestai.com."})}
};