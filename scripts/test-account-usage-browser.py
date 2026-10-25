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
