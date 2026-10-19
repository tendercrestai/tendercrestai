const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateOutput}=require('../netlify/functions/lib/compliance-ai');
const {extractDocument,chunkDocuments}=require('../netlify/functions/lib/compliance-document');
const {retrieve,context}=require('../netlify/functions/lib/proposal-evidence');
const {buildPacket}=require('../netlify/functions/lib/proposal-compliance');
const {handler:submit}=require('../netlify/functions/submit-proposal');
const {createHandler}=require('../netlify/functions/compliance');
const quote='The vendor must provide insurance evidence.';
const segments=[{id:'s1',document_id:'doc',page:null,section:'Scope',text:quote}];
const row={segment_id:'s1',quote,category:'Legal',mandatory:'Yes',weight:null,uncertain:false};
for(const [field,values] of Object.entries({segment_id:[null,42,{},'s1&user_id=other'],quote:['',null,{},'Invented certification'],
  category:['Invented',null,[]],mandatory:['Compliant',true,null],weight:['100%',42,{}],uncertain:['false',null,1]}))
  for(const [index,value] of values.entries())test('AI output rejects malformed '+field+' variant '+index,()=>{
    assert.throws(()=>validateOutput({requirements:[{...row,[field]:value}],facts:[]},segments,[{id:'doc',name:'Fixture'}]));
  });
test('AI facts cannot introduce a value absent from the verified source quotation',()=>{
  for(const value of ['99.99% uptime','ISO 27001', '2027-01-01','America/New_York'])
    assert.throws(()=>validateOutput({requirements:[],facts:[{type:'Title',value,segment_id:'s1',quote}]},segments,[{id:'doc',name:'Fixture'}]));
});
for(const value of ['null','[]','42','true','"text"','{',''])test('both endpoints reject malformed request body '+JSON.stringify(value),async()=>{
  const env={...process.env};process.env.COMPLIANCE_PREVIEW_ENABLED='true';
  try{for(const handler of [submit,createHandler()])assert.equal((await handler({httpMethod:'POST',body:value,headers:{}})).statusCode,400);}
  finally{process.env=env;}
});
test('bounded deterministic malformed-DOCX corpus never extracts plausible text',async()=>{
  let seed=84729;
  for(let n=0;n<160;n++){
    const bytes=Buffer.alloc(n*3);for(let i=0;i<bytes.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;bytes[i]=seed&255;}
    await assert.rejects(extractDocument({extension:'docx',bytes,metadata:{id:'fixture',file_name:'fixture.docx'}}));
  }
});
test('combined 100k source boundary retains all segments and rejects overflow',()=>{
  const docs=[{segments:Array.from({length:20},(_,i)=>({id:String(i),text:'x'.repeat(5000)}))}];
  assert.equal(chunkDocuments(docs).flat().length,20);
  docs[0].segments.push({id:'overflow',text:'x'});assert.throws(()=>chunkDocuments(docs),/100,000/);
});
test('retrieval bounds hold over 200 approved records and preserve exact source offsets',()=>{
  const rows=Array.from({length:200},(_,i)=>({id:String(i).padStart(3,'0'),user_id:'owner',title:'Insurance',kind:'company_evidence',sector:'All',
    content:('  Insurance evidence number '+i+' '+ 'x'.repeat(800)+'.\n').repeat(4),source_label:'Fixture',approved:true,rights_confirmed:true}));
  const found=retrieve(rows,'owner','All','Insurance evidence');
  assert.equal(found.length,8);assert.ok(found.reduce((n,p)=>n+p.text.length,0)<=12000);
  for(const p of found){const source=rows.find(r=>r.id===p.id);assert.equal(source.content.slice(p.start,p.start+p.text.length),p.text);}
});
test('unapproved, foreign and string-valued approvals cannot contaminate retrieval',()=>{
  const common={id:'1',user_id:'owner',title:'Insurance',kind:'company_evidence',sector:'All',content:'Insurance supplied',approved:true,rights_confirmed:true};
  const rows=[{...common,user_id:'foreign'},{...common,approved:'true'},{...common,rights_confirmed:'true'},{...common,approved:false}];
  assert.deepEqual(retrieve(rows,'owner','All','Insurance'),[]);
  assert.deepEqual(JSON.parse(context('',[],{requirements:[{id:'R1'}]})).retrievalGaps,['R1']);
});
test('review hash covers every material reviewed field and all source warnings',()=>{
  const analysis={id:'analysis',user_id:'owner',status:'Completed',fingerprint:'a'.repeat(64),warnings:[],documents:[{id:'doc',segments}]};
  const requirement={id:'row',user_id:'owner',analysis_id:'analysis',revision:0,original_requirement:quote,requirement:quote,
    category:'Legal',mandatory:'Yes',evaluation_weight:null,sources:[{document_id:'doc',segment_id:'s1',page:null,section:'Scope',quote}],
    status:'Needs Review',evidence:'',evidence_reference:'',response_owner:'',comments:''};
  const digest=buildPacket(analysis,[requirement],'owner').reviewHash;
  for(const [field,value] of Object.entries({requirement:'Edited requirement',mandatory:'No',category:'Technical',evaluation_weight:'20%',status:'Partial',
    evidence:'Report',evidence_reference:'Section 2',response_owner:'Pat',comments:'Check source',revision:1}))
    assert.notEqual(buildPacket(analysis,[{...requirement,[field]:value}],'owner').reviewHash,digest,field);
  assert.notEqual(buildPacket({...analysis,warnings:['OCR required']},[requirement],'owner').reviewHash,digest);
});
