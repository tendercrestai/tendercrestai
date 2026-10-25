"""Offline Chromium consent/withdrawal checks; no external destinations or real users."""
import pathlib,json,mimetypes
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
ROOT=pathlib.Path(__file__).resolve().parents[1]/'dist'
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for signal in [False,True]:
  context=browser.new_context(viewport={'width':390,'height':900})
  if signal:context.add_init_script("Object.defineProperty(navigator,'globalPrivacyControl',{value:true})")
  page=context.new_page();events=[];errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  def route(r):
   url=urlparse(r.request.url)
   assert url.hostname=='usage.fixture.invalid','External request'
   if url.path=='/.netlify/functions/analytics':
    body=r.request.post_data_json;events.append(body)
    r.fulfill(json={'token':'fictional-signed-token','expires':9999999999999} if body['action']=='start' else {'saved':True,'withdrawn':True});return
   file=ROOT/url.path.lstrip('/');assert file.is_file(),str(file)
   r.fulfill(body=file.read_bytes(),content_type='text/javascript' if file.suffix=='.mjs' else mimetypes.guess_type(str(file))[0] or 'text/plain')
  page.route('**/*',route);page.goto('https://usage.fixture.invalid/demo.html?utm_source=google&utm_campaign=secret-arbitrary-search')
  page.wait_for_timeout(150);assert not events,'Tracking before consent'
  if signal:
   expect(page.locator('#usage-choice')).to_be_hidden();print('PASS GPC prevents collection')
  else:
   expect(page.get_by_role('button',name='Allow usage analytics',exact=True)).to_be_visible()
   page.get_by_role('button',name='No thanks',exact=True).click();page.wait_for_timeout(80);assert not events
   page.get_by_role('button',name='Usage analytics settings',exact=True).click()
   page.get_by_role('button',name='Allow usage analytics',exact=True).click();page.wait_for_timeout(150)
   assert events[0]['action']=='start' and events[0]['channel']=='google' and events[0]['campaign']=='other'
   assert any(e.get('name')=='page_view' for e in events);print('PASS affirmative consent and constrained attribution')
   page.get_by_role('button',name='Usage analytics settings',exact=True).click();page.get_by_role('button',name='No thanks',exact=True).click();page.wait_for_timeout(100)
   assert events[-1]['action']=='withdraw';assert page.evaluate("localStorage.getItem('tendercrest.usage.visitor.v1')") is None
   count=len(events);page.reload();page.wait_for_timeout(150);assert len(events)==count;print('PASS withdrawal deletes browser session and stops future tracking')
  assert not errors,errors;assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');print('PASS mobile layout and no browser errors');context.close()
 browser.close()
