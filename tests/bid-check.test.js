const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),B=require('../netlify/functions/lib/bid-check');
const input={deadline:'2026-12-01',hours:40,eligibility:'yes',performance:'similar',evidence:'most'};
const rows=n=>Array.from({length:n},(_,i)=>({requirement:'Fictional obligation '+i,mandatory:'Yes',recommendation:'Provide source-backed company evidence and have a reviewer assess this requirement.'}));
test('all scoring bands, boundaries and stable reason ordering',()=>{
 const strong=B.score(rows(3),input,'2026-11-01');assert.equal(strong.total,10);assert.equal(strong.band,'strong');assert.equal(strong.reasons.length,3);assert.match(strong.reasons[0],/^Deadline feasibility/);assert.equal(strong.gaps.length,3);
 const closer=B.score(rows(3),{...input,deadline:'2026-11-11',hours:20,eligibility:'unsure',performance:'related',evidence:'some'},'2026-11-01');assert.equal(closer.total,6);assert.equal(closer.band,'closer');
 const pass=B.score(rows(15),{...input,deadline:'2026-11-04',hours:5,performance:'none',evidence:'little'},'2026-11-01');assert.equal(pass.total,2);assert.equal(pass.band,'pass');
 for(const [count,days,expected]of [[14,7,2],[15,6,0],[15,7,1],[15,20,1],[15,21,2],[14,0,1]]){const deadline=new Date(Date.UTC(2026,10,1+days)).toISOString().slice(0,10);assert.equal(B.score(rows(count),{...input,deadline},'2026-11-01').factors[0].points,expected);}
 for(const [hours,expected]of [[0,0],[14.99,0],[15,1],[39.99,1],[40,2]])assert.equal(B.score(rows(3),{...input,hours},'2026-11-01').factors[1].points,expected);
 assert.equal(B.score(rows(3),{...input,deadline:'2026-03-08'},'2026-03-07').days,1);
});
test('forced pass is visible even when high scoring factors otherwise produce eight points',()=>{
 for(const [a,reason]of [[{...input,eligibility:'no'},'You do not meet the stated eligibility requirements.'],[{...input,deadline:'2026-10-31'},'The response deadline has passed or is too close to prepare a compliant bid.']]){const r=B.score(rows(3),a,'2026-11-01');assert.equal(r.total,8);assert.equal(r.band,'pass');assert.ok(r.overrides.includes(reason));}
 const urgent=B.score(rows(15),{...input,deadline:'2026-11-03'},'2026-11-01');assert.equal(urgent.total,8);assert.equal(urgent.band,'strong');assert.equal(urgent.factors[0].points,0);assert.deepEqual(urgent.overrides,[]);
});
test('invalid answers and empty extraction cannot produce a reassuring verdict',()=>{
 for(const a of [{...input,deadline:''},{...input,deadline:'2026-02-30'},{...input,hours:-1},{...input,hours:Infinity},{...input,eligibility:'maybe'},{...input,pricing:100}])assert.throws(()=>B.answers(a),e=>e.status===400);
 assert.throws(()=>B.score([],input,'2026-11-01'),e=>e.status===422);
});
test('fictional sample completes all bands through shared extraction, quota, email gate and consented metric',async()=>{
 const F=require('../netlify/functions/lib/free-tools'),handler=require('../netlify/functions/free-tools').handler;
 const names=['FREE_TOOLS_ENABLED','SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY','ANALYTICS_SIGNING_SECRET','COMPLIANCE_AI_API_KEY','COMPLIANCE_AI_MODEL','KB_WORKER_SECRET','KB_WORKER_ORIGIN','RESEND_API_KEY','CUSTOMER_CARE_TEST_MODE'];const saved=Object.fromEntries(names.map(k=>[k,process.env[k]])),original=global.fetch;
 Object.assign(process.env,{FREE_TOOLS_ENABLED:'true',SUPABASE_URL:'https://database.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',SUPABASE_SERVICE_ROLE_KEY:'fixture',ANALYTICS_SIGNING_SECRET:'fixture-signing-secret-at-least-32-chars',COMPLIANCE_AI_API_KEY:'fixture',COMPLIANCE_AI_MODEL:'gpt-4.1-mini',KB_WORKER_SECRET:'fixture-worker-secret-at-least-32-chars',KB_WORKER_ORIGIN:'https://fixture.netlify.app',RESEND_API_KEY:'fixture',CUSTOMER_CARE_TEST_MODE:'true'});
 const jobs=new Map(),checks=new Map(),leads=new Map(),events=[],mail=[],rpcs=[];let uses=0;
 const response=(body,status=200)=>new Response(JSON.stringify(body),{status});
 global.fetch=async(url,o={})=>{const u=new URL(url),p=o.body?JSON.parse(o.body):null;
  if(u.hostname==='fixture.netlify.app')return response({},202);
  if(u.hostname==='api.openai.com'){const payload=JSON.parse(p.messages[1].content),requirements=payload.excerpt_catalog.filter(x=>/\bmust\b/i.test(x.text)).map(x=>({excerpt_id:x.id,category:'Technical',mandatory:'Yes',uncertain:false}));return response({choices:[{finish_reason:'stop',message:{content:JSON.stringify({requirements,facts:[]})}}]});}
  if(u.hostname==='api.resend.com'){mail.push({payload:p,idempotency:o.headers['Idempotency-Key']});return response({id:'fixture-receipt'});}
  assert.equal(u.hostname,'database.invalid');const table=u.pathname.split('/').pop();
  if(u.pathname.includes('/rpc/')){rpcs.push({name:table,p});
   if(table==='ft_bidcheck_start'){if(uses>=3)return response({code:'P0001'},400);uses++;jobs.set(p.p_id,{id:p.p_id,title:p.p_title,source:p.p_source,documents:p.p_documents,chunks:p.p_chunks,warnings:p.p_warnings,ip_hash:p.p_ip,requirements:[],processed:0,status:'Pending',expires_at:new Date(Date.now()+86400000).toISOString()});checks.set(p.p_id,{id:p.p_id,answers:p.p_answers,as_of:'2026-11-01',verdict:null});return response(null);}
   if(table==='ft_claim'){const j=jobs.get(p.p_id);if(j.status!=='Pending')return response(null);j.status='Processing';return response(j);}
   if(table==='ft_admit'){if(p.p_kind==='shred'){if(uses>=3)return response({code:'P0001'},400);uses++;}return response(null);}
   if(table==='ft_lead'){let l=leads.get(p.p_id);if(!l){l={id:p.p_id,email:p.p_email,title:jobs.get(p.p_id).title,source:jobs.get(p.p_id).source,created_at:new Date().toISOString(),marketing_opt_in:p.p_marketing,teardown_opt_in:p.p_teardown||false,customer_state:'Pending',admin_state:'Pending'};leads.set(p.p_id,l);}return response(l);}
   throw Error('Unexpected RPC '+table);
  }
  if(table==='ft_events'){events.push(p);return response([p]);}
  const id=u.searchParams.get('id')?.replace(/^eq\./,''),map={ft_jobs:jobs,ft_bidchecks:checks,ft_leads:leads}[table];assert.ok(map,table);
  const row=map.get(id);if(o.method==='PATCH'){if(row)Object.assign(row,p);return response(row?[row]:[]);}return response(row?[row]:[]);
 };
 const call=async p=>{const r=await handler({httpMethod:'POST',headers:{'x-nf-client-connection-ip':'192.0.2.1'},body:JSON.stringify(p)});return {status:r.statusCode,body:JSON.parse(r.body)};};
 const source=fs.readFileSync('samples/fictional-rfp.txt','utf8'),base={action:'bid-start',title:'Fictional bid-check fixture',source:'Prepared sample',text:source,processingConsent:true,answers:input};
 try{
  for(const patch of [{text:'short'},{text:'x'.repeat(100001)},{processingConsent:false},{answers:{...input,deadline:''}}]){const r=await call({...base,...patch});assert.ok([400,413].includes(r.status));}assert.equal(uses,0);
  for(const [answers,band]of [[input,'strong'],[{...input,deadline:'2026-11-11',hours:20,eligibility:'unsure',performance:'related',evidence:'some'},'closer'],[{...input,eligibility:'no',hours:5,performance:'none',evidence:'little'},'pass']]){
   const start=await call({...base,answers});assert.equal(start.status,202);const token=start.body.token,id=F.verify(token);assert.equal(mail.length,0);const pending=await call({action:'bid-report',token,email:'hello@tendercrestai.com',website:'',marketing:false});assert.equal(pending.status,409);
   await F.processJob({url:process.env.SUPABASE_URL,key:'fixture',serviceKey:'fixture'},id);const done=await call({action:'bid-status',token});assert.equal(done.status,200);assert.equal(done.body.bidcheck.band,band);assert.equal(done.body.requirements.length,3);assert.equal(done.body.bidcheck.mandatoryCount,3);assert.ok(checks.get(id).verdict);assert.ok(!/\d\s*%|win probability|chance of winning/i.test(JSON.stringify(done.body.bidcheck)));
  }
  const fourth=await call({...base,action:'start'});assert.equal(fourth.status,400); // strict shred action rejects answers first
  const quota=await call({action:'start',title:base.title,source:base.source,text:source,processingConsent:true});assert.equal(quota.status,429);assert.match(quota.body.error,/three times per IP/);
  assert.equal(mail.length,0);const id=[...checks.keys()][0],token=F.sign(id);const bot=await call({action:'bid-report',token,email:'hello@tendercrestai.com',website:'bot',marketing:false});assert.equal(bot.status,400);assert.equal(leads.size,0);
  const gate=await call({action:'bid-report',token,email:'hello@tendercrestai.com',website:'',marketing:false});assert.equal(gate.status,200);assert.equal(gate.body.leadStored,true);assert.match(gate.body.document,/Strong fit/);assert.match(gate.body.document,/Factor breakdown/);assert.equal(leads.size,1);assert.equal(mail.length,2);assert.match(mail[0].payload.subject,/Your TenderCrest AI bid-check breakdown/);assert.equal(mail[0].payload.attachments[0].filename,'bid-check-breakdown.txt');assert.match(mail[1].payload.text,/Verdict: Strong fit/);for(const m of mail){assert.deepEqual(m.payload.to,['hello@tendercrestai.com']);assert.match(m.payload.subject,/FICTIONAL PREVIEW TEST/);assert.match(m.idempotency,/^free-bidcheck-/);}
  await call({action:'bid-report',token,email:'hello@tendercrestai.com',website:'',marketing:false});assert.equal(mail.length,2);assert.equal(leads.size,1);
  const originalFiles=fs.readdirSync('content/teardowns').sort(),shredId='77777777-7777-4777-8777-777777777777';jobs.set(shredId,{...jobs.get(id),id:shredId});
  const matrix=await call({action:'matrix',token:F.sign(shredId),email:'hello@tendercrestai.com',website:'',marketing:false,teardown:true});assert.equal(matrix.status,200);assert.equal(leads.get(shredId).teardown_opt_in,true);assert.equal(leads.get(shredId).marketing_opt_in,false);assert.match(matrix.body.matrix,/Requirement ID/);assert.ok(mail.some(x=>x.payload.subject.includes('New free RFP shredder lead')&&x.payload.text.includes('Public teardown interest: Yes')));assert.deepEqual(fs.readdirSync('content/teardowns').sort(),originalFiles);
  const metric={action:'event',name:'bidcheck_completed',id:'11111111-1111-4111-8111-111111111111',consent:false};assert.equal((await call(metric)).status,400);assert.equal(events.length,0);assert.equal((await call({...metric,consent:true})).status,200);assert.equal(events.length,1);
  assert.ok(rpcs.filter(x=>x.name==='ft_bidcheck_start').length===3);
 }finally{global.fetch=original;for(const k of names)if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}
});
