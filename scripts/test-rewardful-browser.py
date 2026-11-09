import pathlib,http.server,threading,functools,json,time
from playwright.sync_api import sync_playwright
root=pathlib.Path(__file__).resolve().parents[1];KEY='tendercrest.rewardful-consent.v1';checks=[]
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(root/'dist')));threading.Thread(target=server.serve_forever,daemon=True).start();base='http://127.0.0.1:'+str(server.server_port)
try:
 for file in (root/'dist').rglob('*.html'):
  text=file.read_text()
  if '<body'in text.lower():
   head=text.split('</head>')[0];assert head.count('id="rewardful-tracking"')==1;assert '<script>(function(w,r){w._rwq=r;w[r]=w[r]||function(){(w[r].q=w[r].q||[]).push(arguments)}})(window,\'rewardful\');</script>'in head;assert '<script async src="https://r.wdfl.co/rw.js" data-rewardful="bbbf92"></script>'in head;assert '/assets/rewardful.mjs'in head and '/assets/reditus.mjs'in head
 checks.append('Exact inert snippet and both loader modules in every built page head')
 with sync_playwright()as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  def context(init=None,blocked=False):
   c=browser.new_context();requests=[];lookups=[]
   if init:c.add_init_script(init)
   page=c.new_page()
   def route(r):
    u=r.request.url
    if u=='https://r.wdfl.co/rw.js':
     requests.append('rewardful')
     if blocked:r.abort()
     else:r.fulfill(body='window.__rwCalls=[];window.rewardful=function(){window.__rwCalls.push(Array.from(arguments));};',content_type='text/javascript')
    elif 'script.getreditus.com'in u:requests.append('reditus');r.fulfill(body='',content_type='text/javascript')
    elif '/.netlify/functions/rewardful-customer'in u:lookups.append(r.request.post_data_json);r.fulfill(json={'conversion':{'id':'a'*64,'email':'Exact.Stripe.Email@example.invalid'}})
    elif '/.netlify/functions/'in u:r.fulfill(json={})
    elif u.startswith(base):r.continue_()
    else:r.abort()
   page.route('**/*',route);return c,page,requests,lookups
  c,page,requests,lookups=context();page.goto(base+'/');page.wait_for_load_state('networkidle');assert not requests;assert page.evaluate('typeof window.rewardful')=='undefined';assert page.locator('#rewardful-choice').is_visible();checks.append('No bootstrap, SDK, cookies or conversion before Rewardful consent')
  page.evaluate("async()=>{const m=await import('/assets/rewardful.mjs');await m.identifyRewardfulCustomer('fixture-token')}");assert not lookups
  page.get_by_role('button',name='Allow Rewardful attribution',exact=True).click();page.wait_for_function('window.__rwCalls?.length===1');assert requests==['rewardful'];assert len(lookups)==1;assert set(lookups[0])=={'consent','since'}
  calls=page.evaluate('window.__rwCalls');assert calls==[['convert',{'email':'Exact.Stripe.Email@example.invalid'}]];assert page.evaluate('window._rwq')=='rewardful';assert page.locator('head > script[data-rewardful="bbbf92"]').count()==1
  page.evaluate("async()=>{const m=await import('/assets/rewardful.mjs');await m.identifyRewardfulCustomer('fixture-token');m.setRewardfulConsent(true)}");assert page.evaluate('window.__rwCalls.length')==1;assert requests==['rewardful'];assert 'Exact.Stripe.Email'not in page.evaluate('JSON.stringify(localStorage)');checks.append('Exact script executes once; verified email converts once without email storage')
  page.get_by_role('button',name='Rewardful attribution settings',exact=True).click()
  with page.expect_navigation():page.get_by_role('button',name='Decline Rewardful attribution',exact=True).click()
  page.wait_for_load_state('networkidle');assert requests==['rewardful'];assert page.evaluate('typeof window.rewardful')=='undefined';checks.append('Withdrawal reloads and stops SDK/conversion');c.close()
  red='localStorage.setItem("tendercrest.affiliate-consent.v1",JSON.stringify({allowed:true,expires:Date.now()+86400000}));'
  c,page,requests,lookups=context(red);page.goto(base+'/');page.wait_for_load_state('networkidle');assert requests==['reditus'];assert not lookups;checks.append('Existing Reditus permission and tracker remain independent');c.close()
  for mode,init,url in [('GPC',"Object.defineProperty(navigator,'globalPrivacyControl',{value:true});",'/'),('DNT',"Object.defineProperty(navigator,'doNotTrack',{value:'1'});",'/'),('Credential URL','', '/?code=fixture-secret')]:
   init+='localStorage.setItem("'+KEY+'",JSON.stringify({allowed:true,since:Date.now()-1000,expires:Date.now()+86400000}));'
   c,page,requests,lookups=context(init);page.goto(base+url);page.wait_for_load_state('networkidle');assert not requests;assert page.get_by_role('button',name='Allow Rewardful attribution',exact=True,include_hidden=True).is_disabled();assert not lookups;checks.append(mode+' blocks Rewardful even with saved consent');c.close()
  init='localStorage.setItem("'+KEY+'",JSON.stringify({allowed:true,since:Date.now()-86400000,expires:Date.now()-1}));'
  c,page,requests,lookups=context(init);page.goto(base+'/');page.wait_for_load_state('networkidle');assert not requests;assert page.locator('#rewardful-choice').is_visible();checks.append('Expired consent does not load Rewardful');c.close()
  c,page,requests,lookups=context(blocked=True);page.goto(base+'/');page.get_by_role('button',name='Allow Rewardful attribution',exact=True).click();page.get_by_role('status').filter(has_text='Rewardful tracking could not load').wait_for();page.evaluate("async()=>{const m=await import('/assets/rewardful.mjs');await m.identifyRewardfulCustomer('fixture-token')}");assert not lookups;checks.append('Blocked SDK has useful status and sends no customer email');c.close();browser.close()
 print(json.dumps({'passed':len(checks),'checks':checks,'realVendorConversions':0,'realStripeWrites':0}))
finally:server.shutdown()
