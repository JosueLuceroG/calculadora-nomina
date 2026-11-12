import os,sys,json,re,hashlib
from decimal import Decimal
from pathlib import Path
sys.path.insert(0,str(Path(os.environ['TEMP'])/'opencode/pdf-verification'))
from pypdf import PdfReader
import pypdfium2 as pdfium
root=Path(__file__).resolve().parent.parent
out=root/'docs/evidence/5d3b4e'
native=json.loads((out/'windows-qa.json').read_text(encoding='utf8'))
assert not native['failures'] and len(native['pdf'])>=12
results=[]
for item in native['pdf']:
 p=Path(item['path']).resolve();assert p.is_relative_to(out.resolve())
 b=p.read_bytes();assert hashlib.sha256(b).hexdigest()==item['sha256']
 r=PdfReader(p,strict=True);text=re.sub(r'\s+','', ''.join(page.extract_text() for page in r.pages))
 assert '\ufffd' not in text
 for amount in [item['expectedGross'],item['expectedNet']]:assert f'${Decimal(amount):,.2f}' in text
 assert item['expectedVersion'] in text
 assert 'ParámetrossintéticosQA' in text and 'NorepresentanvaloresoficialesdeMéxico.' in text
 assert 'noatestación' in text and 'noreconstruible' in text and 'noconsultado' in text
 assert 'noescfdidenómina' in text.lower()
 fonts=set();urls=[]
 for i,page in enumerate(r.pages,1):
  assert list(page.mediabox)==[0,0,612,792]
  assert f'Página {i} de {len(r.pages)}' in page.extract_text()
  for f in page['/Resources']['/Font'].values():
   f=f.get_object();assert f.get('/ToUnicode')
   fonts.add(hashlib.sha256(f['/DescendantFonts'][0].get_object()['/FontDescriptor'].get_object()['/FontFile2'].get_object().get_data()).hexdigest())
  assert not page['/Resources'].get('/XObject')
  for a in page.get('/Annots',[]):
   a=a.get_object()
   if a.get('/A',{}).get('/S')=='/URI':
    urls.append(str(a['/A']['/URI']));assert urls[-1].startswith('https://')
    x0,y0,x1,y1=map(float,a['/Rect']);assert 41.9<=min(x0,x1)<=max(x0,x1)<=570.1 and 61.9<=min(y0,y1)<=max(y0,y1)<=714.1
 assert len(fonts)==2 and len(urls)==10
 doc=pdfium.PdfDocument(b);target=out/'renderizados'/native['run']/p.stem;target.mkdir(parents=True,exist_ok=True)
 for i in range(len(doc)):
  page=doc[i];tp=page.get_textpage()
  for j in range(tp.count_chars()):
   if tp.get_text_range(index=j,count=1).strip():
    x0,y0,x1,y1=tp.get_charbox(j);assert 35<=x0<=x1<=577 and 15<=y0<=y1<=777
  bitmap=page.render(scale=1.25);bitmap.to_pil().save(target/f'pagina-{i+1:02d}.png');tp.close();bitmap.close();page.close()
 doc.close()
 results.append({'label':item['label'],'pages':len(r.pages),'uriLinks':len(urls),'fontPrograms':len(fonts),'sha256':item['sha256'],'originalSha256':item['originalSha256'],'qaNoticeVerified':True,'amountsAndHistoricalVersionVerified':True,'status':'passed'})
report={'status':'passed','run':native['run'],'documents':results,'pages':sum(r['pages'] for r in results),'uriLinks':sum(r['uriLinks'] for r in results),'scope':'Actual UI/native execution records exported through Windows; preserved amounts/version/QA/provenance before and after B, restart and missing repository'}
(out/'pdf-quality.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps(report,ensure_ascii=True,indent=2))
