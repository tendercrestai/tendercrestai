import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,rm,readFile,writeFile,readdir}from 'node:fs/promises';
import {tmpdir}from 'node:os';
import {resolve}from 'node:path';
import {readTeardowns,generateTeardowns,addSitemapRoutes}from '../scripts/lib/teardowns.mjs';
const root=resolve(new URL('..',import.meta.url).pathname);
async function temporary(){const path=await mkdtemp(resolve(tmpdir(),'teardown-validation-'));await cp(resolve(root,'content'),resolve(path,'content'),{recursive:true});await cp(resolve(root,'teardown-template.html'),resolve(path,'teardown-template.html'));return path;}
test('curated JSON matches the fixed schema, illustrative labels and authored totals',async()=>{const items=(await readTeardowns(root)).filter(d=>d.basis==='authored-fictional-example');assert.equal(items.length,3);assert.deepEqual(items.map(x=>x.requirementCount).sort((a,b)=>a-b),[19,28,47]);for(const d of items){assert.equal(d.basis,'authored-fictional-example');assert.equal(d.illustrative,true);assert.equal(Object.values(d.categorySplit).reduce((a,b)=>a+b,0),d.requirementCount);assert.ok(!d.title.includes('$'));}});
test('bad schema, inconsistent counts and identifying content fail validation; fixture is removed',async()=>{
 const temp=await temporary(),files=(await readdir(resolve(temp,'content/teardowns'))).filter(x=>x.endsWith('.json')&&x.includes('it-services')),file=resolve(temp,'content/teardowns',files[0]),original=JSON.parse(await readFile(file,'utf8'));
 try{for(const change of [{requirementCount:'47'},{categorySplit:{Technical:1}},{agencyName:'Named agency'},{title:'A $2M fictional contract with a price beyond its band'},{lesson:'Contact Example LLC for this bid.'},{lesson:'The response closes on 2026-12-01.'},{lesson:'Notice ID: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}]){await writeFile(file,JSON.stringify({...original,...change}));await assert.rejects(readTeardowns(temp));}
 await writeFile(file,'{broken JSON');await assert.rejects(readTeardowns(temp));
 }finally{await rm(temp,{recursive:true,force:true});}
});
test('fourth JSON generates its page, route and sitemap entry without a code or template edit',async()=>{
 const temp=await temporary();try{const baseline=await readTeardowns(temp),original=baseline.find(d=>d.basis==='authored-fictional-example'),d={...original,slug:'federal-test-services-'+original.requirementCount+'-requirements',title:'A fourth anonymized review example',basis:'anonymized-shredder-output',source_fingerprint:'f'.repeat(64),publicationStatus:'reviewed',humanReview:{reviewer:'Fictional test reviewer',reviewedOn:'2026-01-01',checklistComplete:true},bidRead:'Strong fit',exampleBidderProfile:{hours:200,eligibility:'yes',performance:'related',evidence:'most'}};await writeFile(resolve(temp,'content/teardowns',d.slug+'.json'),JSON.stringify(d));const routes=await generateTeardowns(temp,resolve(temp,'dist'),x=>x);assert.equal(routes.length,baseline.length+2);assert.ok(routes.includes('/teardowns/'+d.slug));const html=await readFile(resolve(temp,'dist/teardowns',d.slug+'.html'),'utf8');assert.ok(html.includes(d.title));assert.match(html,/Anonymized shredder output/);assert.ok(!html.includes(d.source_fingerprint));const rewrites=await readFile(resolve(temp,'dist/_redirects'),'utf8');assert.ok(rewrites.includes('/teardowns/'+d.slug+' /teardowns/'+d.slug+'.html 200!'));const sitemap=addSitemapRoutes('<urlset></urlset>',routes);assert.ok(sitemap.includes('<loc>https://www.tendercrestai.com/teardowns/'+d.slug+'</loc>'));assert.equal(addSitemapRoutes(sitemap,routes),sitemap);
 }finally{await rm(temp,{recursive:true,force:true});}
});
