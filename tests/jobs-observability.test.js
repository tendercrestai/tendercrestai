const {test,beforeEach,afterEach}=require('node:test'),assert=require('node:assert/strict');
const {sweepStrandedJobs}=require('../netlify/functions/lib/job-sweeper');
const S=require('../netlify/functions/lib/proposal-service');
const worker=require('../netlify/functions/proposal-worker-background');
const C=require('../netlify/functions/lib/customer-care');
const {run}=require('../netlify/functions/customer-care-maintenance');

const USER='11111111-1111-4111-8111-111111111111',ORG='22222222-2222-4222-8222-222222222222';
const JOB='44444444-4444-4444-8444-444444444444',PROJECT='55555555-5555-4555-8555-555555555555',FILE='66666666-6666-4666-8666-666666666666';
const PW1='77777777-7777-4777-8777-777777777777',PW2='88888888-8888-4888-8888-888888888888';
const KB1='99999999-9999-4999-8999-999999999999',KB2='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',FT1='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

let env,logs,origError;
beforeEach(()=>{env={...process.env};logs=[];origError=console.error;console.error=(...a)=>logs.push(a.join(' '));});
afterEach(()=>{process.env=env;console.error=origError;});

// --- F5: stranded-job sweeper ---

test('sweeper re-dispatches stranded jobs and leaves healthy ones to the database filter',async()=>{
 const queries=[];
 const db=async path=>{queries.push(path);
  if(path.startsWith('pw_jobs?'))return [{id:PW1,kind:'draft',status:'Pending'},{id:PW2,kind:'export',status:'Processing'}];
  if(path.startsWith('kb_jobs?'))return [{id:KB1,status:'Pending'},{id:KB2,status:'Pending'}];
  if(path.startsWith('ft_jobs?'))return [{id:FT1,status:'Pending'}];
  return [];};
 const dispatched={proposal:[],knowledge:[],free:[]};
 const summary=await sweepStrandedJobs({},{db,now:new Date('2026-11-15T12:00:00Z'),dispatchers:{
  proposal:async job=>{dispatched.proposal.push(job.id);return true;},
  knowledge:async id=>{dispatched.knowledge.push(id);if(id===KB2)throw Error('dispatch down');return true;},
  free:async id=>{dispatched.free.push(id);return true;},
 }});
 assert.deepEqual(summary.pw,{found:2,redispatched:2,failed:0});
 assert.deepEqual(summary.kb,{found:2,redispatched:1,failed:1});
 assert.deepEqual(summary.ft,{found:1,redispatched:1,failed:0});
 assert.deepEqual(dispatched.proposal,[PW1,PW2]);
 assert.deepEqual(dispatched.free,[FT1]);
 assert.ok(logs.some(l=>l.includes('sweep_dispatch_failed')&&l.includes(KB2)));
 // The database does the health filtering: queries only ever ask for Pending
 // or lease-expired Processing jobs with attempts left (ft_jobs has no
 // attempts column, but is bounded by expiry instead).
 const pw=queries.find(q=>q.startsWith('pw_jobs?'));
 assert.ok(pw.includes('attempts=lt.3')&&pw.includes('status.eq.Pending')&&pw.includes('lease_until.lt.'));
 const kbq=queries.find(q=>q.startsWith('kb_jobs?'));
 assert.ok(kbq.includes('attempts=lt.3')&&kbq.includes('status.eq.Pending')&&kbq.includes('lease_until.lt.'));
 const ft=queries.find(q=>q.startsWith('ft_jobs?'));
 assert.ok(ft.includes('expires_at=gt.')&&ft.includes('status.eq.Pending')&&!ft.includes('attempts'));
});

test('sweeper survives a failed status query and keeps sweeping the other queues',async()=>{
 const db=async path=>{if(path.startsWith('kb_jobs?'))throw Error('db down');if(path.startsWith('pw_jobs?'))return [{id:PW1,kind:'draft',status:'Pending'}];return [];};
 const summary=await sweepStrandedJobs({},{db,now:new Date('2026-11-15T12:00:00Z'),dispatchers:{proposal:async()=>true,knowledge:async()=>true,free:async()=>true}});
 assert.deepEqual(summary.pw,{found:1,redispatched:1,failed:0});
 assert.deepEqual(summary.kb,{found:0,redispatched:0,failed:0});
 assert.ok(logs.some(l=>l.includes('sweep_query_failed')&&l.includes('"kind":"kb"')));
});

