import React, { useState, useCallback, useEffect } from 'react';
import {
  AlertTriangle, ArrowRight, CheckCircle, FileText, Gauge, History,
  LayoutDashboard, ListChecks, RefreshCw, Shield, Sparkles, Wifi, WifiOff,
} from 'lucide-react';
import PDFViewer from './components/PDFViewer';
import FindingsPanel from './components/FindingsPanel';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Footer from './components/Footer';
import {
  analyzeDocuments, postReview, loadDemoSet, backendEnabled,
  fetchHealth, fetchRules, fetchReviews,
} from './services/api';
import { MOCK_FILES } from './data/mockFiles';
import './multitab.css';

const STEP = { UPLOAD: 'upload', ANALYZING: 'analyzing', RESULTS: 'results' };
const TABS = [
  { id: 'overview', label: 'Overview', Icon: LayoutDashboard },
  { id: 'review', label: 'Review workspace', Icon: FileText },
  { id: 'rules', label: 'Rules', Icon: ListChecks },
  { id: 'decisions', label: 'Review decisions', Icon: History },
];

function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const [step, setStep] = useState(STEP.UPLOAD);
  const [files, setFiles] = useState(backendEnabled() ? [] : MOCK_FILES);
  const [findings, setFindings] = useState([]);
  const [extracted, setExtracted] = useState({});
  const [selectedFindingId, setSelectedFindingId] = useState(null);
  const [activeDoc, setActiveDoc] = useState('part1');
  const [showOverlays, setShowOverlays] = useState(true);
  const [processingTime, setProcessingTime] = useState(0);
  const [mode, setMode] = useState(null);
  const [extractionMode, setExtractionMode] = useState(null);
  const [error, setError] = useState(null);
  const [reviewNotice, setReviewNotice] = useState('');
  const [demoVariant, setDemoVariant] = useState(null);
  const [demoLoading, setDemoLoading] = useState(false);
  const [health, setHealth] = useState(null);
  const [rules, setRules] = useState([]);
  const [rulesHash, setRulesHash] = useState(null);
  const [reviews, setReviews] = useState({});
  const [tabLoading, setTabLoading] = useState(false);
  const [tabError, setTabError] = useState('');

  const selectedFinding = findings.find((f) => f.id === selectedFindingId) || null;
  const analysisComplete = step === STEP.RESULTS;
  const counts = {
    critical: findings.filter((f) => f.severity === 'critical').length,
    warning: findings.filter((f) => f.severity === 'warning').length,
    info: findings.filter((f) => f.severity === 'info').length,
  };
  const verifiedRuleCount = rules.filter((r) => r.verified === true).length;

  useEffect(() => {
    let cancelled = false;
    async function loadTabData() {
      setTabError('');
      if (!backendEnabled() || !['overview', 'rules', 'decisions'].includes(activeTab)) return;
      setTabLoading(true);
      try {
        if (activeTab === 'overview') {
          const [h, r] = await Promise.all([fetchHealth(), fetchRules()]);
          if (!cancelled) {
            setHealth(h);
            setRules(r.rules || []);
            setRulesHash(r.sha256 || null);
          }
        } else if (activeTab === 'rules') {
          const r = await fetchRules();
          if (!cancelled) {
            setRules(r.rules || []);
            setRulesHash(r.sha256 || null);
          }
        } else {
          const r = await fetchReviews();
          if (!cancelled) setReviews(r.reviews || {});
        }
      } catch (e) {
        if (!cancelled) setTabError(e.message || 'Could not load backend data.');
      } finally {
        if (!cancelled) setTabLoading(false);
      }
    }
    loadTabData();
    return () => { cancelled = true; };
  }, [activeTab]);

  const handleAnalyze = useCallback(async () => {
    setActiveTab('review');
    setStep(STEP.ANALYZING);
    setError(null);
    setReviewNotice('');
    setSelectedFindingId(null);
    const startedAt = Date.now();
    try {
      const result = await analyzeDocuments(files);
      const reviewMap = result.reviews || {};
      const resultFindings = (result.findings || []).map((f) => ({
        ...f,
        status: f.status || reviewMap[f.id]?.action,
      }));
      setFindings(resultFindings);
      setReviews(reviewMap);
      setExtracted(result.extracted || {});
      setMode(result.mode || 'fixture');
      setExtractionMode(result.extractionMode || null);
      setProcessingTime(result.processingTime || Date.now() - startedAt);
      setStep(STEP.RESULTS);
      setActiveDoc('part1');
      if (resultFindings.length) setSelectedFindingId(resultFindings[0].id);
    } catch (err) {
      setError(err.message || 'Analysis failed');
      setStep(STEP.UPLOAD);
    }
  }, [files]);

  const handleLoadDemo = useCallback(async (variant) => {
    setDemoLoading(true);
    setError(null);
    try {
      const loaded = await loadDemoSet(variant);
      if (!loaded?.files?.length) throw new Error('No demo documents returned by the backend.');
      setFiles(loaded.files);
      setDemoVariant(variant);
      setSelectedFindingId(null);
      setActiveDoc('part1');
      setStep(STEP.UPLOAD);
      setActiveTab('review');
    } catch (err) {
      setError(`Could not load demo set: ${err.message}`);
    } finally {
      setDemoLoading(false);
    }
  }, []);

  const handleFilesSelected = useCallback((nextFiles) => {
    setFiles(nextFiles);
    setDemoVariant(null);
    setStep(STEP.UPLOAD);
    setFindings([]);
    setExtracted({});
    setSelectedFindingId(null);
    setError(null);
  }, []);

  const handleReview = useCallback(async (findingId, action) => {
    const now = Date.now() / 1000;
    setFindings((prev) => prev.map((f) => f.id === findingId ? { ...f, status: action } : f));
    const saved = await postReview(findingId, action);
    if (saved) {
      const record = { finding_id: findingId, action, officer_id: 'officer_001', note: null, created_at: now };
      setReviews((prev) => ({ ...prev, [findingId]: record }));
      setReviewNotice('Review action saved by the backend.');
    } else if (backendEnabled()) {
      setReviewNotice('Action updated on this screen, but the backend did not confirm it was saved.');
    } else {
      setReviewNotice('Fixture mode: this review action is only held in the current session.');
    }
  }, []);

  const handleReset = useCallback(() => {
    setStep(STEP.UPLOAD);
    setFindings([]);
    setExtracted({});
    setSelectedFindingId(null);
    setMode(null);
    setExtractionMode(null);
    setError(null);
    setReviewNotice('');
    setActiveDoc('part1');
    setActiveTab('review');
  }, []);

  const getDocFile = (docType) => files.find((f) => f.type === docType);

  return (
    <div className="app">
      <Header onReset={handleReset} analysisComplete={analysisComplete} mode={mode} />
      <nav className="app-tabs" role="tablist" aria-label="DocuTrust sections">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            className={`app-tab ${activeTab === id ? 'active' : ''}`}
            onClick={() => setActiveTab(id)}
          >
            <Icon size={16} /> <span>{label}</span>
            {id === 'review' && findings.length > 0 && <span className="tab-count">{findings.length}</span>}
          </button>
        ))}
      </nav>

      <div className="tab-main">
        {activeTab === 'review' ? (
          <div className="main">
            <Sidebar
              files={files}
              onFilesSelected={handleFilesSelected}
              onAnalyze={handleAnalyze}
              step={step}
              analysisComplete={analysisComplete}
              processingTime={processingTime}
              error={error}
              backendEnabled={backendEnabled()}
              demoVariant={demoVariant}
              demoLoading={demoLoading}
              onLoadDemo={handleLoadDemo}
              counts={counts}
              ruleCount={rules.length || health?.rules_loaded || null}
              verifiedRuleCount={verifiedRuleCount}
              extractionMode={extractionMode}
            />
            <div className="content">
              <div className="content-header">
                <div>
                  <div className="eyebrow">DOCUMENT REVIEW</div>
                  <h1 className="content-title">
                    {step === STEP.UPLOAD && 'Prepare an application review'}
                    {step === STEP.ANALYZING && 'Analyzing documents…'}
                    {step === STEP.RESULTS && 'Analysis findings'}
                  </h1>
                </div>
                <div className="findings-summary">
                  {analysisComplete && <>
                    <span className="summary-badge critical"><AlertTriangle size={12} />{counts.critical} Critical</span>
                    <span className="summary-badge warning"><AlertTriangle size={12} />{counts.warning} Warning</span>
                    <span className="summary-badge info"><Sparkles size={12} />{counts.info} Info</span>
                  </>}
                </div>
              </div>

              {step === STEP.RESULTS ? (
                <div className="results-layout">
                  <div className="results-findings">
                    {reviewNotice && <div className="review-notice">{reviewNotice}</div>}
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
                  <div className="empty-title">Analyzing documents</div>
                  <div className="empty-desc">Extracting fields, comparing documents, checking configured rules and reviewing PDF risk signals.</div>
                  <div className="pipeline-steps"><span><Sparkles size={14} /> Field extraction</span><span><ListChecks size={14} /> Deterministic checks</span><span><Shield size={14} /> Rule engine</span><span><FileText size={14} /> PDF signals</span></div>
                </div>
              ) : (
                <div className="review-welcome">
                  <div className="welcome-icon"><FileText size={28} /></div>
                  <h2>Review synthetic demo documents</h2>
                  <p>Choose a clean or labeled-mutation demo set, or select PDFs whose filenames identify them as Part-I, Land, or Faculty. Findings are risk signals for officer review—not verdicts.</p>
                  {error && <div className="upload-error">{error}</div>}
                  <button className="welcome-link" onClick={() => document.querySelector('.upload-zone')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>Go to document controls <ArrowRight size={15} /></button>
                </div>
              )}
            </div>
          </div>
        ) : activeTab === 'overview' ? (
          <OverviewPage
            health={health}
            backendEnabled={backendEnabled()}
            tabLoading={tabLoading}
            tabError={tabError}
            mode={mode}
            findings={findings}
            counts={counts}
            files={files}
            onGoReview={() => setActiveTab('review')}
          />
        ) : activeTab === 'rules' ? (
          <RulesPage rules={rules} rulesHash={rulesHash} loading={tabLoading} error={tabError} backendEnabled={backendEnabled()} />
        ) : (
          <DecisionsPage
            reviews={reviews}
            findings={findings}
            loading={tabLoading}
            error={tabError}
            backendEnabled={backendEnabled()}
            onGoReview={() => setActiveTab('review')}
          />
        )}
      </div>
      <Footer />
    </div>
  );
}

