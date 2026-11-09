#!/usr/bin/env node
// Public feed client: the deployed function owns the SAM key, cache and limits.
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceFingerprint}from './lib/teardown-sources.mjs';
const ROOT=fileURLToPath(new URL('../',import.meta.url)),DAY=86400000;
const ORIGINS=['https://www.tendercrestai.com','https://tendercrestai-pr6-isolated-20261021.netlify.app'];
const day=value=>{if(typeof value!=='string')return NaN;const s=value.slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?Date.parse(s+'T00:00:00Z'):NaN;};
export function selectCandidates(items,existing,asOf=new Date().toISOString().slice(0,10)){
 const seen=new Set(existing.map(d=>d.source_fingerprint).filter(Boolean)),today=day(asOf),result=[];
 for(const item of items){
  const id=item.id?.toLowerCase(),left=(day(item.deadline)-today)/DAY,age=(today-day(item.posted))/DAY;
  if(!/^[a-f0-9]{32}$/.test(id||'')||seen.has(sourceFingerprint(id))||item.active!==true||!Number.isInteger(left)||left<14||left>35||!Number.isInteger(age)||age<0||age>14)continue;
  seen.add(sourceFingerprint(id));const richness=(item.title.match(/scope|attachment|past performance|pricing|compliance|services|maintenance|installation|construction/gi)||[]).length;
  result.push({title:item.title,noticeId:id,agency:item.agency,agencyType:'Federal',naics:item.naics||null,naicsArea:/^\d{6}$/.test(item.naics||'')?item.naics.slice(0,2):null,valueBand:null,valueBandNote:'Not supplied by this feed; verify from the solicitation, never infer.',posted:item.posted,responseDeadline:item.deadline,daysRemaining:left,url:'https://sam.gov/opp/'+id+'/view',richnessHint:richness});
 }
 return result.sort((a,b)=>b.richnessHint-a.richnessHint||a.daysRemaining-b.daysRemaining);
}
export async function pick({origin=ORIGINS[0],pages=3,root=ROOT,fetcher=fetch}={}){
 if(!ORIGINS.includes(origin)||!Number.isInteger(pages)||pages<1||pages>10)throw Error('Use an approved public feed origin and 1–10 pages.');
 const existing=[];for(const name of await readdir(resolve(root,'content/teardowns')))if(name.endsWith('.json'))existing.push(JSON.parse(await readFile(resolve(root,'content/teardowns',name),'utf8')));
 const items=[];for(let page=0;page<pages;page++){
  const response=await fetcher(origin+'/.netlify/functions/opportunities',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'search',keyword:'',naics:'',psc:'',setAside:'',page}),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('Feed unavailable (HTTP '+response.status+'). No candidates are implied; do not bypass the feed quota.');
  const data=await response.json();if(!Array.isArray(data.items))throw Error('Unsupported opportunity response.');items.push(...data.items);
 }
 return {asOf:new Date().toISOString().slice(0,10),source:origin+'/opportunities',scope:'Federal only. Humans verify value bands and vary shapes/NAICS before choosing 2–3. Richness hints are title heuristics, not extraction results.',candidates:selectCandidates(items,existing)};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const args=process.argv.slice(2);if(args.length%2||args.some((x,i)=>i%2===0&&!['--origin','--pages'].includes(x)))throw Error('Usage: node scripts/pick-teardown-candidates.mjs [--origin URL] [--pages 1-10]');const options=Object.fromEntries(Array.from({length:args.length/2},(_,i)=>[args[2*i].slice(2),args[2*i+1]]));if(options.pages!==undefined)options.pages=Number(options.pages);console.log(JSON.stringify(await pick(options),null,2));}catch(error){console.error(error.message);process.exitCode=1;}
}
