import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {
  createActionQueue, blockerBreakdownLine, memberLabel, formatAgencyName,
  truncateWord, opportunityCountLine,
} from '../assets/ui-helpers.mjs';

const require = createRequire(import.meta.url);
const core = require('../netlify/functions/lib/proposal-core');
const intelligence = require('../netlify/functions/lib/customer-intelligence');
const ai = require('../netlify/functions/lib/compliance-ai');
const kb = require('../netlify/functions/lib/knowledge-base');
const {load} = require('../netlify/functions/lib/reference-catalogue');

// Fictional RFPs only. No real customer document is used anywhere in this file.
const DOC = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let segN = 0;
const source = (section, page, quote) => ({document_id: DOC, document: 'Fictional RFP', segment_id: 'seg-' + (++segN), page, section, quote});
const reqRow = (id, text, mandatory, category = 'Technical') => ({
  id, text, mandatory, category,
  sources: [source('Section L', 2, text)],
});
const fixtureWorkspace = (list) => ({analysis: {id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', fingerprint: 'fp', status: 'Completed', warnings: [], documents: [{id: DOC, name: 'Fictional RFP', segments: list.map(r => ({id: r.sources[0].segment_id, page: r.sources[0].page, section: r.sources[0].section, text: r.sources[0].quote}))}], facts: []},
  requirements: list.map(r => ({...r, fingerprint: undefined, original_requirement: r.text, requirement: r.text, evaluation_weight: null, uncertain: false, duplicate_count: 0}))});
const importedState = (list) => core.imported(core.initial('Fictional', 'Fictional'), fixtureWorkspace(list));
const realCatalogue = () => load(path.join(path.dirname(fileURLToPath(import.meta.url)), '../reference-library'));
const sectionFor = (s, requirementId) => s.sections.find(x => x.requirementIds.includes(requirementId));

test('a slow action restores the previous banner message instead of leaving "Working…"', async () => {
  let busy = false, msg = 'Saved project loaded.';
  const q = createActionQueue({isBusy: () => busy, setBusy: (v) => { busy = v; }, notify: (t) => { msg = t; }, readMessage: () => msg, delayMs: 5});
  await q.run(async () => { await new Promise((r) => setTimeout(r, 30)); });
  assert.equal(msg, 'Saved project loaded.');
});

test('an action that sets its own message keeps it after the queue restores', async () => {
  let busy = false, msg = 'Before';
  const q = createActionQueue({isBusy: () => busy, setBusy: (v) => { busy = v; }, notify: (t) => { msg = t; }, readMessage: () => msg, delayMs: 5});
  await q.run(async () => { await new Promise((r) => setTimeout(r, 30)); msg = 'Done.'; });
  assert.equal(msg, 'Done.');
});

test('checklist breakdown splits the total by blocker kind', () => {
  assert.equal(blockerBreakdownLine({requirements: 151, attachments: 0, sections: 162, other: 0, total: 313}), '313 items: 151 requirement items, 162 section items.');
  assert.equal(blockerBreakdownLine({requirements: 0, attachments: 0, sections: 0, other: 0, total: 0}), '');
});

test('member labels prefer a display name and fall back to a short ID', () => {
  const members = [{user_id: '11111111-1111-4111-8111-111111111111', label: 'Ada'}];
  assert.equal(memberLabel(members, '11111111-1111-4111-8111-111111111111'), 'Ada');
  assert.equal(memberLabel(members, '22222222-2222-4222-8222-222222222222'), '22222222…');
});

test('agency names use the most specific SAM.gov path segment in title case', () => {
  assert.equal(formatAgencyName('DEPT OF DEFENSE.DEPT OF THE ARMY.US ARMY CORPS OF ENGINEERS'), 'Us Army Corps of Engineers');
  assert.equal(formatAgencyName(''), 'Agency not supplied');
});

test('word-boundary truncation never cuts a word in half', () => {
  assert.equal(truncateWord('DEPT OF DEFENSE.DEPT OF THE ARMY', 20), 'DEPT OF DEFENSE.DEPT…');
  assert.equal(truncateWord('short', 20), 'short');
});

test('opportunity count line states page size, page, and total', () => {
  assert.equal(opportunityCountLine(8, 200, 0), '8 of 200 open opportunities · page 1 (25 per page)');
  assert.equal(opportunityCountLine(8, null, 0), '8 open opportunities · page 1 (25 per page)');
});

test('readiness classifies blockers so the checklist total explains itself', () => {
  const s = importedState([
    reqRow('11111111-1111-4111-8111-111111111111', 'The vendor must meet the technical specification and hold current ISO 27001 certification.', 'Yes'),
    reqRow('22222222-2222-4222-8222-222222222222', 'The vendor must submit a signed certificate of insurance.', 'Yes', 'Attachment'),
    reqRow('33333333-3333-4333-8333-333333333333', 'The vendor should describe its sustainability service program.', 'No'),
  ]);
  const r = core.readiness(s, 0, null);
  assert.equal(r.blockerCounts.total, r.blockers.length);
  assert.equal(r.blockerCounts.requirements, 2);
  // The Attachment requirement has no linked attachment yet.
  assert.equal(r.blockerCounts.attachments, 1);
  assert.equal(r.blockerCounts.sections, 3);
});

test('readiness summary splits evidence gaps and names the non-mandatory remainder', () => {
  const s = importedState([
    reqRow('11111111-1111-4111-8111-111111111111', 'The vendor must meet the technical specification and hold current ISO 27001 certification.', 'Yes'),
    reqRow('22222222-2222-4222-8222-222222222222', 'The vendor should describe its sustainability service program.', 'No'),
  ]);
  const sum = core.readinessSummary(s);
  assert.equal(sum.evidenceGapsMissing, 0);
  assert.equal(sum.evidenceGapsUnassessed, sum.evidenceGaps);
  assert.equal(sum.nonMandatoryUnresolved, 1);
  const lines = sum.lines.join(' ');
  assert.match(lines, /confirmed missing, \d+ not yet assessed/);
  assert.match(lines, /non-mandatory item also unresolved/);
  assert.match(lines, /can appear in several lines above/);
});

test('factor coverage note states the rule for what counts as covered', () => {
  const s = importedState([
    reqRow('11111111-1111-4111-8111-111111111111', 'Technical approach is weighted at 40 percent.', 'Yes', 'Evaluation'),
    reqRow('22222222-2222-4222-8222-222222222222', 'The vendor must meet the technical specification.', 'Yes'),
  ]);
  const fc = core.factorCoverage(s);
  assert.match(fc.note, /at least one section mapped to it has drafted response text/);
  assert.match(fc.note, /approval is separate/);
});

test('a section matching several groups joins its best-matching group, not the first', () => {
  const list = [
    reqRow('cccccccc-1111-4ccc-8ccc-cccccccccccc', 'The cover letter must include the pricing form and cost schedule.', 'Yes', 'Submission'),
    reqRow('cccccccc-2222-4ccc-8ccc-cccccccccccc', 'The vendor must meet the technical specification and hold current ISO 27001 certification.', 'Yes'),
  ];
  const s = importedState(list), sug = core.structureSuggestion(s, realCatalogue());
  assert.ok(sug);
  const byLabel = Object.fromEntries(sug.groups.map(g => [g.label, g.sectionIds]));
  // 'cover' matches Cover letter once, but 'pricing' and 'cost' match
  // Pricing twice, so the section belongs under Pricing.
  assert.deepEqual(byLabel['Pricing and cost schedule'], [sectionFor(s, list[0].id).id]);
  assert.deepEqual(byLabel['Cover letter and bidder forms'], []);
  assert.deepEqual(byLabel['Requirements response'], [sectionFor(s, list[1].id).id]);
});

test('audit mappings carry the readable requirement code', () => {
  const s = importedState([reqRow('11111111-1111-4111-8111-111111111111', 'The vendor must meet the technical specification.', 'Yes')]);
  const row = intelligence.mapping(s, s.requirements[0]);
  assert.match(row.stableId, /^REQ-[0-9A-F]{12}$/);
  assert.equal(row.requirementId, s.requirements[0].id);
});

test('similar pairs need the requirement field the workspace mapping supplies', () => {
  const pair = ai.similarPairs([
    {id: 'a', requirement: 'The vendor shall deliver the vehicle upfit by 30 June 2026.'},
    {id: 'b', requirement: 'The vendor shall deliver the vehicle upfit by 30 June 2026.'},
  ]);
  assert.deepEqual(pair, [['a', 'b']]);
  // State requirements carry `text`, not `requirement`: without the mapping
  // the same rows throw instead of pairing, which is why the workspace
  // mapping to `{id, requirement}` is load-bearing.
  assert.throws(() => ai.similarPairs([
    {id: 'a', text: 'The vendor shall deliver the vehicle upfit by 30 June 2026.'},
    {id: 'b', text: 'The vendor shall deliver the vehicle upfit by 30 June 2026.'},
  ]), TypeError);
});

test('citation chunks end on whole words, never mid-word', () => {
  const text = 'lorem ipsum dolor sit amet '.repeat(150);
  const chunks = kb.citationChunks({segments: [{id: 'seg-1', page: 1, section: 'Section A', text}]});
  assert.ok(chunks.length >= 2);
  for (const c of chunks) {
    const last = c.content.trim().split(/\s+/).pop();
    assert.ok(['lorem', 'ipsum', 'dolor', 'sit', 'amet'].includes(last), 'chunk ends mid-word: ' + JSON.stringify(c.content.slice(-20)));
  }
});
