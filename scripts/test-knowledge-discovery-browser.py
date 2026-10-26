"""Offline discovery/team UX regression; every HTTP request is intercepted."""
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
import json,shutil
ROOT=Path(__file__).resolve().parents[1];ORIGIN='https://discovery.fixture.invalid'
U='11111111-1111-4111-8111-111111111111';A='22222222-2222-4222-8222-222222222222';B='33333333-3333-4333-8333-333333333333';D='44444444-4444-4444-8444-444444444444';C='55555555-5555-4555-8555-555555555555';M='66666666-6666-4666-8666-666666666666';I='77777777-7777-4777-8777-777777777777';TOKEN='c'*64
profile='owner';created=False;accepted=False;member_active=True;invite_state='Pending';actions=[];errors=[];checks=[]
SDK=f"""export function createClient(){{const user={{id:'{U}',email:'fixture@example.invalid'}};return {{auth:{{async getSession(){{return {{data:{{session:{{access_token:'fixture',user}}}}}}}},async getUser(){{return {{data:{{user}}}}}},async signInWithPassword(){{return {{data:{{user}},error:null}}}},async signOut(){{window.__authCallback?.('SIGNED_OUT',null);return {{error:null}}}},onAuthStateChange(fn){{window.__authCallback=fn}}}},storage:{{from(){{return {{async download(){{return {{data:new Blob(['original'])}}}}}}}}}}}};}}"""
def paged(items,p):
 page=p.get('page',0);size=p.get('pageSize',25);return {'items':items[page*size:(page+1)*size],'total':len(items),'page':page,'pageSize':size,'hasMore':(page+1)*size<len(items)}
def role(org):return 'viewer' if org==B else 'editor' if profile=='invited' else 'owner'
def docs(p):
 items=[{'id':D,'file_name':f'Policy {n:03}.txt','extension':'txt','status':'Ready','warnings':[]} for n in range(1,122)]
 q=p.get('query','').lower();return [d for d in items if q in d['file_name'].lower() and p.get('status','') in ('','Ready') and p.get('fileType','') in ('','txt')]
