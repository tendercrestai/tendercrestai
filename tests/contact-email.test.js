const {test,beforeEach,afterEach}=require('node:test');const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');const contact=require('../netlify/functions/contact-email');
let env,oldFetch,calls,settings,ip;
beforeEach(()=>{env={...process.env};oldFetch=global.fetch;process.env.RESEND_API_KEY='test-only';process.env.AIRTABLE_PAT='test-only';delete process.env.TURNSTILE_SECRET_KEY;delete process.env.SUPABASE_URL;delete process.env.SUPABASE_PUBLISHABLE_KEY;delete process.env.SUPABASE_SERVICE_ROLE_KEY;ip=randomUUID();calls=[];settings={};global.fetch=async(url,options)=>{calls.push({url,options});if(url.includes('challenges.cloudflare.com'))return new Response(JSON.stringify({success:true}),{status:200});if(url.includes('/rest/v1/rpc/ft_admit')){if(settings.supabase429)return new Response(JSON.stringify({code:'P0001',message:'Free tool limit reached.'}),{status:400});if(settings.supabaseDown)throw Error('database unavailable');return new Response(JSON.stringify({}),{status:200});}if(settings.failNotice&&url.includes('resend'))return new Response('{}',{status:422});if(settings.noIdentity&&url.includes('resend'))return new Response('{}',{status:200});if(settings.failStore&&url.includes('airtable'))throw Error('private customer text');if(settings.failAck&&calls.filter(x=>x.url.includes('resend')).length===2)throw Error('private customer text');return new Response(JSON.stringify(url.includes('resend')?{id:'test-message'}:{records:[]}),{status:200});};});
afterEach(()=>{process.env=env;global.fetch=oldFetch;});
const event=(data={name:'Fictional Person',email:'fictional-'+randomUUID()+'@example.invalid',company:'Fictional Acorn',message:'A fictional inquiry only.'})=>({httpMethod:'POST',headers:{origin:'https://www.tendercrestai.com','x-nf-client-connection-ip':ip},body:JSON.stringify(data)});
const previewEvent=(data={name:'Fictional Person',email:'fictional-'+randomUUID()+'@example.invalid',company:'Fictional Acorn',message:'A fictional inquiry only.'})=>({httpMethod:'POST',headers:{origin:'https://deploy-preview-55--tendercrestai.netlify.app',host:'deploy-preview-55--tendercrestai.netlify.app','x-nf-client-connection-ip':ip},body:JSON.stringify(data)});
// A production event carrying a Turnstile token, for the success paths.
const verifiedEvent=()=>{const e=event();const payload=JSON.parse(e.body);payload['cf-turnstile-response']='test-token';e.body=JSON.stringify(payload);return e;};
test('null, arrays, nonobjects and encoded requests are rejected without a provider call',async()=>{
 for(const value of [null,[],7,'text'])assert.equal((await contact.handler(event(value))).statusCode,400);
 assert.equal((await contact.handler({...event(),isBase64Encoded:true})).statusCode,400);assert.equal(calls.length,0);
});
test('header control characters cannot enter a contact email',async()=>{
 const e=event();const payload=JSON.parse(e.body);payload.name='Name\nBcc: stranger@example.invalid';assert.equal((await contact.handler(event(payload))).statusCode,400);assert.equal(calls.length,0);
});
test('successful intake sends an escaped notice, stores one lead and acknowledges with bounded requests',async()=>{
 process.env.TURNSTILE_SECRET_KEY='test-only';
 const e=verifiedEvent();const payload=JSON.parse(e.body);payload.message='<script>not executable</script>';const response=await contact.handler(event(payload));assert.equal(response.statusCode,200);assert.equal(calls.length,4);
 const notice=JSON.parse(calls[1].options.body);assert.match(notice.html,/&lt;script&gt;/);assert.deepEqual(notice.to,['hello@tendercrestai.com']);
 for(const call of calls)assert.ok(call.options.signal instanceof AbortSignal);
 const lead=JSON.parse(calls[2].options.body).records[0].fields;assert.ok(lead['Follow-up Due']);assert.equal(JSON.parse(calls[3].options.body).to[0],payload.email);
});
test('provider rejection or missing acceptance ID does not claim the inquiry was sent',async()=>{
 const old=console.error;console.error=()=>{};try{process.env.TURNSTILE_SECRET_KEY='test-only';settings.failNotice=true;assert.equal((await contact.handler(verifiedEvent())).statusCode,502);assert.equal(calls.length,2);settings.failNotice=false;settings.noIdentity=true;assert.equal((await contact.handler(verifiedEvent())).statusCode,502);assert.equal(calls.length,4);}finally{console.error=old;}
});
test('storage or acknowledgment failure after an accepted notice does not invite duplicate submissions or leak content',async()=>{
 const logs=[],old=console.error;console.error=(...a)=>logs.push(a.join(' '));try{process.env.TURNSTILE_SECRET_KEY='test-only';settings.failStore=true;settings.failAck=true;assert.equal((await contact.handler(verifiedEvent())).statusCode,200);assert.equal(calls.length,4);assert.ok(!logs.join(' ').includes('private'));}finally{console.error=old;}
});
test('origin, method, honeypot and throttling remain enforced',async()=>{
 process.env.TURNSTILE_SECRET_KEY='test-only';
 assert.equal((await contact.handler({...event(),httpMethod:'GET'})).statusCode,405);assert.equal((await contact.handler({...event(),headers:{origin:'https://attacker.invalid'}})).statusCode,403);
 const bot=JSON.parse(event().body);bot['bot-field']='filled';assert.equal((await contact.handler(event(bot))).statusCode,200);assert.equal(calls.length,0);
 for(let i=0;i<4;i++)assert.equal((await contact.handler(verifiedEvent())).statusCode,200);
 assert.equal((await contact.handler(verifiedEvent())).statusCode,429);assert.equal(calls.length,16);
});
test('configured Turnstile cannot be skipped',async()=>{process.env.TURNSTILE_SECRET_KEY='test-only';assert.equal((await contact.handler(event())).statusCode,403);assert.equal(calls.length,0);});
test('deploy-preview host skips Turnstile verification when the secret is configured',async()=>{
 process.env.TURNSTILE_SECRET_KEY='test-only';
 const response=await contact.handler(previewEvent());
 assert.equal(response.statusCode,200);assert.equal(calls.length,3);
 assert.ok(calls.every(c=>!c.url.includes('challenges.cloudflare.com')));
});
test('only exact deploy-preview hostnames for this site skip verification',async()=>{
 process.env.TURNSTILE_SECRET_KEY='test-only';
 for(const host of ['deploy-preview-55--evil.netlify.app','deploy-preview-55--tendercrestai.netlify.app.evil.invalid','preview-55--tendercrestai.netlify.app']){
  const e=event();e.headers.host=host;
  assert.equal((await contact.handler(e)).statusCode,403);
 }
 assert.equal(calls.length,0);
});
test('deploy-preview origin is accepted while other origins are rejected',async()=>{
 assert.equal((await contact.handler(previewEvent())).statusCode,200);
 assert.equal((await contact.handler({...event(),headers:{origin:'https://deploy-preview-55--evil.netlify.app',host:'deploy-preview-55--evil.netlify.app','x-nf-client-connection-ip':ip}})).statusCode,403);
});
test('contact accepts one plain mailbox only, not address lists or display-name syntax',async()=>{
 for(const email of ['first@example.invalid,second@example.invalid','<person@example.invalid>'])assert.equal((await contact.handler(event({name:'Fictional',email,message:'Test inquiry'}))).statusCode,400);assert.equal(calls.length,0);
});
test('missing Turnstile secret fails closed on production hosts',async()=>{
 assert.equal((await contact.handler(verifiedEvent())).statusCode,403);assert.equal(calls.length,0);
});
test('contact form admits through the database daily cap when configured',async()=>{
 process.env.TURNSTILE_SECRET_KEY='test-only';process.env.SUPABASE_URL='https://example.invalid';process.env.SUPABASE_PUBLISHABLE_KEY='test-only';process.env.SUPABASE_SERVICE_ROLE_KEY='test-only';
 const response=await contact.handler(verifiedEvent());
 assert.equal(response.statusCode,200);assert.equal(calls.length,5);
 const admitted=calls.find(c=>c.url.includes('/rest/v1/rpc/ft_admit'));
 assert.ok(admitted);
 const body=JSON.parse(admitted.options.body);
 assert.equal(body.p_kind,'contact');assert.equal(body.p_limit,20);assert.equal(body.p_global,100);
});
test('database daily cap returns 429 without sending email',async()=>{
 process.env.TURNSTILE_SECRET_KEY='test-only';process.env.SUPABASE_URL='https://example.invalid';process.env.SUPABASE_PUBLISHABLE_KEY='test-only';process.env.SUPABASE_SERVICE_ROLE_KEY='test-only';settings.supabase429=true;
 assert.equal((await contact.handler(verifiedEvent())).statusCode,429);
 assert.equal(calls.filter(c=>c.url.includes('resend')).length,0);
 assert.equal(calls.length,2);
});
test('database admission failure falls back to the in-memory limit',async()=>{
 const logs=[],old=console.error;console.error=(...a)=>logs.push(a.join(' '));
 try{
  process.env.TURNSTILE_SECRET_KEY='test-only';process.env.SUPABASE_URL='https://example.invalid';process.env.SUPABASE_PUBLISHABLE_KEY='test-only';process.env.SUPABASE_SERVICE_ROLE_KEY='test-only';settings.supabaseDown=true;
  assert.equal((await contact.handler(verifiedEvent())).statusCode,200);
  assert.ok(calls.some(c=>c.url.includes('resend')));
  assert.ok(!logs.join(' ').includes('private'));
 }finally{console.error=old;}
});
