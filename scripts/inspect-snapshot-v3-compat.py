"""CD-1 read-only documentary inspection. Stdlib only; never imports product code.

This is NOT the future TS/Rust validator and does NOT check Ed25519 or issue
native authority. Assertions below are narrow reference controls over evidence.
No write mode, subprocess, network, database access or product calculation.
Run with python -B to avoid bytecode artifacts.
"""
import argparse
import copy
from decimal import Decimal, InvalidOperation
import hashlib
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = "docs/evidence/snapshot-v3-compat/"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate JSON key: " + key)
        result[key] = value
    return result


def parse(text):
    def invalid_number(value):
        raise ValueError("non-finite JSON number: " + value)
    return json.loads(text, object_pairs_hook=unique_object,
                      parse_constant=invalid_number)


def read(path):
    return parse((ROOT / path).read_text(encoding="utf-8"))


def commitment(mapping):
    return sha(json.dumps(mapping, sort_keys=True, separators=(",", ":"),
                          ensure_ascii=True).encode("utf-8"))


def inventory(protected):
    ignored = set(protected["beforeCreateInventory"]["excludedDirectoryNames"])
    new_paths = set(protected["authorizedNewPaths"])
    result = {}
    for base, directories, names in os.walk(ROOT):
        directories[:] = sorted(x for x in directories if x not in ignored)
        for name in sorted(names):
            path = Path(base) / name
            relative = path.relative_to(ROOT).as_posix()
            if relative not in new_paths:
                result[relative] = sha(path.read_bytes())
    require(len(result) == protected["beforeCreateInventory"]["count"],
            "pre-existing inventory count changed")
    require(commitment(result) == protected["beforeCreateInventory"]["sha256"],
            "pre-existing inventory commitment changed; STOP")
    return result


def baseline_check(protected):
    b = protected["historicalBaseline"]
    require(sha((ROOT / b["path"]).read_bytes()) == b["sha256"],
            "historical baseline itself changed")
    old = read(b["path"])["hashes"]
    require(len(old) == b["entries"] == 1939, "unexpected baseline length")
    for path, digest in old.items():
        require((ROOT / path).is_file() and sha((ROOT / path).read_bytes()) == digest,
                "historical file changed: " + path)
    for item in protected["criticalInputs"]:
        data = (ROOT / item["path"]).read_bytes()
        require(len(data) == item["bytes"] and sha(data) == item["sha256"],
                "critical input changed: " + item["path"])
    fd = read("docs/evidence/fd-sd-1a/integrity.json")
    for item in fd["files"]:
        data = (ROOT / item["path"]).read_bytes()
        require(len(data) == item["bytes"] and sha(data) == item["sha256"],
                "FD-SD-1.A input changed: " + item["path"])
    return len(old)


def pointer(value, path):
    if path == "":
        return value
    require(path.startswith("/"), "expected JSON pointer")
    for token in path[1:].split("/"):
        token = token.replace("~1", "/").replace("~0", "~")
        value = value[int(token)] if isinstance(value, list) else value[token]
    return value


def patch(value, operation):
    path = operation["path"]
    parent_path, token = path.rsplit("/", 1)
    parent = pointer(value, parent_path)
    key = token.replace("~1", "/").replace("~0", "~")
    if isinstance(parent, list):
        key = int(key)
    if operation["op"] in ("replace", "remove"):
        require((0 <= key < len(parent)) if isinstance(parent, list) else key in parent,
                "patch target missing: " + path)
    if operation["op"] == "remove":
        del parent[key]
    elif operation["op"] in ("replace", "add"):
        parent[key] = copy.deepcopy(operation["value"])
    else:
        raise ValueError("unknown recipe operation")


def type_name(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, dict):
        return "object"
    if isinstance(value, list):
        return "array"
    if isinstance(value, str):
        return "string"
    return "number"


