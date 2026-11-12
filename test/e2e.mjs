// Browser end-to-end test. Not part of `npm test` because it needs Playwright + Chromium:
//   npm i --no-save playwright && npx playwright install chromium
//   node test/e2e.mjs          -> static site under /lectra/ (exactly how GitHub Pages serves docs/), browser storage
//   MODE=server node test/e2e.mjs -> optional Node server with accounts
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';

const MODE = process.env.MODE === 'server' ? 'server' : 'static';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lectra-e2e-'));
const docs = fileURLToPath(new URL('../docs/', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
// Minimal GitHub-Pages-like static host: serves docs/ under /lectra/, 404s everything else (incl. api/*).
const staticHost = () => http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!u.startsWith('/lectra/')) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('<h1>404</h1>'); }
  let f = path.join(docs, u.slice('/lectra/'.length) || 'index.html');
  if (!f.startsWith(docs) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('<h1>404</h1>'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
// URL=https://… runs the static flow against a deployed site instead (e.g. the live GitHub Pages link).
const server = process.env.URL ? { close() {} } : await new Promise((r) => { const s = (MODE === 'server' ? createApp({ dataDir: dir }) : staticHost()).listen(0, () => r(s)); });
let url = process.env.URL || `http://127.0.0.1:${server.address().port}/${MODE === 'server' ? '' : 'lectra/'}`;
console.log('mode:', MODE, url);

const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R 4 0 R]/Count 2>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 225]/Contents 5 0 R/Resources<</Font<</F1 7 0 R>>>>>>endobj
4 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 225]/Contents 6 0 R/Resources<</Font<</F1 7 0 R>>>>>>endobj
5 0 obj<</Length 44>>stream
BT /F1 48 Tf 40 100 Td (Slide One) Tj ET
endstream
endobj
6 0 obj<</Length 44>>stream
BT /F1 48 Tf 40 100 Td (Slide Two) Tj ET
endstream
endobj
7 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R/Size 8>>
%%EOF`;
const pdfPath = path.join(dir, 'deck.pdf');
fs.writeFileSync(pdfPath, pdf);

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    '--auto-select-desktop-capture-source=Entire screen', '--auto-accept-this-tab-capture', '--enable-usermedia-screen-capturing'],
});
const ctx = await browser.newContext({ permissions: ['microphone'], acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
// 401 (logged-out api/me), 400 (short-password check) and 404 (api/me probe on a static host) are expected
page.on('console', (m) => { if (m.type() === 'error' && !/status of (401|400|404)/.test(m.text())) errors.push('console: ' + m.text()); });
page.on('dialog', (d) => d.accept());
const step = (m) => console.log('✓', m);
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(url);
await page.waitForSelector('#rec');
url = new URL('.', page.url()).href; // follow the root -> docs/ redirect on Pages
if (MODE === 'server') {
await page.waitForSelector('#auth:not([hidden])');
// wrong password path
await page.click('[data-auth=signup]');
await page.fill('#aEmail', 'e2e@lectra.test'); await page.fill('#aPass', 'short');
await page.click('#authSubmit');
await page.waitForFunction(() => /at least 8/.test(document.querySelector('#authErr').textContent));
await page.fill('#aPass', 'password123'); await page.click('#authSubmit');
await page.waitForSelector('#auth', { state: 'hidden' });
step('signup + validation');
} else {
  await page.waitForFunction(() => document.querySelector('#auth').hidden && !document.querySelector('#record').hidden);
  assert.match(await page.textContent('#lede'), /in this browser/);
  assert.equal(await page.isVisible('#logout'), false);
  step('opens straight into the app, no sign-in, browser storage');
}

// ---- Slides and voice ----
await page.click('[data-mode="Slides and voice"]');
await page.fill('#topic', 'Slides lecture');
await page.click('#rec');
assert.match(await page.textContent('#toast'), /Load your slides/);
await page.setInputFiles('#slideFile', pdfPath);
await page.waitForFunction(() => document.querySelector('#slideCount').textContent === 'Slide 1 of 2');
step('PDF slides load (2 pages)');
// canvas shows real content (not just the background)
const lit = () => page.evaluate(() => {
  const c = document.querySelector('#slideCanvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 0; i < d.length; i += 4 * 50) if (d[i] > 200) n++; return n;
});
assert.ok(await lit() > 100, 'slide rendered');
await page.click('#rec');
await page.waitForFunction(() => document.querySelector('#state').textContent === 'recording');
await wait(2200);
await page.keyboard.press('Enter');                      // pin
await page.keyboard.press('ArrowRight');                 // next slide while recording
await page.waitForFunction(() => document.querySelector('#slideCount').textContent === 'Slide 2 of 2');
await page.fill('.pinnote', 'Definition of entropy');
await wait(900);
await page.click('#pause');
const tPaused = await page.textContent('#clock'); await wait(1500);
assert.equal(await page.textContent('#clock'), tPaused, 'clock frozen while paused');
await page.click('#pause'); await wait(1200);
// regression: after mouse-clicking Resume, Enter must pin (not re-toggle pause / stop)
await page.keyboard.press('Enter');
await wait(300);
assert.equal(await page.locator('#notes .pinnote').count(), 2, 'Enter pins after a mouse click on a control');
assert.equal(await page.textContent('#state'), 'recording');
await wait(1500);
const before = await page.textContent('#clock');
await page.click('#rec');
await page.waitForFunction(() => document.querySelector('#state').textContent === 'ready', null, { timeout: 20000 });
assert.ok(before >= '00:00:05', 'clock kept running to ' + before);
step('slides recording: pin, note, slide change, pause/resume, stop');
await page.waitForFunction(() => document.querySelector('#n').textContent === '1');
assert.equal(await page.inputValue('#topic'), '');

// ---- Screen and voice ----
await page.click('[data-mode="Screen and voice"]');
await page.fill('#topic', 'Screen lecture');
await page.click('#rec');
let screenOk = true;
try { await page.waitForFunction(() => document.querySelector('#state').textContent === 'recording', null, { timeout: 8000 }); }
catch { screenOk = false; console.log('! screen capture unavailable in this headless browser:', (await page.textContent('#toast')).trim()); }
if (screenOk) {
  await wait(2500); await page.keyboard.press('Enter'); await wait(2000);
  await page.click('#rec');
  await page.waitForFunction(() => document.querySelector('#state').textContent === 'ready', null, { timeout: 20000 });
  step('screen recording saved');
}

// ---- Library + player ----
await page.click('#tab-library');
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/library.png', fullPage: true });
const cards = await page.locator('.item').count();
assert.equal(cards, screenOk ? 2 : 1);
await page.fill('#q', 'slides');
assert.equal(await page.locator('.item').count(), 1);
step('library lists cassettes; search filters');
await page.click('.item .open');
await page.waitForSelector('#player[open]');
await page.waitForFunction(() => { const v = document.querySelector('#pVideo'); return v.readyState >= 1 && isFinite(v.duration) && v.duration > 0; }, null, { timeout: 15000 });
const dur = await page.evaluate(() => document.querySelector('#pVideo').duration);
console.log('  video duration', dur.toFixed(1), 's');
assert.equal(await page.inputValue('.pinnote'), 'Definition of entropy');
await page.click('#pPins .pinat');
await wait(600);
assert.ok(await page.evaluate(() => document.querySelector('#pVideo').currentTime) >= 1.5, 'pin seeks video');
step('player plays recording, shows pin note, pin seeks');
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/player.png' });
// frames contain slide pixels
const bright = await page.evaluate(async () => {
  const v = document.querySelector('#pVideo'); v.currentTime = 1; await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
  const c = document.createElement('canvas'); c.width = 320; c.height = 180; const x = c.getContext('2d'); x.drawImage(v, 0, 0, 320, 180);
  const d = x.getImageData(0, 0, 320, 180).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200) n++; return n;
});
assert.ok(bright > 500, 'video frame has slide content: ' + bright);
step('recorded frames contain the slide');

const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#pDownload')]);
assert.match(dl.suggestedFilename(), /^Slides-lecture-\d{4}-\d{2}-\d{2}\.webm$/);
assert.ok(fs.statSync(await dl.path()).size > 1000);
step('download works: ' + dl.suggestedFilename());

await page.fill('#pTitle', 'Renamed lecture'); await page.press('#pTitle', 'Enter');
await wait(500);
await page.click('#pClose');
await page.fill('#q', '');
await page.waitForSelector('.item h3:has-text("Renamed lecture")');
step('rename persists in library');

// reload keeps session and data
await page.reload();
await page.waitForFunction(() => document.querySelector('#auth').hidden);
await page.click('#tab-library');
await page.waitForSelector('.item h3:has-text("Renamed lecture")');
step('reload keeps library');

// delete
await page.click('.item .open');
await page.waitForSelector('#player[open]');
await page.click('#pDelete');
await page.waitForFunction((n) => document.querySelectorAll('.item').length === n, cards - 1);
step('delete lecture');

// interrupted recording recovery: start, then reload mid-recording
await page.click('#tab-record');
await page.click('[data-mode="Slides and voice"]');
await page.setInputFiles('#slideFile', pdfPath);
await page.waitForFunction(() => document.querySelector('#slideCount').textContent === 'Slide 1 of 2');
await page.fill('#topic', 'Crash test');
await page.click('#rec');
await page.waitForFunction(() => document.querySelector('#state').textContent === 'recording');
await wait(6500); // > one 5s chunk uploaded
await page.evaluate(() => { window.onbeforeunload = null; });
const p2 = await ctx.newPage(); // simulate crash: close the recording tab without stopping
page.removeAllListeners('dialog');
await page.close({ runBeforeUnload: false });
await p2.goto(url + '#library');
await p2.waitForSelector('.item h3:has-text("Crash test")', { timeout: 10000 });
step('interrupted recording recovered into library');

if (MODE === 'static') {
  const bad = []; p2.on('request', (r) => { if (new URL(r.url()).origin !== new URL(url).origin && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) bad.push(r.url()); });
  await p2.reload(); await p2.waitForSelector('.item'); assert.deepEqual(bad, [], 'no third-party requests');
  step('no third-party network requests');
}
console.log(errors.length ? 'JS errors:\n' + errors.join('\n') : 'no JS errors');
await browser.close(); server.close(); fs.rmSync(dir, { recursive: true, force: true });
process.exit(errors.length ? 1 : 0);
