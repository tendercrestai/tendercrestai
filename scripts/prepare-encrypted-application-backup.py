"""Consistent application snapshot + private objects, encrypted before filesystem write.
Not a native PostgreSQL/PITR backup: managed Auth credentials/provider settings are excluded.
"""
import argparse,os,json,urllib.request,urllib.parse,pathlib,datetime,secrets,base64,gzip,hashlib
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
p=argparse.ArgumentParser();p.add_argument('--project',choices=['vfdwaqgfepvoujprtuww','wcrrywzleylmdsqqlise'],required=True);p.add_argument('--output',required=True);args=p.parse_args();out=pathlib.Path(args.output);out.mkdir(mode=0o700)
def request(url,data=None,headers=None):
 r=urllib.request.Request(url,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json',**(headers or {})})
 with urllib.request.urlopen(r,timeout=60) as response:return response.read()
def query(sql):return json.loads(request('https://api.supabase.com/v1/projects/'+args.project+'/database/query',{'query':sql,'read_only':True},{'Authorization':'Bearer '+os.environ['SUPABASE_MANAGEMENT_TOKEN']}))
def ident(v):return '"'+v.replace('"','""')+'"'
def literal(v):return "'"+v.replace("'","''")+"'"
tables=query("select c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.relname")
columns=query("select c.relname as table_name,a.attname as name,pg_catalog.format_type(a.atttypid,a.atttypmod) as type,a.attgenerated<>'' as generated from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped order by c.relname,a.attnum")
constraints=query("select c.relname as table_name,con.conname as name,con.contype as kind,pg_get_constraintdef(con.oid) as definition from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by con.contype desc,c.relname,con.conname")
functions=query("select p.proname as name,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' order by p.proname")
policies=query("select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname='public' order by tablename,policyname")
parts=[literal(t['name'])+",coalesce((select jsonb_agg(to_jsonb(t)) from public."+ident(t['name'])+" t),'[]'::jsonb)" for t in tables]
sql="select jsonb_build_object('public',jsonb_build_object("+','.join(parts)+"),'authProfiles',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'email',email,'created_at',created_at,'email_confirmed_at',email_confirmed_at,'raw_user_meta_data',raw_user_meta_data)),'[]'::jsonb) from auth.users),'storageObjects',(select coalesce(jsonb_agg(to_jsonb(o)),'[]'::jsonb) from storage.objects o where bucket_id in ('rfp-documents','kb-documents','proposal-artifacts')),'buckets',(select coalesce(jsonb_agg(to_jsonb(b)),'[]'::jsonb) from storage.buckets b where id in ('rfp-documents','kb-documents','proposal-artifacts'))) as snapshot"
snapshot=query(sql)[0]['snapshot']
# Retrieve only this project's configured server key, without printing/persisting it.
site='7eda7e3f-b48d-48b6-8fea-3af646ea6851' if args.project=='vfdwaqgfepvoujprtuww' else '6e9deecc-bd7c-45c1-be22-ff1dd016e1f5'
h={'Authorization':'Bearer '+os.environ['NETLIFY_AUTH_TOKEN']};siteinfo=json.loads(request('https://api.netlify.com/api/v1/sites/'+site,headers=h));env=json.loads(request('https://api.netlify.com/api/v1/accounts/'+siteinfo['account_id']+'/env?site_id='+site,headers=h));config={}
for item in env:
 values=[x for x in item.get('values',[]) if x.get('context')=='production'] or [x for x in item.get('values',[]) if x.get('context')=='all']
 if values:config[item['key']]=values[-1].get('value','')
assert config['SUPABASE_URL']=='https://'+args.project+'.supabase.co'
objects=[];total=0
for item in snapshot['storageObjects']:
 path=urllib.parse.quote(item['name'],safe='/');bucket=item['bucket_id'];raw=request(config['SUPABASE_URL']+'/storage/v1/object/authenticated/'+bucket+'/'+path,headers={'apikey':config['SUPABASE_SERVICE_ROLE_KEY'],'Authorization':'Bearer '+config['SUPABASE_SERVICE_ROLE_KEY']});total+=len(raw)
 if total>128*1024*1024:raise RuntimeError('Snapshot object limit exceeded; use a reviewed native backup process')
 objects.append({'bucket':bucket,'path':item['name'],'sha256':hashlib.sha256(raw).hexdigest(),'bytes':base64.b64encode(raw).decode()})
package={'format':'tendercrest-application-snapshot-v1','project':args.project,'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'Application data, schema reference, Auth profiles without credentials, and three private buckets. Not a full managed-Supabase/PITR backup.','snapshot':snapshot,'schema':{'columns':columns,'constraints':constraints,'functions':functions,'policies':policies},'objects':objects}
plaintext=gzip.compress(json.dumps(package,separators=(',',':')).encode());key=AESGCM.generate_key(bit_length=256);nonce=secrets.token_bytes(12);encrypted=b'TENDERCREST-BACKUP-V1\n'+nonce+AESGCM(key).encrypt(nonce,plaintext,b'tendercrest-application-snapshot-v1')
for name,data in [('application-backup.enc',encrypted),('recovery-key.txt',base64.b64encode(key)+b'\n')]:
 fd=os.open(out/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'wb') as f:f.write(data)
manifest={'format':package['format'],'project':args.project,'createdAt':package['createdAt'],'encryptedSHA256':hashlib.sha256(encrypted).hexdigest(),'publicTableCounts':{k:len(v) for k,v in snapshot['public'].items()},'authProfiles':len(snapshot['authProfiles']),'objects':len(objects),'objectBytes':total,'nativeDatabaseBackup':False,'offWorkspaceCopyConfirmed':False,'restoreDrillPassed':False}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2));os.chmod(out/'manifest.json',0o600)
(out/'README.txt').write_text('PRIVATE HANDOFF: Download application-backup.enc and recovery-key.txt separately. Store the recovery key separately in a password manager. The key is never printed in chat. This snapshot excludes Auth passwords, refresh tokens, platform/provider secrets and full managed-service configuration. It is not a PITR/full-database backup. A local data restore drill and durable off-workspace handoff must be verified separately.\n')
print(json.dumps({'encryptedBackupPrepared':True,'publicTables':len(tables),'privateObjects':len(objects),'objectBytes':total,'nativeBackup':False,'directory':str(out)}))
