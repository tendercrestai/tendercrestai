"""Offline customer journey regressions: every request intercepted; no account, email or payment."""
import pathlib,json,mimetypes,subprocess
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
ROOT=pathlib.Path(__file__).resolve().parents[1];ORIGIN='https://journey.fixture.invalid';UID='11111111-1111-4111-8111-111111111111';PID='22222222-2222-4222-8222-222222222222';JID='33333333-3333-4333-8333-333333333333';checks=[]
def check(name):checks.append(name);print('PASS '+name,flush=True)
SDK="""export function createClient(url,key){window.__clientUrl=url;const user={id:'11111111-1111-4111-8111-111111111111',email:'fixture@example.invalid'};return {auth:{getSession:async()=>({data:{session:window.__signed?{user,access_token:'fixture'}:null}}),getUser:async()=>({data:{user:window.__signed?user:null}}),onAuthStateChange:()=>{},signInWithPassword:async()=>{window.__signed=true;return {data:{user}}},signOut:async()=>{window.__signed=false;return {error:null}},signUp:async p=>{window.__signupRedirect=p.options.emailRedirectTo;return {data:{session:null}}},resetPasswordForEmail:async(e,p)=>{window.__resetRedirect=p.redirectTo;return {error:null}}}}} """
def static(r):
 u=urlparse(r.request.url)
 if u.hostname=='cdn.jsdelivr.net':r.fulfill(body=SDK,content_type='text/javascript');return
 if u.hostname!=urlparse(ORIGIN).hostname:r.fulfill(body='',content_type='text/css');return
 p=ROOT/u.path.lstrip('/');p=ROOT/'index.html' if u.path=='/' else p
 assert p.is_file(),str(p);r.fulfill(body=p.read_bytes(),content_type='text/javascript' if p.suffix=='.mjs' else mimetypes.guess_type(str(p))[0] or 'text/plain')
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for next,path in [('rfp-upload','/rfp-upload.html'),('compliance','/compliance.html'),('knowledge','/knowledge.html'),('workspace','/workspace.html#'+PID),('email-draft','/#portal')]:
  page=browser.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  def route(r):
   u=urlparse(r.request.url)
   if u.path=='/.netlify/functions/auth-config':r.fulfill(json={'url':'https://wcrrywzleylmdsqqlise.supabase.co','key':'sb_publishable_fixture'});return
   if u.hostname==urlparse(ORIGIN).hostname and u.path!='/auth.html' and not u.path.startswith('/assets/'):
    r.fulfill(body='<html><main>Continuation destination</main></html>',content_type='text/html');return
   static(r)
  page.route('**/*',route);page.goto(ORIGIN+'/auth.html?next='+next+'&project='+PID)
  page.fill('#loginEmail','fixture@example.invalid');page.fill('#loginPassword','fictional-password');page.locator('#loginForm button[type=submit]').click();page.wait_for_url(ORIGIN+path);assert not errors,errors;check('Login returns to '+next+' and preserves project context');page.close()
 page=browser.new_page()
 def route(r):
  if urlparse(r.request.url).path=='/.netlify/functions/auth-config':r.fulfill(json={'url':'https://wcrrywzleylmdsqqlise.supabase.co','key':'sb_publishable_fixture'});return
  static(r)
 page.route('**/*',route);page.goto(ORIGIN+'/auth.html?next=compliance&email=private@example.invalid');page.get_by_role('button',name='Create an account',exact=True).click();page.fill('#signupName','Fictional User');page.fill('#signupEmail','fixture@example.invalid');page.fill('#signupPassword','fictional-password');page.locator('#signupForm button[type=submit]').click();expect(page.locator('#message')).to_contain_text('Check your email');assert page.evaluate('window.__signupRedirect')==ORIGIN+'/auth.html?next=compliance';check('Signup confirmation keeps continuation without unrelated private query fields');page.get_by_role('button',name='Already have an account? Log in').click();page.get_by_role('button',name='Forgot password?').click();page.fill('#forgotEmail','fixture@example.invalid');page.locator('#forgotForm button[type=submit]').click();expect(page.locator('#message')).to_contain_text('If this email is registered');assert page.evaluate('window.__resetRedirect')==ORIGIN+'/auth.html?mode=reset&next=compliance';check('Password recovery preserves intended destination');page.close()
 for path in ['/auth.html','/#pricing']:
  page=browser.new_page()
  def route(r):
   if urlparse(r.request.url).path=='/.netlify/functions/auth-config':r.fulfill(status=503,json={'error':'Unavailable'});return
   static(r)
  page.route('**/*',route);page.goto(ORIGIN+path)
  if path=='/auth.html':expect(page.get_by_role('button',name='Retry account connection')).to_be_visible();expect(page.locator('#loginForm button')).to_be_disabled();assert page.evaluate('window.__clientUrl') is None;check('Missing auth configuration fails closed with a retry action')
  else:expect(page.locator('#tab-pricing')).to_be_visible();check('Pricing stays available during account service outage')
  page.close()
 # Completed previews must remain reviewable after reloading; stale suggestions cannot be applied.
 state=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./netlify/functions/lib/proposal-core').initial('FICTIONAL recovery','Fictional Cedar')))"],cwd=ROOT,text=True))
 state['sections']=[{'id':'section','title':'Fictional section','text':'Saved manual response','revision':0,'requirementIds':[],'status':'draft'}]
 for stale in [False,True]:
  page=browser.new_page(viewport={'width':390,'height':950});page.add_init_script('window.__signed=true');actions=[]
  job={'id':JID,'kind':'draft','status':'Completed','revision':3 if stale else 4,'evidence_epoch':0,'attempts':1,'result':{'sectionId':'section','text':'Fictional recovered preview'}}
  view={'project':{'id':PID,'state':state,'revision':4,'evidence_epoch':0},'role':'manager','orgRole':'owner','members':[],'directory':[],'jobs':[job,{'id':'old-export','kind':'export','status':'Completed','revision':1,'attempts':1,'result':{'fileId':'expired-file','draft':True}}],'files':[],'events':[],'notifications':[],'approvals':[],'assessments':[],'readiness':{'ready':False,'blockers':[],'warnings':[]}}
  def route(r):
   u=urlparse(r.request.url)
   if u.path.endswith('/proposal-config'):r.fulfill(json={'enabled':True,'features':{},'url':'https://wcrrywzleylmdsqqlise.supabase.co','key':'sb_publishable_fixture'});return
   if u.path.endswith('/knowledge'):r.fulfill(json={'organizations':[]});return
   if u.path.endswith('/proposals'):
    d=r.request.post_data_json;actions.append(d['action'])
    if d['action']=='list':r.fulfill(json={'projects':[]});return
    if d['action']=='get':r.fulfill(json=view);return
    if d['action']=='job':r.fulfill(json={'job':job});return
    if d['action']=='history':r.fulfill(json={'revisions':[{'revision':x,'operation':'section.saved'} for x in range(25,0,-1)] if d['page']==0 else [{'revision':0,'operation':'project.created'}]});return
    raise AssertionError('Unexpected mutation '+d['action'])
   static(r)
  page.route('**/*',route);page.goto(ORIGIN+'/workspace.html#'+PID);expect(page.locator('#identity')).to_contain_text(PID);page.get_by_role('button',name='Proposal editor',exact=True).click();page.get_by_role('button',name='Review saved section preview').click();expect(page.locator('#preview-text')).to_contain_text('Fictional recovered preview')
  if stale:expect(page.locator('#accept')).to_be_disabled();expect(page.locator('#preview-status')).to_contain_text('older revision');check('Stale saved preview can be inspected but cannot replace a current draft')
  else:expect(page.locator('#accept')).to_be_enabled();check('Completed section preview is recoverable after reload without regeneration')
  assert 'generate' not in actions and 'acceptDraft' not in actions;page.locator('#close-preview').click();page.get_by_role('button',name='Reviews',exact=True).click();page.get_by_role('button',name='Load revision history',exact=True).click();expect(page.get_by_role('button',name='Load older revisions',exact=True)).to_be_visible();page.get_by_role('button',name='Load older revisions',exact=True).click();expect(page.get_by_role('button',name='Compare revision 0 · project.created',exact=True)).to_be_visible();expect(page.get_by_role('button',name='All available revisions loaded',exact=True)).to_be_disabled();check('Older proposal revisions remain accessible beyond the first history page');page.get_by_role('button',name='Exports',exact=True).click();expect(page.locator('#panel')).to_contain_text('This package has expired');expect(page.get_by_role('button',name='Download package (DRAFT)',exact=True)).to_have_count(0);check('Expired export explains regeneration instead of offering a broken download');page.close()
 # A failed privacy deletion is retried after reload, with collection still off.
 page=browser.new_page();requests=[];failure={'enabled':True}
 def route(r):
  u=urlparse(r.request.url)
  if u.path=='/privacy-fixture':r.fulfill(body='<html data-usage-analytics="enabled"><main>Privacy fixture</main><script type="module" src="/assets/analytics.mjs"></script></html>',content_type='text/html');return
  if u.path=='/.netlify/functions/analytics':
   body=r.request.post_data_json;requests.append(body['action'])
   if body['action']=='start':r.fulfill(json={'token':'fixture-signed-token','expires':9999999999999});return
   if body['action']=='withdraw' and failure['enabled']:r.fulfill(status=503,json={'error':'temporary'});return
   r.fulfill(json={'saved':True,'withdrawn':True});return
  static(r)
 page.route('**/*',route);page.goto(ORIGIN+'/privacy-fixture');page.get_by_role('button',name='Allow usage analytics',exact=True).click();page.wait_for_function("localStorage.getItem('tendercrest.usage.visitor.v1')!==null");page.get_by_role('button',name='Usage analytics settings',exact=True).click();page.get_by_role('button',name='No thanks',exact=True).click();page.wait_for_function("JSON.parse(localStorage.getItem('tendercrest.usage.withdrawals.v1')||'[]').length===1");assert page.evaluate("localStorage.getItem('tendercrest.usage.visitor.v1')") is None;failure['enabled']=False;prior=len(requests);page.reload();page.wait_for_function("JSON.parse(localStorage.getItem('tendercrest.usage.withdrawals.v1')||'[]').length===0");assert requests[prior:]==['withdraw'];check('Failed analytics withdrawal retries after reload without resuming collection');page.close()
 browser.close()
print('Customer journey checks passed:',len(checks))
