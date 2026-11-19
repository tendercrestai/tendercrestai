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
test("numbered form lines and running text are not section headings",()=>{
  // Sweep finding #18 (Nov 18, 2026): the old loose heading pattern matched
  // numbered list items ("1. One (1) PDF copy of the invoice ...") and
  // running text containing "section" ("section of the System for Award
  // Management ..."), so whole form lines became section labels that then
  // rode on dozens of unrelated citations.
  const {looksLikeHeading}=require("../netlify/functions/lib/compliance-document");
  for(const h of ["Section L","Section 4.2","SECTION 4.2","2. Submission Instructions","A.1 General Requirements","Vendor Qualifications","Scope of Work","3.2.1 Delivery Schedule"])assert.equal(looksLikeHeading(h),true,h);
  for(const f of ["1. One (1) PDF copy of the invoice billed according to contract line items and rates.","33. SHIP NUMBER 34. VOUCHER NUMBER 35. AMOUNT VERIFIED 36. PAYMENT 37. CHECK NUMBER","section of the System for Award Management (SAM) and its other data in SAM is current.","33 if-","33. If this contract is completely or partially terminated for the convenience of the government.","10. The vendor shall provide three references.",""])assert.equal(looksLikeHeading(f),false,f);
  const text=["Section L","The vendor must provide three references.","1. One (1) PDF copy of the invoice billed according to contract line items and rates.","33. SHIP NUMBER 34. VOUCHER NUMBER 35. AMOUNT VERIFIED 36. PAYMENT 37. CHECK NUMBER","section of the System for Award Management (SAM) and its other data in SAM is current.","2. Submission Instructions","The vendor must submit the proposal by the deadline.","33. If this contract is completely or partially terminated for the convenience of the government."].join("\n");
  const segments=segmentsFor(id,[{page:8,text}]);
  const sections=[...new Set(segments.map(s=>s.section))];
  assert.ok(sections.includes("Section L"));
  assert.ok(sections.includes("2. Submission Instructions"));
  assert.ok(!sections.some(s=>s&&s.startsWith("1. One (1) PDF")));
  assert.ok(!sections.some(s=>s&&s.startsWith("33. SHIP")));
  assert.ok(!sections.some(s=>s&&s.toLowerCase().startsWith("section of")));
  assert.ok(!sections.some(s=>s&&s.startsWith("33. If this contract")));
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
test("knowledge extraction accepts a raised cap; the compliance default stays 100,000",async()=>{
  const big=Buffer.from("x".repeat(150000));
  await assert.rejects(extractDocument({...source("txt"),bytes:big}),/100,000/);
  const doc=await extractDocument({...source("txt"),bytes:big},{maxText:200000});
  assert.ok(doc.segments.length>1);
  assert.ok(doc.segments.reduce((n,s)=>n+s.text.length,0)>=140000);
  await assert.rejects(extractDocument({...source("txt"),bytes:Buffer.from("x".repeat(150001))},{maxText:150000}),/150,000/);
});
