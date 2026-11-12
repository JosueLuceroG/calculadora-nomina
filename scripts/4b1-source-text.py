"""Extracción de evidencia con biblioteca estándar; no es código de aplicación.

Los PDF oficiales de Cámara usan texto literal WinAnsi en sus streams de página.
Se conservan los originales/hash y se registra el alcance limitado del extractor.
"""
import json
import re
import zlib
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "docs" / "evidence" / "4b1"
MANIFEST = json.loads((EVIDENCE / "sources.json").read_text(encoding="utf-8"))
CACHE = Path(MANIFEST["cache"])


class SourceHtml(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.tables = [], []
        self.current, self.row, self.cell = None, None, None
        self.hidden_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.hidden_depth += 1
        if tag == "table" and self.current is None:
            self.current = {"preceding": "".join(self.parts)[-1800:], "rows": []}
        if tag == "tr" and self.current is not None:
            self.row = []
        if tag in ("td", "th") and self.row is not None:
            self.cell = []
        if tag in ("p", "div", "br", "tr", "h1", "h2", "h3"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.hidden_depth = max(0, self.hidden_depth - 1)
        if tag in ("td", "th") and self.cell is not None:
            self.row.append(re.sub(r"\s+", " ", "".join(self.cell)).strip())
            self.cell = None
        if tag == "tr" and self.row is not None:
            self.current["rows"].append(self.row)
            self.row = None
        if tag == "table" and self.current is not None:
            self.tables.append(self.current)
            self.current = None
        if tag in ("p", "div", "tr"):
            self.parts.append("\n")

    def handle_data(self, data):
        if self.hidden_depth:
            return
        self.parts.append(data)
        if self.cell is not None:
            self.cell.append(data)


def literal_strings(stream):
    """Decodifica cadenas PDF literales, escapes y octales; omite fuentes CID."""
    results, i = [], 0
    while i < len(stream):
        if stream[i] != 40:
            i += 1
            continue
        level, out = 1, bytearray()
        i += 1
        while i < len(stream) and level:
            value = stream[i]
            i += 1
            if value == 92:
                if i >= len(stream):
                    break
                escaped = stream[i]
                i += 1
                if 48 <= escaped <= 55:
                    digits = bytes([escaped])
                    for _ in range(2):
                        if i < len(stream) and 48 <= stream[i] <= 55:
                            digits += bytes([stream[i]])
                            i += 1
                        else:
                            break
                    out.append(int(digits, 8) % 256)
                elif escaped not in (10, 13):
                    out.append({110: 10, 114: 13, 116: 9}.get(escaped, escaped))
            elif value == 40:
                level += 1
                out.append(value)
            elif value == 41:
                level -= 1
                if level:
                    out.append(value)
            else:
                out.append(value)
        if out and out.count(0) < len(out) // 4 + 1:
            results.append(out.decode("cp1252", errors="replace"))
    return "".join(results)


for record in MANIFEST["records"]:
    if record.get("status") != 200:
        continue
    path = CACHE / record["cacheFile"]
    if path.suffix == ".html":
        parser = SourceHtml()
        encoding = "latin-1" if "ISO-8859" in record.get("contentType", "") else "utf-8"
        parser.feed(path.read_text(encoding=encoding))
        text = re.sub(r"[ \t\xa0]+", " ", "".join(parser.parts))
        text = re.sub(r"\n\s*\n", "\n", text)
        path.with_suffix(".txt").write_text(text, encoding="utf-8")
        if record["id"] == "isr-dof":
            (CACHE / "isr-tables.json").write_text(json.dumps(parser.tables, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        data = path.read_bytes()
        objects = {int(m[1]): m[2] for m in re.finditer(rb"(?:^|[\r\n])(\d+)\s+\d+\s+obj\b(.*?)endobj", data, re.S)}
        pages = []
        for number, body in objects.items():
            if not re.search(rb"/Type\s*/Page\b", body):
                continue
            ref = re.search(rb"/Contents\s+(\d+)\s+\d+\s+R", body)
            if not ref:
                continue
            content = objects.get(int(ref[1]), b"")
            match = re.search(rb"stream\r?\n(.*?)\r?\n?endstream", content, re.S)
            if not match:
                continue
            raw = match[1]
            if b"/FlateDecode" in content:
                try:
                    raw = zlib.decompress(raw)
                except zlib.error:
                    continue
            pages.append(f"\n=== Página {len(pages) + 1}, objeto {number} ===\n{literal_strings(raw)}")
        text = "\n".join(pages)
        text = re.sub(r"(?=Artículo \d+[.\-]|(?:3\.12\.|11\.4\.|11\.7\.)\d+\.)", "\n", text)
        path.with_suffix(".txt").write_text(text, encoding="utf-8")
    print(f"{record['id']}: evidencia textual en caché; original conservado")
