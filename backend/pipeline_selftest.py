"""Pipeline + route self-test.

Run:  python -m backend.pipeline_selftest
(no test framework, no fixtures — prints what a reviewer needs to see)

Stage 1 — direct pipeline run on the clean and forged demo variants.
   The forged variant must flag every mutation declared in MUTATIONS, and the
   clean variant must not flag a single rule or kneel confusion (i.e., no
   finding other than the informational CONS_VERIFIED summary).

Stage 2 — full HTTP round trip through TestClient, exercising /health,
   /demo/manifest, /demo/pdf, /analyze, /review, /reviews.
   Also asserts that the SECOND /analyze call hits the cache (mode == 'cache')
   and that officer review state survives the cached path.
"""
from __future__ import annotations

import base64
import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from shared.contracts import Finding

from backend import db
from backend import synth
from backend.consistency import consistency_verified_finding, evaluate_consistency
from backend.extract import ExtractionResult, extract as extract_fields
from backend.forensics import evaluate_forensics
from backend.rules import evaluate_rules


def _load_variant(variant: str) -> dict[str, bytes]:
    out = {}
    for doc_type in ("part1", "land", "faculty"):
        out[doc_type] = (synth.OUT_DIR / variant / f"{doc_type}.pdf").read_bytes()
    return out


def _extraction(doc_bytes: dict[str, bytes]) -> ExtractionResult:
    fields, locs = {}, {}
    for doc_type, raw in doc_bytes.items():
        result = extract_fields(raw, doc_type)
        fields[doc_type] = result.fields
        locs[doc_type] = result.locs
    return ExtractionResult(fields=fields, locs=locs, mode="text")


def _run_pipeline(doc_bytes: dict[str, bytes]) -> list[Finding]:
    ex = _extraction(doc_bytes)
    cons = evaluate_consistency(ex)
    findings: list[Finding] = list(cons.findings)
    rule_findings, _ids = evaluate_rules(ex)
    findings.extend(rule_findings)
    findings.extend(evaluate_forensics(ex, doc_bytes))
    if verified := consistency_verified_finding(cons):
        findings.append(verified)
    return findings


def stage1() -> list[str]:
    synth.build(force=True)
    problems: list[str] = []

    for variant in ("clean", "forged"):
        findings = _run_pipeline(_load_variant(variant))
        got = {f.id for f in findings}
        print(f"    {variant}: {len(findings)} finding(s)")
        for f in sorted(findings, key=lambda x: x.id):
            print(f"      {f.severity.value:8s} {f.id:30s} {f.title}")

        clean = variant == "clean"
        for f in findings:
            if clean and f.id != "CONS_VERIFIED":
                problems.append(f"STAGE1 FAIL clean set must not flag: {f.id}")
            if not clean and f.id == "CONS_VERIFIED":
                problems.append("STAGE1 FAIL forged set must not print 'all consistent'")
        if not clean:
            expected = {m["expect"] for m in synth.MUTATIONS}
            missing = expected - got
            if missing:
                problems.append(
                    f"STAGE1 FAIL forged variant missing findings for labeled mutations: "
                    f"{sorted(missing)} (got {sorted(got)})"
                )
    return problems


