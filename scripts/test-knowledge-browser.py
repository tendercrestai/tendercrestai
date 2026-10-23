"""Offline Chromium integration tests; all network/auth/provider calls are mocked."""
import json
import shutil
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
ORIGIN='https://fixture.tendercrest.invalid'
A='10000000-0000-4000-8000-000000000001'
B='10000000-0000-4000-8000-000000000002'
D='20000000-0000-4000-8000-000000000001'
C='30000000-0000-4000-8000-000000000001'
ANSWER='40000000-0000-4000-8000-000000000001'
QUOTE='<img src=x onerror="window.__xss=true"> source quotation'
actions=[]; errors=[]; answers=[]; enabled=True
SDK="""
export function createClient(){
 const user={id:'fixture-user'};
 return {
  auth:{
   async getSession(){return {data:{session:{user,access_token:'fictional-token'}}}},
   async getUser(){return {data:{user}}},
   onAuthStateChange(cb){window.__authCallback=cb}
  },
  storage:{from(){return {
   async upload(){return {data:{}}},
   async download(){return {data:new Blob(['original'])}}
  }}}
 };
}
"""

def route(r):
    global answers
    u=urlparse(r.request.url)
    if u.netloc=='cdn.jsdelivr.net':r.fulfill(content_type='text/javascript',body=SDK);return
    if u.netloc!='fixture.tendercrest.invalid':raise AssertionError('Unexpected external request: '+u.netloc)
    if u.path.endswith('/knowledge-config'):r.fulfill(json={'enabled':enabled,'url':'https://fixture.supabase.invalid','key':'public-fixture'});return
    if u.path.endswith('/knowledge'):
        p=r.request.post_data_json;actions.append(p);a=p['action'];out={}
        if a=='organizations':out={'organizations':[{'org_id':A,'role':'owner','kb_organizations':{'name':'Alpha'}},{'org_id':B,'role':'viewer','kb_organizations':{'name':'Beta'}}]}
        elif a=='overview':out={'role':'owner' if p['orgId']==A else 'viewer','documents':1 if p['orgId']==A else 0,'ready':1 if p['orgId']==A else 0,'processing':0,'answers':len(answers) if p['orgId']==A else 0,'approved':sum(a.get('approved_revision')==a['revision'] for a in answers) if p['orgId']==A else 0}
        elif a=='browse':
            items=([{'id':D,'file_name':'Policy.txt','status':'Ready','warnings':[]}] if p['orgId']==A else []) if p['kind']=='documents' else answers if p['kind']=='answers' and p['orgId']==A else [{'action':'answer_approved','created_at':'2026-10-22','revision':1}] if p['kind']=='activity' else []
            out={'items':items,'total':len(items),'page':0,'pageSize':25,'hasMore':False}
        elif a=='list':out={'role':'owner' if p['orgId']==A else 'viewer','documents':[{'id':D,'file_name':'Policy.txt','status':'Ready','warnings':[]} ] if p['orgId']==A else [],'answers':answers if p['orgId']==A else []}
        elif a in ('search','semantic'):out={'chunks':[{'id':C,'document_id':D,'file_name':'Policy.txt','page':1,'content':QUOTE}],'answers':[{'question':'Approved policy','answer':'Human approved','revision':1,'citations':[{'file_name':'Policy.txt','quote':QUOTE}]}]}
        elif a=='source':out={'document':{'id':D,'file_name':'Policy.txt','storage_path':A+'/'+D+'/source.txt','warnings':['Review extraction']},'chunks':[{'content':QUOTE,'page':1}]}
        elif a=='saveAnswer':
            answers=[{'id':ANSWER,'question':p['question'],'answer':p['answer'],'revision':len(answers)+1,'approved_revision':None,'kb_answer_citations':[{'chunk_id':C}]}];out={'answer':answers[0]}
        elif a=='approve':answers[0]['approved_revision']=answers[0]['revision'];out={'answer':answers[0]}
        elif a=='audit':out={'events':[{'action':'answer_approved','created_at':'2026-10-22','revision':1}]}
        else:raise AssertionError('Unhandled action '+a)
        if a in ('search','semantic'):out.update({'total':len(out['chunks']),'page':0,'pageSize':25,'hasMore':False})
        r.fulfill(json=out);return
    path=ROOT/u.path.lstrip('/')
    if not path.is_file():r.fulfill(status=404,body='Not found');return
    typ='text/javascript' if path.suffix=='.mjs' else 'text/css' if path.suffix=='.css' else 'text/html'
    r.fulfill(content_type=typ,body=path.read_bytes())
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=shutil.which('chromium'),args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':390,'height':844});page.route('**/*',route);page.on('pageerror',lambda e:(errors.append(str(e)),print('PAGEERROR',e)));page.on('console',lambda m:print('BROWSER',m.text) if m.type=='error' else None)
    enabled=False;page.goto(ORIGIN+'/knowledge.html');expect(page.locator('#message')).to_contain_text('not enabled');assert not actions
    enabled=True;page.reload();expect(page.locator('#organizations option')).to_have_count(3)
    page.select_option('#organizations',A);expect(page.locator('#documents')).to_contain_text('Policy.txt')
    page.select_option('#search-scope','semantic');page.fill('#query','security policy');page.locator('#search-form > button').click();expect(page.locator('#hits blockquote')).to_have_text(QUOTE)
    assert page.locator('#hits img').count()==0 and page.evaluate('window.__xss') is None
    expect(page.locator('#matches')).to_contain_text('Human-approved revision 1')
    page.locator('#hits input').check();expect(page.locator('#citation-count')).to_have_text('1 citations selected')
    page.fill('#answer-question','Security policy?');page.fill('#answer-text','Supported answer');page.click('#save-answer')
    expect(page.locator('#answers')).to_contain_text('Draft revision 1');expect(page.locator('#hits input')).to_have_count(0);expect(page.locator('#citation-count')).to_have_text('0 citations selected')
    assert next(x for x in actions if x['action']=='saveAnswer')['chunkIds']==[C]
    page.get_by_role('button',name='Approve saved revision').click();expect(page.locator('#answers')).to_contain_text('Approved revision 1')
    page.get_by_role('button',name='Edit draft').click();page.fill('#answer-text','Revised answer');page.click('#save-answer');expect(page.locator('#answers')).to_contain_text('Draft revision 2')
    page.get_by_role('button',name='Verify source',exact=True).click();expect(page.locator('#source-dialog')).to_be_visible();expect(page.locator('#source-content blockquote')).to_have_text(QUOTE);page.click('#close-source')
    page.click('#audit');expect(page.locator('#events')).to_contain_text('answer_approved')
    page.select_option('#organizations',B);expect(page.locator('#documents')).to_contain_text('No documents match');expect(page.locator('#hits')).to_be_empty();expect(page.locator('#answer-form')).to_be_hidden();expect(page.locator('#upload-form')).to_be_hidden()
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.evaluate("window.__authCallback('SIGNED_OUT',null)");expect(page.locator('#workspace')).to_be_hidden();expect(page.locator('#login')).to_be_visible()
    assert not errors,errors
    browser.close()
print('PASS: 12 offline browser scenarios (availability, organizations, citations/XSS, selection, draft, approval, edit invalidation, source, audit, role isolation, mobile, sign-out). No external services contacted.')
