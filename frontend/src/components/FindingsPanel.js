import React from 'react';
import { AlertTriangle, Info, CheckCircle, XCircle, Shield, Search, Hash, Clock, FileText } from 'lucide-react';

function FindingsPanel({ findings, selectedFinding, onSelectFinding, onApprove, onOverride, extracted }) {
  if (findings.length === 0) {
    return (
      <div className="findings-panel">
        <div className="empty-state" style={{ height: '100%' }}>
          <FileText className="empty-icon" />
          <div className="empty-title">No Findings Yet</div>
          <div className="empty-desc">Run analysis to see validation results here.</div>
        </div>
      </div>
    );
  }

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'critical': return <AlertTriangle size={14} />;
      case 'warning': return <AlertTriangle size={14} />;
      case 'info': return <Info size={14} />;
    }
  };

  const getKindIcon = (kind) => {
    switch (kind) {
      case 'consistency': return <Search size={12} />;
      case 'rule': return <Shield size={12} />;
      case 'forensic': return <Hash size={12} />;
    }
  };

  const getKindLabel = (kind) => {
    switch (kind) {
      case 'consistency': return 'Consistency';
      case 'rule': return 'Rule Violation';
      case 'forensic': return 'Forensic Signal';
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return '#ef4444';
      case 'warning': return '#f59e0b';
      case 'info': return '#3b82f6';
    }
  };

  return (
    <div className="findings-panel">
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Findings ({findings.length})</h2>
          <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
            Click a finding to view evidence on the document. Risk signals only — not verdicts.
          </p>
        </div>
        <div className="reviews-summary">
          <span><b>{findings.filter((f) => f.status === 'approve').length}</b> approved</span>
          <span><b>{findings.filter((f) => f.status === 'override').length}</b> overridden</span>
        </div>
      </div>

      <div className="findings-list">
        {findings.map((finding) => (
          <FindingCard
            key={finding.id}
            finding={finding}
            isSelected={selectedFinding?.id === finding.id}
            onClick={() => onSelectFinding(finding)}
            onApprove={() => onApprove(finding.id)}
            onOverride={() => onOverride(finding.id)}
            getSeverityIcon={getSeverityIcon}
            getKindIcon={getKindIcon}
            getKindLabel={getKindLabel}
            getSeverityColor={getSeverityColor}
          />
        ))}
      </div>

      <div style={{ marginTop: 24, padding: 16, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-muted)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Extracted Fields Summary</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          {Object.entries(extracted).map(([docType, fields]) => (
            <div key={docType} style={{ fontSize: 11 }}>
              <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: 6, textTransform: 'capitalize' }}>
                {docType === 'part1' ? 'Part-I' : docType === 'land' ? 'Land Doc' : 'Faculty'}
              </div>
              {Object.entries(fields).slice(0, 4).map(([field, value]) => (
                <div key={field} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ color: 'var(--fg-muted)' }}>{field.replace(/_/g, ' ')}</span>
                  <span style={{ color: 'var(--fg-primary)', fontFamily: 'monospace', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FindingCard({ finding, isSelected, onClick, onApprove, onOverride, getSeverityIcon, getKindIcon, getKindLabel, getSeverityColor }) {
  return (
    <div 
      className={`finding-card ${finding.severity} ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
      style={{ 
        cursor: 'pointer',
        background: isSelected ? 'rgba(34, 211, 238, 0.03)' : 'var(--card-bg)',
        borderColor: isSelected ? 'var(--accent)' : finding.severity === 'critical' ? 'rgba(239, 68, 68, 0.5)' : finding.severity === 'warning' ? 'rgba(245, 158, 11, 0.5)' : 'rgba(59, 130, 246, 0.5)',
        boxShadow: isSelected ? '0 0 0 1px var(--accent), 0 4px 20px rgba(0,0,0,0.2)' : 'none'
      }}
    >
      <div className="finding-header">
        <div className="finding-title-row">
          <span 
            className={`finding-severity ${finding.severity}`}
            style={{ background: `${getSeverityColor(finding.severity)}15`, color: getSeverityColor(finding.severity) }}
          >
            {getSeverityIcon(finding.severity)}
            {finding.severity}
          </span>
          <span className="finding-kind">
            {getKindIcon(finding.kind)}
            {getKindLabel(finding.kind)}
          </span>
        </div>
        <span className="finding-confidence">
          <Clock size={10} style={{ marginRight: 4, verticalAlign: 'middle' }} />
          {Math.round(finding.confidence * 100)}%
        </span>
      </div>

      <div className="finding-title">{finding.title}</div>
      <div className="finding-detail">{finding.detail}</div>

      <div className="finding-evidence">
        {finding.evidence.slice(0, 3).map((ev, idx) => (
          <div key={idx} className="evidence-item">
            <span className="evidence-doc">{ev.doc_id.toUpperCase()}</span>
            <span className="evidence-field">{ev.field.replace(/_/g, ' ')}</span>
            <span className="evidence-value" style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ev.value}
            </span>
            <span className="evidence-page">p.{ev.page}</span>
          </div>
        ))}
        {finding.evidence.length > 3 && (
          <div className="evidence-item" style={{ justifyContent: 'center', color: 'var(--fg-muted)' }}>
            +{finding.evidence.length - 3} more evidence items
          </div>
        )}
      </div>

      {finding.citation && (
        <div className="finding-citation">
          <span className="citation-clause">{finding.citation.clause}</span>
          {/* quote is printed only for human-verified clauses; an unverified
              rule cites the clause category alone (backend citation policy) */}
          {finding.citation.quote ? (
            <span>"{finding.citation.quote}"</span>
          ) : (
            <span className="citation-unverified">clause quote pending verification against printed APH</span>
          )}
        </div>
      )}

      <div className="finding-actions">
        <button 
          className="action-btn approve"
          onClick={(e) => { e.stopPropagation(); onApprove(); }}
          disabled={finding.status === 'approve'}
        >
          <CheckCircle size={14} />
          {finding.status === 'approve' ? 'Approved' : 'Approve'}
        </button>
        <button 
          className="action-btn override"
          onClick={(e) => { e.stopPropagation(); onOverride(); }}
          disabled={finding.status === 'override'}
        >
          <XCircle size={14} />
          {finding.status === 'override' ? 'Overridden' : 'Override'}
        </button>
      </div>
    </div>
  );
}

export default FindingsPanel;