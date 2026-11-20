import {api,node}from './free-tools.mjs';
const $=id=>document.getElementById(id);
let page=0,data=null,run=0;
function sourceDate(value){const d=new Date(value||'');return Number.isNaN(d.getTime())?String(value||'Not supplied'):d.toLocaleString();}
function closeLine(item){return item.deadline?('Close date: '+sourceDate(item.deadline)+' · Central time; verify the exact closing time on the source.'):'Close date not stated.';}
function render(){
 const box=$('kcmo-notices');box.replaceChildren();const rows=[...(data?.items||[])];
 rows.sort((a,b)=>$('kcmo-sort').value==='deadline'?(a.deadline||'9999').localeCompare(b.deadline||'9999'):b.posted.localeCompare(a.posted));
 if(!rows.length)box.append(node('p','No Kansas City solicitation notices match this page and keyword. Try another keyword or page.'));
 for(const item of rows){const card=node('article');card.className='notice-card';card.append(node('p','Kansas City · Bonfire'),node('h2',item.title),node('p',item.agency),node('p','Reference: '+(item.reference||'Not supplied')),node('p','Published: '+sourceDate(item.posted)),node('p',closeLine(item)),node('p','Estimated value: not published.'));const original=node('a','View original Kansas City notice');original.href=item.url;original.target='_blank';original.rel='noopener noreferrer';const shred=node('a','Shred this');shred.className='button secondary';shred.href='/tools/shredder?provider=kcmo&notice='+encodeURIComponent(item.id);const actions=node('div');actions.className='actions';actions.append(original,shred);card.append(actions);box.append(card);}
 $('kcmo-previous').disabled=page===0;$('kcmo-next').disabled=page>=9||data?.hasMore!==true;
 $('kcmo-source-status').textContent=(data?.notice||'')+' Checked: '+(data?.checkedAt?new Date(data.checkedAt).toLocaleString():'not available')+(data?.cached?' · Cached response.':'')+(data?.total!==undefined?' Total open notices: '+data.total+'.':'');
}
async function search(){const current=++run;$('kcmo-status').textContent='Loading Kansas City solicitation notices…';try{const d=await api({action:'search',keyword:$('kcmo-keyword').value.trim(),page},'kcmo-opportunities');if(current!==run)return;data=d;$('kcmo-status').textContent=d.items.length+' Kansas City solicitation notices on page '+(page+1);render();}catch(error){if(current!==run)return;data=null;$('kcmo-notices').replaceChildren();$('kcmo-status').textContent=error.message;$('kcmo-source-status').textContent='No live Kansas City data is shown. Use the official source, search federal opportunities, or paste a solicitation into the free shredder.';$('kcmo-previous').disabled=true;$('kcmo-next').disabled=true;}}
$('kcmo-form').onsubmit=e=>{e.preventDefault();page=0;void search();};$('kcmo-sort').onchange=render;$('kcmo-previous').onclick=()=>{page--;void search();};$('kcmo-next').onclick=()=>{page++;void search();};void search();
