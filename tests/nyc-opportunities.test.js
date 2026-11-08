const {test}=require('node:test'),assert=require('node:assert/strict'),NYC=require('../netlify/functions/lib/nyc-opportunities');
process.env.ANALYTICS_SIGNING_SECRET='fixture-only-signing-secret-at-least-32-characters';
const metadata={id:'dg92-zbpx',licenseId:'PUBLIC_DOMAIN',attribution:'NYC Open Data fictional fixture',rowsUpdatedAt:Math.floor(Date.now()/1000),columns:Object.entries({RequestID:['requestid','text'],ShortTitle:['shorttitle','text'],AgencyName:['agencyname','text'],StartDate:['startdate','calendar_date'],EventDate:['eventdate','calendar_date'],DueDate:['duedate','calendar_date'],SectionName:['sectionname','text'],TypeOfNoticeDescription:['typeofnoticedescription','text'],CategoryDescription:['categorydescription','text'],AdditionalDescription1:['additionaldescription1','text']}).map(([name,[fieldName,dataTypeName]])=>({name,fieldName,dataTypeName}))};
function notice(id='99999999999'){return {id,title:'Fictional NYC test solicitation',agency:'Fictional public agency',posted:'2026-11-01T00:00:00.000',deadline:'2099-12-01T14:00:00.000',section:'Procurement',notice_type:'Solicitation',category:'Services',description1:'<p>Fictional source description.</p><script>not executable</script>'};}
test('NYC notice identity rejects foreign hosts, credentials, ports, path tricks and query injection',()=>{
 const id='99999999999';assert.equal(NYC.noticeId(id),id);assert.equal(NYC.noticeId('https://a856-cityrecord.nyc.gov/RequestDetail/'+id),id);
 for(const value of ['https://evil.invalid/RequestDetail/'+id,'http://a856-cityrecord.nyc.gov/RequestDetail/'+id,'https://user:pass@a856-cityrecord.nyc.gov/RequestDetail/'+id,'https://a856-cityrecord.nyc.gov:444/RequestDetail/'+id,'https://a856-cityrecord.nyc.gov/RequestDetail/../admin',"x' OR 1=1",'https://a856-cityrecord.nyc.gov/RequestDetail/x%2fy'])assert.throws(()=>NYC.noticeId(value),e=>e.status===400);
});
test('metadata maps publisher columns, requires date semantics and rejects unsafe identifiers',()=>{
 const result=NYC.schema(metadata);assert.equal(result.columns.deadline,'duedate');assert.equal(result.columns.posted,'startdate');assert.equal(result.idType,'text');assert.ok(result.sourceUpdatedAt);
 for(const changed of [{...metadata,licenseId:'UNKNOWN'},{...metadata,id:'wrong'},{...metadata,columns:metadata.columns.filter(x=>x.name!=='DueDate')},{...metadata,columns:metadata.columns.map(x=>x.name==='DueDate'?{...x,dataTypeName:'text'}:x)},{...metadata,columns:metadata.columns.map(x=>x.name==='ShortTitle'?{...x,fieldName:'title) OR true'}:x)}])assert.throws(()=>NYC.schema(changed),e=>e.status===503);
 assert.equal(NYC.nycDay(new Date('2026-11-08T02:00:00Z')),'2026-11-07');assert.equal(NYC.nycDay(new Date('2026-03-08T08:00:00Z')),'2026-03-08');
});
test('normalization rejects awards, wrong sections, missing or invalid dates and preserves source identity',()=>{
 const n=NYC.normalize(notice());assert.equal(n.provider,'nyc');assert.equal(n.url,'https://a856-cityrecord.nyc.gov/RequestDetail/99999999999');assert.equal(n.deadlineTimezone,'America/New_York');assert.ok(!('email'in n));
 for(const change of [{notice_type:'Award'},{notice_type:'Intent to Award'},{section:'Public Hearings'},{deadline:''},{deadline:'2026-02-30T00:00:00'},{deadline:'2026-11-08T00:00:00Z'},{title:''}])assert.equal(NYC.normalize({...notice(),...change}),null);
 assert.equal(NYC.plain('<p>Text &amp; source.</p><script>ignore</script>'), 'Text & source.');
});
test('disabled NYC source makes no upstream call and no new feed requires a secret',async()=>{
 const saved={fetch:global.fetch,enabled:process.env.NYC_OPPORTUNITIES_ENABLED};let calls=0;delete process.env.NYC_OPPORTUNITIES_ENABLED;global.fetch=async()=>{calls++;throw Error('Unexpected request');};
 try{await assert.rejects(NYC.search({}, {}, {}),e=>e.status===503);assert.equal(calls,0);}finally{global.fetch=saved.fetch;if(saved.enabled===undefined)delete process.env.NYC_OPPORTUNITIES_ENABLED;else process.env.NYC_OPPORTUNITIES_ENABLED=saved.enabled;}
});
test('verified publisher schema uses numeric request IDs and publication StartDate, never hearing EventDate',()=>{
 const metadata=require('./fixtures/nyc-column-metadata.json'),m=NYC.schema(metadata);assert.equal(m.idType,'number');assert.equal(m.columns.id,'request_id');assert.equal(m.columns.posted,'start_date');assert.notEqual(m.columns.posted,'event_date');assert.equal(m.license,'PUBLIC_DOMAIN');assert.equal(m.publisher,'Department of Citywide Administrative Services (DCAS)');
});
function fixtureHarness(){
 const kb=require('../netlify/functions/lib/knowledge-base'),F=require('../netlify/functions/lib/free-tools');
 const saved={fetch:global.fetch,rpc:kb.rpc,db:F.db,enabled:process.env.NYC_OPPORTUNITIES_ENABLED};
 const state={body:null,claimed:true,rows:[notice()],calls:[],admissions:[],status:200,license:'PUBLIC_DOMAIN',networkFailure:false};
 process.env.NYC_OPPORTUNITIES_ENABLED='true';
 F.db=async(c,path,o={})=>{if(o.method==='DELETE'){state.body=null;return [];}return state.body?[{body:state.body}]:[];};
 kb.rpc=async(c,name,p)=>{if(name==='ft_nyc_claim')return state.claimed;if(name==='ft_nyc_store'){state.body=p.p_body;return null;}if(name==='ft_admit'){state.admissions.push(p);return null;}throw Error('Unexpected RPC '+name);};
 global.fetch=async(url,o)=>{const u=new URL(url);state.calls.push(u);assert.equal(u.origin,'https://data.cityofnewyork.us');assert.equal(o.redirect,'error');if(state.networkFailure)throw Error('Fictional temporary network failure');if(state.status!==200)return new Response('{}',{status:state.status,headers:state.retryAfter?{'Retry-After':state.retryAfter}:{}});return new Response(JSON.stringify(u.pathname.startsWith('/api/views/')?{...metadata,licenseId:state.license}:state.rows));};
 return {state,c:{},e:{headers:{'x-nf-client-connection-ip':'192.0.2.1'}},restore(){global.fetch=saved.fetch;kb.rpc=saved.rpc;F.db=saved.db;if(saved.enabled===undefined)delete process.env.NYC_OPPORTUNITIES_ENABLED;else process.env.NYC_OPPORTUNITIES_ENABLED=saved.enabled;}};
}
test('one snapshot supports keyword, pagination and all detail handoffs without more upstream requests',async()=>{
 const h=fixtureHarness(),s=h.state;s.rows=Array.from({length:30},(_,i)=>({...notice(String(99999999000+i)),title:i===0?"Fictional O'Brien services":'Fictional NYC notice '+i}));
 try{
  const first=await NYC.search(h.c,h.e,{});assert.equal(first.items.length,25);assert.equal(first.hasMore,true);assert.equal(first.total,30);assert.equal(s.calls.length,2);
  const params=s.calls[1].searchParams;assert.equal(params.get('$limit'),'1001');assert.equal(params.has('$order'),false);assert.equal(params.has('$q'),false);assert.match(params.get('$where'),/Procurement/);
  const second=await NYC.search(h.c,h.e,{page:1});assert.equal(second.items.length,5);assert.equal(second.hasMore,false);assert.equal(second.cached,true);
  const keyword=await NYC.search(h.c,h.e,{keyword:"O'Brien"});assert.equal(keyword.items.length,1);assert.equal((await NYC.search(h.c,h.e,{keyword:"' OR 1=1"})).items.length,0);
  const detail=await NYC.detail(h.c,h.e,'99999999000');assert.equal(detail.text,'Fictional source description.');assert.match(detail.notice,/Attachments are not imported/);assert.equal(s.calls.length,2);assert.ok(s.admissions.every(p=>p.p_kind==='nyc'&&p.p_limit===100&&p.p_global===200));
 }finally{h.restore();}
});
test('stale snapshots survive temporary failures, exclude expired notices and stop at 24 hours',async()=>{
 const h=fixtureHarness(),s=h.state;
 try{
  await NYC.search(h.c,h.e,{});s.body.checkedAt=new Date(Date.now()-2*3600000).toISOString();s.body.records.push({...notice('expired'),deadline:'2001-01-01T00:00:00.000'});s.status=503;
  const fallback=await NYC.search(h.c,h.e,{});assert.equal(fallback.stale,true);assert.equal(fallback.items.length,1);assert.match(fallback.notice,/last successful snapshot/);assert.equal(s.calls.length,4);
  s.claimed=false;const before=s.calls.length;assert.equal((await NYC.detail(h.c,h.e,'99999999999')).stale,true);assert.equal(s.calls.length,before);
  s.body.checkedAt=new Date(Date.now()-25*3600000).toISOString();await assert.rejects(NYC.search(h.c,h.e,{}),e=>e.status===503);assert.equal(s.calls.length,before);
  s.claimed=true;s.status=200;s.license='UNKNOWN';s.body.checkedAt=new Date(Date.now()-2*3600000).toISOString();await assert.rejects(NYC.search(h.c,h.e,{}),e=>e.status===503);assert.equal(s.body,null,'license/schema failure must invalidate fallback');
 }finally{h.restore();}
});
test('snapshot descriptions preserve empty/oversized fallback and reject incomplete coverage',async()=>{
 const h=fixtureHarness(),s=h.state;s.rows=[{...notice('empty'),description1:''},{...notice('long'),description1:'x'.repeat(100001)}, {...notice('invalid'),deadline:''}];
 try{
  const list=await NYC.search(h.c,h.e,{});assert.equal(list.omittedCount,1);assert.equal(list.items.length,2);
  assert.equal((await NYC.detail(h.c,h.e,'empty')).text,'');const long=await NYC.detail(h.c,h.e,'long');assert.equal(long.text,'');assert.match(long.notice,/exceeds the tool input limit/);
  await assert.rejects(NYC.detail(h.c,h.e,'missing'),e=>e.status===404);
  s.body=null;s.rows=Array.from({length:1001},()=>notice());await assert.rejects(NYC.search(h.c,h.e,{}),e=>e.status===503);
 }finally{h.restore();}
});
test('network and transient retries are bounded; quota, access denials and long Retry-After do not retry',async()=>{
 const h=fixtureHarness(),s=h.state;
 try{
  for(const status of [503,429,403]){s.status=status;s.calls=[];await assert.rejects(NYC.search(h.c,h.e,{}),e=>e.status===(status===429?429:503));assert.equal(s.calls.length,status===503?2:1);}
  s.status=503;s.retryAfter='30';s.calls=[];await assert.rejects(NYC.search(h.c,h.e,{}));assert.equal(s.calls.length,1);
  s.networkFailure=true;s.calls=[];await assert.rejects(NYC.search(h.c,h.e,{}));assert.equal(s.calls.length,2);
  s.networkFailure=false;s.status=200;s.claimed=false;s.calls=[];await assert.rejects(NYC.search(h.c,h.e,{}),e=>/refreshing/.test(e.message));assert.equal(s.calls.length,0);
 }finally{h.restore();}
});
