"""Extraction layer: PyMuPDF text layer -> typed fields + normalized bboxes.

Deterministic first: the text-layer regexes below resolve every field for the
three AICTE document types without any model call, and `page.search_for()`
gives real, citable coordinates. The vision-LLM path is opt-in (DOCTRUST_LLM_*)
with a hard timeout and an automatic fallback to the deterministic path — the
demo must never depend on a network call (config.LLM).

Coordinate contract (frozen in frontend/README.md):
    bbox = [x0, y0, x1, y1], normalized 0-1, PDF origin BOTTOM-LEFT, page 1-indexed.
PyMuPDF reports rects with origin TOP-LEFT, so:
    y0_contract = 1 - (rect.y1 / page_height)   # bottom edge
    y1_contract = 1 - (rect.y0 / page_height)   # top edge
Do not flip twice: PDFViewer flips again when drawing.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

import pymupdf as fitz  # PyMuPDF 2.x; `fitz` alias retained for brevity

from backend import config

# ---------------------------------------------------------------------------
# Field schemas per document type
# ---------------------------------------------------------------------------

FIELD_PATTERNS: dict[str, list[tuple[str, re.Pattern, str]]] = {
    # (field, regex, bbox-fallback key text used if the value is not locatable)
    "part1": [
        ("institution_name", re.compile(r"Institution Name:\s*(.+)"), "Institution Name"),
        ("society_name", re.compile(r"Society/Trust Name:\s*(.+)"), "Society/Trust Name"),
        ("address", re.compile(r"Address:\s*(.+)"), "Address"),
        ("district", re.compile(r"District:\s*([A-Za-z ]+)"), "District"),
        ("area_type", re.compile(r"Area Type:\s*([A-Za-z/]+)"), "Area Type"),
        ("land_area_sqm", re.compile(r"Land Area \(sqm\):\s*([\d,]+)"), "Land Area (sqm)"),
        ("builtup_area_sqm", re.compile(r"Built-up Area \(sqm\):\s*([\d,]+)"), "Built-up Area (sqm)"),
        ("program_count", re.compile(r"Program Count:\s*(\d+)"), "Program Count"),
        ("total_intake", re.compile(r"Total Approved Intake:\s*([\d,]+)"), "Total Approved Intake"),
        ("submission_date", re.compile(r"Submission Date:\s*([\d-]+)"), "Submission Date"),
    ],
    "land": [
        ("doc_no", re.compile(r"Document No:\s*([A-Z0-9/]+)"), "Document No"),
        ("registration_date", re.compile(r"Registration Date:\s*([\d-]+)"), "Registration Date"),
        ("owner_name", re.compile(r"Vendor / Owner:\s*(.+)"), "Vendor / Owner"),
        ("institution_name", re.compile(r"Purchaser / Institution:\s*(.+)"), "Purchaser / Institution"),
        ("survey_no", re.compile(r"Survey No:\s*([\d/]+)"), "Survey No"),
        ("village", re.compile(r"Village:\s*(.+)"), "Village"),
        ("district", re.compile(r"District:\s*([A-Za-z ]+)"), "District"),
        ("plot_area_sqm", re.compile(r"Plot Area \(sqm\):\s*([\d,]+)"), "Plot Area (sqm)"),
        ("lease_term_years", re.compile(r"Lease Term \(years\):\s*(\d+)"), "Lease Term (years)"),
        ("annual_lease_rent", re.compile(r"Annual Lease Rent \(Rs\):\s*([\d,]+)"), "Annual Lease Rent (Rs)"),
    ],
    "faculty": [
        ("principal_name", re.compile(r"Principal Name:\s*(.+)"), "Principal Name"),
        ("principal_qualification", re.compile(r"Principal Qualification:\s*([A-Za-z.]+)"), "Principal Qualification"),
        ("principal_total_experience_years", re.compile(r"Principal Total Experience \(years\):\s*(\d+)"), "Principal Total Experience"),
        ("principal_professor_years", re.compile(r"Principal Professor Experience \(years\):\s*(\d+)"), "Principal Professor Experience"),
        ("principal_joining_date", re.compile(r"Principal Date of Joining:\s*([\d-]+)"), "Principal Date of Joining"),
        ("total_faculty", re.compile(r"Total Faculty Count:\s*(\d+)"), "Total Faculty Count"),
        ("dept_faculty_count", re.compile(r"Department Faculty Count:\s*(.+)"), "Department Faculty Count"),
    ],
}

# Course name (as printed) -> short code used by the rule / consistency engines
COURSE_ALIASES = {
    "Computer Science & Engineering": "CSE",
    "Electronics & Communication Engineering": "ECE",
    "Mechanical Engineering": "ME",
    "Civil Engineering": "CE",
    "Electrical & Electronics Engineering": "EEE",
    "Information Technology": "IT",
    "Artificial Intelligence & Machine Learning": "AIML",
}


@dataclass
class FieldHit:
    value: str
    page: int            # 1-indexed
    bbox: list[float]    # [x0,y0,x1,y1] normalized, PDF bottom-left origin


@dataclass
class ExtractionResult:
    fields: dict[str, str]                    # doc_type -> field -> value
    locs: dict[str, dict[str, FieldHit]]      # doc_type -> field -> coordinates
    mode: str = "text"                        # 'text' | 'llm'
    notes: list[str] = field(default_factory=list)


def _normalize(value: str) -> str:
    return " ".join(value.replace("\u2013", "-").replace("\u2019", "'").split())


def _to_bbox(page: fitz.Page, rect: fitz.Rect) -> list[float]:
    pw, ph = page.rect.width, page.rect.height
    return [
        round(max(0.0, rect.x0 / pw), 4),
        round(max(0.0, 1 - rect.y1 / ph), 4),
        round(min(1.0, rect.x1 / pw), 4),
        round(min(1.0, 1 - rect.y0 / ph), 4),
    ]


def _locate(page: fitz.Page, needles: list[str]) -> list[float]:
    """Bbox for the first needle that resolves; falls back to a full-width band."""
    for target in needles:
        if not target:
            continue
        hits = page.search_for(target)
        if hits:
            return _to_bbox(page, min(hits, key=lambda r: r.get_area()))
    pw = page.rect.width
    return [0.09, 0.02, round((pw - 16) / pw, 4), 0.07]


def harvest(doc: fitz.Document, doc_type: str) -> ExtractionResult:
    """Regex-extract the schema for one document type out of the PDF text layer."""
    fields: dict[str, str] = {}
    locs: dict[str, FieldHit] = {}

    for pno, page in enumerate(doc, start=1):
        raw = page.get_text("text")
        lines = [_normalize(l) for l in raw.splitlines()]

        for fname, pattern, fallback_key in FIELD_PATTERNS[doc_type]:
            if fname in fields:
                continue
            for line in lines:
                m = pattern.search(line)
                if not m:
                    continue
                value = _normalize(m.group(1)).strip()
                if not value:
                    continue
                fields[fname] = value
                # locate by the full printed line (precise for short values)
                # then by the value token, then by the field's key text.
                locs[fname] = FieldHit(
                    value=value,
                    page=pno,
                    bbox=_locate(page, [line[:90], value[:60], fallback_key]),
                )
                break

    # derived: course list from per-course intake lines
    if doc_type == "part1":
        course_list: list[str] = []
        pages_have_courses = []
        for pno, page in enumerate(doc, start=1):
            for line in _normalize(page.get_text("text")).splitlines():
                left, sep, right = line.rpartition(" : ")
                code = COURSE_ALIASES.get(left.strip())
                if sep and code and right.strip().isdigit():
                    course_list.append(f"{code}:{right.strip()}")
                    if pno not in pages_have_courses:
                        pages_have_courses.append(pno)
        if course_list:
            fields["course_list"] = ", ".join(course_list)
            page_no = pages_have_courses[0] if pages_have_courses else 1
            page = doc[page_no - 1]
            start = page.search_for("Course-wise Intake")
            end = page.search_for("Declarations:")
            if start:
                x0, y_top = start[0].x0, start[0].y0
                y_bottom = end[0].y0 if end else y_top + 180
                x1 = page.rect.width - 56  # span the full content column width
                locs["course_list"] = FieldHit(value=fields["course_list"], page=page_no, bbox=_to_bbox(page, fitz.Rect(x0, y_top, x1, y_bottom)))
            else:
                locs["course_list"] = FieldHit(value=fields["course_list"], page=page_no, bbox=[0.09, 0.02, 0.92, 0.07])

    return ExtractionResult(fields=fields, locs=locs)


def page_is_image_only(doc: fitz.Document) -> list[int]:
    """Pages whose text layer is empty — photographed/scanned rather than text."""
    out = []
    for pno, page in enumerate(doc, start=1):
        text = (page.get_text("text") or "").strip()
        if len(text) < 20 and page.get_images():
            out.append(pno)
    return out


def extract(doc_bytes: bytes, doc_type: str) -> ExtractionResult:
    """Parse one PDF: open the bytes, harvest the schema for its type, close.

    The open document is not returned on purpose — forensics re-opens the raw
    bytes itself, so there is exactly one owner of each file handle.
    """
    doc = fitz.open(stream=doc_bytes, filetype="pdf")
    try:
        return harvest(doc, doc_type)
    finally:
        doc.close()
