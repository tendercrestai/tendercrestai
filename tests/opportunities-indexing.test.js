const {test} = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
function read(name) { return fs.readFileSync(path.join(root, name), 'utf8'); }
function faq(html) {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(m, 'FAQPage JSON-LD present');
  const data = JSON.parse(m[1]);
  assert.equal(data['@type'], 'FAQPage');
  assert.ok(Array.isArray(data.mainEntity) && data.mainEntity.length >= 5, 'at least 5 FAQ entries');
  return data.mainEntity;
}
function visibleFaq(html) {
  const section = html.match(/<section><h2>Questions about this feed<\/h2>([\s\S]*?)<\/section>/);
  assert.ok(section, 'visible FAQ section present');
  const questions = [...section[1].matchAll(/<h3>([^<]+)<\/h3><p>([^<]+)<\/p>/g)].map(x => ({name: x[1], text: x[2]}));
  assert.ok(questions.length >= 5, 'at least 5 visible FAQ entries');
  return questions;
}
for (const [page, expected] of [
  ['opportunities.html', ['Is searching federal opportunities free?', 'How current are the results?', 'What is a NAICS code?', 'What does a set-aside mean?', 'Can I shred a solicitation I find here?']],
  ['nyc-opportunities.html', ['Is searching NYC notices free?', 'What is City Record Online?', 'Does a listed deadline mean the bid is still open?', 'How fresh is this feed?', 'Can I shred a NYC notice?']],
  ['grants-opportunities.html', ['Is searching federal grants free?', 'Are these grants or contracts?', "Why don't results show award amounts?", 'How fresh is this feed?', 'Can I shred a grant?']],
  ['la-opportunities.html', ['Is searching Los Angeles notices free?', 'What is RAMP?', 'Does a listed close date mean the bid is still open?', 'Why do some notices say the close date is not stated?', 'Can I shred a Los Angeles notice?']],
  ['delaware-opportunities.html', ['Is searching Delaware bids free?', 'What is the Delaware open bids feed?', 'Why is the agency shown as a code?', 'Does a listed deadline mean the bid is still open?', 'Can I shred a Delaware bid?']],
  ['montgomery-opportunities.html', ['Is searching Montgomery County notices free?', 'What is this feed?', 'Why does every result link to the county search page?', 'Does a listed close date mean the bid is still open?', 'Can I shred a Montgomery County notice?']],
  ['dc-opportunities.html', ['Is searching DC solicitations free?', 'What is PASS?', 'Why does every result link to the OCP site?', 'Does a listed close date mean the bid is still open?', 'Can I shred a DC solicitation?']],
  ['webs-opportunities.html', ['Is searching Washington notices free?', 'What is WEBS?', 'Does a listed close date mean the bid is still open?', 'Why do some notices say the close date is not stated?', 'Can I shred a Washington notice?']],
]) {
  test(page + ' carries indexable guide copy and a visible FAQ matching its FAQPage JSON-LD', () => {
    const html = read(page);
    assert.ok(!/SAM_GOV_API_KEY|api_key/.test(html), 'no API key material in served HTML');
    for (const heading of ['How to use this feed', 'Questions about this feed']) assert.ok(html.includes('<h2>' + heading + '</h2>'), heading);
    assert.ok(html.includes('/tools/shredder'), 'links to the free shredder');
    assert.ok(html.includes('/tools/bid-check'), 'links to the bid checker');
    const ld = faq(html), visible = visibleFaq(html);
    assert.deepEqual(ld.map(q => q.name), expected);
    assert.deepEqual(visible.map(q => q.name), expected);
    for (let i = 0; i < expected.length; i++) assert.equal(ld[i].acceptedAnswer.text, visible[i].text, 'JSON-LD answer matches visible answer for: ' + expected[i]);
  });
}
test('federal opportunities page explains every search filter', () => {
  const html = read('opportunities.html');
  for (const text of ['Title keyword', 'NAICS', 'PSC', 'Set-aside', 'small business, partial small business, 8(a), 8(a) sole source, HUBZone, service-disabled veteran-owned, women-owned, and economically disadvantaged women-owned']) assert.ok(html.includes(text), text);
});
test('NYC opportunities page states its source, freshness and limits', () => {
  const html = read('nyc-opportunities.html');
  for (const text of ['City Record Online', 'NYC Open Data', 'refreshes about once an hour', 'up to 24 hours with a warning', 'Attachments are not imported']) assert.ok(html.includes(text), text);
});
test('grants opportunities page labels the lane as grants, not contracts, and states its limits', () => {
  const html = read('grants-opportunities.html');
  for (const text of ['Grants.gov', 'grants, not contracts', 'cached for up to one hour', 'Attachments are not imported', 'not award amounts or eligibility']) assert.ok(html.includes(text), text);
});
test('Los Angeles opportunities page states its source, close-date reading and value limit', () => {
  const html = read('la-opportunities.html');
  for (const text of ['RAMP', 'close date is not stated', 'cached for up to one hour', 'Attachments are not imported', 'No estimated value is published by this feed']) assert.ok(html.includes(text), text);
});
test('Delaware opportunities page states its source, weekly updates and value limit', () => {
  const html = read('delaware-opportunities.html');
  for (const text of ['Delaware open bids', 'updated weekly', 'cached for up to one hour', 'Attachments are not imported', 'No estimated value is published by this feed']) assert.ok(html.includes(text), text);
});
test('Montgomery County opportunities page states its source, search-page link and value limit', () => {
  const html = read('montgomery-opportunities.html');
  for (const text of ['Montgomery County', 'county solicitation search page', 'cached for up to one hour', 'Attachments are not imported', 'No estimated value is published by this feed']) assert.ok(html.includes(text), text);
});
test('DC opportunities page states its source, close-date rule and value limit', () => {
  const html = read('dc-opportunities.html');
  for (const text of ['PASS', 'close date as the operative deadline', 'cached for up to one hour', 'Attachments are not imported', 'No estimated value is published by this feed']) assert.ok(html.includes(text), text);
});
test('Washington opportunities page states its source, login need and value limit', () => {
  const html = read('webs-opportunities.html');
  for (const text of ['WEBS', 'close date not stated', 'cached for up to one hour', 'Attachments are not imported', 'No estimated value is published by this feed', 'Full solicitation documents need a free WEBS login', 'soonest-closing']) assert.ok(html.includes(text), text);
});
test('shredder offers all eight opportunity providers and maps each to its detail endpoint', () => {
  const shredder = read('shredder.html');
  for (const value of ['value="sam"', 'value="nyc"', 'value="grants"', 'value="los-angeles"', 'value="delaware"', 'value="montgomery-county"', 'value="dc"', 'value="webs"']) assert.ok(shredder.includes(value), value);
  const client = read('assets/free-tools.mjs');
  for (const path of ["sam:'opportunities'", "nyc:'nyc-opportunities'", "grants:'grants-opportunities'", "'los-angeles':'la-opportunities'", "delaware:'delaware-opportunities'", "'montgomery-county':'montgomery-opportunities'", "dc:'dc-opportunities'", "webs:'webs-opportunities'"]) assert.ok(client.includes(path), path);
});
test('sitemap lists all eight opportunity feeds', () => {
  const sitemap = read('sitemap.xml');
  assert.ok(sitemap.includes('<loc>https://www.tendercrestai.com/opportunities</loc>'), 'federal feed in sitemap');
  assert.ok(sitemap.includes('<loc>https://www.tendercrestai.com/opportunities/nyc</loc>'), 'NYC feed in sitemap');
  assert.ok(sitemap.includes('<loc>https://www.tendercrestai.com/opportunities/grants</loc><lastmod>2026-11-19</lastmod>'), 'grants feed in sitemap');
  assert.ok(sitemap.includes('<loc>https://www.tendercrestai.com/opportunities/los-angeles</loc><lastmod>2026-11-20</lastmod>'), 'Los Angeles feed in sitemap');
  assert.ok(sitemap.includes('<loc>https://www.tendercrestai.com/opportunities/delaware</loc><lastmod>2026-11-20</lastmod>'), 'Delaware feed in sitemap');
  assert.ok(sitemap.includes('<loc>https://www.tendercrestai.com/opportunities/montgomery-county</loc><lastmod>2026-11-20</lastmod>'), 'Montgomery County feed in sitemap');
  assert.ok(sitemap.includes('<loc>https://www.tendercrestai.com/opportunities/dc</loc><lastmod>2026-11-20</lastmod>'), 'DC feed in sitemap');
  assert.ok(sitemap.includes('<loc>https://www.tendercrestai.com/opportunities/washington</loc><lastmod>2026-11-19</lastmod>'), 'Washington feed in sitemap');
});
test('every opportunity page links all eight sources in its source nav', () => {
  for (const page of ['opportunities.html', 'nyc-opportunities.html', 'grants-opportunities.html', 'la-opportunities.html', 'delaware-opportunities.html', 'montgomery-opportunities.html', 'dc-opportunities.html', 'webs-opportunities.html']) {
    const html = read(page);
    for (const href of ['/opportunities"', '/opportunities/nyc', '/opportunities/grants', '/opportunities/los-angeles', '/opportunities/delaware', '/opportunities/montgomery-county', '/opportunities/dc', '/opportunities/washington']) assert.ok(html.includes('href="' + href), page + ' links ' + href);
  }
});
