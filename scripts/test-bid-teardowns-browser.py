import pathlib,http.server,threading,functools,json,subprocess,urllib.request
from playwright.sync_api import sync_playwright
root=pathlib.Path(__file__).resolve().parents[1]
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
 def do_GET(self):
  p=self.path.split('?')[0]
  if p in ['/tools/shredder','/tools/bid-check','/opportunities']:self.path={'/tools/shredder':'/shredder.html','/tools/bid-check':'/bid-check.html','/opportunities':'/opportunities.html'}[p]
  elif p=='/teardowns':self.path='/teardowns/index.html'
  elif p.startswith('/teardowns/')and not p.endswith('.html'):self.path=p+'.html'
  super().do_GET()
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(root/'dist')));threading.Thread(target=server.serve_forever,daemon=True).start();base='http://127.0.0.1:'+str(server.server_port);checks=[]
source=(root/'samples/fictional-rfp.txt').read_text()
# Browser fixtures are computed by the actual deterministic scorer; API/provider behavior is mocked here.
code="const B=require('./netlify/functions/lib/bid-check');const a=JSON.parse(process.argv[1]);const r=[1,2,3].map(i=>({requirement:'Fictional source obligation '+i,mandatory:'Yes',recommendation:'Provide source-backed company evidence and have a reviewer assess this requirement.'}));process.stdout.write(JSON.stringify(B.score(r,a,'2026-11-01')));"
def verdict(answers):return json.loads(subprocess.check_output(['node','-e',code,json.dumps(answers)],cwd=root,text=True))
def faq_matches(page):
 for raw in page.locator('script[type="application/ld+json"]').all_text_contents():
  schema=json.loads(raw)
  if schema.get('@type')=='FAQPage':
   text=page.locator('main').inner_text()
   for q in schema['mainEntity']:assert q['name']in text and q['acceptedAnswer']['text']in text
