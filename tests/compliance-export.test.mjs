import {test} from "node:test";
import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
import {csv,xlsx,exportRows} from "../assets/compliance-export.mjs";
import {metrics,filterRows,sourceLabel,alerts} from "../assets/compliance-model.mjs";
import {proposalText} from "../assets/compliance-handoff.mjs";
const source={document:"Fictional RFP",section:"Section L",page:2,quote:'The vendor must provide "references".'};
const row={id:"row-1",requirement:'=HYPERLINK("bad")',original_requirement:source.quote,category:"Eligibility",
  mandatory:"Yes",status:"Needs Review",evidence:"",evidence_reference:"",response_owner:"Pat",
  comments:"Line one\nLine two, with comma",recommendation:"Verify evidence.",sources:[source],
  evaluation_weight:null,uncertain:false,duplicate_count:0};
const workspace={analysis:{id:"fictional-analysis",status:"Partial",processed:1,total_chunks:2,warnings:["OCR needed"],
  facts:[{type:"Title",value:"Fictional RFP",source}],documents:[{segments:[{text:source.quote}]}]},requirements:[row],similar_pairs:[]};
function unzipStored(bytes) {
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), files={};let n=0;
  while(v.getUint32(n,true)===0x04034b50) {
    const size=v.getUint32(n+18,true), length=v.getUint16(n+26,true), extra=v.getUint16(n+28,true);
    const name=new TextDecoder().decode(bytes.subarray(n+30,n+30+length)), start=n+30+length+extra;
    files[name]=new TextDecoder().decode(bytes.subarray(start,start+size));n=start+size;
  }
  assert.equal(v.getUint32(n,true),0x02014b50);return files;
}
test("CSV retains every field, exact source references, quotes and multiline comments; neutralizes formulas",()=>{
  const value=csv(workspace);assert.ok(value.startsWith("\uFEFF"));
  assert.ok(value.includes('"\'=HYPERLINK(""bad"")"'));assert.ok(value.includes('"Line one\nLine two, with comma"'));
  assert.ok(value.includes("PDF page 2"));assert.ok(value.includes('""references""'));assert.equal(exportRows(workspace)[0].length,18);
  assert.ok(value.includes('"Partial"'));assert.ok(value.includes('"OCR needed"'));
  for(const unsafe of ["+cmd","-cmd","@formula","  =1","\t=1","\r=1"])
    assert.ok(csv({...workspace,requirements:[{...row,comments:unsafe}]}).includes("'"+unsafe));
});
test("Excel export is real OOXML with inline strings, source quotes and incomplete-analysis summary",async()=>{
  const bytes=xlsx(workspace),files=unzipStored(bytes);
  assert.ok(files["[Content_Types].xml"].includes("spreadsheetml"));
  assert.ok(files["xl/worksheets/sheet1.xml"].includes("=HYPERLINK(&quot;bad&quot;)"));
  assert.ok(files["xl/worksheets/sheet1.xml"].includes('t="inlineStr"'));
  assert.ok(!files["xl/worksheets/sheet1.xml"].includes("<f>"));
  assert.ok(files["xl/worksheets/sheet2.xml"].includes("Partial"));assert.ok(files["xl/worksheets/sheet2.xml"].includes("OCR needed"));
  await writeFile("/tmp/tendercrest-compliance-export.xlsx",bytes);
});
test("metrics, search, filters and sorting use saved reviews; partial and missing evidence alerts stay visible",()=>{
  assert.deepEqual(metrics([row]),{total:1,mandatory:1,review:1,noncompliant:0,evidence:0});
  const covered={...row,id:"row-2",requirement:"Cloud hosting",status:"Non-Compliant",mandatory:"No",evidence:"Report",evidence_reference:"Section 2"};
  assert.equal(metrics([row,covered]).evidence,50);
  assert.deepEqual(filterRows([row,covered],{search:"pat",status:"Non-Compliant"}),[covered]);
  assert.deepEqual(filterRows([covered,row],{mandatory:"Yes",sort:"mandatory"}),[row]);
  assert.equal(filterRows([row],{search:"section l"}).length,1);
  assert.ok(alerts(workspace).some(x=>x.includes("incomplete")));
  assert.ok(alerts(workspace).some(x=>x.includes("missing company evidence")));
  assert.ok(sourceLabel({...source,page:null,section:null}).includes("Page unavailable"));
});
test("proposal handoff transfers source text only, within existing 100k limit",()=>{
  assert.equal(proposalText(workspace.analysis),source.quote);
  assert.ok(!proposalText(workspace.analysis).includes(row.requirement));
  assert.throws(()=>proposalText({documents:[{segments:[{text:"x".repeat(100001)}]}]}),/limit/);
});
