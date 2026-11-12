"""Solo manipula una base QA bajo la raíz temporal autorizada, nunca la personal."""
import sys,os,sqlite3,json,hashlib
from pathlib import Path
p=Path(sys.argv[1]).resolve();base=(Path(os.environ['TEMP'])/'opencode').resolve()
assert p.is_relative_to(base) and p.parent.name.startswith('5b7-integral-') and p.name=='payroll.sqlite3'
action=sys.argv[2];c=sqlite3.connect(p,timeout=10)
if action=='fail':c.execute("CREATE TRIGGER integral_qa_failure BEFORE INSERT ON simulations BEGIN SELECT RAISE(ABORT,'controlled QA write failure'); END")
elif action=='repair':c.execute('DROP TRIGGER integral_qa_failure')
elif action=='damage':
    row=c.execute('SELECT payload FROM simulations WHERE execution_id=?',(sys.argv[3],)).fetchone();v=json.loads(row[0]);v['value']['outcome']['presentation']['warnings']=[];payload=json.dumps(v,ensure_ascii=False,separators=(',',':'),sort_keys=True);c.execute('UPDATE simulations SET payload=?,payload_sha256=? WHERE execution_id=?',(payload,hashlib.sha256(payload.encode()).hexdigest(),sys.argv[3]))
elif action=='restore':
    backup=Path(sys.argv[4]).resolve();assert backup.parent==p.parent;payload=backup.read_text(encoding='utf8');c.execute('UPDATE simulations SET payload=?,payload_sha256=? WHERE execution_id=?',(payload,hashlib.sha256(payload.encode()).hexdigest(),sys.argv[3]))
elif action=='integrity':
    rows=c.execute('SELECT payload,payload_sha256 FROM simulations').fetchall();assert all(hashlib.sha256(p.encode()).hexdigest()==h for p,h in rows);result=c.execute('PRAGMA integrity_check').fetchone()[0];assert result=='ok';print(json.dumps({'sqliteIntegrity':result,'records':len(rows),'allPayloadChecksumsMatch':True}))
else:raise ValueError(action)
c.commit();c.close()
