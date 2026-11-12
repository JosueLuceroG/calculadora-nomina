import sys,json,sqlite3,hashlib
from pathlib import Path
root=Path(sys.argv[1]).resolve()
assert root.name.startswith('5b7-5d3b2-')
assert 'opencode' in root.parts
def connect(p):return sqlite3.connect(p.as_uri()+'?mode=ro',uri=True)
out={'fiscalExists':(root/'fiscal/repository.sqlite3').exists()}
if out['fiscalExists']:
 c=connect(root/'fiscal/repository.sqlite3')
 out['fiscal']={'version':c.execute('pragma user_version').fetchone()[0],'generation':c.execute('select generation from repository_meta').fetchone()[0],'installations':c.execute('select count(*) from installations').fetchone()[0],'selections':c.execute('select count(*) from selection_events').fetchone()[0],'nonceUses':c.execute('select count(*) from rollback_uses').fetchone()[0],'admissions':c.execute('select distinct state from admissions').fetchall(),'objects':[{'sha256':h,'computed':hashlib.sha256(b).hexdigest(),'bytes':len(b)} for h,b in c.execute('select sha256,bytes from containers')]};c.close()
if (root/'payroll.sqlite3').exists():
 c=connect(root/'payroll.sqlite3');out['salary']={'schema':c.execute('pragma user_version').fetchone()[0],'rows':c.execute('select execution_id,payload_sha256 from simulations order by execution_id').fetchall()};c.close()
print(json.dumps(out))
