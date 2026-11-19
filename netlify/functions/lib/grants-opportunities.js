const kb = require('./knowledge-base');
const F = require('./free-tools');
const SEARCH_URL = 'https://api.grants.gov/v1/api/search2';
const DETAIL_URL = 'https://api.grants.gov/v1/api/fetchOpportunity';
const DETAIL_PAGE = 'https://www.grants.gov/search-results-detail/';
const GUIDE = 'https://www.grants.gov/api/api-guide';
const MAX_RESPONSE = 2 * 1024 * 1024;
const STATUSES = 'posted|forecasted';
const ID = /^\d{1,12}$/;
const MONTHS = {jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11};
const SEARCH_NOTICE = 'Federal grant opportunities from Grants.gov. These are grants, not federal contracts. Contracts live on the SAM.gov feed. Results are cached for up to one hour. Award amounts and eligibility are not in the search feed; open the grant on Grants.gov for the award ceiling, award floor, eligibility and the full funding opportunity. Verify the deadline, eligibility, attachments and amendments on the original grant before you apply.';
const DETAIL_NOTICE = 'Grants.gov synopses are not complete funding opportunity packages. Attachments are not imported. Paste or upload the full funding opportunity and verify the deadline, eligibility and all amendments.';
function grantId(value) {
 if (typeof value !== 'string') kb.fail(400, 'Enter a Grants.gov grant URL or opportunity ID.');
 if (ID.test(value)) return value;
 let u; try { u = new URL(value); } catch { kb.fail(400, 'Use an original Grants.gov grant URL.'); }
 const m = u.pathname.match(/^\/search-results-detail\/(\d{1,12})\/?$/);
 if (u.protocol !== 'https:' || u.hostname !== 'www.grants.gov' || u.username || u.password || u.port || !m) kb.fail(400, 'Use an original Grants.gov grant URL.');
 return m[1];
}
function grantDate(value) {
 if (typeof value !== 'string') return null;
 const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
 if (!m) return null;
 const month = Number(m[1]), day = Number(m[2]), year = Number(m[3]);
 if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) return null;
 const date = new Date(Date.UTC(year, month - 1, day));
 if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
 return date.toISOString().slice(0, 10);
}
function detailDate(value) {
 if (typeof value !== 'string' || !value.trim()) return null;
 const stamped = value.match(/^(\d{4})-(\d{2})-(\d{2})-\d{2}-\d{2}-\d{2}$/);
 if (stamped) {
  const date = new Date(Date.UTC(Number(stamped[1]), Number(stamped[2]) - 1, Number(stamped[3])));
  if (date.getUTCFullYear() === Number(stamped[1]) && date.getUTCMonth() === Number(stamped[2]) - 1 && date.getUTCDate() === Number(stamped[3])) return date.toISOString().slice(0, 10);
  return null;
 }
 const slash = grantDate(value.trim());
 if (slash) return slash;
 const parsed = Date.parse(value.trim());
 if (!Number.isFinite(parsed)) return null;
 return new Date(parsed).toISOString().slice(0, 10);
}
function money(value) {
 if (typeof value === 'number') return Number.isFinite(value) ? value : null;
 if (typeof value !== 'string') return null;
 const text = value.trim().toLowerCase();
 if (!text || text === 'none' || text === 'n/a') return null;
 const amount = Number(text.replace(/[$,]/g, ''));
 return Number.isFinite(amount) ? amount : null;
}
function plain(value) {
 if (typeof value !== 'string') return '';
 return value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<\/(p|div|li|h[1-6])>/gi, '\n').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => { const c = Number(n); return c > 31 && c < 0x110000 ? String.fromCodePoint(c) : ''; }).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim();
}
function normalize(hit) {
 if (!hit || typeof hit !== 'object') return null;
 const id = typeof hit.id === 'number' && Number.isSafeInteger(hit.id) ? String(hit.id) : hit.id;
 if (typeof id !== 'string' || !ID.test(id)) return null;
 const number = typeof hit.number === 'string' && hit.number.trim() ? hit.number.trim() : (typeof hit.oppNumber === 'string' && hit.oppNumber.trim() ? hit.oppNumber.trim() : null);
 if (!number) return null;
 if (typeof hit.title !== 'string' || !hit.title.trim()) return null;
 const status = typeof hit.oppStatus === 'string' ? hit.oppStatus.trim().toLowerCase() : '';
 if (status !== 'posted' && status !== 'forecasted') return null;
 const posted = grantDate(hit.openDate);
 if (!posted) return null;
 const agency = typeof hit.agencyName === 'string' && hit.agencyName.trim() ? hit.agencyName.trim() : (typeof hit.agency === 'string' && hit.agency.trim() ? hit.agency.trim() : (typeof hit.agencyCode === 'string' && hit.agencyCode.trim() ? hit.agencyCode.trim() : 'Agency not supplied'));
 return {id, number: number.slice(0, 200), title: hit.title.trim().slice(0, 500), agency: agency.slice(0, 500), posted, deadline: grantDate(hit.closeDate), status, url: DETAIL_PAGE + id, provider: 'grants'};
}
async function cached(c, key, fetcher) {
 const rows = await F.db(c, 'ft_cache?key=eq.' + key + '&expires_at=gt.' + encodeURIComponent(new Date().toISOString()));
 if (rows[0]) return {...rows[0].body, cached: true};
 const body = await fetcher();
 await kb.rpc(c, 'ft_cache_put', {p_key: key, p_body: body});
 return {...body, cached: false};
}
async function post(c, event, url, body, timeoutMs) {
 let response;
 try {
  response = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs)});
 } catch { kb.fail(503, 'Grants.gov could not be reached. Please retry later or visit Grants.gov.'); }
 if (!response.ok) kb.fail(response.status === 429 ? 429 : 503, 'Grants.gov could not return grants right now (HTTP ' + response.status + '). Please retry later or visit Grants.gov.');
 if (Number(response.headers.get('content-length')) > MAX_RESPONSE) kb.fail(503, 'The Grants.gov response exceeded the supported size. Visit the original source.');
 let text;
 try { text = await response.text(); } catch { kb.fail(503, 'Grants.gov response was interrupted. Please retry later.'); }
 if (Buffer.byteLength(text) > MAX_RESPONSE) kb.fail(503, 'The Grants.gov response exceeded the supported size. Visit the original source.');
 let parsed;
 try { parsed = JSON.parse(text); } catch { kb.fail(503, 'Grants.gov returned an unsupported response. No grants are implied.'); }
 if (!parsed || typeof parsed !== 'object' || parsed.errorcode !== 0 || !parsed.data || typeof parsed.data !== 'object') kb.fail(503, 'Grants.gov could not return grants right now. Please retry later or visit Grants.gov.');
 return parsed.data;
}
async function search(c, event, p) {
 const keyword = p.keyword ?? '', page = p.page ?? 0;
 if (typeof keyword !== 'string' || keyword.length > 100 || /[\x00-\x1f]/.test(keyword) || !Number.isInteger(page) || page < 0 || page > 9) kb.fail(400, 'Use a keyword up to 100 characters and a supported results page.');
 const key = F.mac('grants:' + JSON.stringify([keyword, page]));
 const data = await cached(c, key, async () => {
  await kb.rpc(c, 'ft_admit', {p_ip: F.ip(event), p_kind: 'grants', p_limit: 10, p_global: 50});
  const body = {oppStatuses: STATUSES, rows: 25, startRecordNum: page * 25};
  if (keyword.trim()) body.keyword = keyword.trim();
  const d = await post(c, event, SEARCH_URL, body, 12000);
  if (!Array.isArray(d.oppHits)) kb.fail(503, 'Grants.gov returned an unsupported response. No grants are implied.');
  return {items: d.oppHits.map(normalize).filter(Boolean), total: Number.isSafeInteger(d.hitCount) ? d.hitCount : null, checkedAt: new Date().toISOString()};
 });
 const today = new Date().toISOString().slice(0, 10);
 const open = data.items.filter(x => !x.deadline || x.deadline >= today);
 return {...data, items: open, notice: SEARCH_NOTICE, guide: GUIDE};
}
async function detail(c, event, value) {
 const id = grantId(value);
 const data = await cached(c, F.mac('grants:detail:' + id), async () => {
  await kb.rpc(c, 'ft_admit', {p_ip: F.ip(event), p_kind: 'grants', p_limit: 10, p_global: 50});
  const d = await post(c, event, DETAIL_URL, {opportunityId: Number(id)}, 10000);
  const block = d.synopsis || d.forecast;
  if (!block || typeof block !== 'object') kb.fail(404, 'This grant is not available through Grants.gov right now. Paste the funding opportunity text instead.');
  if (String(d.id) !== id) kb.fail(404, 'This grant was not returned by Grants.gov. Paste the funding opportunity text instead.');
  if (typeof d.opportunityNumber !== 'string' || !d.opportunityNumber.trim() || typeof d.opportunityTitle !== 'string' || !d.opportunityTitle.trim()) kb.fail(404, 'This grant was not returned by Grants.gov. Paste the funding opportunity text instead.');
  const agency = typeof block.agencyName === 'string' && block.agencyName.trim() ? block.agencyName.trim() : (d.agencyDetails && typeof d.agencyDetails.agencyName === 'string' && d.agencyDetails.agencyName.trim() ? d.agencyDetails.agencyName.trim() : (typeof d.owningAgencyCode === 'string' && d.owningAgencyCode.trim() ? d.owningAgencyCode.trim() : 'Agency not supplied'));
  const alns = [...(Array.isArray(d.alns) ? d.alns.map(a => a.alnNumber) : []), ...(Array.isArray(d.cfdas) ? d.cfdas.map(a => a.cfdaNumber) : [])].filter(x => typeof x === 'string' && x.trim()).slice(0, 10);
  let text = plain(block.synopsisDesc || block.description || block.forecastDesc || '');
  let notice = DETAIL_NOTICE;
  if (text.length > 100000) { text = ''; notice += ' The source description exceeds the tool input limit.'; }
  return {item: {id, number: d.opportunityNumber.trim().slice(0, 200), title: d.opportunityTitle.trim().slice(0, 500), agency: agency.slice(0, 500), posted: detailDate(block.postingDateStr) || detailDate(block.postingDate), deadline: detailDate(block.responseDate) || detailDate(block.responseDateDesc), status: d.docType === 'forecast' ? 'forecasted' : 'posted', url: DETAIL_PAGE + id, provider: 'grants', awardCeiling: money(block.awardCeiling), awardFloor: money(block.awardFloor), eligibility: typeof block.applicantEligibilityDesc === 'string' ? plain(block.applicantEligibilityDesc).slice(0, 1000) : null, assistanceListings: alns}, text, notice};
 });
 return data;
}
module.exports = {grantId, grantDate, detailDate, money, plain, normalize, search, detail, SEARCH_URL, DETAIL_URL, DETAIL_PAGE, GUIDE};
