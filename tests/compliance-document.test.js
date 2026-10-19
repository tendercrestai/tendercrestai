const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { extractDocument, chunkDocuments, segmentsFor } = require("../netlify/functions/lib/compliance-document");
const id = "33333333-3333-4333-8333-333333333333";
const source = extension => ({ bytes: readFileSync(__dirname+"/fixtures/fictional-rfp."+extension),
  extension, metadata: { id, file_name:"fictional-rfp."+extension, sha256:"a".repeat(64) } });
test("real UTF-8 TXT extraction preserves headings and has unavailable pages",async()=>{
  const doc=await extractDocument(source("txt"));
  assert.ok(doc.segments.some(s=>s.section==="Vendor Qualifications" && s.text.includes("must")));
  assert.ok(doc.segments.every(s=>s.page===null));assert.equal(doc.warnings.length,0);
});
test("real compressed DOCX body/table text and entities; never invent Word pages",async()=>{
  const doc=await extractDocument(source("docx"));
  assert.ok(doc.segments.some(s=>s.text.includes("references & a service-level agreement")));
  assert.ok(doc.segments.some(s=>s.text.includes("all taxes")));
  assert.ok(doc.segments.every(s=>s.page===null));assert.equal(doc.warnings.length,0);
});
test("real PDF retains physical page and Section L/M source references",async()=>{
  const doc=await extractDocument(source("pdf"));
  assert.ok(doc.segments.some(s=>s.page===1 && /Section L/.test(s.section) && /signed security/.test(s.text)));
  assert.ok(doc.segments.some(s=>s.page===2 && /Section M/.test(s.section) && /40%/.test(s.text)));
  assert.equal(doc.warnings.length,0);
});
test("image-only scanned PDF fails visibly; mixed PDF returns partial extraction warnings",async()=>{
  const scanned=source("pdf");scanned.bytes=readFileSync(__dirname+"/fixtures/scanned-rfp.pdf");
  await assert.rejects(extractDocument(scanned),/OCR/);
  scanned.bytes=readFileSync(__dirname+"/fixtures/mixed-rfp.pdf");
  const doc=await extractDocument(scanned);
  assert.ok(doc.warnings.some(w=>/page 2/.test(w) && /OCR/.test(w)));
  assert.ok(doc.segments.some(s=>s.page===1));
});
test("invalid UTF-8, binary TXT, broken PDF and malformed DOCX fail closed",async()=>{
  for(const [extension,bytes] of [["txt",Buffer.from([0xff])],["txt",Buffer.from("binary\0")],["pdf",Buffer.from("fake")],["docx",Buffer.from("PKbroken")]]) {
    await assert.rejects(extractDocument({...source(extension),bytes}),/extracted safely/);
  }
});
test("large extraction is bounded and chunking retains all segments and references",async()=>{
  const segments=segmentsFor(id,[{page:4,text:"Section M\n"+"Requirement must be tested.\n".repeat(1000)}]);
  const docs=[{id,segments}], chunks=chunkDocuments(docs);
  assert.deepEqual(chunks.flat(),segments);assert.ok(chunks.length>1);
  assert.ok(chunks.every(c=>c.reduce((n,s)=>n+s.text.length,0)<=10000));
  assert.ok(segments.every(s=>s.page===4 && /Section M/.test(s.section)));
  assert.throws(()=>chunkDocuments([{segments:[{text:"x".repeat(100001)}]}]),/100,000/);
  await assert.rejects(extractDocument({...source("txt"),bytes:Buffer.from("x".repeat(100001))}),/100,000/);
});
