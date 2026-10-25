/**
 * End-to-end smoke test for the DocuTrust frontend.
 *
 * Drives the real UI in headless Chrome: upload screen -> run analysis ->
 * findings -> bbox overlays -> approve -> document switch -> overlay toggle ->
 * reset -> responsive layout. Asserts on rendered geometry, not just text.
 *
 * Two modes:
 *   node scripts/smoke.js                     # fixture mode (no backend)
 *   SMOKE_LIVE=1 node scripts/smoke.js        # live mode (backend required)
 *
 * Live mode exercises the real pipeline path: loads the FORGED synthetic set
 * from GET /demo/pdf, analyzes through POST /analyze (7 labeled mutations
 * expected), then loads the CLEAN set and expects the cached all-clear
 * (CONS_VERIFIED only, served from the backend cache).
 *
 * Prerequisites:
 *   npm i -D puppeteer-core
 *   npx serve -s build -l 4173      (or `npm start` on :3000)
 *   live mode: uvicorn backend.main:app --port 8000 AND a frontend build
 *   with REACT_APP_API_URL=http://localhost:8000 baked in
 *
 * Run:
 *   node scripts/smoke.js                       # against localhost:4173
 *   SMOKE_URL=http://localhost:3000 node scripts/smoke.js
 *   CHROME_PATH="C:\...\chrome.exe" node scripts/smoke.js
 *
 * Exits 1 if any check fails, 2 on crash.
 */
const puppeteer = require('puppeteer-core');

const URL = process.env.SMOKE_URL || 'http://localhost:4173';
const LIVE = process.env.SMOKE_LIVE === '1' || process.argv.includes('--live');
const CHROME =
  process.env.CHROME_PATH ||
  [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].find((p) => {
    try {
      require('fs').accessSync(p);
      return true;
    } catch (e) {
      return false;
    }
  });

// Expectations per mode. Fixture: the committed 5-finding forged demo.
// Live: the real pipeline on the forged synthetic set (7 labeled mutations).
const EXPECT = LIVE
  ? { findings: 7, critical: '4 Critical', warning: '3 Warning', info: '0 Info', badge: ['Live pipeline', 'Backend cache'] }
  : { findings: 5, critical: '3 Critical', warning: '1 Warning', info: '1 Info', badge: ['Cached fixture'] };

const results = [];
const errors = [];
let browser; // kept at module scope so the crash handler can dump state
const check = (name, cond, detail = '') => results.push({ name, pass: !!cond, detail });

