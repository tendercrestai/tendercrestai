const {test}=require('node:test'),assert=require('node:assert/strict'),B=require('../netlify/functions/lib/bonfire-opportunities');
process.env.ANALYTICS_SIGNING_SECRET='fixture-only-signing-secret-at-least-32-characters';
const RSS=`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Utah Bonfire Opportunities</title><link>https://utah.bonfirehub.com/opportunities</link><description>Fictional fixture feed</description>
<item><title>Reference #: UT-26-001. Fictional road resurfacing</title><link>https://utah.bonfirehub.com/opportunities/12345</link><pubDate>Mon, 16 Nov 2026 09:00:00 GMT</pubDate><description><![CDATA[Reference #: UT-26-001. Name: Fictional road resurfacing Department: Utah Department of Transportation Description: Fictional solicitation text &amp; details. Project closes Dec 19, 2099 5:00 PM MST.]]></description></item>
<item><title>Reference #: UT-26-002. Fictional office supplies</title><link>https://utah.bonfirehub.com/opportunities/12346</link><pubDate>Mon, 16 Nov 2026 10:00:00 GMT</pubDate><description><![CDATA[Reference #: UT-26-002. Name: Fictional office supplies Department: Utah Division of Purchasing Description: Fictional solicitation text with no closing line.]]></description></item>
<item><title>Past notice</title><link>https://utah.bonfirehub.com/opportunities/12347</link><pubDate>Mon, 09 Nov 2026 09:00:00 GMT</pubDate><description><![CDATA[Reference #: UT-26-003. Name: Past notice Department: Utah Department of Transportation Description: Fictional solicitation text. Project closes Nov 10, 2001 5:00 PM MST.]]></description></item>
<item><title>Foreign link</title><link>https://evil.invalid/opportunities/12348</link><pubDate>Mon, 16 Nov 2026 09:00:00 GMT</pubDate><description><![CDATA[Reference #: UT-26-004. Name: Foreign link Department: Utah Department of Transportation Description: Fictional solicitation text. Project closes Dec 19, 2099 5:00 PM MST.]]></description></item>
</channel></rss>`;
function feedWith(count){let items='';for(let i=0;i<count;i++){items+=`<item><title>Fictional Utah notice ${i}</title><link>https://utah.bonfirehub.com/opportunities/${20000+i}</link><pubDate>Mon, 16 Nov 2026 09:${String(i%60).padStart(2,'0')}:00 GMT</pubDate><description><![CDATA[Reference #: UT-26-${100+i}. Name: Fictional Utah notice ${i} Department: Utah Department of Transportation Description: Fictional solicitation text. Project closes Dec 19, 2099 5:00 PM MST.]]></description></item>`;}return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Utah Bonfire Opportunities</title>${items}</channel></rss>`;}
test('bonfire identity rejects foreign hosts, credentials, ports, path tricks and query injection',()=>{
 const id='12345';assert.equal(B.bonfireId(id),id);assert.equal(B.bonfireId('https://utah.bonfirehub.com/opportunities/'+id),id);
 for(const value of ['https://evil.invalid/opportunities/'+id,'http://utah.bonfirehub.com/opportunities/'+id,'https://user:pass@utah.bonfirehub.com/opportunities/'+id,'https://utah.bonfirehub.com:444/opportunities/'+id,'https://utah.bonfirehub.com/opportunities/../admin',"x' OR 1=1",'https://utah.bonfirehub.com/opportunities/x%2fy','1234567890123',''])assert.throws(()=>B.bonfireId(value),e=>e.status===400);
});
test('close dates parse Mountain time, respect 12 AM/PM, and never guess an unknown timezone or invalid date',()=>{
 assert.equal(B.parseCloseDate('Project closes Dec 19, 2099 5:00 PM MST.'),'2099-12-20T00:00:00.000Z');
 assert.equal(B.parseCloseDate('Project closes Jan 1, 2099 12:00 AM MST.'),'2099-01-01T07:00:00.000Z');
 assert.equal(B.parseCloseDate('Project closes Jan 1, 2099 12:00 PM MST.'),'2099-01-01T19:00:00.000Z');
 assert.equal(B.parseCloseDate('Project closes Jul 4, 2099 5:00 PM MDT.'),'2099-07-04T23:00:00.000Z');
 assert.equal(B.parseCloseDate('Project closes Dec 19, 2099 5:00 PM XYZ.'),null);
 assert.equal(B.parseCloseDate('Project closes Feb 30, 2099 5:00 PM MST.'),null);
 assert.equal(B.parseCloseDate('No closing line here.'),null);
 assert.equal(B.parseCloseDate('Project closes dec 19, 2099 5:00 pm mst.'),'2099-12-20T00:00:00.000Z');
 assert.equal(B.parseCloseDate(null),null);
});
test('RSS parsing requires a channel, unwraps CDATA, and plain text strips markup without executing it',()=>{
 const items=B.parseRss(RSS);assert.equal(items.length,4);assert.equal(items[0].link,'https://utah.bonfirehub.com/opportunities/12345');assert.ok(!items[0].description.includes('CDATA'));
 assert.throws(()=>B.parseRss('<html><body>not a feed</body></html>'),e=>e.status===503);
 assert.equal(B.plain('<p>Text &amp; source.</p><script>ignore</script>'), 'Text & source.');
});
test('normalization keeps unstated close dates, drops foreign links and undated items, and reads reference and agency from the text',()=>{
 const items=B.parseRss(RSS).map(B.normalize).filter(Boolean);assert.equal(items.length,3);
 const first=items.find(x=>x.id==='12345');assert.equal(first.provider,'bonfire');assert.equal(first.reference,'UT-26-001');assert.equal(first.title,'Fictional road resurfacing');assert.equal(first.agency,'Utah Department of Transportation');assert.equal(first.deadline,'2099-12-20T00:00:00.000Z');assert.equal(first.url,'https://utah.bonfirehub.com/opportunities/12345');
 const second=items.find(x=>x.id==='12346');assert.equal(second.deadline,null);
 assert.equal(B.normalize({link:'https://utah.bonfirehub.com/opportunities/12345',pubDate:'Mon, 16 Nov 2026 09:00:00 GMT',description:'Name: Title only Department: Utah Department of Transportation Description: Text.'}).title,'Title only');
 assert.equal(B.normalize({link:'https://utah.bonfirehub.com/opportunities/12345',pubDate:'not a date',description:'Name: Title only Department: Agency Description: Text.'}),null);
 assert.equal(B.normalize({link:'https://utah.bonfirehub.com/opportunities/12345',pubDate:'Mon, 16 Nov 2026 09:00:00 GMT',description:'Department: Agency Description: Text.'}),null);
});
function fixtureHarness(){
 const kb=require('../netlify/functions/lib/knowledge-base'),F=require('../netlify/functions/lib/free-tools');
 const saved={fetch:global.fetch,rpc:kb.rpc,db:F.db};
 const state={cache:{},admissions:[],calls:[],feed:RSS,status:200};
 F.db=async(c,path)=>{const m=path.match(/key=eq\.([^&]+)/);return m&&state.cache[m[1]]?[{body:state.cache[m[1]]}]:[];};
 kb.rpc=async(c,name,p)=>{if(name==='ft_admit'){state.admissions.push(p);return null;}if(name==='ft_cache_put'){state.cache[p.p_key]=p.p_body;return null;}throw Error('Unexpected RPC '+name);};
 global.fetch=async(url,o)=>{state.calls.push(url);assert.equal(url,B.FEED);assert.equal(o.redirect,'error');if(state.status!==200)return new Response('{}',{status:state.status});return new Response(state.feed,{headers:{'Content-Type':'application/rss+xml'}});};
 return {state,c:{},e:{headers:{'x-nf-client-connection-ip':'192.0.2.1'}},restore(){global.fetch=saved.fetch;kb.rpc=saved.rpc;F.db=saved.db;}};
}
test('search filters past and foreign notices, matches keyword across title, agency and reference, pages, caches, and admits under its own kind',async()=>{
 const h=fixtureHarness(),s=h.state;
 try{
  const first=await B.search(h.c,h.e,{});assert.equal(first.items.length,2);assert.equal(first.total,2);assert.equal(first.cached,false);assert.match(first.notice,/close date not stated/);assert.equal(s.calls.length,1);
  const second=await B.search(h.c,h.e,{});assert.equal(second.cached,true);assert.equal(s.calls.length,1);
  assert.equal((await B.search(h.c,h.e,{keyword:'road'})).items.length,1);
  assert.equal((await B.search(h.c,h.e,{keyword:'UT-26-002'})).items.length,1);
  assert.equal((await B.search(h.c,h.e,{keyword:'nonexistent'})).items.length,0);
  assert.ok(s.admissions.every(p=>p.p_kind==='bonfire'&&p.p_limit===10&&p.p_global===50));
  s.feed=feedWith(30);s.cache={};s.calls=[];
  const page0=await B.search(h.c,h.e,{});assert.equal(page0.items.length,25);assert.equal(page0.hasMore,true);assert.equal(page0.total,30);
  const page1=await B.search(h.c,h.e,{page:1});assert.equal(page1.items.length,5);assert.equal(page1.hasMore,false);assert.equal(s.calls.length,1);
 }finally{h.restore();}
});
test('a failed feed and bad inputs are rejected before any stale data is served',async()=>{
 const h=fixtureHarness(),s=h.state;
 try{
  s.status=503;await assert.rejects(B.search(h.c,h.e,{}),e=>e.status===503);s.status=200;
  for(const bad of [{keyword:'x'.repeat(101)},{page:-1},{page:10},{page:0.5}]){const before=s.calls.length;await assert.rejects(B.search(h.c,h.e,bad),e=>e.status===400);assert.equal(s.calls.length,before);}
 }finally{h.restore();}
});
test('detail returns the notice text, resolves by URL, caches, and 404s when the notice leaves the feed',async()=>{
 const h=fixtureHarness(),s=h.state;
 try{
  const d=await B.detail(h.c,h.e,'12345');assert.equal(d.item.title,'Fictional road resurfacing');assert.match(d.text,/Fictional solicitation text & details\./);assert.match(d.notice,/Attachments are not imported/);assert.equal(s.calls.length,1);
  const again=await B.detail(h.c,h.e,'https://utah.bonfirehub.com/opportunities/12345');assert.equal(again.cached,true);assert.equal(s.calls.length,1);
  s.cache={};await assert.rejects(B.detail(h.c,h.e,'99999'),e=>e.status===404);
 }finally{h.restore();}
});
test('handler routes search and detail and rejects unknown actions',async()=>{
 const h=fixtureHarness(),kb=require('../netlify/functions/lib/knowledge-base'),F=require('../netlify/functions/lib/free-tools'),handler=require('../netlify/functions/bonfire-opportunities').handler;
 const saved={enabled:F.enabled,configuration:kb.configuration};F.enabled=()=>true;kb.configuration=()=>h.c;
 try{
  const searchRes=await handler({httpMethod:'POST',headers:{'x-nf-client-connection-ip':'192.0.2.1'},body:JSON.stringify({action:'search',keyword:'',page:0})});assert.equal(searchRes.statusCode,200);assert.equal(JSON.parse(searchRes.body).items.length,2);
  const detailRes=await handler({httpMethod:'POST',headers:{'x-nf-client-connection-ip':'192.0.2.1'},body:JSON.stringify({action:'detail',notice:'12345'})});assert.equal(detailRes.statusCode,200);
  const bad=await handler({httpMethod:'POST',headers:{},body:JSON.stringify({action:'explode'})});assert.equal(bad.statusCode,400);
 }finally{F.enabled=saved.enabled;kb.configuration=saved.configuration;h.restore();}
});
