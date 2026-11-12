import sys, os, json, hashlib
from pathlib import Path
sys.path.insert(0, os.environ.get("PDF_VERIFICATION_TOOLS", str(Path(os.environ["TEMP"]) / "opencode" / "pdf-verification")))
from fontTools.ttLib import TTFont
root=Path(__file__).resolve().parent.parent
corpus="áéíóú ÁÉÍÓÚ ñ Ñ $ 25% 1,234,567,890.01 — – − ≤ ≥ ≈ → •"
rows=[]
for name in ["DejaVuSans.ttf","DejaVuSans-Bold.ttf"]:
    path=root/"src/features/pdf/assets"/name
    font=TTFont(path); cmap=font.getBestCmap()
    missing=[f"U+{ord(c):04X}" for c in set(corpus) if ord(c) not in cmap]
    rows.append({"name":name,"sha256":hashlib.sha256(path.read_bytes()).hexdigest(),"fontVersion":font["name"].getDebugName(5),"fsType":font["OS/2"].fsType,"missingGlyphs":missing})
    assert not missing,(name,missing)
    assert font["OS/2"].fsType==0,"La fuente debe permitir incrustación"
print(json.dumps(rows,ensure_ascii=False,indent=2))
