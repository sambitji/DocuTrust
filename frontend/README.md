# DocuTrust — Frontend

Officer-facing UI for AICTE application validation. React 18 + Create React App, with
`pdfjs-dist` for real uploads and a committed fixture fallback so the demo never depends
on the backend being up.

## Run

```bash
npm install
npm start          # http://localhost:3000
```

Build for demo:

```bash
npm run build      # production bundle in build/
```

## Backend wiring

The live path is **opt-in**. Set `REACT_APP_API_URL` (copy `.env.example` to `.env`,
or bake it at build time: `$env:REACT_APP_API_URL='http://localhost:8000'; npx react-scripts build`)
and start the backend (`uvicorn backend.main:app --port 8000` from the repo root).

- **Configured + backend healthy** → header badge reads `Live pipeline` (fresh analysis)
  or `Backend cache` (repeat of the same byte set — instant), results come from the real
  pipeline (`POST /analyze`). The sidebar offers **Clean set / Forged set** buttons that
  fetch the backend's synthetic documents (`GET /demo/pdf`) and run them through the
  real uploader path — real PDFs, real extraction, real bboxes.
- **Not configured, backend down, or timeout after 15 s** → header badge reads `Cached
  fixture`, results come from `src/data/mockFindings.js`. No fetch is attempted when
  unconfigured, so the browser console stays clean during a demo.

Without a `.env`, `npm start` and `npm run build` both run entirely standalone.

## Backend (FastAPI)

| Endpoint | Purpose |
|---|---|
| `GET /health` | Rule count/hash, LLM config, forensic mode, store status |
| `GET /demo/manifest?variant=clean\|forged` | File names, sizes, sha256 per document |
| `GET /demo/pdf/{doc_type}?variant=...` | Streams the synthetic PDF |
| `POST /analyze` | Extraction → consistency → rules → forensics; cached by input hash |
| `POST /review` | Persist officer decision (`approve`/`override`) |
| `GET /reviews` / `DELETE /reviews` | List / clear officer decisions |

Pipeline order: text-layer extraction (PyMuPDF, deterministic) → cross-document
consistency → 4 AICTE rules from `data/rules.json` → PDF forensics (producer string,
incremental xref sections, modification vs. declared dates). The vision-LLM is an
opt-in extraction helper (env `DOCTRUST_LLM_*`) with a hard timeout; the engine never
depends on it.

Verification ladder (all must be green before a demo):

```bash
python -m backend.pipeline_selftest   # pipeline + routes via TestClient
python -m backend.live_http_test      # real HTTP: CORS, cache, review persistence
npm run smoke                         # fixture path, 23 checks
npm run smoke:live                    # live path end-to-end, 30 checks
```

Live smoke flow: load the **forged** set → expect 7 findings (4 critical, 3 warning),
real-PDF highlights, clause citation, review flow; then the **clean** set → exactly one
all-clear finding served from the backend cache.

### Citation policy

Rules in `data/rules.json` carry `verified: false` until the clause reference is
human-checked against the printed APH 2024-27 handbook. Unverified rules cite the
clause **category only** (no quoted text) — a quote we could not verify is a quote we
do not print. The findings panel renders `clause quote pending verification against
printed APH` in that case.

## Screen map

| Region | File | Responsibility |
|---|---|---|
| Header | `src/components/Header.js` | Product mark, data-source badge, reset |
| Sidebar | `src/components/Sidebar.js` | Upload zone, required-document checklist, analysis status |
| Findings | `src/components/FindingsPanel.js` | Grouped findings, evidence rows, clause citation, approve/override |
| Viewer | `src/components/PDFViewer.js` | Page render, document switcher, bbox overlay, zoom |
| Footer | `src/components/Footer.js` | Risk-signal disclaimer (fixed, not dismissible) |

## Smoke test

Drives the real UI in headless Chrome and asserts on rendered geometry — not just text:

```bash
npx serve -s build -l 4173   # in one terminal
npm run smoke                # in another (fixture mode, 23 checks)
npm run smoke:live           # live mode, 30 checks (needs backend + baked env)
```

Fixture checks: upload screen, analysis run, severity counts, overlay/canvas size match,
highlights staying inside the page, non-blank page render, clause citation, approve
flow, document switching, forensic dashed outline, overlay toggle, reset, responsive.
Live mode additionally loads both synthetic sets from the backend and asserts the real
pipeline's counts, cache behavior, and officer-review restoration.

Env overrides: `SMOKE_URL` (default `http://localhost:4173`), `CHROME_PATH`.
Exits 1 on any failing check, 2 on crash. `puppeteer-core` is a devDependency — no
Chromium is downloaded, it drives the locally installed Chrome/Edge.

## Contract the frontend depends on

Freeze these before changing either side:

- **Finding**: `{ id, severity: critical|warning|info, kind: consistency|rule|forensic, title, detail, evidence[], citation, confidence, status }`
  where `status` is `null | approve | override`, stamped from the persisted officer review.
- **Evidence**: `{ doc_id, page, bbox, field, value }` with `bbox = { x0, y0, x1, y1 }`
- **bbox** is normalized `0-1`, **PDF origin is bottom-left**, **page is 1-indexed**.
  `PDFViewer` flips Y during mapping — do not flip it a second time upstream.
- Review action strings are `approve` / `override` (not `approved` / `overridden`).

The canonical definitions live in **`shared/contracts.py`** and are attached to the
FastAPI routes as `response_model` — a payload drift fails the request instead of
silently reaching the officer's screen.

## Data sources

| Path | Use |
|---|---|
| `src/data/mockFindings.js` | Committed fixture: 5 demo findings (no-backend fallback) |
| `src/data/mockExtracted.js` | Extracted fields per document type (fixture) |
| `src/data/mockFiles.js` | The three required demo documents (fixture) |
| `src/services/api.js` | Live call + fixture fallback, review posting, demo-set loading |
| `data/rules.json` | The 4 AICTE rules the engine enforces (clause + thresholds) |
| `data/synthetic/{clean,forged}/*.pdf` | Backend-generated demo documents (watermarked) |
| `data/synthetic/manifest.json` | Labeled mutations per forged document |

Note: the committed fixture and the live pipeline tell the same forged-application
story but are NOT byte-identical demos — fixture numbers/bboxes align with the canvas
mock layout; live numbers/bboxes come from the real generated PDFs. Both paths are
covered by their own smoke run.

## Demo notes

- Every rendered page carries a `SYNTHETIC DATA` watermark and a header band stating it
  is not a real filing. Do not load actual applicant documents.
- Forensic finding `FND-004` renders as a dashed page outline rather than a solid block,
  so it does not obscure the document underneath.
- The footer disclaimer — *risk signals, not verdicts* — is deliberately always visible.
