import os,sys,json,re,hashlib
from pathlib import Path
from datetime import datetime,timezone
sys.path.insert(0,os.environ.get('PDF_VERIFICATION_TOOLS',str(Path(os.environ['TEMP'])/'opencode/pdf-verification')))
from pypdf import PdfReader
import pypdfium2 as pdfium
from PIL import Image,ImageOps,ImageDraw
root=Path(__file__).resolve().parent.parent;out=root/'docs/evidence/5b12';source=json.loads((out/'native-pdf.json').read_text(encoding='utf8'));assert not source['failures'];results=[]
labels={'gross':'Salario bruto','net':'Salario neto estimado','isr':'ISR retenido','imss':'IMSS efectivamente descontado'}
for item in source['pdf']:
    data=Path(item['path']).read_bytes();assert hashlib.sha256(data).hexdigest()==item['sha256'];reader=PdfReader(item['path'],strict=True);assert len(reader.pages)==item['pages'];texts=[];fonts=set();images=0;uris=[]
    assert reader.metadata.title=='Reporte de simulación salarial — Calculadora de Nómina'
    assert reader.metadata.creation_date.astimezone(timezone.utc)==datetime.fromisoformat(item['exportedAt'].replace('Z','+00:00'))
    for i,page in enumerate(reader.pages,1):
        assert list(page.mediabox)==[0,0,612,792];text=re.sub(r'\s+',' ',page.extract_text());texts.append(text);assert f'Página {i} de {len(reader.pages)}' in text;assert 'Simulación estimada — no es CFDI de nómina ni comprobante de pago' in text;assert '\ufffd' not in text
        resources=page['/Resources'].get_object()
        for f in resources['/Font'].values():
            f=f.get_object();assert f.get('/ToUnicode');desc=f['/DescendantFonts'][0].get_object()['/FontDescriptor'].get_object();assert desc.get('/FontFile2');fonts.add(hashlib.sha256(desc['/FontFile2'].get_object().get_data()).hexdigest())
        for o in resources.get('/XObject',{}).values():
            if o.get_object().get('/Subtype')=='/Image':images+=1
        for a in page.get('/Annots',[]):
            a=a.get_object()
            if a.get('/Subtype')=='/Link' and a.get('/A',{}).get('/S')=='/URI':uris.append(str(a['/A']['/URI']))
    full=' '.join(texts);assert sorted(uris)==sorted(item['expectedUris']);assert len(fonts)==2 and images==0
    for key,label in labels.items():
        wanted=item['amounts'][key];match=re.search(re.escape(label)+r'\s+(?:\$\s*)?([\d,]+\.\d{2}|—)',full);assert match,(item['id'],label)
        actual=match.group(1);assert (None if actual=='—' else actual.replace(',',''))==wanted,(item['id'],label,actual,wanted)
    for original in [item['originalInstant'],item['versions']['engine'],item['fiscalPackage']['sha256'],item['fiscalPackage']['version']]:assert original in full
    if item['id']=='alternativas':assert 'Otra alternativa verificada: $ 3,500.00' in texts[0]
    if item['id']=='aproximado-historico':assert '−$ 0.01' in full
    if item['id']=='limitado-historico':assert 'Cobertura limitada' in full
    if item['id']=='condicionado':assert 'hipótesis mensual no verificada' in full
    target=out/'renderizados'/item['id'];target.mkdir(parents=True,exist_ok=True);(target/'texto-extraido.txt').write_text('\n'.join(texts),encoding='utf8');pdf=pdfium.PdfDocument(data);thumbs=[]
    for i in range(len(pdf)):
        page=pdf[i];tp=page.get_textpage()
        for j in range(tp.count_chars()):
            if not tp.get_text_range(index=j,count=1).strip():continue
            x0,y0,x1,y1=tp.get_charbox(j);assert x0>=35 and x1<=577 and y0>=15 and y1<=777,(item['id'],i+1,j)
        bitmap=page.render(scale=1.5);image=bitmap.to_pil().convert('RGB');image.save(target/f'pagina-{i+1:02d}.png');thumb=ImageOps.contain(image,(306,396));canvas=Image.new('RGB',(326,424),'#e3e8e5');canvas.paste(thumb,(10,8));ImageDraw.Draw(canvas).text((10,408),f'{i+1}/{len(pdf)}',fill='black');thumbs.append(canvas);tp.close();bitmap.close();page.close()
    pdf.close();contact=Image.new('RGB',(326*len(thumbs),424),'white')
    for i,t in enumerate(thumbs):contact.paste(t,(i*326,0))
    contact.save(target/'contacto.png');results.append({'id':item['id'],'path':item['path'],'sha256':item['sha256'],'pages':item['pages'],'fonts':sorted(fonts),'images':images,'uriLinks':len(uris),'screenSnapshotPdfAmountsMatch':True,'status':'passed'})
report={'status':'passed','documents':results,'totalPages':sum(r['pages'] for r in results),'totalUriLinks':sum(r['uriLinks'] for r in results)};(out/'pdf-quality.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(report,ensure_ascii=True,indent=2))
