"""Offline real-browser test: all providers/auth/API are intercepted; no customer data."""
import copy,json,mimetypes,pathlib,subprocess
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
ROOT=pathlib.Path(__file__).resolve().parents[1];ORIGIN='https://reference.fixture.invalid';PID='11111111-1111-4111-8111-111111111111';SID='22222222-2222-4222-8222-222222222222';UID='33333333-3333-4333-8333-333333333333'
state={'title':'FICTIONAL guidance test','company':{'name':'Fictional','accent':'#1d4ed8'},'requirements':[{'id':'r1','text':'Describe agile delivery and team capacity','status':'Needs Review'}],'sections':[{'id':SID,'title':'Fictional delivery','requirementIds':['r1'],'text':'FICTIONAL current text','status':'draft'}],'evidence':[],'decision':None}
view={'role':'viewer','orgRole':'viewer','project':{'id':PID,'created_by':UID,'revision':7,'evidence_epoch':1,'state':state},'readiness':{'ready':False,'blockers':['Review needed'],'wordCount':3,'pageCount':None},'members':[{'user_id':UID,'role':'viewer','orgRole':'viewer','email_opt_in':False}],'notifications':[],'jobs':[],'files':[],'events':[],'approvals':[],'assessments':[]}
fixture=json.loads(subprocess.check_output(['node','-e',"const g=require('./netlify/functions/lib/reference-guidance').guidance;const p=JSON.parse(process.argv[1]);console.log(JSON.stringify(g(p,{sectionId:process.argv[2],jurisdiction:'US federal',sector:'IT'})));",json.dumps(view['project']),SID],cwd=ROOT,text=True))
SDK="export function createClient(){const user={id:'"+UID+"'};return {auth:{async getSession(){return {data:{session:{user,access_token:'fixture'}}}},async getUser(){return {data:{user}}},onAuthStateChange(cb){window.__authCallback=cb}}};}"
checks=[]
def check(name):checks.append(name)
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for width in [390,1280]:
  flags={'enabled':False,'fail':False};actions=[];errors=[];page=browser.new_page(viewport={'width':width,'height':900});page.on('pageerror',lambda e:errors.append(str(e)))
  def route(r):
   u=urlparse(r.request.url)
   if u.hostname=='cdn.jsdelivr.net':r.fulfill(content_type='text/javascript',body=SDK);return
   assert u.hostname=='reference.fixture.invalid','Unexpected network host '+str(u.hostname)
   if u.path.endswith('/proposal-config'):r.fulfill(json={'enabled':True,'features':{'reference':flags['enabled']},'url':'https://fixture.supabase.invalid','key':'public-fixture'});return
   if u.path.endswith('/knowledge'):r.fulfill(json={'organizations':[{'role':'viewer','org_id':PID,'kb_organizations':{'name':'Fictional'}}]});return
   if u.path.endswith('/proposals'):
    d=r.request.post_data_json;actions.append(d);a=d['action']
    if a=='list':r.fulfill(json={'projects':[]});return
    if a=='get':r.fulfill(json=view);return
    assert a=='referenceGuidance','Unexpected mutation '+a
    assert d['revision']==7 and d['evidenceEpoch']==1 and 'query' not in d and 'mode' not in d
    if flags['fail']:r.fulfill(status=409,json={'error':'This proposal changed. Reload saved changes before retrying.'});return
    response=copy.deepcopy(fixture)
    if d['jurisdiction']!='US federal' or d['sector']!='IT':response['guidance']=[]
    elif response['guidance']:response['guidance'][0]['guidance']+=' <img src=x onerror="window.__referenceXSS=true">'
    r.fulfill(json=response);return
   path=ROOT/u.path.lstrip('/');assert path.is_file(),str(path)
   typ='text/javascript' if path.suffix=='.mjs' else mimetypes.guess_type(str(path))[0] or 'text/plain';r.fulfill(content_type=typ,body=path.read_bytes())
  page.route('**/*',route);page.goto(ORIGIN+'/workspace.html#'+PID);expect(page.locator('#identity')).to_contain_text(PID);expect(page.get_by_role('button',name='Reference guidance',exact=True)).to_have_count(0);check('Flag off hides guidance '+str(width))
  flags['enabled']=True;page.reload();expect(page.locator('#identity')).to_contain_text(PID);page.get_by_role('button',name='Reference guidance',exact=True).click();expect(page.locator('#panel')).to_contain_text('not a library of verified full winning proposals');check('Viewer discovers clearly labelled guidance '+str(width))
  page.get_by_role('button',name='Find cited structure guidance',exact=True).click();expect(page.locator('#reference-results article')).not_to_have_count(0);expect(page.locator('#reference-results')).to_contain_text('saved revision 7');assert page.locator('#reference-results img').count()==0;assert page.evaluate('window.__referenceXSS') is None
  for a in page.locator('#reference-results a').all():assert a.get_attribute('href').startswith('https://github.com/') and a.get_attribute('rel')=='noopener noreferrer'
  check('Citations, revision and inert untrusted text '+str(width));assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');check('No horizontal overflow '+str(width))
  page.get_by_label('Reference sector',exact=True).select_option('consulting');expect(page.locator('#reference-results')).to_be_empty();page.get_by_role('button',name='Find cited structure guidance',exact=True).click();expect(page.locator('#reference-results')).to_contain_text('No reviewed reference matched');check('No-match is explicit and selection clears old results '+str(width))
  page.get_by_label('Reference sector',exact=True).select_option('IT');flags['fail']=True;page.get_by_role('button',name='Find cited structure guidance',exact=True).click();expect(page.locator('#message')).to_contain_text('Reload saved changes');expect(page.locator('#reference-results')).to_be_empty();check('Stale revision fails without old advice '+str(width))
  assert all(d['action'] in ['list','get','referenceGuidance'] for d in actions);assert not errors,errors;check('No browser errors or mutation actions '+str(width));page.close()
 browser.close()
print(json.dumps({'passed':len(checks),'checks':checks,'real_provider_calls':0},indent=2))
