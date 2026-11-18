const {test}=require('node:test'),assert=require('node:assert/strict');
const {errorClass}=require('../netlify/functions/proposal-worker-background');

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
 // fixed message; the admit call is the only step in a draft job that can
 // raise one, so the status alone identifies the budget failure.
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