async function settleCanvas(page) {
  await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));
  let prev = null;
  let stable = 0;
  for (let i = 0; i < 40 && stable < 3; i++) {
    const cur = await page.$eval('.pdf-page-canvas', (c) => `${c.width}x${c.height}`);
    stable = cur === prev ? stable + 1 : 0;
    prev = cur;
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function runAnalysis(page, { expectHighlights = true } = {}) {
  await page.click('.analyze-btn');
  await page.waitForSelector('.finding-card', { timeout: 30000 });
  // The canvas renders asynchronously (pdf.js fetch + parse of the real
  // document in live mode), and highlights attach after the first page
  // render — wait for the canvas before the highlights.
  await page.waitForSelector('.pdf-page-canvas', { timeout: 30000 });
  // The clean set's single CONS_VERIFIED finding carries no evidence, so no
  // highlight will ever appear — callers opt out for that flow.
  if (expectHighlights) {
    await page.waitForSelector('.finding-highlight', { timeout: 30000 });
  }
  await settleCanvas(page);
}

(async () => {
  if (!CHROME) throw new Error('Chrome/Edge not found — set CHROME_PATH');

  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });

  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });

  // --- Upload screen ---
  check('header shows DocuTrust', await page.$eval('.header-title', (e) => e.textContent).then((t) => t.includes('DocuTrust')));
  check('upload zone present', !!(await page.$('.upload-zone')));
  check(
    'risk-signal disclaimer in footer',
    await page.$eval('.footer', (e) => e.textContent).then((t) => t.includes('not verdicts'))
  );

  if (LIVE) {
    const preListed = (await page.$$('.file-item')).length;
    check('no files pre-listed in live mode', preListed === 0, `got ${preListed}`);
    const demoBtns = await page.$$('.demo-btn');
    check('backend demo buttons shown', demoBtns.length === 2, `got ${demoBtns.length}`);
    check('run button disabled before demo load', await page.$eval('.analyze-btn', (b) => b.disabled));

    await demoBtns[1].click(); // forged set
    await page.waitForFunction(() => document.querySelectorAll('.file-item').length === 3, { timeout: 20000 });
    check('3 demo files loaded from backend', true);
    check('run button enabled after demo load', await page.$eval('.analyze-btn', (b) => !b.disabled));
  } else {
    check('3 demo files listed', (await page.$$('.file-item')).length === 3);
  }
  check('run button enabled', await page.$eval('.analyze-btn', (b) => !b.disabled));

  // --- Run analysis ---
  await runAnalysis(page);

  const cardCount = (await page.$$('.finding-card')).length;
  check(`${EXPECT.findings} findings rendered`, cardCount === EXPECT.findings, `got ${cardCount}`);

  const badges = await page.$$eval('.summary-badge', (els) => els.map((e) => e.textContent.trim()));
  check(
    'severity counts correct',
    badges.some((b) => b.includes(EXPECT.critical)) &&
      badges.some((b) => b.includes(EXPECT.warning)) &&
      badges.some((b) => b.includes(EXPECT.info)),
    JSON.stringify(badges)
  );

  const mode = await page.$eval('.header-mode', (e) => e.textContent).catch(() => null);
  check('data-source badge shown', !!mode && EXPECT.badge.includes(mode), String(mode));

  // --- Overlay geometry ---
  const hlCount = (await page.$$('.finding-highlight')).length;
  check('bbox highlights drawn on viewer', hlCount >= 2, `got ${hlCount}`);

  const canvasBox = await page.$eval('.pdf-page-canvas', (c) => ({ w: c.width, h: c.height }));
  check('canvas has non-zero size', canvasBox.w > 100 && canvasBox.h > 100, JSON.stringify(canvasBox));

  const overlayBox = await page.$eval('.pdf-finding-overlay', (o) => ({ w: o.style.width, h: o.style.height }));
  const ow = parseFloat(overlayBox.w);
  const oh = parseFloat(overlayBox.h);
  check(
    'overlay matches canvas size',
    Math.abs(ow - canvasBox.w) < 2 && Math.abs(oh - canvasBox.h) < 2,
    `overlay ${ow}x${oh} vs canvas ${canvasBox.w}x${canvasBox.h}`
  );

  const bounds = await page.evaluate(() => {
    const c = document.querySelector('.pdf-page-canvas').getBoundingClientRect();
    const hs = [...document.querySelectorAll('.finding-highlight')].map((h) => h.getBoundingClientRect());
    return { canvas: { l: c.left, t: c.top, r: c.right, b: c.bottom }, hs };
  });
  const outside = bounds.hs
    .map((h, i) => ({
      i,
      l: Math.round(h.left - bounds.canvas.l),
      r: Math.round(h.right - bounds.canvas.r),
      t: Math.round(h.top - bounds.canvas.t),
      b: Math.round(h.bottom - bounds.canvas.b),
    }))
    .filter((v) => v.l < -1 || v.r > 1 || v.t < -1 || v.b > 1);
  check('highlights stay inside the page', outside.length === 0, outside.length ? JSON.stringify(outside) : `${bounds.hs.length} boxes`);

  // --- Page is not blank ---
  const ink = await page.evaluate(() => {
    const c = document.querySelector('.pdf-page-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let nonWhite = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235) nonWhite++;
    }
    return { nonWhite, total: d.length / 4 };
  });
  check('page renders visible content', ink.nonWhite > 5000, `${ink.nonWhite} non-white pixels of ${ink.total}`);

  const citation = await page.$eval('.finding-citation', (e) => e.textContent).catch(() => '');
  check('AICTE clause cited', citation.includes('APH 2024-27'), citation.slice(0, 60));

  // --- Approve flow ---
  await page.click('.finding-card .action-btn.approve');
  const approveLabel = await page.$eval('.finding-card .action-btn.approve', (e) => e.textContent.trim());
  check('approve updates button state', approveLabel === 'Approved', approveLabel);
  const reviews = await page.$eval('.reviews-summary', (e) => e.textContent).catch(() => '');
  check('review tally updates', reviews.includes('1 approved'), reviews);

  // --- Document switch ---
  const tabs = await page.$$('.doc-tab');
  check('3 document tabs', tabs.length === 3, `got ${tabs.length}`);
  await tabs[1].click();
  await new Promise((r) => setTimeout(r, 400));
  const landHigh = (await page.$$('.finding-highlight')).length;
  check('land document renders highlights', landHigh >= 1, `got ${landHigh}`);
  const dashed = await page.$$eval('.finding-highlight', (els) =>
    els.filter((h) => getComputedStyle(h).borderStyle === 'dashed').length
  );
  check('forensic finding draws dashed page outline', dashed === 1, `got ${dashed}`);
  const footnote = await page.$eval('.doc-footnote', (e) => e.textContent).catch(() => '');
  check('viewer footnote present', footnote.includes('risk signals'), footnote);

  // --- Overlay toggle ---
  await page.click('.pdf-control-btn[title="Show findings"], .pdf-control-btn[title="Hide findings"]');
  await new Promise((r) => setTimeout(r, 250));
  const afterToggle = (await page.$$('.finding-highlight')).length;
  check('overlay toggle hides highlights', afterToggle === 0, `got ${afterToggle}`);

  // --- Reset returns to upload (files preserved) ---
  await page.click('.header button');
  await new Promise((r) => setTimeout(r, 400));
  check('reset returns to upload', !!(await page.$('.upload-zone')));

  // --- LIVE extra: cached all-clear on the clean set -----------------------
  if (LIVE) {
    const demoBtns2 = await page.$$('.demo-btn');
    await demoBtns2[0].click(); // clean set
    await page.waitForFunction(() => document.body.textContent.includes('Loaded: clean set'), { timeout: 20000 });
    await runAnalysis(page, { expectHighlights: false });

    const cleanCount = (await page.$$('.finding-card')).length;
    check('clean set renders exactly 1 finding (CONS_VERIFIED)', cleanCount === 1, `got ${cleanCount}`);

    const cleanMode = await page.$eval('.header-mode', (e) => e.textContent).catch(() => null);
    check('clean set served from backend cache', cleanMode === 'Backend cache', String(cleanMode));

    const verified = await page.$eval('.finding-card', (e) => e.textContent).catch(() => '');
    check('clean set carries the all-clear summary', verified.includes('Cross-Document Consistency Verified'), verified.slice(0, 60));
  }

  // --- Responsive ---
  await page.setViewport({ width: 900, height: 900 });
  await new Promise((r) => setTimeout(r, 500));
  check('responsive layout intact', await page.$eval('.sidebar', (e) => e.getBoundingClientRect().width > 0));

  await browser.close();

  let failed = 0;
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  [${r.detail}]` : ''}`);
    if (!r.pass) failed++;
  }
  console.log(errors.length ? `\nRUNTIME ERRORS:\n  ${errors.join('\n  ')}` : '\nNo runtime errors.');
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(async (e) => {
  console.error('SMOKE TEST CRASHED:', e.message);
  if (typeof errors !== 'undefined' && errors.length) {
    console.error('CONSOLE/PAGE ERRORS SEEN:\n  ' + errors.join('\n  '));
  }
  try {
    const page = (await browser.pages()).pop();
    if (page) {
      await page.screenshot({ path: 'C:\\Users\\sambi\\AppData\\Local\\Temp\\opencode\\smoke\\smoke_crash.png' });
      const state = await page.evaluate(() => ({
        url: location.href,
        cards: document.querySelectorAll('.finding-card').length,
        canvas: document.querySelector('.pdf-page-canvas')
          ? `${document.querySelector('.pdf-page-canvas').width}x${document.querySelector('.pdf-page-canvas').height}`
          : null,
        overlay: !!document.querySelector('.pdf-finding-overlay'),
        highlights: document.querySelectorAll('.finding-highlight').length,
        headerMode: document.querySelector('.header-mode') ? document.querySelector('.header-mode').textContent : null,
        uploadZone: !!document.querySelector('.upload-zone'),
      }));
      console.error('STATE AT CRASH:', JSON.stringify(state, null, 2));
    }
  } catch (e2) {
    console.error('(state dump failed:', e2.message + ')');
  }
  process.exit(2);
});
