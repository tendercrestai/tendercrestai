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
const ALIASES = {
 id: ['requestid'], title: ['shorttitle'], agency: ['agencyname'], posted: ['eventdate'],
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
 if (metadata?.id !== DATASET || !Array.isArray(metadata.columns)) kb.fail(503, 'NYC Open Data returned an unsupported dataset description. No notices are implied.');
 const columns = {};
 for (const [key, aliases] of Object.entries(ALIASES)) {
  const column = metadata.columns.find(c => aliases.includes(String(c.name || '').replace(/[^a-z0-9]/gi, '').toLowerCase()) || aliases.includes(String(c.fieldName || '').replace(/[^a-z0-9]/gi, '').toLowerCase()));
  if (column && FIELD.test(column.fieldName || '')) columns[key] = column.fieldName;
 }
 if (REQUIRED.some(k => !columns[k])) kb.fail(503, 'NYC Open Data fields have changed. No notices are implied.');
 for (const key of ['posted', 'deadline']) {
  const column = metadata.columns.find(c => c.fieldName === columns[key]);
  if (!['calendar_date', 'floating_timestamp', 'date'].includes(column.dataTypeName)) kb.fail(503, 'NYC notice date fields need review before they can be displayed.');
 }
 const idType=metadata.columns.find(c=>c.fieldName===columns.id).dataTypeName;
 if(!['text','number'].includes(idType))kb.fail(503,'NYC request IDs need review before they can be displayed.');
 return {columns,idType, sourceUpdatedAt: updatedAt(metadata.rowsUpdatedAt), dataset: SOURCE};
}
async function upstream(config, event, path, params) {
 await kb.rpc(config, 'ft_admit', {p_ip: F.ip(event), p_kind: 'nyc', p_limit: 10, p_global: 50});
 const url = new URL(path, API);if (params) url.search = params.toString();
 let r;try {r = await fetch(url, {headers: {Accept: 'application/json'}, redirect: 'error', signal: AbortSignal.timeout(8000)});} catch {kb.fail(503, 'NYC Open Data could not be reached. Please retry later or visit City Record Online.');}
 if (!r.ok) kb.fail(r.status === 429 ? 429 : 503, 'NYC Open Data could not return notices right now (HTTP ' + r.status + '). Please retry later or visit City Record Online.');
 if (Number(r.headers.get('content-length')) > MAX_RESPONSE) kb.fail(503, 'The NYC response exceeded the supported size. Visit the original source.');
 const text = await r.text();if (Buffer.byteLength(text) > MAX_RESPONSE) kb.fail(503, 'The NYC response exceeded the supported size. Visit the original source.');
 try {return JSON.parse(text);} catch {kb.fail(503, 'NYC Open Data returned an unsupported response. No notices are implied.');}
}
async function cached(config, name, loader) {
 const key = F.mac('nyc:v1:' + name), rows = await F.db(config, 'ft_cache?key=eq.' + key + '&expires_at=gt.' + encodeURIComponent(new Date().toISOString()));
 if (rows[0]) return {...rows[0].body, cached: true};
 const body = await loader();await kb.rpc(config, 'ft_cache_put', {p_key: key, p_body: body});return {...body, cached: false};
}
async function metadata(config, event) {return cached(config, 'schema', async () => schema(await upstream(config, event, '/api/views/' + DATASET + '.json')));}
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
function solicitationWhere(c) {return "upper(" + c.section + ") = 'PROCUREMENT' AND upper(" + c.noticeType + ") in ('SOLICITATION','SOLICITATIONS')";}
async function search(config, event, input) {
 available();const keyword = input.keyword ?? '', page = input.page ?? 0;
 if (typeof keyword !== 'string' || keyword.length > 100 || /[\x00-\x1f]/.test(keyword) || !Number.isInteger(page) || page < 0 || page > 9) kb.fail(400, 'Use a title keyword up to 100 characters and a supported results page.');
 const day = nycDay();
 return cached(config, JSON.stringify(['search', keyword.trim(), page, day]), async () => {
  const m = await metadata(config, event), c = m.columns;
  let where = solicitationWhere(c) + ' AND ' + c.deadline + " >= '" + day + "T00:00:00.000'";
  const params = new URLSearchParams({'$select': select(c), '$where': where, '$order': c.posted + ' DESC, ' + c.id + ' DESC', '$limit': '26', '$offset': String(page * 25)});
  if(keyword.trim())params.set('$q',keyword.trim());
  const rows = await upstream(config, event, '/resource/' + DATASET + '.json', params);
  if (!Array.isArray(rows) || rows.length > 26) kb.fail(503, 'NYC Open Data returned an unsupported notice list. No notices are implied.');
  const normalized = rows.map(normalize);if (rows.length && normalized.some(x => !x)) kb.fail(503, 'NYC notice fields or types need review. No notices are implied.');
  const items = normalized.slice(0, 25).filter(x => x.deadline.slice(0, 10) >= day);
  return {items, page, hasMore: rows.length > 25, checkedAt: new Date().toISOString(), sourceUpdatedAt: m.sourceUpdatedAt, dataset: SOURCE, notice: 'NYC procurement solicitation notices with listed deadlines today or later in New York time. This does not confirm that a bid remains open. Verify exact closing times, amendments and documents on the original notice. Sort applies to this results page.'};
 });
}
function plain(value) {
 if (typeof value !== 'string') return '';
 return value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<\/(p|div|li|h[1-6])>/gi, '\n').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}
async function detail(config, event, value) {
 available();const id = noticeId(value);
 return cached(config, JSON.stringify(['detail', id]), async () => {
  const m = await metadata(config, event), c = m.columns;
  if(m.idType==='number'&&!/^\d{1,20}$/.test(id))kb.fail(400,'Enter a numeric NYC request ID.');
  const literal=m.idType==='number'?id:"'"+id+"'";
  const params = new URLSearchParams({'$select': select(c, true), '$where': solicitationWhere(c) + ' AND ' + c.id + ' = ' + literal, '$limit': '1'});
  const rows = await upstream(config, event, '/resource/' + DATASET + '.json', params);
  if (!Array.isArray(rows)) kb.fail(503, 'NYC Open Data returned unsupported notice details.');
  const row = rows.find(x => String(x.id) === id), item = row && normalize(row);
  if (!item) kb.fail(404, 'This NYC solicitation notice was not returned. Paste or upload the original solicitation instead.');
  let text = ['description1', 'description2', 'description3', 'other1', 'other2', 'other3'].map(k => plain(row[k])).filter(Boolean).join('\n\n');
  let notice = 'City Record descriptions are not complete solicitation packages. Attachments are not imported. Paste or upload the full solicitation and verify the deadline, eligibility and all amendments.';
  if (text.length > 100000) {text = '';notice += ' The source description exceeds the tool input limit.';}
  return {item, text, notice, checkedAt: new Date().toISOString()};
 });
}
module.exports = {enabled, available, noticeId, nycDay, schema, normalize, search, detail, plain, SOURCE};
