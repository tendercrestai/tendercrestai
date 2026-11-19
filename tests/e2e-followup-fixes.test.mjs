import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  searchListItems, paginateList, pageRangeText,
  requirementLabel, sectionLabel, readableBlocker, findingEntityLabel,
  groupAuditFindings, auditGroupLabel, auditSummary,
} from '../assets/ui-helpers.mjs';

// Nov 18, 2026 E2E sweep follow-up: the workspace rendered every
// requirement, evidence mapping and section review at once (162 disclosure
// triangles per tab), the Overview checklist showed 313 raw-UUID blockers,
// and the Final Proposal Audit rendered 965 findings as raw UUIDs with no
// grouping, summary or pagination. Lists are now searched and paged in
// place, blockers and findings show readable REQ labels and section titles,
// and the audit groups by the underlying issue.

const REQ_A = {id: "11111111-1111-1111-1111-111111111111", stableId: "REQ-A1B2C3D4E5F6", text: "Submit proof of insurance of at least $1,000,000 with your proposal."};
const REQ_B = {id: "22222222-2222-2222-2222-222222222222", stableId: "REQ-B2C3D4E5F6A7", text: "The bidder must include a signed cover letter."};
const SEC_A = {id: "33333333-3333-3333-3333-333333333333", title: "Cover letter and bidder forms"};
const SEC_B = {id: "44444444-4444-4444-4444-444444444444", title: "Pricing response"};

test('search matches across label, text, category, status and mandatory, case-insensitively', () => {
  const items = [
    {stableId: "REQ-1", text: "Submit proof of insurance", category: "Legal", status: "Needs Review", mandatory: "Yes"},
    {stableId: "REQ-2", text: "Provide three references", category: "Eligibility", status: "Compliant", mandatory: "No"},
  ];
  assert.deepEqual(searchListItems(items, "", (r) => [r.stableId, r.text].join(" ")), items);
  assert.equal(searchListItems(items, "insurance", (r) => [r.stableId, r.text, r.category, r.status, r.mandatory].join(" ")).length, 1);
  assert.equal(searchListItems(items, "REQ-2", (r) => [r.stableId, r.text].join(" ")).length, 1);
  assert.equal(searchListItems(items, "compliant", (r) => [r.stableId, r.text, r.status].join(" ")).length, 1);
  assert.equal(searchListItems(items, "nothing matches", (r) => r.text).length, 0);
});

test('pagination pages 25 at a time and clamps out-of-range pages', () => {
  const items = Array.from({length: 162}, (_, i) => i + 1);
  const first = paginateList(items, 0, 25);
  assert.equal(first.total, 162);
  assert.equal(first.totalPages, 7);
  assert.deepEqual(first.items, items.slice(0, 25));
  const last = paginateList(items, 6, 25);
  assert.deepEqual(last.items, items.slice(150, 162));
  assert.equal(paginateList(items, 99, 25).page, 6);
  assert.equal(paginateList(items, -3, 25).page, 0);
  const empty = paginateList([], 0, 25);
  assert.equal(empty.total, 0);
  assert.equal(empty.totalPages, 1);
  assert.deepEqual(empty.items, []);
});

test('page range text names the visible slice', () => {
  assert.equal(pageRangeText(paginateList(Array.from({length: 162}, (_, i) => i), 0, 25)), "Showing 1 to 25 of 162.");
  assert.equal(pageRangeText(paginateList(Array.from({length: 162}, (_, i) => i), 6, 25)), "Showing 151 to 162 of 162.");
  assert.equal(pageRangeText(paginateList([], 0, 25)), "No items match.");
});

test('readable blockers replace raw UUIDs with REQ labels and section titles', () => {
  const blocker = "Mandatory/unclear requirement needs verified evidence and compliance review: " + REQ_A.id;
  assert.equal(
    readableBlocker(blocker, [REQ_A, REQ_B], [SEC_A]),
    "Mandatory/unclear requirement needs verified evidence and compliance review: REQ-A1B2C3D4E5F6 · Submit proof of insurance of at least $1,000,000 with your proposal."
  );
  assert.equal(
    readableBlocker("Section needs content or revision approval: " + SEC_A.id, [REQ_A], [SEC_A, SEC_B]),
    "Section needs content or revision approval: Cover letter and bidder forms"
  );
  assert.equal(
    readableBlocker("Explicit word limit exceeded for " + REQ_B.id + ": 120/100", [REQ_A, REQ_B], [SEC_A]),
    "Explicit word limit exceeded for REQ-B2C3D4E5F6A7 · The bidder must include a signed cover letter.: 120/100"
  );
  assert.equal(readableBlocker("Bid assessment is stale.", [REQ_A], [SEC_A]), "Bid assessment is stale.");
  const unknown = "11111111-9999-9999-9999-999999999999";
  assert.equal(readableBlocker("Section needs content or revision approval: " + unknown, [REQ_A], [SEC_A]),
    "Section needs content or revision approval: " + unknown);
});

test('finding entity lines use readable labels, never raw UUIDs', () => {
  assert.equal(
    findingEntityLabel({requirementId: REQ_A.id}, [REQ_A], [SEC_A]),
    "Requirement REQ-A1B2C3D4E5F6 · Submit proof of insurance of at least $1,000,000 with your proposal."
  );
  assert.equal(findingEntityLabel({sectionId: SEC_B.id}, [REQ_A], [SEC_A, SEC_B]), "Section Pricing response");
  assert.equal(findingEntityLabel({requirementId: "unknown-id"}, [REQ_A], []), "Requirement unknown-id");
  assert.equal(findingEntityLabel({type: "potential-conflict"}, [REQ_A], []), null);
});

