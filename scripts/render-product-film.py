"""Offline original motion graphics + existing fictional captures; no AI/vendor calls.
Developer prerequisites: Python Playwright/Chromium and ffmpeg. Not a hosting dependency.
"""
import base64,http.server,pathlib,shutil,subprocess,tempfile,threading,json
from functools import partial
from playwright.sync_api import sync_playwright
root=pathlib.Path(__file__).resolve().parents[1];out=root/'assets/product-film';out.mkdir(parents=True,exist_ok=True)
class Quiet(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
with tempfile.TemporaryDirectory(prefix='tendercrest-film-') as folder:
 temp=pathlib.Path(folder);shutil.copy(root/'scripts/product-film.html',temp/'index.html')
 for name in ['evidence','editor','review']:shutil.copy(root/('samples/workspace-'+name+'.png'),temp/('workspace-'+name+'.png'))
 server=http.server.ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=folder));threading.Thread(target=server.serve_forever,daemon=True).start()
 try:
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);page=browser.new_page(viewport={'width':1280,'height':720});page.goto('http://127.0.0.1:'+str(server.server_port));page.evaluate('window.ready');encoded=page.evaluate('window.recordFilm()');(temp/'source.webm').write_bytes(base64.b64decode(encoded));browser.close()
 finally:server.shutdown();server.server_close()
 subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(temp/'source.webm'),'-vf','fps=24,scale=in_range=pc:out_range=tv,tpad=stop_mode=clone:stop_duration=1,format=yuv420p','-t','30','-c:v','libx264','-preset','medium','-crf','25','-an','-color_range','tv','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-movflags','+faststart','-metadata','title=TenderCrest AI — fictional product overview',str(out/'overview.mp4')],check=True)
 subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-ss','2','-i',str(out/'overview.mp4'),'-frames:v','1','-c:v','libwebp','-quality','84',str(out/'poster.webp')],check=True)
 metadata=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration,size:stream=codec_name,width,height','-of','json',str(out/'overview.mp4')],text=True));assert abs(float(metadata['format']['duration'])-30)<.1;assert (out/'overview.mp4').stat().st_size<5*1024*1024;print(json.dumps(metadata))
