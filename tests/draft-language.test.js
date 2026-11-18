const {test,beforeEach,afterEach}=require('node:test'),assert=require('node:assert/strict');
const C=require('../netlify/functions/lib/proposal-core'),W=require('../netlify/functions/lib/proposal-writing');
const S=require('../netlify/functions/lib/proposal-service'),{createHandler}=require('../netlify/functions/proposals');

// --- Core: per-project setting, default English ---

test('new projects default to English draft language',()=>{
 assert.equal(C.initial('Fictional','Cedar').draftLanguage,'en');
 assert.deepEqual(C.DRAFT_LANGUAGES,['en','es']);
});

test('settings action stores Spanish and keeps it until changed',()=>{
 const s=C.initial('Fictional','Cedar');
 const saved=C.apply(s,'settings',{title:'Fictional',company:'Cedar',accent:'#1d4ed8',draftLanguage:'es'},'user');
 assert.equal(saved.draftLanguage,'es');
 const kept=C.apply(saved,'settings',{title:'Fictional',company:'Cedar',accent:'#1d4ed8'},'user');
 assert.equal(kept.draftLanguage,'es');
});

test('settings action rejects any language outside English and Spanish',()=>{
 const s=C.initial('Fictional','Cedar');
 assert.throws(()=>C.apply(s,'settings',{title:'Fictional',company:'Cedar',accent:'#1d4ed8',draftLanguage:'fr'},'user'),e=>e.status===400);
 assert.throws(()=>C.apply(s,'settings',{title:'Fictional',company:'Cedar',accent:'#1d4ed8',draftLanguage:''},'user'),e=>e.status===400);
});

// --- Writing: Spanish reaches the model prompt, English is the default ---

function state(){const s=C.initial('Fictional','Cedar');s.requirements=[{id:'r',text:'Must provide support',sources:[{quote:'Must provide support'}]}];s.sections=[{id:'s',title:'Support',text:'Manual text',revision:2,requirementIds:['r']}];s.evidence=[{id:'e',answerId:'a',revision:1,requirementId:'r',text:'Supported company fact',decision:'accepted',citations:[{id:'c',quote:'Supported company fact'}]}];return s;}
async function configured(fn){const before={...process.env};process.env.COMPLIANCE_AI_API_KEY='fictional-test-not-a-key';process.env.COMPLIANCE_AI_MODEL='gpt-4.1-mini';try{await fn();}finally{process.env=before;}}
const output=(value,finish_reason='stop')=>({ok:true,json:async()=>({choices:[{finish_reason,message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150}})});

test('Spanish selection routes a Spanish instruction into the draft prompt',()=>configured(async()=>{
 let payload;const r=await W.write(state(),'s','clarify','es',async(url,init)=>{payload=JSON.parse(init.body);return output({text:'Borrador en español',evidenceIds:['e']});});
 assert.match(payload.messages[0].content,/Write the draft text in Spanish/);
 assert.match(payload.messages[0].content,/UNTRUSTED DATA/);
 assert.equal(JSON.parse(payload.messages[1].content).language,'es');
 assert.equal(r.language,'es');
}));

test('no language set means English: no Spanish instruction, result says en',()=>configured(async()=>{
 let payload;const r=await W.write(state(),'s','clarify',async(url,init)=>{payload=JSON.parse(init.body);return output({text:'Draft response needing review',evidenceIds:['e']});});
 assert.doesNotMatch(payload.messages[0].content,/Spanish/);
 assert.equal(JSON.parse(payload.messages[1].content).language,'en');
 assert.equal(r.language,'en');
}));

test('an unsupported language fails before any provider call',()=>configured(async()=>{
 let called=false;
 await assert.rejects(()=>W.write(state(),'s','clarify','fr',async()=>{called=true;return output({text:'x',evidenceIds:['e']});}),e=>e.status===400);
 assert.equal(called,false);
}));

// --- API: generate enqueues the stored project language; settings persists it ---

const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',key='33333333-3333-4333-8333-333333333333';
let original,env,calls,p;
const event=body=>({httpMethod:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify(body)});
beforeEach(()=>{env={...process.env};for(const n of ['WORKSPACE','EVIDENCE','BUILDER','COLLABORATION','BID'])process.env['PROPOSAL_'+n+'_ENABLED']='true';original={};for(const k of ['rpc','project','members','db','workspace','commit','notify','dispatch'])original[k]=S[k];original.config=S.kb.configuration;original.auth=S.kb.authenticate;S.kb.configuration=()=>({});S.kb.authenticate=async()=>({user:{id},token:'test'});calls=[];p={id,org_id:other,created_by:id,revision:4,evidence_epoch:0,state:S.core.initial('Fictional','Fictional')};p.state.sections=[{id:other,title:'Section',text:'',revision:0,requirementIds:[]}];S.rpc=async(c,n,args)=>{calls.push(n);return id;};S.project=async(c,u,x,roles)=>{if(x!==id)S.kb.fail(403,'Denied');return structuredClone(p);};S.members=async()=>[{user_id:id,role:'manager',orgRole:'owner'}];S.db=async()=>[];S.workspace=async(c,u,v)=>({project:v});S.commit=async(c,u,old,state,op)=>{calls.push(op);return {...old,state,revision:old.revision+1};};S.notify=async()=>{};S.dispatch=async()=>false;});
afterEach(()=>{for(const [k,v]of Object.entries(original)){if(k==='config')S.kb.configuration=v;else if(k==='auth')S.kb.authenticate=v;else S[k]=v;}process.env=env;});
const run=body=>createHandler()(event({projectId:id,...body}));

test('generate with a mode enqueues the stored Spanish language',async()=>{
 process.env.PROPOSAL_INTELLIGENCE_ENABLED='true';p.state.draftLanguage='es';
 let enqueued;S.rpc=async(c,n,args)=>{if(n==='enqueue')enqueued=args;return id;};
 const r=await run({action:'generate',revision:4,evidenceEpoch:0,sectionId:other,requestKey:key,mode:'clarify',consent:true});
 assert.equal(r.statusCode,202);
 assert.equal(enqueued.p_input.language,'es');
 assert.equal(enqueued.p_input.mode,'clarify');
});

test('generate without a stored language enqueues English',async()=>{
 process.env.PROPOSAL_INTELLIGENCE_ENABLED='true';delete p.state.draftLanguage;
 let enqueued;S.rpc=async(c,n,args)=>{if(n==='enqueue')enqueued=args;return id;};
 const r=await run({action:'generate',revision:4,evidenceEpoch:0,sectionId:other,requestKey:key,mode:'regenerate',consent:true});
 assert.equal(r.statusCode,202);
 assert.equal(enqueued.p_input.language,'en');
});

test('settings action accepts and persists the draft language',async()=>{
 let savedState;S.commit=async(c,u,old,state,op)=>{savedState=state;return {...old,state,revision:old.revision+1};};
 const r=await run({action:'settings',revision:4,evidenceEpoch:0,title:'Fictional',company:'Fictional',accent:'#112233',draftLanguage:'es'});
 assert.equal(r.statusCode,200);
 assert.equal(savedState.draftLanguage,'es');
});

test('settings action rejects an unsupported draft language',async()=>{
 const r=await run({action:'settings',revision:4,evidenceEpoch:0,title:'Fictional',company:'Fictional',accent:'#112233',draftLanguage:'de'});
 assert.equal(r.statusCode,400);
 assert.ok(!calls.includes('section.saved'));
});
