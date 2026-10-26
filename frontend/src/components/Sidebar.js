import React, { useCallback, useRef, useState } from 'react';
import { AlertTriangle, Check, Clock, Download, FileText, Info, Loader2, Search, Server, Shield, Upload, Zap } from 'lucide-react';

const DOCS = [
  { type: 'part1', label: 'Part-I Application', hint: 'Name file with “part1” or “application”', color: '#3b82f6' },
  { type: 'land', label: 'Land Deed / Document', hint: 'Name file with “land” or “deed”', color: '#22c55e' },
  { type: 'faculty', label: 'Faculty List (FIS)', hint: 'Name file with “faculty” or “fis”', color: '#f59e0b' },
];

function inferType(filename) {
  const name = filename.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  if (/part\s*i\b|part1|application/.test(name)) return 'part1';
  if (/land|deed|property/.test(name)) return 'land';
  if (/faculty|fis/.test(name)) return 'faculty';
  return null;
}

function Sidebar({ files, onFilesSelected, onAnalyze, step, analysisComplete, processingTime, error, backendEnabled, demoVariant, demoLoading, onLoadDemo, counts = {}, ruleCount, verifiedRuleCount = 0, extractionMode }) {
  const inputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [syntheticConfirmed, setSyntheticConfirmed] = useState(false);
  const fileTypes = new Set((files || []).map((file) => file.type));
  const complete = DOCS.every((doc) => fileTypes.has(doc.type));
  const hasUploadedFiles = (files || []).some((file) => file.raw && !file.synthetic);
  const canRun = complete && step !== 'analyzing' && (!hasUploadedFiles || (backendEnabled && syntheticConfirmed));

  const acceptFiles = useCallback((fileList) => {
    const incoming = Array.from(fileList || []).filter((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
    if (!incoming.length) {
      setUploadError('Choose PDF files to continue.');
      return;
    }
    const mapped = [];
    const unknown = [];
    const duplicates = [];
    const seen = new Set();
    incoming.forEach((raw) => {
      const type = inferType(raw.name);
      if (!type) { unknown.push(raw.name); return; }
      if (seen.has(type)) { duplicates.push(type); return; }
      seen.add(type);
      mapped.push({ name: raw.name, type, size: raw.size, raw });
    });
    if (unknown.length || duplicates.length) {
      const parts = [];
      if (unknown.length) parts.push(`Could not identify: ${unknown.join(', ')}. Include part1/application, land/deed, or faculty/FIS in each filename.`);
      if (duplicates.length) parts.push(`More than one PDF matched: ${[...new Set(duplicates)].join(', ')}.`);
      setUploadError(parts.join(' '));
      if (!mapped.length) return;
    } else setUploadError('');

    const next = new Map((files || []).map((file) => [file.type, file]));
    mapped.forEach((file) => next.set(file.type, file));
    setSyntheticConfirmed(false);
    onFilesSelected?.([...next.values()]);
  }, [files, onFilesSelected]);

  const onDrop = useCallback((event) => {
    event.preventDefault(); event.stopPropagation(); setDragActive(false);
    acceptFiles(event.dataTransfer.files);
  }, [acceptFiles]);

  const sizeLabel = (bytes = 0) => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
  const docLabel = (type) => DOCS.find((d) => d.type === type)?.label || type;

  return (
    <aside className={`sidebar ${dragActive ? 'sidebar-drag-active' : ''}`} onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }} onDragOver={(e) => e.preventDefault()} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragActive(false); }} onDrop={onDrop}>
      <div className="sidebar-section">
        {analysisComplete ? <div className="sidebar-title">Analysis summary</div> : <div className="sidebar-title">Documents</div>}
        {analysisComplete ? (
          <>
            <div className="sidebar-stat-list">
              <div className="sidebar-stat"><Check size={17} /><span><b>Analysis complete</b><small>{files.length} document(s) processed</small></span></div>
              <div className="sidebar-stat"><AlertTriangle size={17} /><span><b>Findings</b><small>{counts.critical || 0} critical · {counts.warning || 0} warning · {counts.info || 0} info</small></span></div>
              <div className="sidebar-stat"><Zap size={17} /><span><b>Configured rules</b><small>{ruleCount == null ? 'Rule catalogue unavailable' : `${ruleCount} configured · ${verifiedRuleCount} marked verified`}</small></span></div>
              <div className="sidebar-stat"><Info size={17} /><span><b>Extraction</b><small>{extractionMode || 'Mode not reported'}</small></span></div>
              <div className="sidebar-stat"><Clock size={17} /><span><b>Response time</b><small>{processingTime || 0} ms · cache/fixture timing may differ from a fresh run</small></span></div>
            </div>
            <div className="sidebar-title sidebar-subtitle">Loaded documents</div>
          </>
        ) : (
          <>
            <div className={`upload-zone ${dragActive ? 'drag-active' : ''}`} onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}>
              <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple onChange={(e) => { acceptFiles(e.target.files); e.target.value = ''; }} style={{ display: 'none' }} />
              <Upload className="upload-icon" />
              <div className="upload-text">Drop PDFs here or click to browse</div>
              <div className="upload-hint">Use filenames containing part1, land/deed, or faculty/FIS</div>
            </div>
            {(uploadError || error) && <div className="upload-error">{uploadError || error}</div>}
            <div className="file-list">
              {DOCS.map((doc) => {
                const file = (files || []).find((item) => item.type === doc.type);
                return <div key={doc.type} className="file-item">
                  <FileText className="file-icon" style={{ color: doc.color }} />
                  <div className="file-info"><div className="file-name">{file?.name || doc.label}</div><div className="file-meta">{file ? `${doc.label} · ${sizeLabel(file.size)}` : `Waiting for ${doc.label}`}</div></div>
                  <span className={`file-state ${file ? 'loaded' : ''}`}>{file ? 'Ready' : 'Required'}</span>
                </div>;
              })}
            </div>
            {hasUploadedFiles && <label className="synthetic-confirm">
              <input type="checkbox" checked={syntheticConfirmed} disabled={!backendEnabled} onChange={(e) => setSyntheticConfirmed(e.target.checked)} />
              <span>I confirm these are synthetic, watermarked demo PDFs—not real applicant records.</span>
            </label>}
            {hasUploadedFiles && !backendEnabled && <p className="sidebar-note">Custom PDFs cannot be analyzed in fixture-only mode. Configure the backend first; unrelated fixture findings will not be shown for these files.</p>}
            <button className={`analyze-btn ${step === 'analyzing' ? 'loading' : ''}`} onClick={onAnalyze} disabled={!canRun}>
              {step === 'analyzing' ? <><Loader2 className="spinner" /> Analyzing…</> : <><Search size={18} /> Run analysis</>}
            </button>
            {backendEnabled && <div className="demo-controls">
              <div className="demo-label"><Server size={12} /> Synthetic demo sets</div>
              <div className="demo-row">
                <button className="demo-btn" onClick={() => onLoadDemo('clean')} disabled={demoLoading}><Download size={14} /> Clean set</button>
                <button className="demo-btn" onClick={() => onLoadDemo('forged')} disabled={demoLoading}><Download size={14} /> Labeled-mutation set</button>
              </div>
              {demoVariant && <small className="demo-note">Loaded {demoVariant} synthetic set.</small>}
            </div>}
          </>
        )}
        {analysisComplete && <div className="file-list compact-file-list">{(files || []).map((file) => <div key={`${file.type}-${file.name}`} className="file-item"><FileText className="file-icon" /><div className="file-info"><div className="file-name">{file.name}</div><div className="file-meta">{docLabel(file.type)} · {sizeLabel(file.size)}</div></div></div>)}</div>}
        {analysisComplete && <div className="disclaimer-mini"><Shield size={13} /> Findings are risk signals—not verdicts.</div>}
      </div>

      {!analysisComplete && <>
        <div className="sidebar-section">
          <div className="sidebar-title">Required documents</div>
          <div className="required-doc-list">{DOCS.map((doc) => <div className="required-doc" key={doc.type}><span className="required-doc-mark" style={{ background: doc.color }}><FileText size={15} /></span><span><b>{doc.label}</b><small>{doc.hint}</small></span></div>)}</div>
        </div>
        <div className="sidebar-section">
          <div className="sidebar-title">What the system checks</div>
          <div className="check-list"><span><Search size={14} /> Cross-document consistency</span><span><Shield size={14} /> Configured rule checks</span><span><AlertTriangle size={14} /> PDF forensic signals</span><span><Info size={14} /> Field extraction mode: {extractionMode || 'shown after analysis'}</span></div>
          <p className="sidebar-note">Rule citations may be unverified. Check the Rules tab before presenting a requirement as authoritative.</p>
        </div>
      </>}
    </aside>
  );
}

export default Sidebar;
