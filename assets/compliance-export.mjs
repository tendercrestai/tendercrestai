import { sourceLabel } from "./compliance-model.mjs";
const headers = ["Requirement ID","Requirement","Category","Mandatory","Source","Evaluation Weight","Compliance Status","Evidence","Evidence Reference","Response Owner","Comments","AI Recommendation","Original Requirement","Uncertain","Duplicate Count","Analysis Status","Analysis ID","Extraction Warnings"];
export function exportRows(workspace) {
  return [headers, ...workspace.requirements.map((r,i) => [
    "R" + String(i + 1).padStart(4,"0") + " (" + r.id + ")",r.requirement,r.category,r.mandatory,
    r.sources.map(s => sourceLabel(s) + " — " + s.quote).join("\n"),
    r.evaluation_weight || "Not explicitly provided",r.status,r.evidence,r.evidence_reference,
    r.response_owner,r.comments,r.recommendation,r.original_requirement,String(r.uncertain),String(r.duplicate_count),
    workspace.analysis.status,workspace.analysis.id,workspace.analysis.warnings.join("\n")
  ])];
}
const safeCSV = value => {
  let text = String(value ?? "");
  if (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
};
export function csv(workspace) {
  return "\uFEFF" + exportRows(workspace).map(row => row.map(safeCSV).join(",")).join("\r\n") + "\r\n";
}
const xml = value => String(value ?? "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,"")
  .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
function column(n) { let s=""; for(n++;n;n=Math.floor((n-1)/26)) s=String.fromCharCode(65+(n-1)%26)+s; return s; }
function sheet(rows) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>' +
    rows.map((r,i) => '<row r="' + (i+1) + '">' + r.map((v,j) =>
      '<c r="' + column(j) + (i+1) + '" t="inlineStr"><is><t xml:space="preserve">' + xml(v) + '</t></is></c>').join("") + '</row>').join("") +
    '</sheetData></worksheet>';
}
const encoder = new TextEncoder();
function crc32(bytes) {
  let crc=0xffffffff;
  for(const b of bytes) { crc ^= b; for(let n=0;n<8;n++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
  return (crc^0xffffffff)>>>0;
}
function zip(files) {
  const parts=[], central=[]; let offset=0, centralSize=0;
  for(const [name,text] of files) {
    const filename=encoder.encode(name), data=encoder.encode(text), crc=crc32(data);
    const local=new Uint8Array(30+filename.length), l=new DataView(local.buffer);
    l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint32(14,crc,true);
    l.setUint32(18,data.length,true);l.setUint32(22,data.length,true);l.setUint16(26,filename.length,true);local.set(filename,30);
    const c=new Uint8Array(46+filename.length), v=new DataView(c.buffer);
    v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);
    v.setUint32(16,crc,true);v.setUint32(20,data.length,true);v.setUint32(24,data.length,true);
    v.setUint16(28,filename.length,true);v.setUint32(42,offset,true);c.set(filename,46);
    parts.push(local,data);central.push(c);offset+=local.length+data.length;centralSize+=c.length;
  }
  const end=new Uint8Array(22), e=new DataView(end.buffer);
  e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);
  e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
  const all=[...parts,...central,end], out=new Uint8Array(offset+centralSize+22);
  let pos=0;for(const p of all){out.set(p,pos);pos+=p.length;}return out;
}
// Actual XLSX, not CSV renamed as Excel. Inline strings never become formulas.
export function xlsx(workspace) {
  const metadata = [["Analysis ID",workspace.analysis.id],["Status",workspace.analysis.status],
    ["Processed chunks",workspace.analysis.processed + "/" + workspace.analysis.total_chunks],
    ...workspace.analysis.warnings.map(w=>["Warning",w]),
    ...workspace.analysis.facts.map(f=>[f.type,f.value,sourceLabel(f.source),f.source.quote])];
  return zip([
    ["[Content_Types].xml",'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ["_rels/.rels",'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ["xl/workbook.xml",'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Compliance Matrix" sheetId="1" r:id="rId1"/><sheet name="Analysis Summary" sheetId="2" r:id="rId2"/></sheets></workbook>'],
    ["xl/_rels/workbook.xml.rels",'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>'],
    ["xl/worksheets/sheet1.xml",sheet(exportRows(workspace))],["xl/worksheets/sheet2.xml",sheet(metadata)]
  ]);
}