def shape_differences(value, descriptor, path):
    """Inspect original frozen grammar; no TS/Rust execution or crypto claim."""
    kind = type_name(value)
    if kind not in descriptor["types"]:
        return [{"path": path, "actual": kind, "allowed": descriptor["types"]}]
    result = []
    if isinstance(value, dict):
        properties = descriptor.get("properties", {})
        for key, child in value.items():
            if key not in properties:
                result.append({"path": path + "." + key, "actual": "unknown-key"})
            else:
                result.extend(shape_differences(child, properties[key], path + "." + key))
        for key in descriptor.get("required", []):
            if key not in value:
                result.append({"path": path + "." + key, "actual": "missing-key"})
    if isinstance(value, list):
        if value and not descriptor.get("items"):
            return [{"path": path, "actual": "nonempty-array", "length": len(value)}]
        for index, child in enumerate(value):
            result.extend(shape_differences(child, descriptor["items"],
                                            path + "[" + str(index) + "]"))
    return result


def route(value, decision):
    p = value.get("executionProvenance", {})
    key = [value.get("schemaVersion"), p.get("schemaVersion"), p.get("producerId"),
           p.get("reportContractId"), p.get("presentationContractId")]
    return next((row["route"] for row in decision["dispatchTable"] if row["tuple"] == key),
                "reject")


def outcome(value):
    return value.get("outcome", value)


def reference_class(value, historical=False):
    o = outcome(value)
    r = o["report"]
    p = o["presentation"]
    inverse = r["operation"] == "net-to-gross"
    forward = r.get("recommendedForwardResult") if inverse else r
    forward = forward or {}
    coverage = r.get("coverage", {})
    conditioned = (p.get("confirmation") is not None
                   or forward.get("retention", {}).get("kind") == "conditional-no-withholding-LISR-96"
                   or (inverse and coverage.get("state") == "fiscally-incomplete")
                   or (not historical and bool(coverage.get("fiscalUnresolvedIntervals"))))
    if not historical and (r["status"] != "estimated" or (inverse and r["match"] == "none")):
        return "not-determinable"
    if historical and inverse and coverage["state"] == "limited":
        return "limited"
    if conditioned:
        return "conditioned"
    if inverse and coverage["state"] == "limited":
        return "limited"
    if inverse:
        return {"exact": "exact", "approximate": "approximate"}.get(r["match"], "reject")
    return "estimated" if r.get("complete") and r["status"] == "estimated" else "reject"


def constraint(value, rule, original_dw2):
    """Named local invariants only. Not a full documentary validator."""
    o = outcome(value)
    r = o.get("report", {})
    try:
        if rule == "dw2-outcome-unchanged":
            return o == original_dw2
        if rule == "direct-reconciliation":
            return (r["complete"] and r["reconciliationVerified"]
                    and Decimal(r["gross"]["amount"]) == Decimal(r["net"]["amount"])
                    + Decimal(r["isr"]["withheld"]["amount"]) + Decimal(r["imss"]["deducted"]["amount"]))
        if rule == "candidate-difference":
            c, f = r["recommended"], r["recommendedForwardResult"]
            difference = Decimal(c["net"]) - Decimal(r["targetNet"])
            return (f["status"] == "estimated" and f["complete"] and f["reconciliationVerified"]
                    and c["gross"] == f["gross"]["amount"] and c["net"] == f["net"]["amount"]
                    and difference == Decimal(c["difference"])
                    and abs(difference) == Decimal(c["absoluteDifference"]))
        if rule == "paired-no-candidate":
            return (r["recommended"] is None and r["recommendedForwardResult"] is None
                    and r["match"] == "none" and r["nearestVerifiedBelow"] is None
                    and r["nearestVerifiedAbove"] is None and r["smallestFound"] is None
                    and not r["exactCandidates"])
        if rule == "partial-direct":
            return (r["status"] in ("not-determinable", "not-supported") and not r["complete"]
                    and not r["reconciliationVerified"] and r["net"]["amount"] is None
                    and bool(r["net"].get("reason")))
        if rule == "coverage-guarantees":
            c = r["coverage"]
            complete = c["state"] == "complete"
            exact = r["exactCandidates"]
            return (not (complete and (c["domain"] is None or not c["exactSetComplete"]
                                       or c["pendingIntervals"] or c["fiscalUnresolvedIntervals"]))
                    and not (not complete and c["exactSetComplete"])
                    and not (c["uniquenessProven"] and (not complete or len(exact) != 1))
                    and not (c["noExactMatchProven"] and (not complete or exact))
                    and not (c["minimumProven"] and not exact))
    except (KeyError, TypeError, InvalidOperation):
        return False
    raise ValueError("unknown local constraint: " + rule)


