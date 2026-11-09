import {createHash}from 'node:crypto';
import {readFile,mkdir,writeFile,rename}from 'node:fs/promises';
import {resolve}from 'node:path';
export function sourceFingerprint(id){if(typeof id!=='string'||! /^[a-f0-9]{32}$/i.test(id))throw Error('Supply a valid private SAM notice ID.');return createHash('sha256').update(id.toLowerCase()).digest('hex');}
export async function savePrivateSource(root,facts,slug){
 const dir=resolve(root,'.private'),path=resolve(dir,'teardown-sources.json');let index={version:1,sources:{}};
 try{index=JSON.parse(await readFile(path,'utf8'));if(index.version!==1||!index.sources)throw Error('Unsupported private source index.');}catch(error){if(error.code!=='ENOENT')throw error;}
 const fingerprint=sourceFingerprint(facts.source_notice_id),existing=index.sources[fingerprint];
 if(existing&&existing.slug!==slug)throw Error('Source already belongs to another draft.');
 index.sources[fingerprint]={noticeId:facts.source_notice_id.toLowerCase(),pickedDate:facts.source_picked_date,slug};
 await mkdir(dir,{recursive:true,mode:0o700});const temporary=path+'.tmp-'+process.pid;await writeFile(temporary,JSON.stringify(index,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temporary,path);
}