def route(r):
 global created,accepted,member_active,invite_state
 u=urlparse(r.request.url)
 if u.netloc=='cdn.jsdelivr.net':r.fulfill(content_type='text/javascript',body=SDK);return
 assert u.netloc=='discovery.fixture.invalid','Unexpected external request '+u.netloc
 if u.path.endswith('/auth-config'):r.fulfill(json={'url':'https://wcrrywzleylmdsqqlise.supabase.co','key':'sb_publishable_fixture'});return
 if u.path.endswith('/knowledge-config'):r.fulfill(json={'enabled':True,'url':'https://db.fixture.invalid','key':'public-fixture'});return
 if u.path.endswith('/knowledge'):
  p=r.request.post_data_json;actions.append(p);action=p['action'];org=p.get('orgId',A);out={}
  answer={'id':I,'question':'Needle draft question','answer':'Independent needle answer <img src=x onerror=alert(1)>','revision':1,'approved_revision':None,'sources_ready':True,'kb_answer_citations':[{'chunk_id':C}]}
  if action=='organizations':out={'organizations':([{'org_id':A,'role':role(A),'kb_organizations':{'name':'Acorn'}},{'org_id':B,'role':'viewer','kb_organizations':{'name':'Birch'}}] if profile=='owner' and created else [{'org_id':A,'role':'editor','kb_organizations':{'name':'Acorn'}}] if accepted else [])}
  elif action=='bootstrap':created=True;out={'id':A}
  elif action=='overview':out={'role':role(org),'documents':121,'ready':121,'processing':0,'answers':1,'approved':0}
  elif action=='browse':
   items=docs(p) if p['kind']=='documents' else [answer] if p['kind']=='answers' else [{'id':'1','action':'answer.approved','revision':1,'created_at':'2026-01-01','actor_id':U}]
   out=paged(items,p)
  elif action=='find':
   scope=p.get('scope','all');groups={}
   if scope in ('all','documents'):groups['documents']=paged(docs({}),p)
   if scope in ('all','answers'):groups['answers']=paged([answer] if p.get('answerStatus')!='approved' else [],p)
   if scope in ('all','excerpts'):groups['excerpts']=paged([{'id':C,'document_id':D,'file_name':'Policy 001.txt','content':'Needle source quotation','page':1}],p)
   if scope in ('all','activity') and role(org) in ('owner','reviewer'):groups['activity']=paged([{'id':'1','action':'answer.approved','revision':1,'created_at':'2026-01-01'}],p)
   out={'groups':groups,'page':p.get('page',0),'pageSize':25,'hasMore':any(g['hasMore'] for g in groups.values())}
  elif action=='semantic':out={'chunks':[{'id':C,'document_id':D,'file_name':'Policy 001.txt','content':'Meaning-based source quotation','page':1}],'answers':[],'total':1,'page':0,'pageSize':25,'hasMore':False}
  elif action=='team':out={'members':[{'user_id':U,'email':'owner@example.invalid','role':'owner','active':True},{'user_id':M,'email':'member@example.invalid','role':'viewer','active':member_active}],'invitations':[{'id':I,'email':'invitee@example.invalid','role':'editor','state':invite_state,'expires_at':'2027-01-01T00:00:00Z'}],'total':2,'page':0,'pageSize':25,'hasMore':False}
  elif action=='memberUpdate':member_active=p['active'];out={'updated':True}
  elif action=='inviteCreate':invite_state='Pending';out={'id':I,'token':TOKEN,'expires_at':'2027-01-01T00:00:00Z'}
  elif action=='inviteRevoke':invite_state='Revoked';out={'revoked':True}
  elif action=='invitePreview':out={'org_id':A,'name':'Acorn','role':'editor','accepted':False}
  elif action=='inviteAccept':accepted=True;out={'org_id':A,'name':'Acorn','role':'editor','accepted':True}
  else:raise AssertionError('Unhandled fixture action '+action)
  r.fulfill(json=out);return
 path=ROOT/u.path.lstrip('/')
 if not path.is_file():r.fulfill(status=404,body='Not found');return
 typ='text/javascript' if path.suffix=='.mjs' else 'text/css' if path.suffix=='.css' else 'text/html';r.fulfill(content_type=typ,body=path.read_bytes())
