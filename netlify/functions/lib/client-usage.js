// Per-client (per-organization) proposal usage for the consultant workspace
// (Option B: clients own their orgs and invite the consultant in).
// Read-only: usage is derived from pw_jobs rows on projects the signed-in
// user can already see, grouped by organization. No migration, no billing
// change: credits stay per billing company, not per org. RLS on pw_projects
// and pw_jobs (queried with the caller's own token) is what keeps one
// consultant from seeing another client's jobs; jobs on projects the caller
// cannot see are dropped, never listed.
const kb=require('./knowledge-base');
const PROJECT_LIMIT=1000, JOB_LIMIT=1000, JOB_BATCH=100;
function aggregateClientUsage({organizations=[],projects=[],jobs=[]}){
 const orgs=Array.isArray(organizations)?organizations:[];
 const visible=new Map((Array.isArray(projects)?projects:[]).filter(p=>p&&typeof p.id==='string').map(p=>[p.id,p]));
 const byOrg=new Map();
 for(const o of orgs){
  if(!o||typeof o.org_id!=='string')continue;
  byOrg.set(o.org_id,{orgId:o.org_id,name:(o.kb_organizations&&typeof o.kb_organizations.name==='string'&&o.kb_organizations.name)||'Organization',role:typeof o.role==='string'?o.role:'',projects:0,jobs:{total:0,draft:0,export:0,completed:0,failed:0,pending:0},lastActivity:null});
 }
 for(const p of visible.values()){
  const row=byOrg.get(p.org_id);if(row)row.projects++;
 }
 for(const j of Array.isArray(jobs)?jobs:[]){
  if(!j||typeof j.project_id!=='string')continue;
  const p=visible.get(j.project_id);if(!p)continue;
  const row=byOrg.get(p.org_id);if(!row)continue;
  row.jobs.total++;
  if(j.kind==='draft')row.jobs.draft++;else if(j.kind==='export')row.jobs.export++;
  if(j.status==='Completed')row.jobs.completed++;else if(j.status==='Failed')row.jobs.failed++;else if(j.status==='Pending'||j.status==='Processing')row.jobs.pending++;
  const at=Date.parse(j.created_at||'');
  if(Number.isFinite(at)&&(!row.lastActivity||at>Date.parse(row.lastActivity)))row.lastActivity=new Date(at).toISOString();
 }
 const clients=[...byOrg.values()].sort((a,b)=>a.name.localeCompare(b.name));
 const totals=clients.reduce((t,c)=>({organizations:t.organizations+1,projects:t.projects+c.projects,jobs:t.jobs+c.jobs.total}),{organizations:0,projects:0,jobs:0});
 return {clients,totals};
}
async function clientUsage(config,user,token){
 const organizations=await kb.database(config,'kb_memberships?user_id=eq.'+user.id+'&active=eq.true&select=org_id,role,kb_organizations(id,name)',{token});
 const projects=await kb.database(config,'pw_projects?select=id,org_id,title&order=updated_at.desc&limit='+PROJECT_LIMIT,{token});
 const ids=[...new Set((Array.isArray(projects)?projects:[]).map(p=>p.id).filter(id=>typeof id==='string'))];
 let jobs=[];
 for(let i=0;i<ids.length;i+=JOB_BATCH){
  const chunk=ids.slice(i,i+JOB_BATCH);
  jobs.push(...await kb.database(config,'pw_jobs?project_id=in.('+chunk.join(',')+')&select=project_id,kind,status,created_at&order=created_at.desc&limit='+JOB_LIMIT,{token}));
 }
 return aggregateClientUsage({organizations,projects,jobs});
}
module.exports={aggregateClientUsage,clientUsage,PROJECT_LIMIT,JOB_LIMIT,JOB_BATCH};
