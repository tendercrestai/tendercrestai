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
test('worker retries transient provider failures and still retries validation only once',async()=>{
 const kb=require('../netlify/functions/lib/knowledge-base'),ai=require('../netlify/functions/lib/compliance-ai');
 const {RequestError}=require('../netlify/functions/lib/rfp-security');
 const saved={rpc:kb.rpc,analyze:ai.analyzeChunk,fetch:global.fetch};let calls=0,admissions=0,patches=[];
 const id='11111111-1111-4111-8111-111111111111';
 const job=()=>({id,ip_hash:'fixture-ip',chunks:[[]],documents:[],requirements:[],processed:0});
 kb.rpc=async(c,name)=>{if(name==='ft_claim')return job();if(name==='ft_admit'){admissions++;return null;}throw Error('Unexpected RPC');};
 global.fetch=async(url,options)=>{patches.push(JSON.parse(options.body));return new Response('[]',{status:200});};
 try{
  ai.analyzeChunk=async()=>{calls++;if(calls===1)throw new RequestError(502,'AI service is unavailable. Retry is limited to three attempts per chunk.');return {requirements:[{fingerprint:'fixture',requirement:'Validated fixture',sources:[]}]};};
  await F.processJob({url:'https://database.invalid',serviceKey:'fixture'},id);assert.equal(calls,2);assert.equal(admissions,2);assert.equal(patches.at(-1).status,'Completed');
  calls=0;patches=[];const timeout=Object.assign(new Error('The AI request timed out.'),{name:'TimeoutError'});
  ai.analyzeChunk=async()=>{calls++;if(calls===1)throw timeout;return {requirements:[{fingerprint:'fixture',requirement:'Validated fixture',sources:[]}]};};
  await F.processJob({url:'https://database.invalid',serviceKey:'fixture'},id);assert.equal(calls,2);assert.equal(patches.at(-1).status,'Completed');
  calls=0;patches=[];ai.analyzeChunk=async()=>{calls++;throw new RequestError(429,'AI service is unavailable.');};
  await F.processJob({url:'https://database.invalid',serviceKey:'fixture'},id);assert.equal(calls,3);assert.equal(patches.length,1);assert.equal(patches[0].status,'Failed');
  calls=0;patches=[];ai.analyzeChunk=async()=>{calls++;throw new Error('Unexpected fixture failure');};
  await F.processJob({url:'https://database.invalid',serviceKey:'fixture'},id);assert.equal(calls,1);assert.equal(patches.length,1);assert.equal(patches[0].status,'Failed');
 }finally{kb.rpc=saved.rpc;ai.analyzeChunk=saved.analyze;global.fetch=saved.fetch;}
});
test('failed shreds are resumable; completed and leased jobs are not',()=>{
 assert.equal(F.resumable({status:'Pending'}),true);
 assert.equal(F.resumable({status:'Failed'}),true);
 assert.equal(F.resumable({status:'Completed'}),false);
 assert.equal(F.resumable({status:'Processing',lease_until:new Date(Date.now()-1000).toISOString()}),true);
 assert.equal(F.resumable({status:'Processing',lease_until:new Date(Date.now()+60000).toISOString()}),false);
});
test('worker completes a re-claimed failed job from its saved cursor',async()=>{
 const kb=require('../netlify/functions/lib/knowledge-base'),ai=require('../netlify/functions/lib/compliance-ai');
 const saved={rpc:kb.rpc,analyze:ai.analyzeChunk,fetch:global.fetch};let patches=[];
 const id='11111111-1111-4111-8111-111111111111';
 kb.rpc=async(c,name)=>{if(name==='ft_claim')return {id,ip_hash:'fixture-ip',status:'Failed',chunks:[[]],documents:[],requirements:[],processed:0};if(name==='ft_admit')return null;throw Error('Unexpected RPC');};
 global.fetch=async(url,options)=>{patches.push(JSON.parse(options.body));return new Response('[]',{status:200});};
 try{
  ai.analyzeChunk=async()=>({requirements:[{fingerprint:'fixture',requirement:'Validated fixture',sources:[]}]});
  await F.processJob({url:'https://database.invalid',serviceKey:'fixture'},id);
  assert.equal(patches.at(-1).status,'Completed');assert.equal(patches.at(-1).error,null);assert.equal(patches[0].requirements.length,1);
 }finally{kb.rpc=saved.rpc;ai.analyzeChunk=saved.analyze;global.fetch=saved.fetch;}
});
test('mail failures are logged with job id and provider status, without recipient or source text',async()=>{
 const saved={fetch:global.fetch,key:process.env.RESEND_API_KEY,mode:process.env.CUSTOMER_CARE_TEST_MODE,error:console.error};
 const logged=[];console.error=(...args)=>{logged.push(args.map(String).join(' '));};
 process.env.RESEND_API_KEY='fixture-only-key';process.env.CUSTOMER_CARE_TEST_MODE='true';
 const config={url:'https://database.invalid',serviceKey:'fixture-only-service-key'};
 const job={id:'11111111-1111-4111-8111-111111111111',processed:1,chunks:[{}],warnings:[],requirements:[{requirement:'Fictional fixture requirement',category:'Technical',mandatory:'Yes',sources:[],recommendation:'Needs review'}]};
 const lead={email:'hello@tendercrestai.com',title:'Fictional fixture',source:'Test only',created_at:new Date().toISOString(),customer_state:'Pending',admin_state:'Pending'};
 global.fetch=async(url)=>String(url).startsWith('https://api.resend.com')?new Response('{}',{status:503}):new Response('[]',{status:200});
 try{
  assert.deepEqual(await F.mail(config,job,lead),{customer:'Pending',admin:'Pending'});
  assert.equal(logged.length,2);
  for(const line of logged){assert.match(line,/11111111-1111-4111-8111-111111111111/);assert.match(line,/503/);assert.ok(!line.includes('hello@tendercrestai.com'));assert.ok(!line.includes('Fictional fixture requirement'));}
 }finally{global.fetch=saved.fetch;console.error=saved.error;for(const [key,value]of [['RESEND_API_KEY',saved.key],['CUSTOMER_CARE_TEST_MODE',saved.mode]])if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
test('SAM retries the documented production alias only for a missing route, never for quota denial',async()=>{
 const kb=require('../netlify/functions/lib/knowledge-base'),saved={fetch:global.fetch,rpc:kb.rpc,key:process.env.SAM_GOV_API_KEY};process.env.SAM_GOV_API_KEY='fixture-only';let upstream=0,firstStatus=404;
 kb.rpc=async()=>null;global.fetch=async(url)=>{const u=new URL(url);if(u.hostname==='database.invalid')return new Response('[]',{status:200});assert.equal(u.hostname,'api.sam.gov');upstream++;if(upstream===1)return new Response('{}',{status:firstStatus});assert.equal(u.pathname,'/prod/opportunities/v2/search');return new Response('{"opportunitiesData":[],"totalRecords":0}',{status:200});};
 try{const c={url:'https://database.invalid',serviceKey:'fixture'},e={headers:{'x-nf-client-connection-ip':'192.0.2.1'}};assert.deepEqual((await S.search(c,e,{})).items,[]);assert.equal(upstream,2);upstream=0;firstStatus=429;await assert.rejects(S.search(c,e,{}),e=>e.status===429);assert.equal(upstream,1);}finally{global.fetch=saved.fetch;kb.rpc=saved.rpc;if(saved.key===undefined)delete process.env.SAM_GOV_API_KEY;else process.env.SAM_GOV_API_KEY=saved.key;}
});
test('SAM rejects masked secret values before making upstream or database calls',async()=>{
 const saved={fetch:global.fetch,key:process.env.SAM_GOV_API_KEY};let calls=0;global.fetch=async()=>{calls++;throw Error('Unexpected request');};
 try{for(const key of ['', '****************abcd', '••••abcd']){process.env.SAM_GOV_API_KEY=key;await assert.rejects(S.search({}, {}, {}),e=>e.status===503&&!e.message.includes(key||'SAM_GOV_API_KEY')&&e.message.includes('free shredder'));}assert.equal(calls,0);process.env.SAM_GOV_API_KEY=' fixture-key ';assert.equal(S.apiKey(),'fixture-key');}
 finally{global.fetch=saved.fetch;if(saved.key===undefined)delete process.env.SAM_GOV_API_KEY;else process.env.SAM_GOV_API_KEY=saved.key;}
});

test('SAM notice IDs parse from workspace contract URLs',()=>{
 const id='b'.repeat(32);
 assert.equal(S.noticeId('https://sam.gov/workspace/contract/opp/'+id+'/view'),id);
});
test('SAM normalize keeps the notice type for the shredder gate',()=>{
 const n=S.normalize({noticeId:'a'.repeat(32),title:'Fictional fixture',active:'Yes',type:'Award Notice'});
 assert.equal(n.type,'Award Notice');
 assert.equal(S.normalize({noticeId:'a'.repeat(32),title:'Fictional fixture',active:'Yes'}).type,null);
});
test('SAM feed search still defaults to solicitation type',async()=>{
 const kb=require('../netlify/functions/lib/knowledge-base'),saved={fetch:global.fetch,rpc:kb.rpc,key:process.env.SAM_GOV_API_KEY};
 process.env.SAM_GOV_API_KEY='fixture-only';let seenPtype='unset';
 kb.rpc=async()=>null;global.fetch=async(url)=>{const u=new URL(url);if(u.hostname==='database.invalid')return new Response('[]',{status:200});seenPtype=u.searchParams.get('ptype');return new Response('{"opportunitiesData":[],"totalRecords":0}',{status:200});};
 try{const c={url:'https://database.invalid',serviceKey:'fixture'},e={headers:{'x-nf-client-connection-ip':'192.0.2.1'}};assert.deepEqual((await S.search(c,e,{})).items,[]);assert.equal(seenPtype,'o');}
 finally{global.fetch=saved.fetch;kb.rpc=saved.rpc;if(saved.key===undefined)delete process.env.SAM_GOV_API_KEY;else process.env.SAM_GOV_API_KEY=saved.key;}
});
test('SAM detail names a non-solicitation notice instead of reporting it missing',async()=>{
 const kb=require('../netlify/functions/lib/knowledge-base'),saved={fetch:global.fetch,rpc:kb.rpc,key:process.env.SAM_GOV_API_KEY};
 process.env.SAM_GOV_API_KEY='fixture-only';const id='b'.repeat(32);let seenPtype='unset';
 const item={noticeId:id,title:'Fictional award notice',active:'Yes',type:'Award Notice',description:null};
 kb.rpc=async()=>null;global.fetch=async(url)=>{const u=new URL(url);if(u.hostname==='database.invalid')return new Response('[]',{status:200});assert.equal(u.hostname,'api.sam.gov');seenPtype=u.searchParams.get('ptype');return new Response(JSON.stringify({opportunitiesData:[item],totalRecords:1}),{status:200});};
 try{const c={url:'https://database.invalid',serviceKey:'fixture'},e={headers:{'x-nf-client-connection-ip':'192.0.2.1'}};
  await assert.rejects(S.detail(c,e,'https://sam.gov/workspace/contract/opp/'+id+'/view'),e=>e.status===404&&/Award Notice/.test(e.message)&&/not an open solicitation/.test(e.message));
  assert.equal(seenPtype,null);
 }finally{global.fetch=saved.fetch;kb.rpc=saved.rpc;if(saved.key===undefined)delete process.env.SAM_GOV_API_KEY;else process.env.SAM_GOV_API_KEY=saved.key;}
});
test('SAM detail shreds solicitation types and loads the description',async()=>{
 const kb=require('../netlify/functions/lib/knowledge-base'),saved={fetch:global.fetch,rpc:kb.rpc,key:process.env.SAM_GOV_API_KEY};
 process.env.SAM_GOV_API_KEY='fixture-only';const id='b'.repeat(32);
 const item={noticeId:id,title:'Fictional combined notice',active:'Yes',type:'Combined Synopsis/Solicitation',description:'https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid='+id};
 kb.rpc=async()=>null;global.fetch=async(url)=>{const u=new URL(url);if(u.hostname==='database.invalid')return new Response('[]',{status:200});if(u.pathname==='/prod/opportunities/v1/noticedesc'){assert.equal(u.searchParams.get('noticeid'),id);return new Response(JSON.stringify({description:'<p>Fictional RFP text</p>'}),{status:200});}return new Response(JSON.stringify({opportunitiesData:[item],totalRecords:1}),{status:200});};
 try{const c={url:'https://database.invalid',serviceKey:'fixture'},e={headers:{'x-nf-client-connection-ip':'192.0.2.1'}};
  const d=await S.detail(c,e,id);assert.equal(d.item.type,'Combined Synopsis/Solicitation');assert.match(d.text,/Fictional RFP text/);assert.equal(d.item.title,'Fictional combined notice');
 }finally{global.fetch=saved.fetch;kb.rpc=saved.rpc;if(saved.key===undefined)delete process.env.SAM_GOV_API_KEY;else process.env.SAM_GOV_API_KEY=saved.key;}
});
test('SAM detail keeps the not-found message when the API returns nothing',async()=>{
 const kb=require('../netlify/functions/lib/knowledge-base'),saved={fetch:global.fetch,rpc:kb.rpc,key:process.env.SAM_GOV_API_KEY};
 process.env.SAM_GOV_API_KEY='fixture-only';const id='b'.repeat(32);
 kb.rpc=async()=>null;global.fetch=async(url)=>{const u=new URL(url);if(u.hostname==='database.invalid')return new Response('[]',{status:200});return new Response('{"opportunitiesData":[],"totalRecords":0}',{status:200});};
 try{const c={url:'https://database.invalid',serviceKey:'fixture'},e={headers:{'x-nf-client-connection-ip':'192.0.2.1'}};
  await assert.rejects(S.detail(c,e,id),e=>e.status===404&&/not returned by the API/.test(e.message));
 }finally{global.fetch=saved.fetch;kb.rpc=saved.rpc;if(saved.key===undefined)delete process.env.SAM_GOV_API_KEY;else process.env.SAM_GOV_API_KEY=saved.key;}
});
test('quota reports the shared shred and bid-check budget before a start',async()=>{
 const saved={fetch:global.fetch,env:{...process.env}};
 Object.assign(process.env,{FREE_TOOLS_ENABLED:'true',SUPABASE_URL:'https://database.invalid',SUPABASE_PUBLISHABLE_KEY:'public-fixture',SUPABASE_SERVICE_ROLE_KEY:'service-fixture'});
 const seen=[];
 global.fetch=async(url)=>{
  const u=new URL(String(url));seen.push(u.pathname+u.search);
  if(u.pathname==='/rest/v1/ft_rates'){
   const key=u.searchParams.get('key')||'';
   return new Response(JSON.stringify(key==='eq.global'?[{n:7}]:[{n:2}]),{status:200,headers:{'Content-Type':'application/json'}});
  }
  return new Response('[]',{status:200});
 };
 try{
  const r=await require('../netlify/functions/free-tools').handler({httpMethod:'POST',headers:{'x-nf-client-connection-ip':'203.0.113.9'},body:JSON.stringify({action:'quota'})});
  assert.equal(r.statusCode,200);
  const d=JSON.parse(r.body);
  assert.equal(d.used,2);assert.equal(d.limit,3);assert.equal(d.remaining,1);
  assert.match(d.resetsAt,/midnight UTC/);
  assert.ok(seen.some(x=>x.includes('ft_rates')&&x.includes('kind=eq.shred')));
  assert.ok(seen.some(x=>x.includes('key=eq.global')));
 }finally{global.fetch=saved.fetch;process.env=saved.env;}
});
