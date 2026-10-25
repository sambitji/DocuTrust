import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Eye, EyeOff, ZoomIn, ZoomOut, RotateCcw, FileText } from 'lucide-react';

import * as pdfjsLib from 'pdfjs-dist';
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

const DOC_META = {
  part1: { color: '#3b82f6', label: 'Part-I Application' },
  land: { color: '#22c55e', label: 'Land Document' },
  faculty: { color: '#f59e0b', label: 'Faculty List (FIS)' },
};

const PAGE_WIDTH = 595.28; // A4, points
const PAGE_HEIGHT = 841.89;

const SEVERITY_RGB = {
  critical: '239, 68, 68',
  warning: '245, 158, 11',
  info: '59, 130, 246',
};

function PDFViewer({ docType, file, findings, selectedFindingId, showOverlays, onToggleOverlays, onDocChange, onSelectFinding }) {
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const wrapperRef = useRef(null);
  const [viewport, setViewport] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages] = useState(3);
  const [scale, setScale] = useState(1);
  const [status, setStatus] = useState('loading'); // loading | ready | empty
  const [docStatus, setDocStatus] = useState('demo'); // demo | real
  const [resizeTick, setResizeTick] = useState(0);
  const renderTaskRef = useRef(null);

  const color = DOC_META[docType].color;

  // Load the document when it changes. Real File objects go through pdf.js;
  // the committed demo fixture renders a deterministic mock page.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!file) {
        setStatus('empty');
        setViewport(null);
        return;
      }
      setStatus('loading');
      setCurrentPage(1);

      if (file.raw) {
        try {
          const buf = await file.raw.arrayBuffer();
          const doc = await pdfjsLib.getDocument({ data: buf }).promise;
          if (cancelled) return;
          file.docRef = doc;
          setDocStatus('real');
          setStatus('ready');
          return;
        } catch (err) {
          console.warn('[DocuTrust] PDF load failed, falling back to mock page:', err.message);
        }
      }

      if (cancelled) return;
      setDocStatus('demo');
      setStatus('ready');
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [file]);

  const drawMockPage = useCallback((canvas, ctx, page, zoom) => {
    const zoomedWidth = PAGE_WIDTH * zoom;
    const zoomedHeight = PAGE_HEIGHT * zoom;
    canvas.width = zoomedWidth;
    canvas.height = zoomedHeight;
    canvas.style.width = `${zoomedWidth}px`;
    canvas.style.height = `${zoomedHeight}px`;

    ctx.save();
    ctx.scale(zoom, zoom);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);

    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.strokeRect(8, 8, PAGE_WIDTH - 16, PAGE_HEIGHT - 16);

    // Coloured header band
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, PAGE_WIDTH, 66);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 19px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(DOC_META[docType].label, 42, 32);
    ctx.font = '10px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText('SYNTHETIC DEMO DOCUMENT — NOT A REAL FILING', 42, 52);

    let y = 118;
    ctx.textAlign = 'left';
    getMockContent(docType, page).forEach((line) => {
      if (y > PAGE_HEIGHT - 70) return;
      ctx.font = `${line.bold ? 'bold ' : ''}13px Inter, sans-serif`;
      ctx.fillStyle = line.color || '#1e293b';
      ctx.fillText(line.text, 56, y);
      y += 22;
    });

    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Page ${page} of ${numPages}`, PAGE_WIDTH / 2, PAGE_HEIGHT - 30);

    // Rotated watermark
    ctx.save();
    ctx.globalAlpha = 0.1;
    ctx.translate(PAGE_WIDTH / 2, PAGE_HEIGHT / 2);
    ctx.rotate(-Math.PI / 6);
    ctx.font = 'bold 54px Inter, sans-serif';
    ctx.fillStyle = '#ef4444';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SYNTHETIC DATA', 0, 0);
    ctx.restore();

    ctx.restore();
  }, [color, docType, numPages]);

  // Render on any change to page, zoom, document or overlay visibility
  useEffect(() => {
    if (status !== 'ready') return;
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    const ctx = canvas.getContext('2d');
    const cs = getComputedStyle(wrapper);
    const availW = wrapper.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = wrapper.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const fitScale = Math.min(availW / PAGE_WIDTH, availH / PAGE_HEIGHT);
    const zoom = Math.max(fitScale, 0.25) * scale;

    if (file?.docRef) {
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch (e) {
          /* previous render already finished */
        }
      }
      file.docRef.getPage(currentPage).then((page) => {
        const vp = page.getViewport({ scale: zoom });
        canvas.width = vp.width;
        canvas.height = vp.height;
        canvas.style.width = `${vp.width}px`;
        canvas.style.height = `${vp.height}px`;
        const ctx2 = canvas.getContext('2d');
        const task = page.render({ canvasContext: ctx2, viewport: vp });
        renderTaskRef.current = task;
        task.promise.catch((e) => {
          if (e && e.name !== 'RenderingCancelledException') {
            console.warn('[DocuTrust] page render failed:', e.message);
          }
        });
        setViewport({ width: vp.width, height: vp.height, isReal: true });
      }).catch((err) => console.warn('[DocuTrust] page load failed:', err.message));
      return;
    }

    drawMockPage(canvas, ctx, currentPage, zoom);
    setViewport({ width: PAGE_WIDTH * zoom, height: PAGE_HEIGHT * zoom, isReal: false });
  }, [status, file, currentPage, scale, docType, drawMockPage, resizeTick]);

  // Map normalized bboxes onto the canvas once it has been drawn
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || !viewport || !showOverlays) {
      if (overlay) overlay.innerHTML = '';
      return;
    }

    overlay.innerHTML = '';
    overlay.style.width = `${viewport.width}px`;
    overlay.style.height = `${viewport.height}px`;
    overlay.style.pointerEvents = 'auto';

    const pageFindings = findings.filter((f) =>
      f.evidence.some((e) => e.doc_id === docType && e.page === currentPage)
    );

    pageFindings.forEach((finding) => {
      finding.evidence
        .filter((e) => e.doc_id === docType && e.page === currentPage)
        .forEach((ev, idx) => {
          const box = document.createElement('div');
          box.className = `finding-highlight ${finding.severity}`;
          if (finding.id === selectedFindingId) box.classList.add('active');

          const x0 = ev.bbox.x0 * viewport.width;
          const x1 = ev.bbox.x1 * viewport.width;
          // PDF origin is bottom-left, canvas origin is top-left: flip Y.
          const yTop = (1 - ev.bbox.y1) * viewport.height;
          const yBottom = (1 - ev.bbox.y0) * viewport.height;

          box.style.left = `${x0}px`;
          box.style.top = `${yTop}px`;
          box.style.width = `${Math.max(x1 - x0, 4)}px`;
          box.style.height = `${Math.max(yBottom - yTop, 4)}px`;
          box.style.pointerEvents = 'auto';
          box.style.cursor = 'pointer';

          const tooltip = document.createElement('div');
          tooltip.className = 'finding-tooltip';
          tooltip.innerHTML = `<strong>${finding.title}</strong><br><span>${ev.field.replace(/_/g, ' ')} — ${escapeHtml(ev.value)}</span>`;
          box.appendChild(tooltip);

          box.addEventListener('click', () => onSelectFinding && onSelectFinding(finding.id));
          overlay.appendChild(box);

          // Full-page forensic ring: draw as a dashed outline, not a solid block
          if (ev.bbox.x0 < 0.05 && ev.bbox.y0 < 0.05) {
            box.style.background = 'transparent';
            box.style.borderStyle = 'dashed';
            box.style.width = `${viewport.width - 16}px`;
            box.style.height = `${viewport.height - 16}px`;
            box.style.left = '8px';
            box.style.top = '8px';
          }
        });
    });
  }, [viewport, findings, docType, currentPage, showOverlays, selectedFindingId, onSelectFinding]);

  // Re-fit when the container changes size. A ResizeObserver covers window
  // resizes, sidebar/dock changes and late webfont loads that shift layout.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || typeof ResizeObserver === 'undefined') return undefined;

    let timer = null;
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => setResizeTick((t) => t + 1), 100);
    });
    ro.observe(wrapper);

    const onFonts = () => setResizeTick((t) => t + 1);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(onFonts).catch(() => {});

    return () => {
      ro.disconnect();
      clearTimeout(timer);
    };
  }, []);

  const gotoPage = (p) => {
    if (p < 1 || p > numPages) return;
    setCurrentPage(p);
  };

  if (status === 'empty') {
    return (
      <div className="pdf-viewer-container" style={{ display: 'grid', placeItems: 'center' }}>
        <div style={{ textAlign: 'center', color: 'var(--fg-muted)' }}>
          <FileText size={64} style={{ opacity: 0.3, margin: '0 auto 16px' }} />
          <div>No document selected</div>
        </div>
      </div>
    );
  }

  const selected = findings.find((f) => f.id === selectedFindingId);

  return (
    <div className="pdf-viewer-container">
      <div className="doc-switcher">
        {Object.entries(DOC_META).map(([key, meta]) => (
          <button
            key={key}
            onClick={() => onDocChange(key)}
            className={`doc-tab ${docType === key ? 'active' : ''}`}
            style={
              docType === key
                ? { background: meta.color, borderColor: meta.color, color: '#0f172a' }
                : undefined
            }
          >
            <FileText size={13} />
            {meta.label}
          </button>
        ))}
      </div>

      {selected && (
        <div
          className="selected-banner"
          style={{
            background: `rgba(${SEVERITY_RGB[selected.severity]}, 0.15)`,
            borderColor: `rgb(${SEVERITY_RGB[selected.severity]})`,
          }}
        >
          <span
            className="dot"
            style={{ background: `rgb(${SEVERITY_RGB[selected.severity]})` }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{selected.title}</div>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
              {selected.evidence.filter((e) => e.doc_id === docType && e.page === currentPage).length}{' '}
              evidence marker(s) on this page — {selected.severity.toUpperCase()} / {selected.kind}
            </div>
          </div>
        </div>
      )}

      <div className="pdf-canvas-wrapper" ref={wrapperRef}>
        {status === 'loading' ? (
          <div style={{ textAlign: 'center', color: 'var(--fg-muted)' }}>
            <div className="spinner" style={{ width: 32, height: 32, margin: '0 auto 16px' }} />
            <div>Loading {DOC_META[docType].label}...</div>
          </div>
        ) : (
          <div className="canvas-stack">
            <canvas ref={canvasRef} className="pdf-page-canvas" />
            <div ref={overlayRef} className="pdf-finding-overlay" />
          </div>
        )}
      </div>

      <div className="pdf-controls">
        <button className="pdf-control-btn" onClick={() => gotoPage(currentPage - 1)} disabled={currentPage <= 1} title="Previous page">
          <ChevronLeft size={18} />
        </button>
        <div className="pdf-page-indicator">
          Page {currentPage} / {numPages}
        </div>
        <button className="pdf-control-btn" onClick={() => gotoPage(currentPage + 1)} disabled={currentPage >= numPages} title="Next page">
          <ChevronRight size={18} />
        </button>

        <div className="ctrl-sep" />

        <button className="pdf-control-btn" onClick={() => setScale((s) => Math.max(s / 1.2, 0.5))} title="Zoom out">
          <ZoomOut size={18} />
        </button>
        <button className="pdf-control-btn" onClick={() => setScale(1)} title="Reset zoom">
          <RotateCcw size={18} />
        </button>
        <button className="pdf-control-btn" onClick={() => setScale((s) => Math.min(s * 1.2, 3))} title="Zoom in">
          <ZoomIn size={18} />
        </button>

        <div className="ctrl-sep" />

        <button
          className={`pdf-control-btn ${showOverlays ? 'on' : ''}`}
          onClick={() => onToggleOverlays(!showOverlays)}
          title={showOverlays ? 'Hide findings' : 'Show findings'}
        >
          {showOverlays ? <Eye size={18} /> : <EyeOff size={18} />}
        </button>
      </div>

      <div className="doc-footnote">
        {docStatus === 'demo' ? 'Committed demo fixture' : 'Uploaded document'} · findings shown as
        risk signals, not verdicts
      </div>
    </div>
  );
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function getMockContent(type, pageNum) {
  const catalogue = {
    part1: [
      [
        { text: 'AICTE APPROVAL PROCESS 2024-27', bold: true, color: '#3b82f6' },
        { text: 'Part-I: Institutional Information', bold: true },
        { text: '' },
        { text: '1.  Institution Name: Sri Venkateswara Institute of Technology' },
        { text: '2.  Society/Trust Name: Sri Venkateswara Educational Society' },
        { text: '3.  Address: Survey No. 45/2, Outer Ring Road, Hyderabad - 500075' },
        { text: '4.  District: Hyderabad    State: Telangana' },
        { text: '5.  Area Type: Metro/Urban' },
        { text: '6.  Land Area: 7,284 sqm (1.8 acres)' },
        { text: '7.  Program Count: 7' },
        { text: '8.  Total Approved Intake: 840' },
        { text: '9.  Built-up Area: 8,500 sqm' },
        { text: '' },
        { text: 'Programs Offered: CSE, ECE, ME, CE, EEE, IT, AIML' },
      ],
      [
        { text: 'PROGRAM DETAILS & INTAKE', bold: true, color: '#3b82f6' },
        { text: '' },
        { text: 'Total Programs: 7', bold: true },
        { text: 'Total Approved Intake: 840', bold: true },
        { text: '' },
        { text: 'Course-wise Intake:' },
        { text: '  * Computer Science & Engineering: 120' },
        { text: '  * Electronics & Communication: 120' },
        { text: '  * Mechanical Engineering: 120' },
        { text: '  * Civil Engineering: 120' },
        { text: '  * Electrical & Electronics: 120' },
        { text: '  * Information Technology: 120' },
        { text: '  * AI & Machine Learning: 120' },
      ],
      [
        { text: 'INFRASTRUCTURE & FACILITIES', bold: true, color: '#3b82f6' },
        { text: '' },
        { text: 'Classrooms: 28   Tutorial Rooms: 7' },
        { text: 'Laboratories: 21   Workshops: 3' },
        { text: 'Library Area: 400 sqm   Reading Room: 150 sqm' },
        { text: 'Computer Center: 150 sqm   Internet: 1 Gbps' },
        { text: 'Hostel Capacity: Boys 300, Girls 200' },
      ],
    ],
    land: [
      [
        { text: 'SALE DEED / LAND DOCUMENT', bold: true, color: '#22c55e' },
        { text: '' },
        { text: 'Document No: 12345/2023   Date: 20-11-2023', bold: true },
        { text: '' },
        { text: 'Vendor: Sri Venkateshwara Educational Society' },
        { text: 'Purchaser: Sri Venkateshwara Institute of Technology' },
        { text: '' },
        { text: 'Property Description:', bold: true },
        { text: '  Survey No: 45/2' },
        { text: '  Village: Hyderabad' },
        { text: '  District: Hyderabad' },
        { text: '  Plot Area: 7,284 sqm (1.8 acres)' },
        { text: '  Boundaries: North - Road, South - Vacant Land' },
        { text: '  East - Nala, West - Compound Wall' },
      ],
      [
        { text: 'LAND USE CERTIFICATE', bold: true, color: '#22c55e' },
        { text: '' },
        { text: 'Certified that the land measuring 7,284 sqm in Survey No. 45/2,' },
        { text: 'Hyderabad Village, Hyderabad District is classified as' },
        { text: '"Educational Use" as per Master Plan.' },
        { text: '' },
        { text: 'Issued by: Tahsildar, Hyderabad' },
        { text: 'Date: 15-11-2023   Valid: 5 years' },
        { text: '' },
        { text: 'Encumbrance Certificate: Nil' },
        { text: 'Mutation Entry: Completed 25-11-2023' },
      ],
      [
        { text: 'LEASE AGREEMENT', bold: true, color: '#22c55e' },
        { text: '' },
        { text: 'Lessor: Sri Venkateshwara Educational Society' },
        { text: 'Lessee: Sri Venkateswara Institute of Technology' },
        { text: 'Term: 99 years   Commencing: 01-12-2023' },
        { text: 'Annual Lease Rent: Rs. 1,00,000' },
        { text: '' },
        { text: 'Registered at Sub-Registrar Office, Hyderabad on 20-11-2023' },
      ],
    ],
    faculty: [
      [
        { text: 'FACULTY INFORMATION SYSTEM (FIS)', bold: true, color: '#f59e0b' },
        { text: 'AICTE Format - Academic Year 2024-25', color: '#64748b' },
        { text: '' },
        { text: 'PRINCIPAL / DIRECTOR', bold: true },
        { text: '  Name: Dr. R. Venkatesan' },
        { text: '  Qualification: Ph.D. (Computer Science)' },
        { text: '  Total Experience: 18 years' },
        { text: '  Professor Experience: 6 years' },
        { text: '  Date of Joining: 01-06-2020' },
        { text: '' },
        { text: 'TOTAL FACULTY COUNT: 42', bold: true },
        { text: '  Professors: 6   Associate: 10   Assistant: 26' },
      ],
      [
        { text: 'DEPARTMENT-WISE FACULTY DISTRIBUTION', bold: true, color: '#f59e0b' },
        { text: '' },
        { text: 'Computer Science & Engg (Intake: 120):', bold: true },
        { text: '  Prof: 2  Assoc: 2  Asst: 4  Total: 8' },
        { text: 'Electronics & Comm (Intake: 120):', bold: true },
        { text: '  Prof: 1  Assoc: 2  Asst: 4  Total: 7' },
        { text: 'Mechanical Engg (Intake: 120):', bold: true },
        { text: '  Prof: 1  Assoc: 1  Asst: 5  Total: 7' },
        { text: 'Civil Engg (Intake: 120):', bold: true },
        { text: '  Prof: 1  Assoc: 1  Asst: 4  Total: 6' },
      ],
      [
        { text: 'REMAINING DEPARTMENTS', bold: true, color: '#f59e0b' },
        { text: '' },
        { text: 'Electrical & Electronics (120):', bold: true },
        { text: '  Prof: 1  Assoc: 1  Asst: 4  Total: 6' },
        { text: 'Information Technology (120):', bold: true },
        { text: '  Prof: 0  Assoc: 1  Asst: 4  Total: 5' },
        { text: 'AI & ML (120):', bold: true },
        { text: '  Prof: 1  Assoc: 0  Asst: 2  Total: 3' },
        { text: '' },
        { text: 'GRAND TOTAL: 42 Faculty', bold: true },
        { text: 'Faculty-Student Ratio: 1:20', bold: true, color: '#f59e0b' },
      ],
    ],
  };
  return (catalogue[type] && catalogue[type][pageNum - 1]) || [];
}

export default PDFViewer;
