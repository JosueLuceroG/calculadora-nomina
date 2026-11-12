import sys,json,sqlite3,hashlib,tempfile,uuid
from pathlib import Path
project=Path(__file__).resolve().parent.parent
action=sys.argv[1];root=Path(sys.argv[2]).resolve();base=(Path(tempfile.gettempdir())/'opencode').resolve()
assert root.parent==base and root.name.startswith('5b7-5d3b3-')
db=root/'payroll.sqlite3'
def sha(s):return hashlib.sha256(s.encode('utf8')).hexdigest()
def add(c,payload):
 s=json.loads(payload)['value'];form=s['capture']['form'];report=s['outcome']['report'];forward=report if form['mode']=='gross-to-net' else report['recommendedForwardResult'];p=s['outcome']['presentation'];f=s['fiscalPackage']
 conditioned=p['confirmation'] is not None or forward['retention']['kind']=='conditional-no-withholding-LISR-96' or (form['mode']=='net-to-gross' and report['coverage']['state']=='fiscally-incomplete')
 classification='limited' if form['mode']=='net-to-gross' and report['coverage']['state']=='limited' else 'conditioned' if conditioned else 'approximate' if form['mode']=='net-to-gross' and report['match']=='approximate' else 'exact' if form['mode']=='net-to-gross' else 'estimated'
 c.execute('INSERT OR IGNORE INTO fiscal_packages VALUES(?,?,?,?)',(f['sha256'],f['id'],f['version'],json.dumps(f,ensure_ascii=False)))
 c.execute('INSERT INTO simulations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',(s['executionId'],s['execution']['completedAt'],form['mode'],form['amount'],form['period'],form['effectiveDate'],classification,forward['gross']['amount'],forward['net']['amount'],f['sha256'],s['schemaVersion'],payload,sha(payload)))
if action in ['seed1','seed2','seed3']:
 assert not db.exists();root.mkdir(exist_ok=True);c=sqlite3.connect(db);v=int(action[-1]);c.executescript((project/'src-tauri/src/storage/migrations/001.sql').read_text(encoding='utf-8'));c.execute('INSERT INTO store_meta VALUES(1,?)',(str(uuid.uuid4()),));c.execute("UPDATE preferences SET theme='light',history_auto_save=0");c.commit()
 if v>=2:c.executescript((project/'src-tauri/src/storage/migrations/002.sql').read_text(encoding='utf-8'));c.execute('PRAGMA user_version=2')
 if v>=3:c.executescript((project/'src-tauri/src/storage/migrations/003.sql').read_text(encoding='utf-8'))
 for r in json.loads((project/'docs/evidence/5d2b/originals-v1.json').read_text(encoding='utf-8')):assert sha(r['payload'])==r['checksum'];add(c,r['payload'])
 if v>=3:
  for r in json.loads((project/'docs/evidence/5d2b/originals-v2.json').read_text(encoding='utf-8')):assert sha(r['payload'])==r['checksum'];add(c,r['payload'])
 c.commit();c.execute('PRAGMA journal_mode=WAL');c.close()
elif action=='seed-v3':
 c=sqlite3.connect(db);assert c.execute('PRAGMA user_version').fetchone()[0]==4
 for r in json.loads((project/'docs/evidence/5d3b3/fixtures-v3.json').read_text(encoding='utf-8')):
  assert r['fixtureNotice']=='Fixture documental de QA. No acredita una ejecución externa autorizada.';assert json.loads(r['payload'])['value']['documentKind']=='qa-document-fixture';add(c,r['payload'])
 c.commit();c.close()
elif action!='inspect':raise ValueError(action)
c=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True)
result={'schema':c.execute('pragma user_version').fetchone()[0],'declared':c.execute('select version from schema_version').fetchone()[0],'generation':c.execute('select generation from store_meta').fetchone()[0],'preferences':c.execute('select version,theme,history_auto_save from preferences').fetchone(),'records':[{'id':i,'checksum':h,'computed':sha(p),'version':v,'bytes':len(p.encode('utf8'))} for i,h,p,v in c.execute('select execution_id,payload_sha256,payload,snapshot_version from simulations order by execution_id')],'backupsExist':(root/'migration-backups').exists(),'fixtureSeeding':action=='seed-v3','fiscalRepositoryExists':(root/'fiscal').exists()};c.close();print(json.dumps(result))
