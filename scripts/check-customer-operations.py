"""Read-only operator health report; secrets are never printed or written."""
import os,json,urllib.request,urllib.error,datetime,argparse
p=argparse.ArgumentParser();p.add_argument('--project',choices=['vfdwaqgfepvoujprtuww','wcrrywzleylmdsqqlise'],required=True);args=p.parse_args()
def api(path,data=None):
 r=urllib.request.Request('https://api.supabase.com/v1/projects/'+args.project+path,data=json.dumps(data).encode() if data is not None else None,headers={'Authorization':'Bearer '+os.environ['SUPABASE_MANAGEMENT_TOKEN'],'Content-Type':'application/json'})
 with urllib.request.urlopen(r,timeout=30) as response:return json.load(response)
auth=api('/config/auth');health=api('/database/query',{'query':'select * from public.cc_operations_private order by name','read_only':True})
print(json.dumps({'project':args.project,'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'auth':{'customSMTPConfigured':bool(auth.get('smtp_host')),'sendEmailHookEnabled':auth.get('hook_send_email_enabled') is True,'emailLimit':auth.get('rate_limit_email_sent'),'externalDeliveryVerifiedByThisCommand':False},'recordedChecks':health,'notice':'Missing or stale checks, backup/restore readiness and hosting credit capacity are not passed by inference. This command sends no email or payment.'},indent=2))
