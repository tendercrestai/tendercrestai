const {test}=require('node:test'),assert=require('node:assert/strict'),D=require('../netlify/functions/lib/dc-opportunities');
process.env.ANALYTICS_SIGNING_SECRET='fixture-only-signing-secret-at-least-32-characters';
const FEATURES=[
 {attributes:{SOLICITATIONNUMBER:'Doc855545',SOLICITATIONTITLE:'FY27-DCSAA-Fall Sports Officiating Services',AGENCY_NAME:'Department of Parks and Recreation',DUE_DATE:null,ISSUANCEDATE:1763000000000,CLOSEDATE:Date.parse('2099-12-15T00:00:00.000Z')}},
 {attributes:{SOLICITATIONNUMBER:'Doc850045',SOLICITATIONTITLE:'Optometrist Services',AGENCY_NAME:'Department of Health',DUE_DATE:Date.parse('2026-11-16T00:00:00.000Z'),ISSUANCEDATE:null,CLOSEDATE:Date.parse('2099-12-20T00:00:00.000Z')}},
 {attributes:{SOLICITATIONNUMBER:'Doc850046',SOLICITATIONTITLE:'Past solicitation',AGENCY_NAME:'Department of Health',DUE_DATE:Date.parse('2001-11-10T00:00:00.000Z'),ISSUANCEDATE:null,CLOSEDATE:Date.parse('2001-11-10T00:00:00.000Z')}},
 {attributes:{SOLICITATIONNUMBER:'Doc850047',SOLICITATIONTITLE:'No close date solicitation',AGENCY_NAME:'Department of Health',DUE_DATE:null,ISSUANCEDATE:null,CLOSEDATE:null}},
 {attributes:{SOLICITATIONNUMBER:'Doc855545',SOLICITATIONTITLE:'FY27-DCSAA-Fall Sports Officiating Services',AGENCY_NAME:'Department of Parks and Recreation',DUE_DATE:null,ISSUANCEDATE:1763000000000,CLOSEDATE:Date.parse('2099-12-15T00:00:00.000Z')}},
 {attributes:{SOLICITATIONTITLE:'Missing number',AGENCY_NAME:'Department of Health',DUE_DATE:null,ISSUANCEDATE:null,CLOSEDATE:Date.parse('2099-12-15T00:00:00.000Z')}},
];
function feedWith(count){const features=[];for(let i=0;i<count;i++)features.push({attributes:{SOLICITATIONNUMBER:'Doc9000'+String(i).padStart(2,'0'),SOLICITATIONTITLE:'Fictional DC solicitation '+i,AGENCY_NAME:'Department of Health',DUE_DATE:null,ISSUANCEDATE:1763000000000,CLOSEDATE:Date.parse('2099-12-19T00:00:00.000Z')}});return {features};}
function fixtureHarness(feed){
 const kb=require('../netlify/functions/lib/knowledge-base'),F=require('../netlify/functions/lib/free-tools');
 const saved={fetch:global.fetch,rpc:kb.rpc,db:F.db};
 const state={cache:{},admissions:[],calls:[],feed:feed||{features:FEATURES},status:200};
 F.db=async(c,path)=>{const m=path.match(/key=eq\.([^&]+)/);return m&&state.cache[m[1]]?[{body:state.cache[m[1]]}]:[];};
 kb.rpc=async(c,name,p)=>{if(name==='ft_admit'){state.admissions.push(p);return null;}if(name==='ft_cache_put'){state.cache[p.p_key]=p.p_body;return null;}throw Error('Unexpected RPC '+name);};
 global.fetch=async(url,o)=>{state.calls.push(url);assert.equal(url,D.queryUrl());assert.equal(o.redirect,'error');if(state.status!==200)return new Response('{}',{status:state.status});return new Response(JSON.stringify(state.feed),{headers:{'Content-Type':'application/json'}});};
 return {state,c:{},e:{headers:{'x-nf-client-connection-ip':'192.0.2.1'}},restore(){global.fetch=saved.fetch;kb.rpc=saved.rpc;F.db=saved.db;}};
}
test('dc query url targets the PASS layer with the close-date or due-date filter and close-date ordering',()=>{
 assert.match(D.queryUrl(),/maps2\.dcgis\.dc\.gov\/dcgis\/rest\/services\/DCGIS_DATA\/Government_Operations\/MapServer\/19\/query/);
 assert.match(D.queryUrl(),/DUE_DATE%20%3E%20TIMESTAMP/);
 assert.match(D.queryUrl(),/CLOSEDATE%20%3E%20TIMESTAMP/);
 assert.match(D.queryUrl(),/orderByFields=CLOSEDATE/);
 assert.match(D.queryUrl(),/resultRecordCount=1000/);
 assert.equal(D.PORTAL,'https://ocp.dc.gov/');
});
test('dc normalization prefers the close date over the due date, keeps null issue dates, and drops rows without a number or title',()=>{
 const items=FEATURES.map(D.normalize).filter(Boolean);assert.equal(items.length,5);
 const first=items.find(x=>x.id==='Doc855545');assert.equal(first.provider,'dc-pass');assert.equal(first.reference,'Doc855545');assert.equal(first.title,'FY27-DCSAA-Fall Sports Officiating Services');assert.equal(first.agency,'Department of Parks and Recreation');assert.equal(first.deadline,'2099-12-15T00:00:00.000Z');assert.equal(first.url,'https://ocp.dc.gov/');
 const second=items.find(x=>x.id==='Doc850045');assert.equal(second.deadline,'2099-12-20T00:00:00.000Z');assert.equal(second.posted,null);
 const unstated=items.find(x=>x.id==='Doc850047');assert.equal(unstated.deadline,null);
 assert.equal(D.normalize({attributes:{SOLICITATIONNUMBER:'Doc850048',SOLICITATIONTITLE:'Due date only',AGENCY_NAME:'Department of Health',DUE_DATE:Date.parse('2099-12-25T00:00:00.000Z'),ISSUANCEDATE:null,CLOSEDATE:null}}).deadline,'2099-12-25T00:00:00.000Z');
 assert.equal(D.normalize({attributes:{SOLICITATIONNUMBER:'Doc850049',AGENCY_NAME:'Department of Health',DUE_DATE:null,ISSUANCEDATE:null,CLOSEDATE:null}}),null);
 assert.equal(D.normalize({attributes:{SOLICITATIONNUMBER:'Doc850050',SOLICITATIONTITLE:'Zero close date',AGENCY_NAME:'Department of Health',DUE_DATE:null,ISSUANCEDATE:null,CLOSEDATE:0}}).deadline,null);
 assert.equal(D.detailId('Doc855545'),'Doc855545');
 assert.throws(()=>D.detailId('Doc 855545'),e=>e.status===400);
 assert.throws(()=>D.detailId(''),e=>e.status===400);
});
test('dc search filters past solicitations, deduplicates by solicitation number, matches keyword, pages, caches, and admits under the dc-pass kind',async()=>{
 const h=fixtureHarness(),s=h.state;
 try{
  const first=await D.search(h.c,h.e,{});assert.equal(first.items.length,3);assert.equal(first.total,3);assert.equal(first.cached,false);assert.match(first.notice,/close date as the operative deadline/);assert.equal(s.calls.length,1);
  assert.equal(first.items.filter(x=>x.id==='Doc855545').length,1);
  const second=await D.search(h.c,h.e,{});assert.equal(second.cached,true);assert.equal(s.calls.length,1);
  assert.equal((await D.search(h.c,h.e,{keyword:'officiating'})).items.length,1);
  assert.equal((await D.search(h.c,h.e,{keyword:'Doc850045'})).items.length,1);
  assert.equal((await D.search(h.c,h.e,{keyword:'health'})).items.length,2);
  assert.equal((await D.search(h.c,h.e,{keyword:'nonexistent'})).items.length,0);
  assert.ok(s.admissions.every(p=>p.p_kind==='dc-pass'&&p.p_limit===10&&p.p_global===50));
  s.feed=feedWith(30);s.cache={};s.calls=[];
  const page0=await D.search(h.c,h.e,{});assert.equal(page0.items.length,25);assert.equal(page0.hasMore,true);assert.equal(page0.total,30);
  const page1=await D.search(h.c,h.e,{page:1});assert.equal(page1.items.length,5);assert.equal(page1.hasMore,false);assert.equal(s.calls.length,1);
 }finally{h.restore();}
});
test('dc failed feed, error payload, and bad inputs are rejected before any stale data is served',async()=>{
 const h=fixtureHarness(),s=h.state;
 try{
  s.status=503;await assert.rejects(D.search(h.c,h.e,{}),e=>e.status===503);s.status=200;
  s.feed={error:{code:400,message:'Invalid query'}};s.cache={};await assert.rejects(D.search(h.c,h.e,{}),e=>e.status===503);
  s.feed={features:FEATURES};s.cache={};
  for(const bad of [{keyword:'x'.repeat(101)},{page:-1},{page:10},{page:0.5}]){const before=s.calls.length;await assert.rejects(D.search(h.c,h.e,bad),e=>e.status===400);assert.equal(s.calls.length,before);}
 }finally{h.restore();}
});
test('dc detail returns the solicitation with empty text, resolves by number, caches, and 404s when the solicitation leaves the feed',async()=>{
 const h=fixtureHarness(),s=h.state;
 try{
  const d=await D.detail(h.c,h.e,'Doc855545');assert.equal(d.item.title,'FY27-DCSAA-Fall Sports Officiating Services');assert.equal(d.text,'');assert.match(d.notice,/Attachments are not imported/);assert.equal(s.calls.length,1);
  const again=await D.detail(h.c,h.e,'Doc855545');assert.equal(again.cached,true);assert.equal(s.calls.length,1);
  s.cache={};await assert.rejects(D.detail(h.c,h.e,'Doc999999'),e=>e.status===404);
 }finally{h.restore();}
});
test('dc handler routes search and detail and rejects unknown actions',async()=>{
 const h=fixtureHarness(),kb=require('../netlify/functions/lib/knowledge-base'),F=require('../netlify/functions/lib/free-tools'),handler=require('../netlify/functions/dc-opportunities').handler;
 const saved={enabled:F.enabled,configuration:kb.configuration};F.enabled=()=>true;kb.configuration=()=>h.c;
 try{
  const searchRes=await handler({httpMethod:'POST',headers:{'x-nf-client-connection-ip':'192.0.2.1'},body:JSON.stringify({action:'search',keyword:'',page:0})});assert.equal(searchRes.statusCode,200);assert.equal(JSON.parse(searchRes.body).items.length,3);
  const detailRes=await handler({httpMethod:'POST',headers:{'x-nf-client-connection-ip':'192.0.2.1'},body:JSON.stringify({action:'detail',notice:'Doc855545'})});assert.equal(detailRes.statusCode,200);
  const bad=await handler({httpMethod:'POST',headers:{},body:JSON.stringify({action:'explode'})});assert.equal(bad.statusCode,400);
 }finally{F.enabled=saved.enabled;kb.configuration=saved.configuration;h.restore();}
});
