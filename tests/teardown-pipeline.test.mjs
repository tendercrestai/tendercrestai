import {test}from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,rm,readFile,writeFile,mkdir}from 'node:fs/promises';
import {tmpdir}from 'node:os';
import {resolve}from 'node:path';
import {selectCandidates,pick}from '../scripts/pick-teardown-candidates.mjs';
import {scaffold,writeDraft}from '../scripts/scaffold-teardown.mjs';
import {sourceFingerprint}from '../scripts/lib/teardown-sources.mjs';
import {readTeardowns,generateTeardowns,addSitemapRoutes}from '../scripts/lib/teardowns.mjs';
const root=resolve(new URL('..',import.meta.url).pathname),id='0'.repeat(32);
const item={id,active:true,title:'Fictional maintenance test',agency:'Fictional test agency',naics:'541519',posted:'2026-01-15',deadline:'2026-02-01'};
const shred={status:'Completed',requirements:Array.from({length:16},(_,i)=>({number:i+1,requirement:'Fictional requirement '+(i+1),mandatory:i<10?'Yes':'Unclear',category:'Technical'})),gapCount:16,gapPreview:[{requirement:'Fictional requirement 1',flag:'Needs source evidence.'}]};
const facts={agencyType:'Federal',valueBand:'Not stated in supplied source',naicsArea:'54',responseWindowDays:21,shape:'test-services',source_notice_id:id,source_picked_date:'2026-01-15',dealBreakerNumbers:[1],dealBreakerSummary:'required source evidence',bidAnswers:{deadline:'2026-02-01',hours:200,eligibility:'yes',performance:'related',evidence:'most'}};
async function temporary(){const path=await mkdtemp(resolve(tmpdir(),'pipeline-validation-'));await cp(resolve(root,'content'),resolve(path,'content'),{recursive:true});await cp(resolve(root,'teardown-template.html'),resolve(path,'teardown-template.html'));return path;}
test('picker enforces live/date/duplicate gates without inventing value bands',()=>{
 const variants=[item,{...item,id:'1'.repeat(32),deadline:'2026-01-29'},{...item,id:'2'.repeat(32),deadline:'2026-02-19'},{...item,id:'3'.repeat(32),deadline:'2026-01-28'},{...item,id:'4'.repeat(32),deadline:'2026-02-20'},{...item,id:'5'.repeat(32),posted:'2025-12-31'},{...item,id:'6'.repeat(32),active:false},{...item,id:'7'.repeat(32),posted:'2026-01-16'}];
 const result=selectCandidates(variants,[],facts.source_picked_date);assert.equal(result.length,3);assert.ok(result.every(x=>x.valueBand===null&&x.agencyType==='Federal'));assert.equal(selectCandidates([item],[{source_fingerprint:sourceFingerprint(id)}],facts.source_picked_date).length,0);
});
test('picker uses only existing public feed POSTs, with no SAM key or live test call',async()=>{
 let requests=0;const fetcher=async(url,o)=>{requests++;assert.equal(url,'https://www.tendercrestai.com/.netlify/functions/opportunities');assert.equal(o.method,'POST');assert.equal(JSON.parse(o.body).action,'search');assert.ok(!JSON.stringify(o).includes('api_key'));return new Response(JSON.stringify({items:[]}));};
 await pick({pages:2,fetcher});assert.equal(requests,2);await assert.rejects(pick({origin:'https://foreign.invalid',fetcher}));assert.equal(requests,2);
});
test('scaffold derives exact counts, leaves TODOs, uses native score and commits only fingerprint',()=>{
 const d=scaffold(shred,facts);assert.equal(d.requirementCount,16);assert.equal(d.mandatoryCount,10);assert.equal(d.gapCount,16);assert.deepEqual(d.categorySplit,{Technical:16});assert.equal(d.bidRead,'Strong fit');assert.equal(d.publicationStatus,'draft');assert.equal(d.humanReview,null);assert.match(d.lesson,/TODO/);assert.equal(d.source_fingerprint,sourceFingerprint(id));assert.ok(!JSON.stringify(d).includes(id));assert.ok(!JSON.stringify(d).includes(facts.source_picked_date));assert.equal(d.dealBreakers[0],shred.requirements[0].requirement);assert.equal(scaffold(shred,{...facts,bidAnswers:undefined}).bidRead,'Pending bidder facts');
});
test('scaffold rejects thin/malformed/mismatched shreds and unsupported facts',()=>{
 for(const bad of [null,{...shred,status:'Failed'},{...shred,requirements:shred.requirements.slice(0,14)},{...shred,gapCount:17},{...shred,mandatoryCount:0},{...shred,requirements:shred.requirements.map(x=>({...x,category:'Invented'}))}])assert.throws(()=>scaffold(bad,facts));
 for(const bad of [{...facts,valueBand:'probably cheap'},{...facts,dealBreakerNumbers:[]},{...facts,dealBreakerNumbers:[99]},{...facts,bidAnswers:{...facts.bidAnswers,hours:-1}}])assert.throws(()=>scaffold(shred,bad));
});
test('draft files are exclusive, duplicate-checked and backed by a private index',async()=>{
 const temp=await temporary();try{
  const a=resolve(temp,'private-shred.json'),b=resolve(temp,'private-facts.json');await writeFile(a,JSON.stringify(shred));await writeFile(b,JSON.stringify(facts));const path=await writeDraft(a,b,temp),d=JSON.parse(await readFile(path,'utf8'));assert.equal(d.source_fingerprint,sourceFingerprint(id));const privateIndex=JSON.parse(await readFile(resolve(temp,'.private/teardown-sources.json'),'utf8'));assert.equal(privateIndex.sources[d.source_fingerprint].noticeId,id);
  await assert.rejects(writeDraft(a,b,temp),/already/);await assert.rejects(writeDraft(resolve(temp,'missing.json'),b,temp),/valid JSON/);await writeFile(a,'{broken');await assert.rejects(writeDraft(a,b,temp),/valid JSON/);
 }finally{await rm(temp,{recursive:true,force:true});}
});
test('drafts do not publish; preview carries no private trace; reviewed JSON adds routes/sitemap automatically',async()=>{
 const temp=await temporary();try{
  const d=scaffold(shred,facts);d.description=['An anonymized test scope.','A test submission structure.'];d.lesson='Check evidence before drafting.';const file=resolve(temp,'content/teardowns',d.slug+'.json');await writeFile(file,JSON.stringify(d));
  const normal=await generateTeardowns(temp,resolve(temp,'dist'),x=>x);assert.ok(!normal.includes('/teardowns/'+d.slug));
  const preview=await generateTeardowns(temp,resolve(temp,'preview'),x=>x,{includeDrafts:true});assert.ok(preview.includes('/teardowns/'+d.slug));const html=await readFile(resolve(temp,'preview/teardowns',d.slug+'.html'),'utf8');assert.match(html,/noindex,nofollow/);assert.match(html,/Draft for human review/);assert.match(html,/Example bidder profile/);for(const privateValue of [id,sourceFingerprint(id),facts.source_picked_date])assert.ok(!html.includes(privateValue));
  d.publicationStatus='reviewed';d.humanReview={reviewer:'Fictional unit-test reviewer',reviewedOn:'2026-01-15',checklistComplete:true};await writeFile(file,JSON.stringify(d));const routes=await generateTeardowns(temp,resolve(temp,'reviewed'),x=>x);assert.ok(routes.includes('/teardowns/'+d.slug));assert.match(addSitemapRoutes('<urlset></urlset>',routes),new RegExp(d.slug));
  d.lesson='TODO: human has not reviewed this';await writeFile(file,JSON.stringify(d));await assert.rejects(readTeardowns(temp),/TODO/);
 }finally{await rm(temp,{recursive:true,force:true});}
});
