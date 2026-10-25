"""DocuTrust backend — FastAPI application.

Pipeline: bytes -> extract -> consistency -> rules -> forensics -> officer.

Determinism: the whole analysis is a pure function of the uploaded bytes and
data/rules.json. The vision-LLM is an opt-in extraction helper with a hard
timeout, used for unstructured text and nothing else — the rule engine and
the consistency checks are plain Python so the officer-facing evidence is
reproducible.
"""
from __future__ import annotations

import base64
import hashlib
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from shared.contracts import (  # noqa: E402
    AnalyzeRequest,
    AnalyzeResponse,
    ClearReviewsResponse,
    DemoManifestResponse,
    HealthResponse,
    ReviewRequest,
    ReviewResponse,
    ReviewsResponse,
    RulesResponse,
)

from backend import config  # noqa: E402
from backend import db  # noqa: E402
from backend import forensics  # noqa: E402
from backend import rules as rules_mod  # noqa: E402
from backend import synth  # noqa: E402
from backend.consistency import consistency_verified_finding, evaluate_consistency  # noqa: E402
from backend.extract import ExtractionResult, extract as extract_fields  # noqa: E402

@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Generate demo docs (idempotent). Set DOCTRUST_FORCE_SYNTH=1 to rebuild."""
    synth.build(force=config.FORCE_SYNTH)
    yield


app = FastAPI(
    title="DocuTrust",
    description="AICTE application validation — extraction, consistency, rule engine, forensics.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _stamp_status(findings: list[dict]) -> list[dict]:
    """Officer decisions ride along on every response — live or served from
    cache — so re-running an analysis restores what the officer already
    decided. Non-mutating: the cache stays free of session state."""
    reviews = db.review_get_all()
    return [
        {**finding, "status": reviews[finding["id"]]["action"] if finding["id"] in reviews else None}
        for finding in findings
    ]


@app.get("/health", response_model=HealthResponse)
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "rules_sha256": rules_mod.rules_sha256(),
        "rules_loaded": len(rules_mod.RULES),
        "llm": {
            "configured": bool(config.LLM_API_KEY and config.LLM_BASE_URL),
            "base_url": config.LLM_BASE_URL or None,
            "model": config.LLM_MODEL if (config.LLM_API_KEY and config.LLM_BASE_URL) else None,
        },
        "forensic_mode": config.FORENSIC_MODE,
        "store": db.health(),
        "demo_docs": str(synth.OUT_DIR.resolve()),
    }


@app.get("/demo/manifest", response_model=DemoManifestResponse)
def demo_manifest(variant: Literal["clean", "forged"] = "forged") -> dict[str, Any]:
    if variant not in ("clean", "forged"):
        raise HTTPException(404, f"variant {variant!r} not found")
    return {"variant": variant, **synth.build()["variants"][variant]}


@app.get("/demo/pdf/{doc_type}")
def demo_pdf(doc_type: str, variant: Literal["clean", "forged"] = "forged") -> FileResponse:
    path = synth.OUT_DIR / variant / f"{doc_type}.pdf"
    if not path.exists():
        synth.build()  # content-addressed: regenerates only what is missing
    if not path.exists():
        raise HTTPException(404, f"demo document {doc_type!r} missing")
    return FileResponse(
        str(path),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="docutrust_{variant}_{doc_type}.pdf"',
            "X-Object-Kind": doc_type,
        },
    )


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(payload: AnalyzeRequest) -> dict[str, Any]:
    t0 = time.perf_counter()

    if len(payload.files) != len(payload.doc_types):
        raise HTTPException(422, f"files/doc_types length mismatch: {len(payload.files)} vs {len(payload.doc_types)}")
    if not payload.files:
        raise HTTPException(422, "no files provided")

    doc_bytes: dict[str, bytes] = {}
    for b64, doc_type in zip(payload.files, payload.doc_types):
        if doc_type not in ("part1", "land", "faculty"):
            raise HTTPException(422, f"unsupported doc_type {doc_type!r}")
        try:
            doc_bytes[doc_type] = base64.b64decode(b64)
        except Exception as exc:
            raise HTTPException(422, f"{doc_type}: payload is not valid base64 ({exc})") from exc

    # Hash the input: repeat demo runs skip extraction + rules entirely.
    hashes = {dt: hashlib.sha256(b).hexdigest() for dt, b in doc_bytes.items()}
    cache_key = hashlib.sha256(
        ("|".join(f"{dt}:{hashes[dt]}" for dt in sorted(doc_bytes)) + f"|rules={rules_mod.rules_sha256()}").encode()
    ).hexdigest()

    if cached := db.cache_get(cache_key):
        return {
            **cached,
            "findings": _stamp_status(cached["findings"]),
            "processing_time_ms": int((time.perf_counter() - t0) * 1000),
            "mode": "cache",
            "reviews": db.review_get_all(),
        }

    # -- extract ------------------------------------------------------------
    extracted: dict[str, dict] = {}
    hit_locs: dict[str, dict] = {}
    extraction_modes: set[str] = set()
    for doc_type, raw in doc_bytes.items():
        try:
            result = extract_fields(raw, doc_type)
        except Exception as exc:  # malformed bytes / encrypted / not a PDF
            raise HTTPException(500, f"extraction failed on {doc_type}: {exc}") from exc
        extracted[doc_type] = result.fields
        hit_locs[doc_type] = result.locs
        extraction_modes.add(result.mode)
    ex = ExtractionResult(fields=extracted, locs=hit_locs, mode="llm" if "llm" in extraction_modes else "text")

    if missing := [dt for dt, f in extracted.items() if len(f) < 3]:
        raise HTTPException(
            500,
            f"extraction did not resolve expected fields for {missing}; "
            f"be sure the PDF carries a text layer, or re-run with a vision-LLM extraction.",
        )

    # -- engine -------------------------------------------------------------
    cons = evaluate_consistency(ex)
    findings = list(cons.findings)
    rule_findings, rule_flagged = rules_mod.evaluate_rules(ex)
    findings.extend(rule_findings)
    findings.extend(forensics.evaluate_forensics(ex, doc_bytes))
    if verified := consistency_verified_finding(cons):
        findings.append(verified)

    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    reviews = db.review_get_all()

    store = {
        "findings": [finding.model_dump(mode="json") for finding in findings],
        "extracted": extracted,
        "extraction_mode": ex.mode,
        "input_sha256": hashes,
        "rule_ids_flagged": rule_flagged,
    }
    db.cache_put(cache_key, store)

    return {
        "findings": _stamp_status(store["findings"]),
        "extracted": extracted,
        "processing_time_ms": elapsed_ms,
        "extraction_mode": ex.mode,
        "mode": "live",
        "reviews": reviews,
    }


@app.post("/review", response_model=ReviewResponse)
def review(payload: ReviewRequest) -> dict[str, Any]:
    if payload.action not in ("approve", "override"):
        raise HTTPException(422, f"action must be approve|override, got {payload.action!r}")
    return {"ok": True, "review": db.review_set(payload.finding_id, payload.action, payload.officer_id, payload.note)}


@app.get("/reviews", response_model=ReviewsResponse)
def list_reviews() -> dict[str, Any]:
    return {"reviews": db.review_get_all()}


@app.delete("/reviews", response_model=ClearReviewsResponse)
def clear_reviews() -> dict[str, Any]:
    db.review_clear_all()
    return {"ok": True, "reviews": {}}


@app.get("/rules", response_model=RulesResponse)
def list_rules() -> dict[str, Any]:
    return {"rules": rules_mod.RULES, "sha256": rules_mod.rules_sha256()}
