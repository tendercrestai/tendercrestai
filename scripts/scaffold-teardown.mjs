#!/usr/bin/env node
import {readFile,writeFile,readdir,unlink}from 'node:fs/promises';
import {resolve}from 'node:path';
import {fileURLToPath}from 'node:url';
import {createRequire}from 'node:module';
import Ajv from 'ajv';
import {sourceFingerprint,savePrivateSource}from './lib/teardown-sources.mjs';
const require=createRequire(import.meta.url),B=require('../netlify/functions/lib/bid-check'),ROOT=fileURLToPath(new URL('../',import.meta.url));
export function scaffold(shred,facts){
 if(shred?.status!=='Completed'||!Array.isArray(shred.requirements)||shred.requirements.length<15)throw Error('Use a completed visitor shred with at least 15 requirements.');
 const r=shred.requirements,n=r.length,categories=['Technical','Legal','Financial','Administrative','Eligibility','Submission','Attachment','Evaluation','Service Level','Other'];
 if(r.some((x,i)=>x.number!==i+1||typeof x.requirement!=='string'||!x.requirement.trim()||!categories.includes(x.category)||!['Yes','No','Unclear'].includes(x.mandatory)))throw Error('Malformed numbered requirements, category or mandatory status.');
 if(!Number.isInteger(shred.gapCount)||shred.gapCount<0||shred.gapCount>n||!Array.isArray(shred.gapPreview)||shred.gapPreview.length>shred.gapCount||shred.gapPreview.some(x=>typeof x.requirement!=='string'||typeof x.flag!=='string'))throw Error('Missing or malformed shred gap counts/preview.');
 if(!['Federal','State','Local'].includes(facts?.agencyType)||!['Under $500K','$500K to $5M','Over $5M','Not stated in supplied source'].includes(facts.valueBand)||!/^\d{2}$/.test(facts.naicsArea)||!Number.isInteger(facts.responseWindowDays)||facts.responseWindowDays<1||facts.responseWindowDays>365)throw Error('Supply verified agency type, value band, two-digit NAICS and response window. Unknown value is not an estimate.');
 if(!/^[a-f0-9]{32}$/i.test(facts.source_notice_id||'')||!/^\d{4}-\d{2}-\d{2}$/.test(facts.source_picked_date||'')||new Date(facts.source_picked_date+'T00:00:00Z').toISOString().slice(0,10)!==facts.source_picked_date)throw Error('Supply a valid private notice ID and picked date.');
 if(typeof facts.shape!=='string'||! /^[a-z]+(?:-[a-z]+)*$/.test(facts.shape)||facts.shape.length>60)throw Error('Use a short generic lowercase hyphenated shape, without identifying names.');
 const nums=facts.dealBreakerNumbers;if(!Array.isArray(nums)||nums.length<1||nums.length>3||new Set(nums).size!==nums.length||nums.some(x=>!Number.isInteger(x)||x<1||x>n))throw Error('Select 1–3 real deal-breaker requirement numbers; do not invent them.');
 const mandatory=r.filter(x=>x.mandatory==='Yes').length,categorySplit={};for(const x of r)categorySplit[x.category]=(categorySplit[x.category]||0)+1;
 if(shred.requirementCount!==undefined&&shred.requirementCount!==n||shred.mandatoryCount!==undefined&&shred.mandatoryCount!==mandatory)throw Error('Supplied counts do not match the requirement list.');
 let bidRead='Pending bidder facts';if(facts.bidAnswers){const score=B.score(r,facts.bidAnswers,facts.source_picked_date);bidRead={strong:'Strong fit',closer:'Worth a closer look',pass:'Likely pass'}[score.band];}
 const slug=facts.agencyType.toLowerCase()+'-'+facts.shape+'-'+n+'-requirements',shape=facts.shape.replaceAll('-',' '),breakers=nums.map(i=>r[i-1].requirement);
 return {slug,title:facts.valueBand+' '+facts.agencyType.toLowerCase()+' '+shape+': '+n+' requirements',metaDescription:n+' extracted requirements, '+shred.gapCount+' review gaps, and this deal-breaker to verify: '+(facts.dealBreakerSummary||breakers[0]),agencyType:facts.agencyType,valueBand:facts.valueBand,naicsArea:facts.naicsArea,responseWindowDays:facts.responseWindowDays,requirementCount:n,mandatoryCount:mandatory,gapCount:shred.gapCount,categorySplit,description:['TODO: Describe the anonymized solicitation shape from the reviewed source.','TODO: Explain the workload and submission structure without identifying details.'],gapPreview:shred.gapPreview.slice(0,5).map(({requirement,flag})=>({requirement,flag})),dealBreakers:breakers,lesson:'TODO: Write one source-supported lesson after human review.',illustrative:true,basis:'anonymized-shredder-output',source_fingerprint:sourceFingerprint(facts.source_notice_id),publicationStatus:'draft',bidRead,exampleBidderProfile:facts.bidAnswers?Object.fromEntries(['hours','eligibility','performance','evidence'].map(k=>[k,facts.bidAnswers[k]])):null,humanReview:null,faq:[{question:'Where do teardowns come from?',answer:'This anonymized teardown starts with a public solicitation processed through the free shredder. A human must verify the counts, source coverage and identifying details before publication.'},{question:'Can I get my solicitation torn down?',answer:'Use the free shredder or bid checker privately. A public teardown requires separate human review, anonymization, and your explicit confirmation. Publication is never automatic.'},{question:'Does a teardown guarantee anything?',answer:'No. A teardown does not certify compliance or predict an award. Verify the original solicitation, attachments, and amendments before making a bid decision.'}],atAGlance:{agencyType:facts.agencyType,valueBand:facts.valueBand,naicsArea:facts.naicsArea,responseWindowDays:facts.responseWindowDays,requirementsFound:n,mandatoryRequirements:mandatory,gapsFlagged:shred.gapCount,dealBreakers:breakers.length}};
}
export async function writeDraft(shredPath,factsPath,root=ROOT){
 const parse=async path=>{try{return JSON.parse(await readFile(path,'utf8'));}catch{throw Error('Cannot read valid JSON from '+path);}};
 const d=scaffold(await parse(shredPath),await parse(factsPath)),dir=resolve(root,'content/teardowns');
 for(const name of await readdir(dir))if(name.endsWith('.json')){const other=await parse(resolve(dir,name));if(other.source_fingerprint===d.source_fingerprint)throw Error('This solicitation already has a teardown draft or page.');}
 const schema=await parse(resolve(root,'content/teardowns.schema.json')),validate=new Ajv({allErrors:true}).compile(schema);
 if(!validate(d))throw Error('Draft fails schema: '+JSON.stringify(validate.errors)+'; anonymize/shorten supplied facts rather than truncating evidence.');
 const path=resolve(dir,d.slug+'.json');await writeFile(path,JSON.stringify(d,null,2)+'\n',{flag:'wx'});try{await savePrivateSource(root,await parse(factsPath),d.slug);}catch(error){await unlink(path);throw error;}return path;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))try{
 const args=process.argv.slice(2);if(args.length!==4||args[0]!=='--shred'||args[2]!=='--facts')throw Error('Usage: node scripts/scaffold-teardown.mjs --shred private-output.json --facts private-facts.json');
 console.log('Draft only, excluded from normal builds: '+await writeDraft(args[1],args[3]));
}catch(error){console.error(error.message);process.exitCode=1;}
