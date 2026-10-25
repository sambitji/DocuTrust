"""Live HTTP test against a real uvicorn process.

Start the server, then run this:

    python -m uvicorn backend.main:app --port 8000
    python -m backend.live_http_test

Covers what the TestClient pass cannot: actual sockets, CORS preflight from
the CRA dev origin, FileResponse streaming, cache behavior across calls, and
officer-review persistence.
"""
from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

import httpx

BASE = "http://localhost:8000"
ORIGIN = "http://localhost:3000"  # CRA dev server / the static build's origin
DOC_TYPES = ("part1", "land", "faculty")


def b64(variant: str, doc_type: str) -> str:
    return base64.b64encode((Path("data/synthetic") / variant / f"{doc_type}.pdf").read_bytes()).decode()


def main() -> None:
    problems: list[str] = []
    ok: list[str] = []
    client = httpx.Client(base_url=BASE, timeout=30)

    # -- health + CORS ------------------------------------------------------
    r = client.get("/health", headers={"Origin": ORIGIN})
    if r.status_code != 200:
        problems.append(f"/health -> {r.status_code}: {r.text[:200]}")
    else:
        h = r.json()
        ok.append(f"/health rules={h['rules_loaded']} llm={h['llm']['configured']}")
        if h["rules_loaded"] != 4:
            problems.append(f"/health rules_loaded={h['rules_loaded']} (expected 4)")
    acao = r.headers.get("access-control-allow-origin")
    if acao not in (ORIGIN, "*"):
        problems.append(f"CORS missing on GET /health: ACAO={acao!r}")
    else:
        ok.append(f"CORS GET ok ({acao})")

    pre = client.options(
        "/analyze",
        headers={
            "Origin": ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    if pre.status_code != 200 or pre.headers.get("access-control-allow-origin") not in (ORIGIN, "*"):
        problems.append(f"CORS preflight -> {pre.status_code}: {dict(pre.headers)}")
    else:
        ok.append("CORS preflight ok")

    # -- demo endpoints -----------------------------------------------------
    for variant in ("clean", "forged"):
        r = client.get(f"/demo/manifest?variant={variant}")
        if r.status_code != 200 or len(r.json().get("docs", {})) != 3:
            problems.append(f"/demo/manifest {variant} -> {r.status_code}: {r.text[:200]}")
        else:
            ok.append(f"/demo/manifest {variant}: 3 docs")
        for doc_type in DOC_TYPES:
            r = client.get(f"/demo/pdf/{doc_type}?variant={variant}")
            if (
                r.status_code != 200
                or not r.headers.get("content-type", "").startswith("application/pdf")
                or len(r.content) < 2000
            ):
                problems.append(f"/demo/pdf {variant}/{doc_type} -> {r.status_code} {len(r.content)}b")
        ok.append(f"/demo/pdf {variant}: 3 PDFs stream ok")

    # -- analyze: clean, then cached ----------------------------------------
    clean_payload = {
        "files": [b64("clean", dt) for dt in DOC_TYPES],
        "doc_types": list(DOC_TYPES),
        "mock": False,
    }
    r = client.post("/analyze", json=clean_payload)
    if r.status_code != 200:
        problems.append(f"/analyze clean -> {r.status_code}: {r.text[:300]}")
    else:
        body = r.json()
        ids = [f["id"] for f in body["findings"]]
        if ids != ["CONS_VERIFIED"] or body["mode"] not in ("live", "cache"):
            problems.append(
                f"/analyze clean expected CONS_VERIFIED (live|cache), got mode={body['mode']} ids={ids}"
            )
        else:
            ok.append("/analyze clean: CONS_VERIFIED only (no false positives)")
        if len(body.get("extracted", {}).get("part1", {})) < 8:
            problems.append(f"/analyze clean extracted part1 sparse: {body['extracted'].get('part1')}")

    r2 = client.post("/analyze", json=clean_payload)
    if r2.status_code != 200 or r2.json().get("mode") != "cache":
        problems.append(f"/analyze clean#2 expected cache, got {r2.status_code} mode={r2.json().get('mode')}")
    else:
        ok.append(f"/analyze clean#2 cached in {r2.json()['processing_time_ms']} ms")

    # -- analyze: forged, all labeled mutations flagged ----------------------
    forged_payload = {
        "files": [b64("forged", dt) for dt in DOC_TYPES],
        "doc_types": list(DOC_TYPES),
        "mock": False,
    }
    r = client.post("/analyze", json=forged_payload)
    if r.status_code != 200:
        problems.append(f"/analyze forged -> {r.status_code}: {r.text[:300]}")
    else:
        body = r.json()
        got = {f["id"] for f in body["findings"]}
        expected = {
            "CONS_NAME", "CONS_DISTRICT", "RULE_LAND_AREA_MIN", "RULE_FACULTY_STUDENT_RATIO",
            "RULE_PRINCIPAL", "RULE_BUILTUP_AREA_PER_STUDENT", "FORENSIC_PROVENANCE_land",
        }
        if body["mode"] not in ("live", "cache"):
            problems.append(f"/analyze forged invalid mode={body['mode']}")
        # NOTE: mode may legitimately be 'cache' when a previous test pass
        # (pipeline_selftest via TestClient shares the SQLite file) already
        # analyzed this exact byte set — the findings assertions below are
        # what must hold regardless.
        if not expected <= got:
            problems.append(f"/analyze forged missing {sorted(expected - got)} (got {sorted(got)})")
        else:
            ok.append(f"/analyze forged: all {len(expected)} labeled mutations flagged")
        if len(got) != len(expected):
            problems.append(f"/analyze forged has unexpected findings: {sorted(got - expected)}")

        # evidence sanity: bboxes normalized, y0 above y1 (PDF bottom-left origin)
        for f in body["findings"]:
            for ev in f["evidence"]:
                x0, y0, x1, y1 = ev["bbox"]["x0"], ev["bbox"]["y0"], ev["bbox"]["x1"], ev["bbox"]["y1"]
                if not (0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1):
                    problems.append(f"bbox malformed on {f['id']}/{ev['field']}: {[x0, y0, x1, y1]}")
        ok.append("evidence bboxes normalized (0-1, y0<y1)")

        # -- officer review round trip ---------------------------------------
        rn = client.post("/review", json={"finding_id": "CONS_NAME", "action": "override", "note": "verified with sub-registrar"})
        if rn.status_code != 200 or not rn.json().get("ok"):
            problems.append(f"/review -> {rn.status_code}: {rn.text[:200]}")
        else:
            ok.append("/review persisted")

        rc = client.post("/analyze", json=forged_payload)
        if rc.status_code != 200:
            problems.append(f"/analyze forged#2 -> {rc.status_code}")
        else:
            cb = rc.json()
            if cb["mode"] != "cache":
                problems.append(f"/analyze forged#2 mode={cb['mode']} (expected cache)")
            st = next((f.get("status") for f in cb["findings"] if f["id"] == "CONS_NAME"), None)
            if st != "override":
                problems.append(f"officer status not restored through cache: {st!r}")
            else:
                ok.append(f"/analyze forged#2 cached, CONS_NAME.status restored = {st}")

    # -- cleanup: leave the demo DB clean ------------------------------------
    rd = client.delete("/reviews")
    if rd.status_code != 200:
        problems.append(f"DELETE /reviews -> {rd.status_code}")
    else:
        ok.append("reviews cleared for demo")

    print()
    for line in ok:
        print(f"  [ok] {line}")
    if problems:
        print("\nFAILURES:")
        for p in problems:
            print(f"  - {p}")
        sys.exit(1)
    print("\nLIVE HTTP TEST: OK")


if __name__ == "__main__":
    main()
