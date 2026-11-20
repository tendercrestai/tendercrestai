import {api,node}from './free-tools.mjs';
const $=id=>document.getElementById(id);
let page=0,data=null,run=0;
function sourceDate(value){const d=new Date(value||'');return Number.isNaN(d.getTime())?String(value||'Not supplied'):d.toLocaleDateString();}
function closeLine(item){return item.deadline?('Close date: '+sourceDate(item.deadline)+' · verify the exact closing time on the source.'):'Close date not stated.';}
function render(){
 const box=$('la-notices');box.replaceChildren();const rows=[...(data?.items||[])];
 rows.sort((a,b)=>$('la-sort').value==='deadline'?(a.deadline||'9999').localeCompare(b.deadline||'9999'):b.posted.localeCompare(a.posted));
 if(!rows.length)box.append(node('p','No Los Angeles solicitation notices match this page and keyword. Try another keyword or page.'));
 for(const item of rows){const card=node('article');card.className='notice-card';card.append(node('p','Los Angeles · RAMP'),node('h2',item.title),node('p',item.agency),node('p','Reference: '+(item.reference||'Not supplied')),node('p','Published: '+sourceDate(item.posted)),node('p',closeLine(item)),node('p','Estimated value: not published.'));const original=node('a','View original RAMP notice');original.href=item.url;original.target='_blank';original.rel='noopener noreferrer';const shred=node('a','Shred this');shred.className='button secondary';shred.href='/tools/shredder?provider=los-angeles&notice='+encodeURIComponent(item.id);const actions=node('div');actions.className='actions';actions.append(original,shred);card.append(actions);box.append(card);}
 $('la-previous').disabled=page===0;$('la-next').disabled=page>=9||data?.hasMore!==true;
 $('la-source-status').textContent=(data?.notice||'')+' Checked: '+(data?.checkedAt?new Date(data.checkedAt).toLocaleString():'not available')+(data?.cached?' · Cached response.':'')+(data?.total!==undefined?' Total open notices: '+data.total+'.':'');
}
async function search(){const current=++run;$('la-status').textContent='Loading Los Angeles solicitation notices…';try{const d=await api({action:'search',keyword:$('la-keyword').value.trim(),page},'la-opportunities');if(current!==run)return;data=d;$('la-status').textContent=d.items.length+' Los Angeles solicitation notices on page '+(page+1);render();}catch(error){if(current!==run)return;data=null;$('la-notices').replaceChildren();$('la-status').textContent=error.message;$('la-source-status').textContent='No live Los Angeles data is shown. Use the official source, search federal opportunities, or paste a solicitation into the free shredder.';$('la-previous').disabled=true;$('la-next').disabled=true;}}
$('la-form').onsubmit=e=>{e.preventDefault();page=0;void search();};$('la-sort').onchange=render;$('la-previous').onclick=()=>{page--;void search();};$('la-next').onclick=()=>{page++;void search();};void search();
