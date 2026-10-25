"""Offline account component checks with synthetic usage and no external requests."""
import pathlib,json
from playwright.sync_api import sync_playwright,expect
ROOT=pathlib.Path(__file__).resolve().parents[1]
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for width in [390,1280]:
  page=browser.new_page(viewport={'width':width,'height':900});state={'available':True,'plan':'Growth ($699/mo)','used':6,'remaining':14,'allowance':20,'state':'active','periodEnd':'2026-11-20T12:00:00Z','asOf':'2026-10-25T12:00:00Z'};requests=[]
  def route(r):
   if r.request.url.endswith('/assets/account-usage.mjs'):r.fulfill(body=(ROOT/'assets/account-usage.mjs').read_bytes(),content_type='text/javascript');return
   if '/.netlify/functions/account-usage' in r.request.url:requests.append(r.request);r.fulfill(json=state);return
   r.fulfill(body='<html><main><div id="usage" aria-live="polite"></div></main></html>',content_type='text/html')
  page.route('**/*',route);page.goto('https://account.fixture.invalid/')
  page.evaluate("""async()=>{const {createAccountUsage}=await import('/assets/account-usage.mjs');window.usage=createAccountUsage(document.querySelector('#usage'),async()=>({data:{session:{user:{id:'fictional'},access_token:'fixture'}}}));await usage.show({id:'fictional'});} """)
  expect(page.locator('#usage')).to_contain_text('14 of 20 proposals remaining');expect(page.locator('#usage')).to_contain_text('Next billing reset:');assert requests[-1].headers['authorization']=='Bearer fixture'
  state.update(state='trial',remaining=0,used=20);page.get_by_role('button',name='Refresh allowance').click();expect(page.locator('#usage')).to_contain_text('Trial ends:');expect(page.locator('#usage')).to_contain_text('does not reset');expect(page.locator('#usage')).to_contain_text('allowance has been reached')
  state.clear();state.update(available=False,state='no_plan',message='No proposal subscription is linked.');page.get_by_role('button',name='Refresh allowance').click();expect(page.get_by_role('link',name='View plans and trial terms')).to_have_attribute('href','/#pricing')
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.evaluate('usage.clear()');expect(page.locator('#usage')).to_be_empty();print('PASS account balance, refresh, trial, exhausted allowance, missing plan, logout clear and layout',width);page.close()
 browser.close()
# Actual account page wiring, mocked SDK identity and billing response only.
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':390,'height':950});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 sdk="export function createClient(){return {auth:{getSession:async()=>({data:{session:{user:{id:'fixture',email:'fictional@example.invalid'},access_token:'fixture'}}}),onAuthStateChange:()=>{},signOut:async()=>({error:null})}}}"
 def route(r):
  url=r.request.url
  if 'cdn.jsdelivr.net' in url:r.fulfill(body=sdk,content_type='text/javascript');return
  if url.endswith('/.netlify/functions/proposal-config'):r.fulfill(json={'enabled':False});return
  if url.endswith('/.netlify/functions/account-usage'):r.fulfill(json={'available':True,'state':'active','plan':'Pro ($299/mo)','used':2,'remaining':3,'allowance':5,'periodEnd':'2026-11-20T12:00:00Z','asOf':'2026-10-25T12:00:00Z'});return
  from urllib.parse import urlparse
  file=ROOT/urlparse(url).path.lstrip('/');assert file.is_file(),str(file)
  r.fulfill(body=file.read_bytes(),content_type='text/javascript' if file.suffix=='.mjs' else 'text/html')
 page.route('**/*',route);page.goto('https://account.fixture.invalid/auth.html');expect(page.locator('#account')).to_be_visible();expect(page.locator('#accountUsage')).to_contain_text('3 of 5 proposals remaining');expect(page.locator('#accountUsage')).to_contain_text('Next billing reset:');page.get_by_role('button',name='Log out',exact=True).click();expect(page.locator('#accountUsage')).to_be_empty();expect(page.locator('#login')).to_be_visible();assert not errors,errors;print('PASS actual auth page loads allowance and clears it on logout');browser.close()
