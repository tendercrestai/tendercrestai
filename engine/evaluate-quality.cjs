// Offline evaluation only. No API calls, automation runs, customer records or email.
const fs = require('node:fs');
const dataset = require('./quality-benchmark.json');
const dimensions = ['accuracy', 'completeness', 'relevance', 'specificity', 'evidenceSupport'];
function evaluate(run, cases = dataset.cases) {
  if (!run || typeof run.runId !== 'string' || !run.runId.trim() ||
      typeof run.engineVersion !== 'string' || !run.engineVersion.trim() || !Array.isArray(run.outputs))
    throw new Error('Run ID, engine version and outputs are required.');
  if (run.datasetVersion !== dataset.version) throw new Error('Dataset version mismatch.');
  const expected = new Set(cases.map(c => c.id));
  const seen = new Set();
  for (const out of run.outputs) {
    if (!out || typeof out !== 'object' || Array.isArray(out) || typeof out.id !== 'string')
      throw new Error('Each output must be an object with a case ID.');
    if (!expected.has(out.id) || seen.has(out.id)) throw new Error('Unknown or duplicate case ID.');
    seen.add(out.id);
  }
  const results = cases.map(item => {
    const output = run.outputs.find(o => o.id === item.id);
    if (!output) return { id: item.id, present: false, structuralIssues: ['Missing output'], expertReviewed: false };
    const issues = [];
    if (output.response !== undefined && typeof output.response !== 'string')
      throw new Error('Response must be text for case ' + item.id);
    if (typeof output.response !== 'string' || !output.response.trim()) issues.push('Missing proposal response');
    if (!Array.isArray(output.claims)) issues.push('Explicit claim inventory required, including [] if no bidder facts');
    const claims = Array.isArray(output.claims) ? output.claims : [];
    for (const claim of claims) {
      if (!claim || typeof claim !== 'object' || Array.isArray(claim))
        throw new Error('Invalid claim entry for case ' + item.id);
      const source = item.sources[claim.citation];
      if (typeof claim.text !== 'string' || !claim.text.trim() || !output.response?.includes(claim.text))
        issues.push('Claim is absent from response');
      if (!source || source.kind !== 'company_evidence' || typeof claim.quote !== 'string' ||
          !claim.quote.trim() || !source.text.includes(claim.quote)) issues.push('Invalid factual citation or excerpt');
    }
    const coverage = Array.isArray(output.coverage) ? output.coverage : [];
    const rowIds = new Set();
    for (const row of coverage) {
      if (!row || typeof row !== 'object' || Array.isArray(row))
        throw new Error('Invalid coverage entry for case ' + item.id);
      if (!item.requirements.some(r => r.id === row.requirementId) || rowIds.has(row.requirementId) ||
          !['addressed','partial','missing'].includes(row.status)) issues.push('Invalid or duplicate coverage row');
      rowIds.add(row.requirementId);
    }
    if (item.requirements.some(r => !rowIds.has(r.id))) issues.push('Incomplete requirement inventory');
    if (!/HUMAN REVIEW REPORT/i.test(output.response || '')) issues.push('Missing human review report');
    const h = output.humanReview;
    const reviewed = typeof h?.reviewer === 'string' && Boolean(h.reviewer.trim()) &&
      h.claimInventoryComplete === true && h.citationsSupportClaims === true && h.criticalErrors === 0 &&
      Array.isArray(h.reviewChecks) && h.reviewChecks.length === item.reviewChecks.length && h.reviewChecks.every(x => x === true) &&
      dimensions.every(d => Number.isInteger(h.scores?.[d]) && h.scores[d] >= 0 && h.scores[d] <= 4) &&
      Number.isFinite(h.editingMinutes) && h.editingMinutes >= 0;
    return { id:item.id, present:true, structuralIssues:issues, expertReviewed:Boolean(reviewed),
      declaredCoverage: coverage.filter(r => r.status === 'addressed').length / item.requirements.length,
      ...(reviewed ? { scores:h.scores, editingMinutes:h.editingMinutes } : {}) };
  });
  const reviewed = results.filter(r => r.expertReviewed);
  const ready = results.every(r => r.present && !r.structuralIssues.length && r.expertReviewed);
  const mean = fn => reviewed.length ? reviewed.reduce((n,r) => n + fn(r),0) / reviewed.length : null;
  return { runId:run.runId, engineVersion:run.engineVersion, datasetVersion:dataset.version,
    evaluatedCases:results.length, expertReviewedCases:reviewed.length, readyForComparison:ready,
    scores:Object.fromEntries(dimensions.map(d => [d,mean(r => r.scores[d])])),
    meanEditingMinutes:mean(r => r.editingMinutes), results,
    limitation:'Citation checks verify existence and exact excerpts only. Experts must assess entailment, omitted claims and actual requirement coverage. Synthetic results do not establish customer outcomes or win rates.' };
}
function compare(candidate, baseline, cases = dataset.cases) {
  const current = evaluate(candidate, cases), previous = evaluate(baseline, cases);
  if (!current.readyForComparison || !previous.readyForComparison) throw new Error('Both runs need every case, valid structural checks and completed expert reviews.');
  return { candidate:current, baseline:previous,
    scoreDelta:Object.fromEntries(dimensions.map(d => [d,current.scores[d] - previous.scores[d]])),
    editingMinutesSaved:previous.meanEditingMinutes-current.meanEditingMinutes,
    note:'Paired descriptive differences on this dataset only; no statistical significance or sales claim is established.' };
}
function template() {
  return { runId:'REPLACE', engineVersion:'REPLACE', datasetVersion:dataset.version, outputs:dataset.cases.map(c => ({
    id:c.id, response:'', claims:[], coverage:c.requirements.map(r => ({requirementId:r.id,status:'missing'})),
    humanReview:{reviewer:'',claimInventoryComplete:false,citationsSupportClaims:false,criticalErrors:null,
      reviewChecks:c.reviewChecks.map(() => null), scores:Object.fromEntries(dimensions.map(d => [d,null])),editingMinutes:null}
  })) };
}
module.exports = { evaluate, compare, template, dimensions };
if (require.main === module) {
  try {
    const [file, baseline] = process.argv.slice(2);
    if (file === '--template') console.log(JSON.stringify(template(),null,2));
    else {
      if (!file) throw new Error('Usage: node engine/evaluate-quality.cjs --template | run.json [baseline.json]');
      const run = JSON.parse(fs.readFileSync(file,'utf8'));
      const report = baseline ? compare(run,JSON.parse(fs.readFileSync(baseline,'utf8'))) : evaluate(run);
      console.log(JSON.stringify(report,null,2));
      if (!baseline && !report.readyForComparison) process.exitCode = 1;
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
