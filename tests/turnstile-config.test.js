const {test,beforeEach,afterEach}=require('node:test');const assert=require('node:assert/strict');
const config=require('../netlify/functions/turnstile-config');
let env;
beforeEach(()=>{env={...process.env};process.env.TURNSTILE_SITE_KEY='test-site-key';process.env.TURNSTILE_SECRET_KEY='test-only';});
afterEach(()=>{process.env=env;});
const body=async(event)=>JSON.parse((await config.handler(event)).body);
test('deploy-preview host disables Turnstile even with the secret configured',async()=>{
 const result=await body({headers:{host:'deploy-preview-55--tendercrestai.netlify.app'}});
 assert.equal(result.enabled,false);
});
test('production host enables Turnstile when the secret is configured',async()=>{
 const result=await body({headers:{host:'www.tendercrestai.com'}});
 assert.equal(result.enabled,true);assert.equal(result.siteKey,'test-site-key');
 assert.equal((await body()).enabled,true);
});
test('only exact deploy-preview hostnames for this site disable Turnstile',async()=>{
 for(const host of ['deploy-preview-55--evil.netlify.app','deploy-preview-55--tendercrestai.netlify.app.evil.invalid','preview-55--tendercrestai.netlify.app','tendercrestai.netlify.app']){
  assert.equal((await body({headers:{host}})).enabled,true);
 }
});
test('missing secret disables Turnstile on any host',async()=>{
 delete process.env.TURNSTILE_SECRET_KEY;
 assert.equal((await body({headers:{host:'www.tendercrestai.com'}})).enabled,false);
 assert.equal((await body({headers:{host:'deploy-preview-55--tendercrestai.netlify.app'}})).enabled,false);
});
