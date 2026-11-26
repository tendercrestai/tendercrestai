import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  createActionQueue, truncate, isNeedsInputOnly, partitionJobs, dedupeDraftJobs,
  matchEvidenceOutcome, matchOutcomeSurvivesTabChange, planCardId,
  knowledgeDocumentStatusText, formatFileSize,
  formatWarningReview, checklistCountsLine, formatActivityDate,
  shortId, countText, bidFactorLabel, shouldShowTrialCheckout, sourceLineText,
} from '../assets/ui-helpers.mjs';

// Regression tests for the Nov 18, 2026 end-to-end sweep fixes (single PR,
// branch e2e-sweep-fixes-nov18). Browser modules import these pure helpers;
// the DOM wiring itself is covered by the static assertions below.

// --- Finding #3: action queue -------------------------------------------
function harness() {
  let busy = false, text = 'start';
  const notes = [];
  const q = createActionQueue({
    isBusy: () => busy,
    setBusy: (v) => { busy = v; },
    notify: (t) => notes.push(t),
    readMessage: () => text,
    delayMs: 10,
  });
  return {q, notes, get busy() { return busy; }, set text(v) { text = v; }};
}

test('action queue runs one action at a time and keeps only the latest queued action', async () => {
  const {q} = harness();
  const ran = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const first = q.run(async () => { ran.push('first'); await gate; });
  await new Promise((r) => setTimeout(r, 5));
  void q.run(async () => { ran.push('second'); });
  void q.run(async () => { ran.push('third'); });
  assert.equal(q.isRunning(), true);
  release();
  await first;
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(ran, ['first', 'third']);
  assert.equal(q.isRunning(), false);
});

test('slow actions report Working after the delay when nothing else was reported', async () => {
  const {q, notes} = harness();
  await q.run(async () => { await new Promise((r) => setTimeout(r, 30)); });
  assert.deepEqual(notes, ['Working…']);
});

test('Working is suppressed when the action reported its own progress', async () => {
  const h = harness();
  await h.q.run(async () => { h.text = 'Analyzing chunk 1 / 8'; await new Promise((r) => setTimeout(r, 30)); });
  assert.deepEqual(h.notes, []);
});

test('drain runs a queued action after an external busy holder clears', async () => {
  let busy = true;
  const ran = [];
  const q = createActionQueue({
    isBusy: () => busy, setBusy: (v) => { busy = v; },
    notify: () => {}, readMessage: () => '', delayMs: 10,
  });
  void q.run(async () => { ran.push('queued'); });
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(ran, []);
  busy = false;
  q.drain();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(ran, ['queued']);
});

// --- Finding #6: truncation and source lines ----------------------------
test('truncate adds an ellipsis only when the text is actually cut', () => {
  assert.equal(truncate('short', 120), 'short');
  assert.equal(truncate('x'.repeat(120), 120), 'x'.repeat(120));
  assert.equal(truncate('x'.repeat(121), 120), 'x'.repeat(120) + '…');
});

test('pasted-text sources with no section and no page get no source line', () => {
  assert.equal(sourceLineText({}), null);
  assert.equal(sourceLineText({section: null, page: null}), null);
  // A missing part is omitted, never labelled unavailable: a .txt source
  // has no PDF page, and a section without a page is still a section.
  assert.equal(sourceLineText({section: 'Section 2', page: null}), 'Section 2');
  assert.equal(sourceLineText({section: null, page: 3}), 'PDF page 3');
  assert.equal(sourceLineText({section: 'Section 2', page: 3}), 'Section 2 · PDF page 3');
});

// --- Finding #4: placeholder-only previews and duplicate jobs -----------
test('a preview of only NEEDS INPUT placeholders has no draftable evidence', () => {
  assert.equal(isNeedsInputOnly('[NEEDS INPUT: approved, current evidence for requirement 1]'), true);
  assert.equal(isNeedsInputOnly('[NEEDS INPUT: a]\n\n[NEEDS REVIEW: evidence only needs review for requirement 2]'), true);
  assert.equal(isNeedsInputOnly('[NEEDS INPUT: a]\n\nWe hold ISO 27001 certification.'), false);
  assert.equal(isNeedsInputOnly('Requirement 1 was explicitly excluded from scope by an authorized reviewer.'), false);
  assert.equal(isNeedsInputOnly(''), true);
});

test('draft jobs dedupe to the latest per section, revision and status', () => {
  const jobs = [
    {id: 'a', kind: 'draft', status: 'Completed', revision: 1, created_at: '2026-11-18T10:00:00Z', result: {sectionId: 's1'}},
    {id: 'b', kind: 'draft', status: 'Completed', revision: 1, created_at: '2026-11-18T11:00:00Z', result: {sectionId: 's1'}},
    {id: 'c', kind: 'draft', status: 'Failed', revision: 1, created_at: '2026-11-18T11:30:00Z', result: {sectionId: 's1'}},
    {id: 'd', kind: 'draft', status: 'Completed', revision: 2, created_at: '2026-11-18T12:00:00Z', result: {sectionId: 's1'}},
    {id: 'e', kind: 'draft', status: 'Completed', revision: 1, created_at: '2026-11-18T12:30:00Z', result: {sectionId: 's2'}},
  ];
  assert.deepEqual(dedupeDraftJobs(jobs).map((j) => j.id), ['e', 'd', 'c', 'b']);
});

