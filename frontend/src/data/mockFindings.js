/**
 * Committed demo fixture: 5 findings across a synthetic application set.
 *
 * Used as the fallback path so the demo never depends on backend/network.
 *
 * Contract:
 *  - bbox = { x0, y0, x1, y1 } normalized to 0-1
 *  - origin is PDF bottom-left (viewer flips Y when drawing)
 *  - page is 1-indexed
 *
 * Coordinates are aligned to the mock page text drawn in
 * components/PDFViewer.js (A4, content starts at y=118px, 22px line pitch,
 * text begins at x=56px). Changing that layout means re-deriving these.
 */
const MOCK_FINDINGS = [
  {
    id: 'FND-001',
    severity: 'critical',
    kind: 'consistency',
    title: 'Institution Name Mismatch Across Documents',
    detail:
      'The institution name in Part-I application ("Sri Venkateswara Institute of Technology") does not match the land deed ("Sri Venkateshwara Institute of Technology") — spelling variation "Venkateswara" vs "Venkateshwara".',
    confidence: 0.95,
    evidence: [
      {
        doc_id: 'part1',
        page: 1,
        bbox: { x0: 0.094, y0: 0.777, x1: 0.817, y1: 0.798 },
        field: 'institution_name',
        value: 'Sri Venkateswara Institute of Technology',
      },
      {
        doc_id: 'land',
        page: 1,
        bbox: { x0: 0.094, y0: 0.724, x1: 0.665, y1: 0.746 },
        field: 'institution_name',
        value: 'Sri Venkateshwara Institute of Technology',
      },
    ],
    citation: {
      clause: 'APH 2024-27, Clause 2.1.3',
      quote: 'The name of the institution shall be consistent across all submitted documents.',
      source_url: 'https://www.aicte-india.org/sites/default/files/APH%202024-27.pdf',
    },
  },
  {
    id: 'FND-002',
    severity: 'critical',
    kind: 'rule',
    title: 'Land Area Below Minimum Requirement',
    detail:
      'Declared land area (1.8 acres / 7284 sqm) is below the minimum 2.5 acres (10117 sqm) required for 7 programs in a metro location per Appendix 4.',
    confidence: 1.0,
    evidence: [
      {
        doc_id: 'part1',
        page: 1,
        bbox: { x0: 0.094, y0: 0.646, x1: 0.514, y1: 0.667 },
        field: 'land_area_sqm',
        value: '7284',
      },
      {
        doc_id: 'part1',
        page: 1,
        bbox: { x0: 0.094, y0: 0.620, x1: 0.396, y1: 0.641 },
        field: 'program_count',
        value: '7',
      },
      {
        doc_id: 'land',
        page: 1,
        bbox: { x0: 0.094, y0: 0.568, x1: 0.531, y1: 0.589 },
        field: 'plot_area_sqm',
        value: '7284',
      },
    ],
    citation: {
      clause: 'APH 2024-27, Clause 4.1.1 & Appendix 4',
      quote:
        'Minimum land requirement for Engineering institutions: 2.5 acres (10117 sqm) for metro/urban areas with 6-10 programs.',
      source_url: 'https://www.aicte-india.org/sites/default/files/APH%202024-27.pdf',
    },
  },
  {
    id: 'FND-003',
    severity: 'warning',
    kind: 'rule',
    title: 'Faculty-Student Ratio Below 1:20',
    detail:
      'Total faculty count (42) against approved intake (840) yields 1:20 ratio — at threshold. Any intake increase or faculty departure violates Clause 7.2.1.',
    confidence: 0.88,
    evidence: [
      {
        doc_id: 'part1',
        page: 2,
        bbox: { x0: 0.094, y0: 0.777, x1: 0.548, y1: 0.798 },
        field: 'total_intake',
        value: '840',
      },
      {
        doc_id: 'faculty',
        page: 1,
        bbox: { x0: 0.094, y0: 0.594, x1: 0.464, y1: 0.615 },
        field: 'total_faculty',
        value: '42',
      },
    ],
    citation: {
      clause: 'APH 2024-27, Clause 7.2.1',
      quote: 'The faculty-student ratio shall be 1:20 for UG programs in Engineering and Technology.',
      source_url: 'https://www.aicte-india.org/sites/default/files/APH%202024-27.pdf',
    },
  },
  {
    id: 'FND-004',
    severity: 'critical',
    kind: 'forensic',
    title: 'PDF Incremental Update Detected — Land Deed Modified After Signing',
    detail:
      'Land deed PDF contains 3 incremental updates. The last update (modification date: 2024-01-15 14:32:00) occurs after the stated execution date (2023-11-20). Producer string shows "iText 7.1.17" — a programmatic PDF library, not a scanner or standard office software.',
    confidence: 0.92,
    evidence: [
      {
        doc_id: 'land',
        page: 1,
        // Full-page marker: x0/y0 below 0.05 is drawn as a dashed page outline
        // rather than a solid block, so it never obscures the document.
        bbox: { x0: 0.02, y0: 0.02, x1: 0.98, y1: 0.98 },
        field: 'pdf_metadata',
        value: 'Incremental updates: 3, Producer: iText 7.1.17, ModDate: D:20240115143200',
      },
    ],
    citation: null,
  },
  {
    id: 'FND-005',
    severity: 'info',
    kind: 'consistency',
    title: 'Course Intake Consistency Verified',
    detail:
      'Course-wise intake declared in Part-I matches the faculty distribution in FIS file. All 7 programs have corresponding faculty entries.',
    confidence: 0.98,
    evidence: [
      {
        doc_id: 'part1',
        page: 2,
        bbox: { x0: 0.094, y0: 0.542, x1: 0.665, y1: 0.720 },
        field: 'course_list',
        value: 'CSE:120, ECE:120, ME:120, CE:120, EEE:120, IT:120, AIML:120',
      },
      {
        doc_id: 'faculty',
        page: 2,
        bbox: { x0: 0.094, y0: 0.620, x1: 0.649, y1: 0.824 },
        field: 'dept_faculty_count',
        value: 'CSE:8, ECE:7, ME:7, CE:6, EEE:6, IT:5, AIML:3',
      },
    ],
    citation: {
      clause: 'APH 2024-27, Clause 7.1.2',
      quote: 'Faculty shall be appointed for each approved program as per prescribed norms.',
      source_url: 'https://www.aicte-india.org/sites/default/files/APH%202024-27.pdf',
    },
  },
];

export default MOCK_FINDINGS;
