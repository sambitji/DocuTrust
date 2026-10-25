"""
Shared contracts between frontend and backend.
Frozen at T+10 — additive changes are safe; renames/removals require a full
team sync (see frontend/README.md, "Contract the frontend depends on").

This module is the single source of truth for every HTTP payload:
    /analyze            -> AnalyzeRequest / AnalyzeResponse
    /review             -> ReviewRequest / ReviewResponse
    /reviews            -> ReviewsResponse (GET) / ClearReviewsResponse (DELETE)
    /demo/manifest      -> DemoManifestResponse
    /health             -> HealthResponse
    /rules              -> RulesResponse

The backend runs FastAPI with these models as `response_model`, so a drift
between what an endpoint returns and what this file declares fails a request
instead of silently reaching the officer's screen.
"""
from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Vocabulary
# ---------------------------------------------------------------------------

class Severity(str, Enum):
    CRITICAL = "critical"
    WARNING = "warning"
    INFO = "info"


class FindingKind(str, Enum):
    CONSISTENCY = "consistency"
    RULE = "rule"
    FORENSIC = "forensic"


#: The three documents in the SIH demo set. Order in AnalyzeRequest.files and
#: AnalyzeRequest.doc_types must match pairwise.
DocType = Literal["part1", "land", "faculty"]

#: Synthetic demo sets served by /demo/*.
DemoVariant = Literal["clean", "forged"]

#: Stored review action strings. Note: approve/override, NOT approved/overridden.
ReviewAction = Literal["approve", "override"]

#: Extraction path actually used by the backend.
ExtractionMode = Literal["text", "llm"]

#: 'live' = computed now, 'cache' = served from the input-hash result cache.
AnalyzeMode = Literal["live", "cache"]


# ---------------------------------------------------------------------------
# Evidence geometry
# ---------------------------------------------------------------------------

class BBox(BaseModel):
    """Normalized bbox [x0, y0, x1, y1] in 0-1 page coordinates.
    Origin: bottom-left (PDF standard). Frontend must convert to viewport space.
    """
    x0: float = Field(ge=0, le=1)
    y0: float = Field(ge=0, le=1)
    x1: float = Field(ge=0, le=1)
    y1: float = Field(ge=0, le=1)


class Evidence(BaseModel):
    doc_id: str
    page: int = Field(ge=1)
    bbox: BBox
    field: str
    value: str


class Citation(BaseModel):
    """`quote` is printed ONLY when the clause reference has been human-verified
    against the printed APH handbook; an unverified rule cites the clause
    category alone (backend/rules.py)."""
    clause: str
    quote: Optional[str] = None
    source_url: Optional[str] = None


# ---------------------------------------------------------------------------
# Findings
# ---------------------------------------------------------------------------

class Finding(BaseModel):
    id: str
    severity: Severity
    kind: FindingKind
    title: str
    detail: str
    evidence: List[Evidence]
    citation: Optional[Citation] = None
    confidence: float = Field(ge=0, le=1, default=1.0)
    #: Officer decision stamped onto every response (live or cached) so a
    #: re-run restores what was already reviewed. None = not yet reviewed.
    status: Optional[ReviewAction] = None


# ---------------------------------------------------------------------------
# Officer reviews
# ---------------------------------------------------------------------------

class ReviewRequest(BaseModel):
    finding_id: str
    action: ReviewAction
    officer_id: str = "officer_001"
    note: Optional[str] = None


class ReviewRecord(BaseModel):
    finding_id: str
    action: ReviewAction
    officer_id: str
    note: Optional[str] = None
    created_at: float  # unix epoch seconds


class ReviewResponse(BaseModel):
    ok: bool
    review: ReviewRecord


class ReviewsResponse(BaseModel):
    #: finding_id -> latest review record
    reviews: Dict[str, ReviewRecord]


class ClearReviewsResponse(BaseModel):
    ok: bool
    reviews: Dict[str, ReviewRecord] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------

class AnalyzeRequest(BaseModel):
    files: List[str]  # base64 encoded PDFs
    doc_types: List[DocType]
    mock: bool = False


class AnalyzeResponse(BaseModel):
    findings: List[Finding]
    #: doc_type -> {field: value}, exactly what extraction resolved
    extracted: Dict[DocType, Dict[str, str]]
    processing_time_ms: int
    extraction_mode: ExtractionMode
    mode: AnalyzeMode
    #: finding_id -> review record; same state that Finding.status reflects
    reviews: Dict[str, ReviewRecord] = Field(default_factory=dict)
    #: Shapiro-style bookkeeping: echoed on cache hits, absent on fresh runs.
    input_sha256: Optional[Dict[DocType, str]] = None
    rule_ids_flagged: Optional[List[str]] = None


# ---------------------------------------------------------------------------
# Synthetic demo set (/demo/*)
# ---------------------------------------------------------------------------

class DemoDocInfo(BaseModel):
    filename: str
    path: str  # repo-relative POSIX-ish path from the generator
    bytes: int
    sha256: str


class Mutation(BaseModel):
    """A labelled change made to the clean set to build the forged set. The
    engine is expected to emit `expect` for it (backend/pipeline_selftest.py
    asserts this, which is what makes recall measurable)."""
    id: str
    doc: Union[DocType, List[DocType]]
    field: str
    value: str
    why: str
    expect: str


class DemoManifestResponse(BaseModel):
    variant: DemoVariant
    docs: Dict[DocType, DemoDocInfo]
    mutations: List[Mutation] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Health & rules
# ---------------------------------------------------------------------------

class LLMStatus(BaseModel):
    configured: bool
    base_url: Optional[str] = None
    model: Optional[str] = None


class StoreStatus(BaseModel):
    database: Literal["ok", "error"]
    path: str
    entries: Optional[int] = None
    error: Optional[str] = None


class HealthResponse(BaseModel):
    status: Literal["ok"]
    rules_sha256: str
    rules_loaded: int
    llm: LLMStatus
    forensic_mode: str
    store: StoreStatus
    demo_docs: str


class RuleSpec(BaseModel):
    id: str
    name: str
    severity: Severity
    applies_to: List[DocType]
    clause: str
    quote: Optional[str] = None
    source_url: Optional[str] = None
    verified: bool = False
    thresholds: Dict[str, Any] = Field(default_factory=dict)
    note: Optional[str] = None


class RulesResponse(BaseModel):
    rules: List[RuleSpec]
    sha256: str


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class ErrorResponse(BaseModel):
    """FastAPI's default error shape (HTTPException / validation 422 detail is
    sometimes a list, hence Any)."""
    detail: Any


__all__ = [
    "AnalyzeMode",
    "AnalyzeRequest",
    "AnalyzeResponse",
    "BBox",
    "Citation",
    "ClearReviewsResponse",
    "DemoDocInfo",
    "DemoManifestResponse",
    "DemoVariant",
    "DocType",
    "ErrorResponse",
    "Evidence",
    "ExtractionMode",
    "Finding",
    "FindingKind",
    "HealthResponse",
    "LLMStatus",
    "Mutation",
    "ReviewAction",
    "ReviewRecord",
    "ReviewRequest",
    "ReviewResponse",
    "ReviewsResponse",
    "RuleSpec",
    "RulesResponse",
    "Severity",
    "StoreStatus",
]
