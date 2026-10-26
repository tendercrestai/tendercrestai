"""Run on the owner's computer after downloading encrypted backup, key and manifest.
Prints non-secret integrity proof; never uploads or writes decrypted customer data.
"""
import argparse,pathlib,json,hashlib,base64,gzip
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
p=argparse.ArgumentParser();p.add_argument('--backup',required=True);p.add_argument('--key',required=True);p.add_argument('--manifest',required=True);a=p.parse_args()
encrypted=pathlib.Path(a.backup).read_bytes();manifest=json.loads(pathlib.Path(a.manifest).read_text());digest=hashlib.sha256(encrypted).hexdigest()
if digest!=manifest['encryptedSHA256']:raise SystemExit('Backup hash mismatch. Do not rely on this copy.')
prefix=b'TENDERCREST-BACKUP-V1\n'
if not encrypted.startswith(prefix):raise SystemExit('Unsupported encrypted backup format.')
try:
 key=base64.b64decode(pathlib.Path(a.key).read_bytes().strip(),validate=True)
 if len(key)!=32:raise ValueError('key length')
 offset=len(prefix);payload=json.loads(gzip.decompress(AESGCM(key).decrypt(encrypted[offset:offset+12],encrypted[offset+12:],b'tendercrest-application-snapshot-v1')))
 if payload['project']!=manifest['project']:raise ValueError('project mismatch')
 if {t:len(rows) for t,rows in payload['snapshot']['public'].items()}!=manifest['publicTableCounts']:raise ValueError('table counts')
 for obj in payload['objects']:
  if hashlib.sha256(base64.b64decode(obj['bytes'])).hexdigest()!=obj['sha256']:raise ValueError('object integrity')
except Exception:raise SystemExit('Decryption/integrity verification failed. Check the matching key and manifest; do not share secret values.') from None
print(json.dumps({'downloadedCopyIntegrityPassed':True,'encryptedSHA256':digest,'project':manifest['project'],'createdAt':manifest['createdAt'],'publicTables':len(payload['snapshot']['public']),'objects':len(payload['objects']),'decryptedDataWritten':False,'nativeManagedServiceBackup':False,'notice':'Run this on your own computer after downloading. Successful execution in the cloud workspace alone does not establish off-workspace storage.'}))
