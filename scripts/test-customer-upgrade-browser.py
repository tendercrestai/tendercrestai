"""Offline Chromium: all external requests intercepted, fictional identities/data only."""
import json,pathlib,mimetypes,subprocess,copy
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
ROOT=pathlib.Path(__file__).resolve().parents[1];ORIGIN='https://upgrade.fixture.invalid';PID='11111111-1111-4111-8111-111111111111';UID='22222222-2222-4222-8222-222222222222';SID='33333333-3333-4333-8333-333333333333';checks=[]
def check(name):checks.append(name);print('PASS '+name,flush=True)
def derive(s):
 code="const I=require('./netlify/functions/lib/customer-intelligence'),C=require('./netlify/functions/lib/proposal-core'),s=JSON.parse(process.argv[1]);console.log(JSON.stringify({strategy:I.strategy(s,0),qualityAudit:I.audit(s,0),preview:I.studio(s,0),onboarding:I.onboarding(s,1),hash:C.contentHash(s)}));"
 return json.loads(subprocess.check_output(['node','-e',code,json.dumps(s)],cwd=ROOT,text=True))
SDK="export function createClient(){const user={id:'"+UID+"'};return {auth:{async getSession(){return {data:{session:{user,access_token:'fixture'}}}},async getUser(){return {data:{user}}},onAuthStateChange(){}}};}"
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for width in [390,768,1280]:
  page=browser.new_page(viewport={'width':width,'height':950});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  def public(route):
   u=urlparse(route.request.url);assert u.hostname==urlparse(ORIGIN).hostname,'Demo made external request'
   path=ROOT/u.path.lstrip('/');assert path.is_file(),str(path);route.fulfill(body=path.read_bytes(),content_type='text/javascript' if path.suffix=='.mjs' else mimetypes.guess_type(str(path))[0] or 'text/plain')
  page.route('**/*',public);page.goto(ORIGIN+'/demo.html');expect(page.get_by_role('heading',name='Try the interactive demo')).to_be_visible()
  for scenario in ['it','marketing','consulting']:
   page.get_by_label('Choose a fictional RFP').select_option(scenario)
   for i in range(3):page.locator('#interactive-demo').get_by_role('button',name='Next:',exact=False).click()
   expect(page.locator('#demo-stage')).to_contain_text('Compliance summary');expect(page.locator('#demo-stage')).to_contain_text('Card required' if False else 'require a card');expect(page.locator('#demo-stage').get_by_role('link',name='Create Free Account',exact=True)).to_have_attribute('href','/auth.html?next=workspace');check('Anonymous four-stage demo '+scenario+' '+str(width))
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');assert not errors;check('Demo layout and no browser errors '+str(width));page.close()
 for role in ['manager','viewer']:
  for width in [390,1280]:
   state={'schema':1,'title':'FICTIONAL upgrade','company':{'name':'Fictional Cedar','accent':'#1d4ed8'},'requirements':[{'id':'r1','text':'Supplier must provide a service desk.','category':'Technical','mandatory':'Yes','status':'Needs Review','support':'needs review','sources':[{'document':'Fictional RFP','section':'2','quote':'Supplier must provide a service desk.'}]}],'sections':[{'id':SID,'title':'Technical response','requirementIds':['r1'],'text':'Fictional draft','revision':0,'status':'draft','claims':[],'unverified':True}],'evidence':[],'comments':[],'facts':[],'weights':{'experience':25,'certifications':25,'capacity':20,'timeline':15,'strategy':15},'bidInputs':{},'decision':None,'assessment':None,'finalApproval':None,'reviewedEpoch':0,'sourceWarnings':[],'analysis':None,'attachments':[],'archivedResponses':[]}
   derived=derive(state);view={'role':role,'orgRole':'owner' if role=='manager' else 'viewer','project':{'id':PID,'org_id':PID,'created_by':UID,'revision':0,'evidence_epoch':0,'state':state},'enhancementSnapshot':{'contentHash':derived['hash']},'readiness':{'ready':False,'blockers':['Review required'],'wordCount':2,'pageCount':None},'members':[{'user_id':UID,'role':role,'orgRole':'owner' if role=='manager' else 'viewer','email_opt_in':False,'label':'Fictional owner'}],'notifications':[],'jobs':[],'files':[],'events':[],'approvals':[],'assessments':[],'directory':[]};actions=[];errors=[];page=browser.new_page(viewport={'width':width,'height':950});page.on('pageerror',lambda e:errors.append(str(e)))
   def route(r):
    u=urlparse(r.request.url)
    if u.hostname=='cdn.jsdelivr.net':r.fulfill(content_type='text/javascript',body=SDK);return
    assert u.hostname==urlparse(ORIGIN).hostname
    if u.path.endswith('/proposal-config'):r.fulfill(json={'enabled':True,'features':{'intelligence':True},'url':'https://fixture.supabase.invalid','key':'public'});return
    if u.path.endswith('/knowledge'):r.fulfill(json={'organizations':[{'role':'owner' if role=='manager' else 'viewer','org_id':PID,'kb_organizations':{'name':'Fictional'}}]});return
    if u.path.endswith('/proposals'):
     data=r.request.post_data_json;a=data['action'];actions.append(a)
     if a=='list':r.fulfill(json={'projects':[]});return
     if a=='get':r.fulfill(json=view);return
     if a=='onboardingProgress':r.fulfill(json=derived['onboarding']);return
     if a=='documentMetadata':r.fulfill(json={'documents':[]});return
     if a=='studioPreview':r.fulfill(json=derived['preview']);return
     assert role=='manager','Viewer mutation '+a
     if a=='runStrategy':state['strategy']=derived['strategy']
     elif a=='runAudit':state['qualityAudit']=derived['qualityAudit']
     else:raise AssertionError('Unexpected action '+a)
     view['project']['revision']+=1;r.fulfill(json=view);return
    public(r)
   page.route('**/*',route);page.goto(ORIGIN+'/workspace.html#'+PID);expect(page.locator('#identity')).to_contain_text(PID);expect(page.locator('#panel')).to_contain_text('Your next step');check('Saved onboarding shown '+role+' '+str(width))
   page.get_by_role('button',name='Bid Intelligence',exact=True).click()
   if role=='manager':page.get_by_role('button',name='Generate bid strategy report',exact=True).click();expect(page.locator('#panel')).to_contain_text('No verified competitor');check('Strategy report renders source-aware missing data '+str(width))
   page.get_by_role('button',name='Compliance and Quality',exact=True).click()
   if role=='manager':page.get_by_role('button',name='Run Final Proposal Audit',exact=True).click();expect(page.locator('#panel')).to_contain_text('Readiness '+str(derived['qualityAudit']['score'])+'/100');expect(page.locator('#panel')).to_contain_text('unverified-claims');check('Quality audit and severity findings '+str(width))
   page.get_by_role('button',name='Proposal Studio',exact=True).click()
   if role=='manager':page.get_by_role('button',name='Generate whole-proposal preview',exact=True).click();expect(page.locator('#panel')).to_contain_text('NEEDS INPUT');expect(page.locator('#panel')).to_contain_text('Preview — nothing has been replaced');assert 'acceptStudio' not in actions;check('Studio previews without replacing manual draft '+str(width))
   else:expect(page.get_by_role('button',name='Generate whole-proposal preview',exact=True)).to_have_count(0);check('Viewer cannot generate or replace proposal '+str(width))
   page.get_by_role('button',name='Knowledge Library',exact=True).click();expect(page.locator('#panel').get_by_role('link',name='Open private Knowledge Library')).to_have_attribute('href','/knowledge.html')
   page.get_by_role('button',name='Settings and Billing',exact=True).click();expect(page.locator('#panel')).to_contain_text('14-day, card-required');assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');assert not errors,errors;check('Unified navigation, billing disclosure and layout '+role+' '+str(width));page.close()
 browser.close()
print('Browser checks passed: '+str(len(checks)))