test('sweeper counts a refused dispatch as failed without stopping the queue',async()=>{
 const db=async path=>path.startsWith('ft_jobs?')?[{id:FT1,status:'Pending'}]:[];
 const summary=await sweepStrandedJobs({},{db,now:new Date('2026-11-15T12:00:00Z'),dispatchers:{proposal:async()=>true,knowledge:async()=>true,free:async()=>false}});
 assert.deepEqual(summary.ft,{found:1,redispatched:0,failed:1});
 assert.ok(logs.some(l=>l.includes('sweep_dispatch_failed')&&l.includes(FT1)));
});

// --- F4: proposal worker error detail ---

const origRpc=S.rpc,origProject=S.project,origDb=S.db,origEnabled=S.enabled;
let finishCalls,finishShouldThrow,projectResult,projectError,claimJob;
function installWorkerMocks(){
 finishCalls=[];finishShouldThrow=false;projectError=null;
 projectResult={revision:1,evidence_epoch:0,org_id:ORG,state:{attachments:[]}};
 claimJob={id:JOB,kind:'draft',revision:1,evidence_epoch:0,requested_by:USER,input:{}};
 S.rpc=async(config,name,args)=>{
  if(name==='claim')return {done:false,job:claimJob,project:{id:PROJECT}};
  if(name==='finish'){if(finishShouldThrow)throw Error('db down');finishCalls.push(args);return true;}
  throw Error('unexpected rpc '+name);
 };
 S.project=async()=>{if(projectError)throw projectError;return projectResult;};
 S.db=async()=>[];
 S.enabled=()=>{};
}
function restoreWorkerMocks(){S.rpc=origRpc;S.project=origProject;S.db=origDb;S.enabled=origEnabled;}

test('proposal worker persists the sanitized error class, never source text',async()=>{
 installWorkerMocks();
 try{
  projectResult={revision:2,evidence_epoch:0,org_id:ORG,state:{attachments:[]}};
  assert.deepEqual(await worker.run({},JOB),{failed:true});
  assert.equal(finishCalls[0].p_error,'revision_changed');
  assert.ok(logs.some(l=>l.includes('proposal_job_failed')&&l.includes(JOB)&&l.includes('revision_changed')));
  // Unknown provider/internal error: classified by kind, message discarded.
  finishCalls=[];logs=[];
  projectResult={revision:1,evidence_epoch:0,org_id:ORG,state:{attachments:[]}};
  projectError=Error('boom fictional source text secret-token');
  assert.deepEqual(await worker.run({},JOB),{failed:true});
  assert.equal(finishCalls[0].p_error,'draft_failed');
  assert.ok(!JSON.stringify(finishCalls).includes('boom')&&!JSON.stringify(finishCalls).includes('fictional'));
  assert.ok(!logs.join(' ').includes('boom')&&!logs.join(' ').includes('fictional'));
  // Export kind with a missing attachment keeps its allowlisted class.
  finishCalls=[];logs=[];projectError=null;
  claimJob={...claimJob,kind:'export'};
  projectResult={revision:1,evidence_epoch:0,org_id:ORG,state:{attachments:[{fileId:FILE}]}};
  assert.deepEqual(await worker.run({},JOB),{failed:true});
  assert.equal(finishCalls[0].p_error,'attachment_unavailable');
  // A throwing finish RPC in the catch is logged, not rethrown.
  finishCalls=[];logs=[];finishShouldThrow=true;
  claimJob={...claimJob,kind:'draft'};
  projectResult={revision:2,evidence_epoch:0,org_id:ORG,state:{attachments:[]}};
  assert.deepEqual(await worker.run({},JOB),{failed:true});
  assert.ok(logs.some(l=>l.includes('proposal_job_finish_failed')));
 }finally{restoreWorkerMocks();}
});

test('proposal worker error classifier maps known codes and kinds only',()=>{
 assert.equal(worker.errorClass(Error('attachment_integrity'),'export'),'attachment_integrity');
 assert.equal(worker.errorClass(Error('revision_changed'),'draft'),'revision_changed');
 assert.equal(worker.errorClass(Error('provider exploded'),'draft'),'draft_failed');
 assert.equal(worker.errorClass(Error('provider exploded'),'export'),'export_failed');
 assert.equal(worker.errorClass(null,'other'),'job_failed');
});

