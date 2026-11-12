import os,sys,json,re,hashlib
from pathlib import Path
from datetime import datetime,timezone
sys.path.insert(0,os.environ.get('PDF_VERIFICATION_TOOLS',str(Path(os.environ['TEMP'])/'opencode/pdf-verification')))
from pypdf import PdfReader
import pypdfium2 as pdfium
from PIL import Image,ImageOps,ImageDraw
root=Path(__file__).resolve().parent.parent;out=root/'docs/evidence/5c2';native=json.loads((out/'native-context.json').read_text(encoding='utf8'));assert not native['failures'];results=[]
legacy=json.loads((out/'legacy/storage-fixtures.json').read_text(encoding='utf8'));sources=json.loads(next(f['payload'] for f in legacy if f['name']=='inverse-exact'))['value']['outcome']['report']['provenance']['sources'];expected_uris=sorted({r['url']+'|'+r['document']:r['url'] for r in sources}.values())
for item in native['pdf']:
    data=Path(item['path']).read_bytes();assert hashlib.sha256(data).hexdigest()==item['sha256'];reader=PdfReader(item['path'],strict=True);assert len(reader.pages)==item['pages'];texts=[];uris=[];fonts=set();images=0
    assert reader.metadata.title=='Reporte de simulación salarial — Calculadora de Nómina'
    assert reader.metadata.creation_date.astimezone(timezone.utc)==datetime.fromisoformat(item['exportedAt'].replace('Z','+00:00'))
    for i,page in enumerate(reader.pages,1):
        assert list(page.mediabox)==[0,0,612,792];text=re.sub(r'\s+',' ',page.extract_text());texts.append(text);assert '\ufffd' not in text;assert 'Simulación estimada — no es CFDI de nómina ni comprobante de pago' in text;assert f'Página {i} de {len(reader.pages)}' in text
        resources=page['/Resources'].get_object()
        for font in resources['/Font'].values():
            font=font.get_object();assert font.get('/ToUnicode');desc=font['/DescendantFonts'][0].get_object()['/FontDescriptor'].get_object();fonts.add(hashlib.sha256(desc['/FontFile2'].get_object().get_data()).hexdigest())
        for image in resources.get('/XObject',{}).values():
            if image.get_object().get('/Subtype')=='/Image':images+=1
        for a in page.get('/Annots',[]):
            a=a.get_object()
            if a.get('/Subtype')=='/Link' and a.get('/A',{}).get('/S')=='/URI':uris.append(str(a['/A']['/URI']))
    full=' '.join(texts);assert item['engine'] in full;assert len(fonts)==2 and images==0;assert sorted(uris)==expected_uris
    if item['legacy']:assert 'Retención contextual v2' not in full and 'Salario neto estimado $ 9,451.20' in full
    else:assert 'Retención contextual v2' in full
    if item['id']=='mensual-pendiente':assert 'ISR retenido —' in full and 'Salario neto estimado —' in full and 'IMSS efectivamente descontado $ 238.81' in full
    if item['id']=='ordinario':assert 'Salario neto estimado $ 13,202.64' in full and len(reader.pages)==2
    if item['id'] in ['diario-dentro-region','historico-nuevo']:assert 'Salario neto estimado $ 9,195.72' in full
    if item['id']=='inverso-region-pendiente':assert 'No se ha demostrado' in full and '$ 9,877.38' in full and '$ 9,877.39' in full
    if item['id']=='inverso-hipotesis':assert 'Candidato mínimo bajo hipótesis mensual no verificada.' in texts[0] and 'Hipótesis mensual' in full and '$ 9,877.38' in full and '$ 9,877.39' in full
    target=out/'renderizados'/item['id'];target.mkdir(parents=True,exist_ok=True);(target/'texto-extraido.txt').write_text('\n'.join(texts),encoding='utf8');pdf=pdfium.PdfDocument(data);thumbs=[]
    for i in range(len(pdf)):
        page=pdf[i];tp=page.get_textpage()
        for j in range(tp.count_chars()):
            if not tp.get_text_range(index=j,count=1).strip():continue
            x0,y0,x1,y1=tp.get_charbox(j);assert x0>=35 and x1<=577 and y0>=15 and y1<=777,(item['id'],i+1,j)
        bitmap=page.render(scale=1.5);image=bitmap.to_pil().convert('RGB');image.save(target/f'pagina-{i+1:02d}.png');thumb=ImageOps.contain(image,(306,396));canvas=Image.new('RGB',(326,424),'#e3e8e5');canvas.paste(thumb,(10,8));ImageDraw.Draw(canvas).text((10,408),f'{i+1}/{len(pdf)}',fill='black');thumbs.append(canvas);tp.close();bitmap.close();page.close()
    pdf.close();contact=Image.new('RGB',(326*len(thumbs),424),'white')
    for i,t in enumerate(thumbs):contact.paste(t,(i*326,0))
    contact.save(target/'contacto.png');results.append({'id':item['id'],'path':item['path'],'pages':item['pages'],'sha256':item['sha256'],'embeddedPrograms':len(fonts),'images':images,'uriLinks':len(uris),'legacyInterpretationPreserved':item['legacy'],'status':'passed'})
report={'status':'passed','documents':results,'pages':sum(r['pages'] for r in results),'uriLinks':sum(r['uriLinks'] for r in results)};(out/'pdf-quality.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(report,ensure_ascii=True,indent=2))
