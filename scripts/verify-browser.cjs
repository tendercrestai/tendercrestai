// Local browser regression harness. Every external request is blocked or mocked.
// Requires Playwright in the local development runtime; no customer accounts.
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const owner={id:'11111111-1111-4111-8111-111111111111',email:'fixture@example.invalid'};
const id='22222222-2222-4222-8222-222222222222', rowId='33333333-3333-4333-8333-333333333333';
const quote='The vendor must provide insurance evidence.';
const source={document_id:'d1',document:'Fictional RFP',segment_id:'s1',page:1,section:'Section L',quote};
const workspace={analysis:{id,status:'Partial',fingerprint:'a'.repeat(64),processed:1,total_chunks:1,attempts:0,
  warnings:['Unreadable appendix needs OCR'],facts:[],documents:[{id:'d1',name:'Fictional RFP',format:'txt',warnings:[],segments:[{id:'s1',text:quote,page:1,section:'Section L'}]}]},
  requirements:[{id:rowId,analysis_id:id,user_id:owner.id,revision:0,requirement:quote,original_requirement:quote,
    category:'Legal',mandatory:'Yes',evaluation_weight:null,sources:[source],status:'Needs Review',evidence:'',evidence_reference:'',
    comments:'',response_owner:'',recommendation:'Provide evidence',uncertain:false,duplicate_count:0}],similar_pairs:[]};
