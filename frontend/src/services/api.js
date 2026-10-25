import MOCK_FINDINGS from '../data/mockFindings';
import MOCK_EXTRACTED from '../data/mockExtracted';

const API_BASE = process.env.REACT_APP_API_URL || '';
const BACKEND_ENABLED = API_BASE.length > 0;

export const backendEnabled = () => BACKEND_ENABLED;

/**
 * Runs the full analysis pipeline.
 *
 * Live path (set REACT_APP_API_URL): FastAPI does vision-LLM extraction,
 * consistency checks, rule evaluation and forensics.
 *
 * Fallback path (no env var configured, or backend down/timeout): the committed
 * fixture in src/data/. The demo must never depend on a network call, and we
 * deliberately do not attempt a fetch that would only surface a console error.
 *
 * The returned `mode` tells the UI which path was used.
 */
export async function analyzeDocuments(files, { timeoutMs = 15000 } = {}) {
  if (!BACKEND_ENABLED) {
    return {
      findings: MOCK_FINDINGS,
      extracted: MOCK_EXTRACTED,
      processingTime: 1840,
      mode: 'fixture',
      reason: 'backend not configured',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const payload = {
      files: await Promise.all(files.map(fileToPayload)),
      doc_types: files.map((f) => f.type),
      mock: false,
    };

    const res = await fetch(`${API_BASE}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`Backend responded ${res.status}`);

    const data = await res.json();
    return {
      findings: data.findings,
      extracted: data.extracted,
      processingTime: data.processing_time_ms,
      // backend distinguishes a fresh run from a served cache hit
      mode: data.mode === 'cache' ? 'cache' : 'live',
    };
  } catch (err) {
    console.warn('[DocuTrust] Backend unavailable, using committed fixture:', err.message);
    return {
      findings: MOCK_FINDINGS,
      extracted: MOCK_EXTRACTED,
      processingTime: 1840,
      mode: 'fixture',
      reason: err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Records an officer decision for a finding. Fails soft — a review that
 * cannot be persisted must never break the demo.
 */
export async function postReview(findingId, action, note) {
  if (!BACKEND_ENABLED) return false;
  try {
    const res = await fetch(`${API_BASE}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ finding_id: findingId, action, note, officer_id: 'officer_001' }),
    });
    return res.ok;
  } catch (err) {
    console.warn('[DocuTrust] Review not persisted:', err.message);
    return false;
  }
}

/**
 * Fetches the backend's synthetic demo set (clean or forged) and returns
 * File-backed objects ready for the real pipeline path: upload -> /analyze.
 * Returns null when the backend is not configured, so the UI can fall back
 * to the committed fixture path without any branching at call sites.
 */
export async function loadDemoSet(variant = 'forged') {
  if (!BACKEND_ENABLED) return null;

  const manifestRes = await fetch(`${API_BASE}/demo/manifest?variant=${variant}`);
  if (!manifestRes.ok) throw new Error(`demo manifest unavailable (${manifestRes.status})`);
  const manifest = await manifestRes.json();

  const files = [];
  for (const [docType, info] of Object.entries(manifest.docs)) {
    const pdfRes = await fetch(`${API_BASE}/demo/pdf/${docType}?variant=${variant}`);
    if (!pdfRes.ok) throw new Error(`demo pdf ${docType} unavailable (${pdfRes.status})`);
    const buf = await pdfRes.arrayBuffer();
    files.push({
      name: info.filename,
      type: docType,
      size: info.bytes,
      sha256: info.sha256,
      variant,
      synthetic: true,
      raw: new File([buf], info.filename, { type: 'application/pdf' }),
    });
  }
  return { variant, files };
}

async function fileToPayload(file) {
  if (!file.raw) return file.base64 || '';
  const buf = await file.raw.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
