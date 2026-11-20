const {test}=require('node:test'),assert=require('node:assert/strict'),W=require('../netlify/functions/lib/webs-opportunities');
process.env.ANALYTICS_SIGNING_SECRET='fixture-only-signing-secret-at-least-32-characters';
const HTML=`<html><body><form><table cellspacing="0" border="0" id="DataGrid1" width="75%">
<tr class="GridHeader"><td>Solicitation Close Date/ Amendment Date</td><td>Title/Description</td><td>Contact</td></tr>
<tr class="grid_item"><td><div class="grid_item_td">12/19/99<br /><span id="DataGrid1__ctl3_lblAmendmentDate" class="lgtext-red"></span></div></td><td><a id="DataGrid1__ctl3_DetailsHyperlink" href="Search_BidDetails.aspx?ID=57676">EVC-Parks Window Repairs</a><br />Ref#:2026-529G (2-1)<br />Everett Community College-Parks Window Repairs<div id="DataGrid1__ctl3_SolicitationsUpdatePanel"><table class="width_90 margin_left_0"><tr><td><span>Includes an Inclusion Plan: </span><span>N</span></td></tr><tr><td><a id="DataGrid1__ctl3_AdditionalDataLinkButton" href="javascript:__doPostBack('x','')">Additional Data</a></td></tr></table></div></td><td><span class="grid_item_td">Brandon</span></td></tr>
<tr class="grid_item_alt"><td><div class="grid_item_td">07/04/99<br /><span id="DataGrid1__ctl4_lblAmendmentDate" class="lgtext-red">06/01/99</span></div></td><td><a id="DataGrid1__ctl4_DetailsHyperlink" href="Search_BidDetails.aspx?ID=54621">Market Search - SCC - Spokane Valley</a><br />Ref#:24-10-336<br />The State of Washington Spokane Community College is seeking space in the Spokane Valley area.<div id="DataGrid1__ctl4_SolicitationsUpdatePanel"><table class="width_90 margin_left_0"><tr><td><span>Includes an Inclusion Plan: </span><span>N</span></td></tr></table></div></td><td><span class="grid_item_td">Babette Babich</span></td></tr>
<tr class="grid_item"><td><div class="grid_item_td">11/10/01<br /></div></td><td><a id="DataGrid1__ctl5_DetailsHyperlink" href="Search_BidDetails.aspx?ID=99999">Past notice</a><br />Ref#:OLD-1<br />Past notice text.<div id="DataGrid1__ctl5_SolicitationsUpdatePanel"><table class="width_90 margin_left_0"></table></div></td><td><span class="grid_item_td">Nobody</span></td></tr>
<tr class="grid_item_alt"><td><div class="grid_item_td">12/20/99<br /></div></td><td><a id="DataGrid1__ctl6_DetailsHyperlink" href="Search_BidDetails.aspx?ID=22222">No reference notice</a><br />No Ref# line here.<div id="DataGrid1__ctl6_SolicitationsUpdatePanel"><table class="width_90 margin_left_0"></table></div></td><td><span class="grid_item_td">Nobody</span></td></tr>
<tr class="grid_item"><td><div class="grid_item_td">TBD<br /></div></td><td><a id="DataGrid1__ctl7_DetailsHyperlink" href="Search_BidDetails.aspx?ID=11111">No date notice</a><br />Ref#:NODATE-1<br />No closing date stated here.<div id="DataGrid1__ctl7_SolicitationsUpdatePanel"><table class="width_90 margin_left_0"></table></div></td><td><span class="grid_item_td">Nobody</span></td></tr>
</table></form></body></html>`;
test('webs identity rejects foreign hosts, ports, credentials and bad ids',()=>{
 assert.equal(W.websId('57676'),'57676');
 assert.equal(W.websId('https://pr-webs-vendor.des.wa.gov/Search_BidDetails.aspx?ID=57676'),'57676');
 for(const value of ['https://evil.invalid/Search_BidDetails.aspx?ID=57676','http://pr-webs-vendor.des.wa.gov/Search_BidDetails.aspx?ID=57676','https://pr-webs-vendor.des.wa.gov:444/Search_BidDetails.aspx?ID=57676','https://pr-webs-vendor.des.wa.gov/Search_BidDetails.aspx','https://pr-webs-vendor.des.wa.gov/Search_BidDetails.aspx?ID=abc','https://pr-webs-vendor.des.wa.gov/bidcalendar.aspx','1234567890123',''])assert.throws(()=>W.websId(value),e=>e.status===400);
});
test('close dates are end of day Pacific, respect DST boundaries, and reject invalid dates',()=>{
 assert.equal(W.parseCloseDate('12/19/99'),'2099-12-20T07:59:59.000Z');
 assert.equal(W.parseCloseDate('01/15/99'),'2099-01-16T07:59:59.000Z');
 assert.equal(W.parseCloseDate('07/04/99'),'2099-07-05T06:59:59.000Z');
 assert.equal(W.parseCloseDate('03/07/99'),'2099-03-08T07:59:59.000Z');
 assert.equal(W.parseCloseDate('03/08/99'),'2099-03-09T06:59:59.000Z');
 assert.equal(W.parseCloseDate('10/31/99'),'2099-11-01T06:59:59.000Z');
 assert.equal(W.parseCloseDate('11/01/99'),'2099-11-02T07:59:59.000Z');
 assert.equal(W.parseCloseDate('02/30/99'),null);
 assert.equal(W.parseCloseDate('13/01/99'),null);
 assert.equal(W.parseCloseDate('11/19/2026'),null);
 assert.equal(W.parseCloseDate('not a date'),null);
 assert.equal(W.parseCloseDate(null),null);
});
test('calendar parsing reads the real DataGrid1 structure, drops rows without a Ref#, and fails closed without it',()=>{
 const rows=W.parseCalendar(HTML);assert.equal(rows.length,4);
 const first=rows.find(x=>x.id==='57676');assert.equal(first.title,'EVC-Parks Window Repairs');assert.equal(first.reference,'2026-529G (2-1)');assert.equal(first.closeText,'12/19/99');assert.equal(first.description,'Everett Community College-Parks Window Repairs');assert.equal(first.contact,'Brandon');assert.equal(first.url,'https://pr-webs-vendor.des.wa.gov/Search_BidDetails.aspx?ID=57676');
 const second=rows.find(x=>x.id==='54621');assert.equal(second.closeText,'07/04/99');assert.equal(second.contact,'Babette Babich');assert.match(second.description,/Spokane Community College/);
 const nodate=rows.find(x=>x.id==='11111');assert.equal(nodate.closeText,null);
 assert.equal(rows.find(x=>x.id==='22222'),undefined);
 assert.throws(()=>W.parseCalendar('<html><body>not a calendar</body></html>'),e=>e.status===503);
 assert.throws(()=>W.parseCalendar('<table id="DataGrid1"></table>'),e=>e.status===503);
 assert.equal(W.plain('<p>Text &amp; source.</p><script>ignore</script>'),'Text & source.');
 assert.equal(W.parseRow('<td><div>11/20/99</div></td><td><a id="x_DetailsHyperlink" href="Search_BidDetails.aspx?ID=57602">WSP IFB EO247036\n   BMW R 1300 RT-P</a><br />Ref#:IFB EO247036<br />Desc.<div id="x_SolicitationsUpdatePanel"></div></td><td><span>Erica Oswalt</span></td>').title,'WSP IFB EO247036 BMW R 1300 RT-P');
});
test('normalization keeps unstated close dates and drops bad ids and empty titles',()=>{
 const rows=W.parseCalendar(HTML).map(W.normalize).filter(Boolean);assert.equal(rows.length,4);
 const first=rows.find(x=>x.id==='57676');assert.equal(first.provider,'webs');assert.equal(first.agency,'Agency not supplied');assert.equal(first.posted,null);assert.equal(first.deadline,'2099-12-20T07:59:59.000Z');assert.equal(first.contact,'Brandon');
 const nodate=rows.find(x=>x.id==='11111');assert.equal(nodate.deadline,null);
 assert.equal(W.normalize({id:'57676',title:'',reference:'X',closeText:'12/19/99',description:'',contact:null,url:W.DETAILS+'57676'}),null);
 assert.equal(W.normalize({id:'abc',title:'T',reference:'X',closeText:'12/19/99',description:'',contact:null,url:W.DETAILS+'57676'}),null);
});
function fixtureHarness(){
 const kb=require('../netlify/functions/lib/knowledge-base'),F=require('../netlify/functions/lib/free-tools');
 const saved={fetch:global.fetch,rpc:kb.rpc,db:F.db};
 const state={cache:{},admissions:[],calls:[],feed:HTML,status:200};
 F.db=async(c,path)=>{const m=path.match(/key=eq\.([^&]+)/);return m&&state.cache[m[1]]?[{body:state.cache[m[1]]}]:[];};
 kb.rpc=async(c,name,p)=>{if(name==='ft_admit'){state.admissions.push(p);return null;}if(name==='ft_cache_put'){state.cache[p.p_key]=p.p_body;return null;}throw Error('Unexpected RPC '+name);};
 global.fetch=async(url,o)=>{state.calls.push(url);assert.equal(url,W.CALENDAR);assert.equal(o.redirect,'error');if(state.status!==200)return new Response('{}',{status:state.status});return new Response(state.feed,{headers:{'Content-Type':'text/html'}});};
 return {state,c:{},e:{headers:{'x-nf-client-connection-ip':'192.0.2.1'}},restore(){global.fetch=saved.fetch;kb.rpc=saved.rpc;F.db=saved.db;}};
}
test('search filters past notices, sorts soonest-closing first, matches keyword across title, reference and description, pages, caches, and admits under its own kind',async()=>{
 const h=fixtureHarness(),s=h.state;
 try{
  const first=await W.search(h.c,h.e,{});assert.equal(first.items.length,3);assert.equal(first.total,3);assert.equal(first.cached,false);assert.match(first.notice,/soonest-closing first/);assert.match(first.notice,/free WEBS login/);assert.equal(s.calls.length,1);
  assert.equal(first.items[0].id,'54621');assert.equal(first.items[1].id,'57676');assert.equal(first.items[2].id,'11111');
  const second=await W.search(h.c,h.e,{});assert.equal(second.cached,true);assert.equal(s.calls.length,1);
  assert.equal((await W.search(h.c,h.e,{keyword:'everett'})).items.length,1);
  assert.equal((await W.search(h.c,h.e,{keyword:'spokane'})).items.length,1);
  assert.equal((await W.search(h.c,h.e,{keyword:'NODATE-1'})).items.length,1);
  assert.equal((await W.search(h.c,h.e,{keyword:'nonexistent'})).items.length,0);
  assert.ok(s.admissions.every(p=>p.p_kind==='webs'&&p.p_limit===10&&p.p_global===50));
 }finally{h.restore();}
});
test('a failed calendar and bad inputs are rejected before any stale data is served',async()=>{
 const h=fixtureHarness(),s=h.state;
 try{
  s.status=503;await assert.rejects(W.search(h.c,h.e,{}),e=>e.status===503);s.status=200;
  for(const bad of [{keyword:'x'.repeat(101)},{page:-1},{page:10},{page:0.5}]){const before=s.calls.length;await assert.rejects(W.search(h.c,h.e,bad),e=>e.status===400);assert.equal(s.calls.length,before);}
 }finally{h.restore();}
});
test('detail returns the calendar summary, resolves by URL, caches, discloses the login need, and 404s when the notice leaves the calendar',async()=>{
 const h=fixtureHarness(),s=h.state;
 try{
  const d=await W.detail(h.c,h.e,'57676');assert.equal(d.item.title,'EVC-Parks Window Repairs');assert.match(d.text,/Everett Community College-Parks Window Repairs/);assert.match(d.text,/2026-529G/);assert.match(d.notice,/free WEBS login/);assert.equal(s.calls.length,1);
  const again=await W.detail(h.c,h.e,'https://pr-webs-vendor.des.wa.gov/Search_BidDetails.aspx?ID=57676');assert.equal(again.cached,true);assert.equal(s.calls.length,1);
  s.cache={};await assert.rejects(W.detail(h.c,h.e,'99998'),e=>e.status===404);
 }finally{h.restore();}
});
test('handler routes search and detail and rejects unknown actions',async()=>{
 const h=fixtureHarness(),kb=require('../netlify/functions/lib/knowledge-base'),F=require('../netlify/functions/lib/free-tools'),handler=require('../netlify/functions/webs-opportunities').handler;
 const saved={enabled:F.enabled,configuration:kb.configuration};F.enabled=()=>true;kb.configuration=()=>h.c;
 try{
  const searchRes=await handler({httpMethod:'POST',headers:{'x-nf-client-connection-ip':'192.0.2.1'},body:JSON.stringify({action:'search',keyword:'',page:0})});assert.equal(searchRes.statusCode,200);assert.equal(JSON.parse(searchRes.body).items.length,3);
  const detailRes=await handler({httpMethod:'POST',headers:{'x-nf-client-connection-ip':'192.0.2.1'},body:JSON.stringify({action:'detail',notice:'57676'})});assert.equal(detailRes.statusCode,200);
  const bad=await handler({httpMethod:'POST',headers:{},body:JSON.stringify({action:'explode'})});assert.equal(bad.statusCode,400);
 }finally{F.enabled=saved.enabled;kb.configuration=saved.configuration;h.restore();}
});
