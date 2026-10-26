"""Built public pages and real media in Chromium; external services are mocked/blocked."""
import pathlib,http.server,threading,subprocess,json,mimetypes,re
from functools import partial
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
root=pathlib.Path(__file__).resolve().parents[1];dist=root/'dist';checks=[]
def check(name,okay=True):assert okay,name;checks.append(name);print('PASS '+name,flush=True)
class Quiet(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  # Model the production CDN's byte-range support so real seeking is exercised.
  if urlparse(self.path).path=='/assets/product-film/overview.mp4' and self.headers.get('Range'):
   path=dist/'assets/product-film/overview.mp4';size=path.stat().st_size;m=re.fullmatch(r'bytes=(\d+)-(\d*)',self.headers['Range'])
   if not m:self.send_error(416);return
   start=int(m[1]);end=min(int(m[2]) if m[2] else size-1,size-1)
   if start>end:self.send_error(416);return
   self.send_response(206);self.send_header('Content-Type','video/mp4');self.send_header('Accept-Ranges','bytes');self.send_header('Content-Range',f'bytes {start}-{end}/{size}');self.send_header('Content-Length',str(end-start+1));self.end_headers()
   with path.open('rb') as f:
    f.seek(start)
    try:self.wfile.write(f.read(end-start+1))
    except (BrokenPipeError,ConnectionResetError):pass
   return
  super().do_GET()
mimetypes.add_type('text/vtt','.vtt');server=http.server.ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(dist)));threading.Thread(target=server.serve_forever,daemon=True).start();base='http://127.0.0.1:'+str(server.server_port)
sdk="export function createClient(){return {auth:{async getUser(){return {data:{user:null}}},async getSession(){return {data:{session:null}}},onAuthStateChange(){}}};}"
def route(r):
 u=urlparse(r.request.url)
 if u.path=='/.netlify/functions/auth-config':r.fulfill(json={'url':'https://aaaaaaaaaaaaaaaaaaaa.supabase.co','key':'sb_publishable_fixture'});return
 if u.hostname=='127.0.0.1':r.continue_();return
 if u.hostname=='cdn.jsdelivr.net':r.fulfill(body=sdk,content_type='text/javascript');return
 if u.hostname in ['fonts.googleapis.com','fonts.gstatic.com']:r.fulfill(body='',content_type='text/css');return
 r.abort()
try:
 metadata=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration,size:stream=codec_name,width,height,pix_fmt','-of','json',str(dist/'assets/product-film/overview.mp4')],text=True));check('real 30-second H.264 video, no audio and under 5 MiB',abs(float(metadata['format']['duration'])-30)<.1 and len(metadata['streams'])==1 and metadata['streams'][0]['codec_name']=='h264' and metadata['streams'][0]['pix_fmt']=='yuv420p' and int(metadata['format']['size'])<5*1024*1024)
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for name in ['index.html','demo.html']:
   for width in [390,768,1280]:
    page=browser.new_page(viewport={'width':width,'height':950},reduced_motion='reduce');page.route('**/*',route);errors=[];media=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:media.append(r.url) if '.mp4' in r.url else None);page.goto(base+'/'+name,wait_until='networkidle');video=page.locator('#product-film video');expect(video).to_be_visible();check('no video request or autoplay before interaction '+name+' '+str(width),not media and video.evaluate('(v)=>v.paused&&!v.autoplay&&v.preload==="none"'))
    page.locator('#product-film').scroll_into_view_if_needed();check('responsive layout '+name+' '+str(width),page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
    button=page.get_by_role('button',name='Play 30-second product overview',exact=True);button.focus();button.press('Space');page.wait_for_function('document.querySelector("#product-film video").currentTime>.15');check('keyboard playback succeeds '+name+' '+str(width),True)
    page.wait_for_function('document.querySelector("#product-film video").textTracks[0]?.cues?.length===5');check('five timed English captions loaded '+name+' '+str(width),video.evaluate('(v)=>v.textTracks[0].mode==="showing"'))
    video.evaluate('(v)=>v.pause()');expect(page.get_by_role('button',name='Resume product overview',exact=True)).to_be_visible();page.get_by_text('Read the walkthrough transcript',exact=True).click();expect(page.locator('.film-transcript')).to_contain_text('earlier reviewed revision');check('pause and full transcript work '+name+' '+str(width),True)
    if name=='index.html' and width==390:
     video.evaluate('(v)=>{v.currentTime=29;return v.play();}');page.wait_for_function('document.querySelector("#product-film video").ended',timeout=10000);expect(page.get_by_role('button',name='Replay 30-second overview',exact=True)).to_be_visible();check('real seeking, ending and replay control',True)
    if width in [390,1280]:page.locator('#product-film').screenshot(path='/tmp/tendercrest-film-'+name.replace('.html','')+'-'+str(width)+'.png')
    check('no browser errors '+name+' '+str(width),not errors);page.close()
  page=browser.new_page();page.route('**/*',route);page.route('**/assets/product-film/overview.mp4',lambda r:r.abort());page.goto(base+'/demo.html');page.get_by_role('button',name='Play 30-second product overview',exact=True).click();expect(page.locator('[data-film-status]')).to_contain_text('video',timeout=12000);expect(page.get_by_role('link',name='Then try the interactive demo',exact=False)).to_have_attribute('href','/demo.html#interactive-demo');check('failed video preserves transcript and interactive-demo fallback',True);page.close()
  context=browser.new_context(java_script_enabled=False);page=context.new_page();page.route('**/*',route);page.goto(base+'/demo.html');check('native video controls remain without JavaScript',page.locator('#product-film video').evaluate('(v)=>v.controls&&!v.autoplay'));page.get_by_text('Read the walkthrough transcript',exact=True).click();expect(page.locator('.film-transcript')).to_contain_text('record a human decision');check('no-JavaScript transcript remains readable',True);context.close();browser.close()
 check('private renderer sources excluded from public build',not (dist/'scripts').exists())
 print(json.dumps({'passed':len(checks),'videoBytes':metadata['format']['size'],'noExternalCustomerServicesCalled':True}))
finally:server.shutdown();server.server_close()
