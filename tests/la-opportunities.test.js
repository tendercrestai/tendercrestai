const {test}=require('node:test'),assert=require('node:assert/strict'),S=require('../netlify/functions/lib/socrata-opportunities');
process.env.ANALYTICS_SIGNING_SECRET='fixture-only-signing-secret-at-least-32-characters';
const SLUG='los-angeles';
const ROWS=[
 {rampid:'233178',title:'California RFP2417754728 Environmental Quality Act (CEQA) Service',stagename:'Open',bidpost:'2026-11-18T00:00:00.000',closedate:'2099-12-16T00:00:00.000',department:'Los Angeles Unified School District',url:{url:'https://www.rampla.org/s/opportunity-details?id=006Ql00000oq1jBIAQ'}},
 {rampid:'233186',title:'147149 MULTIPLEXERS',stagename:'Open',bidpost:'2026-11-17T00:00:00.000',closedate:'2099-12-03T00:00:00.000',department:'Water & Power',url:'https://www.rampla.org/s/opportunity-details?id=006Ql00000oq1jBIBQ'},
 {rampid:'233190',title:'Past notice',stagename:'Open',bidpost:'2026-11-01T00:00:00.000',closedate:'2001-11-10T00:00:00.000',department:'Water & Power',url:{url:'https://www.rampla.org/s/opportunity-details?id=006Ql00000oq1jBICQ'}},
 {rampid:'233191',title:'No close date notice',stagename:'Open',bidpost:'2026-11-17T00:00:00.000',closedate:null,department:'Water & Power',url:{url:'https://www.rampla.org/s/opportunity-details?id=006Ql00000oq1jBIDQ'}},
 {rampid:233195,title:'Numeric RAMP id notice',stagename:'Open',bidpost:'2026-11-17T00:00:00.000',closedate:'2099-12-04T00:00:00.000',department:'Water & Power',url:'https://www.rampla.org/s/opportunity-details?id=006Ql00000oq1jBIEQ'},
 {title:'Missing id',stagename:'Open',bidpost:'2026-11-17T00:00:00.000',closedate:'2099-12-03T00:00:00.000',department:'Water & Power',url:{url:'https://www.rampla.org/s/opportunity-details?id=006Ql00000oq1jBIFQ'}},
];
function feedWith(count){const rows=[];for(let i=0;i<count;i++)rows.push({rampid:String(30000+i),title:'Fictional Los Angeles notice '+i,stagename:'Open',bidpost:'2026-11-16T09:'+String(i%60).padStart(2,'0')+':00.000',closedate:'2099-12-19T00:00:00.000',department:'Los Angeles Department of Water and Power',url:{url:'https://www.rampla.org/s/opportunity-details?id=006Ql00000oq1jB'+String(i).padStart(3,'0')}});return rows;}
function fixtureHarness(feed){
 const kb=require('../netlify/functions/lib/knowledge-base'),F=require('../netlify/functions/lib/free-tools');
 const saved={fetch:global.fetch,rpc:kb.rpc,db:F.db};
 const state={cache:{},admissions:[],calls:[],feed:feed||ROWS,status:200};
 F.db=async(c,path)=>{const m=path.match(/key=eq\.([^&]+)/);return m&&state.cache[m[1]]?[{body:state.cache[m[1]]}]:[];};
 kb.rpc=async(c,name,p)=>{if(name==='ft_admit'){state.admissions.push(p);return null;}if(name==='ft_cache_put'){state.cache[p.p_key]=p.p_body;return null;}throw Error('Unexpected RPC '+name);};
 global.fetch=async(url,o)=>{state.calls.push(url);assert.equal(url,S.feedUrl(SLUG));assert.equal(o.redirect,'error');if(state.status!==200)return new Response('{}',{status:state.status});return new Response(JSON.stringify(state.feed),{headers:{'Content-Type':'application/json'}});};
 return {state,c:{},e:{headers:{'x-nf-client-connection-ip':'192.0.2.1'}},restore(){global.fetch=saved.fetch;kb.rpc=saved.rpc;F.db=saved.db;}};
}
test('la feed url points at the Los Angeles RAMP Socrata dataset with the open filter',()=>{
 assert.match(S.feedUrl(SLUG),/data\.lacity\.org\/resource\/hf3r-utnq\.json/);
 assert.match(S.feedUrl(SLUG),/stagename='Open'/);
 assert.match(S.feedUrl(SLUG),/\$limit=1000/);
 assert.equal(S.laneConfig(SLUG).provider,'socrata-la');
});
test('la normalization keeps open and unstated-deadline rows, accepts numeric ids and plain or object urls, and drops incomplete rows',()=>{
 const items=ROWS.map(x=>S.normalize(x,SLUG)).filter(Boolean);assert.equal(items.length,5);
 const first=items.find(x=>x.id==='233178');assert.equal(first.provider,'socrata-la');assert.equal(first.reference,'233178');assert.equal(first.title,'California RFP2417754728 Environmental Quality Act (CEQA) Service');assert.equal(first.agency,'Los Angeles Unified School District');assert.equal(first.deadline,'2099-12-16T00:00:00.000Z');assert.equal(first.url,'https://www.rampla.org/s/opportunity-details?id=006Ql00000oq1jBIAQ');
 const numeric=items.find(x=>x.id==='233195');assert.equal(numeric.title,'Numeric RAMP id notice');
 const unstated=items.find(x=>x.id==='233191');assert.equal(unstated.deadline,null);
 assert.equal(S.normalize({rampid:'233186',title:'Plain url',bidpost:'2026-11-17T00:00:00.000',closedate:'2099-12-03T00:00:00.000',department:'Water & Power',url:'https://www.rampla.org/s/opportunity-details?id=006Ql00000oq1jBIBQ'},SLUG).url,'https://www.rampla.org/s/opportunity-details?id=006Ql00000oq1jBIBQ');
 assert.equal(S.normalize({rampid:'233186',title:'No url',bidpost:'2026-11-17T00:00:00.000',closedate:'2099-12-03T00:00:00.000',department:'Water & Power'},SLUG),null);
 assert.equal(S.normalize({rampid:'233186',title:'No posted',closedate:'2099-12-03T00:00:00.000',department:'Water & Power',url:{url:'https://www.rampla.org/s/opportunity-details?id=006Ql00000oq1jBIBQ'}},SLUG),null);
 assert.equal(S.detailId('233178',SLUG),'233178');
 assert.throws(()=>S.detailId('233178x',SLUG),e=>e.status===400);
 assert.throws(()=>S.detailId('',SLUG),e=>e.status===400);
});
test('la search filters past notices, matches keyword across title, agency and reference, pages, caches, and admits under the socrata kind',async()=>{
 const h=fixtureHarness(),s=h.state;
 try{
  const first=await S.search(h.c,h.e,{},SLUG);assert.equal(first.items.length,4);assert.equal(first.total,4);assert.equal(first.cached,false);assert.match(first.notice,/CC0/);assert.equal(s.calls.length,1);
  const second=await S.search(h.c,h.e,{},SLUG);assert.equal(second.cached,true);assert.equal(s.calls.length,1);
  assert.equal((await S.search(h.c,h.e,{keyword:'multiplexers'},SLUG)).items.length,1);
  assert.equal((await S.search(h.c,h.e,{keyword:'233178'},SLUG)).items.length,1);
  assert.equal((await S.search(h.c,h.e,{keyword:'water'},SLUG)).items.length,3);
  assert.equal((await S.search(h.c,h.e,{keyword:'nonexistent'},SLUG)).items.length,0);
  assert.ok(s.admissions.every(p=>p.p_kind==='socrata'&&p.p_limit===10&&p.p_global===50));
  const F=require('../netlify/functions/lib/free-tools');
  assert.notEqual(F.mac('socrata:los-angeles:snapshot:v1'),F.mac('socrata:delaware:snapshot:v1'),'los-angeles and delaware snapshots use different cache keys');
  s.feed=feedWith(30);s.cache={};s.calls=[];
  const page0=await S.search(h.c,h.e,{},SLUG);assert.equal(page0.items.length,25);assert.equal(page0.hasMore,true);assert.equal(page0.total,30);
  const page1=await S.search(h.c,h.e,{page:1},SLUG);assert.equal(page1.items.length,5);assert.equal(page1.hasMore,false);assert.equal(s.calls.length,1);
 }finally{h.restore();}
});
test('la failed feed and bad inputs are rejected before any stale data is served',async()=>{
 const h=fixtureHarness(),s=h.state;
 try{
  s.status=503;await assert.rejects(S.search(h.c,h.e,{},SLUG),e=>e.status===503);s.status=200;
  for(const bad of [{keyword:'x'.repeat(101)},{page:-1},{page:10},{page:0.5}]){const before=s.calls.length;await assert.rejects(S.search(h.c,h.e,bad,SLUG),e=>e.status===400);assert.equal(s.calls.length,before);}
 }finally{h.restore();}
});
test('la detail returns the notice with empty text, resolves by id, caches, and 404s when the notice leaves the feed',async()=>{
 const h=fixtureHarness(),s=h.state;
 try{
  const d=await S.detail(h.c,h.e,'233178',SLUG);assert.equal(d.item.title,'California RFP2417754728 Environmental Quality Act (CEQA) Service');assert.equal(d.text,'');assert.match(d.notice,/Attachments are not imported/);assert.equal(s.calls.length,1);
  const again=await S.detail(h.c,h.e,'233178',SLUG);assert.equal(again.cached,true);assert.equal(s.calls.length,1);
  s.cache={};await assert.rejects(S.detail(h.c,h.e,'99999',SLUG),e=>e.status===404);
 }finally{h.restore();}
});
test('la handler routes search and detail and rejects unknown actions',async()=>{
 const h=fixtureHarness(),kb=require('../netlify/functions/lib/knowledge-base'),F=require('../netlify/functions/lib/free-tools'),handler=require('../netlify/functions/la-opportunities').handler;
 const saved={enabled:F.enabled,configuration:kb.configuration};F.enabled=()=>true;kb.configuration=()=>h.c;
 try{
  const searchRes=await handler({httpMethod:'POST',headers:{'x-nf-client-connection-ip':'192.0.2.1'},body:JSON.stringify({action:'search',keyword:'',page:0})});assert.equal(searchRes.statusCode,200);assert.equal(JSON.parse(searchRes.body).items.length,4);
  const detailRes=await handler({httpMethod:'POST',headers:{'x-nf-client-connection-ip':'192.0.2.1'},body:JSON.stringify({action:'detail',notice:'233178'})});assert.equal(detailRes.statusCode,200);
  const bad=await handler({httpMethod:'POST',headers:{},body:JSON.stringify({action:'explode'})});assert.equal(bad.statusCode,400);
 }finally{F.enabled=saved.enabled;kb.configuration=saved.configuration;h.restore();}
});
