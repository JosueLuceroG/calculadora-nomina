import sqlite3,json,hashlib,sys,os
from pathlib import Path
db=Path(sys.argv[1]).resolve();base=(Path(os.environ['TEMP'])/'opencode').resolve();assert db.is_relative_to(base) and db.parent.name.startswith('5b7-5c2-') and db.name=='payroll.sqlite3'
fixtures=json.loads(Path(sys.argv[2]).read_text(encoding='utf8'));c=sqlite3.connect(db)
for f in fixtures:
    raw=f['payload'];v=json.loads(raw)['value'];assert c.execute('SELECT count(*) FROM simulations WHERE execution_id=?',(v['executionId'],)).fetchone()[0]==1;c.execute('UPDATE simulations SET payload=?,payload_sha256=? WHERE execution_id=?',(raw,hashlib.sha256(raw.encode()).hexdigest(),v['executionId']))
c.commit();assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok';c.close();print(json.dumps({'legacyOriginalsRestoredByteExact':len(fixtures)}))
