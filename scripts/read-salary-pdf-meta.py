import sys,os,json
from pathlib import Path
from datetime import timezone
sys.path.insert(0,os.environ.get("PDF_VERIFICATION_TOOLS",str(Path(os.environ["TEMP"])/"opencode"/"pdf-verification")))
from pypdf import PdfReader
p=PdfReader(sys.argv[1],strict=True)
print(json.dumps({"pages":len(p.pages),"createdAt":p.metadata.creation_date.astimezone(timezone.utc).isoformat().replace("+00:00","Z"),"title":p.metadata.title,"textPages":[page.extract_text() for page in p.pages]},ensure_ascii=True))
