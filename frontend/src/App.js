import React, { useState, useCallback } from 'react';
import { FileText, Search, AlertTriangle, Info, Sparkles, Shield, Zap } from 'lucide-react';
import PDFViewer from './components/PDFViewer';
import FindingsPanel from './components/FindingsPanel';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Footer from './components/Footer';
import { analyzeDocuments, postReview, loadDemoSet, backendEnabled } from './services/api';
import { MOCK_FILES } from './data/mockFiles';

const STEP = { UPLOAD: 'upload', ANALYZING: 'analyzing', RESULTS: 'results' };

function App() {
  const [step, setStep] = useState(STEP.UPLOAD);
  // Live mode starts empty: the sidebar offers the backend's synthetic demo
  // sets, and MOCK_FILES carry no bytes to analyze. Fixture mode starts
  // pre-loaded so the demo is one click end-to-end without a backend.
  const [files, setFiles] = useState(backendEnabled() ? [] : MOCK_FILES);
  const [findings, setFindings] = useState([]);
  const [extracted, setExtracted] = useState({});
  const [selectedFindingId, setSelectedFindingId] = useState(null);
  const [activeDoc, setActiveDoc] = useState('part1');
  const [showOverlays, setShowOverlays] = useState(true);
  const [processingTime, setProcessingTime] = useState(0);
  const [mode, setMode] = useState(null); // 'live' | 'cache' | 'fixture'
  const [error, setError] = useState(null);
  const [demoVariant, setDemoVariant] = useState(null); // 'clean' | 'forged'
  const [demoLoading, setDemoLoading] = useState(false);

  const selectedFinding = findings.find((f) => f.id === selectedFindingId) || null;

  const handleAnalyze = useCallback(async () => {
    setStep(STEP.ANALYZING);
    setError(null);
    setSelectedFindingId(null);
    const startedAt = Date.now();

    try {
      const result = await analyzeDocuments(files);
      const reviews = result.reviews || {};
      setFindings(result.findings.map((f) => ({ ...f, status: f.status || reviews[f.id]?.action })));
      setExtracted(result.extracted);
      setMode(result.mode);
      setProcessingTime(result.processingTime || Date.now() - startedAt);
      setStep(STEP.RESULTS);
      setActiveDoc('part1');
      if (result.findings.length > 0) setSelectedFindingId(result.findings[0].id);
    } catch (err) {
      setError(err.message || 'Analysis failed');
      setStep(STEP.UPLOAD);
    }
  }, [files]);

  /**
   * Pulls the backend's synthetic demo set (clean or forged) and swaps it in
   * as the documents under review — the real files, the real uploader path.
   * Falls back to an error banner; never swaps to empty.
   */
  const handleLoadDemo = useCallback(async (variant) => {
    setDemoLoading(true);
    setError(null);
    try {
      const { files: loaded } = await loadDemoSet(variant);
      if (!loaded || loaded.length === 0) throw new Error('backend returned no documents');
      setFiles(loaded);
      setDemoVariant(variant);
      setSelectedFindingId(null);
      setActiveDoc('part1');
      setStep(STEP.UPLOAD);
    } catch (err) {
      setError(`Could not load demo set: ${err.message}`);
    } finally {
      setDemoLoading(false);
    }
  }, []);

  const handleReview = useCallback(async (findingId, action) => {
    setFindings((prev) => prev.map((f) => (f.id === findingId ? { ...f, status: action } : f)));
    await postReview(findingId, action);
  }, []);

  const handleReset = useCallback(() => {
    setStep(STEP.UPLOAD);
    setFindings([]);
    setExtracted({});
    setSelectedFindingId(null);
    setMode(null);
    setError(null);
    setActiveDoc('part1');
  }, []);

  const counts = {
    critical: findings.filter((f) => f.severity === 'critical').length,
    warning: findings.filter((f) => f.severity === 'warning').length,
    info: findings.filter((f) => f.severity === 'info').length,
  };

  const getDocFile = (docType) => files.find((f) => f.type === docType);

  return (
    <div className="app">
      <Header onReset={handleReset} analysisComplete={step === STEP.RESULTS} mode={mode} />

      <div className="main">
        <Sidebar
          files={files}
          onAnalyze={handleAnalyze}
          step={step}
          analysisComplete={step === STEP.RESULTS}
          processingTime={processingTime}
          error={error}
          backendEnabled={backendEnabled()}
          demoVariant={demoVariant}
          demoLoading={demoLoading}
          onLoadDemo={handleLoadDemo}
        />

        <div className="content">
          <div className="content-header">
            <h1 className="content-title">
              {step === STEP.UPLOAD && 'Upload Documents'}
              {step === STEP.ANALYZING && 'Analyzing Documents...'}
              {step === STEP.RESULTS && 'Analysis Results'}
            </h1>
            <div className="findings-summary">
              {step === STEP.RESULTS && (
                <>
                  <span className="summary-badge critical">
                    <AlertTriangle size={12} />
                    {counts.critical} Critical
                  </span>
                  <span className="summary-badge warning">
                    <AlertTriangle size={12} />
                    {counts.warning} Warning
                  </span>
                  <span className="summary-badge info">
                    <Info size={12} />
                    {counts.info} Info
                  </span>
                </>
              )}
            </div>
          </div>

          {step === STEP.RESULTS ? (
            <div className="results-layout">
              <div className="results-findings">
                <FindingsPanel
                  findings={findings}
                  selectedFinding={selectedFinding}
                  onSelectFinding={(f) => setSelectedFindingId(f.id)}
                  onApprove={(id) => handleReview(id, 'approve')}
                  onOverride={(id) => handleReview(id, 'override')}
                  extracted={extracted}
                />
              </div>
              <div className="results-viewer">
                <PDFViewer
                  docType={activeDoc}
                  file={getDocFile(activeDoc)}
                  findings={findings}
                  selectedFindingId={selectedFindingId}
                  showOverlays={showOverlays}
                  onToggleOverlays={(v) => setShowOverlays(typeof v === 'boolean' ? v : !showOverlays)}
                  onDocChange={setActiveDoc}
                  onSelectFinding={setSelectedFindingId}
                />
              </div>
            </div>
          ) : step === STEP.ANALYZING ? (
            <div className="empty-state" style={{ flex: 1 }}>
              <div className="spinner" style={{ width: 48, height: 48, marginBottom: 20 }} />
              <div className="empty-title">Analyzing Documents</div>
              <div className="empty-desc">
                Running extraction, consistency checks, rule validation, and forensic analysis...
              </div>
              <div className="pipeline-steps">
                <span><Sparkles size={14} /> Vision LLM Extraction</span>
                <span><Search size={14} /> Consistency Checks</span>
                <span><Shield size={14} /> 4 Rule Checks</span>
                <span><Zap size={14} /> Forensic Signals</span>
              </div>
            </div>
          ) : (
            <div className="empty-state" style={{ flex: 1 }}>
              <FileText className="empty-icon" />
              <div className="empty-title">Upload Application Documents</div>
              <div className="empty-desc">
                Drag and drop or select the three required documents to begin automated validation.
                The system extracts fields, cross-checks consistency, verifies AICTE rules, and
                surfaces forensic anomalies as risk signals.
              </div>
              {error && <div className="upload-error">{error}</div>}
            </div>
          )}
        </div>
      </div>

      <Footer />
    </div>
  );
}

export default App;