function PageHeader({ kicker, title, description, action }) {
  return <div className="page-heading"><div><div className="eyebrow">{kicker}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function OverviewPage({ health, backendEnabled: live, tabLoading, tabError, mode, findings, counts, files, onGoReview }) {
  const serviceOk = health?.status === 'ok' && health?.store?.database === 'ok';
  return (
    <section className="page-view">
      <PageHeader kicker="WORKSPACE OVERVIEW" title="DocuTrust at a glance" description="A quick view of the current demo environment and latest analysis." action={<button className="primary-action" onClick={onGoReview}>Open review workspace <ArrowRight size={15} /></button>} />
      {tabError && <div className="tab-alert">{tabError}</div>}
      <div className="metric-grid">
        <MetricCard label="Latest findings" value={findings.length} detail={`${counts.critical} critical · ${counts.warning} warning · ${counts.info} info`} Icon={FileText} />
        <MetricCard label="Documents loaded" value={files.length} detail="Part-I · Land · Faculty" Icon={Shield} />
        <MetricCard label="Configured rules" value={health?.rules_loaded ?? '—'} detail="See verification status on Rules tab" Icon={ListChecks} />
        <MetricCard label="Backend" value={tabLoading ? 'Checking…' : live ? (health ? (serviceOk ? 'Online' : 'Issue') : 'Not checked') : 'Fixture mode'} detail={live ? (health?.store?.database || 'Waiting for health response') : 'No backend URL configured'} Icon={live ? Wifi : WifiOff} />
      </div>
      <div className="overview-grid">
        <article className="surface-card">
          <div className="card-heading"><div><span className="eyebrow">CURRENT RUN</span><h2>Analysis status</h2></div><span className={`status-pill ${mode || 'idle'}`}>{mode || 'Not run yet'}</span></div>
          <p className="muted-copy">{findings.length ? 'The latest analysis is available in the Review Workspace. Select a finding to view its evidence on the PDF.' : 'Run a clean or labeled-mutation synthetic set to populate this overview.'}</p>
          <button className="text-action" onClick={onGoReview}>Go to review <ArrowRight size={14} /></button>
        </article>
        <article className="surface-card">
          <div className="card-heading"><div><span className="eyebrow">TRUST BOUNDARY</span><h2>Human review stays central</h2></div><Shield size={20} className="mint-icon" /></div>
          <p className="muted-copy">Checks surface evidence and possible inconsistencies. An authorized reviewer evaluates each finding; the system does not issue an approval verdict.</p>
          <div className="mini-points"><span><CheckCircle size={14} /> Source-linked findings</span><span><CheckCircle size={14} /> Risk signals, not verdicts</span></div>
        </article>
      </div>
      {live && health && <div className="health-strip"><span>Rules hash <code>{health.rules_sha256?.slice(0, 16) || '—'}…</code></span><span>LLM extraction helper <b>{health.llm?.configured ? 'configured' : 'not configured'}</b></span><span>Forensic mode <b>{health.forensic_mode || '—'}</b></span></div>}
      {!live && <div className="info-banner">Fixture mode is available without the backend. Rules and persisted review decisions appear here only when the backend is configured.</div>}
    </section>
  );
}

function MetricCard({ label, value, detail, Icon }) {
  return <article className="metric-card"><div className="metric-top"><span>{label}</span><Icon size={17} /></div><strong>{value}</strong><small>{detail}</small></article>;
}

function RulesPage({ rules, rulesHash, loading, error, backendEnabled: live }) {
  return (
    <section className="page-view">
      <PageHeader kicker="RULE CONFIGURATION" title="Configured checks" description="Rules shown here come from the backend. A configured rule is not automatically an officially verified requirement." />
      {error && <div className="tab-alert">{error}</div>}
      {!live ? <div className="empty-panel"><ListChecks size={28} /><h2>Backend not configured</h2><p>Rule definitions are loaded from the backend’s <code>/rules</code> endpoint; this fixture-only session does not contain a rule catalogue.</p></div> : loading ? <div className="empty-panel">Loading configured rules…</div> : rules.length === 0 ? <div className="empty-panel">No rules returned by the backend.</div> : <>
        <div className="rules-summary"><b>{rules.length}</b> configured rules <span>·</span> <b>{rules.filter((r) => r.verified).length}</b> marked verified <span>·</span> hash <code>{rulesHash?.slice(0, 12) || '—'}…</code></div>
        <div className="rules-grid">{rules.map((rule) => <RuleCard key={rule.id} rule={rule} />)}</div>
        <div className="info-banner">Only rules marked verified should be presented as validated citations. Thresholds for unverified rules are prototype configuration, not confirmed regulatory requirements.</div>
      </>}
    </section>
  );
}

function RuleCard({ rule }) {
  const verified = rule.verified === true;
  return <article className="rule-card">
    <div className="rule-card-top"><span className="rule-id">{rule.id}</span><span className={`verification-pill ${verified ? 'verified' : 'pending'}`}>{verified ? 'Verified' : 'Needs verification'}</span></div>
    <h2>{rule.name}</h2>
    <p className="rule-scope">Applies to: {(rule.applies_to || []).join(' · ') || 'Not specified'}</p>
    <div className="rule-clause"><b>Clause/category</b><span>{rule.clause || 'Not specified'}</span></div>
    {!verified && <p className="rule-warning"><AlertTriangle size={14} /> Citation and thresholds are not yet verified against the applicable handbook edition.</p>}
    {verified && rule.quote && <blockquote>{rule.quote}</blockquote>}
    {rule.source_url && <a className="source-link" href={rule.source_url} target="_blank" rel="noreferrer">Open cited source ↗</a>}
    <details className="rule-details"><summary>Prototype configuration</summary><pre>{JSON.stringify(rule.thresholds || {}, null, 2)}</pre><p>{rule.note}</p></details>
  </article>;
}

function DecisionsPage({ reviews, findings, loading, error, backendEnabled: live, onGoReview }) {
  const rows = live
    ? Object.values(reviews || {})
    : findings.filter((f) => f.status).map((f) => ({ finding_id: f.id, action: f.status, officer_id: 'session only', created_at: null }));
  return (
    <section className="page-view">
      <PageHeader kicker="REVIEW DECISIONS" title="Latest recorded actions" description="This view shows the latest saved action for each finding—not a chronological audit log." action={<button className="primary-action" onClick={onGoReview}>Open review workspace <ArrowRight size={15} /></button>} />
      {error && <div className="tab-alert">{error}</div>}
      {!live && <div className="info-banner">Fixture mode: decisions are held only in this browser session and are not saved to the backend.</div>}
      {loading ? <div className="empty-panel">Loading review decisions…</div> : rows.length === 0 ? <div className="empty-panel"><History size={28} /><h2>No review actions yet</h2><p>Officer actions recorded for findings will appear here.</p></div> : <div className="decision-table-wrap"><table className="decision-table"><thead><tr><th>Finding ID</th><th>Action</th><th>Officer ID</th><th>Latest update</th></tr></thead><tbody>{rows.map((r) => <tr key={r.finding_id}><td><code>{r.finding_id}</code></td><td><span className={`action-pill ${r.action}`}>{r.action}</span></td><td>{r.officer_id || '—'}</td><td>{r.created_at ? new Date(Number(r.created_at) * 1000).toLocaleString() : 'Session only'}</td></tr>)}</tbody></table></div>}
      <div className="info-banner subtle-banner"><AlertTriangle size={15} /> The current backend replaces a finding’s prior decision when a new action is recorded. Add an append-only event table before calling this an audit trail.</div>
    </section>
  );
}

export default App;
