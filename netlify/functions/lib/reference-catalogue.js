// Local, integrity-checked research snapshots. No network, provider or private KB access.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const patterns=require('./reference-patterns');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function snapshot(root,relative,expected){
 if(typeof relative!=='string'||path.isAbsolute(relative)||typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected))throw Error('Reference snapshot metadata is invalid');
 const file=fs.realpathSync(path.resolve(root,relative));if(!file.startsWith(root+path.sep))throw Error('Reference snapshot escapes catalogue root');
 const stat=fs.statSync(file);if(!stat.isFile()||stat.size>200000)throw Error('Reference snapshot exceeds its bound');
 const bytes=fs.readFileSync(file);if(digest(bytes)!==expected)throw Error('Reference snapshot integrity mismatch');return bytes;
}
function load(root){
 root=fs.realpathSync(root);const manifest=path.join(root,'catalogue.json');if(fs.statSync(manifest).size>3000000)throw Error('Reference manifest exceeds its bound');
 const catalogue=patterns.validate(JSON.parse(fs.readFileSync(manifest,'utf8')));
 for(const r of catalogue.records.filter(r=>r.reviewStatus==='approved')){snapshot(root,r.sourcePath,r.sha256);snapshot(root,r.licencePath,r.licenceSha256);}
 return catalogue;
}
function pilot(root,query){
 const catalogue=load(root),guidance=patterns.retrieve(catalogue,{...query,mode:'offline_pilot'});
 return {schema:'tendercrest-reference-pilot-v1',mode:'offline_pilot',productionEnabled:false,querySha256:digest(query.query),guidance,verifiedWinningResponseCount:guidance.filter(r=>r.verifiedWinningResponse).length,boundaries:{buyerRequirements:'current solicitation only',bidderClaims:'current approved organization evidence only',references:'optional structure suggestions; not bidder evidence or compliance decisions',requiresHumanReview:true},modelCalled:false};
}
module.exports={load,pilot};
