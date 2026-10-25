import React from 'react';
import { Shield, AlertTriangle } from 'lucide-react';

function Footer() {
  return (
    <footer className="footer">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Shield size={14} />
        <span>DocuTrust — AI-Powered Application Validation for AICTE</span>
      </div>
      <div className="footer-disclaimer" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <AlertTriangle size={12} />
        <span>Risk signals only — not verdicts. Officer review required.</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 11 }}>
        <span>v0.1.0-demo</span>
        <span>SIH 2026</span>
      </div>
    </footer>
  );
}

export default Footer;