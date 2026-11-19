const {test}=require('node:test'),assert=require('node:assert/strict'),G=require('../netlify/functions/lib/grants-opportunities');
process.env.ANALYTICS_SIGNING_SECRET='fixture-only-signing-secret-at-least-32-characters';
function hit(over={}){return {id:'1234567',number:'TEST-26-001',title:'Fictional grant opportunity',agency:'Fictional Agency',agencyName:'Fictional Agency Name',agencyCode:'FA',openDate:'11/01/2026',closeDate:'12/15/2099',oppStatus:'posted',docType:'synopsis',...over};}
function detailFixture(){return {id:1234567,opportunityNumber:'TEST-26-001',opportunityTitle:'Fictional grant opportunity',owningAgencyCode:'FA',docType:'synopsis',synopsis:{synopsisDesc:'<p>Fictional grant synopsis &amp; details.</p><script>not executable</script>',agencyName:'Fictional Agency Name',agencyContactName:'Fictional Contact',agencyContactEmail:'contact@example.invalid',postingDate:'Nov 1, 2026 12:00:00 AM EDT',postingDateStr:'2026-11-01-00-00-00',responseDate:'12/15/2099',costSharing:'No',awardCeiling:'none',awardFloor:'$5,000',applicantTypes:['Nonprofits'],fundingInstruments:['Grant'],fundingActivityCategories:['Health'],applicantEligibilityDesc:'<p>Eligible applicants only.</p>'}};}
test('grant identity rejects foreign hosts, credentials, ports, path tricks and query injection',()=>{
 const id='1234567';assert.equal(G.grantId(id),id);assert.equal(G.grantId('https://www.grants.gov/search-results-detail/'+id),id);
 for(const value of ['https://evil.invalid/search-results-detail/'+id,'http://www.grants.gov/search-results-detail/'+id,'https://user:pass@www.grants.gov/search-results-detail/'+id,'https://www.grants.gov:444/search-results-detail/'+id,'https://www.grants.gov/search-results-detail/../admin',"x' OR 1=1",'https://www.grants.gov/search-results-detail/x%2fy','1234567890123',''])assert.throws(()=>G.grantId(value),e=>e.status===400);
});
test('dates are strict MM/DD/YYYY with postingDateStr support; money maps none to null',()=>{
 assert.equal(G.grantDate('11/01/2026'),'2026-11-01');assert.equal(G.grantDate('02/30/2026'),null);assert.equal(G.grantDate('13/01/2026'),null);assert.equal(G.grantDate('2026-11-01'),null);assert.equal(G.grantDate(''),null);assert.equal(G.grantDate(null),null);
 assert.equal(G.detailDate('2026-11-01-00-00-00'),'2026-11-01');assert.equal(G.detailDate('12/15/2099'),'2099-12-15');assert.equal(G.detailDate('not a date'),null);assert.equal(G.detailDate(''),null);
 assert.equal(G.money('none'),null);assert.equal(G.money(''),null);assert.equal(G.money(null),null);assert.equal(G.money('$5,000'),5000);assert.equal(G.money(2500),2500);assert.equal(G.money('abc'),null);
});
test('normalization rejects closed grants and missing identity, keeps forecasts, and never carries contact details',()=>{
 const n=G.normalize(hit());assert.equal(n.provider,'grants');assert.equal(n.url,'https://www.grants.gov/search-results-detail/1234567');assert.equal(n.deadline,'2099-12-15');assert.equal(n.status,'posted');assert.ok(!('agencyContactName'in n));assert.ok(!('agencyContactEmail'in n));
 assert.equal(G.normalize({...hit(),agencyName:'',agency:'',agencyCode:''}).agency,'Agency not supplied');
 assert.equal(G.normalize({...hit(),closeDate:'not a date'}).deadline,null);
 assert.equal(G.normalize({...hit(),oppStatus:'forecasted',closeDate:''}).deadline,null);
 for(const change of [{oppStatus:'closed'},{oppStatus:'archived'},{id:'not-numeric'},{number:''},{title:''},{openDate:''},{openDate:'02/30/2026'}])assert.equal(G.normalize({...hit(),...change}),null);
 assert.equal(G.plain('<p>Text &amp; source.</p><script>ignore</script>'), 'Text & source.');
});
function fixtureHarness(){
 const kb=require('../netlify/functions/lib/knowledge-base'),F=require('../netlify/functions/lib/free-tools');
 const saved={fetch:global.fetch,rpc:kb.rpc,db:F.db};
 const state={cache:{},admissions:[],calls:[],errorcode:0,hits:[hit()],hitCount:1,detail:null};
 F.db=async(c,path)=>{const m=path.match(/key=eq\.([^&]+)/);return m&&state.cache[m[1]]?[{body:state.cache[m[1]]}]:[];};
 kb.rpc=async(c,name,p)=>{if(name==='ft_admit'){state.admissions.push(p);return null;}if(name==='ft_cache_put'){state.cache[p.p_key]=p.p_body;return null;}throw Error('Unexpected RPC '+name);};
 global.fetch=async(url,o)=>{const body=JSON.parse(o.body);state.calls.push({url,body});assert.equal(o.method,'POST');assert.equal(o.headers['Content-Type'],'application/json');
  if(url===G.DETAIL_URL)return new Response(JSON.stringify({errorcode:state.errorcode,msg:'Webservice Succeeds',data:state.detail||detailFixture()}));
  if(url===G.SEARCH_URL)return new Response(JSON.stringify({errorcode:state.errorcode,msg:'Webservice Succeeds',data:{hitCount:state.hitCount,oppHits:state.hits}}));
  throw Error('Unexpected URL '+url);};
 return {state,c:{},e:{headers:{'x-nf-client-connection-ip':'192.0.2.1'}},restore(){global.fetch=saved.fetch;kb.rpc=saved.rpc;F.db=saved.db;}};
}
test('search sends keyword and paging to Grants.gov, filters past deadlines, caches, and admits under its own kind',async()=>{
 const h=fixtureHarness(),s=h.state;s.hits=[hit(),{...hit({id:'1234568',number:'TEST-26-002',closeDate:'01/01/2001'})},{...hit({id:'1234569',number:'TEST-26-003',oppStatus:'forecasted',closeDate:''})}];s.hitCount=3;
 try{
  const first=await G.search(h.c,h.e,{keyword:'',page:0});assert.equal(first.items.length,2);assert.equal(first.total,3);assert.equal(first.cached,false);assert.match(first.notice,/grants, not federal contracts/);
  assert.deepEqual(s.calls[0].body,{oppStatuses:'posted|forecasted',rows:25,startRecordNum:0});assert.ok(!('keyword'in s.calls[0].body));
  const second=await G.search(h.c,h.e,{keyword:'',page:0});assert.equal(second.cached,true);assert.equal(s.calls.length,1);
  const keyword=await G.search(h.c,h.e,{keyword:'fictional',page:0});assert.equal(keyword.items.length,2);assert.equal(s.calls[1].body.keyword,'fictional');
  const page=await G.search(h.c,h.e,{keyword:'',page:1});assert.equal(s.calls[2].body.startRecordNum,25);
  assert.ok(s.admissions.every(p=>p.p_kind==='grants'&&p.p_limit===10&&p.p_global===50));
 }finally{h.restore();}
});
test('an upstream errorcode is a failure even on HTTP 200, and bad inputs are rejected before any call',async()=>{
 const h=fixtureHarness(),s=h.state;
 try{
  s.errorcode=1;await assert.rejects(G.search(h.c,h.e,{}),e=>e.status===503);await assert.rejects(G.detail(h.c,h.e,'1234567'),e=>e.status===503);s.errorcode=0;
  for(const bad of [{keyword:'x'.repeat(101)},{page:-1},{page:10},{page:0.5}]){const before=s.calls.length;await assert.rejects(G.search(h.c,h.e,bad),e=>e.status===400);assert.equal(s.calls.length,before);}
 }finally{h.restore();}
});
test('detail returns award amounts, eligibility and plain synopsis, never contact details, and caches',async()=>{
 const h=fixtureHarness(),s=h.state;
 try{
  const d=await G.detail(h.c,h.e,'1234567');assert.equal(d.item.number,'TEST-26-001');assert.equal(d.item.awardCeiling,null);assert.equal(d.item.awardFloor,5000);assert.equal(d.item.eligibility,'Eligible applicants only.');assert.equal(d.text,'Fictional grant synopsis & details.');assert.match(d.notice,/Attachments are not imported/);assert.ok(!('agencyContactName'in d.item));assert.ok(!('agencyContactEmail'in d.item));assert.equal(s.calls.length,1);
  const again=await G.detail(h.c,h.e,'https://www.grants.gov/search-results-detail/1234567');assert.equal(again.cached,true);assert.equal(s.calls.length,1);
  s.detail={...detailFixture(),id:9999999};s.cache={};await assert.rejects(G.detail(h.c,h.e,'1234567'),e=>e.status===404);
 }finally{h.restore();}
});
test('handler routes search and detail and rejects unknown actions',async()=>{
 const h=fixtureHarness(),kb=require('../netlify/functions/lib/knowledge-base'),F=require('../netlify/functions/lib/free-tools'),handler=require('../netlify/functions/grants-opportunities').handler;
 const saved={enabled:F.enabled,configuration:kb.configuration};F.enabled=()=>true;kb.configuration=()=>h.c;
 try{
  const searchRes=await handler({httpMethod:'POST',headers:{'x-nf-client-connection-ip':'192.0.2.1'},body:JSON.stringify({action:'search',keyword:'',page:0})});assert.equal(searchRes.statusCode,200);assert.equal(JSON.parse(searchRes.body).items.length,1);
  const detailRes=await handler({httpMethod:'POST',headers:{'x-nf-client-connection-ip':'192.0.2.1'},body:JSON.stringify({action:'detail',notice:'1234567'})});assert.equal(detailRes.statusCode,200);
  const bad=await handler({httpMethod:'POST',headers:{},body:JSON.stringify({action:'explode'})});assert.equal(bad.statusCode,400);
 }finally{F.enabled=saved.enabled;kb.configuration=saved.configuration;h.restore();}
});
