import React, { useCallback, useRef, useState } from 'react';
import { FileText, Upload, Loader2, Check, AlertTriangle, Info, Clock, Zap, Shield, Search, Sparkles, Download, Server } from 'lucide-react';

function Sidebar({ files, onAnalyze, step, analysisComplete, processingTime, error, backendEnabled, demoVariant, demoLoading, onLoadDemo }) {
  const fileInputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      // In a real app, handle file upload here
      console.log('Files dropped:', e.dataTransfer.files);
    }
  }, []);

  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      console.log('Files selected:', e.target.files);
    }
  };

  const getDocIcon = (type) => {
    switch (type) {
      case 'part1': return <FileText size={18} style={{ color: '#3b82f6' }} />;
      case 'land': return <FileText size={18} style={{ color: '#22c55e' }} />;
      case 'faculty': return <FileText size={18} style={{ color: '#f59e0b' }} />;
      default: return <FileText size={18} />;
    }
  };

  const getDocLabel = (type) => {
    switch (type) {
      case 'part1': return 'Part-I Application';
      case 'land': return 'Land Document';
      case 'faculty': return 'Faculty List (FIS)';
      default: return type;
    }
  };

  const formatSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  if (step === 'results' && analysisComplete) {
    return (
      <aside className="sidebar">
        <div className="sidebar-section">
          <div className="sidebar-title">Analysis Complete</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px', background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.2)', borderRadius: 8 }}>
              <Check size={18} style={{ color: '#22c55e' }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>Extraction Complete</div>
                <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>All 3 documents processed</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px', background: 'rgba(34, 211, 238, 0.1)', border: '1px solid rgba(34, 211, 238, 0.2)', borderRadius: 8 }}>
              <Zap size={18} style={{ color: '#22d3ee' }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>Rule Engine Executed</div>
                <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>4 AICTE clauses verified</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: 8 }}>
              <AlertTriangle size={18} style={{ color: '#f59e0b' }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>Consistency Checks</div>
                <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>3 cross-document comparisons</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 8 }}>
              <Info size={18} style={{ color: '#ef4444' }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>Forensic Analysis</div>
                <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>PDF metadata & integrity</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 8 }}>
              <Clock size={18} style={{ color: 'var(--fg-muted)' }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>Processing Time</div>
                <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{processingTime} ms</div>
              </div>
            </div>
          </div>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-title">Loaded Documents</div>
          <div className="file-list">
            {files.map((file) => (
              <div key={file.name} className="file-item">
                {getDocIcon(file.type)}
                <div className="file-info">
                  <div className="file-name">{file.name}</div>
                  <div className="file-meta">
                    {getDocLabel(file.type)} • {formatSize(file.size)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-title">Checks Performed</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: 'var(--fg-secondary)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Check size={14} style={{ color: '#22c55e' }} />
              <span>Institution name consistency</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Check size={14} style={{ color: '#22c55e' }} />
              <span>Land area vs. program count</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Check size={14} style={{ color: '#22c55e' }} />
              <span>Faculty-student ratio (1:20)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Check size={14} style={{ color: '#22c55e' }} />
              <span>Principal qualification</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Check size={14} style={{ color: '#22c55e' }} />
              <span>Built-up area per student</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Check size={14} style={{ color: '#22c55e' }} />
              <span>Course intake vs. faculty</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Check size={14} style={{ color: '#22c55e' }} />
              <span>PDF incremental updates</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Check size={14} style={{ color: '#22c55e' }} />
              <span>Producer string analysis</span>
            </div>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar"
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      <div className="sidebar-section">
        <div className="sidebar-title">Upload Documents</div>
        <div 
          className={`upload-zone ${dragActive ? 'drag-active' : ''}`}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            multiple
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          <Upload className="upload-icon" />
          <div className="upload-text">Drag & drop PDFs here</div>
          <div className="upload-text" style={{ fontWeight: 600 }}>or click to browse</div>
          <div className="upload-hint">Requires: Part-I, Land Deed, Faculty List</div>
        </div>

        {files.length > 0 && (
          <div className="file-list">
            {files.map((file) => (
              <div key={file.name} className="file-item">
                {getDocIcon(file.type)}
                <div className="file-info">
                  <div className="file-name">{file.name}</div>
                  <div className="file-meta">
                    {getDocLabel(file.type)} • {formatSize(file.size)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="upload-error" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}

        <button 
          className={`analyze-btn ${step === 'analyzing' ? 'loading' : ''}`}
          onClick={onAnalyze}
          disabled={files.length < 3 || step === 'analyzing'}
        >
          {step === 'analyzing' ? (
            <>
              <Loader2 className="spinner" />
              Analyzing...
            </>
          ) : (
            <>
              <Search size={18} />
              Run Analysis
            </>
          )}
        </button>

        {backendEnabled && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Server size={12} />
              Demo documents from backend
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="demo-btn"
                onClick={() => onLoadDemo('clean')}
                disabled={demoLoading}
                title="Known-good application set — every check should pass"
              >
                {demoLoading && demoVariant === 'clean' ? <Loader2 className="spinner" size={14} /> : <Download size={14} />}
                Clean set
              </button>
              <button
                className="demo-btn"
                onClick={() => onLoadDemo('forged')}
                disabled={demoLoading}
                title="Application set with 7 labeled forgeries"
              >
                {demoLoading && demoVariant === 'forged' ? <Loader2 className="spinner" size={14} /> : <Download size={14} />}
                Forged set
              </button>
            </div>
            {demoVariant && (
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 6 }}>
                Loaded: {demoVariant} set — synthetic documents, labeled mutations
              </div>
            )}
          </div>
        )}
      </div>

      <div className="sidebar-section">
        <div className="sidebar-title">Required Documents</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px', background: 'var(--bg-primary)', borderRadius: 8, border: '1px solid var(--border)' }}>
            <div style={{ width: 32, height: 32, borderRadius: 6, background: 'rgba(59, 130, 246, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <FileText size={16} style={{ color: '#3b82f6' }} />
            </div>
            <div>
              <div style={{ fontWeight: 500 }}>Part-I Application</div>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Institution, society, land, courses, intake</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px', background: 'var(--bg-primary)', borderRadius: 8, border: '1px solid var(--border)' }}>
            <div style={{ width: 32, height: 32, borderRadius: 6, background: 'rgba(34, 197, 94, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <FileText size={16} style={{ color: '#22c55e' }} />
            </div>
            <div>
              <div style={{ fontWeight: 500 }}>Land Document</div>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Sale/lease deed, land-use certificate</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px', background: 'var(--bg-primary)', borderRadius: 8, border: '1px solid var(--border)' }}>
            <div style={{ width: 32, height: 32, borderRadius: 6, background: 'rgba(245, 158, 11, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <FileText size={16} style={{ color: '#f59e0b' }} />
            </div>
            <div>
              <div style={{ fontWeight: 500 }}>Faculty List (FIS)</div>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Names, designations, qualifications, DOJ</div>
            </div>
          </div>
        </div>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-title">What We Check</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: 'var(--fg-secondary)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Search size={14} style={{ color: '#22d3ee' }} />
            <span>Cross-document consistency</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Shield size={14} style={{ color: '#22c55e' }} />
            <span>4 AICTE rule clauses</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={14} style={{ color: '#ef4444' }} />
            <span>Forensic PDF signals</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={14} style={{ color: '#a855f7' }} />
            <span>Vision LLM extraction</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;