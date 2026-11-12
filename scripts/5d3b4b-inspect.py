import json,sqlite3,sys,tempfile,shutil,hashlib
from pathlib import Path
project=Path(__file__).resolve().parent.parent;action=sys.argv[1];root=Path(sys.argv[2]).resolve();assert root.parent==(Path(tempfile.gettempdir())/'opencode').resolve() and root.name.startswith('5b7-5d3b2-4b-')
db=root/'fiscal/repository.sqlite3'
if action=='copy-legacy':
 assert root.is_dir() and not (root/'fiscal').exists()
 source=project/'docs/evidence/5d3b4b/legacy';(root/'fiscal').mkdir()
 for name in ['fiscal-initialization.json','fiscal-initialized.json','fiscal/repository.sqlite3']:shutil.copyfile(source/name,root/name)
elif action!='inspect':raise ValueError(action)
if not db.exists():print(json.dumps({'exists':False}));sys.exit(0)
c=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True);schema=c.execute('pragma user_version').fetchone()[0]
report={'exists':True,'schema':schema,'integrity':c.execute('pragma integrity_check').fetchone()[0],'meta':c.execute('SELECT repository_id,generation,head,max_utc FROM repository_meta').fetchone(),'legacyOperations':[{'id':i,'bodySha256':hashlib.sha256(b).hexdigest(),'receiptSha256':hashlib.sha256(r).hexdigest(),'receiptHex':r.hex()} for i,b,r in c.execute('SELECT id,body,receipt FROM operations ORDER BY seq')],'objects':[{'hash':h,'computed':hashlib.sha256(b).hexdigest()} for h,b in c.execute('SELECT sha256,bytes FROM containers ORDER BY sha256')],'legacyAdmissions':c.execute('SELECT id,state FROM admissions ORDER BY id').fetchall(),'maxima':c.execute('SELECT channel,stream,exercise,profile,epoch,revision,payload_sha256 FROM accepted_heads ORDER BY channel,stream,exercise,profile').fetchall(),'nonceUses':c.execute('SELECT count(*) FROM rollback_uses').fetchone()[0]}
if schema==2:report.update({'effectiveAdmissions':c.execute('SELECT id,installation,operation FROM effective_admissions ORDER BY id').fetchall(),'selectionEvents':c.execute('SELECT id,generation,kind,installation,admission FROM fiscal_selections ORDER BY generation').fetchall()})
c.close();print(json.dumps(report))
