const kb = require('./knowledge-base');
const F = require('./free-tools');
const DATASET = 'dg92-zbpx';
const API = 'https://data.cityofnewyork.us';
const SOURCE = 'https://data.cityofnewyork.us/d/' + DATASET;
const NOTICE = 'https://a856-cityrecord.nyc.gov/RequestDetail/';
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const FIELD = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const DAYS = 86400000;
const MAX_RESPONSE = 2 * 1024 * 1024;
const SNAPSHOT_KEY = 'nyc:snapshot:v1';
const HOUR = 3600000;
function transient(message, status=503) {const error=new Error(message);error.status=status;error.transient=true;throw error;}
function invalidSource(message) {const error=new Error(message);error.status=503;error.invalidSource=true;throw error;}
const ALIASES = {
 id: ['requestid'], title: ['shorttitle'], agency: ['agencyname'], posted: ['startdate'],
 deadline: ['duedate'], section: ['sectionname'], noticeType: ['typeofnoticedescription'],
 category: ['categorydescription'], description1: ['additionaldescription1'],
 description2: ['additionaldescription2', 'additionaldesctription2'], description3: ['additionaldescription3'],
 other1: ['otherinfo1'], other2: ['otherinfo2'], other3: ['otherinfo3']
};
const REQUIRED = ['id', 'title', 'agency', 'posted', 'deadline', 'section', 'noticeType'];
function enabled() {return process.env.NYC_OPPORTUNITIES_ENABLED === 'true';}
function available() {if (!enabled()) kb.fail(503, 'NYC opportunities are temporarily unavailable. Federal opportunities remain available.');}
function noticeId(value) {
 if (typeof value !== 'string') kb.fail(400, 'Enter an original NYC City Record notice URL or request ID.');
 if (ID.test(value)) return value;
 let u;try {u = new URL(value);} catch {kb.fail(400, 'Use an original NYC City Record notice URL.');}
 const match = u.pathname.match(/^\/RequestDetail\/([A-Za-z0-9_-]{1,64})\/?$/);
 if (u.protocol !== 'https:' || u.hostname !== 'a856-cityrecord.nyc.gov' || u.username || u.password || u.port || !match) kb.fail(400, 'Use an original NYC City Record notice URL.');
 return match[1];
}
function nycDay(now = new Date()) {return new Intl.DateTimeFormat('en-CA', {timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'}).format(now);}
function updatedAt(value) {
 if (typeof value !== 'number' || !Number.isFinite(value)) return null;
 const time = value > 1e12 ? value : value * 1000;
 if (time < Date.UTC(2000, 0, 1) || time > Date.now() + DAYS) return null;
 return new Date(time).toISOString();
}
function schema(metadata) {
 if(metadata?.licenseId!=='PUBLIC_DOMAIN')invalidSource('NYC dataset reuse terms need review before notices can be displayed.');
 if (metadata?.id !== DATASET || !Array.isArray(metadata.columns)) invalidSource('NYC Open Data returned an unsupported dataset description. No notices are implied.');
 const columns = {};
 for (const [key, aliases] of Object.entries(ALIASES)) {
  const column = metadata.columns.find(c => aliases.includes(String(c.name || '').replace(/[^a-z0-9]/gi, '').toLowerCase()) || aliases.includes(String(c.fieldName || '').replace(/[^a-z0-9]/gi, '').toLowerCase()));
  if (column && FIELD.test(column.fieldName || '')) columns[key] = column.fieldName;
 }
 if (REQUIRED.some(k => !columns[k])) invalidSource('NYC Open Data fields have changed. No notices are implied.');
 for (const key of ['posted', 'deadline']) {
  const column = metadata.columns.find(c => c.fieldName === columns[key]);
  if (!['calendar_date', 'floating_timestamp', 'date'].includes(column.dataTypeName)) invalidSource('NYC notice date fields need review before they can be displayed.');
 }
 const idType=metadata.columns.find(c=>c.fieldName===columns.id).dataTypeName;
 if(!['text','number'].includes(idType))invalidSource('NYC request IDs need review before they can be displayed.');
 return {columns,idType,license:'PUBLIC_DOMAIN',publisher:typeof metadata.attribution==='string'?metadata.attribution.slice(0,300):'NYC Open Data', sourceUpdatedAt: updatedAt(metadata.rowsUpdatedAt), dataset: SOURCE};
}
async function upstream(config, event, path, params) {
 const url = new URL(path, API);if (params) url.search = params.toString();
 let response;
 for(let attempt=0;attempt<2;attempt++){
  // nycScheduled is set only by the native scheduled entry point, never from HTTP input.
  const caller=event.nycScheduled===true?F.mac(new Date().toISOString().slice(0,10)+':nyc-scheduled-refresh'):F.ip(event);
  try {await kb.rpc(config, 'ft_admit', {p_ip: caller, p_kind: 'nyc', p_limit: 100, p_global: 200});}
  catch(error){if(error.status===429)error.transient=true;throw error;}
  const remaining=(event.nycRequestDeadline||Date.now()+8000)-Date.now();
  if(remaining<=0)transient('NYC Open Data could not finish this request in time. Please retry later.');
  try {response=await fetch(url,{headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(Math.min(8000,remaining))});}
  catch{if(attempt===0&&Date.now()+1000<(event.nycRequestDeadline||Infinity)){await new Promise(resolve=>setTimeout(resolve,300));continue;}transient('NYC Open Data could not be reached. Please retry later or visit City Record Online.');}
  const retryAfter=response.headers.get('retry-after');
  const wait=retryAfter===null?300:/^\d+$/.test(retryAfter)?Number(retryAfter)*1000:Math.max(0,Date.parse(retryAfter)-Date.now());
  if(attempt===0&&[502,503,504].includes(response.status)&&Number.isFinite(wait)&&wait<=1000&&Date.now()+wait+1000<(event.nycRequestDeadline||Infinity)){
   await response.body?.cancel();await new Promise(resolve=>setTimeout(resolve,wait));continue;
  }
  break;
 }
 if (!response.ok) {const message='NYC Open Data could not return notices right now (HTTP '+response.status+'). Please retry later or visit City Record Online.';if([401,403,404].includes(response.status))invalidSource(message);if([429,500,502,503,504].includes(response.status))transient(message,response.status===429?429:503);kb.fail(503,message);}
 if (Number(response.headers.get('content-length')) > MAX_RESPONSE) kb.fail(503, 'The NYC response exceeded the supported size. Visit the original source.');
 let text;try{text=await response.text();}catch{transient('NYC Open Data response was interrupted. Please retry later.');}if (Buffer.byteLength(text) > MAX_RESPONSE) kb.fail(503, 'The NYC response exceeded the supported size. Visit the original source.');
 try {return JSON.parse(text);} catch {kb.fail(503, 'NYC Open Data returned an unsupported response. No notices are implied.');}
}
function dateValue(value) {
 if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)?$/.test(value) || !Number.isFinite(Date.parse(value))) return null;
 if(new Date(value.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)!==value.slice(0,10))return null;
 return value;
}
function normalize(row) {
 const id = typeof row.id === 'number' && Number.isSafeInteger(row.id) ? String(row.id) : row.id;
 if (typeof id !== 'string' || !ID.test(id) || typeof row.title !== 'string' || !row.title.trim()) return null;
 if (String(row.section || '').trim().toUpperCase() !== 'PROCUREMENT' || !['SOLICITATION', 'SOLICITATIONS'].includes(String(row.notice_type || '').trim().toUpperCase())) return null;
 const deadline = dateValue(row.deadline), posted = dateValue(row.posted);if (!deadline || !posted) return null;
 return {id, title: row.title.trim().slice(0, 500), agency: typeof row.agency === 'string' && row.agency.trim() ? row.agency.trim().slice(0, 500) : 'Agency not supplied', posted, deadline, category: typeof row.category === 'string' ? row.category.slice(0, 300) : null, url: NOTICE + encodeURIComponent(id), dataset: SOURCE, provider: 'nyc', deadlineTimezone: 'America/New_York'};
}
function select(columns, detail = false) {
 const keys = [...REQUIRED, 'category', ...(detail ? ['description1', 'description2', 'description3', 'other1', 'other2', 'other3'] : [])];
 return keys.filter(k => columns[k]).map(k => columns[k] + ' AS ' + (k==='noticeType'?'notice_type':k)).join(',');
}
function solicitationWhere(c) {return c.section+" = 'Procurement' AND "+c.noticeType+" = 'Solicitation'";}
async function snapshot(config,event) {
 const rows=await F.db(config,'ft_cache?key=eq.'+encodeURIComponent(SNAPSHOT_KEY)+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString()));
 const saved=rows[0]?.body;
 const age=saved?Date.now()-Date.parse(saved.checkedAt):Infinity;
 const usable=!!saved&&Array.isArray(saved.records)&&age>=0&&age<24*HOUR;
 if(usable&&age<HOUR)return {...saved,cached:true,stale:false};
 const claimed=await kb.rpc(config,'ft_nyc_claim',{});
 if(!claimed){if(usable)return {...saved,cached:true,stale:true};transient('NYC notices are refreshing. Please retry in a few minutes or visit City Record Online.');}
 try {
  const m=schema(await upstream(config,event,'/api/views/'+DATASET+'.json')),c=m.columns;
  // Sorting the historical source triggers slow upstream scans. Fetch a bounded
  // current snapshot once, then sort/search/page locally without upstream calls.
  const params=new URLSearchParams({'$select':select(c,true),'$where':solicitationWhere(c)+' AND '+c.deadline+" >= '"+nycDay()+"T00:00:00.000'",'$limit':'1001'});
  const records=await upstream(config,event,'/resource/'+DATASET+'.json',params);
  if(!Array.isArray(records)||records.length>1000)invalidSource('NYC notice coverage needs review before this snapshot can be displayed. Visit City Record Online.');
  if(records.length&&records.every(row=>!normalize(row)))invalidSource('NYC notice fields or types need review. No notices are implied.');
  const body={records,checkedAt:new Date().toISOString(),sourceUpdatedAt:m.sourceUpdatedAt,license:m.license,publisher:m.publisher,dataset:SOURCE};
  await kb.rpc(config,'ft_nyc_store',{p_body:body});
  return {...body,cached:false,stale:false};
 }catch(error){
  // Only evidence that the source is no longer valid may invalidate good data.
  // Caller validation, quota and internal/database failures must not erase it.
  if(error.invalidSource){if(saved)await F.db(config,'ft_cache?key=eq.'+encodeURIComponent(SNAPSHOT_KEY),{method:'DELETE'});throw error;}
  if(usable&&(error.transient||error.status>=500))return {...saved,cached:true,stale:true};
  throw error;
 }
}
function snapshotNotice(data){return data.stale?' NYC is temporarily unavailable or refreshing. Showing the last successful snapshot from '+data.checkedAt+'. Verify every notice on the original source.':'';}
async function search(config, event, input) {
 available();event={...event,nycRequestDeadline:Date.now()+20000};const keyword=input.keyword??'',page=input.page??0;
 if(typeof keyword!=='string'||keyword.length>100||/[\x00-\x1f]/.test(keyword)||!Number.isInteger(page)||page<0||page>39)kb.fail(400,'Use a keyword up to 100 characters and a supported results page.');
 const data=await snapshot(config,event),day=nycDay(),needle=keyword.trim().toLocaleLowerCase('en-US');
 const valid=data.records.map(normalize).filter(Boolean).filter(item=>item.deadline.slice(0,10)>=day);
 const matched=valid.filter(item=>!needle||[item.title,item.agency,item.category||''].join(' ').toLocaleLowerCase('en-US').includes(needle));
 matched.sort((a,b)=>b.posted.localeCompare(a.posted)||b.id.localeCompare(a.id));
 return {items:matched.slice(page*25,page*25+25),page,hasMore:matched.length>(page+1)*25,total:matched.length,omittedCount:data.records.length-data.records.map(normalize).filter(Boolean).length,license:data.license,publisher:data.publisher,cached:data.cached,stale:data.stale,checkedAt:data.checkedAt,sourceUpdatedAt:data.sourceUpdatedAt,dataset:SOURCE,notice:'NYC procurement solicitation notices with listed deadlines today or later in New York time. This does not confirm that a bid remains open. Verify exact closing times, amendments and documents on the original notice. Keyword matches title, agency and category. Sort applies to this results page.'+snapshotNotice(data)};
}
function plain(value) {
 if (typeof value !== 'string') return '';
 return value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<\/(p|div|li|h[1-6])>/gi, '\n').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim();
}
async function detail(config, event, value) {
 available();event={...event,nycRequestDeadline:Date.now()+20000};const id = noticeId(value);
 const data=await snapshot(config,event);
 const row=data.records.find(x=>String(x.id)===id),item=row&&normalize(row);
 if(!item||item.deadline.slice(0,10)<nycDay())kb.fail(404,'This NYC solicitation is not in the current snapshot. It may have closed or changed. Paste or upload the original solicitation instead.');
  let text = ['description1', 'description2', 'description3', 'other1', 'other2', 'other3'].map(k => plain(row[k])).filter(Boolean).join('\n\n');
  let notice = 'City Record descriptions are not complete solicitation packages. Attachments are not imported. Paste or upload the full solicitation and verify the deadline, eligibility and all amendments.';
  if (text.length > 100000) {text = '';notice += ' The source description exceeds the tool input limit.';}
  return {item,text,notice:notice+snapshotNotice(data),checkedAt:data.checkedAt,cached:data.cached,stale:data.stale};
}
module.exports = {enabled, available, noticeId, nycDay, schema, normalize, search, detail, plain, SOURCE};
