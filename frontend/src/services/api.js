import MOCK_FINDINGS from '../data/mockFindings';
import MOCK_EXTRACTED from '../data/mockExtracted';

const API_BASE = process.env.REACT_APP_API_URL || '';
const BACKEND_ENABLED = API_BASE.length > 0;

export const backendEnabled = () => BACKEND_ENABLED;

async function getJson(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`Backend responded ${res.status} for ${path}`);
  return res.json();
}

/** Runs the analysis pipeline, falling back to the committed fixture. */
export async function analyzeDocuments(files, { timeoutMs = 15000 } = {}) {
  if (!BACKEND_ENABLED) {
    if (files.some((file) => file.raw)) {
      throw new Error('Backend is not configured. Uploaded PDFs were not analyzed; fixture results were not substituted.');
    }
    return {
      findings: MOCK_FINDINGS,
      extracted: MOCK_EXTRACTED,
      reviews: {},
      processingTime: 1840,
      extractionMode: 'fixture',
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
      findings: data.findings || [],
      extracted: data.extracted || {},
      reviews: data.reviews || {},
      processingTime: data.processing_time_ms,
      extractionMode: data.extraction_mode || null,
      mode: data.mode === 'cache' ? 'cache' : 'live',
    };
  } catch (err) {
    // Never attach unrelated fixture findings to uploaded PDFs: that would make
    // the visible evidence appear to belong to a file the backend never read.
    if (files.some((file) => file.raw)) {
      throw new Error(`Backend unavailable; uploaded PDFs were not analyzed: ${err.message}`);
    }
    console.warn('[DocuTrust] Backend unavailable, using committed fixture:', err.message);
    return {
      findings: MOCK_FINDINGS,
      extracted: MOCK_EXTRACTED,
      reviews: {},
      processingTime: 1840,
      extractionMode: 'fixture',
      mode: 'fixture',
      reason: err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Records a review action. Returns true only when the backend confirms it. */
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

/** Fetches a synthetic clean/forged set and returns File-backed objects. */
export async function loadDemoSet(variant = 'forged') {
  if (!BACKEND_ENABLED) return null;
  const manifest = await getJson(`/demo/manifest?variant=${variant}`);
  const files = [];
  for (const [docType, info] of Object.entries(manifest.docs || {})) {
    const res = await fetch(`${API_BASE}/demo/pdf/${docType}?variant=${variant}`);
    if (!res.ok) throw new Error(`Demo PDF ${docType} unavailable (${res.status})`);
    const buf = await res.arrayBuffer();
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

/** Backend health, configured rules and latest stored review decisions. */
export async function fetchHealth() {
  if (!BACKEND_ENABLED) return null;
  return getJson('/health');
}

export async function fetchRules() {
  if (!BACKEND_ENABLED) return { rules: [], sha256: null };
  return getJson('/rules');
}

export async function fetchReviews() {
  if (!BACKEND_ENABLED) return { reviews: {} };
  return getJson('/reviews');
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
