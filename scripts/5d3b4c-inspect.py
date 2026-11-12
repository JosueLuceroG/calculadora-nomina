import json,sqlite3,sys,tempfile,hashlib
from pathlib import Path
r=Path(sys.argv[1]).resolve();assert r.parent==(Path(tempfile.gettempdir())/'opencode').resolve() and r.name.startswith('5b7-5d3b2-4c-')
result={'fiscalExists':False,'salaryRows':0,'salaryVersions':[]};db=r/'fiscal/repository.sqlite3'
if db.exists():
 c=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True);result.update({'fiscalExists':True,'fiscalSchema':c.execute('pragma user_version').fetchone()[0],'fiscalGeneration':c.execute('select generation from repository_meta').fetchone()[0],'fiscalOperations':c.execute('select count(*) from operations').fetchone()[0],'fiscalFileSha256':hashlib.sha256(db.read_bytes()).hexdigest(),'nonceUses':c.execute('select count(*) from rollback_uses').fetchone()[0]});c.close()
salary=r/'payroll.sqlite3'
if salary.exists():
 c=sqlite3.connect(salary.as_uri()+'?mode=ro',uri=True);result['salaryRows']=c.execute('select count(*) from simulations').fetchone()[0];result['salaryVersions']=[v for(v,)in c.execute('select snapshot_version from simulations order by execution_id')];result['salarySchema']=c.execute('pragma user_version').fetchone()[0];c.close()
print(json.dumps(result))
