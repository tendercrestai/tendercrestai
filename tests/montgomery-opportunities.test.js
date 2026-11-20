const {test}=require('node:test'),assert=require('node:assert/strict'),S=require('../netlify/functions/lib/socrata-opportunities');
process.env.ANALYTICS_SIGNING_SECRET='fixture-only-signing-secret-at-least-32-characters';
const SLUG='montgomery-county';
const ROWS=[
 {status:'Active',type:'RFP',number:'1204426',description:'Glock 45T SIMS Training Guns',issuancedate:'2026-11-10T00:00:00.000',closingdate:'2099-11-23T00:00:00.000',department:'Police'},
 {status:'Active',type:'Informal',number:1197773,description:'Fictional training services',issuancedate:'2026-11-01T00:00:00.000',closingdate:'2099-02-24T00:00:00.000',department:'Police'},
 {status:'Active',type:'RFP',number:'1204430',description:'Past notice',issuancedate:'2026-10-01T00:00:00.000',closingdate:'2001-11-10T00:00:00.000',department:'Police'},
 {status:'Active',type:'RFP',number:'1204431',description:'No close date notice',issuancedate:'2026-11-10T00:00:00.000',closingdate:null,department:'Police'},
 {status:'Active',type:'RFP',description:'Missing number',issuancedate:'2026-11-10T00:00:00.000',closingdate:'2099-11-23T00:00:00.000',department:'Police'},
];
function feedWith(count){const rows=[];for(let i=0;i<count;i++)rows.push({status:'Active',type:'RFP',number:String(1300000+i),description:'Fictional Montgomery County notice '+i,issuancedate:'2026-11-10T00:00:00.000',closingdate:'2099-12-19T00:00:00.000',department:'Police'});return rows;}
function fixtureHarness(feed){
 const kb=require('../netlify/functions/lib/knowledge-base'),F=require('../netlify/functions/lib/free-tools');
 const saved={fetch:global.fetch,rpc:kb.rpc,db:F.db};
 const state={cache:{},admissions:[],calls:[],feed:feed||ROWS,status:200};
 F.db=async(c,path)=>{const m=path.match(/key=eq\.([^&]+)/);return m&&state.cache[m[1]]?[{body:state.cache[m[1]]}]:[];};
 kb.rpc=async(c,name,p)=>{if(name==='ft_admit'){state.admissions.push(p);return null;}if(name==='ft_cache_put'){state.cache[p.p_key]=p.p_body;return null;}throw Error('Unexpected RPC '+name);};
 global.fetch=async(url,o)=>{state.calls.push(url);assert.equal(url,S.feedUrl(SLUG));assert.equal(o.redirect,'error');if(state.status!==200)return new Response('{}',{status:state.status});return new Response(JSON.stringify(state.feed),{headers:{'Content-Type':'application/json'}});};
 return {state,c:{},e:{headers:{'x-nf-client-connection-ip':'192.0.2.1'}},restore(){global.fetch=saved.fetch;kb.rpc=saved.rpc;F.db=saved.db;}};
}
test('montgomery feed url points at the Montgomery County Socrata dataset with the active filter',()=>{
 assert.match(S.feedUrl(SLUG),/data\.montgomerycountymd\.gov\/resource\/eeq6-nnwe\.json/);
 assert.match(S.feedUrl(SLUG),/status='Active'/);
 assert.match(S.feedUrl(SLUG),/\$limit=1000/);
 assert.equal(S.laneConfig(SLUG).provider,'socrata-mc');
});
test('montgomery normalization links every result to the county search page, accepts numeric ids, and drops incomplete rows',()=>{
 const items=ROWS.map(x=>S.normalize(x,SLUG)).filter(Boolean);assert.equal(items.length,4);
 const first=items.find(x=>x.id==='1204426');assert.equal(first.provider,'socrata-mc');assert.equal(first.reference,'1204426');assert.equal(first.title,'Glock 45T SIMS Training Guns');assert.equal(first.agency,'Police');assert.equal(first.deadline,'2099-11-23T00:00:00.000Z');assert.equal(first.url,S.MONTGOMERY_SEARCH);
 const numeric=items.find(x=>x.id==='1197773');assert.equal(numeric.title,'Fictional training services');
 const unstated=items.find(x=>x.id==='1204431');assert.equal(unstated.deadline,null);
 assert.equal(S.normalize({status:'Active',type:'RFP',number:'1204426',description:'No posted',closingdate:'2099-11-23T00:00:00.000',department:'Police'},SLUG),null);
 assert.equal(S.detailId('1204426',SLUG),'1204426');
 assert.throws(()=>S.detailId('1204426x',SLUG),e=>e.status===400);
 assert.throws(()=>S.detailId('',SLUG),e=>e.status===400);
});
test('montgomery search filters past notices, matches keyword across title, department and solicitation number, pages, caches, and admits under the socrata kind',async()=>{
 const h=fixtureHarness(),s=h.state;
 try{
  const first=await S.search(h.c,h.e,{},SLUG);assert.equal(first.items.length,3);assert.equal(first.total,3);assert.equal(first.cached,false);assert.match(first.notice,/county solicitation search page/);assert.equal(s.calls.length,1);
  const second=await S.search(h.c,h.e,{},SLUG);assert.equal(second.cached,true);assert.equal(s.calls.length,1);
  assert.equal((await S.search(h.c,h.e,{keyword:'training guns'},SLUG)).items.length,1);
  assert.equal((await S.search(h.c,h.e,{keyword:'1204426'},SLUG)).items.length,1);
  assert.equal((await S.search(h.c,h.e,{keyword:'police'},SLUG)).items.length,3);
  assert.equal((await S.search(h.c,h.e,{keyword:'nonexistent'},SLUG)).items.length,0);
  assert.ok(s.admissions.every(p=>p.p_kind==='socrata'&&p.p_limit===10&&p.p_global===50));
  const F=require('../netlify/functions/lib/free-tools');
  assert.notEqual(F.mac('socrata:montgomery-county:snapshot:v1'),F.mac('socrata:los-angeles:snapshot:v1'),'montgomery and los-angeles snapshots use different cache keys');
  s.feed=feedWith(30);s.cache={};s.calls=[];
  const page0=await S.search(h.c,h.e,{},SLUG);assert.equal(page0.items.length,25);assert.equal(page0.hasMore,true);assert.equal(page0.total,30);
  const page1=await S.search(h.c,h.e,{page:1},SLUG);assert.equal(page1.items.length,5);assert.equal(page1.hasMore,false);assert.equal(s.calls.length,1);
 }finally{h.restore();}
});
test('montgomery failed feed and bad inputs are rejected before any stale data is served',async()=>{
 const h=fixtureHarness(),s=h.state;
 try{
  s.status=503;await assert.rejects(S.search(h.c,h.e,{},SLUG),e=>e.status===503);s.status=200;
  for(const bad of [{keyword:'x'.repeat(101)},{page:-1},{page:10},{page:0.5}]){const before=s.calls.length;await assert.rejects(S.search(h.c,h.e,bad,SLUG),e=>e.status===400);assert.equal(s.calls.length,before);}
 }finally{h.restore();}
});
test('montgomery detail returns the notice with empty text, resolves by solicitation number, caches, and 404s when the notice leaves the feed',async()=>{
 const h=fixtureHarness(),s=h.state;
 try{
  const d=await S.detail(h.c,h.e,'1204426',SLUG);assert.equal(d.item.title,'Glock 45T SIMS Training Guns');assert.equal(d.text,'');assert.match(d.notice,/Attachments are not imported/);assert.equal(s.calls.length,1);
  const again=await S.detail(h.c,h.e,'1204426',SLUG);assert.equal(again.cached,true);assert.equal(s.calls.length,1);
  s.cache={};await assert.rejects(S.detail(h.c,h.e,'99999',SLUG),e=>e.status===404);
 }finally{h.restore();}
});
test('montgomery handler routes search and detail and rejects unknown actions',async()=>{
 const h=fixtureHarness(),kb=require('../netlify/functions/lib/knowledge-base'),F=require('../netlify/functions/lib/free-tools'),handler=require('../netlify/functions/montgomery-opportunities').handler;
 const saved={enabled:F.enabled,configuration:kb.configuration};F.enabled=()=>true;kb.configuration=()=>h.c;
 try{
  const searchRes=await handler({httpMethod:'POST',headers:{'x-nf-client-connection-ip':'192.0.2.1'},body:JSON.stringify({action:'search',keyword:'',page:0})});assert.equal(searchRes.statusCode,200);assert.equal(JSON.parse(searchRes.body).items.length,3);
  const detailRes=await handler({httpMethod:'POST',headers:{'x-nf-client-connection-ip':'192.0.2.1'},body:JSON.stringify({action:'detail',notice:'1204426'})});assert.equal(detailRes.statusCode,200);
  const bad=await handler({httpMethod:'POST',headers:{},body:JSON.stringify({action:'explode'})});assert.equal(bad.statusCode,400);
 }finally{F.enabled=saved.enabled;kb.configuration=saved.configuration;h.restore();}
});
