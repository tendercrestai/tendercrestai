"""Decrypt in memory; verify private objects and restore public table data in a disposable networkless PostgreSQL container.
This is an application-data drill, not a full managed-Supabase disaster recovery certification.
"""
import argparse,pathlib,json,base64,gzip,hashlib,subprocess,os,uuid,time,re
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
p=argparse.ArgumentParser();p.add_argument('directory');args=p.parse_args();root=pathlib.Path(args.directory);manifest=json.loads((root/'manifest.json').read_text());encrypted=(root/'application-backup.enc').read_bytes();assert hashlib.sha256(encrypted).hexdigest()==manifest['encryptedSHA256'];key=base64.b64decode((root/'recovery-key.txt').read_bytes(),validate=False);magic=b'TENDERCREST-BACKUP-V1\n';assert encrypted.startswith(magic);nonce=encrypted[len(magic):len(magic)+12];data=json.loads(gzip.decompress(AESGCM(key).decrypt(nonce,encrypted[len(magic)+12:],b'tendercrest-application-snapshot-v1')))
for obj in data['objects']:assert hashlib.sha256(base64.b64decode(obj['bytes'])).hexdigest()==obj['sha256']
env={k:v for k,v in os.environ.items() if k not in ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']};docker=['docker','--host=unix:///var/run/docker.sock'];container='tc-data-restore-'+uuid.uuid4().hex[:12]
def call(args,sql=None):
 r=subprocess.run(docker+args,input=sql,text=True,capture_output=True,env=env)
 if r.returncode:
  error=next((line for line in r.stderr.splitlines() if line.startswith('ERROR:')),'Step failed; private SQL and record values were not logged')
  raise RuntimeError(error[:180])
 return r.stdout
q=lambda v:'"'+v.replace('"','""')+'"'
def sql(statement):return call(['exec','-i',container,'psql','-X','-q','-U','postgres','-v','ON_ERROR_STOP=1','-t','-A'],statement)
try:
 call(['run','-d','--name',container,'--network','none','-e','POSTGRES_HOST_AUTH_METHOD=trust','pgvector/pgvector:0.8.1-pg17'])
 for _ in range(30):
  if subprocess.run(docker+['exec',container,'pg_isready','-U','postgres'],capture_output=True,env=env).returncode==0:break
  time.sleep(1)
 sql('create schema if not exists extensions;create extension if not exists vector with schema extensions;create schema auth;create table auth.users(id uuid primary key,email text,created_at timestamptz,email_confirmed_at timestamptz,raw_user_meta_data jsonb);')
 columns=data['schema']['columns'];tables=list(data['snapshot']['public'])
 for table in tables:
  definitions=[q(c['name'])+' '+c['type'] for c in columns if c['table_name']==table]
  sql('create table public.'+q(table)+'('+','.join(definitions)+');')
 def insert(schema,table,rows,names):
  if not rows:return
  tag='$backup_'+uuid.uuid4().hex+'$';body=json.dumps(rows,separators=(',',':'));assert tag not in body
  sql('insert into '+q(schema)+'.'+q(table)+'('+','.join(map(q,names))+') select '+','.join(map(q,names))+' from jsonb_populate_recordset(null::'+q(schema)+'.'+q(table)+','+tag+body+tag+'::jsonb);')
 insert('auth','users',data['snapshot']['authProfiles'],['id','email','created_at','email_confirmed_at','raw_user_meta_data'])
 for table in tables:insert('public',table,data['snapshot']['public'][table],[c['name'] for c in columns if c['table_name']==table])
 # Revalidate keys and relationships after data restore; apply foreign keys last.
 constraints=sorted(data['schema']['constraints'],key=lambda c:c['kind']=='f')
 for c in constraints:
  if c['table_name'] not in tables:continue
  sql('alter table public.'+q(c['table_name'])+' add constraint '+q(c['name'])+' '+c['definition']+';')
 counts={table:int(sql('select count(*) from public.'+q(table)+';').strip()) for table in tables};assert counts==manifest['publicTableCounts']
 manifest.update(restoreDrillPassed=True,restoreDrillScope='Public table data, keys/relationships, private-object hash integrity in disposable PostgreSQL. Managed Auth credentials, policies/functions execution, provider settings and off-workspace recovery not certified.',restoredTableCounts=counts,verifiedObjectHashes=len(data['objects']));(root/'manifest.json').write_text(json.dumps(manifest,indent=2));os.chmod(root/'manifest.json',0o600)
 print(json.dumps({'applicationDataRestorePassed':True,'tables':len(counts),'objectsVerified':len(data['objects']),'nativeFullDatabaseRestore':False,'offWorkspaceCopyConfirmed':False}))
finally:subprocess.run(docker+['rm','-f',container],capture_output=True,env=env)