// --- Finding #19: exports partition --------------------------------------
test('exports partition export and draft jobs, newest first', () => {
  const jobs = [
    {id: 'old-export', kind: 'export', status: 'Completed', created_at: '2026-11-18T09:00:00Z'},
    {id: 'new-draft', kind: 'draft', status: 'Completed', created_at: '2026-11-18T12:00:00Z'},
    {id: 'new-export', kind: 'export', status: 'Completed', created_at: '2026-11-18T11:00:00Z'},
  ];
  const {exports: ex, drafts: dr} = partitionJobs(jobs);
  assert.deepEqual(ex.map((j) => j.id), ['new-export', 'old-export']);
  assert.deepEqual(dr.map((j) => j.id), ['new-draft']);
});

// --- Finding #9: honest evidence-match outcomes --------------------------
test('evidence matching reports the honest suggestion count', () => {
  const state = {evidence: [
    {requirementId: 'r1', decision: 'suggested'},
    {requirementId: 'r1', decision: 'suggested'},
    {requirementId: 'r1', decision: 'accepted'},
    {requirementId: 'r2', decision: 'suggested'},
  ]};
  assert.deepEqual(matchEvidenceOutcome(state, 'r1'), {suggested: 2, found: true});
  assert.deepEqual(matchEvidenceOutcome(state, 'r2'), {suggested: 1, found: true});
  assert.deepEqual(matchEvidenceOutcome(state, 'r3'), {suggested: 0, found: false});
  assert.deepEqual(matchEvidenceOutcome({}, 'r1'), {suggested: 0, found: false});
});

// --- Finding #13: recorded source review ---------------------------------
test('a recorded source review formats with its date and reason', () => {
  assert.equal(formatWarningReview(null), null);
  const line = formatWarningReview({reason: 'Checked the originals.', createdAt: '2026-11-18T10:00:00Z', actor: 'u1', fingerprint: 'x'});
  assert.match(line, /^Source review recorded /);
  assert.match(line, /Checked the originals\.$/);
});

// --- Finding #20: checklist line and activity log ------------------------
test('checklist counts line is useful when nothing is drafted yet', () => {
  assert.match(checklistCountsLine(0, null), /No response text drafted yet/);
  assert.equal(checklistCountsLine(42, null), '42 response words · unmeasured PDF pages. DOCX pagination is not measured.');
  assert.equal(checklistCountsLine(42, 3), '42 response words · 3 PDF pages. DOCX pagination is not measured.');
});

test('activity dates are local and actor ids are shortened, not raw', () => {
  assert.ok(!/T\d\d:\d\d:\d\d/.test(formatActivityDate('2026-11-18T10:00:00Z')));
  assert.equal(formatActivityDate('not-a-date'), 'not-a-date');
  assert.equal(shortId('11111111-1111-4111-8111-111111111111'), '11111111…');
  assert.equal(shortId('abc'), 'abc');
});

// --- Finding #16: counts and factor labels -------------------------------
test('counts pluralize and bid factor keys get human labels', () => {
  assert.equal(countText(1, 'requirement', 'requirements'), '1 requirement');
  assert.equal(countText(3, 'mandatory requirement', 'mandatory requirements'), '3 mandatory requirements');
  assert.equal(bidFactorLabel('pastPerformance'), 'Past performance');
  assert.equal(bidFactorLabel('readiness'), 'Delivery readiness');
  assert.equal(bidFactorLabel('unknown-key'), 'unknown-key');
});

// --- Finding #14: trial upsell -------------------------------------------
test('trial checkout shows only without an active allowance, and fails open', () => {
  assert.equal(shouldShowTrialCheckout(null), true);
  assert.equal(shouldShowTrialCheckout({}), true);
  assert.equal(shouldShowTrialCheckout({available: false, state: 'no_plan'}), true);
  assert.equal(shouldShowTrialCheckout({available: true, state: 'complimentary', plan: 'Enterprise'}), false);
  assert.equal(shouldShowTrialCheckout({available: true, state: 'trial'}), false);
});

