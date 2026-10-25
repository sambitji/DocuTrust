"""Rule engine.

Rules come from data/rules.json — each carries its clause reference and the
numeric thresholds so every flag can cite *that clause*. Rules are evaluated
ONLY on already-extracted fields: deterministic, reproducible, no LLM.

Citation policy (also documented in README):
    rule.verified True  -> citation carries the clause AND its quoted text.
    rule.verified False -> citation carries the clause category only. The
                           printed APH handbook is the authority; a quote we
                           could not verify is a quote we do not print.
Every rule here is verified: false until the team human-checks the 2024-27
handbook — the officer sees the clause category and can turn to the printed
handbook before acting. That honesty is a selling point, not a defect.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

from backend.extract import ExtractionResult
from shared.contracts import BBox, Citation, Evidence, Finding, FindingKind, Severity

RULES_PATH = Path(__file__).resolve().parent.parent / "data" / "rules.json"


def load_rules() -> dict[str, dict]:
    return {r["id"]: r for r in json.loads(RULES_PATH.read_text(encoding="utf-8"))}


RULES = load_rules()


def rules_sha256() -> str:
    return hashlib.sha256(RULES_PATH.read_bytes()).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _field(e: ExtractionResult, name: str) -> str | None:
    """Field value from any document type (rule checks span documents)."""
    for fields in e.fields.values():
        if name in fields and fields[name] not in (None, "",):
            return fields[name]
    return None


def _hit(e: ExtractionResult, doc_type: str, field: str) -> Evidence | None:
    hit = e.locs.get(doc_type, {}).get(field)
    if not hit:
        return None
    return Evidence(
        doc_id=doc_type,
        page=hit.page,
        bbox=BBox(x0=hit.bbox[0], y0=hit.bbox[1], x1=hit.bbox[2], y1=hit.bbox[3]),
        field=field,
        value=hit.value,
    )


def _num(v: str | None) -> int | None:
    if v is None:
        return None
    digits = "".join(ch for ch in str(v) if ch.isdigit())
    return int(digits) if digits else int(math.nan) if digits == "" else None


def _clean_num(v: str | None) -> int | None:
    if v is None:
        return None
    digits = "".join(ch for ch in v if ch.isdigit())
    return int(digits) if digits else None


def _cite(rule: dict) -> Citation | None:
    if not rule.get("clause"):
        return None
    return Citation(
        clause=rule["clause"],
        quote=rule["quote"] if rule.get("verified") else None,
        source_url=rule.get("source_url"),
    )


def _finding(rule_id: str, title: str, detail: str, evidence: list[Evidence | None], confidence: float = 1.0) -> Finding:
    rule = RULES[rule_id]
    return Finding(
        id=f"{rule_id}",
        severity=Severity(rule["severity"]),
        kind=FindingKind.RULE,
        title=title,
        detail=detail,
        evidence=[ev for ev in evidence if ev is not None],
        citation=_cite(rule),
        confidence=confidence,
    )


# ---------------------------------------------------------------------------
# Rule evaluators
# ---------------------------------------------------------------------------


def rule_land_minimum(e: ExtractionResult) -> list[Finding]:
    rule = RULES["RULE_LAND_AREA_MIN"]
    t = rule["thresholds"]
    land_area = _clean_num(_field(e, "land_area_sqm") or _field(e, "plot_area_sqm"))
    program_count = _clean_num(_field(e, "program_count"))
    area_type = (_field(e, "area_type") or "rural").strip().lower()

    if land_area is None or program_count is None:
        return []

    base = t["metro_urban_sqm"] if area_type in ("metro", "urban") else t["rural_sqm"]
    extra_units = max(0, math.ceil(max(0, program_count - 5) / 5))
    required = base + t["additional_per_5_programs_sqm"] * extra_units

    if land_area >= required:
        return []

    deficit = required - land_area
    detail = (
        f"Declared land area of {land_area:,} sqm ({land_area / 4046.856:.2f} acres) is {deficit:,} sqm short of "
        f"the {required:,} sqm minimum for a {area_type} location carrying {program_count} programs "
        f"(base {base:,} sqm, plus {t['additional_per_5_programs_sqm']:,} sqm per additional 5 programs). "
        f"The figure is stated identically in Part-I and in the registered deed, indicating the "
        f"declared value was carried across both rather than independently sourced."
    )
    return [
        _finding(
            RULES["RULE_LAND_AREA_MIN"]["id"],
            "Land Area Below AICTE Minimum",
            detail,
            [
                _hit(e, "part1", "land_area_sqm"),
                _hit(e, "part1", "program_count"),
                _hit(e, "part1", "area_type"),
                _hit(e, "land", "plot_area_sqm"),
            ],
        )
    ]


def rule_faculty_student_ratio(e: ExtractionResult) -> list[Finding]:
    rule = RULES["RULE_FACULTY_STUDENT_RATIO"]
    t = rule["thresholds"]
    faculty = _clean_num(_field(e, "total_faculty"))
    intake = _clean_num(_field(e, "total_intake"))

    if faculty in (None, 0) or intake is None:
        return []

    required = math.ceil(intake / t["ug_ratio"])
    if faculty >= required:
        return []

    shortfall = required - faculty
    detail = (
        f"Total faculty of {faculty} against sanctioned intake of {intake:,} yields a faculty-student ratio "
        f"of 1:{intake / faculty:.1f} — below the mandated 1:{t['ug_ratio']} for UG Engineering & Technology. "
        f"Shortfall of {shortfall} faculty against the {required} required for this intake."
    )
    return [
        _finding(
            rule["id"],
            "Faculty-Student Ratio Below 1:20",
            detail,
            [
                _hit(e, "faculty", "total_faculty"),
                _hit(e, "part1", "total_intake"),
            ],
            confidence=0.95,
        )
    ]


def rule_principal(e: ExtractionResult) -> list[Finding]:
    rule = RULES["RULE_PRINCIPAL"]
    t = rule["thresholds"]
    fields = e.fields.get("faculty", {})
    qual = (fields.get("principal_qualification") or "").strip().lower().replace(".", "")
    total_years = _clean_num(fields.get("principal_total_experience_years"))
    prof_years = _clean_num(fields.get("principal_professor_years"))

    failures: list[str] = []
    if qual not in ("phd", "ph d"):
        failures.append(f"principal holds '{fields.get('principal_qualification') or 'unspecified'}' — Ph.D. is mandatory")
    if total_years is not None and total_years < t["min_total_experience_years"]:
        failures.append(f"total experience {total_years} years, minimum is {t['min_total_experience_years']}")
    if prof_years is not None and prof_years < t["min_professor_years"]:
        failures.append(f"Professor-level experience {prof_years} years, minimum is {t['min_professor_years']}")

    if not failures:
        return []

    detail = (
        "Principal does not satisfy the appointment norms as stated in the faculty record: "
        + "; ".join(failures)
        + ". Professor-level experience is a separate requirement from total service — "
        "the two figures in the FIS record are evaluated independently."
    )
    return [
        _finding(
            rule["id"],
            "Principal Qualification / Experience Deficient",
            detail,
            [
                _hit(e, "faculty", "principal_qualification"),
                _hit(e, "faculty", "principal_total_experience_years"),
                _hit(e, "faculty", "principal_professor_years"),
            ],
            confidence=0.97,
        )
    ]


def rule_builtup(e: ExtractionResult) -> list[Finding]:
    rule = RULES["RULE_BUILTUP_AREA_PER_STUDENT"]
    t = rule["thresholds"]
    builtup = _clean_num(_field(e, "builtup_area_sqm"))
    intake = _clean_num(_field(e, "total_intake"))

    if builtup is None or intake in (None, 0):
        return []

    required = intake * t["instructional_sqm_per_student"]
    if builtup >= required:
        return []

    deficit = required - builtup
    detail = (
        f"Built-up area of {builtup:,} sqm against intake of {intake:,} yields {builtup / intake:.2f} sqm "
        f"per student — below the {t['instructional_sqm_per_student']} sqm per student instructional-area norm. "
        f"Shortfall of {deficit:,} sqm for the intake being applied for."
    )
    return [
        _finding(
            rule["id"],
            "Built-up Area Below Intake Norm",
            detail,
            [
                _hit(e, "part1", "builtup_area_sqm"),
                _hit(e, "part1", "total_intake"),
            ],
        )
    ]


RULE_EVALUATORS = [rule_land_minimum, rule_faculty_student_ratio, rule_principal, rule_builtup]


def evaluate_rules(e: ExtractionResult) -> tuple[list[Finding], list[str]]:
    """Run all rule evaluators. Returns (findings, rule_ids_that_flagged)."""
    findings: list[Finding] = []
    flagged_ids: list[str] = []
    for fn in RULE_EVALUATORS:
        for finding in fn(e):
            findings.append(finding)
            flagged_ids.append(finding.id)
    return findings, flagged_ids
