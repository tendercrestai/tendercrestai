"""Real browser OCR of a fictional scan; source/page pixels stay in browser.
Pinned public OCR assets download from jsDelivr; no account, email or provider generation.
"""
import pathlib,json,mimetypes
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
ROOT=pathlib.Path(__file__).resolve().parents[1];ORIGIN='https://ocr.fixture.invalid';requests=[]
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);page=browser.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 def route(r):
  u=urlparse(r.request.url)
  if u.hostname=='cdn.jsdelivr.net':assert r.request.method=='GET','No document upload to CDN';requests.append(u.path);r.continue_();return
  assert u.hostname=='ocr.fixture.invalid','Unexpected network destination '+str(u.hostname)
  path=ROOT/u.path.lstrip('/');assert path.is_file(),str(path);r.fulfill(body=path.read_bytes(),content_type='text/javascript' if path.suffix=='.mjs' else mimetypes.guess_type(str(path))[0] or 'text/plain')
 page.route('**/*',route);page.goto(ORIGIN+'/ocr.html');page.set_input_files('#ocr-file',str(ROOT/'tests/fixtures/scanned-rfp.pdf'));page.check('#ocr-consent');page.click('#ocr-run');expect(page.locator('#ocr-status')).to_contain_text('Text recovery complete',timeout=180000);text=page.locator('#ocr-text').input_value();assert 'Original SHA-256:' in text and 'OCR physical page 1' in text;expect(page.locator('#ocr-download')).to_be_enabled();assert not errors,errors;print(json.dumps({'realOCRCompleted':True,'physicalPageTrace':True,'sourceHashPresent':True,'remoteGETRequests':len(requests),'documentUploaded':False,'textLength':len(text)}));browser.close()