test('audit groups repeat findings about one requirement or section together', () => {
  const findings = [
    {id: "f1", type: "requirement", severity: "high", message: "Needs human review: Submit proof of insurance.", requirementId: REQ_A.id},
    {id: "f2", type: "readiness", severity: "high", message: "Mandatory/unclear requirement needs verified evidence and compliance review: " + REQ_A.id},
    {id: "f3", type: "incomplete-section", severity: "high", message: "Complete the response and resolve placeholders.", sectionId: SEC_A.id},
    {id: "f4", type: "unverified-claims", severity: "high", message: "Factual claims in this section have not been confirmed.", sectionId: SEC_A.id},
    {id: "f5", type: "approval", severity: "medium", message: "Saved section needs authorized approval.", sectionId: SEC_A.id},
    {id: "f6", type: "potential-conflict", severity: "high", message: "Company name: Different literal values were found.", passages: []},
    {id: "f1", type: "requirement", severity: "high", message: "Needs human review: Submit proof of insurance.", requirementId: REQ_A.id},
  ];
  const groups = groupAuditFindings(findings, [REQ_A, REQ_B], [SEC_A, SEC_B]);
  assert.equal(groups.length, 3);
  const reqGroup = groups.find((g) => g.requirementId === REQ_A.id);
  assert.equal(reqGroup.findings.length, 2);
  assert.deepEqual(reqGroup.findings.map((f) => f.id).sort(), ["f1", "f2"]);
  const secGroup = groups.find((g) => g.sectionId === SEC_A.id);
  assert.equal(secGroup.findings.length, 3);
  const conflictGroup = groups.find((g) => g.key.startsWith("conflict:"));
  assert.equal(conflictGroup.findings.length, 1);
  // The exact duplicate (f1 twice) is stored once.
  assert.equal(groups.reduce((n, g) => n + g.findings.length, 0), 6);
});

test('audit groups sort worst severity first', () => {
  const findings = [
    {id: "m1", type: "requirement", severity: "medium", message: "Needs human review.", requirementId: REQ_B.id},
    {id: "h1", type: "incomplete-section", severity: "high", message: "Complete the response.", sectionId: SEC_B.id},
  ];
  const groups = groupAuditFindings(findings, [REQ_A, REQ_B], [SEC_A, SEC_B]);
  assert.equal(groups[0].sectionId, SEC_B.id);
  assert.equal(groups[1].requirementId, REQ_B.id);
});

test('audit group labels are readable', () => {
  const groups = groupAuditFindings([
    {id: "f1", type: "requirement", severity: "high", message: "x", requirementId: REQ_A.id},
    {id: "f2", type: "approval", severity: "medium", message: "x", sectionId: SEC_A.id},
    {id: "f3", type: "potential-conflict", severity: "high", message: "Company name: Different literal values were found."},
    {id: "f4", type: "readiness", severity: "high", message: "Bid assessment is stale."},
  ], [REQ_A], [SEC_A]);
  assert.equal(auditGroupLabel(groups.find((g) => g.requirementId === REQ_A.id), [REQ_A], [SEC_A]),
    "REQ-A1B2C3D4E5F6 · Submit proof of insurance of at least $1,000,000 with your proposal.");
  assert.equal(auditGroupLabel(groups.find((g) => g.sectionId === SEC_A.id), [REQ_A], [SEC_A]), "Cover letter and bidder forms");
  assert.equal(auditGroupLabel(groups.find((g) => g.key.startsWith("conflict:")), [REQ_A], [SEC_A]), "Potential conflict: Company name");
  assert.equal(auditGroupLabel(groups.find((g) => g.key === "readiness:general"), [REQ_A], [SEC_A]), "Readiness items");
});

test('audit summary counts articles, distinct issues, severity and type', () => {
  const findings = [
    {id: "f1", type: "requirement", severity: "high", message: "x", requirementId: REQ_A.id},
    {id: "f2", type: "readiness", severity: "high", message: "Mandatory/unclear requirement needs verified evidence: " + REQ_A.id},
    {id: "f3", type: "incomplete-section", severity: "high", message: "x", sectionId: SEC_A.id},
    {id: "f4", type: "approval", severity: "medium", message: "x", sectionId: SEC_A.id},
  ];
  const summary = auditSummary(findings, [REQ_A], [SEC_A]);
  assert.equal(summary.total, 4);
  assert.equal(summary.distinct, 2);
  assert.deepEqual(summary.bySeverity, {high: 3, medium: 1});
  assert.deepEqual(summary.byType, {requirement: 1, readiness: 1, "incomplete-section": 1, approval: 1});
  assert.deepEqual(auditSummary([], [], []), {total: 0, distinct: 0, bySeverity: {}, byType: {}});
});

test('requirement and section labels fall back to the raw id without text', () => {
  assert.equal(requirementLabel({id: "abc"}), "abc");
  assert.equal(requirementLabel(null), "");
  assert.equal(sectionLabel({id: "sec-1"}), "sec-1");
  assert.equal(sectionLabel(null), "");
});