def stage2() -> list[str]:
    from fastapi.testclient import TestClient

    from backend.main import app

    db.review_clear_all()
    db.cache_clear_all()  # derived state: makes "first analyze is live" deterministic
    problems: list[str] = []

    with TestClient(app) as client, TemporaryDirectory() as tmp:
        r = client.get("/health")
        if r.status_code != 200:
            problems.append(f"STAGE2 FAIL /health {r.status_code}: {r.text[:200]}")
        else:
            print("    /health:", json.dumps(r.json())[:220])

        r = client.get("/demo/manifest?variant=forged")
        if r.status_code != 200:
            problems.append(f"STAGE2 FAIL /demo/manifest {r.status_code}")
        else:
            data = r.json()
            rm = {doc: info["bytes"] for doc, info in data["docs"].items()}
            print("    /demo/manifest forged:", rm)

        r = client.get("/demo/pdf/land?variant=forged")
        if r.status_code != 200 or r.headers.get("content-type") != "application/pdf" or len(r.content) < 2000:
            problems.append(f"STAGE2 FAIL /demo/pdf/land returned {r.status_code} bytes={len(r.content)}")
        else:
            print(f"    /demo/pdf/land: {len(r.content)} bytes pdf")

        # --- /analyze on the forged variant ---
        files = []
        for doc_type in ("part1", "land", "faculty"):
            files.append(base64.b64encode((synth.OUT_DIR / "forged" / f"{doc_type}.pdf").read_bytes()).decode())
        payload = {"files": files, "doc_types": ["part1", "land", "faculty"], "mock": False}
        r = client.post("/analyze", json=payload)
        if r.status_code != 200:
            problems.append(f"STAGE2 FAIL /analyze {r.status_code}: {r.text[:300]}")
        else:
            body = r.json()
            print("    /analyze (mode=%s): %d findings in %d ms"
                  % (body.get("mode"), len(body.get("findings", [])), body.get("processing_time_ms", 0)))
            if body.get("mode") != "live":
                problems.append("STAGE2 FAIL first analyze must be mode 'live'")
            if len(body.get("findings", [])) == 0:
                problems.append("STAGE2 FAIL live forged analysis must produce findings")
            if "extracted" not in body:
                problems.append("STAGE2 FAIL analyze response missing 'extracted'")

        # --- officer review + cache restore ---
        r = client.post("/review", json={"finding_id": "CONS_NAME", "action": "override", "note": "legal name confirmed with sub-registrar"})
        if r.status_code != 200 or not r.json().get("ok"):
            problems.append(f"STAGE2 FAIL /review {r.status_code}: {r.text[:200]}")
        else:
            print("    /review:", json.dumps(r.json().get("review", {}))[:200])

        r = client.post("/analyze", json=payload)
        if r.status_code != 200:
            problems.append(f"STAGE2 FAIL /analyze cached {r.status_code}")
        else:
            body = r.json()
            if body.get("mode") != "cache":
                problems.append(f"STAGE2 FAIL second analyze expected mode 'cache', got {body.get('mode')!r}")
            if body.get("processing_time_ms", 999) > 40:
                problems.append(f"STAGE2 FAIL cached analyze took {body.get('processing_time_ms')} ms")
            st = next((f.get("status") for f in body.get("findings", []) if f["id"] == "CONS_NAME"), None)
            if st != "override":
                problems.append(f"STAGE2 FAIL cached response must restore officer status: got {st!r}")
            print(f"    /analyze cached: {len(body.get('findings', []))} findings, CONS_NAME.status={st!r}")

        r = client.get("/reviews")
        if r.status_code != 200 or "CONS_NAME" not in (r.json().get("reviews") or {}):
            problems.append(f"STAGE2 FAIL /reviews after POST: missing CONS_NAME record")
        else:
            print("    /reviews:", json.dumps(r.json())[:260])

        r = client.delete("/reviews")
        if r.status_code != 200 or not r.json().get("ok"):
            problems.append(f"STAGE2 FAIL DELETE /reviews {r.status_code}")
        else:
            print("    DELETE /reviews: ok")
    return problems


def main() -> None:
    print("\n== STAGE 1: pipeline on synthetic variants ==")
    p1 = stage1()
    print("\n== STAGE 2: HTTP routes via TestClient ==")
    p2 = stage2()
    problems = p1 + p2
    if problems:
        print("\nFAILURES:\n" + "\n".join(f"  - {p}" for p in problems))
        sys.exit(1)
    print("\nPIPELINE + ROUTE SELF-TEST: OK")


if __name__ == "__main__":
    main()
    sys.exit(0)