const handoff={sourceText:quote,reviewHash:'a'.repeat(64),packet:{analysisStatus:'Partial',warnings:workspace.analysis.warnings,requirements:[{id:rowId}]}};
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://local'), file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{const ext=path.extname(file);res.setHeader('Content-Type',ext==='.html'?'text/html':ext==='.css'?'text/css':'text/javascript');res.end(fs.readFileSync(file));}
  catch{res.writeHead(404).end();}
});
async function run(){
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge'});
  let count=0;
  async function setup(width,options={}){
    const context=await browser.newContext({viewport:{width,height:900},acceptDownloads:true});const page=await context.newPage();
    const errors=[],blocked=[];let resolveStart,release;const started=new Promise(r=>resolveStart=r),gate=new Promise(r=>release=r);
    let state=structuredClone(workspace);
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(({owner,unauth})=>{
      window.__user=unauth?null:owner;window.__callbacks=[];
      window.__fakeClient={auth:{getUser:async()=>({data:{user:window.__user}}),
        getSession:async()=>({data:{session:window.__user?{user:window.__user,access_token:'fixture'}:null}}),
        onAuthStateChange:fn=>{window.__callbacks.push(fn);return {};}}};
    },{owner,unauth:options.unauth});
    await page.route('**/*',async route=>{
      const url=route.request().url();
      if(url.includes('cdn.jsdelivr.net/npm/@supabase'))return route.fulfill({contentType:'text/javascript',body:'export function createClient(){return window.__fakeClient}'});
      if(url.includes('/.netlify/functions/evidence-config') || url.includes('/.netlify/functions/compliance-config'))
        return route.fulfill({json:{url:'https://fixture.invalid',key:'public',enabled:true}});
      if(url.includes('/.netlify/functions/compliance')){
        const body=route.request().postDataJSON();
        if(body.action==='handoff'){
          resolveStart();if(options.delay)await gate;
          if(options.handoffStatus)return route.fulfill({status:options.handoffStatus,json:{error:'Fixture access failure'}});
          if(options.malformed)return route.fulfill({json:{sourceText:quote,reviewHash:'bad'}});
          return route.fulfill({json:handoff});
        }
        if(options.apiError)return route.fulfill({status:503,json:{error:'Fixture service unavailable'}});
        if(body.action==='list')return route.fulfill({json:{analyses:[{id,status:'Partial',created_at:'2026-10-19T00:00:00Z'}]}});
        if(body.action==='get')return route.fulfill({json:state});
        if(body.action==='update'){
          const updated={...state.requirements[0],...body.changes,revision:state.requirements[0].revision+1};
          state.requirements[0]=updated;return route.fulfill({json:{requirement:updated}});
        }
        throw Error('Unexpected browser action '+body.action);
      }
      if(url.startsWith(origin))return route.continue();
      blocked.push(url);return route.abort();
    });
    return {page,context,errors,blocked,started,release};
  }
  async function check(name,fn){await fn();count++;console.log('PASS '+name);}
  try{
    for(const width of [320,390,768,1280]){
      await check('portal handoff and detachment '+width,async()=>{
        const c=await setup(width);try{
          await c.page.goto(origin+'/?compliance='+id+'#portal');
          await c.page.waitForFunction(()=>window.tendercrestComplianceContext?.complianceReviewHash);
          assert.equal(await c.page.locator('#rfp-content').inputValue(),quote);
          assert.match(await c.page.locator('#compliance-context-notice').textContent(),/Partial.*OCR/);
          await c.page.locator('#rfp-content').fill('Edited source');
          assert.equal(await c.page.evaluate(()=>window.tendercrestComplianceContext),undefined);
          assert.match(await c.page.locator('#compliance-context-notice').textContent(),/detached/);
          assert.deepEqual(c.errors,[]);
        }finally{await c.context.close();}
      });
      await check('matrix source/edit/filter/export '+width,async()=>{
        const c=await setup(width);try{
          await c.page.goto(origin+'/compliance.html?analysis='+id);
          await c.page.getByRole('button',{name:'Verify source'}).waitFor();
          await c.page.getByRole('button',{name:'Verify source'}).focus();await c.page.keyboard.press('Enter');
          assert.equal(await c.page.locator('#source-dialog').isVisible(),true);
          assert.ok((await c.page.locator('#source-content').textContent()).includes(quote));
          await c.page.keyboard.press('Escape');
          await c.page.getByRole('button',{name:'Edit R0001'}).click();
          await c.page.locator('#edit-status').selectOption('Compliant');await c.page.locator('#save-row').click();
          assert.match(await c.page.locator('#edit-error').textContent(),/evidence/i);
          await c.page.locator('#edit-evidence').fill('Fictional signed policy');
          await c.page.locator('#edit-evidence-reference').fill('Policy section 2');
          await c.page.locator('#edit-comments').fill('<img src=x onerror=alert(1)>');await c.page.locator('#save-row').click();
          await c.page.waitForFunction(()=>!document.getElementById('edit-dialog').open);
          assert.equal(await c.page.locator('#rows img').count(),0);
          assert.ok((await c.page.locator('#rows').textContent()).includes('<img'));
          await c.page.locator('#search').fill('no-such-requirement');assert.equal(await c.page.locator('#rows tr').count(),0);
          for(const [button,extension] of [['csv','csv'],['xlsx','xlsx']]){
            const event=c.page.waitForEvent('download');await c.page.locator('#'+button).click();const download=await event;
            assert.ok(download.suggestedFilename().endsWith('.'+extension));const bytes=fs.readFileSync(await download.path());
            if(extension==='csv'){assert.ok(bytes.toString().includes('Fictional signed policy'));assert.ok(bytes.toString().includes('Partial'));}
            else assert.equal(bytes.readUInt32LE(0),0x04034b50);
          }
          assert.deepEqual(c.errors,[]);
        }finally{await c.context.close();}
      });
    }
    for(const status of [401,403,404,409,503])await check('handoff error '+status,async()=>{
      const c=await setup(390,{handoffStatus:status});try{
        await c.page.goto(origin+'/?compliance='+id+'#portal');
        await c.page.waitForFunction(()=>document.getElementById('submit-btn').disabled);
        assert.equal(await c.page.locator('#rfp-content').inputValue(),'');assert.equal(await c.page.evaluate(()=>window.tendercrestComplianceContext),undefined);
        assert.deepEqual(c.errors,[]);
      }finally{await c.context.close();}
    });
    await check('malformed response blocks submission',async()=>{
      const c=await setup(390,{malformed:true});try{await c.page.goto(origin+'/?compliance='+id+'#portal');
        await c.page.waitForFunction(()=>document.getElementById('submit-btn').disabled);assert.equal(await c.page.locator('#rfp-content').inputValue(),'');
      }finally{await c.context.close();}
    });
    await check('delayed source cannot appear after account switch',async()=>{
      const c=await setup(390,{delay:true});try{await c.page.goto(origin+'/?compliance='+id+'#portal',{waitUntil:'commit'});await c.started;
        await c.page.evaluate(()=>{window.__user={id:'other',email:'other@example.invalid'};for(const cb of window.__callbacks)cb('SIGNED_IN',{user:window.__user});});
        c.release();await c.page.waitForFunction(()=>document.getElementById('submit-btn').disabled);
        assert.equal(await c.page.locator('#rfp-content').inputValue(),'');assert.equal(await c.page.evaluate(()=>window.tendercrestComplianceContext),undefined);
      }finally{c.release();await c.context.close();}
    });
    for(const event of ['SIGNED_OUT','SIGNED_IN'])await check('loaded private context clears on '+event,async()=>{
      const c=await setup(390);try{await c.page.goto(origin+'/?compliance='+id+'#portal');
        await c.page.waitForFunction(()=>window.tendercrestComplianceContext?.complianceReviewHash);
        await c.page.evaluate(event=>{window.__user=event==='SIGNED_OUT'?null:{id:'other',email:'other@example.invalid'};
          for(const cb of window.__callbacks)cb(event,window.__user?{user:window.__user}:null);},event);
        await c.page.waitForFunction(()=>!document.getElementById('rfp-content').value);
        assert.equal(await c.page.evaluate(()=>window.tendercrestComplianceContext),undefined);
        assert.equal(await c.page.locator('#compliance-context-notice').textContent(),'');
      }finally{await c.context.close();}
    });
    for(const route of ['/compliance.html','/evidence-library.html'])await check('unauthenticated workspace '+route,async()=>{
      const c=await setup(390,{unauth:true});try{await c.page.goto(origin+route);await c.page.locator('#login').waitFor();
        assert.equal(await c.page.locator('#workspace').isVisible(),false);assert.deepEqual(c.errors,[]);
      }finally{await c.context.close();}
    });
    await check('compliance service failure stays visible',async()=>{
      const c=await setup(390,{apiError:true});try{await c.page.goto(origin+'/compliance.html');
        await c.page.waitForFunction(()=>document.getElementById('message').textContent.includes('unavailable'));assert.deepEqual(c.errors,[]);
      }finally{await c.context.close();}
    });
    console.log('BROWSER CASES PASSED: '+count);
  }finally{await browser.close();server.close();}
}
run().catch(e=>{console.error(e);server.close();process.exitCode=1;});
