import os, sys, json, re, hashlib
from pathlib import Path
from importlib.metadata import version
from datetime import timezone
sys.path.insert(0,os.environ.get("PDF_VERIFICATION_TOOLS",str(Path(os.environ["TEMP"])/"opencode"/"pdf-verification")))
from pypdf import PdfReader
import pypdfium2 as pdfium
from PIL import Image, ImageOps, ImageDraw
from fontTools.ttLib import TTFont

root=Path(__file__).resolve().parent.parent
out=root/"docs/evidence/5b10"
manifest=json.loads((out/"generated-models.json").read_text(encoding="utf8"))
documents=manifest["documents"][:]
native_file=out/"native-pdf-ui.json"
if native_file.exists():
    native=json.loads(native_file.read_text(encoding="utf8"))
    for saved in native.get("savedFiles",[]):
        documents.append({"id":saved["id"],"file":saved["path"],"sha256":saved["sha256"],"audit":saved["audit"],"amounts":manifest["documents"][0]["amounts"]})

glyphs="áéíóú ÁÉÍÓÚ ñ Ñ $ % 1,234,567,890.01 — – − ≤ ≥ ≈ → •"
font_info=[]
for name in ["DejaVuSans.ttf","DejaVuSans-Bold.ttf"]:
    path=root/"src/features/pdf/assets"/name
    font=TTFont(path);cmap=font.getBestCmap();missing=[f"U+{ord(c):04X}" for c in set(glyphs) if ord(c) not in cmap]
    assert not missing,(name,missing)
    assert font["OS/2"].fsType==0
    font_info.append({"name":name,"version":font["name"].getDebugName(5),"fsType":0,"missingGlyphs":[],"sha256":hashlib.sha256(path.read_bytes()).hexdigest()})

