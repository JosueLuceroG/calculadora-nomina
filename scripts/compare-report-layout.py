import os,sys,json,re,hashlib
from pathlib import Path
sys.path.insert(0,os.environ.get("PDF_VERIFICATION_TOOLS",str(Path(os.environ["TEMP"])/"opencode"/"pdf-verification")))
from pypdf import PdfReader
import pypdfium2 as pdfium
from PIL import Image,ImageOps,ImageDraw
root=Path(__file__).resolve().parent.parent
out=root/"docs/evidence/5b11-1"
def inspect(path,target):
    reader=PdfReader(path,strict=True);texts=[re.sub(r"\s+"," ",p.extract_text()) for p in reader.pages]
    amounts={label:re.search(re.escape(label)+r"\s+\$\s*([\d,]+\.\d{2})"," ".join(texts)).group(1) for label in ["Salario bruto","ISR retenido","IMSS efectivamente descontado","Salario neto estimado"]}
    uris=[str(a.get_object()["/A"]["/URI"]) for p in reader.pages for a in p.get("/Annots",[]) if a.get_object().get("/A",{}).get("/S")=="/URI"]
    target.mkdir(parents=True,exist_ok=True);pdf=pdfium.PdfDocument(path);images=[];space=[]
    for i in range(len(pdf)):
        page=pdf[i];tp=page.get_textpage();bottom=78
        for j in range(tp.count_chars()):
            if not tp.get_text_range(index=j,count=1).strip():continue
            x0,y0,x1,y1=tp.get_charbox(j);top,b=792-y1,792-y0
            if 42-1<=x0 and x1<=570+1 and 78<=top and b<=730:bottom=max(bottom,b)
        space.append({"page":i+1,"lastBodyTextY":round(bottom,2),"freeBelowBodyTextPt":round(730-bottom,2)})
        bitmap=page.render(scale=1.5);image=bitmap.to_pil().convert("RGB");image.save(target/f"pagina-{i+1:02d}.png");images.append(ImageOps.contain(image,(306,396)))
        tp.close();bitmap.close();page.close()
    pdf.close()
    return {"path":str(path),"pages":len(reader.pages),"sha256":hashlib.sha256(path.read_bytes()).hexdigest(),"uriLinks":len(uris),"uriTargets":uris,"amounts":amounts,"space":space},images
results=[]
for before_name,after_name in [("embedded-calcular.pdf","embedded-calcular.pdf"),("embedded-historial.pdf","embedded-historial.pdf"),("native-alternativas.pdf","embedded-alternativas.pdf")]:
    before,old=inspect(out/"anterior"/before_name,out/"anterior/renderizados"/before_name.removesuffix(".pdf"))
    after,new=inspect(out/after_name,out/"renderizados"/after_name.removesuffix(".pdf"))
    assert before["amounts"]==after["amounts"]
    assert before["uriLinks"]==0 and after["uriLinks"]==10
    width=326*max(len(old),len(new));canvas=Image.new("RGB",(width,868),"#e3e8e5");draw=ImageDraw.Draw(canvas)
    for row,images,label in [(0,old,"5B.11 - anterior"),(1,new,"5B.11.1 - refinado")]:
        draw.text((12,row*434+6),label,fill="black")
        for i,image in enumerate(images):canvas.paste(image,(i*326+10,row*434+25))
    comparison=out/f"comparacion-{after_name.removesuffix('.pdf')}.png";canvas.save(comparison)
    results.append({"before":before,"after":after,"monetaryDifferences":[],"comparison":str(comparison)})
(out/"comparison.json").write_text(json.dumps({"status":"passed","documents":results},ensure_ascii=False,indent=2),encoding="utf8")
print(json.dumps({"status":"passed","comparisons":[{"file":r["after"]["path"],"beforePages":r["before"]["pages"],"afterPages":r["after"]["pages"],"uriLinks":r["after"]["uriLinks"],"monetaryDifferences":r["monetaryDifferences"]} for r in results]},ensure_ascii=True,indent=2))
