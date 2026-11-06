import pathlib,json,http.server,threading,functools
from playwright.sync_api import sync_playwright
root=pathlib.Path(__file__).resolve().parents[1]
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
 def do_GET(self):
  if self.path in ['/compare/responsive','/compare/loopio']:self.path='/compare-'+self.path.rsplit('/',1)[-1]+'.html'
  super().do_GET()
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(root/'dist')));threading.Thread(target=server.serve_forever,daemon=True).start();base='http://127.0.0.1:'+str(server.server_port);checks=[]
try:
 with sync_playwright()as p:
  b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for slug in ['responsive','loopio']:
   for width in [390,768,1280]:
    page=b.new_page(viewport={'width':width,'height':950});page.route('**/*',lambda r:r.continue_() if r.request.url.startswith(base) and '/.netlify/functions/' not in r.request.url else r.abort());page.goto(base+'/compare/'+slug)
    assert page.locator('h1').is_visible() and page.locator('table tbody tr').count()==8
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    data=json.loads(page.locator('script[type="application/ld+json"]').text_content());faq=page.locator('details');assert len(data['mainEntity'])==faq.count()==4
    for i,q in enumerate(data['mainEntity']):assert q['name']==faq.nth(i).locator('summary').text_content() and q['acceptedAnswer']['text']==faq.nth(i).locator('p').text_content()
    assert page.locator('link[rel=canonical]').get_attribute('href')=='https://www.tendercrestai.com/compare/'+slug
    assert 'automatically' in page.locator('main').inner_text() and 'fictional' in page.locator('main').inner_text()
    if slug=='loopio':assert '$20,000' not in page.content()
    if width==390:page.locator('.table-wrap').evaluate('(e)=>e.scrollLeft=250');assert page.locator('.table-wrap').evaluate('(e)=>e.scrollLeft')>0
    assert page.get_by_role('heading',name='When '+('Loopio'if slug=='loopio'else'Responsive')+' is the better fit').count()==1
    checks.append(slug+' '+str(width)+' render/schema/legibility/claims');page.close()
  b.close()
 print(json.dumps({'passed':len(checks),'checks':checks,'thirdPartyRequests':0}))
finally:server.shutdown()