results=[]
for item in documents:
    path=Path(item["file"]);data=path.read_bytes()
    assert hashlib.sha256(data).hexdigest()==item["sha256"]
    reader=PdfReader(path,strict=True);count=len(reader.pages)
    assert not reader.is_encrypted and count==item["audit"]["pages"]
    assert reader.metadata.title=="Calculadora de Nómina — Prueba técnica 5B.10"
    assert reader.metadata.author=="Calculadora de Nómina"
    assert "CFDI" in reader.metadata.subject
    assert reader.metadata.creation_date.astimezone(timezone.utc).isoformat()=="2026-10-20T12:00:00+00:00"
    assert "jsPDF" in reader.metadata.producer and "Calculadora de Nómina" in reader.metadata.creator
    action=reader.trailer["/Root"].get("/OpenAction")
    if isinstance(action,dict):assert action.get("/S") not in ["/JavaScript","/Launch","/URI"]
    names=reader.trailer["/Root"].get("/Names",{})
    if hasattr(names,"get_object"):names=names.get_object()
    assert not names.get("/JavaScript")
    texts=[];fonts_seen={};images=0;vectors=0
    for index,page in enumerate(reader.pages,1):
        assert abs(float(page.mediabox.width)-612)<0.01 and abs(float(page.mediabox.height)-792)<0.01
        text=page.extract_text();texts.append(text)
        normalized=re.sub(r"\s+"," ",text)
        assert "Calculadora de Nómina" in normalized and "No es CFDI de nómina" in normalized
        assert f"Página {index} de {count}" in normalized
        resources=page["/Resources"].get_object()
        for key,ref in resources.get("/Font",{}).items():
            font=ref.get_object();descendants=font.get("/DescendantFonts",[])
            assert font.get("/ToUnicode") is not None,"Falta mapa para selección/extracción Unicode"
            assert descendants
            descriptor=descendants[0].get_object()["/FontDescriptor"].get_object()
            assert descriptor.get("/FontFile2") is not None,"Fuente TrueType no incrustada"
            length=len(descriptor["/FontFile2"].get_object().get_data())
            assert length>1000
            fonts_seen[f"{key}:{font['/BaseFont']}"]=length
        for ref in resources.get("/XObject",{}).values():
            if ref.get_object().get("/Subtype")=="/Image":images+=1
        pdf_commands=page.get_contents().get_data();vectors+=pdf_commands.count(b" Tj")+pdf_commands.count(b" TJ")
    assert images==0 and vectors>0 and len(fonts_seen)>=2
    full="\n".join(texts);normalized=re.sub(r"\s+"," ",full)
    for c in set(glyphs):assert c in full,(item["id"],f"Glifo perdido {c!r}")
    assert "\ufffd" not in full and "\x00" not in full
    if item["id"] in ["directo","directo-largo","native-corto","native-largo"]:
        for amount in ["$ 15,000.00","$ 1,402.82","$ 394.54","$ 13,202.64"]:assert amount in normalized,(item["id"],amount)
        assert "01/02/2026" in normalized and "Mensual" in normalized and "General" in normalized
    if item["id"]=="aproximado":assert "−$ 0.01" in normalized and "Aproximado" in normalized
    if item["id"]=="limitado":assert "limitada" in normalized
    if item["id"]=="alternativas":assert "$ 3,499.99" in normalized and "$ 3,500.00" in normalized
    if item["id"]=="pendiente-desconocido":assert "Condición fiscal pendiente" in normalized and "—" in normalized and item["amounts"]["net"]["raw"] is None
    if item["id"]=="encontrado-sin-minimo":assert "Bruto encontrado" in normalized and "Bruto mínimo demostrado" not in normalized and "El candidato mostrado conserva su verificación" in normalized and "Sin confirmación no se presume retención ni neto conocidos" not in normalized
    if item["audit"]["stressRows"]:
        assert count>=4
        for n in range(1,item["audit"]["stressRows"]+1):
            marker=f"PRUEBA-{n:03d}"
            assert sum(t.count(marker) for t in texts)==1,(marker,"fila cortada o duplicada")
        for n in item["audit"]["stressPages"]:assert "Fila de prueba" in texts[n-1],"Falta encabezado de continuación"
    render_dir=out/"renderizados"/item["id"];render_dir.mkdir(parents=True,exist_ok=True)
    (render_dir/"texto-extraido.txt").write_text(full,encoding="utf8")
    pdf=pdfium.PdfDocument(data);char_count=0;outside=[];rendered=[];thumbs=[]
    for i in range(len(pdf)):
        page=pdf[i];textpage=page.get_textpage();pdfium_text=textpage.get_text_range()
        assert "Calculadora de Nómina" in pdfium_text and "CFDI" in pdfium_text
        for j in range(textpage.count_chars()):
            char=textpage.get_text_range(index=j,count=1)
            if not char.strip():continue
            char_count+=1
            x0,y0,x1,y1=textpage.get_charbox(j)
            if x0<36 or x1>576 or y0<18 or y1>774:outside.append({"page":i+1,"char":char,"box":[x0,y0,x1,y1]})
        bitmap=page.render(scale=1.5);image=bitmap.to_pil().convert("RGB")
        image_path=render_dir/f"pagina-{i+1:02d}.png";image.save(image_path);rendered.append(str(image_path))
        thumb=ImageOps.contain(image,(306,396));canvas=Image.new("RGB",(326,424),"#e3e8e5");canvas.paste(thumb,((326-thumb.width)//2,8));ImageDraw.Draw(canvas).text((12,408),f"Página {i+1}/{count}",fill="black");thumbs.append(canvas)
        textpage.close();page.close();bitmap.close()
    pdf.close()
    assert not outside,(item["id"],outside[:6])
    montage=Image.new("RGB",(326*min(3,len(thumbs)),424*((len(thumbs)+2)//3)),"white")
    for i,thumb in enumerate(thumbs):montage.paste(thumb,((i%3)*326,(i//3)*424))
    montage_path=render_dir/"contacto.png";montage.save(montage_path)
    results.append({"id":item["id"],"path":str(path),"sha256":item["sha256"],"bytes":len(data),"pages":count,"letter":True,"selectableTextOperators":vectors,"embeddedFonts":fonts_seen,"imageObjects":images,"pdfiumCharactersChecked":char_count,"outsidePrintableArea":outside,"renderedPages":rendered,"contactSheet":str(montage_path),"textExtraction":str(render_dir/"texto-extraido.txt"),"status":"passed"})

report={"tools":{n:version(n) for n in ["pypdf","pypdfium2","Pillow","fonttools"]},"fonts":font_info,"documents":results,"status":"passed"}
(out/"pdf-quality.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf8")
print(json.dumps({"status":"passed","documents":[{"id":r["id"],"pages":r["pages"],"images":r["imageObjects"],"fonts":len(r["embeddedFonts"])} for r in results]},ensure_ascii=False,indent=2))
