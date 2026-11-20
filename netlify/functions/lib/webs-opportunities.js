const kb = require('./knowledge-base');
const F = require('./free-tools');
const CALENDAR = 'https://pr-webs-vendor.des.wa.gov/bidcalendar.aspx';
const DETAILS = 'https://pr-webs-vendor.des.wa.gov/Search_BidDetails.aspx?ID=';
const MAX_RESPONSE = 4 * 1024 * 1024;
const ID = /^\d{1,12}$/;
const SEARCH_NOTICE = 'Washington solicitation notices from WEBS, the State of Washington\'s procurement portal, listing the public bid calendar\'s first page (soonest-closing first). The calendar states the close date only, with no closing time; a notice that states no readable close date is shown as close date not stated instead of guessing. No estimated value is published by this feed. Results are cached for up to one hour. Full solicitation documents need a free WEBS login. Verify the closing time, amendments, eligibility and documents on the original notice before you act.';
const DETAIL_NOTICE = 'This is the public bid calendar summary only, not the full solicitation package. Full solicitation documents need a free WEBS login. Paste or upload the full solicitation and verify the deadline, eligibility and all amendments.';
function websId(value) {
 if (typeof value !== 'string') kb.fail(400, 'Enter a WEBS bid calendar URL or solicitation ID.');
 if (ID.test(value)) return value;
 let u; try { u = new URL(value); } catch { kb.fail(400, 'Use an original WEBS bid details URL.'); }
 const m = u.pathname.match(/^\/Search_BidDetails\.aspx$/);
 const id = u.searchParams.get('ID');
 if (u.protocol !== 'https:' || u.hostname !== 'pr-webs-vendor.des.wa.gov' || u.username || u.password || u.port || !m || !id || !ID.test(id)) kb.fail(400, 'Use an original WEBS bid details URL.');
 return id;
}
function plain(value) {
 if (typeof value !== 'string') return '';
 return value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<\/(p|div|li|h[1-6])>/gi, '\n').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => { const c = Number(n); return c > 31 && c < 0x110000 ? String.fromCodePoint(c) : ''; }).replace(/&#x([0-9a-fA-F]+);/g, (m, n) => { const c = parseInt(n, 16); return c > 31 && c < 0x110000 ? String.fromCodePoint(c) : ''; }).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}
function nthSunday(year, month, n) {
 const first = new Date(Date.UTC(year, month, 1));
 return 1 + ((7 - first.getUTCDay()) % 7) + (n - 1) * 7;
}
function pacificOffsetMinutes(year, month, day) {
 // Pacific daylight time runs from the second Sunday of March through the
 // first Sunday of November; the close date is read at end of day, so the
 // March transition Sunday itself is daylight time and the November
 // transition Sunday itself is standard time.
 const dstStart = nthSunday(year, 2, 2);
 const dstEnd = nthSunday(year, 10, 1);
 const afterStart = month > 2 || (month === 2 && day >= dstStart);
 const beforeEnd = month < 10 || (month === 10 && day < dstEnd);
 return afterStart && beforeEnd ? -420 : -480;
}
function parseCloseDate(value) {
 if (typeof value !== 'string') return null;
 const m = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
 if (!m) return null;
 const month = Number(m[1]), day = Number(m[2]), year = 2000 + Number(m[3]);
 if (month < 1 || month > 12 || year < 2000 || year > 2100) return null;
 if (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
 const offset = pacificOffsetMinutes(year, month - 1, day);
 return new Date(Date.UTC(year, month - 1, day, 23 - offset / 60, 59, 59)).toISOString();
}
function parseRow(block) {
 const link = block.match(/DetailsHyperlink" href="Search_BidDetails\.aspx\?ID=(\d+)">([^<]+)<\/a>/);
 if (!link) return null;
 const ref = block.match(/Ref#:\s*([^<]+?)\s*<br/i);
 if (!ref) return null;
 const close = block.match(/(\d{1,2})\/(\d{1,2})\/(\d{2})/);
 const desc = block.match(/Ref#:[^<]*<br\s*\/?>([\s\S]*?)(?:<div[^>]*SolicitationsUpdatePanel|<\/td>)/i);
 const contact = block.match(/<\/div>\s*<\/td><td[^>]*>\s*<span[^>]*>([^<]*)<\/span>/);
 return {id: link[1], title: link[2].replace(/\s+/g, ' ').trim(), reference: ref[1].replace(/\s+/g, ' ').trim(), closeText: close ? close[0] : null, description: desc ? plain(desc[1]).slice(0, 2000) : '', contact: contact ? contact[1].trim() : null, url: DETAILS + link[1]};
}
function parseCalendar(html) {
 if (typeof html !== 'string' || !/id="DataGrid1"/.test(html)) kb.fail(503, 'The WEBS bid calendar returned an unsupported response. No notices are implied.');
 const grid = html.slice(html.indexOf('id="DataGrid1"'));
 const blocks = grid.split(/<tr class="grid_item(?:_alt)?">/);
 const rows = blocks.slice(1).map(parseRow).filter(Boolean);
 if (!rows.length) kb.fail(503, 'The WEBS bid calendar returned no readable notices. Visit the original source.');
 return rows;
}
function normalize(raw) {
 if (!raw || typeof raw !== 'object') return null;
 if (!ID.test(raw.id) || typeof raw.title !== 'string' || !raw.title) return null;
 return {id: raw.id, reference: typeof raw.reference === 'string' && raw.reference ? raw.reference.slice(0, 200) : null, title: raw.title.slice(0, 500), agency: 'Agency not supplied', posted: null, deadline: parseCloseDate(raw.closeText), url: raw.url, provider: 'webs', description: typeof raw.description === 'string' ? raw.description.slice(0, 2000) : '', contact: typeof raw.contact === 'string' && raw.contact ? raw.contact.slice(0, 200) : null};
}
async function cached(c, key, fetcher) {
 const rows = await F.db(c, 'ft_cache?key=eq.' + key + '&expires_at=gt.' + encodeURIComponent(new Date().toISOString()));
 if (rows[0]) return {...rows[0].body, cached: true};
 const body = await fetcher();
 await kb.rpc(c, 'ft_cache_put', {p_key: key, p_body: body});
 return {...body, cached: false};
}
async function fetchCalendar(c, event) {
 await kb.rpc(c, 'ft_admit', {p_ip: F.ip(event), p_kind: 'webs', p_limit: 10, p_global: 50});
 let response;
 try {
  response = await fetch(CALENDAR, {headers: {Accept: 'text/html,application/xhtml+xml'}, redirect: 'error', signal: AbortSignal.timeout(30000)});
 } catch { kb.fail(503, 'The WEBS bid calendar could not be reached. Please retry later or visit WEBS.'); }
 if (!response.ok) kb.fail(response.status === 429 ? 429 : 503, 'The WEBS bid calendar could not return notices right now (HTTP ' + response.status + '). Please retry later or visit WEBS.');
 if (Number(response.headers.get('content-length')) > MAX_RESPONSE) kb.fail(503, 'The WEBS bid calendar exceeded the supported size. Visit the original source.');
 let text;
 try { text = await response.text(); } catch { kb.fail(503, 'The WEBS bid calendar response was interrupted. Please retry later.'); }
 if (Buffer.byteLength(text) > MAX_RESPONSE) kb.fail(503, 'The WEBS bid calendar exceeded the supported size. Visit the original source.');
 return parseCalendar(text);
}
async function snapshot(c, event) {
 return cached(c, F.mac('webs:snapshot:v1'), async () => {
  const records = (await fetchCalendar(c, event)).map(normalize).filter(Boolean);
  return {records, checkedAt: new Date().toISOString()};
 });
}
async function search(c, event, p) {
 const keyword = p.keyword ?? '', page = p.page ?? 0;
 if (typeof keyword !== 'string' || keyword.length > 100 || /[\x00-\x1f]/.test(keyword) || !Number.isInteger(page) || page < 0 || page > 9) kb.fail(400, 'Use a keyword up to 100 characters and a supported results page.');
 const data = await snapshot(c, event);
 const open = data.records.filter(x => !x.deadline || Date.parse(x.deadline) >= Date.now());
 const needle = keyword.trim().toLocaleLowerCase('en-US');
 const matched = open.filter(x => !needle || [x.title, x.agency, x.reference || '', x.description || ''].join(' ').toLocaleLowerCase('en-US').includes(needle));
 matched.sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999') || a.id.localeCompare(b.id));
 return {items: matched.slice(page * 25, page * 25 + 25), page, hasMore: matched.length > (page + 1) * 25, total: matched.length, checkedAt: data.checkedAt, cached: data.cached, notice: SEARCH_NOTICE};
}
async function detail(c, event, value) {
 const id = websId(value);
 const data = await cached(c, F.mac('webs:detail:' + id), async () => {
  const item = (await snapshot(c, event)).records.find(x => x.id === id);
  if (!item) kb.fail(404, 'This Washington opportunity is not in the current WEBS bid calendar. It may have closed or changed. Paste or upload the original solicitation instead.');
  let text = item.title + '\nReference: ' + (item.reference || 'Not supplied') + '\nClose date: ' + (item.deadline ? new Date(item.deadline).toLocaleDateString('en-US', {timeZone: 'America/Los_Angeles'}) : 'not stated') + '\n' + (item.description || '');
  if (item.contact) text += '\nContact: ' + item.contact;
  let notice = DETAIL_NOTICE;
  if (text.length > 100000) { text = ''; notice += ' The source description exceeds the tool input limit.'; }
  return {item, text, notice};
 });
 return data;
}
module.exports = {websId, parseCloseDate, parseRow, parseCalendar, plain, normalize, search, detail, CALENDAR, DETAILS};