try:
 with sync_playwright()as p:
  b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for width in [390,768,1280]:
   context=b.new_context(viewport={'width':width,'height':950});page=context.new_page();calls=[];answers={};report_calls=[];data_requests=[]
   def route(r):
    u=r.request.url
    if '/.netlify/functions/free-tools'in u:
     body=r.request.post_data_json;calls.append(body)
     if body['action']=='bid-start':answers.clear();answers.update(body['answers']);r.fulfill(status=202,json={'token':'fixture-token','status':'Pending'})
     elif body['action']=='bid-status':r.fulfill(json={'token':'fixture-token','status':'Completed','processed':1,'total':1,'title':'Fictional example','source':'Fictional source','warnings':[],'requirements':[],'bidcheck':verdict(answers)})
     elif body['action']=='bid-report':report_calls.append(body);r.fulfill(json={'leadStored':True,'document':'Fictional written report','notice':'Email accepted for sending; this is not delivery confirmation.','adminNotice':'Owner notification accepted.'})
     elif body['action']=='matrix':report_calls.append(body);r.fulfill(json={'matrix':'Fictional fixture matrix','notice':'Email pending.','adminNotice':'Owner notification pending.'})
     else:r.fulfill(json={'saved':True})
    elif '/.netlify/functions/'in u:r.fulfill(status=200,json={})
    elif u.startswith(base):r.continue_()
    else:r.fulfill(status=204,body='')
   page.route('**/*',route)
   page.goto(base+'/tools/bid-check');assert page.locator('nav').get_by_role('link',name='Bid Checker',exact=True).count()==1;faq_matches(page)
   page.locator('#solicitation-title').fill('Fictional browser check');page.locator('#solicitation-text').fill(source);page.locator('#deadline').fill('2026-12-01');page.locator('#hours').fill('40');page.locator('[name=eligibility][value=yes]').check();page.locator('[name=performance][value=similar]').check();page.locator('[name=evidence][value=most]').check()
   page.get_by_role('button',name='Check my bid',exact=True).click();assert not any(x['action']=='bid-start'for x in calls);page.locator('#processing-consent').check()
   page.locator('#deadline').fill('');page.get_by_role('button',name='Check my bid',exact=True).click();assert not any(x['action']=='bid-start'for x in calls);page.locator('#deadline').fill('2026-12-01')
   for text in ['short','x'*100001]:
    page.locator('#solicitation-text').fill(text);page.get_by_role('button',name='Check my bid',exact=True).click();page.wait_for_function("document.querySelector('#tool-status').textContent.includes('40 and 100,000')");assert not any(x['action']=='bid-start'for x in calls)
   page.locator('#solicitation-text').fill(source)
   for band,deadline,hours,eligibility,performance,evidence in [('Strong fit','2026-12-01','40','yes','similar','most'),('Worth a closer look','2026-11-11','20','unsure','related','some'),('Likely pass','2026-12-01','5','no','none','little')]:
    page.locator('#deadline').fill(deadline);page.locator('#hours').fill(hours)
    for name,value in [('eligibility',eligibility),('performance',performance),('evidence',evidence)]:page.locator('[name='+name+'][value='+value+']').check()
    page.get_by_role('button',name='Check my bid',exact=True).click();page.wait_for_function('(s)=>document.querySelector("#verdict").textContent.startsWith(s)',arg=band);assert page.locator('#factors li').count()==5;assert page.locator('#reasons li').count()==3;assert page.locator('#gaps li').count()==3;assert not report_calls;assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');assert not any(x['action']=='event'for x in calls)
   checks.append('Validation, three verdict bands, no pre-gate mail, mobile '+str(width))
   page.locator('#breakdown-email').fill('hello@tendercrestai.com');page.get_by_role('button',name='Get the full written breakdown',exact=True).click();page.locator('#breakdown-download').wait_for(state='visible');assert report_calls[-1]['email']=='hello@tendercrestai.com';checks.append('Report gate/download '+str(width))
   page.evaluate("localStorage.setItem('tendercrest.usage.choice.v1',JSON.stringify({allowed:true,expires:Date.now()+86400000}));document.documentElement.dataset.usageAnalytics='enabled'")
   page.get_by_role('button',name='Check my bid',exact=True).click();page.wait_for_function("document.querySelector('#bid-result').hidden===false");page.wait_for_timeout(100);assert any(x.get('name')=='bidcheck_completed'for x in calls);assert not any('email'in x for x in calls if x['action']=='event');checks.append('Consented metric excludes email '+str(width))
   page.screenshot(path='/tmp/bid-check-'+str(width)+'.png',full_page=True)
   page.goto(base+'/teardowns');page.wait_for_load_state('networkidle');assert page.locator('.notice-card').count()==3;assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');network=[];page.on('request',lambda r:network.append(r.url));page.locator('#agency-filter').select_option('State');assert page.locator('.notice-card:visible').count()==1;page.locator('#value-filter').select_option('Over $5M');assert page.locator('.notice-card:visible').count()==0;assert page.locator('#no-teardowns').is_visible();page.wait_for_timeout(100);assert not network;page.locator('#agency-filter').select_option('');page.locator('#value-filter').select_option('');checks.append('Teardown counts/filters without data requests '+str(width));page.screenshot(path='/tmp/teardowns-'+str(width)+'.png',full_page=True)
   links=page.locator('.notice-card h2 a').evaluate_all('(els)=>els.map(x=>x.getAttribute("href"))')
   for link in links:
    page.goto(base+link);faq_matches(page);assert 'Authored fictional illustration.'in page.locator('main').inner_text();assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');assert page.locator('script[src="/assets/reditus.mjs"]').count()==1;assert page.locator('script[src="/assets/analytics.mjs"]').count()==1
    for href in page.locator('a[href]').evaluate_all('(els)=>els.map(x=>x.getAttribute("href"))'):
     if href.startswith('/'):
      with urllib.request.urlopen(base+href.split('#')[0],timeout=10)as r:assert r.status==200,href
   checks.append('Three teardown pages: schema, links, tracker injection and mobile '+str(width));context.close()
  # Existing matrix form sends the independent publication-interest choice.
  c=b.new_context();page=c.new_page();page.route('**/*',route);page.goto(base+'/tools/shredder');page.evaluate("document.querySelector('#shred-result').hidden=false");assert not page.locator('#teardown-interest').is_checked();checks.append('Shredder opt-in is optional and defaults off');c.close();b.close()
 print(json.dumps({'passed':len(checks),'checks':checks,'realProviderCalls':0}))
finally:server.shutdown()
