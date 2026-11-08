const {test}=require('node:test'),assert=require('node:assert/strict'),NYC=require('../netlify/functions/lib/nyc-opportunities');
process.env.ANALYTICS_SIGNING_SECRET='fixture-only-signing-secret-at-least-32-characters';
const metadata={id:'dg92-zbpx',rowsUpdatedAt:Math.floor(Date.now()/1000),columns:Object.entries({RequestID:['requestid','text'],ShortTitle:['shorttitle','text'],AgencyName:['agencyname','text'],EventDate:['eventdate','calendar_date'],DueDate:['duedate','calendar_date'],SectionName:['sectionname','text'],TypeOfNoticeDescription:['typeofnoticedescription','text'],CategoryDescription:['categorydescription','text'],AdditionalDescription1:['additionaldescription1','text']}).map(([name,[fieldName,dataTypeName]])=>({name,fieldName,dataTypeName}))};
function notice(id='99999999999'){return {id,title:'Fictional NYC test solicitation',agency:'Fictional public agency',posted:'2026-11-01T00:00:00.000',deadline:'2099-12-01T14:00:00.000',section:'Procurement',notice_type:'Solicitation',category:'Services',description1:'<p>Fictional source description.</p><script>not executable</script>'};}
test('NYC notice identity rejects foreign hosts, credentials, ports, path tricks and query injection',()=>{
 const id='99999999999';assert.equal(NYC.noticeId(id),id);assert.equal(NYC.noticeId('https://a856-cityrecord.nyc.gov/RequestDetail/'+id),id);
 for(const value of ['https://evil.invalid/RequestDetail/'+id,'http://a856-cityrecord.nyc.gov/RequestDetail/'+id,'https://user:pass@a856-cityrecord.nyc.gov/RequestDetail/'+id,'https://a856-cityrecord.nyc.gov:444/RequestDetail/'+id,'https://a856-cityrecord.nyc.gov/RequestDetail/../admin',"x' OR 1=1",'https://a856-cityrecord.nyc.gov/RequestDetail/x%2fy'])assert.throws(()=>NYC.noticeId(value),e=>e.status===400);
});
test('metadata maps publisher columns, requires date semantics and rejects unsafe identifiers',()=>{
 const result=NYC.schema(metadata);assert.equal(result.columns.deadline,'duedate');assert.equal(result.idType,'text');assert.ok(result.sourceUpdatedAt);
 for(const changed of [{...metadata,id:'wrong'},{...metadata,columns:metadata.columns.filter(x=>x.name!=='DueDate')},{...metadata,columns:metadata.columns.map(x=>x.name==='DueDate'?{...x,dataTypeName:'text'}:x)},{...metadata,columns:metadata.columns.map(x=>x.name==='ShortTitle'?{...x,fieldName:'title) OR true'}:x)}])assert.throws(()=>NYC.schema(changed),e=>e.status===503);
 assert.equal(NYC.nycDay(new Date('2026-11-08T02:00:00Z')),'2026-11-07');assert.equal(NYC.nycDay(new Date('2026-03-08T08:00:00Z')),'2026-03-08');
});
test('normalization rejects awards, wrong sections, missing or invalid dates and preserves source identity',()=>{
 const n=NYC.normalize(notice());assert.equal(n.provider,'nyc');assert.equal(n.url,'https://a856-cityrecord.nyc.gov/RequestDetail/99999999999');assert.equal(n.deadlineTimezone,'America/New_York');assert.ok(!('email'in n));
 for(const change of [{notice_type:'Award'},{notice_type:'Intent to Award'},{section:'Public Hearings'},{deadline:''},{deadline:'2026-02-30T00:00:00'},{deadline:'2026-11-08T00:00:00Z'},{title:''}])assert.equal(NYC.normalize({...notice(),...change}),null);
 assert.equal(NYC.plain('<p>Text &amp; source.</p><script>ignore</script>'), 'Text & source.');
});
test('NYC cache, pagination, fixed upstream query, separate budget and attachment fallback work together',async()=>{
 const kb=require('../netlify/functions/lib/knowledge-base'),saved={fetch:global.fetch,rpc:kb.rpc,enabled:process.env.NYC_OPPORTUNITIES_ENABLED};process.env.NYC_OPPORTUNITIES_ENABLED='true';
 const cache=new Map(),calls=[],admissions=[];let responseRows=Array.from({length:26},(_,i)=>notice('9999999'+String(i).padStart(4,'0')));
 kb.rpc=async(c,name,p)=>{if(name==='ft_cache_put'){cache.set(p.p_key,p.p_body);return null;}if(name==='ft_admit'){admissions.push(p);return null;}throw Error('Unexpected RPC');};
 global.fetch=async(url,o={})=>{const u=new URL(url);if(u.hostname==='database.invalid'){const body=cache.get(u.searchParams.get('key')?.replace('eq.',''));return new Response(JSON.stringify(body?[{body}]:[]),{status:200});}assert.equal(u.origin,'https://data.cityofnewyork.us');assert.equal(o.redirect,'error');calls.push(u);if(u.pathname.startsWith('/api/views/'))return new Response(JSON.stringify(metadata),{status:200});assert.equal(u.pathname,'/resource/dg92-zbpx.json');return new Response(JSON.stringify(responseRows),{status:200});};
 const c={url:'https://database.invalid',serviceKey:'fixture'},event={headers:{'x-nf-client-connection-ip':'192.0.2.1'}};
 try{
  const keyword="O'Brien % _",r=await NYC.search(c,event,{keyword,page:0});assert.equal(r.items.length,25);assert.equal(r.hasMore,true);assert.equal(calls.length,2);const params=calls[1].searchParams;assert.equal(params.get('$q'),keyword);assert.ok(!params.get('$where').includes("O'Brien"));assert.match(params.get('$where'),/PROCUREMENT/);assert.match(params.get('$where'),/SOLICITATION/);assert.equal(params.get('$limit'),'26');assert.equal(params.get('$offset'),'0');assert.ok(admissions.every(x=>x.p_kind==='nyc'&&x.p_limit===10&&x.p_global===50));
  const repeated=await NYC.search(c,event,{keyword,page:0});assert.equal(repeated.cached,true);assert.equal(calls.length,2);
  responseRows=[notice()];const d=await NYC.detail(c,event,'99999999999');assert.equal(d.text,'Fictional source description.');assert.match(d.notice,/Attachments are not imported/);assert.ok(!JSON.stringify(d).includes('not executable'));assert.match(calls.at(-1).searchParams.get('$where'),/requestid = '99999999999'/);
  responseRows=[{...notice('empty-fixture'),description1:''}];const empty=await NYC.detail(c,event,'empty-fixture');assert.equal(empty.text,'');assert.match(empty.notice,/Attachments are not imported/);
  responseRows=[{...notice('long-fixture'),description1:'x'.repeat(100001)}];const long=await NYC.detail(c,event,'long-fixture');assert.equal(long.text,'');assert.match(long.notice,/exceeds the tool input limit/);
  await assert.rejects(NYC.detail(c,event,'missing-fixture'),e=>e.status===404);
 }finally{global.fetch=saved.fetch;kb.rpc=saved.rpc;if(saved.enabled===undefined)delete process.env.NYC_OPPORTUNITIES_ENABLED;else process.env.NYC_OPPORTUNITIES_ENABLED=saved.enabled;}
});
test('disabled NYC source makes no upstream call and no new feed requires a secret',async()=>{
 const saved={fetch:global.fetch,enabled:process.env.NYC_OPPORTUNITIES_ENABLED};let calls=0;delete process.env.NYC_OPPORTUNITIES_ENABLED;global.fetch=async()=>{calls++;throw Error('Unexpected request');};
 try{await assert.rejects(NYC.search({}, {}, {}),e=>e.status===503);assert.equal(calls,0);}finally{global.fetch=saved.fetch;if(saved.enabled===undefined)delete process.env.NYC_OPPORTUNITIES_ENABLED;else process.env.NYC_OPPORTUNITIES_ENABLED=saved.enabled;}
});
