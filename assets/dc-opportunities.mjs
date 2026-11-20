import {api,node}from './free-tools.mjs';
const $=id=>document.getElementById(id);
let page=0,data=null,run=0;
function sourceDate(value){const d=new Date(value||'');return Number.isNaN(d.getTime())?String(value||'Not supplied'):d.toLocaleDateString();}
function closeLine(item){return item.deadline?('Close date: '+sourceDate(item.deadline)+' · verify the exact closing time on the source.'):'Close date not stated.';}
function render(){
 const box=$('dc-notices');box.replaceChildren();const rows=[...(data?.items||[])];
 rows.sort((a,b)=>$('dc-sort').value==='posted'?(b.posted||'').localeCompare(a.posted||''):(a.deadline||'9999').localeCompare(b.deadline||'9999'));
 if(!rows.length)box.append(node('p','No DC solicitations match this page and keyword. Try another keyword or page.'));
 for(const item of rows){const card=node('article');card.className='notice-card';card.append(node('p','DC · PASS'),node('h2',item.title),node('p',item.agency),node('p','Reference: '+(item.reference||'Not supplied')),node('p','Issued: '+sourceDate(item.posted)),node('p',closeLine(item)),node('p','Estimated value: not published.'));const original=node('a','View DC procurement portal');original.href=item.url;original.target='_blank';original.rel='noopener noreferrer';const shred=node('a','Shred this');shred.className='button secondary';shred.href='/tools/shredder?provider=dc&notice='+encodeURIComponent(item.id);const actions=node('div');actions.className='actions';actions.append(original,shred);card.append(actions);box.append(card);}
 $('dc-previous').disabled=page===0;$('dc-next').disabled=page>=9||data?.hasMore!==true;
 $('dc-source-status').textContent=(data?.notice||'')+' Checked: '+(data?.checkedAt?new Date(data.checkedAt).toLocaleString():'not available')+(data?.cached?' · Cached response.':'')+(data?.total!==undefined?' Total open solicitations: '+data.total+'.':'');
}
async function search(){const current=++run;$('dc-status').textContent='Loading DC solicitations…';try{const d=await api({action:'search',keyword:$('dc-keyword').value.trim(),page},'dc-opportunities');if(current!==run)return;data=d;$('dc-status').textContent=d.items.length+' DC solicitations on page '+(page+1);render();}catch(error){if(current!==run)return;data=null;$('dc-notices').replaceChildren();$('dc-status').textContent=error.message;$('dc-source-status').textContent='No live DC data is shown. Use the official source, search federal opportunities, or paste a solicitation into the free shredder.';$('dc-previous').disabled=true;$('dc-next').disabled=true;}}
$('dc-form').onsubmit=e=>{e.preventDefault();page=0;void search();};$('dc-sort').onchange=render;$('dc-previous').onclick=()=>{page--;void search();};$('dc-next').onclick=()=>{page++;void search();};void search();
