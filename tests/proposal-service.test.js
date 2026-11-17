const {test} = require("node:test");
const assert = require("node:assert/strict");
const service = require("../netlify/functions/lib/proposal-service");

// The stored segment keeps the PDF's line breaks; the quoted excerpt has
// them as spaces. Creation-time validation (sourceFor) compares normalized
// text, so such a requirement passes creation and then failed import,
// because verifyAnalysis used a raw includes(). Import must use the same
// normalized comparison.
const segments = [
  {id: "s1", document_id: "doc", page: 4, section: "Section L",
   text: "The vendor shall deliver\nthe vehicle upfit by 30 June 2026.  Two copies are required."},
  {id: "s2", document_id: "doc", page: 5, section: "Section M",
   text: "Technical evaluation weight: 40%."}
];
const documents = [{id: "doc", name: "Fictional RFP", segments}];
const source = (extra = {}) => ({document_id: "doc", segment_id: "s1", page: 4, section: "Section L",
  quote: "The vendor shall deliver the vehicle upfit by 30 June 2026.", ...extra});
const req = (sources, text = "The vendor shall deliver the vehicle upfit.") =>
  ({requirement: text, fingerprint: "fp1", sources});
const analysis = (requirements, docs = documents) => ({requirements, analysis: {documents: docs}});

test("a quote spanning a PDF line break verifies", () => {
  assert.doesNotThrow(() => service.verifyAnalysis(analysis([req([source()])])));
});

test("tabs and repeated whitespace inside the quote do not fail verification", () => {
  const multi = {...segments[0], text: "The vendor shall deliver\n\nthe\tvehicle upfit by 30 June 2026."};
  const docs = [{id: "doc", name: "Fictional RFP", segments: [multi, segments[1]]}];
  assert.doesNotThrow(() => service.verifyAnalysis(analysis([req([source()])], docs)));
});

test("a requirement with two sources verifies when both match", () => {
  const second = {document_id: "doc", segment_id: "s2", page: 5, section: "Section M", quote: "Technical evaluation weight: 40%."};
  assert.doesNotThrow(() => service.verifyAnalysis(analysis([req([source(), second])])));
});

test("a genuinely missing quote still fails, and the error names the requirement", () => {
  assert.throws(
    () => service.verifyAnalysis(analysis([req([source({quote: "Vendor must be ISO certified."})])])),
    (e) => e.status === 409
      && /Requirement 1 \(The vendor shall deliver the vehicle upfit\.\)/.test(e.message)
      && /its quoted text no longer matches the source segment/.test(e.message));
});

test("page and section mismatches still fail with the specific reason", () => {
  assert.throws(
    () => service.verifyAnalysis(analysis([req([source({page: 9})])])),
    (e) => e.status === 409 && /its source page changed/.test(e.message));
  assert.throws(
    () => service.verifyAnalysis(analysis([req([source({section: "Section X"})])])),
    (e) => e.status === 409 && /its source section changed/.test(e.message));
});

test("a missing segment, an empty quote and a requirement with no sources still fail", () => {
  assert.throws(
    () => service.verifyAnalysis(analysis([req([source({segment_id: "missing"})])])),
    (e) => e.status === 409 && /its source segment is missing/.test(e.message));
  assert.throws(
    () => service.verifyAnalysis(analysis([req([source({quote: ""})])])),
    (e) => e.status === 409 && /has no quoted text/.test(e.message));
  assert.throws(
    () => service.verifyAnalysis(analysis([req([])])),
    (e) => e.status === 409 && /has no source/.test(e.message));
});
