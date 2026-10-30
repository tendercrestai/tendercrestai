import pathlib,http.server,threading,functools,json
from playwright.sync_api import sync_playwright
root=pathlib.Path(__file__).resolve().parents[1]
class Quiet(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(root/'dist')));threading.Thread(target=server.serve_forever,daemon=True).start();base='http://127.0.0.1:'+str(server.server_port);checks=[]
try:
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for path,action,expected,gpc in [('/demo.html',None,0,False),('/demo.html','decline',0,False),('/demo.html','allow',1,False),('/demo.html?gclid=fictional_click','allow',1,False),('/?gtm_debug=1790000000000','allow',1,False),('/demo.html?gtm_debug=x','allow',1,False),('/?gtm_debug=private%40example.com',None,0,False),('/auth.html',None,0,False),('/workspace.html',None,0,False),('/?token=private',None,0,False),('/#portal',None,0,False),('/demo.html',None,0,True)]:
   c=b.new_context()
   if gpc:c.add_init_script("Object.defineProperty(navigator,'globalPrivacyControl',{value:true});localStorage.setItem('tendercrest.google-ads-consent.v1',JSON.stringify({allowed:true,since:Date.now(),expires:Date.now()+100000}))")
   page=c.new_page();sdk=[];requests=[];errors=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   def route(r):
    u=r.request.url
    if 'googletagmanager.com' in u:sdk.append(u);r.fulfill(body='window.googleFixtureLoaded=true',content_type='text/javascript')
    elif u.endswith('/.netlify/functions/google-ads-conversion'):requests.append(r.request.post_data_json);r.fulfill(json={'conversion':{'transaction_id':'a'*64,'value':299,'currency':'USD'}})
    elif u.startswith(base) and '/.netlify/functions/' not in u:r.continue_()
    else:r.abort()
   page.route('**/*',route);page.goto(base+path);page.wait_for_timeout(200)
   if action:page.get_by_role('button',name=('Allow Google ad measurement' if action=='allow' else 'Decline Google ad measurement'),exact=True).click();page.wait_for_timeout(100)
   assert len(sdk)==expected,(path,action,sdk)
   assert not requests
   checks.append('Consent/route gate '+path+' '+str(action)+' GPC='+str(gpc))
   if expected:
    config=page.evaluate("Array.from(dataLayer).map(x=>Array.from(x)).find(x=>x[0]==='config')")
    assert config[1]=='AW-18539401980' and config[2]['send_page_view'] is False
    assert 'gtm_debug' not in config[2]['page_location']
    page.evaluate("async()=>{const g=await import('/assets/google-ads.mjs');await g.identifyGooglePurchase('fictional-session');await g.identifyGooglePurchase('fictional-session')}")
    events=page.evaluate("Array.from(dataLayer).map(x=>Array.from(x)).filter(x=>x[0]==='event')")
    assert len(events)==1 and events[0][1]=='conversion' and events[0][2]['send_to']=='AW-18539401980/5KPpCP7TuK0dEPylo4hF' and events[0][2]['value']==299 and events[0][2]['transaction_id']=='a'*64
    checks.append('Exact paid payload and duplicate suppression '+path)
    page.get_by_role('button',name='Google advertising settings',exact=True).click();page.get_by_role('button',name='Decline Google ad measurement',exact=True).click();page.wait_for_timeout(300)
    assert len(sdk)==1 and page.evaluate('typeof window.gtag')=='undefined';checks.append('Withdrawal unloads Google runtime '+path)
   c.close()
  for consent in [True,False]:
   c=b.new_context();c.add_init_script("localStorage.setItem('tendercrest.google-ads-consent.v1',JSON.stringify({allowed:"+str(consent).lower()+",since:Date.now()-1000,expires:Date.now()+100000}))")
   page=c.new_page();sdk=[];requests=[];page.route('**/*',route);page.goto(base+'/?gtm_debug=x');page.wait_for_timeout(200)
   assert len(sdk)==(1 if consent else 0)
   page.get_by_role('button',name='Google advertising settings',exact=True).click()
   assert page.get_by_role('button',name='Allow Google ad measurement',exact=True).is_visible()
   checks.append('Tag Assistant stored consent and visible settings '+str(consent));c.close()
  c=b.new_context();page=c.new_page();page.route('**/*',route);page.route('**/www.googletagmanager.com/**',lambda r:r.abort());page.goto(base+'/demo.html');page.get_by_role('button',name='Allow Google ad measurement',exact=True).click();page.get_by_role('status').filter(has_text='Google measurement could not load').wait_for();checks.append('Blocked Google script displays a useful status');c.close()
  # Null/trial response never becomes purchase.
  c=b.new_context();page=c.new_page();page.route('**/*',route);page.route('**/.netlify/functions/google-ads-conversion',lambda r:r.fulfill(json={'conversion':None}));page.goto(base+'/demo.html');page.get_by_role('button',name='Allow Google ad measurement',exact=True).click();page.evaluate("async()=>{const g=await import('/assets/google-ads.mjs');await g.identifyGooglePurchase('fictional-session')}");assert page.evaluate("Array.from(dataLayer).filter(x=>x[0]==='event').length")==0;checks.append('No purchase on null/trial response');c.close();b.close()
 print(json.dumps({'passed':len(checks),'checks':checks,'actualGoogleRequests':0},indent=2))
finally:server.shutdown()
