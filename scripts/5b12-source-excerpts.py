import sys,os,json,re,html
from pathlib import Path
sys.path.insert(0,os.environ.get('PDF_VERIFICATION_TOOLS',str(Path(os.environ['TEMP'])/'opencode/pdf-verification')))
from pypdf import PdfReader
root=Path(__file__).resolve().parent.parent;out=root/'docs/evidence/5b12';data=json.loads((out/'normative-sources.json').read_text(encoding='utf8'));records=[]
for source in data['records']:
    if 'error' in source:records.append(source);continue
    if source['id']=='minimum-2026':
        text=html.unescape(re.sub('<[^>]+>',' ',Path(source['path']).read_text(encoding='utf8')));text=re.sub(r'\s+',' ',text);match=re.search(r'CUARTO\s*\.\s*-?\s*Para expresar.{0,750}',text,re.I);assert match;excerpt=match.group(0).split('QUINTO')[0];assert '9,582.47' in excerpt and '365' in excerpt
        records.append({**source,'locator':'Resolutivo Cuarto','excerpt':excerpt})
    else:
        reader=PdfReader(source['path']);targets=['Artículo 96.'] if source['id']=='lisr' else ['Artículo 29.','Artículo 36.'];found=set()
        for i,page in enumerate(reader.pages):
            text=re.sub(r'\s+',' ',page.extract_text())
            for target in targets:
                if target in text and target not in found:
                    found.add(target);start=text.index(target);excerpt=text[start:start+1150];records.append({**source,'locator':target,'pdfPage':i+1,'excerpt':excerpt})
            if len(found)==len(targets):break
        assert len(found)==len(targets)
(out/'normative-excerpts.json').write_text(json.dumps({'records':records},ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'sources':len(data['records']),'excerpts':len(records),'status':'extracted'},ensure_ascii=True))
