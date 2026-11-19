const {test,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const {requiredForms}=require('../assets/readiness-model.mjs');
const {aggregateClientUsage}=require('../netlify/functions/lib/client-usage');
const {createHandler}=require('../netlify/functions/proposals');

// Fictional data only. No real customer document is used anywhere in this file.
const USER='11111111-1111-4111-8111-111111111111';
const ORG_A='22222222-2222-4222-8222-222222222222',ORG_B='33333333-3333-4333-8333-333333333333';
const PROJ_A1='44444444-4444-4444-8444-444444444444',PROJ_A2='55555555-5555-4555-8555-555555555555',PROJ_B1='66666666-6666-4666-8666-666666666666',PROJ_OTHER='77777777-7777-4777-8777-777777777777';

const form=(title,mandatory='Yes',status='not-started')=>({kind:'form',title,mandatory,status});

test('requiredForms keeps mandatory forms, drops non-mandatory and non-forms, mandatory first',()=>{
 const items=[form('Zebra form','Yes'),form('Alpha form','Unclear'),form('Optional form','No'),{kind:'requirement',title:'A requirement',mandatory:'Yes',status:'not-started'},form('Beta form','Yes')];
 assert.deepEqual(requiredForms(items).map(i=>i.title),['Beta form','Zebra form','Alpha form']);
 assert.deepEqual(requiredForms([]),[]);
});

const orgs=[
 {org_id:ORG_A,role:'owner',kb_organizations:{id:ORG_A,name:'Client Alpha'}},
 {org_id:ORG_B,role:'editor',kb_organizations:{id:ORG_B,name:'Client Beta'}},
 {org_id:'88888888-8888-4888-8888-888888888888',role:'viewer',kb_organizations:{id:'88888888-8888-4888-8888-888888888888',name:'Client Gamma'}}
];
const projects=[
 {id:PROJ_A1,org_id:ORG_A,title:'Alpha RFP'},
 {id:PROJ_A2,org_id:ORG_A,title:'Alpha renewal'},
 {id:PROJ_B1,org_id:ORG_B,title:'Beta RFP'}
];
const jobs=[
 {project_id:PROJ_A1,kind:'draft',status:'Completed',created_at:'2026-11-10T10:00:00Z'},
 {project_id:PROJ_A1,kind:'export',status:'Failed',created_at:'2026-11-11T10:00:00Z'},
 {project_id:PROJ_A2,kind:'draft',status:'Processing',created_at:'2026-11-12T10:00:00Z'},
 {project_id:PROJ_B1,kind:'draft',status:'Completed',created_at:'2026-11-09T10:00:00Z'},
 {project_id:PROJ_OTHER,kind:'draft',status:'Completed',created_at:'2026-11-09T10:00:00Z'}
];

test('aggregateClientUsage groups jobs by client org and drops jobs on unseen projects',()=>{
 const {clients,totals}=aggregateClientUsage({organizations:orgs,projects,jobs});
 assert.equal(clients.length,3);
 const alpha=clients[0];
 assert.equal(alpha.name,'Client Alpha');assert.equal(alpha.role,'owner');assert.equal(alpha.projects,2);
 assert.deepEqual(alpha.jobs,{total:3,draft:2,export:1,completed:1,failed:1,pending:1});
 assert.equal(alpha.lastActivity,'2026-11-12T10:00:00.000Z');
 const beta=clients[1];
 assert.equal(beta.name,'Client Beta');assert.equal(beta.projects,1);
 assert.deepEqual(beta.jobs,{total:1,draft:1,export:0,completed:1,failed:0,pending:0});
 assert.equal(beta.lastActivity,'2026-11-09T10:00:00.000Z');
 const gamma=clients[2];
 assert.equal(gamma.name,'Client Gamma');assert.equal(gamma.projects,0);
 assert.deepEqual(gamma.jobs,{total:0,draft:0,export:0,completed:0,failed:0,pending:0});
 assert.equal(gamma.lastActivity,null);
 assert.deepEqual(totals,{organizations:3,projects:3,jobs:4});
});

test('aggregateClientUsage tolerates missing inputs',()=>{
 assert.deepEqual(aggregateClientUsage({}),{clients:[],totals:{organizations:0,projects:0,jobs:0}});
});

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
let env,originalFetch,calls,settings;
const event=(body,headers={authorization:'Bearer test-token'})=>({httpMethod:'POST',headers,body:JSON.stringify(body)});
const run=body=>createHandler()(event(body));
beforeEach(()=>{
 env={...process.env};originalFetch=global.fetch;calls=[];
 Object.assign(process.env,{PROPOSAL_WORKSPACE_ENABLED:'true',SUPABASE_URL:'https://test.invalid',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',SUPABASE_SERVICE_ROLE_KEY:'server-only'});
 settings={orgs,projects,jobs};
 global.fetch=async(url,options={})=>{
  calls.push({url,options});const u=new URL(url);
  if(u.pathname==='/auth/v1/user')return json({id:USER,email:'fixture@example.invalid',email_confirmed_at:'2026-01-01'});
  if(u.pathname==='/rest/v1/rpc/pw_admit')return json(true);
  if(u.pathname==='/rest/v1/kb_memberships')return json(settings.orgs);
  if(u.pathname==='/rest/v1/pw_projects')return json(settings.projects);
  if(u.pathname==='/rest/v1/pw_jobs')return json(settings.jobs);
  throw Error('Unexpected test network request: '+u.hostname+u.pathname);
 };
});
afterEach(()=>{global.fetch=originalFetch;process.env=env;});

test('clientUsage returns one row per client org with job counts',async()=>{
 const r=await run({action:'clientUsage'});
 assert.equal(r.statusCode,200);
 const body=JSON.parse(r.body);
 assert.equal(body.clients.length,3);
 assert.equal(body.clients[0].name,'Client Alpha');
 assert.deepEqual(body.clients[0].jobs,{total:3,draft:2,export:1,completed:1,failed:1,pending:1});
 assert.deepEqual(body.totals,{organizations:3,projects:3,jobs:4});
 // The unseen project's job never reaches the response.
 assert.ok(!JSON.stringify(body).includes(PROJ_OTHER));
});

test('clientUsage with no organizations returns empty clients',async()=>{
 settings.orgs=[];settings.projects=[];settings.jobs=[];
 const r=await run({action:'clientUsage'});
 assert.equal(r.statusCode,200);
 assert.deepEqual(JSON.parse(r.body),{clients:[],totals:{organizations:0,projects:0,jobs:0}});
});

test('list passes the org filter to the project query',async()=>{
 const r=await run({action:'list',orgId:ORG_A});
 assert.equal(r.statusCode,200);
 const projectCall=calls.find(c=>c.url.includes('/rest/v1/pw_projects'));
 assert.ok(projectCall.url.includes('org_id=eq.'+ORG_A));
 assert.equal(JSON.parse(r.body).projects.length,3);
});

test('list without orgId sends no org filter',async()=>{
 const r=await run({action:'list'});
 assert.equal(r.statusCode,200);
 const projectCall=calls.find(c=>c.url.includes('/rest/v1/pw_projects'));
 assert.ok(!projectCall.url.includes('org_id=eq.'));
});

test('list rejects a bad orgId',async()=>{
 assert.equal((await run({action:'list',orgId:'not-a-uuid'})).statusCode,400);
});

test('unauthenticated clientUsage fails before data work',async()=>{
 const r=await createHandler()({httpMethod:'POST',headers:{},body:JSON.stringify({action:'clientUsage'})});
 assert.equal(r.statusCode,401);
 assert.equal(calls.filter(c=>c.url.includes('/rest/v1/pw_')||c.url.includes('/rest/v1/kb_')).length,0);
});