// --- Static assertions: DOM wiring the node tests cannot execute ---------
const root = new URL('../', import.meta.url);
async function read(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('auth page starts on no visible form so signed-in visitors never see the login flash', async () => {
  const html = await read('auth.html');
  assert.match(html, /<section id="login" class="hidden">/);
  assert.match(html, /__authLoginFallback/);
});

test('hero video loads metadata so its duration shows instead of 0:00', async () => {
  const html = await read('index.html');
  assert.match(html, /<video[^>]*preload="metadata"/);
  assert.doesNotMatch(html, /<video[^>]*preload="none"/);
});

test('footer settings buttons carry their own small outlined style on every page', async () => {
  for (const file of ['assets/analytics.mjs', 'assets/google-ads.mjs', 'assets/openai-pixel.mjs', 'assets/rewardful.mjs']) {
    const source = await read(file);
    assert.match(source, /background:transparent/, file);
    assert.match(source, /width:auto/, file);
    assert.match(source, /display:inline-block/, file);
  }
});

test('sticky status banners are height-capped so they cannot cover content below', async () => {
  // The cap is 96px, not 56px: a one-line message plus padding sat right at
  // the old cap and grew its own nested scrollbar (final E2E sweep #5).
  // Nov 25 full-site review, logged-in #6: the workspace banner is no
  // longer sticky at all — it was a fixed 96px offset under a variable-
  // height sticky message, so it overlapped content. The tabs are now the
  // only sticky bar (top:0), and the message flows in place above them.
  for (const file of ['assets/knowledge.css', 'assets/compliance.css']) {
    const css = await read(file);
    assert.match(css, /#message\{[^}]*max-height:96px;overflow:auto/, file);
  }
  const workspaceCss = await read('assets/workspace.css');
  assert.match(workspaceCss, /#message\{position:static;[^}]*max-height:96px;overflow:auto/, 'workspace.css');
  assert.match(workspaceCss, /#tabs\{position:sticky;top:0;[^}]*\}/, 'workspace.css');
  assert.doesNotMatch(workspaceCss, /#tabs\{[^}]*top:96px/, 'workspace.css');
});

test('free-tool pages load the fictional sample inline instead of linking away', async () => {
  for (const file of ['shredder.html', 'bid-check.html']) {
    const html = await read(file);
    assert.match(html, /id="load-sample"/, file);
    assert.doesNotMatch(html, /Try the fictional demo/, file);
  }
});

test('build publishes the shared UI helpers the workspace imports', async () => {
  const build = await read('scripts/build-site.mjs');
  assert.match(build, /"ui-helpers\.mjs"/);
  const workspace = await read('assets/workspace.mjs');
  assert.match(workspace, /from '\.\/ui-helpers\.mjs'/);
});

// --- Nov 25 full-site review, logged-in #11: current-plan marking ------
// The plan string comes from the account-usage endpoint, never from
// client-side guessing. Grant plans are checked first: "Grant Pro" starts
// with "Pro" too, so a plain prefix match would map it to the RFP Pro card.
test('planCardId maps the account plan string to a pricing section id', () => {
  assert.equal(planCardId('Grant Starter ($19/mo)'), 'grant-starter');
  assert.equal(planCardId('Grant Plus ($49/mo)'), 'grant-plus');
  assert.equal(planCardId('Grant Pro ($99/mo)'), 'grant-pro');
  assert.equal(planCardId('Pro ($299/mo)'), 'pro');
  assert.equal(planCardId('Growth ($699/mo)'), 'growth');
  assert.equal(planCardId('Enterprise ($1,299/mo)'), 'enterprise');
  assert.equal(planCardId('Enterprise'), 'enterprise');
  assert.equal(planCardId('Something else'), null);
  assert.equal(planCardId(''), null);
  assert.equal(planCardId(null), null);
});

// --- Nov 25 full-site review, logged-in #1: match outcome survives -----
// render() used to clear the match outcome on every tab change, including
// the switch TO the Evidence tab that the match itself triggered.
test('the evidence-match outcome survives only the switch to the Evidence tab', () => {
  assert.equal(matchOutcomeSurvivesTabChange('Evidence'), true);
  assert.equal(matchOutcomeSurvivesTabChange('Requirements'), false);
  assert.equal(matchOutcomeSurvivesTabChange('Overview'), false);
});

// --- Nov 25 full-site review, logged-in #7: failed KB source detail -----
test('a failed knowledge source explains itself even with no recorded error code', () => {
  assert.equal(knowledgeDocumentStatusText({status: 'Ready'}), 'Ready');
  assert.equal(knowledgeDocumentStatusText({status: 'Pending'}), 'Processing');
  assert.match(knowledgeDocumentStatusText({status: 'Failed'}), /no error detail was recorded/);
  assert.match(knowledgeDocumentStatusText({status: 'Failed'}), /Process \/ retry/);
  assert.match(knowledgeDocumentStatusText({status: 'Failed', error_code: 'extraction_failed'}), /could not extract text/);
  assert.match(knowledgeDocumentStatusText({status: 'Failed', error_code: 'embedding_failed'}), /could not embed/);
  assert.match(knowledgeDocumentStatusText({status: 'Failed', error_code: 'kb_timeout'}), /kb_timeout/);
});

test('file sizes render as KB below 1 MB and MB above', () => {
  assert.equal(formatFileSize(1536), '1.5 KB');
  assert.equal(formatFileSize(1048576), '1.0 MB');
  assert.equal(formatFileSize(2560000), '2.4 MB');
  assert.equal(formatFileSize(null), null);
  assert.equal(formatFileSize(-1), null);
});
