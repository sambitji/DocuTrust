"""Cross-document consistency checks.

The product's differentiator, and deliberately the simplest code in the repo:
compare the SAME fact as reported on TWO DIFFERENT documents. Python difflib
plus a couple of tolerant parsers — no graph DB, no ML, no LLM. If a check is
cheap and explainable it is defensible in front of an AICTE officer; that is
the whole advantage over a "trust the extractor" pipeline.

Each check returns a Finding on failure, or a PassRecord consumed later. All
passes collapse into ONE informational "consistency verified" finding so the
panel is not empty on a clean application.
"""
from __future__ import annotations

import difflib
from dataclasses import dataclass, field as dc_field

from backend.extract import ExtractionResult, FieldHit
from shared.contracts import BBox, Evidence, Finding, FindingKind, Severity

NAME_AGREEMENT = 0.92   # catches Venkateswara vs Venkateshwara, tolerates spacing
AREA_TOLERANCE_SQM = 1  # registered deeds round; officer forms spell


def _hit(e: ExtractionResult, doc_type: str, fname: str) -> Evidence | None:
    hit: FieldHit | None = e.locs.get(doc_type, {}).get(fname)
    if not hit:
        return None
    return Evidence(
        doc_id=doc_type,
        page=hit.page,
        bbox=BBox(x0=hit.bbox[0], y0=hit.bbox[1], x1=hit.bbox[2], y1=hit.bbox[3]),
        field=fname,
        value=hit.value,
    )


def _kv(e: ExtractionResult, doc_type: str, fname: str) -> str | None:
    return e.fields.get(doc_type, {}).get(fname)


def _num(v: str | None) -> int | None:
    if v is None:
        return None
    digits = "".join(ch for ch in v if ch.isdigit())
    return int(digits) if digits else None


def _norm_text(s: str | None) -> str:
    return "".join(ch.lower() for ch in (s or "") if ch.isalnum())


def similarity(a: str | None, b: str | None) -> float:
    return difflib.SequenceMatcher(None, _norm_text(a or ""), _norm_text(b or "")).ratio()


@dataclass
class PassRecord:
    check: str
    label: str
    passed: bool = True
    skipped: bool = False
    reason: str | None = None


@dataclass
class ConsistencyResult:
    findings: list[Finding] = dc_field(default_factory=list)
    passes: list[PassRecord] = dc_field(default_factory=list)


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------


def check_institution_name(e: ExtractionResult, res: ConsistencyResult) -> None:
    rec = PassRecord("check_institution_name", "institution name (Part-I vs deed)")

    a = _kv(e, "part1", "institution_name")
    b = _kv(e, "land", "institution_name")
    if not a or not b:
        rec.skipped, rec.reason = True, "field missing on one document"
        res.passes.append(rec)
        return

    # difflib rates a one-character change (~0.99) far above any useful
    # threshold, so "close enough" cannot be a pass condition: an exact
    # match passes, a near-match (>= threshold) is a spelling discrepancy,
    # and anything further apart is an outright mismatch.
    ratio = similarity(a, b)
    if _norm_text(a) == _norm_text(b):
        res.passes.append(rec)
        return

    rec.passed = False
    res.passes.append(rec)
    near = ratio >= NAME_AGREEMENT
    res.findings.append(
        Finding(
            id="CONS_NAME",
            severity=Severity.WARNING if near else Severity.CRITICAL,
            kind=FindingKind.CONSISTENCY,
            title=(
                "Institution Name Spelling Discrepancy"
                if near
                else "Institution Name Mismatch Across Documents"
            ),
            detail=(
                f'Part-I declares the institution as "{a}" while the registered deed names "{b}" '
                f"(similarity {ratio:.2f}). "
                + (
                    "The two names are near-identical but not equal. A one-character difference in a "
                    "legal name is a classic tell of a retyped document — confirm the registered "
                    "legal name against the sub-registrar's record, not against either instrument."
                    if near
                    else "The names disagree well beyond the spelling-agreement threshold "
                    f"({NAME_AGREEMENT}); confirm the registered legal name from the "
                    "sub-registrar's record before crediting either instrument."
                )
            ),
            evidence=[hit for hit in (_hit(e, "part1", "institution_name"), _hit(e, "land", "institution_name")) if hit],
            citation=None,
            confidence=0.95,
        )
    )


def check_owner_society(e: ExtractionResult, res: ConsistencyResult) -> None:
    rec = PassRecord("check_owner_society", "society / land owner")

    a = _kv(e, "part1", "society_name")
    b = _kv(e, "land", "owner_name")
    if not a or not b:
        rec.skipped, rec.reason = True, "field missing on one document"
        res.passes.append(rec)
        return

    ratio = similarity(a, b)
    if _norm_text(a) == _norm_text(b):
        res.passes.append(rec)
        return

    rec.passed = False
    res.passes.append(rec)
    near = ratio >= NAME_AGREEMENT
    res.findings.append(
        Finding(
            id="CONS_OWNER",
            severity=Severity.WARNING if near else Severity.CRITICAL,
            kind=FindingKind.CONSISTENCY,
            title="Society / Owner Name Discrepancy" if near else "Society / Owner Name Mismatch",
            detail=(
                f'The society/trust applying is named "{a}" on Part-I while the deed records the '
                f'vendor/owner as "{b}" (similarity {ratio:.2f}). '
                + (
                    "Near-identical but not equal — verify the exact registered entity name before "
                    "crediting the land to the applicant."
                    if near
                    else "If the entity that owns the land is not the entity that is applying, the "
                    "institution may have no claim over the land the application is counting."
                )
            ),
            evidence=[hit for hit in (_hit(e, "part1", "society_name"), _hit(e, "land", "owner_name")) if hit],
            citation=None,
            confidence=0.95,
        )
    )


