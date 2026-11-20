const kb = require('./knowledge-base');
const F = require('./free-tools');
const LANES = {
  'los-angeles': {slug: 'los-angeles', domain: 'data.lacity.org', dataset: 'hf3r-utnq', label: 'Los Angeles', provider: 'socrata-la', where: "stagename='Open'", order: 'closedate', select: 'rampid,title,stagename,bidpost,closedate,department,url', idField: 'rampid', titleField: 'title', agencyField: 'department', postedField: 'bidpost', deadlineField: 'closedate', urlField: 'url'},
  'delaware': {slug: 'delaware', domain: 'data.delaware.gov', dataset: '2hnj-zwix', label: 'Delaware', provider: 'socrata-delaware', where: null, order: 'deadlinedate', select: 'contractnumber,contracttitle,opendate,deadlinedate,agencycode,bidurl', idField: 'contractnumber', titleField: 'contracttitle', agencyField: 'agencycode', postedField: 'opendate', deadlineField: 'deadlinedate', urlField: 'bidurl'},
  'montgomery-county': {slug: 'montgomery-county', domain: 'data.montgomerycountymd.gov', dataset: 'eeq6-nnwe', label: 'Montgomery County', provider: 'socrata-mc', where: "status='Active'", order: 'closingdate', select: 'status,type,number,description,issuancedate,closingdate,department', idField: 'number', titleField: 'description', agencyField: 'department', postedField: 'issuancedate', deadlineField: 'closingdate', urlField: null},
};
const MONTGOMERY_SEARCH = 'https://www.montgomerycountymd.gov/office-procurement/solicitations-contracts';
const SEARCH_NOTICES = {
  'los-angeles': 'Los Angeles solicitation notices from RAMP, the City of Los Angeles procurement portal, covering the City of Los Angeles, LA County and LAUSD. The feed is published as open data under a CC0 public domain dedication. Close dates are the dates published by the feed; verify the exact closing time on the original notice. No estimated value is published by this feed. Results are cached for up to one hour. Verify the closing time, amendments, eligibility and documents on the original notice before you act.',
  'delaware': 'Delaware open bids from the State of Delaware open-data portal, published by the Office of Management and Budget, Government Support Services. The dataset is updated weekly, so a new bid may appear here up to a week after it opens. The agency is shown as the Delaware agency code. No estimated value is published by this feed. Results are cached for up to one hour. Verify the closing time, amendments, eligibility and documents on the original bid before you act.',
  'montgomery-county': 'Montgomery County, Maryland solicitation notices from the county open-data portal. The dataset is updated daily. No per-solicitation link is published by this feed, so each result links to the county solicitation search page; search the solicitation number there. No estimated value is published by this feed. Results are cached for up to one hour. Verify the closing time, amendments, eligibility and documents on the original notice before you act.',
};
const DETAIL_NOTICES = {
  'los-angeles': 'The RAMP feed publishes the notice title, dates and link only. Attachments are not imported. Paste or upload the full solicitation and verify the deadline, eligibility and all amendments.',
  'delaware': 'The Delaware feed publishes the bid title, dates and link only. Attachments are not imported. Paste or upload the full solicitation and verify the deadline, eligibility and all amendments.',
  'montgomery-county': 'The county feed publishes the solicitation title, dates and issuing department only, and links to the county solicitation search page instead of a per-solicitation page. Attachments are not imported. Paste or upload the full solicitation and verify the deadline, eligibility and all amendments.',
};
const MAX_RESPONSE = 2 * 1024 * 1024;
const MAX_ITEMS = 1000;
const ID_PATTERNS = {
  'los-angeles': /^\d{1,12}$/,
  'delaware': /^[A-Za-z0-9][A-Za-z0-9-]{1,100}$/,
  'montgomery-county': /^\d{1,12}$/,
};
const ID_HINTS = {
  'los-angeles': 'Enter a Los Angeles RAMP opportunity ID (the RAMP ID on the notice).',
  'delaware': 'Enter a Delaware contract number.',
  'montgomery-county': 'Enter a Montgomery County solicitation number.',
};
function laneConfig(slug) {
  if (!LANES[slug]) kb.fail(400, 'Unknown Socrata opportunity lane.');
  return LANES[slug];
}
function feedUrl(slug) {
  const lane = laneConfig(slug);
  let url = 'https://' + lane.domain + '/resource/' + lane.dataset + '.json?$limit=1000&$select=' + lane.select;
  if (lane.where) url += '&$where=' + lane.where;
  url += '&$order=' + lane.order;
  return url;
}
function text(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function dateValue(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let v = value.trim();
  // Socrata floating timestamps carry no timezone; Date.parse would read
  // them as server-local time, so the result would depend on the server
  // timezone. Interpret them as UTC, matching the NYC lane, so a deadline
  // means the same instant everywhere.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(v)) v += 'Z';
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}
function linkValue(value) {
  if (typeof value === 'string' && value.startsWith('https://')) return value;
  if (value && typeof value === 'object' && typeof value.url === 'string' && value.url.startsWith('https://')) return value.url;
  return null;
}
function normalize(row, slug) {
  const lane = laneConfig(slug);
  if (!row || typeof row !== 'object') return null;
  const id = text(row[lane.idField]);
  if (!id || id.length > 200) return null;
  const title = text(row[lane.titleField]);
  if (!title) return null;
  const posted = dateValue(row[lane.postedField]);
  if (!posted) return null;
  const agency = text(row[lane.agencyField]) || 'Agency not supplied';
  const deadline = dateValue(row[lane.deadlineField]);
  let url = null;
  if (slug === 'montgomery-county') url = MONTGOMERY_SEARCH;
  else url = linkValue(row[lane.urlField]);
  if (!url) return null;
  return {id: id.slice(0, 200), reference: id.slice(0, 200), title: title.slice(0, 500), agency: agency.slice(0, 500), posted, deadline, url, provider: lane.provider};
}
async function cached(c, key, fetcher) {
  const rows = await F.db(c, 'ft_cache?key=eq.' + key + '&expires_at=gt.' + encodeURIComponent(new Date().toISOString()));
  if (rows[0]) return {...rows[0].body, cached: true};
  const body = await fetcher();
  await kb.rpc(c, 'ft_cache_put', {p_key: key, p_body: body});
  return {...body, cached: false};
}
async function fetchRows(c, event, slug) {
  const lane = laneConfig(slug);
  await kb.rpc(c, 'ft_admit', {p_ip: F.ip(event), p_kind: 'socrata', p_limit: 10, p_global: 50});
  let response;
  try {
    response = await fetch(feedUrl(slug), {headers: {Accept: 'application/json'}, redirect: 'error', signal: AbortSignal.timeout(12000)});
  } catch { kb.fail(503, 'The ' + lane.label + ' open-data feed could not be reached. Please retry later or visit the source portal.'); }
  if (!response.ok) kb.fail(response.status === 429 ? 429 : 503, 'The ' + lane.label + ' open-data feed could not return notices right now (HTTP ' + response.status + '). Please retry later or visit the source portal.');
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE) kb.fail(503, 'The ' + lane.label + ' open-data feed exceeded the supported size. Visit the original source.');
  let textBody;
  try { textBody = await response.text(); } catch { kb.fail(503, 'The ' + lane.label + ' open-data feed response was interrupted. Please retry later.'); }
  if (Buffer.byteLength(textBody) > MAX_RESPONSE) kb.fail(503, 'The ' + lane.label + ' open-data feed exceeded the supported size. Visit the original source.');
  let rows;
  try { rows = JSON.parse(textBody); } catch { kb.fail(503, 'The ' + lane.label + ' open-data feed returned an unsupported response. No notices are implied.'); }
  if (!Array.isArray(rows)) kb.fail(503, 'The ' + lane.label + ' open-data feed returned an unsupported response. No notices are implied.');
  if (rows.length >= MAX_ITEMS) kb.fail(503, 'The ' + lane.label + ' open-data feed coverage needs review before notices can be displayed. Visit the original source.');
  return rows;
}
async function snapshot(c, event, slug) {
  const lane = laneConfig(slug);
  return cached(c, F.mac('socrata:' + lane.slug + ':snapshot:v1'), async () => {
    const records = (await fetchRows(c, event, lane.slug)).map(x => normalize(x, lane.slug)).filter(Boolean);
    return {records, checkedAt: new Date().toISOString()};
  });
}
async function search(c, event, p, slug) {
  const lane = laneConfig(slug);
  const keyword = p.keyword ?? '', page = p.page ?? 0;
  if (typeof keyword !== 'string' || keyword.length > 100 || /[\x00-\x1f]/.test(keyword) || !Number.isInteger(page) || page < 0 || page > 9) kb.fail(400, 'Use a keyword up to 100 characters and a supported results page.');
  const data = await snapshot(c, event, lane.slug);
  const today = new Date().toISOString().slice(0, 10);
  const open = data.records.filter(x => !x.deadline || x.deadline.slice(0, 10) >= today);
  const needle = keyword.trim().toLocaleLowerCase('en-US');
  const matched = open.filter(x => !needle || [x.title, x.agency, x.reference || ''].join(' ').toLocaleLowerCase('en-US').includes(needle));
  matched.sort((a, b) => b.posted.localeCompare(a.posted) || b.id.localeCompare(a.id));
  return {items: matched.slice(page * 25, page * 25 + 25), page, hasMore: matched.length > (page + 1) * 25, total: matched.length, checkedAt: data.checkedAt, cached: data.cached, notice: SEARCH_NOTICES[lane.slug]};
}
function detailId(value, slug) {
  const lane = laneConfig(slug);
  if (typeof value !== 'string' || !ID_PATTERNS[lane.slug].test(value.trim())) kb.fail(400, ID_HINTS[lane.slug]);
  return value.trim();
}
async function detail(c, event, value, slug) {
  const lane = laneConfig(slug);
  const id = detailId(value, lane.slug);
  const data = await cached(c, F.mac('socrata:' + lane.slug + ':detail:' + id), async () => {
    const item = (await snapshot(c, event, lane.slug)).records.find(x => x.id === id);
    if (!item) kb.fail(404, 'This ' + lane.label + ' opportunity is not in the current open-data feed. It may have closed or changed. Paste or upload the original solicitation instead.');
    return {item, text: '', notice: DETAIL_NOTICES[lane.slug]};
  });
  return data;
}
module.exports = {laneConfig, feedUrl, normalize, search, detail, detailId, LANES, MONTGOMERY_SEARCH};
