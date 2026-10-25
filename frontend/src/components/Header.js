import React from 'react';
import { Shield, RotateCcw } from 'lucide-react';

function Header({ onReset, analysisComplete, mode }) {
  return (
    <header className="header">
      <div className="header-title">
        <Shield size={24} />
        <span>DocuTrust</span>
        <span className="header-badge">SIH 2026 Demo</span>
        {mode && (
          <span className={`header-mode ${mode}`}>
            {mode === 'live' ? 'Live pipeline' : mode === 'cache' ? 'Backend cache' : 'Cached fixture'}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {analysisComplete && (
          <button 
            onClick={onReset}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: 'var(--fg-secondary)',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--fg-secondary)'; }}
          >
            <RotateCcw size={14} />
            New Analysis
          </button>
        )}
        <div style={{ 
          width: 8, 
          height: 8, 
          borderRadius: '50%', 
          background: analysisComplete ? 'var(--success)' : 'var(--fg-muted)',
          boxShadow: analysisComplete ? '0 0 8px var(--success)' : 'none'
        }} />
      </div>
    </header>
  );
}

export default Header;