"""Fraction independiente: tablas DOF/SAT del control 4B.1, sin importar producto."""
from fractions import Fraction as F
from pathlib import Path
import json
root=Path(__file__).resolve().parent.parent
tariffs=json.loads((root/'docs/evidence/5c2/legacy/operational-4b1.expected.json').read_text(encoding='utf8'))['tariffs']
D=F('315.04');M=F('9582.47');days={'weekly':7,'fortnightly':15,'monthly':30}
def cents(x):return (x.numerator*100*2//x.denominator+1)//2
def text(x):
    c=cents(x);return f'{c//100}.{c%100:02d}'
def rounded(x):return F(cents(x),100)
def expected(g,p,date,include,basis,condition):
    n=days[p];daily=g/n;uma=F('113.14' if date.endswith('01-31') else '117.31');uma_month=F('3439.46' if date.endswith('01-31') else '3566.22');rate=F('0.1559' if date.endswith('01-31') else '0.1502')
    row=next(r for r in tariffs[p] if F(r['lower'])<=g and (r['upper'] is None or g<=F(r['upper'])))
    tax=rounded(F(row['fixedFee'])+(g-F(row['lower']))*F(row['ratePercent'])/100)
    eligible=g*(F(30,n) if p=='weekly' else 2 if p=='fortnightly' else 1)<=F('11492.66')
    subsidy=rounded((uma_month*rate if p=='monthly' else uma_month*rate*n/F('30.4')) if eligible else F(0));potential=min(tax,subsidy);excess=subsidy-potential
    sbc=rounded(min(max(daily*F(383,365),D),25*uma));calculated=sum(rounded(base*r*n) for base,r in [(sbc,F('0.00375')),(sbc,F('0.0025')),(sbc,F('0.00625')),(sbc,F('0.01125')),(max(F(0),sbc-3*uma),F('0.004'))])
    deducted=F(0) if daily==D or not include else calculated;absorbed=calculated if daily==D else F(0);excluded=calculated if daily>D and not include else F(0)
    if basis=='actual-calendar' or condition=='outside-profile' or daily<D:state='outside-profile'
    elif condition=='minimum-only-assumed':state='outside-profile' if basis=='fixed-period' and p=='monthly' else 'insufficient-context' if basis!='agreed-daily-reference' else 'conditional' if daily==D else 'outside-profile'
    elif basis=='fixed-period' and p=='monthly' and D*30<=g<=M:state='insufficient-context'
    elif daily==D:state='insufficient-context'
    else:state='not-applicable'
    complete=state in ['conditional','not-applicable'];withheld=F(0) if state=='conditional' else tax-potential;applied=F(0) if state=='conditional' else potential;displaced=potential if state=='conditional' else F(0)
    worker_known=basis!='actual-calendar' and daily>=D
    return {'state':state,'status':'estimated' if complete else 'not-supported' if state=='outside-profile' else 'not-determinable','gross':text(g),'isrTariff':text(tax),'subsidyDetermined':text(subsidy),'subsidyPotential':text(potential),'subsidyApplied':text(applied) if complete else None,'subsidyDisplaced':text(displaced) if complete else None,'subsidyExcess':text(excess),'isrWithheld':text(withheld) if complete else None,'net':text(g-withheld-deducted) if complete else None,'imssCalculated':text(calculated) if worker_known else None,'imssDeducted':text(deducted) if worker_known else None,'imssAbsorbed':text(absorbed) if worker_known else None,'imssExcluded':text(excluded) if worker_known else None,'sbc':None if basis=='actual-calendar' else text(sbc)}
cases=[]
for date in ['2026-01-31','2026-02-01']:
 for p,n in days.items():
  amounts={F('315.03')*n,D*n,F('315.05')*n,D*n-F('0.01'),D*n+F('0.01')}
  if p=='monthly':amounts|={M-F('0.01'),M,M+F('0.01'),D*28,D*31,F('15000.00')}
  for g in sorted(amounts):
   for include in [True,False]:
    for basis in ['fixed-period','agreed-daily-reference','actual-calendar']:
     for condition in ['unknown','minimum-only-assumed','outside-profile']:
      context={'kind':'contextual-retention-2026-v2','salaryBasis':basis,'monthlyCondition':condition,'referenceMonth':date[:7]}
      if condition=='minimum-only-assumed':context.update(noOtherSalaryPayments=True,acknowledgement='explicit-standard-simulation-assumption-not-payroll-verification')
      for actual_days in ([28,30,31] if basis=='actual-calendar' else [None]):
       actual={**context,**({'actualDays':actual_days} if actual_days else {})};cases.append({'id':f'{date}/{p}/{text(g)}/{include}/{basis}/{condition}/{actual_days}','period':p,'date':date,'gross':text(g),'includeImss':include,'context':actual,'expected':expected(g,p,date,include,basis,condition)})
inverse=[]
for date in ['2026-01-31','2026-02-01']:
 for include in [True,False]:
  for basis in ['fixed-period','agreed-daily-reference']:
   for condition in ['unknown','minimum-only-assumed']:
    if basis=='fixed-period' and condition=='minimum-only-assumed':continue
    windows=[('9451.18','9451.24','9451.20'),('9451.18','9451.24','9082.02'),('9582.40','9582.60',expected(M+F('0.01'),'monthly',date,include,'agreed-daily-reference','unknown')['net'])]
    if not include:windows.append(('9582.40','9603.00','9451.20'))
    for lower,upper,target in windows:
     ctx={'kind':'contextual-retention-2026-v2','salaryBasis':basis,'monthlyCondition':condition,'referenceMonth':date[:7]}
     if condition=='minimum-only-assumed':ctx.update(noOtherSalaryPayments=True,acknowledgement='explicit-standard-simulation-assumption-not-payroll-verification')
     candidates=[];unresolved=[]
     for g_cents in range(cents(F(lower)),cents(F(upper))+1):
      g=F(g_cents,100)
      if g<D*30 or g<F(target):continue # Cotas de alcance y N<=G, independientes de un impuesto desconocido.
      effective=condition if g==D*30 else 'unknown'
      r=expected(g,'monthly',date,include,basis,effective)
      if r['net'] is None:unresolved.append(text(g))
      elif r['net']==target:candidates.append(text(g))
     inverse.append({'id':f'{date}/{include}/{basis}/{condition}/{lower}/{target}','date':date,'includeImss':include,'context':ctx,'from':lower,'to':upper,'target':target,'candidates':candidates,'unresolved':unresolved,'complete':not unresolved,'minimumProven':bool(candidates) and all(F(u)>=F(candidates[0]) for u in unresolved)})
out=root/'docs/evidence/5c2/independent-controls.json'
out.write_text(json.dumps({'method':'Python Fraction; datos de control independiente 4B.1 y referencias explícitas CONASAMI/LSS/LISR; no importaciones productivas','dailyMinimum':'315.04','standard30Days':'9451.20','publishedMonthly':'9582.47','cases':cases,'inverse':inverse},ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'cases':len(cases),'inverseWindows':len(inverse),'path':str(out),'method':'independent Fraction'}))
