import {api,node}from './free-tools.mjs';
const $=id=>document.getElementById(id);
let page=0,data=null,run=0;
function sourceDate(value){const d=new Date(value||'');return Number.isNaN(d.getTime())?String(value||'Not supplied'):d.toLocaleString();}
function closeLine(item){return item.deadline?('Close date: '+sourceDate(item.deadline)+' · Verify the exact closing time on the source.'):'Close date not stated.';}
function daysLeft(deadline){if(!deadline)return null;const today=new Date();const start=Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate());const end=Date.parse(deadline+'T00:00:00Z');if(!Number.isFinite(end))return null;return Math.round((end-start)/86400000);}
function money(value){return typeof value==='number'?('$'+value.toLocaleString('en-US')):null;}
// "Start a grant proposal" routes by session: signed in goes to a new grant
// project in the workspace (grant preselected, title filled in); signed out
// — or when the session check cannot run — goes to the free shredder with
// the grant synopsis. The link itself always points at the shredder, so it
// stays usable when JavaScript session checks are unavailable.
async function grantDestination(item){
 const shred='/tools/shredder?provider=grants&notice='+encodeURIComponent(item.id);
 try{
  const {loadAuthConfig}=await import('./auth-journey.mjs');
  const config=await loadAuthConfig();
  const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm');
  const client=createClient(config.url,config.key);
  const {data}=await client.auth.getSession();
  if(data?.session)return '/workspace.html?grant=1&notice='+encodeURIComponent(item.id)+'&title='+encodeURIComponent(item.title.slice(0,200));
 }catch{}
 return shred;
}
function render(){
 const box=$('grants-notices');box.replaceChildren();const rows=[...(data?.items||[])];
 rows.sort((a,b)=>$('grants-sort').value==='deadline'?(a.deadline||'9999').localeCompare(b.deadline||'9999'):b.posted.localeCompare(a.posted));
 if(!rows.length)box.append(node('p','No federal grant opportunities match this page and keyword. Try another keyword or page.'));
 for(const item of rows){const card=node('article');card.className='notice-card';card.append(node('p','Federal Grants · Grants.gov'),node('h2',item.title),node('p',item.agency),node('p','Opportunity number: '+item.number),node('p','Status: '+(item.status==='forecasted'?'Forecasted: announced, not yet open':'Posted: open now')),node('p','Posted: '+sourceDate(item.posted)),node('p',closeLine(item)));
  const left=daysLeft(item.deadline);
  if(left!==null)card.append(node('p',left<0?'Close date passed. Verify the current status on Grants.gov.':left===0?'Closes today.':left<=14?('Closing soon: '+left+(left===1?' day':' days')+' left.'):left+' days left.'));
  if(item.status==='forecasted')card.append(node('p','Forecasted: announced, not yet open. The full NOFO may not be published yet.'));
  card.append(node('p','Eligibility and award amounts are on the original grant page. Check them before drafting.'));
  const original=node('a','View original grant on Grants.gov');original.href=item.url;original.target='_blank';original.rel='noopener noreferrer';const shred=node('a','Shred this');shred.className='button secondary';shred.href='/tools/shredder?provider=grants&notice='+encodeURIComponent(item.id);
  const start=node('a','Start a grant proposal');start.className='button';start.href=shred.href;start.onclick=e=>{e.preventDefault();start.textContent='Opening…';grantDestination(item).then(url=>{location.href=url;}).catch(()=>{location.href=shred.href;});};
  const amounts=node('button','Award amounts and eligibility');amounts.type='button';amounts.className='secondary';amounts.onclick=async()=>{amounts.disabled=true;amounts.textContent='Loading award details…';try{const d=await api({action:'detail',notice:item.id},'grants-opportunities');const ceiling=money(d.item.awardCeiling),floor=money(d.item.awardFloor);const lines=[];if(ceiling||floor)lines.push('Award ceiling: '+(ceiling||'not stated')+' · Award floor: '+(floor||'not stated')+'.');else lines.push('No award ceiling or floor in the Grants.gov record.');if(d.item.eligibility)lines.push('Eligibility: '+d.item.eligibility.slice(0,300));card.append(node('p',lines.join(' ')));amounts.remove();}catch(error){amounts.disabled=false;amounts.textContent='Award amounts and eligibility';card.append(node('p','Award details could not be loaded. Open the original grant on Grants.gov.'));}};
  const actions=node('div');actions.className='actions';actions.append(original,shred,start,amounts);card.append(actions);box.append(card);}
 $('grants-previous').disabled=page===0;$('grants-next').disabled=page>=9||data?.total===null||(page+1)*25>=(data?.total||0);
 $('grants-source-status').textContent=(data?.total!==null&&data?.total!==undefined?data.total+' active opportunities · ':'')+'Updated: '+(data?.checkedAt?new Date(data.checkedAt).toLocaleString():'not available')+(data?.cached?' · Cached response.':'')+' · '+(data?.notice||'')+' Closed grants and grants past their close date are excluded from this list.';
}
async function search(){const current=++run;$('grants-status').textContent='Loading federal grant opportunities…';try{const d=await api({action:'search',keyword:$('grants-keyword').value.trim(),page},'grants-opportunities');if(current!==run)return;data=d;$('grants-status').textContent=d.items.length+' federal grant opportunities on page '+(page+1);render();}catch(error){if(current!==run)return;data=null;$('grants-notices').replaceChildren();$('grants-status').textContent=error.message;$('grants-source-status').textContent='No live grants data is shown. Use the official source, search federal contract opportunities, or paste a funding opportunity into the free shredder.';$('grants-previous').disabled=true;$('grants-next').disabled=true;}}
$('grants-form').onsubmit=e=>{e.preventDefault();page=0;void search();};$('grants-sort').onchange=render;$('grants-previous').onclick=()=>{page--;void search();};$('grants-next').onclick=()=>{page++;void search();};
// A keyword in the URL (?keyword=...) starts the search: the homepage hero
// search box links here with a GET form.
const initialKeyword=new URLSearchParams(location.search).get('keyword');if(initialKeyword)$('grants-keyword').value=initialKeyword.slice(0,100);
void search();
