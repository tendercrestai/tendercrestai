const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {load,pilot}=require('../netlify/functions/lib/reference-catalogue'),{retrieve}=require('../netlify/functions/lib/reference-patterns');
const root=path.resolve(__dirname,'../reference-library');
function copy(){const parent=fs.mkdtempSync(path.join(os.tmpdir(),'reference-snapshot-test-')),folder=path.join(parent,'library');fs.cpSync(root,folder,{recursive:true});return {parent,folder};}
test('real government guidance and retained public-domain notice match their pinned content hashes',()=>{
 const c=load(root),approved=c.records.filter(r=>r.reviewStatus==='approved');assert.equal(approved.length,4);assert.equal(approved.filter(r=>r.documentType==='government_guidance').length,3);assert.ok(approved.every(r=>r.approvalScope==='offline_pilot'));assert.equal(retrieve(c,{jurisdiction:'US federal',sector:'IT',query:'users agile metrics'}).length,0);
});
test('offline context uses attributed structure guidance without repeating RFP text or inventing compliance evidence',()=>{
 const query='FICTIONAL_PRIVATE_MARKER_923: user research, agile delivery and performance metrics.';
 const result=pilot(root,{jurisdiction:'US federal',sector:'IT',query});assert.equal(result.productionEnabled,false);assert.equal(result.modelCalled,false);assert.equal(result.guidance.length,3);assert.equal(result.verifiedWinningResponseCount,0);assert.ok(!JSON.stringify(result).includes('FICTIONAL_PRIVATE_MARKER_923'));assert.ok(result.guidance.every(g=>g.canSupportCompliance===false&&g.requiresHumanReview&&g.sourceUrl&&g.locator&&g.sha256));
});
test('no-match and jurisdiction mismatches do not fall back to a fabricated reference',()=>{for(const extra of [{query:'astronomy'},{query:'agile',jurisdiction:'US state/local'}])assert.equal(pilot(root,{jurisdiction:'US federal',sector:'IT',...extra}).guidance.length,0);});
test('changed source or licence bytes block catalogue loading',()=>{
 for(const name of ['sourcePath','licencePath']){const {parent,folder}=copy();try{const c=JSON.parse(fs.readFileSync(path.join(folder,'catalogue.json'),'utf8')),r=c.records.find(r=>r.reviewStatus==='approved');fs.appendFileSync(path.join(folder,r[name]),'\nChanged after review');assert.throws(()=>load(folder),/integrity mismatch/);}finally{fs.rmSync(parent,{recursive:true,force:true});}}
});
test('a catalogue cannot read source snapshots outside its own root',()=>{
 const {parent,folder}=copy();try{fs.writeFileSync(path.join(parent,'outside.txt'),'Fictional outside file');const file=path.join(folder,'catalogue.json'),c=JSON.parse(fs.readFileSync(file,'utf8'));c.records.find(r=>r.reviewStatus==='approved').sourcePath='../outside.txt';fs.writeFileSync(file,JSON.stringify(c));assert.throws(()=>load(folder),/escapes catalogue root/);}finally{fs.rmSync(parent,{recursive:true,force:true});}
});
