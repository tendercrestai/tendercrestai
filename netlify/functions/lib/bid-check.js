const kb = require('./knowledge-base');
const DAY = 86400000;
const REVIEW = 'Needs human review; response and evidence not supplied';
const DISCLAIMER = 'This verdict does not predict whether you will win. It only weighs the facts you gave us.';
const BANDS = {
 strong: ['Strong fit — worth pursuing.', 'The deadline, eligibility, and evidence picture all point the same way. Put this one in the pipeline.'],
 closer: ['Worth a closer look.', 'There is a real case for bidding, but one or two factors need a decision from you first. Read the reasons below.'],
 pass: ['Likely pass.', 'On the facts given, this bid would cost more than it is likely to return. Your time is better spent on a stronger fit.']
};
function date(value) {
 if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) kb.fail(400, 'Enter a valid response deadline.');
 const time = Date.parse(value + 'T00:00:00Z');
 if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) kb.fail(400, 'Enter a valid response deadline.');
 return time;
}
function answers(value) {
 kb.exact(value, ['deadline', 'hours', 'eligibility', 'performance', 'evidence']);
 date(value.deadline);
 if (typeof value.hours !== 'number' || !Number.isFinite(value.hours) || value.hours < 0 || value.hours > 100000) kb.fail(400, 'Enter team hours between 0 and 100,000.');
 for (const [name, allowed] of Object.entries({eligibility: ['yes', 'no', 'unsure'], performance: ['similar', 'related', 'none'], evidence: ['most', 'some', 'little']})) {
  if (!allowed.includes(value[name])) kb.fail(400, 'Answer all five questions.');
 }
 return {...value};
}
function score(requirements, input, asOf) {
 const a = answers(input), days = Math.round((date(a.deadline) - date(asOf)) / DAY);
 if (!Array.isArray(requirements) || !requirements.length) kb.fail(422, 'No requirements were extracted. A fit verdict cannot be computed. Review the source manually.');
 const mandatory = requirements.filter(r => r.mandatory === 'Yes').length;
 const deadline = days < 0 || (days < 7 && mandatory >= 15) ? 0 : days >= 21 || (mandatory < 15 && days >= 7) ? 2 : 1;
 const factor = (id, label, points, working, reason) => ({id, label, points, working, reason: label + ': ' + reason + ' (' + points + (points === 1 ? ' point).' : ' points).')});
 const factors = [
  factor('deadline', 'Deadline feasibility', deadline, days + ' days left, ' + mandatory + ' mandatory requirements.', deadline === 2 ? 'the response window meets the timing rule' : deadline === 1 ? 'the response window needs a closer review' : 'the response window does not meet the timing rule'),
  factor('hours', 'Hours available', a.hours >= 40 ? 2 : a.hours >= 15 ? 1 : 0, a.hours + ' team hours.', a.hours >= 40 ? 'you entered at least 40 team hours' : a.hours >= 15 ? 'you entered 15 to under 40 team hours' : 'you entered fewer than 15 team hours'),
  factor('eligibility', 'Eligibility', {yes: 2, unsure: 1, no: 0}[a.eligibility], {yes: 'Yes', unsure: 'Not sure / not stated', no: 'No'}[a.eligibility], {yes: 'you report meeting the stated requirements', unsure: 'the eligibility position is not confirmed', no: 'you do not meet the stated requirements'}[a.eligibility]),
  factor('performance', 'Past performance', {similar: 2, related: 1, none: 0}[a.performance], {similar: 'Yes, similar work', related: 'Somewhat related', none: 'No'}[a.performance], {similar: 'you report similar work', related: 'you report somewhat related work', none: 'you report no similar work'}[a.performance]),
  factor('evidence', 'Evidence', {most: 2, some: 1, little: 0}[a.evidence], {most: 'Most of it', some: 'Some of it', little: 'Little or none'}[a.evidence], {most: 'you report holding most core evidence', some: 'you report holding some core evidence', little: 'you report little or no core evidence'}[a.evidence])
 ];
 const total = factors.reduce((sum, f) => sum + f.points, 0), overrides = [];
 if (days < 0) overrides.push('The response deadline has passed or is too close to prepare a compliant bid.');
 if (a.eligibility === 'no') overrides.push('You do not meet the stated eligibility requirements.');
 const band = overrides.length || total < 5 ? 'pass' : total < 8 ? 'closer' : 'strong';
 const reasons = [...factors].sort((x, y) => y.points - x.points).slice(0, 3).map(f => f.reason);
 const gaps = requirements.slice(0, 3).map(r => ({requirement: r.requirement, flag: r.recommendation, status: REVIEW}));
 return {version: 1, asOf, deadline: a.deadline, days, total, band, verdict: BANDS[band][0], subline: BANDS[band][1], factors, overrides, reasons, gaps, requirementCount: requirements.length, mandatoryCount: mandatory, disclaimer: DISCLAIMER};
}
async function find(config, id) {
 const rows = await require('./free-tools').db(config, 'ft_bidchecks?id=eq.' + kb.uuid(id));
 return rows[0] || null;
}
async function result(config, job, row) {
 row = row || await find(config, job.id);
 if (!row) kb.fail(404, 'Bid check not found. Start a new check.');
 if (job.status !== 'Completed') return null;
 if (row.verdict) return row.verdict;
 const verdict = score(job.requirements, row.answers, row.as_of);
 await require('./free-tools').db(config, 'ft_bidchecks?id=eq.' + job.id + '&verdict=is.null', {method: 'PATCH', body: {verdict}});
 return verdict;
}
async function report(job, verdict) {
 const {csv} = await import('../../../assets/compliance-export.mjs');
 const appendix = csv({analysis: {id: job.id, status: 'Completed', warnings: job.warnings, facts: []}, requirements: job.requirements.map((r, i) => ({...r, id: String(i + 1), original_requirement: r.requirement, duplicate_count: r.duplicate_count || 0}))});
 return ['TenderCrest AI bid-check breakdown', job.title, 'Source: ' + (job.source || 'Not supplied'), 'Rules version: 1; evaluated using UTC date ' + verdict.asOf, 'Deadline entered: ' + verdict.deadline, '', verdict.verdict, verdict.subline, 'Score: ' + verdict.total + ' out of 10. This is a fit score, not an award forecast.', ...verdict.overrides, '', 'Factor breakdown', ...verdict.factors.map(f => f.label + ': ' + f.points + '/2. ' + f.working), '', 'Top 3 reasons', ...verdict.reasons, '', 'Top 3 gaps that would cost you the win', ...verdict.gaps.map(g => g.requirement + ' — ' + g.flag + ' — ' + g.status), '', 'Requirements: ' + verdict.requirementCount + '; mandatory: ' + verdict.mandatoryCount, '', 'All extracted review flags', ...job.requirements.map((r, i) => (i + 1) + '. ' + r.requirement + '\n' + r.recommendation + ' — ' + REVIEW), '', 'This verdict uses only extracted requirements and your five answers. It does not know your pricing, unread attachments or capacity beyond the hours entered. Every requirement needs human review.', verdict.disclaimer, '', 'Requirement appendix (CSV from the existing compliance exporter)', appendix].join('\n');
}
async function send(config, job, lead, row) {
 const verdict = await result(config, job, row), document = await report(job, verdict);
 return require('./free-tools').mail(config, job, lead, {filename: 'bid-check-breakdown.txt', document, customerSubject: 'Your TenderCrest AI bid-check breakdown', customerText: 'Your requested bid-check breakdown is attached. ' + DISCLAIMER, adminSubject: 'New free bid-check lead', adminExtra: '\nVerdict: ' + verdict.verdict + '\nFit score: ' + verdict.total + '/10', prefix: 'free-bidcheck'});
}
module.exports = {answers, date, score, find, result, report, send, DISCLAIMER};
