"""Offline customer history/download/deletion UI checks; all requests intercepted."""
import pathlib,json,mimetypes,base64
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
ROOT=pathlib.Path(__file__).resolve().parents[1];ORIGIN='https://care.fixture.invalid';ID='11111111-1111-4111-8111-111111111111';calls=[]
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);page=browser.new_page(viewport={'width':390,'height':950})
 def route(r):
  path=urlparse(r.request.url).path
  if path=='/fixture':r.fulfill(body='<html><main><div id="hub"></div></main></html>',content_type='text/html');return
  if path.endswith('/auth-config'):r.fulfill(json={'customerCare':True,'authenticatedCheckout':False,'personalDeletion':False});return
  if path.endswith('/customer-care'):
   body=r.request.post_data_json;calls.append(body);a=body['action']
   if a=='history':r.fulfill(json={'deliveries':[{'id':ID,'subject':'<img src=x onerror=alert(1)>','status':'Accepted','created_at':'2026-10-25','expires_at':'2099-01-01'}],'submissions':[],'notice':'Accepted is not inbox delivery.','hasMore':body.get('page',0)==0});return
   if a=='download':r.fulfill(json={'attachment':{'filename':'fictional.docx','content':base64.b64encode(b'fictional Word fixture').decode(),'content_type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}});return
   if a=='documents':r.fulfill(json={'documents':[{'id':ID,'file_name':'Fictional source.txt'}],'hasMore':False});return
   if a=='requestDeletion':r.fulfill(json={'request':{'id':ID,'state':'Review required'},'notice':'Request recorded. Data has not been deleted.'});return
   if a=='deletions':r.fulfill(json={'requests':[{'id':ID,'kind':'rfp','state':'Review required','updated_at':'2026-10-25'}]});return
   raise AssertionError(a)
  file=ROOT/path.lstrip('/');assert file.is_file();r.fulfill(body=file.read_bytes(),content_type='text/javascript' if file.suffix=='.mjs' else mimetypes.guess_type(str(file))[0] or 'text/plain')
 page.route('**/*',route);page.goto(ORIGIN+'/fixture');page.evaluate("""async()=>{const {createCustomerHub}=await import('/assets/customer-hub.mjs');window.hub=createCustomerHub(document.querySelector('#hub'),async()=>({data:{session:{user:{id:'fixture'},access_token:'fixture'}}}));await hub.show({id:'fixture'});} """)
 page.get_by_role('button',name='Load proposal history',exact=True).click();expect(page.locator('#hub')).to_contain_text('Accepted is not inbox delivery');assert page.locator('#hub img').count()==0
 page.get_by_role('button',name='Older proposal history',exact=True).click();assert calls[-1]['page']==1
 with page.expect_download() as download:page.get_by_role('button',name='Download retained Word draft',exact=True).click()
 assert download.value.suggested_filename=='fictional.docx';page.get_by_role('button',name='Load personal uploads',exact=True).click()
 # Handle sequential explicit reason/confirmation prompts.
 def dialogs(d):d.accept('REQUEST DELETION' if d.message.startswith('Type') else 'Fictional removal request')
 page.on('dialog',dialogs);page.get_by_role('button',name='Request deletion of Fictional source.txt',exact=True).click();expect(page.locator('#hub')).to_contain_text('Data has not been deleted.');assert not any(c['action']=='deleteUnusedPersonalSource' for c in calls);page.evaluate('hub.clear()');expect(page.locator('#hub')).to_be_hidden();print('PASS protected history, safe text, pagination, Word download, explicit deletion request and logout clearing');browser.close()
