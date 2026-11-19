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
  ['bonfire-opportunities.html', ['Is searching Utah notices free?', 'What is Bonfire?', 'Does a listed close date mean the bid is still open?', 'Why do some notices say the close date is not stated?', 'Can I shred a Utah notice?']],
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
test('Utah opportunities page states its source, close-date reading and value limit', () => {
  const html = read('bonfire-opportunities.html');
  for (const text of ['Bonfire', 'close date not stated', 'cached for up to one hour', 'Attachments are not imported', 'No estimated value is published by this feed']) assert.ok(html.includes(text), text);
});
test('shredder offers all four opportunity providers and maps each to its detail endpoint', () => {
  const shredder = read('shredder.html');
  for (const value of ['value="sam"', 'value="nyc"', 'value="grants"', 'value="bonfire"']) assert.ok(shredder.includes(value), value);
  const client = read('assets/free-tools.mjs');
  for (const path of ["sam:'opportunities'", "nyc:'nyc-opportunities'", "grants:'grants-opportunities'", "bonfire:'bonfire-opportunities'"]) assert.ok(client.includes(path), path);
});
test('sitemap lists both opportunity feeds', () => {
  const sitemap = read('sitemap.xml');
  assert.ok(sitemap.includes('<loc>https://www.tendercrestai.com/opportunities</loc>'), 'federal feed in sitemap');
  assert.ok(sitemap.includes('<loc>https://www.tendercrestai.com/opportunities/nyc</loc>'), 'NYC feed in sitemap');
  assert.ok(sitemap.includes('<loc>https://www.tendercrestai.com/opportunities/grants</loc><lastmod>2026-11-19</lastmod>'), 'grants feed in sitemap');
  assert.ok(sitemap.includes('<loc>https://www.tendercrestai.com/opportunities/utah</loc><lastmod>2026-11-19</lastmod>'), 'Utah feed in sitemap');
});
