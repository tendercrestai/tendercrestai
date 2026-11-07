import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import Ajv from 'ajv';
export const escapeHTML=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const e=escapeHTML;
export async function readTeardowns(root){
 const schema=JSON.parse(await readFile(resolve(root,'content/teardowns.schema.json'),'utf8')),validate=new Ajv({allErrors:true}).compile(schema),files=(await readdir(resolve(root,'content/teardowns'))).filter(x=>x.endsWith('.json')).sort(),slugs=new Set(),items=[];
 if(!files.length)throw Error('At least one curated teardown is required.');
 for(const file of files){
  const d=JSON.parse(await readFile(resolve(root,'content/teardowns',file),'utf8'));
  if(!validate(d))throw Error(file+': '+JSON.stringify(validate.errors));
  if(file!==d.slug+'.json'||slugs.has(d.slug))throw Error('Duplicate or mismatched teardown slug: '+file);slugs.add(d.slug);
  if(Object.values(d.categorySplit).reduce((a,b)=>a+b,0)!==d.requirementCount||d.mandatoryCount>d.requirementCount||d.gapCount>d.requirementCount||d.gapPreview.length>d.gapCount)throw Error('Inconsistent teardown counts: '+file);
  const facts={agencyType:d.agencyType,valueBand:d.valueBand,naicsArea:d.naicsArea,responseWindowDays:d.responseWindowDays,requirementsFound:d.requirementCount,mandatoryRequirements:d.mandatoryCount,gapsFlagged:d.gapCount,dealBreakers:d.dealBreakers.length};
  if(Object.keys(facts).some(k=>d.atAGlance[k]!==facts[k]))throw Error('Inconsistent at-a-glance facts: '+file);
  const text=JSON.stringify({...d,valueBand:undefined,atAGlance:undefined}).replaceAll('$500K to $5M','').replaceAll('Under $500K','').replaceAll('under $500K','').replaceAll('Over $5M','');
  if(/\$|\b[0-9a-f]{32}\b|\b[0-9a-f]{8}-[0-9a-f-]{27}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]+|\b(?:Inc\.?|LLC|Ltd\.?|Corporation|NASA|GSA|FEMA|USACE|Pentagon)\b|\b(?:Department|City|County|Agency) of [A-Z]|\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}\b/.test(text))throw Error('Identifying, priced or live-bid detail is not allowed: '+file);
  if(/\b(?:notice|solicitation)\s*(?:id|number|#)\s*[:#]?\s*[A-Za-z0-9]+/i.test(text))throw Error('Solicitation identifiers are not allowed: '+file);
  items.push(d);
 }
 return items;
}
function faqHTML(items){return '<section aria-labelledby="faq-heading"><h2 id="faq-heading">Questions about teardowns</h2>'+items.map(x=>'<h3>'+e(x.question)+'</h3><p>'+e(x.answer)+'</p>').join('')+'</section>';}
function faqSchema(items){return '<script type="application/ld+json">'+JSON.stringify({'@context':'https://schema.org','@type':'FAQPage',mainEntity:items.map(x=>({'@type':'Question',name:x.question,acceptedAnswer:{'@type':'Answer',text:x.answer}}))}).replace(/</g,'\\u003c')+'</script>';}
const label='<p class="notice"><strong>Authored fictional illustration.</strong> Counts and gaps are illustrative, not measured extraction results from a real bid. No visitor solicitation is represented.</p>';
const cta='<section><h2>Try it on yours</h2><p><a class="button" href="/tools/shredder">Shred your solicitation</a> <a class="button secondary" href="/tools/bid-check">Check whether it is worth bidding on</a></p></section>';
export function teardownBody(d){
 const facts=[['Agency type',d.agencyType],['Value band',d.valueBand],['NAICS area',d.naicsArea],['Response window',d.responseWindowDays+' days'],['Requirements found (illustrative)',d.requirementCount],['Mandatory requirements (illustrative)',d.mandatoryCount],['Gaps flagged (illustrative)',d.gapCount],['Deal-breakers',d.dealBreakers.length]];
 return '<p class="eyebrow">RFP TEARDOWN</p><h1>'+e(d.title)+'</h1>'+label+'<dl class="teardown-facts">'+facts.map(([k,v])=>'<div><dt>'+e(k)+'</dt><dd>'+e(v)+'</dd></div>').join('')+'</dl><section><h2>What the solicitation asked for</h2>'+d.description.map(x=>'<p>'+e(x)+'</p>').join('')+'</section><section><h2>What the shredder found</h2><p>This authored example illustrates '+d.requirementCount+' requirements. These are not measured shredder results.</p><ul>'+Object.entries(d.categorySplit).map(([k,v])=>'<li>'+e(k)+': '+v+'</li>').join('')+'</ul><h3>Illustrative gap preview</h3><p>'+d.gapPreview.length+' examples from '+d.gapCount+' illustrative gaps.</p><ul>'+d.gapPreview.map(x=>'<li>'+e(x.requirement)+' — '+e(x.flag)+' <strong>Needs human review</strong></li>').join('')+'</ul></section><section><h2>The deal-breakers</h2><ol>'+d.dealBreakers.map(x=>'<li>'+e(x)+'</li>').join('')+'</ol></section><section><h2>The lesson</h2><p>'+e(d.lesson)+'</p></section>'+cta+faqHTML(d.faq)+'<p>This teardown is illustrative and anonymized. It does not describe any one company\'s bid, and it does not certify compliance or predict an award.</p><p><a href="/teardowns">Browse all teardowns</a></p>';
}
export function indexBody(items){return '<p class="eyebrow">FREE TEARDOWNS</p><h1>See what can be hiding in an RFP before you bid.</h1><p class="intro">These launch teardowns are authored fictional illustrations of common solicitation shapes. Their counts are illustrative, not measured results from real bids or visitor submissions. Explore the requirement counts, gaps, deal-breakers, and lessons.</p><p class="notice">Teardowns are illustrative. Solicitations change by amendment, and attachments can add requirements the shredder never saw. Always verify against the original.</p><form id="teardown-filters" class="tool-grid"><div><label for="agency-filter">Agency type</label><select id="agency-filter"><option value="">All agency types</option>'+['Federal','State','Local'].map(x=>'<option>'+x+'</option>').join('')+'</select></div><div><label for="value-filter">Value band</label><select id="value-filter"><option value="">All value bands</option>'+['Under $500K','$500K to $5M','Over $5M'].map(x=>'<option>'+e(x)+'</option>').join('')+'</select></div></form><p id="filter-count" role="status">'+items.length+' illustrative teardowns</p><div id="teardown-cards">'+items.map(d=>'<article class="notice-card" data-agency="'+e(d.agencyType)+'" data-value="'+e(d.valueBand)+'"><p class="eyebrow">Authored fictional illustration</p><h2><a href="/teardowns/'+e(d.slug)+'">'+e(d.title)+'</a></h2><p>'+e(d.agencyType)+' · '+e(d.valueBand)+'</p><p>'+d.requirementCount+' illustrative requirements · '+d.gapCount+' illustrative gaps</p><p>Biggest deal-breaker: '+e(d.dealBreakers[0].split(/(?<=[.!?])\s+/)[0])+'</p></article>').join('')+'</div><p id="no-teardowns" hidden>No illustrative teardowns match these filters.</p><p><a href="/tools/shredder">Shred your own solicitation — free, no signup for the basic list.</a></p><p><a href="/tools/bid-check">Or check whether it is worth bidding on.</a></p><script type="module" src="/assets/teardowns.mjs"></script>';}
export async function generateTeardowns(root,destination,decorate){
 const items=await readTeardowns(root),template=await readFile(resolve(root,'teardown-template.html'),'utf8');
 const page=(title,description,path,body,schema='')=>decorate(template.replaceAll('{{TITLE}}',e(title)).replaceAll('{{DESCRIPTION}}',e(description)).replaceAll('{{CANONICAL}}','https://www.tendercrestai.com'+path).replace('{{SCHEMA}}',schema).replace('{{BODY}}',body),'teardowns');
 await mkdir(resolve(destination,'teardowns'),{recursive:true});
 await writeFile(resolve(destination,'teardowns/index.html'),page('RFP Teardowns: Illustrative Solicitation Examples | TenderCrest AI','Illustrative RFP teardowns with authored requirement counts, review gaps, deal-breakers, and lessons. Free to read, no signup.','/teardowns',indexBody(items)));
 for(const d of items)await writeFile(resolve(destination,'teardowns',d.slug+'.html'),page(d.title+' | RFP Teardown | TenderCrest AI',d.metaDescription,'/teardowns/'+d.slug,teardownBody(d),faqSchema(d.faq)));
 // Explicit generated rewrites make future JSON-only additions work on Netlify.
 await writeFile(resolve(destination,'_redirects'),'/teardowns /teardowns/index.html 200!\n'+items.map(d=>'/teardowns/'+d.slug+' /teardowns/'+d.slug+'.html 200!').join('\n')+'\n');
 return ['/teardowns',...items.map(d=>'/teardowns/'+d.slug)];
}

export function addSitemapRoutes(sitemap,routes){for(const route of routes){const location='https://www.tendercrestai.com'+route;if(!sitemap.includes('<loc>'+location+'</loc>'))sitemap=sitemap.replace('</urlset>','  <url><loc>'+location+'</loc></url>\n</urlset>');}return sitemap;}