// --- F10: health-check dependency pings ---

function installMaintenanceMocks({openaiThrows=false}={}){
 Object.assign(process.env,{PROPOSAL_PUBLIC_ORIGIN:'https://fixture.netlify.app',KB_WORKER_SECRET:'a'.repeat(32),KB_EMBEDDING_API_KEY:'fixture-openai-key',AIRTABLE_PAT:'fixture-airtable-pat',RESEND_API_KEY:'fixture-resend-key'});
 const calls=[];let stored=null;
 const db=C.db;
 C.db=async(c,p,o)=>{calls.push(p);if(p==='cc_health'){stored=o.body;return [];}if(p.startsWith('cc_deliveries?status=in.'))return [{updated_at:'2026-11-14T10:00:00.000Z'}];return [];};
 const fetcher=async url=>{
  if(url.endsWith('/auth-config'))return Response.json({url:'https://fixture.supabase.co'});
  if(url.startsWith('https://api.openai.com/v1/models')){if(openaiThrows)throw Error('down');return Response.json({data:[]});}
  if(url.startsWith('https://api.airtable.com/v0/'))return Response.json({records:[{id:'recFixture'}]});
  return new Response('ok');
 };
 return {calls,get stored(){return stored;},fetcher,restoreDb(){C.db=db;}};
}

test('health check pings openai, airtable and resend history, and sweeps zero stranded jobs',async()=>{
 const m=installMaintenanceMocks();
 try{
  const result=await run({url:'https://fixture.supabase.co'},{invocation:'scheduled',now:new Date('2026-11-15T12:00:00Z'),fetcher:m.fetcher});
  const byName=Object.fromEntries(result.checks.map(c=>[c.name,c.status]));
  assert.equal(byName.openai_models,'passed');
  assert.equal(byName.airtable_base,'passed');
  assert.equal(byName.resend_delivery,'passed');
  assert.deepEqual(result.swept,{pw:{found:0,redispatched:0,failed:0},kb:{found:0,redispatched:0,failed:0},ft:{found:0,redispatched:0,failed:0},compliance:{found:0,redispatched:0,failed:0}});
  assert.ok(m.calls.some(p=>p.startsWith('pw_jobs?')&&p.includes('attempts=lt.3')));
  assert.ok(m.calls.some(p=>p.startsWith('kb_jobs?')));
  assert.ok(m.calls.some(p=>p.startsWith('ft_jobs?')));
  assert.ok(m.calls.some(p=>p.startsWith('rfp_compliance_analyses?')&&p.includes('reviewed_hash=is.not.null')));
  assert.ok(m.stored.find(c=>c.name==='resend_delivery').detail.includes('2026-11-14T10:00:00.000Z'));
  assert.ok(m.calls.every(p=>!p.includes('email')));
 }finally{m.restoreDb();}
});

test('missing dependency credentials fail their checks without failing the run',async()=>{
 const m=installMaintenanceMocks();
 try{
  delete process.env.KB_EMBEDDING_API_KEY;delete process.env.AIRTABLE_PAT;delete process.env.RESEND_API_KEY;
  const result=await run({url:'https://fixture.supabase.co'},{invocation:'scheduled',now:new Date('2026-11-15T12:00:00Z'),fetcher:m.fetcher});
  const byName=Object.fromEntries(result.checks.map(c=>[c.name,c.status]));
  assert.equal(byName.openai_models,'failed');
  assert.equal(byName.airtable_base,'failed');
  assert.equal(byName.resend_delivery,'failed');
  assert.equal(result.retentionCleanup,true);
 }finally{m.restoreDb();}
});

test('an unreachable openai endpoint fails only its own check',async()=>{
 const m=installMaintenanceMocks({openaiThrows:true});
 try{
  const result=await run({url:'https://fixture.supabase.co'},{invocation:'scheduled',now:new Date('2026-11-15T12:00:00Z'),fetcher:m.fetcher});
  const byName=Object.fromEntries(result.checks.map(c=>[c.name,c.status]));
  assert.equal(byName.openai_models,'failed');
  assert.equal(byName.airtable_base,'passed');
  assert.equal(byName.resend_delivery,'passed');
  assert.equal(result.retentionCleanup,true);
 }finally{m.restoreDb();}
});
