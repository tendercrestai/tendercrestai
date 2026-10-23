import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';
import {validateFile} from './rfp-document.mjs';
const $=id=>document.getElementById(id);
const node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
const PAGE_SIZE=25,INVITE_KEY='tendercrest.kb.pendingInvite';
let supabase,user,org,role,epoch=0,timer,source,working=false,overview,searched=false,pendingInvite;
const citations=new Set();
const pages={documents:0,answers:0,activity:0,team:0};
let filters={documents:{},answers:{},activity:{},team:{}},searchState=null;
function message(text,error=false){$('message').textContent=text;$('message').className=error?'error':'';}
function selected(){$('citation-count').textContent=citations.size+' citations selected';}
function resetAnswer(){$('answer-form').reset();$('answer-revision').value='0';citations.clear();selected();for(const input of $('hits').querySelectorAll('input'))input.checked=false;}
function clearSearch(){for(const id of ['hits','matches','search-documents','search-answers','search-activity','search-pages','search-status'])$(id).replaceChildren();$('approved-matches-title').hidden=true;searchState=null;}
function clearOrg(){
 clearTimeout(timer);epoch++;org=null;role=null;source=null;overview=null;searched=false;citations.clear();selected();$('org-workspace').hidden=true;
 for(const id of ['documents','answers','events','source-content','members','invitations','document-pages','answer-pages','activity-pages','team-pages'])$(id).replaceChildren();
 clearSearch();for(const key of Object.keys(pages))pages[key]=0;filters={documents:{},answers:{},activity:{},team:{}};
 for(const id of ['upload-form','search-form','document-filter-form','answer-filter-form','activity-filter-form','team-filter-form','invite-form'])$(id).reset();
 $('invite-link').value='';$('invite-result').hidden=true;resetAnswer();$('source-dialog').close();guide();
}
function signedOut(){clearOrg();user=null;$('workspace').hidden=true;$('login').hidden=false;$('organizations').replaceChildren();message('Sign in to access your private organization library.');}
async function session(){
 const {data,error}=await supabase.auth.getSession();if(error||!data.session||data.session.user.id!==user?.id){signedOut();throw Error('Sign in again.');}
 const verified=await supabase.auth.getUser();if(verified.error||verified.data.user?.id!==user.id){signedOut();throw Error('Session verification failed. Sign in again.');}return data.session;
}
async function api(payload){
 const current=epoch,s=await session();const response=await fetch('/.netlify/functions/knowledge',{method:'POST',headers:{Authorization:'Bearer '+s.access_token,'Content-Type':'application/json'},body:JSON.stringify(payload)});const result=await response.json();
 if(current!==epoch)throw Error('Account or organization changed.');if(response.status===401)signedOut();if(!response.ok)throw Error(result.error||'Knowledge request failed.');return result;
}
function button(text,fn,secondary=false){const b=node('button',text);b.type='button';if(secondary)b.className='secondary';b.onclick=()=>perform(fn);return b;}
async function perform(fn){if(working)return;working=true;$('workspace').setAttribute('aria-busy','true');$('organizations').disabled=true;try{await fn();}catch(e){message(e.message,true);}finally{working=false;$('organizations').disabled=false;$('workspace').setAttribute('aria-busy','false');}}
function requireOrg(){if(!org)throw Error('Choose or create an organization first.');return org;}
function canAudit(){return ['owner','reviewer'].includes(role);}
function updateRole(value){
 if(role&&role!==value){$('events').replaceChildren();$('search-activity').replaceChildren();$('members').replaceChildren();$('invitations').replaceChildren();$('invite-link').value='';$('invite-result').hidden=true;}
 role=value;$('role').textContent='Your role: '+role;$('upload-form').hidden=!['owner','editor'].includes(role);$('answer-form').hidden=role==='viewer';
 for(const id of ['audit-section','activity-link','activity-filter-label'])$(id).hidden=!canAudit();$('activity-scope').hidden=!canAudit();$('activity-scope').disabled=!canAudit();
 for(const id of ['team-section','team-link'])$(id).hidden=role!=='owner';if(!canAudit()&&$('search-scope').value==='activity')$('search-scope').value='all';
 $('role-help').textContent={owner:'You can upload, search, write and approve answers, inspect activity, and manage team access.',editor:'You can upload and edit answers. Ask an owner or reviewer to approve a saved draft.',reviewer:'You can search, edit and approve answers, and inspect activity. Ask an owner or editor to upload new evidence.',viewer:'You can read and search shared sources and answers. Ask the owner if you need editing access.'}[role]||'';
 guide();searchMode();
}
function guide(){
 const ready=overview?.ready||0,answers=overview?.answers||0,approved=overview?.approved||0;
 $('guide-summary').textContent=!org?'Create an organization above, or accept an invitation, to unlock the library.':ready===0?'Start with one source. Once it is ready, find a quotation and save a cited answer.':`${ready} ready source${ready===1?'':'s'} · ${answers} answer${answers===1?'':'s'} · ${approved} approved. Use the sections below to keep building your library.`;
 const steps=[['step-organization',!!org],['step-upload',ready>0],['step-search',searched],['step-approve',role==='editor'||role==='viewer'?answers>0:approved>0]];
 for(const [id,done] of steps)$(id).classList.toggle('complete',done);
 $('step-upload').querySelector('a').textContent=['reviewer','viewer'].includes(role)?'2. Review shared sources':'2. Upload and index a source';
 $('step-approve').querySelector('a').textContent=role==='viewer'?'4. Read shared answers':role==='editor'?'4. Save a draft for review':'4. Save and approve an answer';
}
async function organizations(selectedOrg){
 const data=await api({action:'organizations'});$('organizations').replaceChildren(node('option','Choose an organization'));$('organizations').firstChild.value='';
 for(const item of data.organizations){const option=node('option',item.kb_organizations.name);option.value=item.org_id;option.dataset.role=item.role;$('organizations').append(option);}
 const selection=selectedOrg&&data.organizations.some(o=>o.org_id===selectedOrg)?selectedOrg:data.organizations.length===1?data.organizations[0].org_id:'';
 if(selection){$('organizations').value=selection;await choose();}else guide();
}
async function choose(){const value=$('organizations').value,selectedRole=$('organizations').selectedOptions[0]?.dataset.role;clearOrg();if(!value)return;org=value;$('org-workspace').hidden=false;updateRole(selectedRole);await refresh();}
function citationLabel(c){return (c.file_name||'Source')+(c.page?' · physical page '+c.page:' · page unavailable')+(c.section?' · '+c.section:'');}
async function viewSource(id){const data=await api({action:'source',orgId:requireOrg(),documentId:id});source=data.document;$('source-content').replaceChildren();for(const chunk of data.chunks)$('source-content').append(node('p',citationLabel({...chunk,file_name:source.file_name})),node('blockquote',chunk.content));for(const warning of source.warnings||[])$('source-content').append(node('p','Warning: '+warning));$('source-dialog').showModal();}
function paginate(id,data,load,label='results'){
 const container=$(id);container.replaceChildren();const previous=button('Previous',()=>load(data.page-1),true),next=button('Next',()=>load(data.page+1),true);previous.disabled=data.page===0;next.disabled=!data.hasMore;
 container.append(previous,node('span',`Page ${data.page+1}${Number.isInteger(data.total)?` · ${data.total} ${label}`:''}`),next);
}
function empty(container,text){container.append(node(container.tagName==='UL'?'li':'p',text));container.lastChild.className='empty';}
function renderDocuments(items,container){
 container.replaceChildren();if(!items.length){empty(container,'No documents match. Adjust the filters or upload your first source.');return;}
 for(const d of items){const li=node('li',d.file_name+' — '+d.status+(d.error_code?' ('+d.error_code+')':''));for(const w of d.warnings||[])li.append(node('p','Review warning: '+w));
  if(d.status==='Ready')li.append(button('Verify source',()=>viewSource(d.id)));
  if(['Uploaded','Processing','Failed'].includes(d.status)&&['owner','editor'].includes(role))li.append(button('Process / retry',async()=>{if(!$('consent').checked)throw Error('Confirm source-processing consent first.');await process(d.id);await refresh();}));
  if(d.status!=='Archived'&&['owner','editor'].includes(role))li.append(button('Archive',async()=>{if(!confirm('Archive this source and revoke dependent approvals?'))return;await api({action:'archive',orgId:org,documentId:d.id});clearSearch();resetAnswer();await refresh();},true));
  container.append(li);
 }
}
function editAnswer(a){$('answer-id').value=a.id;$('answer-revision').value=String(a.revision);$('answer-question').value=a.question;$('answer-text').value=a.answer;citations.clear();for(const c of a.kb_answer_citations||[])citations.add(c.chunk_id);selected();for(const input of $('hits').querySelectorAll('input'))input.checked=citations.has(input.dataset.chunk);$('answer-section').scrollIntoView();$('answer-question').focus();}
function renderAnswers(items,container){
 container.replaceChildren();if(!items.length){empty(container,'No answers match. Search for source quotations to create a cited draft.');return;}
 for(const a of items){const approved=a.approved_revision===a.revision;const li=node('li');li.append(node('strong',a.question+' — '));const badge=node('span',(approved?'Approved':'Draft')+' revision '+a.revision);badge.className='badge'+(approved?'':' draft');li.append(badge,node('p',a.answer));
  if(a.sources_ready===false)li.append(node('p','A cited source is unavailable. This answer cannot be approved until its citations are updated.'));
  if(role!=='viewer')li.append(button('Edit draft',()=>editAnswer(a),true));
  if(canAudit()&&!approved&&a.sources_ready!==false)li.append(button('Approve saved revision',async()=>{await api({action:'approve',orgId:org,id:a.id,revision:a.revision});clearSearch();await refresh();}));
  container.append(li);
 }
}
function renderEvents(items,container){container.replaceChildren();if(!items.length){empty(container,'No activity matches these filters.');return;}for(const e of items)container.append(node('li',e.created_at+' — '+e.action+(e.revision!=null?' · revision '+e.revision:'')+(e.actor_id?' · actor '+e.actor_id:'')+(e.target_id?' · target '+e.target_id:'')));}
function renderHits(items){$('hits').replaceChildren();if(!items.length){empty($('hits'),'No ready source quotations match. Try another query or filter.');return;}for(const c of items){const box=node('div');box.className='hit';const label=node('label'),input=node('input');input.type='checkbox';input.dataset.chunk=c.id;input.checked=citations.has(c.id);input.disabled=role==='viewer';input.onchange=()=>{if(input.checked&&citations.size>=10){input.checked=false;message('Select no more than ten citations.',true);return;}input.checked?citations.add(c.id):citations.delete(c.id);selected();};label.append(input,node('span',citationLabel(c)));box.append(label,node('blockquote',c.content),button('Verify original',()=>viewSource(c.document_id),true));$('hits').append(box);}}
function renderMatches(items){$('matches').replaceChildren();$('approved-matches-title').hidden=false;for(const a of items){const item=node('article');item.append(node('h4',a.question),node('p',a.answer),node('p','Human-approved revision '+a.revision));for(const c of a.citations||[])item.append(node('p',citationLabel(c)),node('blockquote',c.quote));$('matches').append(item);}if(!items.length)empty($('matches'),'No approved answer matches these sources. Drafts are excluded here.');}
async function browse(kind,page=pages[kind]){
 const result=await api({action:'browse',orgId:requireOrg(),kind,page,pageSize:PAGE_SIZE,...filters[kind]});
 if(page>0&&!result.items.length){pages[kind]=Math.max(0,Math.ceil(result.total/PAGE_SIZE)-1);return browse(kind,pages[kind]);}
 pages[kind]=result.page;const target={documents:'documents',answers:'answers',activity:'events'}[kind];({documents:renderDocuments,answers:renderAnswers,activity:renderEvents}[kind])(result.items,$(target));
 paginate({documents:'document-pages',answers:'answer-pages',activity:'activity-pages'}[kind],result,p=>browse(kind,p),kind==='activity'?'events':kind);return result;
}
async function refresh(){
 clearTimeout(timer);overview=await api({action:'overview',orgId:requireOrg()});updateRole(overview.role);
 await Promise.all([browse('documents'),browse('answers')]);guide();
 if(overview.processing>0)timer=setTimeout(()=>perform(refresh),7000);
}
async function process(documentId){const result=await api({action:'process',orgId:requireOrg(),documentId,consent:true});message(result.done?'Source is already indexed.':result.dispatchPending?'Job saved; dispatch unconfirmed. Use Process / retry to resume the same job.':'Background job queued. Your source will appear as Ready when indexing finishes.');}
function searchMode(){
 const scope=$('search-scope').value,semantic=scope==='semantic';$('query').required=semantic;
 $('search-help').textContent=semantic?'AI search sends your question to the embedding provider. It searches only ready sources; linked approved answers are shown separately.':'Text search stays in your library and does not call the embedding provider. Leave the query empty to browse.';
 $('search-document-status').disabled=semantic||['answers','activity'].includes(scope);$('search-answer-status').disabled=semantic||['documents','excerpts','activity'].includes(scope);
 $('search-file-type').disabled=['answers','activity'].includes(scope);$('search-activity-action').disabled=semantic||!['all','activity'].includes(scope)||!canAudit();
}
function searchOptions(){return {scope:$('search-scope').value,query:$('query').value.trim(),documentStatus:$('search-document-status').value,fileType:$('search-file-type').value,answerStatus:$('search-answer-status').value,activityAction:$('search-activity-action').value.trim(),from:$('search-from').value,to:$('search-to').value};}
async function runSearch(page=0){
 if(!searchState)return;const args={...searchState,page,pageSize:PAGE_SIZE,orgId:requireOrg()};const semantic=args.scope==='semantic';
 const result=await api(semantic?{action:'semantic',orgId:org,query:args.query,fileType:args.fileType,from:args.from,to:args.to,page,pageSize:25}:{action:'find',...args});
 for(const id of ['search-documents','search-answers','search-activity','hits','matches'])$(id).replaceChildren();$('approved-matches-title').hidden=true;
 if(semantic){renderHits(result.chunks);renderMatches(result.answers);$('search-status').textContent=`${result.total} matching ready excerpts. AI search never returns drafts as approved answers.`;}
 else{
  const names={documents:'Document filenames',answers:'Answer text — drafts are labeled',activity:'Audit activity'};
  for(const kind of ['documents','answers','activity'])if(result.groups[kind]){const container=$('search-'+kind),group=result.groups[kind],list=node('ul');container.append(node('h3',names[kind]+` (${group.total})`),list);({documents:renderDocuments,answers:renderAnswers,activity:renderEvents}[kind])(group.items,list);}
  if(result.groups.excerpts)renderHits(result.groups.excerpts.items);
  $('search-status').textContent=Object.values(result.groups).some(g=>g.total>0)?'Matches are grouped by type. Each page shows up to 25 per group.':'No matches. Try fewer words, different filters, or AI search for meaning.';
 }
 searched=true;guide();paginate('search-pages',result,p=>runSearch(p),'excerpts');
}
async function loadTeam(page=pages.team){
 const result=await api({action:'team',orgId:requireOrg(),query:filters.team.query||'',page,pageSize:PAGE_SIZE});pages.team=result.page;$('members').replaceChildren();$('invitations').replaceChildren();
 if(!result.members.length)empty($('members'),'No matching members.');
 for(const m of result.members){const li=node('li',`${m.email} — ${m.role} — ${m.active?'Active':'Inactive'}`);
  if(m.role==='owner')li.append(node('p','Owner access is protected.'));
  else{
   const controls=node('div');controls.className='member-controls';const label=node('label','Role'),select=node('select');
   for(const value of ['viewer','editor','reviewer']){const option=node('option',value);option.value=value;select.append(option);}select.value=m.role;label.append(select);
   const activeLabel=node('label'),active=node('input');active.type='checkbox';active.checked=m.active;activeLabel.className='check';activeLabel.append(active,document.createTextNode('Active access'));
   controls.append(label,activeLabel,button('Save member',async()=>{if(m.active&&!active.checked&&!confirm('Deactivate '+m.email+'? Future organization access will stop.'))return;await api({action:'memberUpdate',orgId:org,userId:m.user_id,role:select.value,active:active.checked});await loadTeam();message('Membership updated. Changes apply to future requests immediately.');}));li.append(controls);
  }
  $('members').append(li);
 }
 if(!result.invitations.length)empty($('invitations'),'No matching invitations.');
 for(const i of result.invitations){const li=node('li',`${i.email} — ${i.role} — ${i.state} — expires ${new Date(i.expires_at).toLocaleString()}`);if(i.state==='Pending')li.append(button('Revoke invitation',async()=>{await api({action:'inviteRevoke',orgId:org,id:i.id});$('invite-link').value='';$('invite-result').hidden=true;await loadTeam();message('Invitation revoked. Its link can no longer be accepted.');},true));$('invitations').append(li);}
 paginate('team-pages',result,p=>loadTeam(p),'members');
}
function rememberInvitation(){
 const fragment=new URLSearchParams(location.hash.slice(1)),token=fragment.get('invite');
 if(token){history.replaceState(null,'',location.pathname+location.search);if(!/^[a-f0-9]{64}$/.test(token)){message('Invalid invitation link.',true);return;}pendingInvite=token;try{sessionStorage.setItem(INVITE_KEY,JSON.stringify({token,time:Date.now()}));}catch{/* Reopen the link after signing in if browser storage is unavailable. */}}
 if(!pendingInvite)try{const stored=JSON.parse(sessionStorage.getItem(INVITE_KEY)||'null');if(stored&&/^[a-f0-9]{64}$/.test(stored.token)&&Date.now()-stored.time<7*86400000)pendingInvite=stored.token;else sessionStorage.removeItem(INVITE_KEY);}catch{/* No invitation stored. */}
}
function forgetInvitation(){pendingInvite=null;try{sessionStorage.removeItem(INVITE_KEY);}catch{/* Storage is optional. */}$('invitation-section').hidden=true;}
async function previewInvitation(){
 if(!pendingInvite)return;
 $('invitation-section').hidden=false;$('accept-invitation').disabled=true;
 try{const invitation=await api({action:'invitePreview',token:pendingInvite});$('invitation-details').textContent=invitation.accepted?`You already belong to ${invitation.name}.`:`Join ${invitation.name} as ${invitation.role}. This invitation is bound to your verified email.`;$('accept-invitation').disabled=false;}
 catch(e){$('invitation-details').textContent=e.message;message('Could not open invitation. You can sign out to switch email accounts, or ask the owner for a new link.',true);}
}
$('organizations').onchange=()=>perform(choose);
$('org-form').onsubmit=e=>{e.preventDefault();perform(async()=>{const result=await api({action:'bootstrap',name:$('org-name').value});await organizations(result.id);message('Organization ready. Upload a source to begin.');});};
for(const a of $('getting-started').querySelectorAll('a'))a.onclick=e=>{if(!org&&a.getAttribute('href')!=='#organization-section'){e.preventDefault();message('Create or choose an organization first.');$('org-name').focus();}};
$('upload-form').onsubmit=e=>{e.preventDefault();perform(async()=>{
 const organization=requireOrg(),file=$('file').files[0];if(!file||!$('consent').checked)throw Error('Select a file and confirm processing consent.');const {extension,mime}=validateFile(file),current=epoch;
 const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());if(current!==epoch)throw Error('Organization changed.');const sha256=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 const {document}=await api({action:'register',orgId:organization,name:file.name,extension,mime,size:file.size,sha256});
 if(document.status==='Uploaded'){await session();const uploaded=await supabase.storage.from('kb-documents').upload(document.storage_path,file,{contentType:mime,upsert:false});if(current!==epoch)throw Error('Organization changed.');if(uploaded.error&&!['409','Duplicate'].includes(String(uploaded.error.statusCode))&&uploaded.error.error!=='Duplicate')throw Error('Upload failed. Retry the same file; metadata will be reused.');}
 pages.documents=0;filters.documents={};$('document-filter-form').reset();await process(document.id);await refresh();
});};
$('refresh').onclick=()=>perform(refresh);
$('document-filter-form').onsubmit=e=>{e.preventDefault();perform(async()=>{pages.documents=0;filters.documents={query:$('document-query').value,status:$('document-status').value,fileType:$('document-type').value};await browse('documents');});};
$('answer-filter-form').onsubmit=e=>{e.preventDefault();perform(async()=>{pages.answers=0;filters.answers={query:$('answer-query').value,status:$('answer-status').value};await browse('answers');});};
$('activity-filter-form').onsubmit=e=>{e.preventDefault();perform(async()=>{pages.activity=0;filters.activity={query:$('activity-query').value,from:$('activity-from').value,to:$('activity-to').value};await browse('activity');});};
$('search-scope').onchange=searchMode;
$('reset-search-filters').onclick=()=>{for(const id of ['search-document-status','search-file-type','search-answer-status','search-activity-action','search-from','search-to'])$(id).value='';};
$('search-form').onsubmit=e=>{e.preventDefault();perform(async()=>{searchState=searchOptions();await runSearch(0);});};
$('clear-citations').onclick=()=>{citations.clear();selected();for(const input of $('hits').querySelectorAll('input'))input.checked=false;};
$('new-answer').onclick=resetAnswer;
$('answer-form').onsubmit=e=>{e.preventDefault();perform(async()=>{await api({action:'saveAnswer',orgId:requireOrg(),id:$('answer-id').value||null,revision:Number($('answer-revision').value),question:$('answer-question').value,answer:$('answer-text').value,chunkIds:[...citations]});resetAnswer();clearSearch();pages.answers=0;filters.answers={};$('answer-filter-form').reset();await refresh();message('Draft saved. Any previous approval was cleared.');});};
$('team-link').onclick=()=>perform(()=>loadTeam());
$('team-filter-form').onsubmit=e=>{e.preventDefault();perform(async()=>{pages.team=0;filters.team={query:$('team-query').value};await loadTeam();});};
$('invite-form').onsubmit=e=>{e.preventDefault();perform(async()=>{const result=await api({action:'inviteCreate',orgId:requireOrg(),email:$('invite-email').value,role:$('invite-role').value});$('invite-link').value=new URL('/knowledge.html#invite='+result.token,location.origin).href;$('invite-expiry').textContent='Expires '+new Date(result.expires_at).toLocaleString()+'. Share privately with the invited person.';$('invite-result').hidden=false;await loadTeam();message('Invitation link created. No email has been sent.');});};
$('copy-invite').onclick=()=>perform(async()=>{if(!$('invite-link').value)return;try{await navigator.clipboard.writeText($('invite-link').value);message('Invitation link copied.');}catch{$('invite-link').focus();$('invite-link').select();message('Select and copy the invitation link from the field above.');}});
$('accept-invitation').onclick=()=>perform(async()=>{if(!pendingInvite)return;const result=await api({action:'inviteAccept',token:pendingInvite});forgetInvitation();await organizations(result.org_id);message('Invitation accepted. Your organization access is ready.');});
$('dismiss-invitation').onclick=forgetInvitation;
$('close-source').onclick=()=>$('source-dialog').close();
$('download').onclick=()=>perform(async()=>{if(!source)throw Error('Open a source first.');const current=epoch,doc=source;await session();const {data,error}=await supabase.storage.from('kb-documents').download(doc.storage_path);if(current!==epoch)throw Error('Organization changed.');if(error)throw Error('Private original is unavailable.');const url=URL.createObjectURL(data),a=node('a');a.href=url;a.download=doc.file_name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
rememberInvitation();
(async()=>{try{
 const response=await fetch('/.netlify/functions/knowledge-config');const config=await response.json();if(!response.ok||!config.enabled)throw Error('Knowledge base is not enabled for this deployment.');
 supabase=createClient(config.url,config.key);supabase.auth.onAuthStateChange((event,s)=>{if(event==='SIGNED_OUT'||(user&&s?.user.id!==user.id))signedOut();});
 const {data}=await supabase.auth.getSession();if(!data.session){signedOut();return;}const verified=await supabase.auth.getUser();if(verified.error)throw Error('Sign in again.');user=verified.data.user;$('workspace').hidden=false;$('login').hidden=true;
 await organizations();await previewInvitation();if(!pendingInvite)message('Choose a section below or follow the getting-started checklist.');
}catch(e){message(e.message,true);}})();
