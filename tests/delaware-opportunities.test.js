const {test}=require('node:test'),assert=require('node:assert/strict'),S=require('../netlify/functions/lib/socrata-opportunities');
process.env.ANALYTICS_SIGNING_SECRET='fixture-only-signing-secret-at-least-32-characters';
const SLUG='delaware';
const ROWS=[
 {contractnumber:'ARNG2318-BIDENMICROGRID',contracttitle:'Biden Microgrid',opendate:'2026-11-10T00:00:00.000',deadlinedate:'2099-12-01T00:00:00.000',agencycode:'ARNG',bidurl:{url:'https://mmp.delaware.gov/Bids/Details/9327'}},
 {contractnumber:'BSD270003-DESIGNSERV',contracttitle:'Design Services for SITE School',opendate:'2026-11-12T00:00:00.000',deadlinedate:'2099-12-03T00:00:00.000',agencycode:'BSD',bidurl:'https://mmp.delaware.gov/Bids/Details/9328'},
 {contractnumber:'PAST-001',contracttitle:'Past bid',opendate:'2026-10-01T00:00:00.000',deadlinedate:'2001-11-10T00:00:00.000',agencycode:'ARNG',bidurl:{url:'https://mmp.delaware.gov/Bids/Details/9329'}},
 {contractnumber:'NODEADLINE-001',contracttitle:'No deadline bid',opendate:'2026-11-12T00:00:00.000',deadlinedate:null,agencycode:'BSD',bidurl:{url:'https://mmp.delaware.gov/Bids/Details/9330'}},
 {contracttitle:'Missing number',opendate:'2026-11-12T00:00:00.000',deadlinedate:'2099-12-03T00:00:00.000',agencycode:'BSD',bidurl:{url:'https://mmp.delaware.gov/Bids/Details/9331'}},
];
function feedWith(count){const rows=[];for(let i=0;i<count;i++)rows.push({contractnumber:'DE-26-'+String(100+i),contracttitle:'Fictional Delaware bid '+i,opendate:'2026-11-12T00:00:00.000',deadlinedate:'2099-12-19T00:00:00.000',agencycode:'BSD',bidurl:{url:'https://mmp.delaware.gov/Bids/Details/'+(9400+i)}});return rows;}
function fixtureHarness(feed){
 const kb=require('../netlify/functions/lib/knowledge-base'),F=require('../netlify/functions/lib/free-tools');
 const saved={fetch:global.fetch,rpc:kb.rpc,db:F.db};
 const state={cache:{},admissions:[],calls:[],feed:feed||ROWS,status:200};
 F.db=async(c,path)=>{const m=path.match(/key=eq\.([^&]+)/);return m&&state.cache[m[1]]?[{body:state.cache[m[1]]}]:[];};
 kb.rpc=async(c,name,p)=>{if(name==='ft_admit'){state.admissions.push(p);return null;}if(name==='ft_cache_put'){state.cache[p.p_key]=p.p_body;return null;}throw Error('Unexpected RPC '+name);};
 global.fetch=async(url,o)=>{state.calls.push(url);assert.equal(url,S.feedUrl(SLUG));assert.equal(o.redirect,'error');if(state.status!==200)return new Response('{}',{status:state.status});return new Response(JSON.stringify(state.feed),{headers:{'Content-Type':'application/json'}});};
 return {state,c:{},e:{headers:{'x-nf-client-connection-ip':'192.0.2.1'}},restore(){global.fetch=saved.fetch;kb.rpc=saved.rpc;F.db=saved.db;}};
}
test('delaware feed url points at the Delaware Open Bids Socrata dataset with no where filter',()=>{
 assert.match(S.feedUrl(SLUG),/data\.delaware\.gov\/resource\/2hnj-zwix\.json/);
 assert.ok(!S.feedUrl(SLUG).includes('$where'));
 assert.match(S.feedUrl(SLUG),/\$limit=1000/);
 assert.equal(S.laneConfig(SLUG).provider,'socrata-delaware');
});
test('delaware normalization keeps open and unstated-deadline bids, links through bidurl, and drops incomplete rows',()=>{
 const items=ROWS.map(x=>S.normalize(x,SLUG)).filter(Boolean);assert.equal(items.length,4);
 const first=items.find(x=>x.id==='ARNG2318-BIDENMICROGRID');assert.equal(first.provider,'socrata-delaware');assert.equal(first.reference,'ARNG2318-BIDENMICROGRID');assert.equal(first.title,'Biden Microgrid');assert.equal(first.agency,'ARNG');assert.equal(first.deadline,'2099-12-01T00:00:00.000Z');assert.equal(first.url,'https://mmp.delaware.gov/Bids/Details/9327');
 const unstated=items.find(x=>x.id==='NODEADLINE-001');assert.equal(unstated.deadline,null);
 assert.equal(S.normalize({contractnumber:'BSD270003-DESIGNSERV',contracttitle:'Plain url',opendate:'2026-11-12T00:00:00.000',deadlinedate:'2099-12-03T00:00:00.000',agencycode:'BSD',bidurl:'https://mmp.delaware.gov/Bids/Details/9328'},SLUG).url,'https://mmp.delaware.gov/Bids/Details/9328');
 assert.equal(S.normalize({contractnumber:'BSD270003-DESIGNSERV',contracttitle:'No url',opendate:'2026-11-12T00:00:00.000',deadlinedate:'2099-12-03T00:00:00.000',agencycode:'BSD'},SLUG),null);
 assert.equal(S.detailId('ARNG2318-BIDENMICROGRID',SLUG),'ARNG2318-BIDENMICROGRID');
 assert.throws(()=>S.detailId('x',SLUG),e=>e.status===400);
 assert.throws(()=>S.detailId('bad id!',SLUG),e=>e.status===400);
});
test('delaware search filters past bids, matches keyword across title, agency code and contract number, pages, caches, and admits under the socrata kind',async()=>{
 const h=fixtureHarness(),s=h.state;
 try{
  const first=await S.search(h.c,h.e,{},SLUG);assert.equal(first.items.length,3);assert.equal(first.total,3);assert.equal(first.cached,false);assert.match(first.notice,/updated weekly/);assert.equal(s.calls.length,1);
  const second=await S.search(h.c,h.e,{},SLUG);assert.equal(second.cached,true);assert.equal(s.calls.length,1);
  assert.equal((await S.search(h.c,h.e,{keyword:'microgrid'},SLUG)).items.length,1);
  assert.equal((await S.search(h.c,h.e,{keyword:'BSD270003-DESIGNSERV'},SLUG)).items.length,1);
  assert.equal((await S.search(h.c,h.e,{keyword:'BSD'},SLUG)).items.length,2);
  assert.equal((await S.search(h.c,h.e,{keyword:'nonexistent'},SLUG)).items.length,0);
  assert.ok(s.admissions.every(p=>p.p_kind==='socrata'&&p.p_limit===10&&p.p_global===50));
  s.feed=feedWith(30);s.cache={};s.calls=[];
  const page0=await S.search(h.c,h.e,{},SLUG);assert.equal(page0.items.length,25);assert.equal(page0.hasMore,true);assert.equal(page0.total,30);
  const page1=await S.search(h.c,h.e,{page:1},SLUG);assert.equal(page1.items.length,5);assert.equal(page1.hasMore,false);assert.equal(s.calls.length,1);
 }finally{h.restore();}
});
test('delaware failed feed and bad inputs are rejected before any stale data is served',async()=>{
 const h=fixtureHarness(),s=h.state;
 try{
  s.status=503;await assert.rejects(S.search(h.c,h.e,{},SLUG),e=>e.status===503);s.status=200;
  for(const bad of [{keyword:'x'.repeat(101)},{page:-1},{page:10},{page:0.5}]){const before=s.calls.length;await assert.rejects(S.search(h.c,h.e,bad,SLUG),e=>e.status===400);assert.equal(s.calls.length,before);}
 }finally{h.restore();}
});
test('delaware detail returns the bid with empty text, resolves by contract number, caches, and 404s when the bid leaves the feed',async()=>{
 const h=fixtureHarness(),s=h.state;
 try{
  const d=await S.detail(h.c,h.e,'ARNG2318-BIDENMICROGRID',SLUG);assert.equal(d.item.title,'Biden Microgrid');assert.equal(d.text,'');assert.match(d.notice,/Attachments are not imported/);assert.equal(s.calls.length,1);
  const again=await S.detail(h.c,h.e,'ARNG2318-BIDENMICROGRID',SLUG);assert.equal(again.cached,true);assert.equal(s.calls.length,1);
  s.cache={};await assert.rejects(S.detail(h.c,h.e,'NOPE-001',SLUG),e=>e.status===404);
 }finally{h.restore();}
});
test('delaware handler routes search and detail and rejects unknown actions',async()=>{
 const h=fixtureHarness(),kb=require('../netlify/functions/lib/knowledge-base'),F=require('../netlify/functions/lib/free-tools'),handler=require('../netlify/functions/delaware-opportunities').handler;
 const saved={enabled:F.enabled,configuration:kb.configuration};F.enabled=()=>true;kb.configuration=()=>h.c;
 try{
  const searchRes=await handler({httpMethod:'POST',headers:{'x-nf-client-connection-ip':'192.0.2.1'},body:JSON.stringify({action:'search',keyword:'',page:0})});assert.equal(searchRes.statusCode,200);assert.equal(JSON.parse(searchRes.body).items.length,3);
  const detailRes=await handler({httpMethod:'POST',headers:{'x-nf-client-connection-ip':'192.0.2.1'},body:JSON.stringify({action:'detail',notice:'ARNG2318-BIDENMICROGRID'})});assert.equal(detailRes.statusCode,200);
  const bad=await handler({httpMethod:'POST',headers:{},body:JSON.stringify({action:'explode'})});assert.equal(bad.statusCode,400);
 }finally{F.enabled=saved.enabled;kb.configuration=saved.configuration;h.restore();}
});