def prepare_case(case, fixtures, dw2, windows, decision):
    if "sourceFile" in case:
        require(sha((ROOT / case["sourceFile"]).read_bytes()) == case["originalSha256"],
                "signed specimen changed")
        return read(case["sourceFile"])
    if "fragment" in case:
        return copy.deepcopy(case["fragment"])
    if case.get("source") == "dw2":
        return copy.deepcopy(dw2)
    if case.get("source") == "overBudget":
        return read("docs/evidence/5d3b3/maximum-v3-plus1.json")["payload"]
    item = next(f for f in fixtures if f["name"] == case["fixture"])
    require(sha(item["payload"].encode("utf-8")) == item["checksum"], "fixture checksum mismatch")
    value = parse(item["payload"])["value"]
    if case.get("newProducer"):
        p = value["executionProvenance"]
        key = decision["dispatchTable"][1]["tuple"]
        p["producerId"], p["reportContractId"], p["presentationContractId"] = key[2:]
    if case.get("dw2Outcome"):
        value["outcome"] = copy.deepcopy(dw2)
        value["capture"] = copy.deepcopy(windows["dw2"]["preflight"]["capture"])
        value["capture"]["form"]["mode"] = "net-to-gross"
        value["capture"]["form"]["amount"] = dw2["report"]["targetNet"]
    if case.get("newProducer"):
        r = value["outcome"]["report"]
        p = r["provenance"]
        value["effectiveContext"]["evaluationObservation"] = {
            "basis": "report-not-attested", "availability": "reported",
            "reportedParameterSetVersions": copy.deepcopy(p.get("parameterSetVersions")),
            "reportedForwardPolicyVersions": copy.deepcopy(p.get("forwardPolicyVersions", p.get("policyVersions"))),
            "reportedDirectEvaluations": r.get("metrics", {}).get("directEvaluations")}
        require(value["documentKind"] == "qa-document-fixture", "recipe must remain fixture")
        a = value["executionProvenance"]["authorizationObservation"]
        require(a["kind"] == "not-issued-qa-fixture" and not a["authorizedOperations"],
                "recipe cannot manufacture authority")
    for op in case.get("patches", []):
        patch(value, op)
    return value


