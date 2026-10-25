const {test,beforeEach,afterEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {guidance}=require('../netlify/functions/lib/reference-guidance'),S=require('../netlify/functions/lib/proposal-service'),{createHandler}=require('../netlify/functions/proposals');
const id='11111111-1111-4111-8111-111111111111',sid='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';
let env,old,calls,role,revoked,p;
const data=()=>({action:'referenceGuidance',projectId:id,revision:4,evidenceEpoch:2,sectionId:sid,jurisdiction:'US federal',sector:'IT'});
const event=body=>({httpMethod:'POST',headers:{authorization:'Bearer fixture'},body:JSON.stringify(body)});
beforeEach(()=>{
 env={...process.env};Object.assign(process.env,{PROPOSAL_WORKSPACE_ENABLED:'true',PROPOSAL_REFERENCE_ENABLED:'true'});old={rpc:S.rpc,project:S.project,members:S.members,config:S.kb.configuration,auth:S.kb.authenticate};calls=[];role='viewer';revoked=false;
 p={id,revision:4,evidence_epoch:2,state:{sections:[{id:sid,title:'Delivery',requirementIds:['r1'],text:'PRIVATE_BIDDER_TEXT: 999 confidential staff'}],requirements:[{id:'r1',text:'Describe agile delivery, team capacity and performance metrics.'}],evidence:[{text:'PRIVATE_SOURCE_DATA'}],finalApproval:{actor:'fixture'}}};
 S.kb.configuration=()=>({});S.kb.authenticate=async e=>{if(!e.headers.authorization)S.kb.fail(401,'Sign in');return {user:{id},token:'fixture'};};S.rpc=async(c,n)=>{calls.push(n);};S.project=async(c,u,pid)=>{calls.push('require');if(pid!==id||revoked)S.kb.fail(403,'Denied');return structuredClone(p);};S.members=async()=>[{user_id:id,role,orgRole:'viewer'}];
});
afterEach(()=>{Object.assign(S,{rpc:old.rpc,project:old.project,members:old.members});S.kb.configuration=old.config;S.kb.authenticate=old.auth;process.env=env;});
const run=body=>createHandler()(event({...data(),...body}));
test('production corpus serves cited structure guidance and never changes or echoes bidder content',()=>{
 const before=JSON.stringify(p),r=guidance(p,data());assert.ok(r.guidance.length>0);assert.equal(r.modelCalled,false);assert.equal(r.readOnly,true);assert.ok(r.guidance.every(g=>g.approvalScope==='production'&&!g.canSupportCompliance&&!g.verifiedWinningResponse));assert.ok(!JSON.stringify(r).includes('PRIVATE_'));assert.equal(JSON.stringify(p),before);
});
test('anonymous and cross-project access cannot read reference results',async()=>{const e=event(data());e.headers={};assert.equal((await createHandler()(e)).statusCode,401);assert.deepEqual(calls,[]);assert.equal((await run({projectId:other})).statusCode,403);});
test('viewers can read optional guidance but no document, job, evidence or credit write occurs',async()=>{const before=JSON.stringify(p);const r=await run({});assert.equal(r.statusCode,200);assert.ok(JSON.parse(r.body).guidance.length);assert.deepEqual(calls,['admit','require','require']);assert.equal(JSON.stringify(p),before);});
test('disabled feature, stale revision and stale evidence fail before advice is returned',async()=>{process.env.PROPOSAL_REFERENCE_ENABLED='false';assert.equal((await run({})).statusCode,503);process.env.PROPOSAL_REFERENCE_ENABLED='true';assert.equal((await run({revision:3})).statusCode,409);assert.equal((await run({evidenceEpoch:1})).statusCode,409);});
test('a caller cannot inject queries, corpora, evidence or offline-mode overrides',async()=>{for(const extra of [{query:'override'},{catalogue:{records:[]}},{mode:'offline_pilot'},{state:{finalApproval:{}}}])assert.equal((await run(extra)).statusCode,400);});
test('membership removal fails closed, including after guidance computation',async()=>{S.members=async()=>[];assert.equal((await run({})).statusCode,403);S.members=async()=>[{user_id:id,role:'viewer',orgRole:'viewer'}];const handler=createHandler({referenceGuidance:(a,b)=>{const r=guidance(a,b);revoked=true;return r;}});assert.equal((await handler(event(data()))).statusCode,403);});
test('invalid sections, unlinked requirements, excessive context and invalid market fail explicitly',()=>{assert.throws(()=>guidance(p,{...data(),sectionId:other}),e=>e.status===404);const q=structuredClone(p);q.state.sections[0].requirementIds=[];assert.throws(()=>guidance(q,data()),e=>e.status===409);q.state.sections[0].requirementIds=['r1'];q.state.requirements[0].text='x'.repeat(30001);assert.throws(()=>guidance(q,data()),e=>e.status===413);assert.throws(()=>guidance(p,{...data(),sector:'unknown'}),e=>e.status===400);});
test('unsupported catalogue coverage returns no-match rather than another market or invented references',()=>{for(const extra of [{sector:'consulting'},{jurisdiction:'US state/local'}])assert.equal(guidance(p,{...data(),...extra}).guidance.length,0);});
test('a corrupt deployed source never returns advice or private exception details',async()=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'reference-prod-test-'));try{fs.cpSync(path.resolve(__dirname,'../reference-library'),parent,{recursive:true});fs.appendFileSync(path.join(parent,'sources/usds-playbook-01.md'),'changed');const handler=createHandler({referenceGuidance:(a,b)=>guidance(a,b,{libraryRoot:parent})});const r=await handler(event(data()));assert.equal(r.statusCode,503);assert.ok(!r.body.includes(parent));assert.ok(!r.body.includes('PRIVATE'));}finally{fs.rmSync(parent,{recursive:true,force:true});}
});
test('a revision changed while guidance is calculated is rejected by the final state check',async()=>{
 const handler=createHandler({referenceGuidance:(a,b)=>{const r=guidance(a,b);p.revision++;return r;}});assert.equal((await handler(event(data()))).statusCode,409);
});
