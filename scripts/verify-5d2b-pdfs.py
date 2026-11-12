import os,sys,json,re,hashlib
from pathlib import Path
from datetime import datetime,timezone
sys.path.insert(0,os.environ.get('PDF_VERIFICATION_TOOLS',str(Path(os.environ['TEMP'])/'opencode/pdf-verification')))
from pypdf import PdfReader
import pypdfium2 as pdfium
from PIL import Image,ImageOps,ImageDraw
root=Path(__file__).resolve().parent.parent;out=root/'docs/evidence/5d2b'
generated=json.loads((out/'generated-pdfs.json').read_text(encoding='utf8'))['documents']
native=json.loads((out/'native-verification.json').read_text(encoding='utf8'));assert not native['failures']
items=[dict(item,group='unit') for item in generated]+[dict(item,group='native') for item in native['pdf']]
results=[]
for item in items:
    path=Path(item['path']);data=path.read_bytes();assert hashlib.sha256(data).hexdigest()==item['sha256']
    reader=PdfReader(path,strict=True);assert reader.metadata.title=='Reporte de simulación salarial — Calculadora de Nómina';assert reader.metadata.creation_date
    if 'exportedAt' in item:assert reader.metadata.creation_date.astimezone(timezone.utc)==datetime.fromisoformat(item['exportedAt'].replace('Z','+00:00'))
    if 'pages' in item:assert len(reader.pages)==item['pages']
    texts=[];uris=[];fonts=set();images=0
    for i,page in enumerate(reader.pages,1):
        assert list(page.mediabox)==[0,0,612,792]
        text=re.sub(r'\s+',' ',page.extract_text());texts.append(text);assert '\ufffd' not in text
        assert f'Página {i} de {len(reader.pages)}' in text
        resources=page['/Resources'].get_object()
        for font in resources['/Font'].values():
            font=font.get_object();assert font.get('/ToUnicode');desc=font['/DescendantFonts'][0].get_object()['/FontDescriptor'].get_object();fonts.add(hashlib.sha256(desc['/FontFile2'].get_object().get_data()).hexdigest())
        for image in resources.get('/XObject',{}).values():
            if image.get_object().get('/Subtype')=='/Image':images+=1
        for annotation in page.get('/Annots',[]):
            a=annotation.get_object()
            if a.get('/Subtype')=='/Link' and a.get('/A',{}).get('/S')=='/URI':
                uris.append(str(a['/A']['/URI']));ax,ay,bx,by=map(float,a['/Rect']);x0,y0,x1,y1=min(ax,bx),min(ay,by),max(ax,bx),max(ay,by);assert 41.99<=x0<x1<=570.01 and 61.99<=y0<y1<=714.01,(item['id'],[x0,y0,x1,y1])
    full=' '.join(texts);assert item['engine'] in full;assert len(fonts)==2 and images==0;assert sorted(uris)==sorted(item['uris'])
    if item['snapshotVersion']==2:
        for label in ['Origen: paquete integrado','sin firma digital externa','nomina-contextual-2026-5d2b-v1','fiscal-capabilities-5d2a-v1','isrTariff:','uma:','minimumWages:','subsidy:','imssConstants:','contractualDivisors:','laborBenefitMinima:']:assert label in full,(item['id'],label)
    else:assert 'nomina-contextual-2026-5d2b-v1' not in full
    if item['id']=='legacy-v1':assert 'Retención contextual v2' not in full and '$ 9,451.20' in full
    if item['id'] in ['current-v2','history-v2']:assert '$ 13,202.64' in full and 'Retención contextual v2' in full
    if item['id']=='inverse-current-v2':assert '$ 9,877.38' in full and '$ 9,877.39' in full and 'No se ha demostrado' in full
    target=out/'renderizados'/f"{item['group']}-{item['id']}";target.mkdir(parents=True,exist_ok=True);(target/'texto-extraido.txt').write_text('\n'.join(texts),encoding='utf8')
    pdf=pdfium.PdfDocument(data);thumbs=[]
    for i in range(len(pdf)):
        page=pdf[i];tp=page.get_textpage()
        for j in range(tp.count_chars()):
            if not tp.get_text_range(index=j,count=1).strip():continue
            x0,y0,x1,y1=tp.get_charbox(j);assert x0>=35 and x1<=577 and y0>=15 and y1<=777,(item['id'],i+1,j)
        bitmap=page.render(scale=1.5);image=bitmap.to_pil().convert('RGB');image.save(target/f'pagina-{i+1:02d}.png');thumb=ImageOps.contain(image,(306,396));canvas=Image.new('RGB',(326,424),'#e3e8e5');canvas.paste(thumb,(10,8));ImageDraw.Draw(canvas).text((10,408),f'{i+1}/{len(pdf)}',fill='black');thumbs.append(canvas);tp.close();bitmap.close();page.close()
    pdf.close();contact=Image.new('RGB',(326*len(thumbs),424),'white')
    for i,thumb in enumerate(thumbs):contact.paste(thumb,(i*326,0))
    contact.save(target/'contacto.png');results.append({'id':item['id'],'group':item['group'],'pages':len(reader.pages),'uriLinks':len(uris),'embeddedFontPrograms':len(fonts),'images':images,'snapshotVersion':item['snapshotVersion'],'sha256':item['sha256'],'status':'passed'})
report={'status':'passed','documents':results,'pages':sum(r['pages'] for r in results),'uriLinks':sum(r['uriLinks'] for r in results),'nativeDocuments':len(native['pdf'])}
(out/'pdf-quality.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(report,ensure_ascii=True,indent=2))
