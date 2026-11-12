"""Oráculo racional independiente M01–M12. Solo biblioteca estándar Python.

No lee módulos/JSON fiscales ni esperados antiguos. Tarifas extraídas del DOF
recién descargado, cotejadas con el PDF SAT. Parámetros transcritos de fuentes
primarias; 7/15/30 y half-up por ramo son políticas del perfil, no homologación.
"""
import csv
import io
import json
import re
from fractions import Fraction as F
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "evidence" / "4b1"
SOURCES = json.loads((OUT / "sources.json").read_text(encoding="utf-8"))
CACHE = Path(SOURCES["cache"])
TABLES = json.loads((CACHE / "isr-tables.json").read_text(encoding="utf-8"))
SAT = re.sub(r"\s+", " ", (CACHE / "isr-sat.txt").read_text(encoding="utf-8").replace("es-ES", " "))


def amount(value, places=2):
    value = F(value)
    negative = value < 0
    value = abs(value)
    scale = 10 ** places
    units = (2 * value.numerator * scale + value.denominator) // (2 * value.denominator)
    return ("-" if negative and units else "") + f"{units // scale}.{units % scale:0{places}d}"


tariffs, tariff_proof = {}, []
for period, first_upper, heading in [("weekly", "194.46", "periodo de 7 días"), ("fortnightly", "416.70", "periodo de 15 días"), ("monthly", "844.59", "pagos provisionales mensuales")]:
    for index, table in enumerate(TABLES):
        rows = table["rows"]
        if len(rows) != 13 or len(rows[2]) != 4 or rows[2][:2] != ["0.01", first_upper]:
            continue
        # Selecciona la sección de retenciones art. 96, no actividad empresarial.
        context = re.sub(r"\s+", " ", table["preceding"])[-720:]
        if heading not in context or "artículos 96" not in context:
            continue
        entries = []
        for row in rows[2:]:
            lower, upper, fee, rate = row
            sequence = " ".join(row)
            assert sequence in SAT, f"Fila DOF no cotejada contra SAT: {sequence}"
            entries.append({"lower": lower.replace(",", ""), "upper": None if "adelante" in upper else upper.replace(",", ""), "fixedFee": fee.replace(",", ""), "ratePercent": rate})
        tariffs[period] = entries
        tariff_proof.append({"periodicity": period, "dofTableIndex": index, "context": context, "rowsCheckedAgainstSatPdf": len(entries)})
        break
    assert period in tariffs, f"No se identificó inequívocamente la tarifa {period}"

DAYS = {"weekly": 7, "fortnightly": 15, "monthly": 30}
RATES = {"pensioner-medical": F(3, 800), "cash-benefits": F(1, 400), "disability-life": F(1, 160), "unemployment-old-age": F(9, 800), "excess-medical": F(1, 250)}
P0 = {"annualBonusDays": "15", "annualVacationDays": "12", "vacationPremiumPercent": "25"}
P1 = {"annualBonusDays": "30", "annualVacationDays": "20", "vacationPremiumPercent": "50"}


def reference(gross, period="monthly", date="2026-02-01", benefits=None, imss=True, confirmed=False):
    b = benefits or P0
    gross, days = F(gross), DAYS[period]
    january = date < "2026-02-01"
    daily = gross / days
    bonus, vacations, premium = (F(b[key]) for key in ("annualBonusDays", "annualVacationDays", "vacationPremiumPercent"))
    benefit_days = bonus + vacations * premium / 100
    factor = 1 + benefit_days / 365
    sdi = daily * factor
    uma, monthly_uma, subsidy_rate = (F("113.14"), F("3439.46"), F("0.1559")) if january else (F("117.31"), F("3566.22"), F("0.1502"))
    sbc = F(amount(min(max(sdi, F("315.04")), uma * 25)))
    tariff = next(row for row in tariffs[period] if gross >= F(row["lower"]) and (row["upper"] is None or gross <= F(row["upper"])))
    tax = F(amount(F(tariff["fixedFee"]) + (gross - F(tariff["lower"])) * F(tariff["ratePercent"]) / 100))
    theoretical = monthly_uma * subsidy_rate
    subsidy = F(amount((theoretical if period == "monthly" else min(theoretical, theoretical * days / F("30.4"))) if gross * 30 <= F("11492.66") * days else 0))
    potential = min(tax, subsidy)
    below, minimum = daily < F("315.04"), daily == F("315.04")
    unresolved = below or (minimum and not confirmed)
    applied = None if unresolved else F(0) if minimum else potential
    withheld = None if unresolved else F(0) if minimum else tax - potential
    branches = {}
    for name, rate in RATES.items():
        base = max(sbc - uma * 3, 0) if name == "excess-medical" else sbc
        calculated = F(amount(base * rate * days))
        branches[name] = {"calculated": None if below else amount(calculated), "deducted": None if below else amount(calculated if imss and not minimum else 0), "absorbed": None if below else amount(calculated if minimum else 0), "excluded": None if below else amount(calculated if not imss and not minimum else 0)}
    totals = {key: None if below else amount(sum(F(values[key]) for values in branches.values())) for key in ("calculated", "deducted", "absorbed", "excluded")}
    components = {
        "gross": amount(gross), "daily": amount(daily), "factor4": amount(factor, 4), "benefitDays": amount(benefit_days), "sdi": amount(sdi), "sbc": amount(sbc),
        "isrTariff": amount(tax), "isrProvisional": amount(tax - potential), "isrWithheld": None if withheld is None else amount(withheld),
        "subsidyDetermined": amount(subsidy), "subsidyPotential": amount(potential), "subsidyApplied": None if applied is None else amount(applied),
        "subsidyDisplaced": None if unresolved else amount(potential if minimum else 0), "subsidyExcess": amount(subsidy - potential),
        "subsidyTotalUnused": None if unresolved else amount(subsidy - applied), "subsidyCash": "0.00",
        **{f"imss{name.title()}": value for name, value in totals.items()},
        "net": None if unresolved else amount(gross - withheld - F(totals["deducted"])),
    }
    for name, values in branches.items():
        for allocation, value in values.items():
            components[f"branch.{name}.{allocation}"] = value
    return {"status": "not-supported" if below else "not-determinable" if unresolved else "estimated", "components": components, "rationalFactor": f"{factor.numerator}/{factor.denominator}", "umaDaily": amount(uma), "umaMonthly": amount(monthly_uma), "subsidyRate": str(subsidy_rate), "sbcCeiling": amount(uma * 25), "tariffRow": tariff}


