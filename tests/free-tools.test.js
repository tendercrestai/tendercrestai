const {test}=require('node:test'),assert=require('node:assert/strict'),F=require('../netlify/functions/lib/free-tools'),S=require('../netlify/functions/lib/sam-opportunities');
process.env.ANALYTICS_SIGNING_SECRET='test-only-signing-secret-at-least-32-characters';
test('anonymous result tokens cannot be guessed, altered, or Unicode substituted',()=>{const id='11111111-1111-4111-8111-111111111111';assert.equal(F.verify(F.sign(id)),id);for(const t of ['bad',F.sign(id)+'x',id+'.'+'é'.repeat(64)])assert.throws(()=>F.verify(t),e=>e.status===401);});
test('SAM URL validation blocks foreign URLs, credentials, and malformed notices',()=>{const id='a'.repeat(32);assert.equal(S.noticeId('https://sam.gov/opp/'+id+'/view'),id);assert.equal(S.noticeId(id),id);for(const v of ['https://evil.invalid/opp/'+id+'/view','file:///etc/passwd','https://sam.gov.evil.invalid/opp/'+id+'/view','not-a-notice','https://user:pass@sam.gov/opp/'+id+'/view','https://sam.gov:8443/opp/'+id+'/view'])assert.throws(()=>S.noticeId(v));});
test('existing source parser reused with section references and safe document rejection',async()=>{const p=await F.prepare({text:'SECTION C REQUIREMENTS\nThe contractor shall provide weekly reports.\nThe contractor must retain records.',title:'Fictional fixture'});assert.ok(p.documents[0].segments[0].section);assert.ok(p.chunks.length);await assert.rejects(F.prepare({text:'x'.repeat(100001)}),e=>e.status===413);await assert.rejects(F.prepare({file:{extension:'exe',name:'bad.exe',data:'AAAA'}}));});
test('SAM notices are source data with canonical source links, never fabricated rows',()=>{assert.equal(S.normalize({noticeId:'bad'}),null);const n=S.normalize({noticeId:'a'.repeat(32),title:'Fictional fixture',active:'Yes'});assert.equal(n.url,'https://sam.gov/opp/'+'a'.repeat(32)+'/view');assert.equal(n.deadline,null);});
test('disabled public handlers fail closed and never read/write or call providers',async()=>{delete process.env.FREE_TOOLS_ENABLED;const h=require('../netlify/functions/free-tools').handler;const r=await h({httpMethod:'POST',body:JSON.stringify({action:'start'})});assert.equal(r.statusCode,503);const o=await require('../netlify/functions/opportunities').handler({httpMethod:'POST',body:'{"action":"search"}'});assert.equal(o.statusCode,503);});
test('matrix mail persists acceptance, reuses idempotency keys, and limits preview recipients',async()=>{
 const saved={fetch:global.fetch,key:process.env.RESEND_API_KEY,mode:process.env.CUSTOMER_CARE_TEST_MODE};
 const calls=[];process.env.RESEND_API_KEY='fixture-only-key';process.env.CUSTOMER_CARE_TEST_MODE='true';
 const config={url:'https://database.invalid',serviceKey:'fixture-only-service-key'};
 const job={id:'11111111-1111-4111-8111-111111111111',processed:1,chunks:[{}],warnings:[],requirements:[{requirement:'Fictional fixture requirement',category:'Technical',mandatory:'Yes',sources:[],recommendation:'Needs review'}]};
 const lead={email:'hello@tendercrestai.com',title:'Fictional fixture',source:'Test only',created_at:new Date().toISOString(),customer_state:'Pending',admin_state:'Pending'};
 global.fetch=async(url,options)=>{calls.push({url:String(url),...options});return String(url).startsWith('https://api.resend.com')?new Response(JSON.stringify({id:'fixture-receipt'}),{status:200}):new Response('[]',{status:200});};
 try{
  assert.deepEqual(await F.mail(config,job,{...lead,email:'customer@example.invalid'}),{customer:'Pending',admin:'Pending'});assert.equal(calls.length,0);
  const result=await F.mail(config,job,lead);assert.deepEqual(result,{customer:'Accepted',admin:'Accepted'});
  const sends=calls.filter(x=>x.url.startsWith('https://api.resend.com'));assert.equal(sends.length,2);
  for(const send of sends){const payload=JSON.parse(send.body);assert.deepEqual(payload.to,['hello@tendercrestai.com']);assert.match(payload.subject,/FICTIONAL PREVIEW TEST/);assert.match(send.headers['Idempotency-Key'],/^free-matrix-(customer|admin)-11111111/);}
  assert.match(Buffer.from(JSON.parse(sends[0].body).attachments[0].content,'base64').toString(),/Fictional fixture requirement/);
  const patches=calls.filter(x=>x.method==='PATCH');assert.equal(patches.length,2);assert.ok(patches.every(x=>x.headers.Prefer==='return=representation'));calls.length=0;
  await F.mail(config,job,{...lead,customer_state:'Accepted',admin_state:'Accepted'});assert.equal(calls.length,0);
  global.fetch=async()=>new Response('{}',{status:503});assert.deepEqual(await F.mail(config,job,lead),{customer:'Pending',admin:'Pending'});
 }finally{global.fetch=saved.fetch;for(const [key,value]of [['RESEND_API_KEY',saved.key],['CUSTOMER_CARE_TEST_MODE',saved.mode]])if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
test('worker retries rejected AI output once and never publishes unvalidated rows',async()=>{
 const kb=require('../netlify/functions/lib/knowledge-base'),ai=require('../netlify/functions/lib/compliance-ai');
 const saved={rpc:kb.rpc,analyze:ai.analyzeChunk,fetch:global.fetch};let calls=0,admissions=0,patches=[];
 const id='11111111-1111-4111-8111-111111111111';
 const job=()=>({id,ip_hash:'fixture-ip',chunks:[[]],documents:[],requirements:[],processed:0});
 kb.rpc=async(c,name)=>{if(name==='ft_claim')return job();if(name==='ft_admit'){admissions++;return null;}throw Error('Unexpected RPC');};
 global.fetch=async(url,options)=>{patches.push(JSON.parse(options.body));return new Response('[]',{status:200});};
 try{
  ai.analyzeChunk=async()=>{calls++;if(calls===1)throw Error('AI output failed source validation. Retry this chunk or review the source manually.');return {requirements:[{fingerprint:'fixture',requirement:'Validated fixture',sources:[]}]};};
  await F.processJob({url:'https://database.invalid',serviceKey:'fixture'},id);assert.equal(calls,2);assert.equal(admissions,2);assert.equal(patches.at(-1).status,'Completed');assert.equal(patches[0].requirements.length,1);
  calls=0;patches=[];ai.analyzeChunk=async()=>{calls++;throw Error('AI output failed source validation. Retry this chunk or review the source manually.');};
  await F.processJob({url:'https://database.invalid',serviceKey:'fixture'},id);assert.equal(calls,2);assert.equal(patches.length,1);assert.equal(patches[0].status,'Failed');assert.ok(!patches[0].requirements);
 }finally{kb.rpc=saved.rpc;ai.analyzeChunk=saved.analyze;global.fetch=saved.fetch;}
});
