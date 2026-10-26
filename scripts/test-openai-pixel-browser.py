import http.server,threading,functools,json,pathlib
from playwright.sync_api import sync_playwright
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(pathlib.Path(__file__).resolve().parents[1]/'dist')));threading.Thread(target=server.serve_forever,daemon=True).start()
base='http://127.0.0.1:'+str(server.server_port)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);n=0
 for path,action,expected in [('/demo.html',None,0),('/demo.html','decline',0),('/demo.html','allow',1),('/auth.html',None,0),('/?token=private',None,0),('/#login',None,0)]:
  c=b.new_context();page=c.new_page();calls=[]
  def route(r):
   if r.request.url.startswith(base):r.continue_()
   elif 'bzrcdn.openai.com' in r.request.url:calls.append(r.request.url);r.fulfill(body='window.pixelLoaded=true',content_type='text/javascript')
   else:r.abort()
  page.route('**/*',route);page.goto(base+path);page.wait_for_timeout(250)
  if action:page.get_by_role('button',name=('Allow OpenAI advertising tracking' if action=='allow' else 'Decline advertising tracking'),exact=True).click();page.wait_for_timeout(250)
  assert len(calls)==expected,(path,action,calls)
  if expected:
   assert page.evaluate('oaiq.q[0][1].debug') is False
   assert page.evaluate('Array.from(oaiq.q[1])')==['measure','page_viewed',{'type':'contents'}]
   page.get_by_role('button',name='Advertising tracking settings',exact=True).click()
   page.get_by_role('button',name='Allow OpenAI advertising tracking',exact=True).click()
   assert page.evaluate('oaiq.q.length')==2
   page.get_by_role('button',name='Advertising tracking settings',exact=True).click()
   page.get_by_role('button',name='Decline advertising tracking',exact=True).click();page.wait_for_timeout(300)
   assert len(calls)==1 and page.evaluate('typeof window.oaiq')=='undefined'
  n+=1;c.close()
 c=b.new_context();c.add_init_script("Object.defineProperty(navigator,'globalPrivacyControl',{value:true});localStorage.setItem('tendercrest.openai-ad-consent.v1',JSON.stringify({allowed:true,expires:Date.now()+100000}))")
 page=c.new_page();calls=[];page.route('**/*',route);page.goto(base+'/demo.html');page.wait_for_timeout(250);assert not calls;n+=1
 b.close();print(json.dumps({'passed':n,'thirdPartyNetworkCalls':0}))
server.shutdown()
