const {test}=require('node:test'),assert=require('node:assert/strict');
const {errorClass,run}=require('../netlify/functions/proposal-worker-background');
const S=require('../netlify/functions/lib/proposal-service');
const writing=require('../netlify/functions/lib/proposal-writing');

// Nov 18, 2026: AI previews failed with a generic "Job Failed" and the stored
// pw_jobs.error_code was always 'draft_failed', whether the provider timed
// out, refused the call, returned invalid output, was unconfigured, or the
// workspace budget was reached. The worker now stores a distinct code per
// failure so the UI can name the reason and the next failure is diagnosable.
const err=(message,status)=>{const e=new Error(message);if(status!==undefined)e.status=status;return e;};

test('known job codes pass through unchanged',()=>{
 for(const code of ['revision_changed','attachment_unavailable','attachment_source_changed','attachment_integrity'])
  assert.equal(errorClass(err(code),'draft'),code);
 assert.equal(errorClass(err('revision_changed'),'export'),'revision_changed');
});

test('each draft-writer failure maps to its own stored code',()=>{
 const cases=[
  ['Writing service timed out.','draft_timeout'],
  ['Writing service failed. Saved text is unchanged.','draft_provider_unavailable'],
  ['Writing output failed validation.','draft_output_invalid'],
  ['Existing AI provider configuration is unavailable.','draft_config_unavailable'],
  ['Selected section exceeds AI input capacity. Reduce sources or edit manually.','draft_input_too_large'],
 ];
 for(const [message,code] of cases)assert.equal(errorClass(err(message), 'draft'),code);
});

test('a 429 inside a draft job means the workspace budget was reached, not a provider failure',()=>{
 // pw_admit raises Postgres P0001, which database() rewrites to a 429 with a
 // fixed message. The budget is charged once at enqueue, so a 429 in the
 // worker is not expected; the mapping stays so any budget check still
 // surfaces as a budget failure rather than a provider failure.
 assert.equal(errorClass(err('Knowledge usage or retry limit reached.',429),'draft'),'draft_budget_reached');
 assert.equal(errorClass(err('Knowledge usage or retry limit reached.',429),'export'),'export_failed');
});

test('unrecognized failures still fall back to the generic code per kind',()=>{
 assert.equal(errorClass(err('boom'),'draft'),'draft_failed');
 assert.equal(errorClass(err('boom'),'export'),'export_failed');
 assert.equal(errorClass(err('boom'),'unknown'),'job_failed');
 assert.equal(errorClass(null,'draft'),'draft_failed');
 assert.equal(errorClass(undefined,'draft'),'draft_failed');
});

// The draft budget is charged once, when the job is enqueued (pw_enqueue
// admits with p_kind 'draft'). The worker used to admit a second time for
// AI previews, so one preview consumed two of the 100 daily admits per
// organization. The worker must not call admit at all now: the only RPCs
// a draft job makes are claim and finish.
test('a draft preview admits once at enqueue: the worker never calls admit',async()=>{
 const calls=[];
 const originals={rpc:S.rpc,project:S.project,enabled:S.enabled,core:S.core,write:writing.write};
 const project={id:'proj-1',org_id:'org-1',revision:1,evidence_epoch:0,state:{sections:[]}};
 const claimFor=(job)=>async(config,name,args)=>{calls.push(name);if(name==='claim')return{done:false,job,project};if(name==='finish')return true;throw new Error('Unexpected RPC '+name);};
 try{
  S.rpc=claimFor({id:'11111111-1111-1111-1111-111111111111',kind:'draft',requested_by:'user-1',revision:1,evidence_epoch:0,input:{mode:'regenerate',sectionId:'sec-1',language:'en'}});
  S.project=async()=>project;S.enabled=()=>{};S.core={draftSection:()=>({sectionId:'sec-1',text:'local draft'})};
  writing.write=async()=>({sectionId:'sec-1',text:'ai draft'});
  const result=await run({},'11111111-1111-1111-1111-111111111111');
  assert.equal(result.saved,true);
  assert.deepEqual(calls,['claim','finish']);
  // The local (non-AI) draft path also never admits.
  calls.length=0;
  S.rpc=claimFor({id:'11111111-1111-1111-1111-111111111111',kind:'draft',requested_by:'user-1',revision:1,evidence_epoch:0,input:{sectionId:'sec-1'}});
  const local=await run({},'11111111-1111-1111-1111-111111111111');
  assert.equal(local.saved,true);
  assert.deepEqual(calls,['claim','finish']);
 }finally{
  S.rpc=originals.rpc;S.project=originals.project;S.enabled=originals.enabled;S.core=originals.core;writing.write=originals.write;
 }
});
