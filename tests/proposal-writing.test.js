const {test}=require('node:test'),assert=require('node:assert/strict'),W=require('../netlify/functions/lib/proposal-writing'),C=require('../netlify/functions/lib/proposal-core');
function state(){const s=C.initial('Fictional','Cedar');s.requirements=[{id:'r',text:'Must provide support',sources:[{quote:'Must provide support'}]}];s.sections=[{id:'s',title:'Support',text:'Manual text',revision:2,requirementIds:['r']}];s.evidence=[{id:'e',answerId:'a',revision:1,requirementId:'r',text:'Supported company fact',decision:'accepted',citations:[{id:'c',quote:'Supported company fact'}]}];return s;}
async function configured(fn){const before={...process.env};process.env.COMPLIANCE_AI_API_KEY='fictional-test-not-a-key';process.env.COMPLIANCE_AI_MODEL='gpt-4.1-mini';try{await fn();}finally{process.env=before;}}
const output=(value,finish_reason='stop')=>({ok:true,json:async()=>({choices:[{finish_reason,message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150}})});
test('AI editing uses fixed provider, no storage, bounded output and untrusted-data system rules',()=>configured(async()=>{let payload;const s=state(),saved=structuredClone(s),r=await W.write(s,'s','clarify',async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/chat/completions');payload=JSON.parse(init.body);return output({text:'Draft response needing review',evidenceIds:['e']});});assert.equal(payload.store,false);assert.equal(payload.max_completion_tokens,2000);assert.match(payload.messages[0].content,/UNTRUSTED DATA/);assert.equal(r.usage.total_tokens,150);assert.equal(r.promptVersion,'proposal-writing-v1');assert.ok(r.gaps.length);assert.deepEqual(s,saved);}));
test('writing result carries provider usage and an estimated cost, never a null placeholder',()=>configured(async()=>{
 const r=await W.write(state(),'s','clarify',async()=>output({text:'Draft response needing review',evidenceIds:['e']}));
 assert.deepEqual(r.usage,{prompt_tokens:100,completion_tokens:50,total_tokens:150});
 assert.equal(r.estimatedCostUSD,0.000045);assert.match(r.costNotice,/Estimated/);
 const noUsage=await W.write(state(),'s','clarify',async()=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({text:'Draft response needing review',evidenceIds:['e']})}}]})}));
 assert.equal(noUsage.usage,null);assert.equal(noUsage.estimatedCostUSD,null);
}));
test('AI cannot invent evidence IDs, truncate output or omit required shape',()=>configured(async()=>{for(const [value,finish] of [[{text:'Made up',evidenceIds:['attacker']},'stop'],[{text:'Partial',evidenceIds:[]},'length'],[{text:'Bad',evidenceIds:[],secret:'x'},'stop']])await assert.rejects(()=>W.write(state(),'s','expand',async()=>output(value,finish)),e=>[400,502].includes(e.status));}));
test('failed AI request preserves saved content and does not silently retry',()=>configured(async()=>{let calls=0;const s=state(),saved=structuredClone(s);await assert.rejects(()=>W.write(s,'s','shorten',async()=>{calls++;return {ok:false};}),e=>e.status===502);assert.equal(calls,1);assert.deepEqual(s,saved);}));
test('oversized source inputs and unsupported modes fail before provider access',()=>configured(async()=>{let called=false;const s=state();s.sections[0].text='x'.repeat(25000);await assert.rejects(()=>W.write(s,'s','clarify',async()=>{called=true;}),e=>e.status===413);await assert.rejects(()=>W.write(state(),'s','execute',async()=>{called=true;}),e=>e.status===400);assert.equal(called,false);}));
// Nov 18, 2026: AI previews failed with a generic "Job Failed" after
// ~30-45s of Processing, the signature of the 35-second provider abort. The
// timeout is now 120 seconds, and a timeout, a refused call and an invalid
// model output fail with distinct messages so the stored job error says
// which one happened.
test('the write timeout gives a slow model room to finish',()=>{assert.equal(W.WRITE_TIMEOUT_MS,120000);});
test('a timed-out provider call fails as a timeout, not a generic provider error',()=>configured(async()=>{
 const timeout=()=>{const e=new Error('The operation timed out.');e.name='TimeoutError';throw e;};
 await assert.rejects(()=>W.write(state(),'s','clarify',timeout),e=>e.status===504&&e.message==='Writing service timed out.');
}));
test('a refused provider call fails as provider unavailable, still without a silent retry',()=>configured(async()=>{
 let calls=0;
 await assert.rejects(()=>W.write(state(),'s','clarify',async()=>{calls++;throw new Error('socket hang up');}),e=>e.status===502&&e.message==='Writing service failed. Saved text is unchanged.');
 assert.equal(calls,1);
 await assert.rejects(()=>W.write(state(),'s','clarify',async()=>({ok:false,status:500})),e=>e.status===502&&e.message==='Writing service failed. Saved text is unchanged.');
}));
test('an invalid model output fails as a validation error, distinct from a provider error',()=>configured(async()=>{
 await assert.rejects(()=>W.write(state(),'s','clarify',async()=>output({text:'',evidenceIds:[]})),e=>e.status===502&&e.message==='Writing output failed validation.');
}));
// Nov 18, 2026: regenerate with no approved, current evidence built a schema
// the model could never satisfy (evidenceIds required but no enum), so the
// preview failed as a confusing validation error after a provider call. It
// now fails fast before any provider call; clarify/shorten/expand work on
// existing text and do not need evidence.
test('regenerate with no active evidence fails fast before any provider call',()=>configured(async()=>{
 let calls=0;const s=state();s.evidence=[];
 await assert.rejects(()=>W.write(s,'s','regenerate',async()=>{calls++;return output({text:'Draft',evidenceIds:[]});}),e=>e.status===400&&e.message==='No approved, current evidence for this section yet.');
 assert.equal(calls,0);
}));
test('clarify with no active evidence does not hit the regenerate fail-fast',()=>configured(async()=>{
 let calls=0;const s=state();s.evidence=[];
 const r=await W.write(s,'s','clarify',async()=>{calls++;return output({text:'Draft response needing review',evidenceIds:[]});});
 assert.equal(calls,1);assert.equal(r.text,'Draft response needing review');
}));