def check(label):checks.append(label);print('PASS: '+label,flush=True)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox'])
 context=browser.new_context(viewport={'width':390,'height':844});context.route('**/*',route);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
 page.goto(ORIGIN+'/knowledge.html');expect(page.locator('#org-workspace')).to_be_hidden();expect(page.locator('#guide-summary')).to_contain_text('Create an organization');check('First-time checklist explains how to unlock an empty library')
 page.fill('#org-name','Acorn');page.locator('#org-form button').click();expect(page.locator('#role')).to_contain_text('owner');expect(page.locator('#step-organization')).to_have_class('complete');check('Creating an organization opens its workspace and advances onboarding')
 for n in range(2,6):
  page.locator('#document-pages').get_by_role('button',name='Next',exact=True).click();expect(page.locator('#document-pages')).to_contain_text(f'Page {n}')
 expect(page.locator('#documents')).to_contain_text('Policy 121.txt');expect(page.locator('#document-pages')).to_contain_text('Page 5');check('Document pagination reaches records beyond 100')
 page.fill('#document-query','121');page.locator('#document-filter-form button').click();expect(page.locator('#documents li')).to_have_count(1);expect(page.locator('#documents')).to_contain_text('Policy 121');check('Filename filtering resets pagination and finds an older document')
 page.fill('#query','needle');page.locator('#search-form > button').click();expect(page.locator('#search-answers')).to_contain_text('Needle draft');expect(page.locator('#search-answers')).to_contain_text('Draft revision 1');expect(page.locator('#search-answers img')).to_have_count(0);expect(page.locator('#hits')).to_contain_text('Needle source');check('Universal text search renders drafts distinctly and treats answer text literally')
 page.locator('#search-pages').get_by_role('button',name='Next',exact=True).click();expect(page.locator('#search-pages')).to_contain_text('Page 2');assert next(x for x in reversed(actions) if x['action']=='find')['page']==1;check('Universal search pagination sends the requested server page')
 page.select_option('#search-scope','answers');page.locator('#advanced-filters summary').click();page.select_option('#search-answer-status','draft');page.fill('#search-from','2026-01-01');page.locator('#search-form > button').click();expect(page.locator('#search-answers')).to_contain_text('Draft revision');last=next(x for x in reversed(actions) if x['action']=='find');assert last['answerStatus']=='draft' and last['from']=='2026-01-01';check('Advanced answer/date filters are sent to the search endpoint')
 page.select_option('#search-scope','semantic');expect(page.locator('#search-document-status')).to_be_disabled();expect(page.locator('#search-answer-status')).to_be_disabled();expect(page.locator('#search-help')).to_contain_text('embedding provider');page.locator('#search-form > button').click();expect(page.locator('#hits')).to_contain_text('Meaning-based');expect(page.locator('#matches')).to_contain_text('Drafts are excluded');check('AI evidence mode explains provider use and excludes draft matches')
 page.fill('#activity-query','answer approved');page.click('#audit');expect(page.locator('#events')).to_contain_text('answer.approved');check('Permitted audit activity can be searched')
 page.click('#team-link');expect(page.locator('#members')).to_contain_text('owner@example.invalid');owner=page.locator('#members li').filter(has_text='owner@example.invalid');expect(owner.get_by_role('button',name='Save member')).to_have_count(0);member=page.locator('#members li').filter(has_text='member@example.invalid');member.locator('select').select_option('editor');member.locator('input[type=checkbox]').uncheck();member.get_by_role('button',name='Save member').click();expect(page.locator('#members')).to_contain_text('Inactive');check('Owner can change/deactivate members while owner access is protected')
 page.fill('#invite-email','invitee@example.invalid');page.select_option('#invite-role','editor');page.locator('#invite-form button').click();expect(page.locator('#invite-result')).to_be_visible();link=page.locator('#invite-link').input_value();assert '#invite='+TOKEN in link and '?' not in link;expect(page.locator('#message')).to_contain_text('No email');check('Owner creates a private fragment invitation link without sending email')
 page.get_by_role('button',name='Revoke invitation').click();expect(page.locator('#invitations')).to_contain_text('Revoked');expect(page.locator('#invite-result')).to_be_hidden();check('Owner can revoke an invitation and clear its sharing token')
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');check('Discovery, filters and team controls fit mobile width')
 page.select_option('#organizations',B);expect(page.locator('#role')).to_contain_text('viewer');expect(page.locator('#team-section')).to_be_hidden();expect(page.locator('#audit-section')).to_be_hidden();expect(page.locator('#answer-form')).to_be_hidden();expect(page.locator('#events')).to_be_empty();expect(page.locator('#activity-scope')).to_have_js_property('disabled',True);check('Viewer organization switch clears sensitive panels and hides restricted actions')
 page.evaluate("window.__authCallback('SIGNED_OUT',null)");expect(page.locator('#workspace')).to_be_hidden();expect(page.locator('#login')).to_be_visible();expect(page.locator('#members')).to_be_empty();check('Sign-out clears organization and membership data')
 context.close();profile='invited';context=browser.new_context(viewport={'width':390,'height':844});context.route('**/*',route);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(ORIGIN+'/knowledge.html#invite='+TOKEN);expect(page.locator('#invitation-details')).to_contain_text('Join Acorn as editor');assert '#invite=' not in page.url;assert TOKEN in page.evaluate("sessionStorage.getItem('tendercrest.kb.pendingInvite')");check('Invitation preview removes the token from the URL and waits for explicit acceptance')
 page.click('#accept-invitation');expect(page.locator('#role')).to_contain_text('editor');expect(page.locator('#invitation-section')).to_be_hidden();assert page.evaluate("sessionStorage.getItem('tendercrest.kb.pendingInvite')") is None;check('Invitation acceptance selects the joined organization and clears the token')
 page.goto(ORIGIN+'/auth.html?next=knowledge');page.wait_for_url(ORIGIN+'/knowledge.html');check('Explicit Knowledge Base sign-in return navigates to the workspace')
 assert not errors,errors;check('No browser JavaScript errors or non-fixture network requests')
 context.close();browser.close()
print(f'PASS: {len(checks)} offline discovery/team browser scenarios. No external services, emails or embedding calls.')
