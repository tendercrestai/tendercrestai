import pathlib,http.server,threading,functools,json
from playwright.sync_api import sync_playwright
root=pathlib.Path(__file__).resolve().parents[1]
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
 def do_GET(self):
  if self.path.split('?')[0] in ['/tools/shredder','/opportunities']:self.path='/'+('shredder.html'if self.path.startswith('/tools')else'opportunities.html')
  super().do_GET()
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(root/'dist')));threading.Thread(target=server.serve_forever,daemon=True).start();base='http://127.0.0.1:'+str(server.server_port);checks=[]
fixture={'token':'fixture-token','status':'Completed','processed':1,'total':1,'title':'Fictional fixture','source':'Test source','warnings':[],'requirements':[{'number':1,'requirement':'The contractor shall provide a weekly report.','mandatory':'Yes','category':'Technical','sources':[{'section':'C.1 Reports','page':None}]}],'gapPreview':[{'requirement':'Weekly report','flag':'Provide evidence','status':'Needs human review'}],'gapCount':1}
try:
 with sync_playwright()as p:
  b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for width in [390,768,1280]:
   c=b.new_context(viewport={'width':width,'height':950});page=c.new_page();calls=[]
   def route(r):
    u=r.request.url
    if '/.netlify/functions/free-tools' in u:
     body=r.request.post_data_json;calls.append(body)
     if body['action']=='start':r.fulfill(status=202,json={'token':'fixture-token','status':'Pending','dispatched':True})
     elif body['action']=='status':r.fulfill(json=fixture)
     elif body['action']=='matrix':r.fulfill(json={'leadStored':True,'matrix':'Requirement,Status\nWeekly report,Needs Review','notice':'Email not confirmed. Matrix available here.','adminNotice':'Owner notification pending.'})
     else:r.fulfill(json={'saved':True})
    elif '/.netlify/functions/opportunities' in u:
     body=r.request.post_data_json
     if body['action']=='detail':r.fulfill(json={'item':{'title':'Fictional test opportunity','url':'https://sam.gov/opp/'+'a'*32+'/view'},'text':'','notice':'Attachments are not imported.'})
     else:r.fulfill(json={'items':[{'id':'a'*32,'title':'FICTIONAL TEST OPPORTUNITY','agency':'Test agency','posted':'2026-11-01','deadline':'2026-12-01','url':'https://sam.gov/opp/'+'a'*32+'/view'}],'notice':'Test data only','checkedAt':'fixture','total':1,'cached':True})
    elif u.startswith(base) and '/.netlify/functions/' not in u:r.continue_()
    else:r.abort()
   page.route('**/*',route);page.goto(base+'/tools/shredder');assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   page.locator('#solicitation-text').fill('SECTION C\nThe contractor shall provide a weekly report.');page.locator('#processing-consent').check();page.get_by_role('button',name='Shred this solicitation',exact=True).click();page.locator('#shred-result').wait_for(state='visible');assert '1 extracted' in page.locator('#requirement-count').inner_text();assert page.locator('#requirements li').count()==1;assert not any(x['action']=='event'for x in calls)
   page.locator('#matrix-email').fill('qa@example.invalid');page.get_by_role('button',name='Get the full compliance matrix',exact=True).click();page.locator('#matrix-download').wait_for(state='visible');assert 'not confirmed' in page.locator('#matrix-status').inner_text();checks.append('Shred/list/source/preview/email fallback/mobile '+str(width))
   page.evaluate("document.documentElement.dataset.usageAnalytics='enabled';localStorage.setItem('tendercrest.usage.choice.v1',JSON.stringify({allowed:true,expires:Date.now()+100000}))")
   page.get_by_role('button',name='Get the full compliance matrix',exact=True).click();page.wait_for_timeout(150);assert any(x.get('name')=='shred_email_gate'for x in calls);assert all('email'not in x for x in calls if x['action']=='event');checks.append('Usage metrics require consent and exclude email '+str(width))
   page.goto(base+'/opportunities');page.get_by_role('link',name='Shred this',exact=True).wait_for();assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.get_by_role('link',name='Shred this',exact=True).click();page.wait_for_function("document.querySelector('#notice-status').textContent.includes('Full solicitation text is unavailable')");assert page.locator('#solicitation-title').input_value()=='Fictional test opportunity' and page.locator('#solicitation-text').input_value()=='';checks.append('Feed to shredder with honest attachment fallback '+str(width));c.close()
  page=b.new_page();page.route('**/*',route);page.route('**/.netlify/functions/free-tools',lambda r:r.fulfill(status=429,json={'error':'Free tool daily limit reached. Try after the UTC reset.'}));page.goto(base+'/tools/shredder');page.locator('#solicitation-text').fill('The contractor shall provide a monthly report and attend reviews.');page.locator('#processing-consent').check();page.get_by_role('button',name='Shred this solicitation',exact=True).click();page.locator('#limit-help').wait_for(state='visible');checks.append('Rate limit has friendly trial link');b.close()
 print(json.dumps({'passed':len(checks),'checks':checks,'realProviderCalls':0}))
finally:server.shutdown()
