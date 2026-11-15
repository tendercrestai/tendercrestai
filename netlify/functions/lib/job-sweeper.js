// Stranded-job sweeper (F5): re-dispatches background jobs that a failed
// 5-second self-call left Pending, or Processing with an expired lease.
// Runs inside the existing 15-minute customer-operations scheduled function;
// it adds no new schedule and reuses the existing dispatch paths
// (S.dispatch, kb worker self-call, F.dispatch) without changing them.
// Only jobs with attempts < 3 are re-dispatched; Failed jobs are left alone
// for the existing user-initiated retry paths. Every dispatch failure is
// logged with job id + kind only, and a sweeper failure never fails the
// calling maintenance run.
const kb=require('./knowledge-base');
const F=require('./free-tools');
const S=require('./proposal-service');
const LIMIT=10;
function strandedQuery(table,now){
 const lease=encodeURIComponent(now.toISOString());
 const select=table==='pw_jobs'?'id,kind,status':'id,status';
 const attempts=table==='ft_jobs'?'':'&attempts=lt.3';
 const expiry=table==='ft_jobs'?'&expires_at=gt.'+lease:'';
 return table+'?select='+select+attempts+expiry+'&or=(status.eq.Pending,and(status.eq.Processing,lease_until.lt.'+lease+'))&order=created_at.asc&limit='+LIMIT;
}
async function sweepStrandedJobs(config,{db,fetcher=fetch,now=new Date(),dispatchers}={}){
 const read=async path=>db?await db(path):await kb.database(config,path,{service:true});
 const summary={pw:{found:0,redispatched:0,failed:0},kb:{found:0,redispatched:0,failed:0},ft:{found:0,redispatched:0,failed:0}};
 const dispatch=dispatchers||{
  // S.dispatch returns dispatchPending (true = still pending/failed).
  proposal:async job=>!await S.dispatch(job),
  knowledge:async id=>{const settings=kb.workerSettings();const r=await fetcher(settings.url,{method:'POST',headers:{'Content-Type':'application/json','x-kb-worker-secret':settings.secret},body:JSON.stringify({jobId:id}),signal:AbortSignal.timeout(5000)});return r.ok;},
  free:async id=>F.dispatch(id),
 };
 for(const kind of ['pw','kb','ft']){
  let rows=[];
  try{rows=await read(strandedQuery(kind==='pw'?'pw_jobs':kind==='kb'?'kb_jobs':'ft_jobs',now))||[];}
  catch{console.error(JSON.stringify({event:'sweep_query_failed',kind}));continue;}
  summary[kind].found=rows.length;
  for(const row of rows){
   try{
    const accepted=kind==='pw'?await dispatch.proposal(row):kind==='kb'?await dispatch.knowledge(row.id):await dispatch.free(row.id);
    if(accepted)summary[kind].redispatched++;
    else{summary[kind].failed++;console.error(JSON.stringify({event:'sweep_dispatch_failed',kind,jobId:row.id}));}
   }catch{
    summary[kind].failed++;console.error(JSON.stringify({event:'sweep_dispatch_failed',kind,jobId:row.id}));
   }
  }
 }
 return summary;
}
module.exports={sweepStrandedJobs,strandedQuery};
