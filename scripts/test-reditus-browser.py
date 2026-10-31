import pathlib,http.server,threading,functools,json
from playwright.sync_api import sync_playwright
root=pathlib.Path(__file__).resolve().parents[1]
class Quiet(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(root/'dist')));threading.Thread(target=server.serve_forever,daemon=True).start();base='http://127.0.0.1:'+str(server.server_port);checks=[]
sdk="""export function createClient(){return {auth:{async getSession(){return {data:{session:null}}},onAuthStateChange(){},async signUp(){return window.signupFixture||{data:{user:{id:'fictional-user',email:'returned-user@example.invalid',identities:[{id:'fictional-identity'}]},session:null},error:null}}}}} """
try:
 for file in (root/'dist').glob('*.html'):
  html=file.read_text()
  if '<body' in html.lower():assert '/assets/reditus.mjs' in html.split('</head>')[0],file.name
 checks.append('Shared head injection on every built HTML page with body')
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for path,consent,privacy in [('/',False,False),('/auth.html',False,False),('/demo.html?red=test',True,False),('/auth.html',True,False),('/workspace.html',True,False),('/auth.html?code=private',True,False),('/auth.html#access_token=private',True,False),('/auth.html',True,True)]:
   c=b.new_context()
   if consent:c.add_init_script("localStorage.setItem('tendercrest.affiliate-consent.v1',JSON.stringify({allowed:true,expires:Date.now()+100000}))")
   if privacy:c.add_init_script("Object.defineProperty(navigator,'globalPrivacyControl',{value:true})")
   page=c.new_page();requests=[]
   def route(r):
    u=r.request.url
    if 'script.getreditus.com' in u:requests.append(u);r.fulfill(body='',content_type='text/javascript')
    elif u.endswith('/.netlify/functions/auth-config'):r.fulfill(json={'url':'https://aaaaaaaaaaaaaaaaaaaa.supabase.co','key':'sb_publishable_fixture'})
    elif 'cdn.jsdelivr.net/npm/@supabase' in u:r.fulfill(body=sdk,content_type='text/javascript')
    elif u.startswith(base) and '/.netlify/functions/' not in u:r.continue_()
    else:r.abort()
   page.route('**/*',route);page.goto(base+path);page.wait_for_timeout(200)
   expected=consent and not privacy and 'private' not in path
   assert len(requests)==(1 if expected else 0),(path,requests)
   if expected:
    commands=page.evaluate('gr.q.map(x=>Array.from(x))');assert commands[:2]==[['initCustomer','52151d93-4c26-4a39-9346-e17eb42d38b4'],['track','pageview']]
   checks.append('Consent/privacy/callback gate '+path+' '+str(consent)+' '+str(privacy));c.close()
  # Real signup form handler using fictional Supabase responses; provider remains mocked.
  for result,expected in [(None,1),({'data':{'user':{'id':'existing','email':'existing@example.invalid','identities':[]},'session':None},'error':None},0),({'data':{},'error':{'message':'Signup unavailable'}},0)]:
   c=b.new_context();c.add_init_script("localStorage.setItem('tendercrest.affiliate-consent.v1',JSON.stringify({allowed:true,expires:Date.now()+100000}))");page=c.new_page();requests=[];page.route('**/*',route);page.goto(base+'/auth.html');page.wait_for_timeout(100)
   if result:page.evaluate('(x)=>window.signupFixture=x',result)
   page.locator('[data-view="signup"]').click();page.locator('#signupName').fill('Fictional QA');page.locator('#signupEmail').fill('form-address@example.invalid');page.locator('#signupPassword').fill('Fictional-Password-123!');page.locator('#signupForm button[type=submit]').click();page.wait_for_timeout(150)
   events=page.evaluate("gr.q.map(x=>Array.from(x)).filter(x=>x[1]==='conversion')");assert len(events)==expected
   if expected:
    assert events[0][2]=={'email':'returned-user@example.invalid'}
    page.evaluate("async()=>{const m=await import('/assets/reditus.mjs');m.trackReditusSignup({id:'fictional-user',email:'returned-user@example.invalid',identities:[{}]})}")
    assert page.evaluate("gr.q.filter(x=>x[1]==='conversion').length")==1
    assert 'returned-user@example.invalid' not in page.evaluate('JSON.stringify(localStorage)')
   checks.append('Signup success/duplicate/failure gate '+str(expected));c.close()
  b.close()
 print(json.dumps({'passed':len(checks),'checks':checks,'realProviderRequests':0,'realSignups':0},indent=2))
finally:server.shutdown()
