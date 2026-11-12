import os,sys,json,re,hashlib
from pathlib import Path
sys.path.insert(0,str(Path(os.environ['TEMP'])/'opencode/pdf-verification'))
from pypdf import PdfReader
import pypdfium2 as pdfium
from PIL import Image,ImageOps,ImageDraw
root=Path(__file__).resolve().parent.parent;out=root/'docs/evidence/5d3b3'
gate=json.loads((out/'ts-contract-gate.json').read_text(encoding='utf8'));native=json.loads((out/'windows.json').read_text(encoding='utf8'));assert not native['failures']
items=[dict(x,kind='unit',fixture=True) for x in gate['pdfEvidence']]+[dict(x,kind='native',fixture=x['fixtureOnly']) for x in native['pdf']]
results=[]
for item in items:
 p=item['path'];p=p[1:] if re.match(r'^/[A-Za-z]:/',p) else p;p=Path(p);data=p.read_bytes();assert hashlib.sha256(data).hexdigest()==item['sha256'];r=PdfReader(p,strict=True);assert r.metadata.title=='Reporte de simulación salarial — Calculadora de Nómina'
 text=' '.join(re.sub(r'\s+',' ',page.extract_text()) for page in r.pages);assert '\ufffd' not in text
 if item['fixture']:
  assert 'Fixture documental de QA.' in text and 'No acredita una ejecución externa autorizada.' in text
  assert 'Historia de confianza referenciada; no reconstruible' in text
  assert 'no es firma del resultado salarial ni certificación normativa' in text
  assert 'sin firma digital externa' not in text
 fonts=set();urls=[];images=0
 for index,page in enumerate(r.pages,1):
  assert list(page.mediabox)==[0,0,612,792];assert f'Página {index} de {len(r.pages)}' in page.extract_text()
  for font in page['/Resources']['/Font'].values():
   font=font.get_object();assert font.get('/ToUnicode');desc=font['/DescendantFonts'][0].get_object()['/FontDescriptor'].get_object();fonts.add(hashlib.sha256(desc['/FontFile2'].get_object().get_data()).hexdigest())
  for image in page['/Resources'].get('/XObject',{}).values():
   if image.get_object().get('/Subtype')=='/Image':images+=1
  for a in page.get('/Annots',[]):
   a=a.get_object()
   if a.get('/A',{}).get('/S')=='/URI':
    url=str(a['/A']['/URI']);assert url.startswith('https://');urls.append(url);x0,y0,x1,y1=map(float,a['/Rect']);assert min(x0,x1)>=41.9 and max(x0,x1)<=570.1 and min(y0,y1)>=61.9 and max(y0,y1)<=714.1
 assert len(fonts)==2 and images==0 and urls
 if item['kind']=='unit':assert sorted(urls)==sorted(item['uriLinks'])
 doc=pdfium.PdfDocument(data);target=out/'renderizados'/f"{item['kind']}-{p.stem}";target.mkdir(parents=True,exist_ok=True);thumbs=[]
 for i in range(len(doc)):
  page=doc[i];tp=page.get_textpage()
  for j in range(tp.count_chars()):
   if not tp.get_text_range(index=j,count=1).strip():continue
   x0,y0,x1,y1=tp.get_charbox(j);assert 35<=x0<=x1<=577 and 15<=y0<=y1<=777,(p.name,i,j,(x0,y0,x1,y1))
  bitmap=page.render(scale=1.25);image=bitmap.to_pil().convert('RGB');image.save(target/f'pagina-{i+1:02d}.png');thumb=ImageOps.contain(image,(306,396));canvas=Image.new('RGB',(326,424),'#e3e8e5');canvas.paste(thumb,(10,8));ImageDraw.Draw(canvas).text((10,408),f'{i+1}/{len(doc)}',fill='black');thumbs.append(canvas);tp.close();bitmap.close();page.close()
 contact=Image.new('RGB',(326*len(thumbs),424),'white')
 for i,t in enumerate(thumbs):contact.paste(t,(i*326,0))
 contact.save(target/'contacto.png');doc.close();results.append({'id':p.stem,'kind':item['kind'],'pages':len(r.pages),'uriLinks':len(urls),'fonts':len(fonts),'images':images,'fixtureOnly':item['fixture'],'sha256':hashlib.sha256(data).hexdigest(),'status':'passed'})
report={'status':'passed','documents':results,'pages':sum(r['pages'] for r in results),'uriLinks':sum(r['uriLinks'] for r in results),'documentaryFixturesAreNotExternalExecutions':True}
(out/'pdf-quality.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8');print(json.dumps(report,ensure_ascii=True,indent=2))
