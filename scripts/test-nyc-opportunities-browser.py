import pathlib,http.server,threading,functools,json
from playwright.sync_api import sync_playwright
root=pathlib.Path(__file__).resolve().parents[1]
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
 def do_GET(self):
  p=self.path.split('?')[0]
  if p in ['/opportunities/nyc','/opportunities','/tools/shredder']:self.path={'/opportunities/nyc':'/nyc-opportunities.html','/opportunities':'/opportunities.html','/tools/shredder':'/shredder.html'}[p]
  super().do_GET()
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(root/'dist')));threading.Thread(target=server.serve_forever,daemon=True).start();base='http://127.0.0.1:'+str(server.server_port)
items=[{'id':'99999999991','title':'Fictional NYC test notice A','agency':'Fictional agency','posted':'2026-11-08T00:00:00.000','deadline':'2099-12-01T14:00:00.000','url':'https://a856-cityrecord.nyc.gov/RequestDetail/99999999991','category':'Services'},{'id':'99999999992','title':'Fictional NYC test notice B','agency':'Fictional agency','posted':'2026-11-07T00:00:00.000','deadline':'2099-11-01T14:00:00.000','url':'https://a856-cityrecord.nyc.gov/RequestDetail/99999999992','category':'Goods'}]
checks=[]
try:
 with sync_playwright()as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for width in [390,768,1280]:
   c=browser.new_context(viewport={'width':width,'height':950});page=c.new_page();calls=[];mode='list'
   def route(r):
    u=r.request.url
    if '/.netlify/functions/nyc-opportunities'in u:
     body=r.request.post_data_json;calls.append(('nyc',body))
     if body['action']=='detail':r.fulfill(json={'item':items[0],'text':'','notice':'City Record descriptions are not complete solicitation packages. Attachments are not imported.'})
     elif mode=='error':r.fulfill(status=503,json={'error':'NYC Open Data is temporarily unavailable.'})
     else:r.fulfill(json={'items':[]if mode=='empty'else items,'page':body.get('page',0),'hasMore':body.get('page',0)==0,'cached':True,'checkedAt':'Fictional test timestamp','sourceUpdatedAt':None,'notice':'Fictional fixture only. Verify the original source.'})
    elif '/.netlify/functions/opportunities'in u:
     body=r.request.post_data_json;calls.append(('sam',body));r.fulfill(json={'item':{'title':'Fictional federal notice','url':'https://sam.gov/opp/'+'a'*32+'/view'},'text':'','notice':'Attachments are not imported.'})
    elif '/.netlify/functions/'in u:r.fulfill(json={})
    elif u.startswith(base):r.continue_()
    else:r.fulfill(status=204,body='')
   page.route('**/*',route)
   page.goto(base+'/opportunities/nyc');page.locator('.notice-card').first.wait_for();assert page.locator('.notice-card').count()==2;assert not page.locator('#naics').count();assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');assert all(x[0]=='nyc'for x in calls);assert 'not supplied by NYC'in page.locator('#nyc-source-status').inner_text();checks.append('NYC source attribution, no unsupported federal filters, mobile '+str(width))
   before=len(calls);page.locator('#nyc-sort').select_option('deadline');assert page.locator('.notice-card h2').first.inner_text().endswith('B');assert len(calls)==before
   page.locator('#nyc-keyword').fill("O'Brien");page.get_by_role('button',name='Search NYC notices',exact=True).click();page.wait_for_timeout(100);assert calls[-1][1]['keyword']=="O'Brien"and calls[-1][1]['page']==0
   page.get_by_role('button',name='Next page',exact=True).click();page.wait_for_timeout(100);assert calls[-1][1]['page']==1;assert page.locator('#nyc-next').is_disabled();checks.append('Keyword, pagination and request-free page sorting '+str(width))
   page.screenshot(path='/tmp/nyc-opportunities-'+str(width)+'.png',full_page=True)
   page.get_by_role('link',name='Shred this',exact=True).first.click();page.wait_for_function("document.querySelector('#notice-status').textContent.includes('Full solicitation text is unavailable')");assert page.locator('#notice-source').input_value()=='nyc';assert page.locator('#solicitation-title').input_value()==items[0]['title'];assert not page.locator('#solicitation-text').input_value();assert calls[-1][0]=='nyc'and calls[-1][1]['action']=='detail';assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');checks.append('NYC shredder metadata/attachment fallback, no AI submission '+str(width))
   page.locator('#notice-source').select_option('sam');page.locator('#notice').fill('a'*32);page.get_by_role('button',name='Load notice details',exact=True).click();page.wait_for_timeout(100);assert calls[-1][0]=='sam';assert page.locator('#solicitation-title').input_value()=='Fictional federal notice';checks.append('Federal handoff stays compatible '+str(width))
   mode='empty';page.goto(base+'/opportunities/nyc');page.wait_for_function("document.querySelector('#nyc-status').textContent.startsWith('0 NYC')");assert page.locator('.notice-card').count()==0;assert 'No NYC solicitation notices match'in page.locator('#nyc-notices').inner_text()
   mode='error';page.get_by_role('button',name='Search NYC notices',exact=True).click();page.wait_for_function("document.querySelector('#nyc-status').textContent.includes('unavailable')");assert page.locator('.notice-card').count()==0;assert 'No live NYC data is shown'in page.locator('#nyc-source-status').inner_text();checks.append('Honest empty and unavailable states '+str(width));c.close()
  browser.close()
 print(json.dumps({'passed':len(checks),'checks':checks,'realProviderCalls':0}))
finally:server.shutdown()
