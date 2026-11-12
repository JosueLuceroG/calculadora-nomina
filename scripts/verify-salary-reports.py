import os, sys, json, re, hashlib
from pathlib import Path
from datetime import datetime, timezone
sys.path.insert(0,os.environ.get("PDF_VERIFICATION_TOOLS",str(Path(os.environ["TEMP"])/"opencode"/"pdf-verification")))
from pypdf import PdfReader
import pypdfium2 as pdfium
from PIL import Image,ImageOps,ImageDraw
root=Path(__file__).resolve().parent.parent
out=root/("docs/evidence/5b11-1" if "--refinement" in sys.argv else "docs/evidence/5b11")
refinement="--refinement" in sys.argv
documents=json.loads((out/"generated-reports.json").read_text(encoding="utf8"))["documents"]
printed_locators={(r["url"],tuple(r["locators"])):r.get("displayLocators",r["locators"]) for item in documents for r in item["report"].get("references",[])}
for name in ["edge-exports.json","native-exports.json","embedded-exports.json"]:
    verification_file=out/name
    if verification_file.exists():
        verification=json.loads(verification_file.read_text(encoding="utf8"))
        assert not verification["failures"],f"Primero debe pasar {name}"
        documents+=verification.get("savedFiles",[])
results=[]
for item in documents:
    path=Path(item["path"]);data=path.read_bytes();assert hashlib.sha256(data).hexdigest()==item["sha256"]
    reader=PdfReader(path,strict=True);count=len(reader.pages);assert count==item["audit"]["pages"]
    assert reader.metadata.title=="Reporte de simulación salarial — Calculadora de Nómina"
    assert reader.metadata.author=="Calculadora de Nómina"
    assert "CFDI" in reader.metadata.subject
    expected_date=datetime.fromisoformat(item["report"]["exportedAt"].replace("Z","+00:00"))
    assert reader.metadata.creation_date.astimezone(timezone.utc)==expected_date
    texts=[];fonts={};image_count=0;uri_links=[]
    for index,page in enumerate(reader.pages,1):
        assert float(page.mediabox.width)==612 and float(page.mediabox.height)==792
        text=page.extract_text();texts.append(text);normalized=re.sub(r"\s+"," ",text)
        assert "Calculadora de Nómina" in normalized
        assert "Simulación estimada — no es CFDI de nómina ni comprobante de pago" in normalized
        assert f"Página {index} de {count}" in normalized
        resources=page["/Resources"].get_object()
        for annotation in page.get("/Annots",[]):
            annotation=annotation.get_object();action=annotation.get("/A",{})
            if annotation.get("/Subtype")=="/Link" and action.get("/S")=="/URI":
                a,b,c,d=[float(v) for v in annotation["/Rect"]]
                uri_links.append({"page":index,"uri":str(action["/URI"]),"rect":[min(a,c),min(b,d),max(a,c),max(b,d)]})
        for key,ref in resources.get("/Font",{}).items():
            font=ref.get_object();assert font.get("/ToUnicode")
            desc=font["/DescendantFonts"][0].get_object()["/FontDescriptor"].get_object();assert desc.get("/FontFile2")
            fonts[f"{key}:{font['/BaseFont']}"]=len(desc["/FontFile2"].get_object().get_data())
        for ref in resources.get("/XObject",{}).values():
            if ref.get_object().get("/Subtype")=="/Image":image_count+=1
        assert len(normalized)>100,"Página prácticamente vacía"
    assert len(fonts)>=2 and image_count==0
    full=re.sub(r"\s+"," ","\n".join(texts));assert "\ufffd" not in full
    for label in ["Fecha de referencia fiscal","Documento exportado","Ejercicio","Salario bruto","ISR calculado por tarifa","Subsidio determinado","Subsidio efectivamente aplicado","ISR retenido","IMSS obrero calculado","IMSS efectivamente descontado","Salario neto estimado","Prestaciones declaradas","SDI teórico","SBC estimado (no registrado)","Supuestos y advertencias","Fuentes oficiales y trazabilidad","Versión utilizada"]:assert label in full,(item["id"],label)
    for name in ["gross","net","isr","imss"]:assert item["report"]["amounts"][name]["display"] in full
    assert item["report"]["fiscalPackage"]["version"] in full
    assert item["report"]["versions"]["engine"] in full
    if refinement:
        references=item["report"]["references"]
        assert sorted(l["uri"] for l in uri_links)==sorted(r["url"] for r in references),(item["id"],"URI destinations must match all original references")
        for reference in references:
            assert reference["authority"] in full
            for locator in reference.get("displayLocators",printed_locators.get((reference["url"],tuple(reference["locators"])),reference["locators"])):assert re.sub(r"\s+"," ",locator) in full,(item["id"],locator)
            for verified in reference["verifiedOn"]:assert "/".join(reversed(verified.split("-"))) in full
        assert "https://" not in full,"Las URL extensas no deben sustituir los títulos legibles"
        for link in uri_links:
            x0,y0,x1,y1=link["rect"];assert 42-0.01<=x0<x1<=570+0.01 and 62-0.01<=y0<y1<=714+0.01,(item["id"],link)
        if item["report"].get("alternativePreview"):assert item["report"]["alternativePreview"] in re.sub(r"\s+"," ",texts[0])
        for zone in [item["report"].get("originalZone"),item["report"].get("exportZone")]:
            if zone:assert zone in full
        for code in item["report"].get("originalWarningCodes",[]):assert any(code in n["codes"] for n in item["report"]["notices"]),(item["id"],code)
    if item["id"]=="aproximado":assert "−$ 0.01" in full and "Aproximación" in full
    if item["id"]=="alternativas":assert "$ 3,499.99" in full and "$ 3,500.00" in full
    if item["id"]=="encontrado-sin-minimo":assert "No se ha demostrado" in full and "Bruto mínimo demostrado" not in full
    if item["id"]=="pendiente-desconocido":assert "pendiente" in full and item["report"]["amounts"]["net"]["raw"] is None
    if item["id"]=="directo":
        first=re.sub(r"\s+"," ",texts[0]);assert "$ 13,202.64" in first and "Desglose fiscal" in first and "Salario neto estimado" in first
        if refinement:assert count==2 and "Integración y cotización estimadas" in first and "SBC estimado (no registrado)" in first
        for marker in ["SAT","Anexo 8","DOF","INEGI","CONASAMI","Ley del Seguro Social","Ley Federal del Trabajo"]:assert marker in full,marker
    target=out/"renderizados"/item["id"];target.mkdir(parents=True,exist_ok=True);(target/"texto-extraido.txt").write_text("\n".join(texts),encoding="utf8")
    # Retirar únicamente páginas generadas por este verificador que ya no existen en el PDF.
    for previous in target.glob("pagina-*.png"):
        number=re.fullmatch(r"pagina-(\d+)\.png",previous.name)
        if number and int(number.group(1))>count:previous.unlink()
    pdf=pdfium.PdfDocument(data);outside=[];rendered=[];thumbs=[]
    for i in range(len(pdf)):
        page=pdf[i];tp=page.get_textpage();assert "CFDI" in tp.get_text_range()
        for j in range(tp.count_chars()):
            c=tp.get_text_range(index=j,count=1)
            if not c.strip():continue
            x0,y0,x1,y1=tp.get_charbox(j)
            if x0<35 or x1>577 or y0<15 or y1>777:outside.append({"page":i+1,"char":c,"box":[x0,y0,x1,y1]})
        bitmap=page.render(scale=1.5);image=bitmap.to_pil().convert("RGB");filename=target/f"pagina-{i+1:02d}.png";image.save(filename);rendered.append(str(filename))
        thumb=ImageOps.contain(image,(306,396));canvas=Image.new("RGB",(326,424),"#e3e8e5");canvas.paste(thumb,((326-thumb.width)//2,8));ImageDraw.Draw(canvas).text((12,408),f"Página {i+1}/{count}",fill="black");thumbs.append(canvas)
        tp.close();page.close();bitmap.close()
    pdf.close();assert not outside,(item["id"],outside[:5])
    montage=Image.new("RGB",(326*min(3,len(thumbs)),424*((len(thumbs)+2)//3)),"white")
    for i,t in enumerate(thumbs):montage.paste(t,((i%3)*326,(i//3)*424))
    montage.save(target/"contacto.png")
    results.append({"id":item["id"],"path":str(path),"sha256":item["sha256"],"pages":count,"fonts":fonts,"imageObjects":image_count,"uriLinks":uri_links,"outsidePrintableArea":outside,"renderedPages":rendered,"status":"passed"})
(out/"report-quality.json").write_text(json.dumps({"documents":results,"status":"passed"},ensure_ascii=False,indent=2),encoding="utf8")
print(json.dumps({"status":"passed","documents":[{"id":r["id"],"pages":r["pages"]} for r in results]},ensure_ascii=False,indent=2))
