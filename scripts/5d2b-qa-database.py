"""QA only: consistent copy of the recorded 5D.2a DB; never personal storage."""
import sys, os, json, sqlite3, hashlib
from pathlib import Path
root=Path(__file__).resolve().parent.parent
base=Path(os.environ['TEMP']).resolve()/'opencode'
target=Path(sys.argv[2]).resolve()
assert target.parent==base and target.name.startswith('5b7-5d2b-'), 'QA destination only'
db=target/'payroll.sqlite3'
if sys.argv[1]=='seed':
    assert not target.exists(), 'Never overwrite a QA database'
    source=json.loads((root/'docs/evidence/5d2a/native-verification.json').read_text())
    src=Path(source['storageRoot']).resolve();assert src.parent==base and src.name.startswith('5b7-5d2a-')
    target.mkdir();old=sqlite3.connect((src/'payroll.sqlite3').as_uri()+'?mode=ro',uri=True);c=sqlite3.connect(db);old.backup(c);old.close()
    assert c.execute('pragma user_version').fetchone()[0]==2
    originals=json.loads((root/'docs/evidence/5d2b/originals-v1.json').read_text(encoding='utf8'))
    for item in originals:
        payload=item['payload'];s=json.loads(payload)['value'];p=s['fiscalPackage'];r=s['outcome']['report'];presentation=s['outcome']['presentation'];form=s['capture']['form'];inverse=r['operation']=='net-to-gross';forward=r['recommendedForwardResult'] if inverse else r
        classification='limited' if inverse and r['coverage']['state']=='limited' else 'conditioned' if presentation['confirmation'] is not None or forward['retention']['kind']=='conditional-no-withholding-LISR-96' or inverse and r['coverage']['state']=='fiscally-incomplete' else 'approximate' if inverse and r['match']=='approximate' else 'exact' if inverse else 'estimated'
        c.execute('insert or ignore into fiscal_packages values(?,?,?,?)',(p['sha256'],p['id'],p['version'],json.dumps(p)))
        c.execute('insert or ignore into simulations values(?,?,?,?,?,?,?,?,?,?,?,?,?)',(s['executionId'],s['execution']['completedAt'],form['mode'],form['amount'],form['period'],form['effectiveDate'],classification,forward['gross']['amount'],forward['net']['amount'],p['sha256'],1,payload,hashlib.sha256(payload.encode()).hexdigest()))
    c.execute('insert or ignore into deleted_executions values(?)',('88888888-8888-4888-8888-888888888888',));c.commit();c.close()
c=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True)
rows=[{'id':r[0],'checksum':r[2],'version':r[3],'bytes':len(r[1].encode()),'checksumValid':hashlib.sha256(r[1].encode()).hexdigest()==r[2]} for r in c.execute('select execution_id,payload,payload_sha256,snapshot_version from simulations order by execution_id')]
report={'schema':c.execute('pragma user_version').fetchone()[0],'sqlitePythonVersion':sqlite3.sqlite_version,'journalMode':c.execute('pragma journal_mode').fetchone()[0],'integrity':c.execute('pragma integrity_check').fetchall(),'foreignKeys':c.execute('pragma foreign_key_check').fetchall(),'preferences':c.execute('select * from preferences').fetchall(),'generation':c.execute('select generation from store_meta').fetchone()[0],'tombstones':c.execute('select execution_id from deleted_executions order by execution_id').fetchall(),'records':rows,'temporaryBackupsExist':(target/'migration-backups').exists()}
assert all(r['checksumValid'] for r in rows);print(json.dumps(report,ensure_ascii=True))
