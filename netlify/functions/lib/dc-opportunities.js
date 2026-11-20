const kb = require('./knowledge-base');
const F = require('./free-tools');
const LAYER_URL = 'https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/19/query';
const PORTAL = 'https://ocp.dc.gov/';
const SEARCH_NOTICE = 'District of Columbia solicitations from PASS, the Procurement Automated Support System, published as open data by the District of Columbia Office of the Chief Technology Officer. The feed uses the close date as the operative deadline, because the due-date field is not consistently published; some notices state no close date. No per-solicitation link is published by this feed, so each result links to the DC Office of Contracting and Procurement site; search the solicitation number there. Solicitations are advertised through OCP eSourcing and bids need a registered eSourcing account. No estimated value is published by this feed. Results are cached for up to one hour. Verify the closing time, amendments, eligibility and documents on the original notice before you act.';
const DETAIL_NOTICE = 'The PASS feed publishes the solicitation title, dates and agency only. The full solicitation is advertised through OCP eSourcing. Attachments are not imported. Paste or upload the full solicitation and verify the deadline, eligibility and all amendments.';
const MAX_RESPONSE = 2 * 1024 * 1024;
const MAX_ITEMS = 1000;
const ID = /^[A-Za-z0-9][A-Za-z0-9-]{1,100}$/;
function queryUrl() {
  const today = new Date().toISOString().slice(0, 10);
  const where = "(DUE_DATE > TIMESTAMP '" + today + " 00:00:00' OR CLOSEDATE > TIMESTAMP '" + today + " 00:00:00')";
  return LAYER_URL + '?where=' + encodeURIComponent(where) + '&outFields=SOLICITATIONNUMBER,SOLICITATIONTITLE,AGENCY_NAME,DUE_DATE,CLOSEDATE,ISSUANCEDATE&f=json&resultRecordCount=1000&orderByFields=CLOSEDATE';
}
function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function epochToIso(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
function normalize(feature) {
  if (!feature || typeof feature !== 'object') return null;
  const a = feature.attributes;
  if (!a || typeof a !== 'object') return null;
  const id = text(a.SOLICITATIONNUMBER);
  if (!id || id.length > 200) return null;
  const title = text(a.SOLICITATIONTITLE);
  if (!title) return null;
  const agency = text(a.AGENCY_NAME) || 'Agency not supplied';
  const posted = epochToIso(a.ISSUANCEDATE);
  const deadline = epochToIso(a.CLOSEDATE) || epochToIso(a.DUE_DATE);
  return {id: id.slice(0, 200), reference: id.slice(0, 200), title: title.slice(0, 500), agency: agency.slice(0, 500), posted, deadline, url: PORTAL, provider: 'dc-pass'};
}
async function cached(c, key, fetcher) {
  const rows = await F.db(c, 'ft_cache?key=eq.' + key + '&expires_at=gt.' + encodeURIComponent(new Date().toISOString()));
  if (rows[0]) return {...rows[0].body, cached: true};
  const body = await fetcher();
  await kb.rpc(c, 'ft_cache_put', {p_key: key, p_body: body});
  return {...body, cached: false};
}
async function fetchRows(c, event) {
  await kb.rpc(c, 'ft_admit', {p_ip: F.ip(event), p_kind: 'dc-pass', p_limit: 10, p_global: 50});
  let response;
  try {
    response = await fetch(queryUrl(), {headers: {Accept: 'application/json'}, redirect: 'error', signal: AbortSignal.timeout(12000)});
  } catch { kb.fail(503, 'The DC PASS open-data feed could not be reached. Please retry later or visit the DC procurement portal.'); }
  if (!response.ok) kb.fail(response.status === 429 ? 429 : 503, 'The DC PASS open-data feed could not return solicitations right now (HTTP ' + response.status + '). Please retry later or visit the DC procurement portal.');
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE) kb.fail(503, 'The DC PASS open-data feed exceeded the supported size. Visit the original source.');
  let textBody;
  try { textBody = await response.text(); } catch { kb.fail(503, 'The DC PASS open-data feed response was interrupted. Please retry later.'); }
  if (Buffer.byteLength(textBody) > MAX_RESPONSE) kb.fail(503, 'The DC PASS open-data feed exceeded the supported size. Visit the original source.');
  let parsed;
  try { parsed = JSON.parse(textBody); } catch { kb.fail(503, 'The DC PASS open-data feed returned an unsupported response. No solicitations are implied.'); }
  if (!parsed || typeof parsed !== 'object' || parsed.error || !Array.isArray(parsed.features)) kb.fail(503, 'The DC PASS open-data feed returned an unsupported response. No solicitations are implied.');
  if (parsed.features.length >= MAX_ITEMS) kb.fail(503, 'The DC PASS open-data feed coverage needs review before solicitations can be displayed. Visit the original source.');
  return parsed.features;
}
async function snapshot(c, event) {
  return cached(c, F.mac('dc-pass:snapshot:v1'), async () => {
    const seen = new Set();
    const records = (await fetchRows(c, event)).map(normalize).filter(Boolean).filter(x => {
      if (seen.has(x.id)) return false;
      seen.add(x.id);
      return true;
    });
    return {records, checkedAt: new Date().toISOString()};
  });
}
async function search(c, event, p) {
  const keyword = p.keyword ?? '', page = p.page ?? 0;
  if (typeof keyword !== 'string' || keyword.length > 100 || /[\x00-\x1f]/.test(keyword) || !Number.isInteger(page) || page < 0 || page > 9) kb.fail(400, 'Use a keyword up to 100 characters and a supported results page.');
  const data = await snapshot(c, event);
  const today = new Date().toISOString().slice(0, 10);
  const open = data.records.filter(x => !x.deadline || x.deadline.slice(0, 10) >= today);
  const needle = keyword.trim().toLocaleLowerCase('en-US');
  const matched = open.filter(x => !needle || [x.title, x.agency, x.reference || ''].join(' ').toLocaleLowerCase('en-US').includes(needle));
  matched.sort((a, b) => (b.posted || '').localeCompare(a.posted || '') || (a.deadline || '9999').localeCompare(b.deadline || '9999') || a.id.localeCompare(b.id));
  return {items: matched.slice(page * 25, page * 25 + 25), page, hasMore: matched.length > (page + 1) * 25, total: matched.length, checkedAt: data.checkedAt, cached: data.cached, notice: SEARCH_NOTICE};
}
function detailId(value) {
  if (typeof value !== 'string' || !ID.test(value.trim())) kb.fail(400, 'Enter a DC solicitation number.');
  return value.trim();
}
async function detail(c, event, value) {
  const id = detailId(value);
  const data = await cached(c, F.mac('dc-pass:detail:' + id), async () => {
    const item = (await snapshot(c, event)).records.find(x => x.id === id);
    if (!item) kb.fail(404, 'This DC solicitation is not in the current PASS feed. It may have closed or changed. Paste or upload the original solicitation instead.');
    return {item, text: '', notice: DETAIL_NOTICE};
  });
  return data;
}
module.exports = {queryUrl, normalize, search, detail, detailId, LAYER_URL, PORTAL};
