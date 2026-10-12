// A structural precheck, not a semantic quality score. Expert review is still required.
const fs = require('node:fs');
const cases = require('./benchmark-cases.json');
const file = process.argv[2];
if (!file) throw new Error('Usage: node engine/check-benchmark-output.cjs outputs.json');
const outputs = JSON.parse(fs.readFileSync(file, 'utf8'));
let failed = false;
for (const item of cases) {
  const output = outputs[item.id];
  const matrix = output?.matrix || ''; const draft = output?.draft || '';
  const checks = { outputPresent: Boolean(matrix.trim() && draft.trim()),
    requirementIds: /\bR\d+\b/.test(matrix),
    humanReviewReport: /HUMAN REVIEW REPORT/i.test(draft),
    missingEvidenceVisible: /VERIFY|MISSING|NOT FOUND|confirmation|clarification/i.test(matrix + draft),
    sourceReferences: /QUALIFICATIONS|COMPANY_DIGEST|EVIDENCE:/i.test(draft) };
  if (Object.values(checks).some(value => !value)) failed = true;
  console.log(JSON.stringify({ case: item.id, structuralChecks: checks, humanReviewChecks: item.reviewChecks }));
}
process.exitCode = failed ? 1 : 0;
