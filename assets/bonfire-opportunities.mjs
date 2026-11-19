import {api,node}from './free-tools.mjs';
const $=id=>document.getElementById(id);
let page=0,data=null,run=0;
function sourceDate(value){const d=new Date(value||'');return Number.isNaN(d.getTime())?String(value||'Not supplied'):d.toLocaleString();}
function closeLine(item){return item.deadline?('Close date: '+sourceDate(item.deadline)+' · Mountain time; verify the exact closing time on the source.'):'Close date not stated.';}
function render(){
 const box=$('bonfire-notices');box.replaceChildren();const rows=[...(data?.items||[])];
 rows.sort((a,b)=>$('bonfire-sort').value==='deadline'?(a.deadline||'9999').localeCompare(b.deadline||'9999'):b.posted.localeCompare(a.posted));
 if(!rows.length)box.append(node('p','No Utah solicitation notices match this page and keyword. Try another keyword or page.'));
 for(const item of rows){const card=node('article');card.className='notice-card';card.append(node('p','Utah · Bonfire'),node('h2',item.title),node('p',item.agency),node('p','Reference: '+(item.reference||'Not supplied')),node('p','Published: '+sourceDate(item.posted)),node('p',closeLine(item)),node('p','Estimated value: not published.'));const original=node('a','View original Utah notice');original.href=item.url;original.target='_blank';original.rel='noopener noreferrer';const shred=node('a','Shred this');shred.className='button secondary';shred.href='/tools/shredder?provider=bonfire&notice='+encodeURIComponent(item.id);const actions=node('div');actions.className='actions';actions.append(original,shred);card.append(actions);box.append(card);}
 $('bonfire-previous').disabled=page===0;$('bonfire-next').disabled=page>=9||data?.hasMore!==true;
 $('bonfire-source-status').textContent=(data?.notice||'')+' Checked: '+(data?.checkedAt?new Date(data.checkedAt).toLocaleString():'not available')+(data?.cached?' · Cached response.':'')+(data?.total!==undefined?' Total open notices: '+data.total+'.':'');
}
async function search(){const current=++run;$('bonfire-status').textContent='Loading Utah solicitation notices…';try{const d=await api({action:'search',keyword:$('bonfire-keyword').value.trim(),page},'bonfire-opportunities');if(current!==run)return;data=d;$('bonfire-status').textContent=d.items.length+' Utah solicitation notices on page '+(page+1);render();}catch(error){if(current!==run)return;data=null;$('bonfire-notices').replaceChildren();$('bonfire-status').textContent=error.message;$('bonfire-source-status').textContent='No live Utah data is shown. Use the official source, search federal opportunities, or paste a solicitation into the free shredder.';$('bonfire-previous').disabled=true;$('bonfire-next').disabled=true;}}
$('bonfire-form').onsubmit=e=>{e.preventDefault();page=0;void search();};$('bonfire-sort').onchange=render;$('bonfire-previous').onclick=()=>{page--;void search();};$('bonfire-next').onclick=()=>{page++;void search();};void search();
