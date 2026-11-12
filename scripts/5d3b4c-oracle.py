"""QA controls only. Exact Fraction arithmetic, no application imports.
Scope: ordinary fixed-period, no subsidy at the chosen monthly gross15000.
The inverse window is a local enumeration, not a global minimum certificate.
"""
from fractions import Fraction as F
from pathlib import Path
import json,hashlib
root=Path(__file__).resolve().parent.parent;out=root/'docs/evidence/5d3b4c/oracle.json';assert not out.exists(),'Never overwrite the independent control'
def rounded(x,places=2):
 factor=10**places;n=x*factor;return F((2*n.numerator+n.denominator)//(2*n.denominator),factor)
def money(x):return f'{x.numerator//x.denominator}.{(x*100).numerator//(x*100).denominator%100:02d}'
def evaluate(p,gross):
 r=p['signed']['registry'];date='2026-02-01';pick=lambda k:next(s['data'] for s in r[k] if s['effectiveFrom']<=date and (s['effectiveThrough'] is None or s['effectiveThrough']>=date))
 days=F(pick('contractualDivisors')['monthly']);uma=pick('uma');imss=pick('imssConstants');minimum=F(pick('minimumWages')['general']['daily']);daily=gross/days;factor=1+(F(15)+F(12)*F(25)/100)/365
 sbc=rounded(max(minimum,min(daily*factor,F(uma['daily'])*F(imss['sbcCeilingUmaDailyMultiple']))));threshold=F(uma['daily'])*F(imss['excessThresholdUmaDailyMultiple'])
 branches={name:rounded((sbc if imss['baseReferences'][name]=='sbc' else max(F(0),sbc-threshold))*F(rate)*days) for name,rate in imss['workerRates'].items()};worker=sum(branches.values(),F(0))
 tariff=next(s['data'] for s in r['isrTariffs'] if s['data']['periodicity']=='monthly' and s['effectiveFrom']<=date and (s['effectiveThrough'] is None or s['effectiveThrough']>=date));row=next(row for row in tariff['rows'] if F(row['lower'])<=gross and (row['upper'] is None or gross<=F(row['upper'])));isr=rounded(F(row['fixedFee'])+(gross-F(row['lower']))*F(row['ratePercent'])/100)
 assert gross>F(pick('subsidy')['monthlyIncomeLimit']) and daily>minimum
 return {'gross':money(gross),'net':money(gross-isr-worker),'isr':money(isr),'imss':money(worker),'sbc':money(sbc),'branches':{k:money(v) for k,v in branches.items()}}
cases=[]
for name in ['package1','package2']:
 b=(root/f'docs/evidence/5d3b2/fixtures/{name}.nomina-fiscal').read_bytes();p=json.loads(b);direct=evaluate(p,F(15000));target=F(direct['net']);candidates=[money(F(c,100)) for c in range(1499950,1500051) if F(evaluate(p,F(c,100))['net'])==target]
 cases.append({'name':name,'envelopeSha256':hashlib.sha256(b).hexdigest(),'capture':{'amount':'15000.00','period':'monthly','effectiveDate':'2026-02-01','includeImss':True,'bonusDays':'15','vacationDays':'12','vacationPremium':'25'},'direct':direct,'inverse':{'target':direct['net'],'window':{'from':'14999.50','through':'15000.50'},'exactCandidatesInWindow':candidates,'globalMinimumClaim':False}})
report={'method':'Python Fraction, explicitly scoped ordinary fixed-period controls; no production code imports','cases':cases,'expectedDifference':money(F(cases[0]['direct']['net'])-F(cases[1]['direct']['net'])),'sameFormulaBothPackages':True,'syntheticNotOfficial':True};out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8');print(json.dumps(report,ensure_ascii=False,indent=2))
