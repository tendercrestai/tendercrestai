const {test,beforeEach,afterEach}=require('node:test');const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');const contact=require('../netlify/functions/contact-email');
let env,oldFetch,calls,settings,ip;
beforeEach(()=>{env={...process.env};oldFetch=global.fetch;process.env.RESEND_API_KEY='test-only';process.env.AIRTABLE_PAT='test-only';delete process.env.TURNSTILE_SECRET_KEY;ip=randomUUID();calls=[];settings={};global.fetch=async(url,options)=>{calls.push({url,options});if(settings.failNotice&&url.includes('resend'))return new Response('{}',{status:422});if(settings.noIdentity&&url.includes('resend'))return new Response('{}',{status:200});if(settings.failStore&&url.includes('airtable'))throw Error('private customer text');if(settings.failAck&&calls.filter(x=>x.url.includes('resend')).length===2)throw Error('private customer text');return new Response(JSON.stringify(url.includes('resend')?{id:'test-message'}:{records:[]}),{status:200});};});
afterEach(()=>{process.env=env;global.fetch=oldFetch;});
const event=(data={name:'Fictional Person',email:'fictional-'+randomUUID()+'@example.invalid',company:'Fictional Acorn',message:'A fictional inquiry only.'})=>({httpMethod:'POST',headers:{origin:'https://www.tendercrestai.com','x-nf-client-connection-ip':ip},body:JSON.stringify(data)});
test('null, arrays, nonobjects and encoded requests are rejected without a provider call',async()=>{
 for(const value of [null,[],7,'text'])assert.equal((await contact.handler(event(value))).statusCode,400);
 assert.equal((await contact.handler({...event(),isBase64Encoded:true})).statusCode,400);assert.equal(calls.length,0);
});
test('header control characters cannot enter a contact email',async()=>{
 const e=event();const payload=JSON.parse(e.body);payload.name='Name\nBcc: stranger@example.invalid';assert.equal((await contact.handler(event(payload))).statusCode,400);assert.equal(calls.length,0);
});
test('successful intake sends an escaped notice, stores one lead and acknowledges with bounded requests',async()=>{
 const e=event();const payload=JSON.parse(e.body);payload.message='<script>not executable</script>';const response=await contact.handler(event(payload));assert.equal(response.statusCode,200);assert.equal(calls.length,3);
 const notice=JSON.parse(calls[0].options.body);assert.match(notice.html,/&lt;script&gt;/);assert.deepEqual(notice.to,['hello@tendercrestai.com']);
 for(const call of calls)assert.ok(call.options.signal instanceof AbortSignal);
 const lead=JSON.parse(calls[1].options.body).records[0].fields;assert.ok(lead['Follow-up Due']);assert.equal(JSON.parse(calls[2].options.body).to[0],payload.email);
});
test('provider rejection or missing acceptance ID does not claim the inquiry was sent',async()=>{
 const old=console.error;console.error=()=>{};try{settings.failNotice=true;assert.equal((await contact.handler(event())).statusCode,502);assert.equal(calls.length,1);settings.failNotice=false;settings.noIdentity=true;assert.equal((await contact.handler(event())).statusCode,502);assert.equal(calls.length,2);}finally{console.error=old;}
});
test('storage or acknowledgment failure after an accepted notice does not invite duplicate submissions or leak content',async()=>{
 const logs=[],old=console.error;console.error=(...a)=>logs.push(a.join(' '));try{settings.failStore=true;settings.failAck=true;assert.equal((await contact.handler(event())).statusCode,200);assert.equal(calls.length,3);assert.ok(!logs.join(' ').includes('private'));}finally{console.error=old;}
});
test('origin, method, honeypot and throttling remain enforced',async()=>{
 assert.equal((await contact.handler({...event(),httpMethod:'GET'})).statusCode,405);assert.equal((await contact.handler({...event(),headers:{origin:'https://attacker.invalid'}})).statusCode,403);
 const bot=JSON.parse(event().body);bot['bot-field']='filled';assert.equal((await contact.handler(event(bot))).statusCode,200);assert.equal(calls.length,0);
 for(let i=0;i<4;i++)assert.equal((await contact.handler(event())).statusCode,200);
 assert.equal((await contact.handler(event())).statusCode,429);assert.equal(calls.length,12);
});
test('configured Turnstile cannot be skipped',async()=>{process.env.TURNSTILE_SECRET_KEY='test-only';assert.equal((await contact.handler(event())).statusCode,403);assert.equal(calls.length,0);});
test('contact accepts one plain mailbox only, not address lists or display-name syntax',async()=>{
 for(const email of ['first@example.invalid,second@example.invalid','<person@example.invalid>'])assert.equal((await contact.handler(event({name:'Fictional',email,message:'Test inquiry'}))).statusCode,400);assert.equal(calls.length,0);
});
