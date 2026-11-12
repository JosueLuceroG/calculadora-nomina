import json,sqlite3,shutil,hashlib,tempfile
from pathlib import Path
root=Path(__file__).resolve().parent.parent
evidence=json.loads((root/'docs/evidence/5d3b2/windows-qa.json').read_text(encoding='utf8'))
assert not evidence['failures']
source=Path(evidence['qaRoot']).resolve();assert source.parent==(Path(tempfile.gettempdir())/'opencode').resolve() and source.name.startswith('5b7-5d3b2-')
target=root/'docs/evidence/5d3b4b/legacy';assert not target.exists();db=source/'fiscal/repository.sqlite3'
c=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True);assert c.execute('PRAGMA user_version').fetchone()[0]==1;assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
assert c.execute('SELECT count(*) FROM selection_events').fetchone()[0]==0
assert c.execute('SELECT count(*) FROM installations').fetchone()[0]==2
for forbidden in ['simulations','workers','captures','results','preferences']:assert not c.execute('SELECT 1 FROM sqlite_master WHERE name=?',(forbidden,)).fetchone()
ops=[{'id':i,'seq':s,'bodySha256':hashlib.sha256(b).hexdigest(),'receiptSha256':hashlib.sha256(r).hexdigest(),'receiptHex':r.hex()} for i,s,b,r in c.execute('SELECT id,seq,body,receipt FROM operations ORDER BY seq')]
objects=[{'table':t,'hash':h,'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)} for t in ['containers','signed_payloads','content_objects','trust_documents'] for h,b in c.execute(f'SELECT sha256,bytes FROM {t} ORDER BY sha256')]
c.close();target.mkdir();(target/'fiscal').mkdir()
for name in ['fiscal-initialization.json','fiscal-initialized.json']:shutil.copyfile(source/name,target/name)
shutil.copyfile(db,target/'fiscal/repository.sqlite3');assert (target/'fiscal/repository.sqlite3').read_bytes()==db.read_bytes()
report={'kind':'Public QA fiscal-only database produced by approved 5D.3b.2 native Windows flow, not salary data','sourceReport':'docs/evidence/5d3b2/windows-qa.json','sourceBinarySha256':evidence['binarySha256'],'databaseSha256':hashlib.sha256(db.read_bytes()).hexdigest(),'schema':1,'operations':ops,'objects':objects,'installations':2,'selections':0}
(target/'originals.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8');print(json.dumps({'schema':1,'operations':len(ops),'objects':len(objects),'databaseSha256':report['databaseSha256']}))
