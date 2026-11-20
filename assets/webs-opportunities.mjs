import {api,node}from './free-tools.mjs';
const $=id=>document.getElementById(id);
let page=0,data=null,run=0;
function sourceDate(value){const d=new Date(value||'');return Number.isNaN(d.getTime())?String(value||'Not supplied'):d.toLocaleDateString();}
function closeLine(item){return item.deadline?('Close date: '+sourceDate(item.deadline)+' · Pacific time; the calendar states the date only, verify the exact closing time on the source.'):'Close date not stated.';}
function render(){
 const box=$('webs-notices');box.replaceChildren();const rows=[...(data?.items||[])];
 rows.sort((a,b)=>(a.deadline||'9999').localeCompare(b.deadline||'9999'));
 if(!rows.length)box.append(node('p','No Washington solicitation notices match this page and keyword. Try another keyword or page.'));
 for(const item of rows){const card=node('article');card.className='notice-card';card.append(node('p','Washington · WEBS'),node('h2',item.title),node('p',item.agency),node('p','Reference: '+(item.reference||'Not supplied')),node('p',closeLine(item)),node('p','Estimated value: not published.'));if(item.description)card.append(node('p',item.description));if(item.contact)card.append(node('p','Contact: '+item.contact));const original=node('a','View original WEBS notice');original.href=item.url;original.target='_blank';original.rel='noopener noreferrer';const shred=node('a','Shred this');shred.className='button secondary';shred.href='/tools/shredder?provider=webs&notice='+encodeURIComponent(item.id);const actions=node('div');actions.className='actions';actions.append(original,shred);card.append(actions);box.append(card);}
 $('webs-previous').disabled=page===0;$('webs-next').disabled=page>=9||data?.hasMore!==true;
 $('webs-source-status').textContent=(data?.notice||'')+' Checked: '+(data?.checkedAt?new Date(data.checkedAt).toLocaleString():'not available')+(data?.cached?' · Cached response.':'')+(data?.total!==undefined?' Total open notices: '+data.total+'.':'');
}
async function search(){const current=++run;$('webs-status').textContent='Loading Washington solicitation notices…';try{const d=await api({action:'search',keyword:$('webs-keyword').value.trim(),page},'webs-opportunities');if(current!==run)return;data=d;$('webs-status').textContent=d.items.length+' Washington solicitation notices on page '+(page+1);render();}catch(error){if(current!==run)return;data=null;$('webs-notices').replaceChildren();$('webs-status').textContent=error.message;$('webs-source-status').textContent='No live Washington data is shown. Use the official source, search federal opportunities, or paste a solicitation into the free shredder.';$('webs-previous').disabled=true;$('webs-next').disabled=true;}}
$('webs-form').onsubmit=e=>{e.preventDefault();page=0;void search();};$('webs-previous').onclick=()=>{page--;void search();};$('webs-next').onclick=()=>{page++;void search();};void search();
