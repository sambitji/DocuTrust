"""Forensic signals — deliberately libraries-only, and deliberately framed as
signals, not verdicts.

Two families, all computed from the file itself:
    1. metadata: producer string, creation vs modification dates, claimed
       execution dates inside the document;
    2. byte layout: count of xref segments (%%EOF / /Prev markers) — an
       incrementally updated PDF — which a single-shot filing tool does not
       produce.

ELA is deliberately NOT implemented: it measures JPEG compression noise and
is the weakest signal available, more likely to flag an honest scan than a
real forgery. If the team later has time during the demo the library path is
Pillow + numpy (compress/decompress and diff the luminance planes); that work
is not in the critical path and the demo does not depend on it.

Each detected signal becomes ONE finding on the affected document; severity
is critical at two or more concurrent signals, warning with one. On a clean
document no forensic finding appears at all — the panel stays quiet because
nothing is suspicious.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pymupdf as fitz  # PyMuPDF 2.x

from backend import config
from backend.extract import ExtractionResult, page_is_image_only
from shared.contracts import BBox, Evidence, Finding, FindingKind, Severity

PRODUCER_WHITELIST = ("aicte", "formgen", "e-filing")   # institutional e-filing stack
DATE_INTERPRETATION_DAYS = 60  # don't count a reissued file within two months


def _fitz_date(value: str | None) -> datetime | None:
    """PyMuPDF dates like D:20240115143200(+08) or D:20240115."""
    if not value:
        return None
    s = value.strip().lstrip("D:").split("+")[0].replace("Z", "")
    if len(s) < 8:
        return None
    try:
        return datetime.strptime(s[:14], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
    except Exception:
        try:
            return datetime.strptime(s[:8], "%Y%m%d").replace(tzinfo=timezone.utc)
        except Exception:
            return None


def _declared_date(e: ExtractionResult, doc_type: str) -> datetime | None:
    """The date the document claims INSIDE its own text (a deed's registration
    date is the print anchor that a subsequent edit postdates)."""
    if doc_type == "land":
        raw = e.fields.get("land", {}).get("registration_date")
        if raw:
            for fmt in ("%d-%m-%Y", "%d/%m/%Y", "%Y-%m-%d"):
                try:
                    return datetime.strptime(raw.strip(), fmt).replace(tzinfo=timezone.utc)
                except ValueError:
                    continue
    return None


def _signals(doc: fitz.Document, raw: bytes, e: ExtractionResult, doc_type: str) -> list[str]:
    out: list[str] = []
    md = doc.metadata or {}
    producer = (md.get("producer") or "").strip()
    whitelisted = any(w in producer.lower() for w in PRODUCER_WHITELIST)
    modified = _fitz_date(md.get("modDate"))
    created = _fitz_date(md.get("creationDate"))
    declared = _declared_date(e, doc_type)

    if producer and not whitelisted:
        out.append(f'producer is "{producer}" — not an institutional e-filing tool we whitelist')

    eof_count = raw.count(b"%%EOF")
    prev_count = raw.count(b"/Prev")
    incremental = max(0, eof_count - 1)
    if incremental > 0:
        out.append(
            f"{incremental} incremental update(s) present ({eof_count} xref segments, {prev_count} trailer-Prev "
            f"points) — content was edited after the file was written, not regenerated"
        )

    if not whitelisted and modified is not None and declared is not None:
        late_days = (modified - declared).days
        if abs(late_days) > DATE_INTERPRETATION_DAYS:
            out.append(
                f"modification date {modified:%Y-%m-%d %H:%M} is {abs(late_days)} days "
                f"{'after' if late_days > 0 else 'before'} the document's own declared date "
                f"of {declared:%Y-%m-%d}"
            )

    late_created = (created is not None and modified is not None and (modified - created).days > DATE_INTERPRETATION_DAYS)
    if not whitelisted and created is not None and modified is not None and late_created:
        out.append(
            f"modification was {abs((modified - created).days)} days after creation — "
            f"the file was edited well after it was produced"
        )

    return out


def evaluate_forensics(e: ExtractionResult, doc_bytes: dict[str, bytes]) -> list[Finding]:
    """Returns forensic findings (one per suspicious document)."""
    findings: list[Finding] = []
    if config.FORENSIC_MODE == "off":
        return findings

    for doc_type, raw in doc_bytes.items():
        try:
            doc = fitz.open(stream=raw, filetype="pdf")
        except Exception as exc:  # malformed / encrypted / not-pdf bytes
            findings.append(
                Finding(
                    id=f"FORENSIC_UNPARSEABLE_{doc_type}",
                    severity=Severity.CRITICAL,
                    kind=FindingKind.FORENSIC,
                    title=f"Document {doc_type} Did Not Parse As PDF",
                    detail=f"fitz could not open the supplied bytes: {exc}. An AICTE officer should "
                           f"examine the raw file manually — a malformed substitution into an "
                           f"electronic filing is itself a red flag.",
                    evidence=[Evidence(doc_id=doc_type, page=1,
                                       bbox=BBox(x0=0.02, y0=0.02, x1=0.98, y1=0.98),
                                       field="parse", value=str(exc))],
                    citation=None,
                    confidence=1.0,
                )
            )
            continue

        try:
            signals = _signals(doc, raw, e, doc_type)
            scanned = page_is_image_only(doc)
        finally:
            doc.close()

        if not signals:
            continue

        severity = Severity.CRITICAL if len(signals) >= 2 else Severity.WARNING
        md_summary = "; ".join(signals)
        findings.append(
            Finding(
                id=f"FORENSIC_PROVENANCE_{doc_type}",
                severity=severity,
                kind=FindingKind.FORENSIC,
                title=f"Document Integrity Signals ({doc_type})",
                detail=(
                    f"{len(signals)} integrity signal{'s' if len(signals) != 1 else ''} "
                    f"on this document: {md_summary}. "
                    f"Signals indicate the file was edited after it was issued — this is a "
                    f"signal, not a verdict. The officer should see the page and decide."
                ),
                evidence=[
                    Evidence(doc_id=doc_type, page=1,
                             bbox=BBox(x0=0.02, y0=0.02, x1=0.98, y1=0.98),
                             field="pdf_integrity", value="; ".join(signals))
                ],
                citation=None,
                confidence=0.92,
            )
        )
        if scanned:
            findings.append(
                Finding(
                    id="FORENSIC_PREVIEW_SCAN",
                    severity=Severity.INFO,
                    kind=FindingKind.FORENSIC,
                    title=f"Text Layer Absent (pages: {len(scanned)})",
                    detail=(
                        f"Pages {scanned} contain no text layer — the page was photographed or a "
                        f"scan substituted for an electronic filing. Vision OCR is used for "
                        f"extraction on these pages; confidence is lower than for text documents."
                    ),
                    evidence=[],
                    citation=None,
                    confidence=0.7,
                )
            )
    return findings
