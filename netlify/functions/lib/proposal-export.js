const {readFileSync}=require('node:fs');
const path=require('node:path');
const PDFDocument=require('pdfkit');
const D=require('docx');
const {zipSync,strToU8}=require('fflate');
const core=require('./proposal-core');
const font=name=>{const roots=[path.resolve(process.cwd(),'netlify/functions/assets',name),path.resolve(__dirname,'../assets',name)];return roots.find(p=>require('node:fs').existsSync(p))||roots[0];};
const safeName=name=>name.replace(/[^a-zA-Z0-9._ -]/g,'_').replace(/^\.+/,'').slice(0,120)||'attachment';
function model(project,draft){
 const s=project.state;const check=core.readiness(s,project.evidence_epoch);return {title:s.title,company:s.company.name,accent:/^#[a-f0-9]{6}$/i.test(s.company.accent)?s.company.accent.slice(1):'1D4ED8',revision:project.revision,epoch:project.evidence_epoch,draft,contentHash:core.contentHash(s),sections:s.sections.map(x=>({id:x.id,title:x.title,text:x.text,requirements:x.requirementIds,claims:x.claims,unverified:x.unverified})),requirements:s.requirements.map(r=>({id:r.id,text:r.text,mandatory:r.mandatory,status:r.status,sources:r.sources})),warnings:check.blockers};
}
const anchor=id=>'section_'+id.replace(/[^a-zA-Z0-9]/g,'').slice(0,32);
function runs(text){return new D.Paragraph({children:[new D.TextRun(text)]});}
async function docx(m){
 const children=[new D.Paragraph({text:m.company,heading:D.HeadingLevel.TITLE}),new D.Paragraph({text:m.title,heading:D.HeadingLevel.TITLE}),runs(`Saved proposal revision ${m.revision}`),runs(m.draft?'DRAFT — unresolved items may remain. Human review required.':'APPROVED SAVED REVISION — verify buyer instructions before submission.'),new D.Paragraph({text:'Contents',heading:D.HeadingLevel.TITLE}),...m.sections.map(s=>new D.Paragraph({children:[new D.InternalHyperlink({anchor:anchor(s.id),children:[new D.TextRun({text:s.title,style:'Hyperlink'})]})]})),new D.Paragraph({pageBreakBefore:true,text:'Proposal response',heading:D.HeadingLevel.HEADING_1})];
 for(const section of m.sections){children.push(new D.Paragraph({heading:D.HeadingLevel.HEADING_1,children:[new D.Bookmark({id:anchor(section.id),children:[new D.TextRun(section.title)]})]}));for(const p of section.text.split(/\n\n+/))children.push(runs(p));}
 children.push(new D.Paragraph({text:'Requirement crosswalk',heading:D.HeadingLevel.HEADING_1}),new D.Table({rows:[new D.TableRow({tableHeader:true,children:['Requirement ID','Requirement','Section'].map(t=>new D.TableCell({children:[runs(t)]}))}),...m.requirements.map(r=>new D.TableRow({children:[r.id,r.text,m.sections.filter(s=>s.requirements.includes(r.id)).map(s=>s.title).join('; ')].map(t=>new D.TableCell({children:[runs(t)]}))}))],width:{size:100,type:D.WidthType.PERCENTAGE}}));
 if(m.draft){children.unshift(runs('DRAFT FOR REVIEW. Resolve the internal checklist before submission.'));}
 const doc=new D.Document({creator:m.company,title:m.title,description:'Saved TenderCrest AI proposal revision '+m.revision,features:{updateFields:true},styles:{default:{document:{run:{font:'Calibri',size:22},paragraph:{spacing:{after:140}}}},paragraphStyles:[{id:'Heading1',name:'Heading 1',basedOn:'Normal',next:'Normal',quickFormat:true,run:{bold:true,color:m.accent,size:30},paragraph:{outlineLevel:0}}]},sections:[{properties:{},headers:{default:new D.Header({children:[runs(m.company+' · '+m.title)]})},footers:{default:new D.Footer({children:[new D.Paragraph({alignment:D.AlignmentType.CENTER,children:[new D.TextRun(`Revision ${m.revision} · `),new D.TextRun({children:[D.PageNumber.CURRENT]}),new D.TextRun(' / '),new D.TextRun({children:[D.PageNumber.TOTAL_PAGES]})]})]})},children}]});return D.Packer.toBuffer(doc);
}
async function pdf(m){
 return new Promise((resolve,reject)=>{
  const doc=new PDFDocument({size:'A4',margins:{top:60,bottom:65,left:48,right:48},bufferPages:true,info:{Title:m.title,Author:m.company,Subject:'Saved proposal revision '+m.revision}}),chunks=[];doc.on('data',c=>chunks.push(c));doc.on('error',reject);
  doc.registerFont('Regular',readFileSync(font('DejaVuSans.ttf')));doc.registerFont('Bold',readFileSync(font('DejaVuSans-Bold.ttf')));doc.font('Regular');
  function heading(t){doc.moveDown(.7).font('Bold').fontSize(15).fillColor('#'+m.accent).text(t);doc.moveDown(.4).font('Regular').fontSize(10).fillColor('#17243b');}
  doc.font('Bold').fontSize(24).fillColor('#'+m.accent).text(m.company);doc.moveDown().text(m.title);doc.font('Regular').fontSize(11).fillColor('#17243b').moveDown().text(`Saved proposal revision ${m.revision}`).moveDown().text(m.draft?'DRAFT — unresolved items may remain. Human review required.':'APPROVED SAVED REVISION — verify buyer instructions before submission.');
  doc.addPage();heading('Contents');const tocPage=1;const tocY=doc.y;const tocEntries=[];const tocPages=Math.ceil((m.sections.length+1)/25)||1;for(let i=1;i<tocPages;i++)doc.addPage();doc.addPage();
  for(const section of m.sections){if(doc.y>doc.page.height-160)doc.addPage();heading(section.title);tocEntries.push({title:section.title,page:doc.bufferedPageRange().count});doc.text(section.text||'[NEEDS INPUT: this section is empty.]',{lineGap:3});doc.moveDown();}
  heading('Requirement crosswalk');tocEntries.push({title:'Requirement crosswalk',page:doc.bufferedPageRange().count});for(const r of m.requirements){doc.font('Bold').fontSize(9).text(r.id);doc.font('Regular').text(r.text);doc.text('Sections: '+m.sections.filter(s=>s.requirements.includes(r.id)).map(s=>s.title).join('; ')).moveDown(.5);}
  const count=doc.bufferedPageRange().count;doc.switchToPage(tocPage);doc.y=tocY;doc.font('Regular').fontSize(10).fillColor('#17243b');
  // Bounded contents page; long projects get a compact continued contents list.
  for(let i=0;i<tocEntries.length;i++){if(i&&i%25===0){doc.switchToPage(tocPage+Math.floor(i/25));doc.y=tocY;}const entry=tocEntries[i];doc.text(entry.title.slice(0,74)+'  ·  '+entry.page,{lineGap:3,height:24});}
  for(let i=0;i<count;i++){doc.switchToPage(i);const bottom=doc.page.margins.bottom;doc.page.margins.bottom=0;doc.font('Regular').fontSize(8).fillColor('#475569');doc.text(`${m.draft?'DRAFT · ':''}${m.company} · Revision ${m.revision}`,48,25,{lineBreak:false});doc.text(`${i+1} / ${count}`,48,doc.page.height-42,{lineBreak:false,align:'center',width:doc.page.width-96});doc.page.margins.bottom=bottom;}
  doc.on('end',()=>resolve({bytes:Buffer.concat(chunks),pages:count}));doc.end();
 });
}
function complianceView(project){return {analysis:{id:project.state.analysis?.id||project.id,status:project.state.analysis?.status||'Pending',processed:Number.isSafeInteger(project.state.analysis?.processed)&&project.state.analysis.processed>=0?project.state.analysis.processed:1,total_chunks:Number.isSafeInteger(project.state.analysis?.total_chunks)&&project.state.analysis.total_chunks>=1?project.state.analysis.total_chunks:1,warnings:project.state.sourceWarnings,facts:project.state.analysis?.facts||[]},requirements:project.state.requirements.map(r=>({id:r.id,stableId:r.stableId||core.stableRequirementId(r),requirement:r.text,category:r.category,mandatory:r.mandatory,sources:r.sources,evaluation_weight:r.evaluationWeight||null,status:r.status,evidence:core.activeEvidence(project.state,r.id).map(e=>e.text).join('\n'),evidence_reference:core.activeEvidence(project.state,r.id).flatMap(e=>e.citations.map(c=>c.fileName+' · '+(c.section||'Section unavailable')+(c.page?' · PDF page '+c.page:''))).join('\n'),response_owner:'',comments:'',recommendation:'',original_requirement:r.text,uncertain:r.mandatory==='Unclear',duplicate_count:0,trace:core.ensureTrace(r),traceEvidence:project.state.evidence.filter(e=>e.requirementId===r.id).map(e=>({answerId:e.answerId,revision:e.revision,excerpt:String(e.text||'').slice(0,1000),decision:e.decision}))}))};}
// Readiness report (Capability 2). Plain text so it renders anywhere and is
// easy to forward. Unresolved items first, with unresolved MANDATORY items
// in their own prominent first section. Mandatory status and task status are
// separate columns on every line. Never claims certification, guaranteed
// readiness, or a win probability: the scope note says so explicitly.
function readinessSourceLabel(ref){return (ref.document||'Source unavailable')+' · '+(ref.section||'Section unavailable')+' · '+(ref.page===null||ref.page===undefined?'Page unavailable':'PDF page '+ref.page);}
// AI-use disclosure note (Grant Mode M11): a short, exportable record of
// what the AI drafted, what evidence it used and what a person verified or
// edited, for funders that ask how AI was used. Counts come only from the
// saved state; nothing is inferred. Keep this note with the proposal.
function aiUseDisclosureText(state){
 const sections=state.sections||[],requirements=state.requirements||[];
 const drafted=sections.filter(s=>(s.text||'').trim()).length;
 const unverified=sections.filter(s=>s.unverified).length;
 const approved=sections.filter(s=>s.status==='approved').length;
 const reviewed=requirements.filter(r=>r.reviewedBy).length;
 const evidenceUsed=(state.evidence||[]).filter(e=>e.decision==='accepted'&&!e.stale).length;
 const edited=sections.filter(s=>s.editedBy).length;
 return ['AI-USE DISCLOSURE',
  '- AI drafted '+drafted+' of '+sections.length+' sections from approved company evidence and the solicitation text. Every drafted claim is traced to a source or flagged unverified; anything the AI could not verify is marked for a person to fill in, never invented.',
  '- Evidence used: '+evidenceUsed+' accepted evidence mapping(s) from the organization knowledge library.',
  '- Human review: '+reviewed+' of '+requirements.length+' requirements reviewed by a person; '+approved+' of '+sections.length+' sections approved; '+edited+' section(s) edited by a person after drafting.',
  '- Still unverified: '+unverified+' section(s) carry an unverified flag and need human verification before submission.',
  '- Customer data is not used to train a shared model.',
  '- This note describes the saved revision only. A person remains responsible for the facts, the evidence scope and the final submission.'].join('\n');
}
// Grant-only readiness sections (M8 submission guidance, N5 plain-English
// eligibility check, N1 budget table). Facts come from the imported NOFO
// analysis; when the NOFO supplied none, the report says so instead of
// inventing eligibility or submission instructions.
function grantReportLines(state){
 if(!state.grant)return [];
 const out=['','ELIGIBILITY CHECK (PLAIN ENGLISH): read the NOFO eligibility section before submitting.'];
 const facts=(state.analysis?.facts||[]).filter(f=>f&&f.type==='Eligibility');
 for(const f of facts)out.push('- '+f.value);
 const eligReqs=(state.requirements||[]).filter(r=>r.category==='Eligibility');
 for(const r of eligReqs)out.push('- '+(r.text||'').slice(0,300)+' ['+(r.status||'Needs Review')+']');
 if(!facts.length&&!eligReqs.length)out.push('- No eligibility rule was extracted from the NOFO. Do not assume eligibility; read the NOFO eligibility section and confirm the applicant type, location and registration requirements.');
 out.push('','SUBMITTING THIS GRANT: TenderCrest does not submit for you.');
 out.push('- Submit through the channel named in the NOFO, usually Grants.gov Workspace or the funder portal named in the NOFO. Include the required forms from the NOFO, including the SF-424 family where the NOFO calls for them.');
 out.push('- Track the submission in Grants.gov and keep the confirmation. Deadlines are in the timezone stated in the NOFO; verify the exact closing time on the original grant before you apply.');
 out.push('- Attachments are not imported from the Grants.gov feed. The full NOFO, with all attachments and amendments, is the submission source.');
 const budget=state.budget||{rows:[],narrative:''};
 out.push('','BUDGET: simple table and narrative only. This is not a full budget builder: no indirect-cost rates, modular budgets, multi-year schedules or sub-awards.');
 if((budget.rows||[]).length){let total=0;for(const row of budget.rows){total+=Number(row.amount)||0;out.push('- '+row.item+': $'+(Number(row.amount)||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+(row.note?'; '+row.note:''));}out.push('- Total: $'+total.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}));}
 else out.push('- No budget lines entered yet. Add line items and a budget narrative in the workspace before submitting.');
 if(budget.narrative)out.push('Budget narrative: '+budget.narrative);
 return out;
}
function readinessReportText(project){
 const items=core.readinessItems(project.state),summary=core.readinessSummary(project.state);
 const unresolved=items.filter(core.readinessItemUnresolved),mandatoryUnresolved=unresolved.filter(i=>i.mandatory!=='No'),otherUnresolved=unresolved.filter(i=>i.mandatory==='No'),resolved=items.filter(i=>!core.readinessItemUnresolved(i));
 const lines=[project.state.company.name+' — '+project.state.title,'Readiness report · saved proposal revision '+project.revision+' · generated '+new Date().toISOString(),'',core.READINESS_SCOPE_NOTE,'','Outstanding work'];
 for(const l of summary.lines)lines.push('- '+l);
 const itemLines=i=>{const out=['- ['+i.status.toUpperCase()+'] '+(i.mandatory==='Yes'?'MANDATORY':i.mandatory==='Unclear'?'MANDATORY (UNCLEAR)':'Optional')+' · '+i.kind+' · '+i.title,'  Source: '+i.sourceReferences.map(readinessSourceLabel).join(' | '),'  Owner: '+(i.owner||'unassigned')+' · Due: '+(i.dueAt||'not set')+(i.status==='not-applicable'?' · Not applicable because: '+(i.naReason||''):''),...(i.manual?['  Manual addition — no extracted source.']:[]),...(i.corrected?['  Corrected extraction: '+(i.correctionNote||'')]:[]),...(i.evidenceGap?['  Evidence gap: coverage is '+(i.coverage||'not-assessed')+'.']:[]),...(i.responseReviewPending?['  Response awaiting approval ('+(i.responseApproval||'not-approved')+').']:[])];return out;};
 lines.push('','UNRESOLVED MANDATORY ITEMS ('+mandatoryUnresolved.length+') — resolve these first; they stay prominent here until done or marked not applicable with a reason.');
 if(!mandatoryUnresolved.length)lines.push('- None. No mandatory item is currently unresolved.');
 for(const i of mandatoryUnresolved)lines.push(...itemLines(i));
 lines.push('','OTHER UNRESOLVED ITEMS ('+otherUnresolved.length+')');
 if(!otherUnresolved.length)lines.push('- None.');
 for(const i of otherUnresolved)lines.push(...itemLines(i));
 lines.push('','DONE / NOT APPLICABLE ('+resolved.length+')');
 if(!resolved.length)lines.push('- None yet.');
 for(const i of resolved)lines.push(...itemLines(i));
 lines.push('',aiUseDisclosureText(project.state),...grantReportLines(project.state));
 return lines.join('\n')+'\n';
}// Amendment impact report (Capability 3). Plain text, same pattern as the
// readiness report. Lists every proposed change with old and new wording side
// by side and source references, the affected evidence, draft responses and
// approvals, and the reviews still unresolved. States exactly which documents
// were compared and which could not be processed. Never claims a change is
// confirmed until a person confirms or corrects it.
const AMENDMENT_TYPE_HEADINGS={added:'ADDED REQUIREMENTS',changed:'CHANGED REQUIREMENTS','deadline-changed':'CHANGED DEADLINES','instruction-changed':'CHANGED SUBMISSION INSTRUCTIONS','potentially-removed':'POTENTIALLY REMOVED REQUIREMENTS','uncertain-match':'UNCERTAIN MATCHES — NEED HUMAN REVIEW'};
function amendmentImpactReportText(project,amendmentId){
 const amendments=core.amendmentsState(project.state);
 const a=amendmentId?amendments.find(x=>x.id===amendmentId):amendments[amendments.length-1];
 if(!a)throw Error('No amendment impact to report yet.');
 const view=core.amendmentView(project.state).find(x=>x.id===a.id);
 const summary=view.summary;
 const lines=[project.state.company.name+' — '+project.state.title,'Amendment impact report · solicitation version '+a.versionNumber+' ('+(a.kind==='replacement'?'complete replacement solicitation':'supplemental amendment')+') · saved proposal revision '+project.revision+' · generated '+new Date().toISOString(),'',
  core.AMENDMENT_SCOPE_NOTE,'',
  'Documents compared ('+a.documentsCompared.length+')'];
 for(const d of a.documentsCompared)lines.push('- '+d.name);
 if(!a.documentsCompared.length)lines.push('- None listed.');
 lines.push('','Documents that could not be processed ('+a.documentsUnprocessed.length+')');
 if(!a.documentsUnprocessed.length)lines.push('- None. Every supplied document was processed; a document missing from the analysis entirely cannot be named here.');
 for(const d of a.documentsUnprocessed)lines.push('- '+d.name+' — '+(d.reason||'Could not be processed.'));
 lines.push('','Summary','- '+summary.total+' proposed changes: '+Object.entries(summary.byType).map(([t,n])=>n+' '+t.replace(/-/g,' ')).join(', ')+'.',
  '- '+summary.proposed+' still proposed (unresolved), '+summary.confirmed+' confirmed, '+summary.corrected+' corrected, '+summary.rejected+' rejected.',
  '- Amendment status: '+summary.status+'.');
 if(a.appliedDirectly)lines.push('- Applied directly by import: the live snapshot was replaced without per-change review. For a reviewed amendment, use Propose amendment instead.');
 if(a.kind==='supplemental')lines.push('- '+(a.notMentioned||[]).length+' earlier requirements were not mentioned in this supplemental amendment. Absence from a supplemental amendment does not mean a requirement was removed.');
 const affectedLines=c=>{
  const out=[];const aff=c.affected||{};
  if(aff.evidence&&aff.evidence.length)for(const e of aff.evidence)out.push('  Affected evidence: '+e.answerId+' rev '+e.revision+' · '+e.decision+(e.stale?' · STALE':'')+' · '+e.excerpt);
  else out.push('  Affected evidence: none linked.');
  if(aff.sections&&aff.sections.length)for(const s of aff.sections)out.push('  Affected draft response: '+s.title+' · '+s.status+' · revision '+s.revision);
  else out.push('  Affected draft response: none yet.');
  out.push('  Response approval: '+(aff.responseApproval||'not-approved')+(aff.needsReconfirmation?' · NEEDS RECONFIRMATION':'')+' · Coverage: '+(aff.coverage||'not-assessed')+(aff.coverageSource?' ('+aff.coverageSource+')':''));
  return out;};
 for(const type of Object.keys(AMENDMENT_TYPE_HEADINGS)){
  const group=view.changes.filter(c=>c.type===type);if(!group.length)continue;
  lines.push('',AMENDMENT_TYPE_HEADINGS[type]+' ('+group.length+')');
  for(const c of group){
   lines.push('- ['+c.status.toUpperCase()+'] '+(c.stableId||'')+(c.similarity!==null&&c.similarity!==undefined?' · similarity '+c.similarity.toFixed(2)+' ('+c.matchMethod+')':' · matched by '+c.matchMethod));
   if(c.oldText!==null&&c.oldText!==undefined)lines.push('  OLD: '+c.oldText);
   if(c.newText!==null&&c.newText!==undefined)lines.push('  NEW: '+c.newText);
   for(const ref of c.oldSources||[])lines.push('  Old source: '+readinessSourceLabel(ref));
   for(const ref of c.newSources||[])lines.push('  New source: '+readinessSourceLabel(ref));
   if(c.correctionNote)lines.push('  Correction: '+c.correctionNote);
   if(c.decisionNote)lines.push('  Decision: '+c.decisionNote);
   lines.push(...affectedLines(c));
  }
 }
 const unresolved=view.changes.filter(c=>c.status==='proposed');
 lines.push('','UNRESOLVED REVIEWS ('+unresolved.length+')');
 if(!unresolved.length)lines.push('- None. Every proposed change has been confirmed, corrected or rejected.');
 for(const c of unresolved)lines.push('- ['+c.type+'] '+(c.stableId||'')+' · '+(c.newText||c.oldText||''));
 if(a.kind==='supplemental'&&(a.notMentioned||[]).length){
  lines.push('','NOT MENTIONED IN THIS SUPPLEMENTAL AMENDMENT ('+a.notMentioned.length+') — unchanged, not removed');
  for(const n of a.notMentioned)lines.push('- '+n.stableId+' · '+n.text);
 }
 return lines.join('\n')+'\n';
}
async function packageFiles(project,{draft=true,attachments=[]}={}){
 if(attachments.length>10||attachments.reduce((n,a)=>n+a.bytes.length,0)>20971520)throw Error('Attachment package exceeds the declared bound.');
 const m=model(project,draft),rendered=await pdf(m);const measured={contentHash:m.contentHash,pages:rendered.pages,evidenceEpoch:m.epoch};const readiness=core.readiness(project.state,project.evidence_epoch,measured);
 if(!draft&&(!readiness.ready||!project.state.finalApproval||project.state.finalApproval.contentHash!==m.contentHash))throw Error('Final export blocked by current readiness/rendered page checks.');
 const word=await docx(m);const {csv,xlsx}=await import('../../../assets/compliance-export.mjs');const view=complianceView(project);
 const files={'proposal.docx':word,'proposal.pdf':rendered.bytes,'compliance-matrix.csv':Buffer.from(csv(view)),'compliance-matrix.xlsx':xlsx(view),'readiness-report.md':Buffer.from(readinessReportText(project))};
 if((project.state.amendments||[]).length)files['amendment-impact-report.md']=Buffer.from(amendmentImpactReportText(project));
 for(const a of attachments){if(!/^[0-9a-f-]{36}$/i.test(a.id))throw Error('Invalid attachment identity.');files['attachments/'+a.id+'-'+safeName(a.name)]=a.bytes;}
 const provenance={projectId:project.id,revision:project.revision,sections:m.sections.map(s=>({sectionId:s.id,requirementIds:s.requirements,claims:s.claims.map(c=>({text:c.text,requirementId:c.requirementId,answerId:c.answerId,answerRevision:c.answerRevision,citationIds:c.citations.map(x=>x.id),sources:c.citations.map(x=>({documentId:x.documentId,name:x.fileName,sha256:x.sha256,page:x.page??null,section:x.section??null,quote:x.quote}))})),evidenceReferences:project.state.evidence.filter(e=>s.requirements.includes(e.requirementId)&&core.activeEvidence(project.state,e.requirementId).some(x=>x.id===e.id)).map(e=>({requirementId:e.requirementId,answerId:e.answerId,answerRevision:e.revision,citations:e.citations})),humanReviewed:!s.unverified}))};files['source-references.json']=Buffer.from(JSON.stringify(provenance,null,2));
 const manifest={schema:'tendercrest-submission-v1',projectId:project.id,revision:project.revision,evidenceEpoch:m.epoch,contentHash:m.contentHash,draft,submissionReady:!draft&&readiness.ready,unresolvedItems:readiness.blockers,readinessSummary:core.readinessSummary(project.state),amendmentImpact:(project.state.amendments||[]).length?core.amendmentSummary(project.state.amendments[project.state.amendments.length-1]):null,excludedRequirements:project.state.requirements.filter(core.excluded).map(r=>({id:r.id,disposition:r.disposition})),renderedPDFPages:rendered.pages,docxPaginationMeasured:false,wordCount:readiness.wordCount,files:Object.entries(files).map(([name,bytes])=>({name,bytes:bytes.length,sha256:require('node:crypto').createHash('sha256').update(bytes).digest('hex')})),generatedAt:new Date().toISOString(),internalCommentsIncluded:false};
 files['manifest.json']=Buffer.from(JSON.stringify(manifest,null,2));const zip=Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,new Uint8Array(v)])),{level:6}));if(zip.length>52428800)throw Error('Submission package exceeds 50 MiB.');return {files,zip,manifest,measured};
}
module.exports={model,docx,pdf,packageFiles,complianceView,safeName,readinessReportText,aiUseDisclosureText,grantReportLines,readinessSourceLabel,amendmentImpactReportText,AMENDMENT_TYPE_HEADINGS};
