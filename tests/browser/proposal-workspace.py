import sys,json,os
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
import tempfile
ORIGIN=os.environ['PROPOSAL_TEST_ORIGIN'].rstrip('/')
REF=os.environ['PROPOSAL_TEST_SUPABASE_REF']
assert urlparse(ORIGIN).scheme=='https' and urlparse(ORIGIN).hostname.endswith('.netlify.app')
assert REF!='vfdwaqgfepvoujprtuww', 'This mutating runner is test-only'
assert os.environ['PROPOSAL_TEST_ALLOW_MUTATION']=='fictional-only'
OUT=Path(os.environ.get('PROPOSAL_TEST_OUTPUT',tempfile.mkdtemp(prefix='proposal-browser-')));OUT.mkdir(parents=True,exist_ok=True)
private=json.loads(Path(os.environ['PROPOSAL_TEST_ACCOUNTS_FILE']).read_text());users=private['users'];project=os.environ['PROPOSAL_TEST_PROJECT_ID'];checks=[];errors=[];blocked=[]
def check(name,value=True):
 checks.append({'name':name,'passed':bool(value)});(OUT/'browser-results.json').write_text(json.dumps({'checks':checks,'browserErrors':errors,'blockedHosts':blocked},indent=2));print(('PASS ' if value else 'FAIL ')+name,flush=True);assert value,name
allowed={urlparse(ORIGIN).netloc,REF+'.supabase.co','cdn.jsdelivr.net'}
def guard(route):
 if urlparse(route.request.url).netloc not in allowed:blocked.append(urlparse(route.request.url).netloc);route.abort()
 else:route.continue_()
def login(page,role):
 page.goto(ORIGIN+'/auth.html');page.fill('#loginEmail',users[role]['email']);page.fill('#loginPassword',users[role]['password']);page.locator('#loginForm button[type=submit]').click();expect(page.locator('#account')).to_be_visible(timeout=30000)
def editor(page):
 page.get_by_role('button',name='Proposal editor',exact=True).click();expect(page.locator('textarea.editor')).to_be_visible()
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'],proxy={'server':os.environ['HTTPS_PROXY'],'bypass':'localhost,127.0.0.1'})
 context=browser.new_context(viewport={'width':1280,'height':900});context.route('**/*',guard);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));login(page,'owner');check('Browser real password login');expect(page.locator('#workspace-link')).to_be_visible(timeout=15000);page.click('#workspace-link');expect(page.locator('#app')).to_be_visible(timeout=30000);check('Account discovers enabled team workspace')
 page.goto(ORIGIN+'/workspace.html#'+project);expect(page.locator('#identity')).to_contain_text(project,timeout=30000);check('Saved integrated project opens');check('Fictional test project guard','FICTIONAL' in page.locator('#title').inner_text().upper());expect(page.locator('#tabs button')).to_have_count(8);check('Eight coherent workflow destinations')
 other=context.new_page();other.goto(ORIGIN+'/workspace.html#'+project);expect(other.locator('#identity')).to_contain_text(project,timeout=30000);editor(other);editor(page)
 original=page.locator('textarea.editor').input_value();updated=original+'\n\nFictional reviewer note: all company claims above refer only to synthetic evidence.';page.locator('textarea.editor').fill(updated);
 for attempt in range(2):
  try:expect(page.locator('.save-state')).to_contain_text('Saved ·',timeout=30000);break
  except Exception:
   if attempt:raise
   page.get_by_role('button',name='Save now',exact=True).click()
 check('Browser autosave succeeds');page.reload();expect(page.locator('#identity')).to_contain_text(project,timeout=30000);editor(page);expect(page.locator('textarea.editor')).to_have_value(updated);check('Autosave survives reload and resume')
 other.locator('textarea.editor').fill('UNSAVED CONCURRENT EDIT - preserve for reconciliation');expect(other.locator('.save-state')).to_contain_text('Conflict',timeout=30000);expect(other.locator('textarea.editor')).to_have_value('UNSAVED CONCURRENT EDIT - preserve for reconciliation');check('Stale concurrent edit preserved without overwrite');page.reload();expect(page.locator('#identity')).to_contain_text(project,timeout=30000);editor(page);expect(page.locator('textarea.editor')).to_have_value(updated);check('Winning saved revision remains intact')
 page.get_by_role('button',name='Bid assessment',exact=True).click();expect(page.locator('#panel')).to_contain_text('STALE');check('Text changes visibly stale the assessment');page.get_by_role('button',name='Exports',exact=True).click();expect(page.locator('#panel')).to_contain_text('Section needs content or revision approval');check('Changed approved content blocks final readiness');page.get_by_role('button',name='Sign off this saved content',exact=True).click();# required reason prevents accidental request
 page.get_by_role('button',name='Evidence',exact=True).click();expect(page.locator('#panel')).to_contain_text('approved answer');check('Evidence view exposes approved revision and source references');page.locator('#panel details').first.locator('summary').click();expect(page.locator('#panel blockquote').first).to_be_visible();check('Exact supporting excerpt can be inspected')
 page.set_viewport_size({'width':390,'height':844});check('Mobile evidence layout has no horizontal overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth'));page.screenshot(path=str(OUT/'workspace-mobile.png'),full_page=False)
 # Isolated viewer context uses a real viewer JWT and disabled editing controls.
 vc=browser.new_context(viewport={'width':390,'height':844});vc.route('**/*',guard);vp=vc.new_page();login(vp,'viewer');vp.goto(ORIGIN+'/workspace.html#'+project);expect(vp.locator('#identity')).to_contain_text(project,timeout=30000);editor(vp);expect(vp.locator('textarea.editor')).to_be_disabled();check('Viewer sees read-only editor');vp.get_by_role('button',name='Reviews',exact=True).click();expect(vp.get_by_role('button',name='Record revision review',exact=True)).to_have_count(0);check('Viewer has no approval controls');vc.close()
 check('No browser JavaScript exceptions',not errors);check('No production, payment or email hosts contacted',not blocked);other.close(run_before_unload=False);context.close();browser.close()