direct = []


def add(case_id, gross, **settings):
    request = {"gross": gross, "periodicity": "monthly", "date": "2026-02-01", "benefits": P0, "includeImss": True, "confirmed": False}
    request.update(settings)
    expected = reference(gross, request["periodicity"], request["date"], request["benefits"], request["includeImss"], request["confirmed"])
    direct.append({"id": case_id, "family": case_id.split("-")[0], "request": request, "expected": expected})


add("M01-on", "15000.00")
add("M01-off", "15000.00", includeImss=False)
add("M02-week", "3500.00", periodicity="weekly")
add("M02-fortnight", "7500.00", periodicity="fortnightly")
add("M03-january", "10000.00", date="2026-01-31")
add("M03-february", "10000.00")
add("M04-P0", "30000.00")
add("M04-P1", "30000.00", benefits=P1)
add("M05-below-on", "9451.19")
add("M05-below-off", "9451.19", includeImss=False)
add("M05-unconfirmed", "9451.20")
add("M05-confirmed", "9451.20", confirmed=True)
add("M05-above", "9451.21")
add("M05-published-monthly-reference", "9582.47")
add("M06-january", "100000.00", date="2026-01-31")
add("M06-february", "100000.00")
add("M07-eligible", "11492.66")
add("M07-ineligible", "11492.67")
add("M08-lower-row", "6216.15", periodicity="fortnightly")
add("M08-upper-row", "6216.16", periodicity="fortnightly")

inverse = []


def add_inverse(case_id, target, period, windows, include_imss=True, confirmed=False, domain=None):
    candidates, points = [], []
    for first, last in windows:
        for cents in range(int(F(first) * 100), int(F(last) * 100) + 1):
            gross = amount(F(cents, 100))
            result = reference(gross, period, imss=include_imss, confirmed=confirmed)
            if result["components"]["net"] is None:
                continue
            difference = F(result["components"]["net"]) - F(target)
            point = {"gross": gross, "net": result["components"]["net"], "difference": amount(difference), "expectedForward": result}
            points.append(point)
            if difference == 0:
                candidates.append(point)
    unique = {item["gross"]: item for item in candidates}
    candidates = sorted(unique.values(), key=lambda item: F(item["gross"]))
    nearest = min(points, key=lambda item: (abs(F(item["difference"])), F(item["gross"])))
    inverse.append({"id": case_id, "family": case_id.split("-")[0], "request": {"targetNet": target, "periodicity": period, "date": "2026-02-01", "benefits": P0, "includeImss": include_imss, "confirmed": confirmed, "domain": domain}, "referenceWindows": windows, "independentCoverage": "exhaustive-only-in-listed-windows-not-global-proof", "expectedCandidates": candidates, "expectedNearest": nearest if domain else None})


add_inverse("M09-week", "3076.67", "weekly", [("3498.00", "3502.00")])
add_inverse("M09-month", "10500.00", "monthly", [("11092.00", "11094.00"), ("11713.00", "11716.00")])
add_inverse("M10-on", "13202.64", "monthly", [("14999.00", "15001.00")])
add_inverse("M10-off", "13597.18", "monthly", [("14999.00", "15001.00")], include_imss=False)
add_inverse("M11-unconfirmed", "9451.20", "monthly", [("9451.20", "9451.21"), ("9876.00", "9879.00")])
add_inverse("M11-confirmed", "9451.20", "monthly", [("9451.20", "9451.21"), ("9876.00", "9879.00")], confirmed=True)
add_inverse("M12-approximate", "5557.04", "fortnightly", [("6216.15", "6216.16")], domain={"from": "6216.15", "to": "6216.16"})

