// Playback starts only from an explicit user gesture; native controls remain usable without JS.
for(const section of document.querySelectorAll('[data-product-film]')){
 const video=section.querySelector('video'),button=section.querySelector('[data-film-play]'),status=section.querySelector('[data-film-status]');
 if(!video||!button||!status)continue;
 button.hidden=false;
 async function play(){if(button.disabled)return;status.textContent='';button.disabled=true;let timer;try{await Promise.race([video.play(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('media_timeout')),8000);})]);}catch{video.pause();status.textContent='The video could not play. Use the transcript or interactive demo below.';button.hidden=true;}finally{clearTimeout(timer);button.disabled=false;}}
 button.addEventListener('click',play);
 for(const link of document.querySelectorAll('a[data-film-trigger]'))link.addEventListener('click',play);
 video.addEventListener('playing',()=>{if(document.activeElement===button)video.focus();button.hidden=true;});
 video.addEventListener('pause',()=>{button.hidden=false;button.setAttribute('aria-label',video.ended?'Replay 30-second overview':'Resume product overview');});
 video.addEventListener('ended',()=>{button.hidden=false;button.setAttribute('aria-label','Replay 30-second overview');});
 function unavailable(){button.hidden=true;status.textContent='The video is unavailable. The transcript and interactive demo are still available.';}
 video.addEventListener('error',unavailable);
 for(const source of video.querySelectorAll('source'))source.addEventListener('error',unavailable);
}
