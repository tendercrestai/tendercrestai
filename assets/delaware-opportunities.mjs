import {api,node}from './free-tools.mjs';
const $=id=>document.getElementById(id);
let page=0,data=null,run=0;
function sourceDate(value){const d=new Date(value||'');return Number.isNaN(d.getTime())?String(value||'Not supplied'):d.toLocaleDateString();}
function closeLine(item){return item.deadline?('Deadline: '+sourceDate(item.deadline)+' · verify the exact closing time on the source.'):'Deadline not stated.';}
function render(){
 const box=$('delaware-notices');box.replaceChildren();const rows=[...(data?.items||[])];
 rows.sort((a,b)=>$('delaware-sort').value==='deadline'?(a.deadline||'9999').localeCompare(b.deadline||'9999'):b.posted.localeCompare(a.posted));
 if(!rows.length)box.append(node('p','No Delaware open bids match this page and keyword. Try another keyword or page.'));
 for(const item of rows){const card=node('article');card.className='notice-card';card.append(node('p','Delaware · Open Bids'),node('h2',item.title),node('p','Agency code: '+item.agency),node('p','Reference: '+(item.reference||'Not supplied')),node('p','Opened: '+sourceDate(item.posted)),node('p',closeLine(item)),node('p','Estimated value: not published.'));const original=node('a','View original Delaware bid');original.href=item.url;original.target='_blank';original.rel='noopener noreferrer';const shred=node('a','Shred this');shred.className='button secondary';shred.href='/tools/shredder?provider=delaware&notice='+encodeURIComponent(item.id);const actions=node('div');actions.className='actions';actions.append(original,shred);card.append(actions);box.append(card);}
 $('delaware-previous').disabled=page===0;$('delaware-next').disabled=page>=9||data?.hasMore!==true;
 $('delaware-source-status').textContent=(data?.notice||'')+' Checked: '+(data?.checkedAt?new Date(data.checkedAt).toLocaleString():'not available')+(data?.cached?' · Cached response.':'')+(data?.total!==undefined?' Total open bids: '+data.total+'.':'');
}
async function search(){const current=++run;$('delaware-status').textContent='Loading Delaware open bids…';try{const d=await api({action:'search',keyword:$('delaware-keyword').value.trim(),page},'delaware-opportunities');if(current!==run)return;data=d;$('delaware-status').textContent=d.items.length+' Delaware open bids on page '+(page+1);render();}catch(error){if(current!==run)return;data=null;$('delaware-notices').replaceChildren();$('delaware-status').textContent=error.message;$('delaware-source-status').textContent='No live Delaware data is shown. Use the official source, search federal opportunities, or paste a solicitation into the free shredder.';$('delaware-previous').disabled=true;$('delaware-next').disabled=true;}}
$('delaware-form').onsubmit=e=>{e.preventDefault();page=0;void search();};$('delaware-sort').onchange=render;$('delaware-previous').onclick=()=>{page--;void search();};$('delaware-next').onclick=()=>{page++;void search();};void search();
