const {randomBytes,createHash}=require('node:crypto');
const kb=require('./knowledge-base');
const ACTIONS=new Set(['overview','browse','find','team','memberUpdate','inviteCreate','inviteRevoke','invitePreview','inviteAccept','semantic']);
const choose=(value,allowed,fallback='')=>{value=value===undefined?fallback:value;if(!allowed.includes(value))kb.fail(400,'Invalid filter.');return value;};
function page(value,max=40000,fallback=0){if(value===undefined)return fallback;if(!Number.isSafeInteger(value)||value<0||value>max)kb.fail(400,'Invalid page.');return value;}
function date(value){if(value===undefined||value==='')return null;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)kb.fail(400,'Invalid date.');return value;}
function options(p){const from=date(p.from),to=date(p.to);if(from&&to&&from>to)kb.fail(400,'Start date must be before end date.');return {p_query:p.query===undefined?'':typeof p.query==='string'&&p.query.length<=2000?p.query.trim():kb.fail(400,'Invalid search text.'),p_type:choose(p.fileType,['','pdf','docx','txt']),p_from:from,p_to:to,p_page:page(p.page),p_size:p.pageSize===undefined?25:page(p.pageSize,50,25)||kb.fail(400,'Invalid page size.')};}
function hash(token){if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))kb.fail(400,'Invalid invitation link.');return createHash('sha256').update(token).digest('hex');}
async function handle(p,{config,user,token,embed}){
 if(!ACTIONS.has(p.action))return null;
 if(p.action==='invitePreview'||p.action==='inviteAccept'){
  kb.exact(p,['action','token']);const digest=hash(p.token);await kb.rpc(config,'kb_discovery_admit',{p_org:null,p_user:user.id});
  try{return kb.reply(200,await kb.rpc(config,'kb_invite_access',{p_user:user.id,p_hash:digest,p_accept:p.action==='inviteAccept'}));}catch(e){if(e.status===404)kb.fail(404,'This invitation has expired, was revoked, or is unavailable. Ask the owner for a new link.');if(e.status===403)kb.fail(403,'Sign in with the verified email address named in this invitation.');throw e;}
 }
 const org=kb.uuid(p.orgId);const role=await kb.membership(config,token,user,org);const actor={p_org:org,p_user:user.id};
 const ownerActions=['team','memberUpdate','inviteCreate','inviteRevoke'];if(ownerActions.includes(p.action)&&role!=='owner')kb.fail(403,'Only the organization owner can manage membership.');
 if(p.action==='overview'){kb.exact(p,['action','orgId']);await kb.rpc(config,'kb_discovery_admit',actor);return kb.reply(200,await kb.rpc(config,'kb_overview',actor));}
 if(p.action==='browse'||p.action==='find'){
  const fields=['action','orgId','query','page','pageSize','fileType','from','to'];kb.exact(p,[...fields,...(p.action==='browse'?['kind','status']:['scope','documentStatus','answerStatus','activityAction'])]);
  const o=options(p);let args;
  if(p.action==='browse'){
   const kind=choose(p.kind,['documents','answers','activity','excerpts']);if(kind==='activity'&&!['owner','reviewer'].includes(role))kb.fail(403,'Audit access denied.');
   const status=choose(p.status,kind==='answers'?['','draft','approved']:kind==='activity'?['','organization.created','document.registered','document.processing','document.ready','document.failed','document.archived','answer.saved','answer.approved','knowledge.searched','invitation.created','invitation.accepted','invitation.revoked','member.deactivated','member.reactivated','member.role.editor','member.role.reviewer','member.role.viewer']:['','Uploaded','Processing','Ready','Failed','Archived']);
   args={...actor,...o,p_kind:kind,p_status:status};
  }else{
   const scope=choose(p.scope,['all','documents','answers','excerpts','activity'],'all');if(scope==='activity'&&!['owner','reviewer'].includes(role))kb.fail(403,'Audit access denied.');
   const action=p.activityAction===undefined?'':p.activityAction;if(typeof action!=='string'||action.length>100||!/^[a-z.]*$/.test(action))kb.fail(400,'Invalid activity filter.');
   args={...actor,...o,p_scope:scope,p_document_status:choose(p.documentStatus,['','Uploaded','Processing','Ready','Failed','Archived']),p_answer_status:choose(p.answerStatus,['','draft','approved']),p_action:action};
  }
  await kb.rpc(config,'kb_discovery_admit',actor);return kb.reply(200,await kb.rpc(config,p.action==='browse'?'kb_browse':'kb_find',args));
 }
 if(p.action==='semantic'){
  kb.exact(p,['action','orgId','query','fileType','from','to','page','pageSize']);const o=options(p);if(!o.p_query)kb.fail(400,'Enter a question.');if(o.p_size>25)kb.fail(400,'Semantic pages support at most 25 excerpts.');kb.embeddingSettings();await kb.rpc(config,'kb_search_admit',actor);const [vector]=await embed([o.p_query]);delete o.p_query;
  return kb.reply(200,await kb.rpc(config,'kb_search_filtered',{...actor,...o,p_embedding:vector}));
 }
 if(p.action==='team'){
  kb.exact(p,['action','orgId','query','page','pageSize']);const o=options(p);if(o.p_query.length>254)kb.fail(400,'Team search is too long.');await kb.rpc(config,'kb_discovery_admit',actor);return kb.reply(200,await kb.rpc(config,'kb_team',{...actor,p_query:o.p_query,p_page:o.p_page,p_size:o.p_size}));
 }
 if(p.action==='memberUpdate'){
  kb.exact(p,['action','orgId','userId','role','active']);if(typeof p.active!=='boolean')kb.fail(400,'Invalid membership state.');await kb.rpc(config,'kb_member_update',{...actor,p_target:kb.uuid(p.userId),p_role:choose(p.role,['reviewer','editor','viewer']),p_active:p.active});return kb.reply(200,{updated:true});
 }
 if(p.action==='inviteCreate'){
  kb.exact(p,['action','orgId','email','role']);const email=kb.text(p.email,254).toLowerCase();if(!/^[^\s@\u0000]+@[^\s@\u0000]+\.[^\s@\u0000]+$/.test(email))kb.fail(400,'Enter a valid email address.');const invitationRole=choose(p.role,['reviewer','editor','viewer']);const raw=randomBytes(32).toString('hex');
  const invite=await kb.rpc(config,'kb_invite_create',{...actor,p_email:email,p_role:invitationRole,p_hash:hash(raw)});return kb.reply(200,{...invite,token:raw});
 }
 kb.exact(p,['action','orgId','id']);await kb.rpc(config,'kb_invite_revoke',{...actor,p_id:kb.uuid(p.id)});return kb.reply(200,{revoked:true});
}
module.exports={handle,options,hash};
