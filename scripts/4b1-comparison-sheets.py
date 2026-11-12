"""Prepara fichas externas sin simular acceso a CONTPAQi ni SUA."""
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "evidence" / "4b1"
matrix = json.loads((OUT / "matrix-results.json").read_text(encoding="utf-8"))
sources = json.loads((OUT / "sources.json").read_text(encoding="utf-8"))
fields = ["caseId", "system", "date", "periodicity", "grossCandidate", "benefits", "includeImss", "minimumHypothesis", "standardDaysNotActual", "expectedSbcEstimated", "expectedIsrProfile", "expectedWorkerQuotaCalculated", "expectedWorkerQuotaDeducted", "expectedNetProfile", "externalVersion", "externalPaidDays", "externalRegisteredSbc", "monthlyIncomeAccumulated", "priorSubsidyApplied", "externalIsr", "externalWorkerQuota", "externalNet", "difference", "classification", "reason", "status"]
days = {"weekly": "7", "fortnightly": "15", "monthly": "30"}
with (OUT / "external-comparison-sheets.csv").open("w", encoding="utf-8", newline="") as file:
    writer = csv.DictWriter(file, fieldnames=fields)
    writer.writeheader()
    for row in matrix["records"]:
        request = row["request"]
        expected = {item["component"]: item["expected"] for item in row["comparisons"]}
        for system in ("CONTPAQi Nominas", "SUA"):
            writer.writerow({
                "caseId": row["id"], "system": system, "date": request["date"], "periodicity": request["periodicity"],
                "grossCandidate": expected["gross"], "benefits": json.dumps(request["benefits"], ensure_ascii=False),
                "includeImss": str(request["includeImss"]), "minimumHypothesis": str(request["confirmed"]),
                "standardDaysNotActual": days[request["periodicity"]], "expectedSbcEstimated": expected["sbc"],
                "expectedIsrProfile": expected["isrWithheld"], "expectedWorkerQuotaCalculated": expected["imssCalculated"],
                "expectedWorkerQuotaDeducted": expected["imssDeducted"], "expectedNetProfile": expected["net"],
                "classification": "PENDIENTE", "status": "PENDIENTE_SIN_ACCESO_NO_EJECUTADO",
                "reason": "Requiere empresa ficticia, version, conceptos, calendario y acumulados comprobados." if system.startswith("CONTPAQi") else "Comparar solo base/cuota obrera y ramos/periodos equivalentes; no ISR/neto ni cuota patronal. IMSS off no es exencion SUA. RCV bimestral no equivale a 30 dias.",
            })

lines = ["# Registro de fuentes 4B.1", "", "Consultas oficiales realizadas el 16/10/2026. Identidad por SHA-256 de bytes originales; no se equipara una fecha de consulta con fecha de entrada en vigor.", "", "| ID | Consulta UTC | HTTP | SHA-256 | Documento |", "| --- | --- | --- | --- | --- |"]
for row in sources["records"]:
    lines.append(f"| {row['id']} | {row['queriedOn']} | {row.get('status', 'ERROR')} | `{row.get('sha256', 'no disponible')}` | [Fuente]({row['url']}) |")
lines += ["", "Originales completos en caché temporal indicada por sources.json. El proyecto conserva referencias, citas seleccionadas y datos de prueba sintéticos; no incorpora documentos completos con datos ajenos a la prueba.", ""]
(OUT / "sources-index.md").write_text("\n".join(lines), encoding="utf-8")
performance_path = OUT / "native-performance.json"
if performance_path.exists():
    data = json.loads(performance_path.read_text(encoding="utf-8"))
    summary = {"mode": data.get("mode"), "url": data.get("url"), "executableSha256": data["executableSha256"], "environment": data["environment"], "viewport": data.get("viewport"), "coldMs": data["cold"]["elapsedMs"] if data.get("cold") else None, "ordinary": [{"case": item["case"], **item["elapsed"], "maximumFrameGapMs": item["maximumFrameGapMs"], "exactOutcomes": item["exactOutcomes"]} for item in data["ordinary"]], "demanding": [{"elapsedMs": item["elapsedMs"], "frames": item["frames"], "maxFrameGapMs": item["maxFrameGapMs"], "state": item["state"], "nativeProbe": None if not item.get("nativeProbe") else {"responding": item["nativeProbe"]["responding"], "hung": item["nativeProbe"]["hung"], "nativePingMs": item["nativeProbe"]["nativePingMs"]}} for item in data["demanding"]], "cancellation": data.get("cancellationSummary"), "acceptance": data.get("acceptance"), "lifecycle": data["lifecycle"], "errors": data["errors"], "consoleErrors": data["consoleErrors"], "external": data["external"]}
    (OUT / "performance-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
totals = {"matrixFamilies": sorted(set(row["family"] for row in matrix["records"])), "resultRowsIncludingCandidates": len(matrix["records"]), "componentComparisons": sum(len(row["comparisons"]) for row in matrix["records"]), "componentMismatches": sum(not item["matches"] for row in matrix["records"] for item in row["comparisons"]), "statusMismatches": sum(row["expectedStatus"] != row["obtainedStatus"] for row in matrix["records"]), "sheets": len(matrix["records"]) * 2, "externalRunsPerformed": 0, "sources": len(sources["records"]), "v1Closed": False}
(OUT / "validation-summary.json").write_text(json.dumps(totals, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(totals))
