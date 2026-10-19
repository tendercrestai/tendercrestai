const { test, beforeEach, afterEach }=require("node:test");
const assert=require("node:assert/strict");
const {createHash}=require("node:crypto");
const {createHandler}=require("../netlify/functions/compliance");
const {handler:configHandler}=require("../netlify/functions/compliance-config");
const {validateOutput}=require("../netlify/functions/lib/compliance-ai");
const OWNER="11111111-1111-4111-8111-111111111111", OTHER="22222222-2222-4222-8222-222222222222";
const DOC="33333333-3333-4333-8333-333333333333", ID="44444444-4444-4444-8444-444444444444";
const ROW="55555555-5555-4555-8555-555555555555";
const source=Buffer.from("Section L\nThe vendor must provide three references.");
const originalFetch=global.fetch, originalEnv={...process.env};
let calls, analyses, requirements, settings, aiCalls;
const payload=(extra={})=>({action:"prepare",documentIds:[DOC],...extra});
const response=(value,status=200)=>Response.json(value,{status});
beforeEach(()=>{
  process.env.SUPABASE_SERVICE_ROLE_KEY="service-fixture";
  process.env.COMPLIANCE_PREVIEW_ENABLED="true";process.env.COMPLIANCE_AI_API_KEY="ai-fixture";process.env.COMPLIANCE_AI_MODEL="fixture-model";
  calls=[];analyses=new Map();requirements=[];settings={};aiCalls=0;
  global.fetch=async(url,options={})=>{
    calls.push({url,options});const u=new URL(url), body=options.body?JSON.parse(options.body):null;
    assert.equal(u.hostname,"vfdwaqgfepvoujprtuww.supabase.co","No Airtable/Stripe/email calls allowed");
    if(u.pathname==="/auth/v1/user") {
      if(options.headers.Authorization!=="Bearer fixture")return response({},401);
      return response({id:OWNER,email:"owner@example.invalid",email_confirmed_at:"2026-01-01"});
    }
    if(u.pathname==="/rest/v1/rfp_uploads") {
      assert.equal(options.headers.Authorization,"Bearer fixture");
      return response(settings.foreignDocument?[]:[{id:DOC,user_id:settings.wrongOwner?OTHER:OWNER,
        file_name:"fictional.txt",storage_path:OWNER+"/"+DOC+"/source.txt",mime_type:"text/plain",
        size_bytes:settings.oversized?10485761:source.length,sha256:createHash("sha256").update(source).digest("hex")}]);
    }
    if(u.pathname.startsWith("/storage/")) {
      assert.equal(options.headers.Authorization,"Bearer fixture");
      return new Response(settings.badBytes?"tampered":source,{headers:{"Content-Type":"text/plain"}});
    }
    if(u.pathname==="/rest/v1/rpc/rfp_compliance_start") {
      assert.equal(options.headers.apikey,"service-fixture");
      if(settings.budget)return response({code:"P0001"},400);
      if(!analyses.has(ID))analyses.set(ID,{id:ID,user_id:OWNER,fingerprint:body.p_fingerprint,status:"Pending",
        documents:body.p_documents,chunks:body.p_chunks,warnings:body.p_warnings,facts:[],cursor:0,attempts:0});
      return response(ID);
    }
    if(u.pathname==="/rest/v1/rpc/rfp_compliance_claim") {
      const a=analyses.get(ID);
      if(a.status==="Completed" || a.status==="Partial")return response({done:true});
      if(a.lease_token)return response({code:"55P03"},400);
      if(a.attempts>=3)return response({code:"P0001"},400);
      a.lease_token=body.p_lease;a.status="Processing";a.attempts++;
      return response({chunk:a.chunks[a.cursor],documents:a.documents,cursor:a.cursor});
    }
    if(u.pathname==="/rest/v1/rpc/rfp_compliance_finish") {
      const a=analyses.get(ID);if(a.lease_token!==body.p_lease)return response(false);
      a.lease_token=null;
      if(body.p_error)a.status="Failed";
      else {
        for(const r of body.p_requirements)requirements.push({...r,id:ROW,analysis_id:ID,user_id:OWNER,
          original_requirement:r.requirement,revision:0,duplicate_count:0});
        a.facts.push(...body.p_facts);a.cursor++;a.attempts=0;
        a.status=a.cursor===a.chunks.length?(a.warnings.length?"Partial":"Completed"):"Pending";
      }
      return response(true);
    }
    if(u.pathname==="/rest/v1/rfp_compliance_analyses") {
      assert.equal(options.headers.Authorization,"Bearer fixture");
      return response(settings.foreignAnalysis?[]:[...analyses.values()]);
    }
    if(u.pathname==="/rest/v1/rfp_compliance_requirements") {
      assert.equal(options.headers.Authorization,"Bearer fixture");
      if(options.method==="PATCH") {
        const r=requirements.find(r=>"eq."+r.id===u.searchParams.get("id"));
        if(!r || "eq."+r.revision!==u.searchParams.get("revision"))return response([]);
        Object.assign(r,body);r.revision++;return response([r]);
      }
      return response(requirements);
    }
    throw Error("Unexpected route "+u.pathname);
  };
});
afterEach(()=>{global.fetch=originalFetch;process.env={...originalEnv};});
const ai=async(segments,documents)=>{
  aiCalls++;if(settings.aiFailure)throw Error("secret upstream content");
  if(settings.delay)await new Promise(resolve=>setTimeout(resolve,20));
  return validateOutput({requirements:[{segment_id:segments[0].id,quote:"The vendor must provide three references.",
    category:"Eligibility",mandatory:"Yes",weight:null,uncertain:false}],facts:[]},segments,documents);
};
const handler=()=>createHandler({analyzeChunk:ai});
const run=(p=payload(),authorization="Bearer fixture",h=handler())=>h({httpMethod:"POST",headers:{authorization},body:JSON.stringify(p)});
const step=()=>({action:"step",analysisId:ID,reviewed:true,reviewHash:analyses.get(ID).fingerprint});
test("disabled preview, unauthenticated access and malformed/oversized requests fail before spending",async()=>{
  delete process.env.COMPLIANCE_PREVIEW_ENABLED;assert.equal((await run()).statusCode,503);
  process.env.COMPLIANCE_PREVIEW_ENABLED="true";
  assert.equal((await run(payload(),"")).statusCode,401);
  assert.equal((await run(payload(),"Bearer expired")).statusCode,401);
  assert.equal((await run(payload({documentIds:[DOC,DOC]}))).statusCode,400);
  assert.equal((await handler()({httpMethod:"POST",headers:{},body:"x".repeat(24001)})).statusCode,413);
  assert.equal((await handler()({httpMethod:"POST",headers:{},body:"{"})).statusCode,400);
  assert.equal(aiCalls,0);assert.equal(analyses.size,0);
});
test("cross-account documents, oversized metadata and tampered private bytes are rejected",async()=>{
  for(const option of ["foreignDocument","wrongOwner","oversized","badBytes"]) {
    settings={[option]:true};const result=await run();assert.ok([400,404].includes(result.statusCode));
    assert.equal(analyses.size,0);assert.equal(aiCalls,0);
  }
});
test("prepare is read-only to proposal integrations, deduplicates and requires explicit source review",async()=>{
  assert.equal((await run()).statusCode,200);assert.equal((await run()).statusCode,200);
  assert.equal(analyses.size,1);assert.equal(aiCalls,0);
  assert.equal((await run({...step(),reviewed:false})).statusCode,400);
  assert.equal((await run({...step(),reviewHash:"changed"})).statusCode,400);
  const r=await run(step());assert.equal(r.statusCode,200);
  assert.equal(JSON.parse(r.body).analysis.status,"Completed");
  assert.equal(requirements[0].status,"Needs Review");assert.equal(requirements[0].evidence,"");
  await run(step());assert.equal(aiCalls,1);
});
test("cross-account analysis lookup fails before any privileged claim",async()=>{
  await run();settings.foreignAnalysis=true;calls=[];
  assert.equal((await run(step())).statusCode,404);
  assert.ok(calls.every(c=>!c.url.includes("/rpc/")));assert.equal(aiCalls,0);
});
test("overlapping analysis calls claim one AI request",async()=>{
  await run();settings.delay=true;
  const responses=await Promise.all([run(step()),run(step())]);
  assert.deepEqual(responses.map(r=>r.statusCode).sort(),[200,409]);assert.equal(aiCalls,1);
});
test("failed AI chunks remain Failed and retries cannot exceed three; no content leaks",async()=>{
  await run();settings.aiFailure=true;
  for(let n=0;n<3;n++){const result=await run(step());assert.equal(result.statusCode,502);assert.ok(!result.body.includes("secret upstream"));}
  assert.equal((await run(step())).statusCode,429);assert.equal(aiCalls,3);
  assert.equal(analyses.get(ID).status,"Failed");assert.equal(requirements.length,0);
});
test("retry after temporary AI failure completes saved chunk",async()=>{
  await run();settings.aiFailure=true;await run(step());settings.aiFailure=false;
  assert.equal((await run(step())).statusCode,200);assert.equal(aiCalls,2);assert.equal(requirements.length,1);
});
test("partial extraction cannot become Completed after successful AI",async()=>{
  const h=createHandler({analyzeChunk:ai,extractDocument:async src=>{
    const {extractDocument}=require("../netlify/functions/lib/compliance-document");const d=await extractDocument(src);d.warnings.push("OCR required on omitted page");return d;
  }});
  await run(payload(),"Bearer fixture",h);await run(step(),"Bearer fixture",h);
  assert.equal(analyses.get(ID).status,"Partial");
});
test("budget refusal creates no analysis or AI request",async()=>{
  settings.budget=true;assert.equal((await run()).statusCode,429);assert.equal(aiCalls,0);assert.equal(analyses.size,0);
});
test("editable review requires evidence, blocks source/owner mutations and detects stale versions",async()=>{
  await run();await run(step());
  const changes={requirement:"Reviewed requirement",category:"Eligibility",mandatory:"Yes",status:"Compliant",
    evidence:"",evidence_reference:"",response_owner:"Pat Reviewer",comments:""};
  const update=()=>({action:"update",analysisId:ID,requirementId:ROW,revision:0,changes});
  assert.equal((await run(update())).statusCode,400);
  changes.evidence="Three signed references";changes.evidence_reference="Company report, section 3";
  assert.equal((await run(update())).statusCode,200);
  assert.equal(requirements[0].original_requirement,"The vendor must provide three references.");
  assert.equal((await run(update())).statusCode,409);
  changes.user_id=OTHER;assert.equal((await run(update())).statusCode,400);
});
test("public config includes only public values and follows preview settings",async()=>{
  process.env.SUPABASE_URL="https://preview.supabase.co";process.env.SUPABASE_PUBLISHABLE_KEY="sb_publishable_preview";
  const result=await configHandler({httpMethod:"GET"}), body=JSON.parse(result.body);
  assert.deepEqual(body,{url:"https://preview.supabase.co",key:"sb_publishable_preview",enabled:true});
  assert.ok(!result.body.includes("service-fixture"));assert.ok(!result.body.includes("ai-fixture"));
});
