import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {loadComplianceHandoff} from '../assets/compliance-handoff.mjs';
const original={fetch:globalThis.fetch,document:globalThis.document,window:globalThis.window};
const owner={id:'11111111-1111-4111-8111-111111111111'};
const id='22222222-2222-4222-8222-222222222222';
function setup(result, currentUser=owner) {
  const input={value:'Original text',dispatchEvent(){},addEventListener(){},after(){}};
  const notice={textContent:''};
  globalThis.document={getElementById:key=>key==='rfp-content'?input:notice};
  globalThis.window={};
  globalThis.fetch=async()=>Response.json(result);
  return {input,client:{auth:{getSession:async()=>({data:{session:{user:owner,access_token:'fixture'}}}),
    getUser:async()=>({data:{user:currentUser}})}}};
}
const packet={sourceText:'Private source',reviewHash:'a'.repeat(64),packet:{analysisStatus:'Partial',requirements:[{id:'R1'}],warnings:['Unreadable appendix']}};
afterEach(()=>{for(const [key,value] of Object.entries(original)) {if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
test('signout during handoff cannot restore private document text',async()=>{
  const {input,client}=setup(packet,null);
  await assert.rejects(loadComplianceHandoff(client,id),/account|sign in/i);
  assert.equal(input.value,'Original text');assert.equal(window.tendercrestComplianceContext,undefined);
});
test('account switch during handoff cannot display the previous owner source',async()=>{
  const {input,client}=setup(packet,{id:'other'});
  await assert.rejects(loadComplianceHandoff(client,id),/account|sign in/i);
  assert.equal(input.value,'Original text');
});
test('malformed handoff data is rejected before touching the form',async()=>{
  for(const result of [{}, {...packet,reviewHash:'invalid'}, {...packet,packet:null}, {...packet,sourceText:42}]) {
    const {input,client}=setup(result);
    await assert.rejects(loadComplianceHandoff(client,id));
    assert.equal(input.value,'Original text');assert.equal(window.tendercrestComplianceContext,undefined);
  }
});
test('valid handoff preserves partial analysis warnings and review digest',async()=>{
  const {input,client}=setup(packet);await loadComplianceHandoff(client,id);
  assert.equal(input.value,'Private source');assert.equal(window.tendercrestComplianceContext.complianceReviewHash,packet.reviewHash);
});
