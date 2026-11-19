import {customerFetch} from './customer-request.mjs';
import {identifyUsage} from './analytics.mjs';
import {uploadRfp} from './private-rfp-upload.mjs';
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm";
import { validateFile } from "./rfp-document.mjs";
import { statuses, categories, metrics, sourceLabel, filterRows, alerts, stableRequirementId, validDeadline } from "./compliance-model.mjs";
import { csv, xlsx } from "./compliance-export.mjs";
import { createActionQueue, truncate, shortId } from "./ui-helpers.mjs";
const $ = id => document.getElementById(id);
const el = (tag, text, className) => { const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n; };
let supabase, user, state, editing, busy=false, paused=false, epoch=0;
function message(text, error=false) { $("message").textContent=text;$("message").className=error?"error":""; }
function controls(value) {
  busy=value;
  for(const id of ["prepare","reload","history","documents","analyze","csv","xlsx"]) $(id).disabled=value;
  $("workspace").setAttribute("aria-busy",String(value));
}
// One action at a time; a click that lands while another action runs is
// queued (latest wins) instead of dropped, and a slow action reports
// "Working…" after 800ms unless it already reported its own progress.
const actionQueue=createActionQueue({isBusy:()=>busy,setBusy:controls,notify:t=>message(t),readMessage:()=>$("message").textContent});
function clearAccount() {
  void identifyUsage(null);
  epoch++;user=null;state=null;editing=null;paused=true;
  $("workspace").hidden=true;$("login").hidden=false;
  $("documents").value="";$("rows").replaceChildren();$("facts").replaceChildren();$("source-documents").replaceChildren();
  $("edit-form").reset();$("edit-dialog").close();$("source-content").replaceChildren();$("source-dialog").close();
  message("Sign in to review your private RFP documents.");
}
async function session() {
  const {data,error}=await supabase.auth.getSession();
  if(error || !data.session || data.session.user.id!==user?.id) {clearAccount();throw Error("Please sign in again.");}
  const verified=await supabase.auth.getUser();
  if(verified.error || verified.data.user?.id!==user.id) {clearAccount();throw Error("Your session could not be verified. Sign in again.");}
  void identifyUsage(data.session.access_token);return data.session;
}
async function api(payload) {
  const current=epoch, auth=await session();
  const response=await customerFetch("/.netlify/functions/compliance",{
    method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+auth.access_token},
    body:JSON.stringify(payload)
  });
  let result;
  try {result=await response.json();}catch{throw Error("Server response could not be read. Reload your saved analysis before retrying.");}
  if(current!==epoch) throw Error("Account changed. Reload your analysis.");
  if(response.status===401) clearAccount();
  if(!response.ok) throw Error(result.error || "Compliance request failed.");
  return result;
}
const upload=file=>uploadRfp(file,{supabase,user,session,currentUser:()=>user});
function viewSource(row) {
  const host=$("source-content");host.replaceChildren();
  for(const source of row.sources) {
    host.append(el("h3",sourceLabel(source)),el("blockquote",source.quote));
    const segment=state.analysis.documents.find(d=>d.id===source.document_id)?.segments.find(s=>s.id===source.segment_id);
    const details=el("details");details.append(el("summary","Surrounding extracted text"),el("pre",segment?.text || "Source unavailable"));
    host.append(details);
  }
  $("source-dialog").showModal();
}
async function downloadOriginal(doc) {
  const current=epoch;
  try {
    await session();
    const metadata=await supabase.from("rfp_uploads").select("storage_path").eq("id",doc.id).single();
    if(metadata.error) throw Error("Original source could not be located.");
    const result=await supabase.storage.from("rfp-documents").download(metadata.data.storage_path);
    if(result.error) throw Error("Original source could not be downloaded.");
    if(!user || current!==epoch) return;
    download(result.data,doc.name);
  } catch(error) {message(error.message,true);}
}
function renderSources() {
  const host=$("source-documents");host.replaceChildren();
  for(const doc of state.analysis.documents) {
    const details=el("details");details.append(el("summary",doc.name+" · "+doc.format.toUpperCase()));
    for(const warning of doc.warnings) details.append(el("p",warning));
    const button=el("button","Download private original");button.type="button";button.onclick=()=>downloadOriginal(doc);details.append(button);
    for(const s of doc.segments) {
      details.append(el("h3",(s.section || "Section unavailable")+" · "+(s.page===null?"Page unavailable":"PDF page "+s.page)),el("pre",s.text));
    }
    host.append(details);
  }
}
function openEdit(row) {
  if(busy){message("Please wait — finishing the last action…",true);return;}
  editing=row;
  const fields={requirement:"requirement",category:"category",mandatory:"mandatory",status:"status",evidence:"evidence","evidence-reference":"evidence_reference",owner:"response_owner",comments:"comments"};
  for(const [id,key] of Object.entries(fields)) $("edit-"+id).value=row[key];
  $("edit-error").textContent="";$("edit-dialog").showModal();
}
function renderTable() {
  if(!state) return;
  const rows=filterRows(state.requirements,{search:$("search").value,category:$("category").value,status:$("status").value,mandatory:$("mandatory").value,sort:$("sort").value});
  $("row-count").textContent=rows.length+" of "+state.requirements.length+" requirements shown. Exports include all saved rows.";
  const body=$("rows");body.replaceChildren();
  for(const row of rows) {
    const tr=el("tr"), id=el("td");
    const label="R"+String(state.requirements.findIndex(r=>r.id===row.id)+1).padStart(4,"0");
    const edit=el("button","Edit "+label);edit.type="button";edit.disabled=busy;edit.onclick=()=>openEdit(row);id.append(edit,el("small",stableRequirementId(row)));tr.append(id);
    for(const text of [row.requirement,row.category,row.mandatory]) tr.append(el("td",text));
    const source=el("td");
    for(const s of row.sources) source.append(el("p",sourceLabel(s)));
    const verify=el("button","Verify source");verify.type="button";verify.onclick=()=>viewSource(row);source.append(verify);tr.append(source);
    for(const text of [row.evaluation_weight || "Not provided",row.status,
      row.evidence ? row.evidence+" · "+row.evidence_reference : "Evidence missing",
      row.response_owner || "Unassigned",row.comments,row.recommendation]) tr.append(el("td",text));
    body.append(tr);
  }
}
function markSteps(current){const steps=["upload","review","analyze","matrix","export","proposal"];for(const li of document.querySelectorAll(".workflow li")){const i=steps.indexOf(li.dataset.step),cur=steps.indexOf(current);li.classList.toggle("done",i<cur);li.classList.toggle("current",i===cur);}}
function render(result, sources=true) {
  state=result;
  markSteps(state.analysis.status==="Failed"?"analyze":state.analysis.processed===0?"review":["Completed","Partial"].includes(state.analysis.status)?"matrix":"analyze");
  $("source-review").hidden=false;$("results").hidden=false;
  $("analysis-status").textContent=state.analysis.status;
  $("progress").max=state.analysis.total_chunks;$("progress").value=state.analysis.processed;
  $("progress-label").textContent=state.analysis.processed+" / "+state.analysis.total_chunks+" chunks processed"+
    (state.analysis.status==="Failed"?" · Chunk failed; "+state.analysis.attempts+" / 3 attempts used.":"");
  $("analyze").textContent=state.analysis.status==="Failed"?"Retry failed chunk":state.analysis.processed?"Continue analysis":"Analyze requirements";
  $("continue").href="/workspace.html?analysis="+encodeURIComponent(state.analysis.id);
  history.replaceState(null,"","/compliance.html?analysis="+encodeURIComponent(state.analysis.id));
  if(sources) {renderSources();$("reviewed").checked=false;}
  // An already-stored deadline that does not parse as a date is hidden, not
  // shown as a date: form-heavy sources store header noise as the deadline
  // (the server drops such values for new analyses). The same filtered list
  // feeds alerts, so a missing usable deadline is reported as not found.
  const visibleFacts=state.analysis.facts.filter(f=>f.type!=="Submission Deadline"||validDeadline(f.value));
  const facts=$("facts");facts.replaceChildren();
  if(!visibleFacts.length) facts.append(el("p","Summary facts appear after analysis. Missing dates, timezones and scoring weights are never inferred."));
  const seen=new Set();
  for(const f of visibleFacts) {
    const key=f.type+"|"+f.value+"|"+f.source.segment_id;if(seen.has(key))continue;seen.add(key);
    const p=el("p");p.append(el("strong",f.type+": "),document.createTextNode(f.value+" · "+sourceLabel(f.source)));facts.append(p);
  }
  const m=metrics(state.requirements), host=$("metrics");host.replaceChildren();
  for(const [label,value] of [["Total requirements",m.total],["Mandatory",m.mandatory],["Needs Review",m.review],["Non-Compliant",m.noncompliant],["Evidence coverage",m.evidence+"%"]]) {
    const div=el("div");div.append(el("dt",label),el("dd",String(value)));host.append(div);
  }
  const list=el("ul");for(const text of alerts({...state,analysis:{...state.analysis,facts:visibleFacts}}))list.append(el("li",text));
  // Similar pairs used to render as two raw UUIDs. Label each side the way
  // the table does (R-number plus the requirement text) so the alert is
  // actionable without copying an ID anywhere.
  const pairLabel=(id)=>{const i=state.requirements.findIndex(r=>r.id===id);if(i<0)return shortId(id);const r=state.requirements[i];return "R"+String(i+1).padStart(4,"0")+" · "+truncate(r.requirement,80);};
  for(const pair of state.similar_pairs || [])list.append(el("li","Review possible duplicate/amendment conflict: "+pair.map(pairLabel).join(" / ")));
  $("alerts").replaceChildren(list);renderTable();
}
async function refreshHistory() {
  const result=await api({action:"list"}), select=$("history");select.replaceChildren(new Option("Choose an analysis",""));
  for(const a of result.analyses)select.append(new Option(new Date(a.created_at).toLocaleString()+" · "+a.status+" · "+((a.documents&&a.documents[0]&&a.documents[0].name)||"Untitled RFP"),a.id));
  if(state) select.value=state.analysis.id;
}
$("upload-form").onsubmit=event=>{
  event.preventDefault();
  void actionQueue.run(async()=>{
  const files=[...$("documents").files];
  if(files.length<1 || files.length>6) {message("Choose one to six RFP documents.",true);return;}
  try {for(const f of files)validateFile(f);}catch(error){message(error.message,true);return;}
  const current=epoch;
  try {
    const ids=[];
    for(let i=0;i<files.length;i++){message("Uploading privately: "+(i+1)+" / "+files.length);ids.push(await upload(files[i]));}
    message("Extracting and verifying source text…");
    const result=await api({action:"prepare",documentIds:ids});
    if(current!==epoch)return;
    render(result);await refreshHistory();message("Review the extracted text before analyzing requirements.");
  }catch(error){message(error.message || "Extraction failed. Retry with the same files.",true);}
  finally{renderTable();}
  });
};
$("reload").onclick=()=>{
  void actionQueue.run(async()=>{
  const id=$("history").value || state?.analysis.id;if(!id){message("Choose a saved analysis first.",true);return;}
  try {render(await api({action:"get",analysisId:id}));message("Saved analysis loaded.");}catch(error){message(error.message,true);}
  finally{renderTable();}
  });
};
$("analyze").onclick=()=>{
  void actionQueue.run(async()=>{
  if(!state)return;
  if(!$("reviewed").checked){message("Review the extracted text and confirm before analyzing.",true);return;}
  if(["Completed","Partial"].includes(state.analysis.status)){message("All chunks processed. Review the matrix and extraction warnings.");return;}
  paused=false;$("pause").hidden=false;
  try {
    while(!paused && !["Completed","Partial"].includes(state.analysis.status)) {
      message("Analyzing chunk "+(state.analysis.processed+1)+" / "+state.analysis.total_chunks+"…");
      render(await api({action:"step",analysisId:state.analysis.id,reviewed:true,reviewHash:state.analysis.fingerprint}),false);
    }
    message(paused?"Analysis paused. Saved chunks can be resumed.":state.analysis.status==="Partial"?"Processing finished with extraction gaps. Review warnings before relying on the matrix.":"Analysis completed. Review every requirement and supply company evidence.");
  }catch(error){
    message(error.message || "Analysis failed. Reload saved results before retrying.",true);
    try {if(state && user)render(await api({action:"get",analysisId:state.analysis.id}),false);}catch{}
  }finally{$("pause").hidden=true;renderTable();if(user)refreshHistory().catch(()=>{});}
  });
};
$("pause").onclick=()=>{paused=true;message("Will pause after the current chunk is saved.");};
$("edit-form").onsubmit=event=>{
  event.preventDefault();if(!editing)return;
  void actionQueue.run(async()=>{
  const changes={requirement:$("edit-requirement").value,category:$("edit-category").value,mandatory:$("edit-mandatory").value,
    status:$("edit-status").value,evidence:$("edit-evidence").value,evidence_reference:$("edit-evidence-reference").value,
    response_owner:$("edit-owner").value,comments:$("edit-comments").value};
  if(changes.status==="Compliant" && (!changes.evidence.trim() || !changes.evidence_reference.trim())) {
    $("edit-error").textContent="Provide company evidence and a verifiable reference before marking Compliant.";return;
  }
  $("save-row").disabled=true;
  try {
    const result=await api({action:"update",analysisId:state.analysis.id,requirementId:editing.id,revision:editing.revision,changes});
    state.requirements=state.requirements.map(r=>r.id===editing.id?result.requirement:r);
    $("edit-dialog").close();editing=null;render(state,false);message("Review saved.");
  }catch(error){$("edit-error").textContent=error.message || "Review could not be saved.";}
  finally{$("save-row").disabled=false;renderTable();}
  });
};
$("cancel-edit").onclick=()=>{$("edit-dialog").close();editing=null;};
$("close-source").onclick=()=>$("source-dialog").close();
for(const id of ["search","category","status","mandatory","sort"])$(id).addEventListener("input",renderTable);
for(const category of categories){$("category").append(new Option(category,category));$("edit-category").append(new Option(category,category));}
for(const status of statuses){$("status").append(new Option(status,status));$("edit-status").append(new Option(status,status));}
function download(blob,name) {
  const url=URL.createObjectURL(blob), a=el("a");a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$("csv").onclick=()=>{if(!state){message("Load or upload an analysis before exporting.",true);return;}if(!busy)download(new Blob([csv(state)],{type:"text/csv;charset=utf-8"}),"tendercrest-compliance.csv");};
$("xlsx").onclick=()=>{if(!state){message("Load or upload an analysis before exporting.",true);return;}if(!busy)download(new Blob([xlsx(state)],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}),"tendercrest-compliance.xlsx");};
try {
  const response=await fetch("/.netlify/functions/compliance-config"), config=await response.json();
  if(!response.ok || !config.enabled)throw Error("Compliance preview is not enabled for this deployment.");
  supabase=createClient(config.url,config.key);
  const verified=await supabase.auth.getUser();
  if(verified.error || !verified.data.user)clearAccount();
  else {
    user=verified.data.user;$("account").textContent="Signed in as "+user.email;$("workspace").hidden=false;
    supabase.auth.onAuthStateChange((event,s)=>{if(event==="SIGNED_OUT" || (s && user && s.user.id!==user.id))setTimeout(clearAccount,0);});
    markSteps("upload");message("Upload an RFP or resume a saved analysis.");await refreshHistory();
    const id=new URLSearchParams(location.search).get("analysis");if(id)render(await api({action:"get",analysisId:id}));
  }
}catch(error){message(error.message || "Workspace could not load. Check your connection.",true);}
