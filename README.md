# DocuTrust

Officer-facing validation for AICTE college applications (SIH 2026, PS #5).
Ingests three application PDFs — Part-I, Land Deed, Faculty List — and flags
**cross-document inconsistencies, AICTE rule violations with clause references,
and PDF forensic signals**. Every finding is a risk signal with evidence the
officer clicks through to; the officer, not the model, decides.

All demo documents are **synthetic and watermarked** — no real applicant data
is ever loaded. Forgeries are labeled mutations of a known-good set, which is
what makes accuracy measurement defensible.

## Quick start

```bash
# Backend (from repo root)
pip install -r backend/requirements.txt
python -m uvicorn backend.main:app --port 8000

# Frontend (from frontend/)
npm install
npm start                      # fixture mode, fully standalone
# — or live mode —
copy frontend\.env.example frontend\.env   # then set REACT_APP_API_URL
npm start
```

In live mode, use the sidebar's **Clean set / Forged set** buttons: they fetch
the backend's synthetic documents and run them through the real pipeline
(real PDFs → extraction → consistency → rules → forensics).

## Layout

| Path | What |
|---|---|
| `frontend/` | React UI (upload → findings → PDF viewer with bbox overlays) |
| `frontend/README.md` | Full contract table, smoke tests, data-source map |
| `backend/` | FastAPI: `main.py` (routes), `synth.py` (document generator), `extract.py`, `consistency.py`, `rules.py`, `forensics.py`, `db.py` (cache + reviews) |
| `shared/contracts.py` | Frozen API contract: request/response models for every endpoint (Finding / Evidence / BBox / Citation / reviews / demo / health / rules) |
| `data/rules.json` | The 4 AICTE rules with clause references + thresholds |
| `data/synthetic/` | Generated demo set: `clean/` + `forged/`, `manifest.json` lists the labeled mutations |

## Design rules (non-negotiable)

- **Deterministic checks; LLM only for extraction** — the rule engine and
  consistency checks are plain Python, reproducible to the byte.
- **Risk signals, not verdicts** — every finding carries evidence (document,
  page, bbox, quoted value) and the officer approves or overrides.
- **No fabricated citations** — rules marked `verified: false` cite the clause
  category only, never quoted text.
- **Forensics from the file itself** — producer string, incremental xref
  sections, modification-vs-declared dates. ELA deliberately not implemented.
- **The demo never depends on the network** — committed fixture fallback when
  the backend is absent.

## Verification ladder

```bash
python -m backend.pipeline_selftest   # pipeline + routes
python -m backend.live_http_test      # real HTTP: CORS, cache, reviews
cd frontend && npm run smoke          # fixture UI, 23 checks
cd frontend && npm run smoke:live     # live UI end-to-end, 30 checks
```
