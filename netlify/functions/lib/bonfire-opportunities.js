const kb = require('./knowledge-base');
const F = require('./free-tools');
const ORGS = {
  utah: {slug: 'utah', host: 'utah.bonfirehub.com', label: 'Utah', agencyFallback: 'Agency not supplied'},
  kcmo: {slug: 'kcmo', host: 'kcmo.bonfirehub.com', label: 'Kansas City', agencyFallback: 'City of Kansas City, Missouri'},
};
const SEARCH_NOTICES = {
  utah: 'Utah solicitation notices from Bonfire, covering the State of Utah plus its cities, counties and school districts on one hub. Close dates are read from the notice text; a notice that states no readable close date is shown as close date not stated instead of guessing. No estimated value is published by this feed. Results are cached for up to one hour. Verify the closing time, amendments, eligibility and documents on the original notice before you act.',
  kcmo: 'Kansas City solicitation notices from Bonfire, covering the City of Kansas City, Missouri on one hub. Close dates are read from the notice text; a notice that states no readable close date is shown as close date not stated instead of guessing. No estimated value is published by this feed. Results are cached for up to one hour. Verify the closing time, amendments, eligibility and documents on the original notice before you act.',
};
const DETAIL_NOTICE = 'Bonfire descriptions are not complete solicitation packages. Attachments are not imported. Paste or upload the full solicitation and verify the deadline, eligibility and all amendments.';
const MAX_RESPONSE = 2 * 1024 * 1024;
const MAX_ITEMS = 1000;
const ID = /^\d{1,12}$/;
const MONTHS = {jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11};
const TZ_OFFSETS = {MST: -7, MDT: -6, PST: -8, PDT: -7, EST: -5, EDT: -4, CST: -6, CDT: -5, AKST: -9, AKDT: -8, HST: -10, UTC: 0, GMT: 0};
function orgConfig(slug) {
 return ORGS[slug] || ORGS.utah;
}
function feedUrl(slug) {
 return 'https://' + orgConfig(slug).host + '/opportunities/rss';
}
function portalUrl(slug) {
 return 'https://' + orgConfig(slug).host + '/opportunities/';
}
const FEED = feedUrl('utah');
const PORTAL = portalUrl('utah');
function bonfireId(value, slug) {
 const org = orgConfig(slug);
 if (typeof value !== 'string') kb.fail(400, 'Enter a ' + org.label + ' Bonfire opportunity URL or opportunity ID.');
 if (ID.test(value)) return value;
 let u; try { u = new URL(value); } catch { kb.fail(400, 'Use an original ' + org.label + ' Bonfire opportunity URL.'); }
 const m = u.pathname.match(/^\/opportunities\/(\d{1,12})\/?$/);
 if (u.protocol !== 'https:' || u.hostname !== org.host || u.username || u.password || u.port || !m) kb.fail(400, 'Use an original ' + org.label + ' Bonfire opportunity URL.');
 return m[1];
}
function plain(value) {
 if (typeof value !== 'string') return '';
 return value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<\/(p|div|li|h[1-6])>/gi, '\n').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => { const c = Number(n); return c > 31 && c < 0x110000 ? String.fromCodePoint(c) : ''; }).replace(/&#x([0-9a-fA-F]+);/g, (m, n) => { const c = parseInt(n, 16); return c > 31 && c < 0x110000 ? String.fromCodePoint(c) : ''; }).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim();
}
function parseCloseDate(text) {
 if (typeof text !== 'string') return null;
 const m = text.match(/Project closes\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s+([A-Za-z]{2,4})/i);
 if (!m) return null;
 const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
 if (month === undefined) return null;
 const day = Number(m[2]), year = Number(m[3]), minute = Number(m[5]);
 let hour = Number(m[4]);
 if (day < 1 || day > new Date(Date.UTC(year, month + 1, 0)).getUTCDate() || year < 2000 || year > 2100 || hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
 if (m[6].toUpperCase() === 'AM') hour = hour === 12 ? 0 : hour;
 else hour = hour === 12 ? 12 : hour + 12;
 const offset = TZ_OFFSETS[m[7].toUpperCase()];
 if (offset === undefined) return null;
 return new Date(Date.UTC(year, month, day, hour - offset, minute)).toISOString();
}
function tagText(block, name) {
 const m = block.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i'));
 if (!m) return null;
 return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() || null;
}
function parseRss(xml, slug) {
 const org = orgConfig(slug);
 if (typeof xml !== 'string' || !/<channel[\s>]/i.test(xml)) kb.fail(503, 'The ' + org.label + ' Bonfire feed returned an unsupported response. No notices are implied.');
 const blocks = [...xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)].map(x => x[1]);
 if (blocks.length > MAX_ITEMS) kb.fail(503, 'The ' + org.label + ' Bonfire feed coverage needs review before notices can be displayed. Visit the original source.');
 return blocks.map(block => ({title: tagText(block, 'title'), link: tagText(block, 'link'), pubDate: tagText(block, 'pubDate'), description: tagText(block, 'description'), guid: tagText(block, 'guid')}));
}
function normalize(raw, slug) {
 const org = orgConfig(slug);
 if (!raw || typeof raw !== 'object' || typeof raw.link !== 'string') return null;
 const hostPattern = org.host.replace(/\./g, '\\.');
 const m = raw.link.match(new RegExp('^https:\\/\\/' + hostPattern + '\\/opportunities\\/(\\d{1,12})\\/?$'));
 if (!m) return null;
 const text = plain(raw.description || '');
 const titleText = plain(raw.title || '');
 const ref = text.match(/Reference\s*#:\s*([^\s.\n]+)/i) || titleText.match(/Reference\s*#:\s*([^\s.\n]+)/i);
 const nameMatch = text.match(/Name:\s*([\s\S]*?)(?:\s*Department:|\s*Description:|$)/i) || titleText.match(/Name:\s*([\s\S]*?)(?:\s*Department:|\s*Description:|$)/i);
 const deptMatch = text.match(/Department:\s*([\s\S]*?)(?:\s*Description:|$)/i);
 const name = nameMatch && nameMatch[1].trim() ? nameMatch[1].trim() : titleText;
 if (!name) return null;
 const posted = typeof raw.pubDate === 'string' && Number.isFinite(Date.parse(raw.pubDate)) ? new Date(raw.pubDate).toISOString() : null;
 if (!posted) return null;
 const agency = deptMatch && deptMatch[1].trim() ? deptMatch[1].trim() : org.agencyFallback;
 return {id: m[1], reference: ref && ref[1].trim() ? ref[1].trim().slice(0, 100) : null, title: name.slice(0, 500), agency: agency.slice(0, 500), posted, deadline: parseCloseDate(text), url: raw.link, provider: 'bonfire'};
}
async function cached(c, key, fetcher) {
 const rows = await F.db(c, 'ft_cache?key=eq.' + key + '&expires_at=gt.' + encodeURIComponent(new Date().toISOString()));
 if (rows[0]) return {...rows[0].body, cached: true};
 const body = await fetcher();
 await kb.rpc(c, 'ft_cache_put', {p_key: key, p_body: body});
 return {...body, cached: false};
}
async function fetchFeed(c, event, slug) {
 const org = orgConfig(slug);
 await kb.rpc(c, 'ft_admit', {p_ip: F.ip(event), p_kind: 'bonfire', p_limit: 10, p_global: 50});
 let response;
 try {
  response = await fetch(feedUrl(slug), {headers: {Accept: 'application/rss+xml, application/xml, text/xml'}, redirect: 'error', signal: AbortSignal.timeout(12000)});
 } catch { kb.fail(503, 'The ' + org.label + ' Bonfire feed could not be reached. Please retry later or visit Bonfire.'); }
 if (!response.ok) kb.fail(response.status === 429 ? 429 : 503, 'The ' + org.label + ' Bonfire feed could not return notices right now (HTTP ' + response.status + '). Please retry later or visit Bonfire.');
 if (Number(response.headers.get('content-length')) > MAX_RESPONSE) kb.fail(503, 'The ' + org.label + ' Bonfire feed exceeded the supported size. Visit the original source.');
 let text;
 try { text = await response.text(); } catch { kb.fail(503, 'The ' + org.label + ' Bonfire feed response was interrupted. Please retry later.'); }
 if (Buffer.byteLength(text) > MAX_RESPONSE) kb.fail(503, 'The ' + org.label + ' Bonfire feed exceeded the supported size. Visit the original source.');
 return parseRss(text, slug);
}
async function snapshot(c, event, slug) {
 const org = orgConfig(slug);
 return cached(c, F.mac('bonfire:' + org.slug + ':snapshot:v1'), async () => {
  const records = (await fetchFeed(c, event, org.slug)).map(x => normalize(x, org.slug)).filter(Boolean);
  return {records, checkedAt: new Date().toISOString()};
 });
}
async function search(c, event, p, slug) {
 const org = orgConfig(slug);
 const keyword = p.keyword ?? '', page = p.page ?? 0;
 if (typeof keyword !== 'string' || keyword.length > 100 || /[\x00-\x1f]/.test(keyword) || !Number.isInteger(page) || page < 0 || page > 9) kb.fail(400, 'Use a keyword up to 100 characters and a supported results page.');
 const data = await snapshot(c, event, org.slug);
 const open = data.records.filter(x => !x.deadline || Date.parse(x.deadline) >= Date.now());
 const needle = keyword.trim().toLocaleLowerCase('en-US');
 const matched = open.filter(x => !needle || [x.title, x.agency, x.reference || ''].join(' ').toLocaleLowerCase('en-US').includes(needle));
 matched.sort((a, b) => b.posted.localeCompare(a.posted) || b.id.localeCompare(a.id));
 return {items: matched.slice(page * 25, page * 25 + 25), page, hasMore: matched.length > (page + 1) * 25, total: matched.length, checkedAt: data.checkedAt, cached: data.cached, notice: SEARCH_NOTICES[org.slug]};
}
async function detail(c, event, value, slug) {
 const org = orgConfig(slug);
 const id = bonfireId(value, org.slug);
 const data = await cached(c, F.mac('bonfire:' + org.slug + ':detail:' + id), async () => {
  const hostPattern = org.host.replace(/\./g, '\\.');
  const raw = (await fetchFeed(c, event, org.slug)).find(x => typeof x.link === 'string' && x.link.match(new RegExp('^https:\\/\\/' + hostPattern + '\\/opportunities\\/(\\d{1,12})\\/?$'))?.[1] === id);
  if (!raw) kb.fail(404, 'This ' + org.label + ' opportunity is not in the current Bonfire feed. It may have closed or changed. Paste or upload the original solicitation instead.');
  const item = normalize(raw, org.slug);
  if (!item) kb.fail(404, 'This ' + org.label + ' opportunity is not in the current Bonfire feed. Paste or upload the original solicitation instead.');
  let text = plain(raw.description || '');
  let notice = DETAIL_NOTICE;
  if (text.length > 100000) { text = ''; notice += ' The source description exceeds the tool input limit.'; }
  return {item, text, notice};
 });
 return data;
}
module.exports = {bonfireId, parseCloseDate, parseRss, plain, normalize, search, detail, FEED, PORTAL, ORGS, feedUrl, portalUrl};