def check_land_area_agreement(e: ExtractionResult, res: ConsistencyResult) -> None:
    rec = PassRecord("check_land_area_agreement", "land area (Part-I vs deed)")

    a = _num(_kv(e, "part1", "land_area_sqm"))
    b = _num(_kv(e, "land", "plot_area_sqm"))
    if a is None or b is None:
        rec.skipped, rec.reason = True, "field missing on one document"
        res.passes.append(rec)
        return

    if abs(a - b) <= AREA_TOLERANCE_SQM:
        res.passes.append(rec)
        return

    rec.passed = False
    res.passes.append(rec)
    res.findings.append(
        Finding(
            id="CONS_LAND_AREA",
            severity=Severity.CRITICAL,
            kind=FindingKind.CONSISTENCY,
            title="Land Area Disagreement Between Form and Deed",
            detail=(
                f"Application form declares land area of {a:,} sqm but the registered deed records {b:,} sqm — "
                f"a difference of {abs(a - b):,} sqm. Both documents feed the land minimum in Appendix 4, so the "
                f"officer cannot credit either figure until the discrepancy is resolved."
            ),
            evidence=[hit for hit in (_hit(e, "part1", "land_area_sqm"), _hit(e, "land", "plot_area_sqm")) if hit],
            citation=None,
            confidence=0.97,
        )
    )


def check_district_agreement(e: ExtractionResult, res: ConsistencyResult) -> None:
    rec = PassRecord("check_district_agreement", "district (Part-I vs deed)")

    a = (_kv(e, "part1", "district") or "").strip().lower()
    b = (_kv(e, "land", "district") or "").strip().lower()
    if not a or not b:
        rec.skipped, rec.reason = True, "field missing on one document"
        res.passes.append(rec)
        return

    if a == b:
        res.passes.append(rec)
        return

    rec.passed = False
    res.passes.append(rec)
    res.findings.append(
        Finding(
            id="CONS_DISTRICT",
            severity=Severity.WARNING,
            kind=FindingKind.CONSISTENCY,
            title="District Mismatch Between Form and Deed",
            detail=(
                f'Part-I locates the institution in the "{a}" district; the deed records "{b}". The deed\'s district '
                f"is what anchors the plot's legal identity — confirm the district from the sub-registrar's "
                f"record rather than from either document."
            ),
            evidence=[hit for hit in (_hit(e, "part1", "district"), _hit(e, "land", "district")) if hit],
            citation=None,
            confidence=0.9,
        )
    )


def check_course_faculty_coverage(e: ExtractionResult, res: ConsistencyResult) -> None:
    rec = PassRecord("check_course_faculty_coverage", "program intake vs department faculty")

    course_list = _kv(e, "part1", "course_list")
    dept_counts = _kv(e, "faculty", "dept_faculty_count")
    if not course_list or not dept_counts:
        rec.skipped, rec.reason = True, "field missing on one document"
        res.passes.append(rec)
        return

    intake: dict[str, int] = {}
    for part in course_list.split(","):
        code, _, n = part.strip().partition(":")
        if code and n.strip().isdigit():
            intake[code] = int(n)

    faculty_by_dept: dict[str, int] = {}
    for part in dept_counts.split(","):
        code, _, n = part.strip().partition(":")
        if code and n.strip().isdigit():
            faculty_by_dept[code] = int(n)

    mismatched = [
        {"code": code, "intake": n, "faculty": faculty_by_dept.get(code, 0)}
        for code, n in intake.items()
        if faculty_by_dept.get(code, 0) * 20 < n
    ]
    if not mismatched:
        res.passes.append(rec)
        return

    rec.passed = False
    res.passes.append(rec)
    res.findings.append(
        Finding(
            id="CONS_COURSES_FACULTY",
            severity=Severity.WARNING,
            kind=FindingKind.CONSISTENCY,
            title="Faculty Coverage Missing for Applied Programs",
            detail=(
                "Programs where the faculty roster does not cover the intake being applied for at 1:20: "
                + "; ".join(f"{m['code']} — intake {m['intake']}, faculty {m['faculty']}" for m in mismatched)
                + ". Per-department tallies in the FIS file must cover every program being "
                "sanctioned; this is a per-department check, not only a headcount check."
            ),
            evidence=[hit for hit in (_hit(e, "part1", "course_list"), _hit(e, "faculty", "dept_faculty_count")) if hit],
            citation=None,
            confidence=0.93,
        )
    )


CONSISTENCY_EVALUATORS = [
    check_institution_name,
    check_owner_society,
    check_land_area_agreement,
    check_district_agreement,
    check_course_faculty_coverage,
]


def evaluate_consistency(e: ExtractionResult) -> ConsistencyResult:
    res = ConsistencyResult()
    for fn in CONSISTENCY_EVALUATORS:
        fn(e, res)
    return res


def consistency_verified_finding(res: ConsistencyResult) -> Finding | None:
    """All-clear signal: emitted ONLY when every non-skipped check passed, so
    a forged set never carries an 'all consistent' badge next to its criticals."""
    evaluated = [p for p in res.passes if not p.skipped]
    if not evaluated or not all(p.passed for p in evaluated):
        return None
    labels = ", ".join(p.label for p in evaluated)
    return Finding(
        id="CONS_VERIFIED",
        severity=Severity.INFO,
        kind=FindingKind.CONSISTENCY,
        title="Cross-Document Consistency Verified",
        detail=(
            f"All cross-document checks passed: {labels}. Every cross-checked field agrees — "
            f"names match exactly, land area within {AREA_TOLERANCE_SQM} sqm, districts identical, "
            f"and department faculty cover every applied program at 1:20."
        ),
        evidence=[],
        citation=None,
        confidence=0.98,
    )