def inspect_cases(corpus, decision, descriptor, dw2, windows):
    fixtures = read(corpus["sources"]["fixtures"])
    observations = []
    for case in corpus["cases"]:
        value = prepare_case(case, fixtures, dw2, windows, decision)
        row = {"id": case["id"], "subject": case["subject"],
               "futureExpectationOnly": case["expectedFuture"]}
        if isinstance(value, str):
            size = len(value.encode("utf-8"))
            require(size == case["expectedDocumentBytes"] > 3145728, "N+1 size mismatch")
            row["observedDocumentBytes"] = size
            observations.append(row)
            continue
        if "expectedDispatch" in case:
            selected = route(value, decision)
            require(selected == case["expectedDispatch"], "dispatch reference mismatch " + case["id"])
            row["referenceDispatch"] = selected
        differences = []
        shape_inspected = False
        if "outcome" in value:
            shape_inspected = True
            for key, label in [("capture", "capture"), ("execution", "execution"),
                               ("outcome", "outcome")]:
                differences.extend(shape_differences(value[key], descriptor[key], label))
            for key, label in [("packageEnvelope", "package"), ("trustHeadEnvelope", "head")]:
                differences.extend(shape_differences(value["fiscalEvidence"][key], descriptor[label], label))
        elif case.get("source") == "dw2":
            shape_inspected = True
            differences = shape_differences(value, descriptor["outcome"], "outcome")
        elif case["subject"] == "original-signed-head":
            shape_inspected = True
            differences = shape_differences(value, descriptor["head"], "head")
        paths = [x["path"] for x in differences]
        if "expectedHistoricalShapeFailures" in case:
            require(paths == case["expectedHistoricalShapeFailures"], "frozen shape diagnosis mismatch " + case["id"])
        if "expectedHistoricalShapeFailure" in case:
            require(case["expectedHistoricalShapeFailure"] in paths, "missing shape rejection " + case["id"])
        row["frozenShapeInspection"] = differences if shape_inspected else None
        row["structuralScope"] = ("frozen grammar only, not crypto/full validator"
                                  if shape_inspected else "not inspected as full wire; branch fragment only")
        if row.get("referenceDispatch") == "historical-v3" and differences:
            row["referenceConclusion"] = "reject-historical-no-fallback"
        for assertion in case.get("assertions", []):
            if "rule" in assertion:
                actual = constraint(value, assertion["rule"], dw2)
                require(actual == assertion["expected"], "local invariant mismatch " + case["id"] + ":" + assertion["rule"])
            else:
                actual = pointer(value, assertion["path"])
                require(actual == assertion["equals"] if "equals" in assertion else len(actual) == assertion["length"],
                        "pointer assertion mismatch " + case["id"])
        if "expectedIndex" in case:
            historical = case["subject"] == "historical-document"
            actual = reference_class(value, historical)
            require(actual == case["expectedIndex"], "classification reference mismatch " + case["id"])
            row["referenceClassification"] = actual
        observations.append(row)
    for c in corpus["classificationControls"]:
        inverse = c["operation"] == "net-to-gross"
        r = {"operation": c["operation"], "status": c["status"], "complete": c.get("complete", False)}
        if inverse:
            r.update(match=c["match"], coverage={"state": c["coverage"]})
        o = {"report": r, "presentation": {"confirmation": {} if c["conditioned"] else None}}
        require(reference_class(o) == c["expected"], "combined classification " + c["id"])
    for c in corpus["dispatchControls"]:
        key = c["tuple"]
        v = {"schemaVersion": key[0], "executionProvenance": dict(zip(
            ["schemaVersion", "producerId", "reportContractId", "presentationContractId"], key[1:]))}
        require(route(v, decision) == c["expected"], "dispatch table control " + c["id"])
    return observations


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pending-integrity", action="store_true",
                        help="Initial inspection before integrity.json is materialized; no writes")
    args = parser.parse_args()
    protected = read(EVIDENCE + "protected-inputs.json")
    checked = baseline_check(protected)
    before = inventory(protected)
    decision = read(EVIDENCE + "contract-decision.json")
    matrix = read(EVIDENCE + "variant-matrix.json")
    require(len({x["id"] for x in matrix["rows"]}) == len(matrix["rows"]), "duplicate variant id")
    for item in matrix["rows"]:
        require(all(key in item for key in ["variant", "domain", "execution", "historical", "firstGuard",
                    "additionalGuards", "requiredNewShape", "semantics", "evidence", "positive", "negative"]),
                "incomplete variant matrix")
    corpus = read(EVIDENCE + "documentary-cases.json")
    require(len({x["id"] for x in corpus["cases"]}) == len(corpus["cases"]), "duplicate case id")
    dw = read(corpus["sources"]["dw2"])
    windows = read(corpus["sources"]["windows"])
    descriptor = read("src/features/documents/frozen-shape-v3.json")
    diagnosis = read(EVIDENCE + "dw2-diagnosis.json")
    require(sha((ROOT / diagnosis["source"]).read_bytes()) == diagnosis["sourceSha256"], "D-W2 changed")
    observed = windows["dw2"]
    require(observed["nativeFinalization"]["rejected"] == "DOCUMENT_NOT_REPRESENTABLE"
            and observed["salaryRowsBefore"] == observed["salaryRowsAfter"] == 0, "historical D-W2 observation mismatch")
    require(len(dw["report"]["coverage"]["evidence"]) == 1903, "D-W2 evidence count mismatch")
    require(dw["report"]["metrics"]["directEvaluations"] == 1894
            and dw["report"]["provenance"]["certificationAvailable"] is False, "D-W2 metrics mismatch")
    # Textual guard provenance, without executing any product validator.
    ts = (ROOT / "src/features/documents/provenance-v3.ts").read_text(encoding="utf-8")
    rs = (ROOT / "src-tauri/src/storage/validation.rs").read_text(encoding="utf-8")
    constructor = (ROOT / "src-tauri/src/fiscal_execution/document.rs").read_text(encoding="utf-8")
    require("s.outcome.report.status!=='estimated'" in ts
            and 'report["status"] != "estimated"' in rs
            and 'fail("DOCUMENT_NOT_REPRESENTABLE")' in constructor,
            "documented historical status/error guards changed")
    require(dw["report"]["status"] != "estimated", "D-W2 no longer demonstrates semantic barrier")
    # All six approved historical fixtures retain their original reference label.
    legacy_labels = {"direct-manual": "estimated", "direct-imss-off-auto": "estimated",
                     "inverse-exact": "exact", "inverse-approximate": "approximate",
                     "inverse-limited": "limited", "direct-conditioned": "conditioned"}
    legacy_controls = read(corpus["sources"]["fixtures"])
    require(len(legacy_controls) == len(legacy_labels), "historical fixture inventory changed")
    for item in legacy_controls:
        require(sha(item["payload"].encode("utf-8")) == item["checksum"], "legacy fixture checksum changed")
        v = parse(item["payload"])["value"]
        require(route(v, decision) == "historical-v3", "legacy fixture route changed")
        require(reference_class(v, historical=True) == legacy_labels[item["name"]], "legacy label changed")
    cases = inspect_cases(corpus, decision, descriptor, dw, windows)
    sql = (ROOT / "src-tauri/src/storage/migrations/004.sql").read_text(encoding="utf-8")
    for literal in ["classification TEXT NOT NULL", "gross TEXT, net TEXT", "CHECK(snapshot_version IN (1,2,3))", "3145728"]:
        require(literal in sql, "SQL004 constraint changed")
    new_ids = decision["dispatchTable"][1]["tuple"][2:]
    collisions = []
    for path in before:
        if path.startswith(("src/", "src-tauri/", "crates/")) and Path(path).suffix in (".rs", ".ts", ".tsx", ".json"):
            text = (ROOT / path).read_text(encoding="utf-8")
            if any(identifier in text for identifier in new_ids):
                collisions.append(path)
    require(not collisions, "new identifier collision in product")
    integrity_checked = False
    if not args.pending_integrity:
        manifest = read(EVIDENCE + "integrity.json")
        expected = set(protected["authorizedNewPaths"]) - {EVIDENCE + "integrity.json"}
        require({i["path"] for i in manifest["files"]} == expected, "integrity inventory incomplete")
        for entry in manifest["files"]:
            data = (ROOT / entry["path"]).read_bytes()
            require(sha(data) == entry["sha256"] and len(data) == entry["bytes"], "CD-1 hash mismatch: " + entry["path"])
        require(all((ROOT / p).is_file() for p in protected["authorizedNewPaths"]), "missing deliverable")
        integrity_checked = True
    # No check can modify evidence; this repeat detects concurrent changes too.
    require(inventory(protected) == before, "concurrent existing-file change")
    print(json.dumps({"inspection": "passed", "scope": "read-only documentary controls, not future validator tests",
        "historicalBaselineFiles": checked, "existingWorkspaceFilesUnchanged": len(before),
        "matrixRows": len(matrix["rows"]), "documentaryCases": len(cases),
        "classificationReferenceControls": len(corpus["classificationControls"]),
        "historicalClassificationReferenceControls": len(legacy_controls),
        "dispatchReferenceControls": len(corpus["dispatchControls"]),
        "productIdentifierCollisions": collisions, "newValidatorExecuted": False,
        "cryptoOrMotorExecuted": False, "windowsExecuted": False,
        "integrityManifestChecked": integrity_checked,
        "caseObservations": cases}, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, StopIteration) as error:
        print(json.dumps({"inspection": "FAILED", "error": str(error)}, ensure_ascii=True))
        sys.exit(1)