# Resumen normativo reproducible con citas limitadas, no documentos completos.
citations = []
for name, articles in [("lss", [25, 27, 28, 29, 36, 106, 107, 147, 168]), ("lisr", [96]), ("lft", [76, 80, 85, 87, 90])]:
    text = (CACHE / f"{name}.txt").read_text(encoding="utf-8").replace("es-ES", " ").replace("x-none", " ")
    text = re.sub(r"\s+", " ", text)
    for article in articles:
        match = re.search(rf"Artículo {article}[.\-].*?(?=Artículo {article + 1}[.\-])", text)
        if not match:
            match = re.search(rf"Artículo {article}[.\-].{{0,1800}}", text)
        assert match, f"No se extrajo {name} {article}"
        citations.append({"source": name, "article": article, "excerpt": match[0][:2600]})

for name, pattern, label in [
    ("lss", r"DECIMO NOVENO\..*?(?=VIGESIMO\.)", "Transitorio XIX, reducción obrera 2% - 10 × 0.16 puntos = 0.40%"),
    ("minimum-2026", r"CUARTO\.- Para expresar los salarios mínimos.*?(?=QUINTO\.-)", "Resolutivo cuarto, referencia mensual"),
    ("sat-anticipated-4th-oct15", r"PRIMERO\. Se reforma.*?para quedar de la siguiente manera:", "Anticipada 15/10/2026: alcance de reglas modificadas"),
    ("sat-annex7-oct2", r"60/ISR/N Empacadores.*?deducibles para los efectos del ISR\.", "Anexo 7, criterio de aguacate: fuera del perfil salarial"),
    ("sat-rmf-base", r"3\.12\.2\. Para los efectos.*?LISR 96, RLISR 175", "RMF 3.12.2: opción de tarifas por periodo"),
    ("racerf", r"Artículo 125\..*?accesorios que se pudieran generar\.", "RACERF 125: conciliación de importes parciales y total; no certificación del orden half-up del simulador"),
]:
    text = re.sub(r"\s+", " ", (CACHE / f"{name}.txt").read_text(encoding="utf-8").replace("es-ES", " "))
    match = re.search(pattern, text)
    assert match, f"No se encontró cita complementaria: {name}"
    citations.append({"source": name, "locator": label, "excerpt": match[0][:2600]})

delta = []
for name in ["sidof-13", "sidof-14", "sidof-15", "sidof-cutoff"]:
    html = (CACHE / f"{name}.html").read_text(encoding="utf-8")
    date = re.search(r'id="fechaPub"\s+value="([^"]+)"', html)
    seen, relevant = set(), []
    for match in re.finditer(r'<a\b[^>]*href=["\']/notas/(\d+)["\'][^>]*>(.*?)</a>', html, re.S):
        title = re.sub(r"<[^>]+>", " ", match[2])
        title = re.sub(r"\s+", " ", title).strip()
        if re.search(r"salario.? m.nimo|subsidio.*empleo|unidad de medida|miscel.nea fiscal|seguro social|impuesto sobre la renta|ley federal del trabajo", title, re.I) and match[1] not in seen:
            relevant.append({"id": match[1], "title": title})
            seen.add(match[1])
    delta.append({"source": name, "dateReportedByPage": date[1] if date else None, "potentiallyRelevantTitles": relevant})

fixture = {"method": "Python Fraction exact; fresh DOF HTML and independent SAT PDF cross-check; no production imports", "sourceCutoff": "2026-10-16", "sources": [{"id": row["id"], "url": row["url"], "sha256": row.get("sha256")} for row in SOURCES["records"]], "tariffs": tariffs, "tariffProof": tariff_proof, "profilePolicies": {"days": DAYS, "integrationDivisor": "365", "rounding": "half-up after each branch/period; estimated SBC to cents", "minimumDaily": "315.04", "minimumThirtyDays": "9451.20", "minimumPublishedMonthly": "9582.47"}, "direct": direct, "inverse": inverse}
path = ROOT / "src" / "tests" / "fixtures" / "operational-4b1.expected.json"
path.write_text(json.dumps(fixture, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(OUT / "source-verification.json").write_text(json.dumps({"tariffProof": tariff_proof, "legalExcerpts": citations, "deltaEditions": delta, "extractorLimitation": "Literal text from unencrypted official PDFs, WinAnsi, no OCR/CID general support; originals and hashes retained in temporary cache."}, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"directScenarios": len(direct), "inverseScenarios": len(inverse), "tariffRowsChecked": sum(len(rows) for rows in tariffs.values()), "deltaEditions": delta, "expectedFile": str(path)}, ensure_ascii=True, indent=2))
