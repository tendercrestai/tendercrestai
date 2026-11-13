import pathlib,http.server,threading,functools,json,urllib.request,os
from playwright.sync_api import sync_playwright
root=pathlib.Path(__file__).resolve().parents[1];slug='federal-emergency-generator-replacement-23-requirements'
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
 def do_GET(self):
  p=self.path.split('?')[0]
  if p=='/teardowns':self.path='/teardowns/index.html'
  elif p.startswith('/teardowns/')and not p.endswith('.html'):self.path=p+'.html'
  elif p in ['/tools/shredder','/tools/bid-check','/opportunities']:self.path={'/tools/shredder':'/shredder.html','/tools/bid-check':'/bid-check.html','/opportunities':'/opportunities.html'}[p]
  super().do_GET()
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(root/'dist')));threading.Thread(target=server.serve_forever,daemon=True).start();base='http://127.0.0.1:'+str(server.server_port);checks=[]
try:
 with sync_playwright()as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for width in [390,768,1280]:
   page=browser.new_page(viewport={'width':width,'height':950});page.route('**/*',lambda r:r.continue_()if r.request.url.startswith(base)else r.abort());page.goto(base+'/teardowns');page.wait_for_load_state('networkidle')
   assert page.locator('.notice-card').count()==4;assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');assert (page.locator('meta[name=robots]').get_attribute('content')=='noindex,nofollow')if os.environ.get('TEARDOWN_REVIEW_PREVIEW')=='true'else page.locator('meta[name=robots]').count()==0;requests=[];page.on('request',lambda r:requests.append(r.url))
   for band in ['Under $500K','$500K to $5M','Over $5M']:
    page.locator('#value-filter').select_option(band);assert not page.locator('a[href="/teardowns/'+slug+'"]').is_visible()
   page.locator('#value-filter').select_option('');assert page.locator('a[href="/teardowns/'+slug+'"]').is_visible();assert not requests;checks.append('Index, unknown-value filters, no requests and width '+str(width))
   page.goto(base+'/teardowns/'+slug);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');text=page.locator('main').inner_text();assert 'Draft for human review'not in text and '23 extracted requirements'in text and '10 marked mandatory'in text and 'Strong fit'in text
   for term in ['Example bidder profile','Available team hours: 200','Eligibility: Yes','Similar past performance: Related','Written evidence: Most','Not stated in supplied source']:assert term in text
   assert 'TODO'not in text;assert page.locator('script[src="/assets/analytics.mjs"]').count()==1
   faq=json.loads(page.locator('script[type="application/ld+json"]').inner_text())
   for item in faq['mainEntity']:assert item['name']in text and item['acceptedAnswer']['text']in text
   for href in page.locator('a[href]').evaluate_all('(els)=>els.map(x=>x.getAttribute("href"))'):
    if href.startswith('/'):
     with urllib.request.urlopen(base+href.split('#')[0],timeout=10)as r:assert r.status==200,href
   assert '/teardowns/'+slug in (root/'dist/sitemap.xml').read_text();page.screenshot(path='/tmp/teardown-pipeline-'+str(width)+'.png',full_page=True);checks.append('Proof page, profile, FAQ, links, sitemap and width '+str(width));page.close()
  browser.close()
 print(json.dumps({'passed':len(checks),'checks':checks,'realProviderCalls':0}))
finally:server.shutdown()
