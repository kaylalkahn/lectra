// Browser end-to-end test. Not part of `npm test` because it needs Playwright + Chromium:
//   npm i --no-save playwright && npx playwright install chromium
//   node test/e2e.mjs                 -> static site under /lectra/ (how GitHub Pages serves it): local profiles
//   MODE=server node test/e2e.mjs     -> optional Node server with accounts
//   URL=https://… node test/e2e.mjs   -> static flow against a deployed site (e.g. the live GitHub Pages link)
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
  const nf = () => { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<h1>404</h1>'); };
  if (!u.startsWith('/lectra/')) return nf();
  const f = path.join(docs, u.slice('/lectra/'.length) || 'index.html');
  if (!f.startsWith(docs) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return nf();
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
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
const errors = [];
const watch = (p) => {
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  // 401 (logged-out api/me), 400 (short-password check), 404 (api/me probe on a static host) are expected
  p.on('console', (m) => { if (m.type() === 'error' && !/status of (401|400|404)/.test(m.text())) errors.push('console: ' + m.text()); });
  p.on('dialog', (d) => d.accept());
};
let page = await ctx.newPage(); watch(page);
const step = (m) => console.log('✓', m);
const wait = (ms) => page.waitForTimeout(ms);
const secs = (s) => s.split(':').reduce((a, b) => a * 60 + +b, 0);
const ID = MODE === 'server' ? 'kayla@lectra.test' : 'Kayla';
const t = (sel) => page.evaluate((s) => document.querySelector(s).currentTime, sel);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a.toFixed(2)} vs ${b}`);

async function login(p, id, pass, signup = false) {
  await p.waitForSelector('#auth:not([hidden])');
  if (signup) await p.click('[data-auth=signup]'); else await p.click('[data-auth=login]');
  await p.fill('#aEmail', id); await p.fill('#aPass', pass); await p.click('#authSubmit');
}
const loggedIn = (p) => p.waitForFunction(() => document.querySelector('#auth').hidden && !document.querySelector('#logout').hidden);

await page.goto(url);
await page.waitForSelector('#rec', { state: 'attached' });
url = new URL('.', page.url()).href; // follow the root -> docs/ redirect on Pages

// ---- login page ----
await page.waitForSelector('#auth:not([hidden])');
if (MODE === 'static') {
  assert.equal(await page.textContent('#aEmailLabel'), 'Name');
  assert.equal(await page.getAttribute('[data-auth=signup]', 'aria-pressed'), 'true', 'first visit opens on Create account');
  // a lecture saved by the previous (pre-login) version of Lectra, to check it is adopted by the first profile
  await page.evaluate(async () => {
    const { LocalStore } = await import('./store.js');
    const s = new LocalStore('lectra');
    const id = await s.create({ name: 'Earlier lecture', mode: 'Slides and voice', mime: 'video/webm', date: '2026-11-11' });
    const w = s.writer(id); w.push(new Blob([new Uint8Array(64)]), 3); await w.flush();
    await s.addPin(id, 1, 'old note'); await s.finish(id, 3); s.close();
  });
}
await login(page, ID, 'short', true);
await page.waitForFunction(() => /at least 8/.test(document.querySelector('#authErr').textContent));
await page.fill('#aPass', 'password123'); await page.click('#authSubmit');
await loggedIn(page);
if (MODE === 'static') {
  assert.match(await page.textContent('#lede'), /in this browser/);
  await page.waitForFunction(() => /Moved 1 earlier lecture/.test(document.querySelector('#toast').textContent));
  step('login page: create profile; earlier lectures adopted into it');
} else step('signup + validation');

// ---- Slides and voice ----
await page.click('[data-mode="Slides and voice"]');
await page.fill('#topic', 'Slides lecture');
await page.click('#rec');
assert.match(await page.textContent('#toast'), /Load your slides/);
await page.setInputFiles('#slideFile', pdfPath);
await page.waitForFunction(() => document.querySelector('#slideCount').textContent === 'Slide 1 of 2');
const lit = () => page.evaluate(() => {
  const c = document.querySelector('#slideCanvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 0; i < d.length; i += 4 * 50) if (d[i] > 200) n++; return n;
});
assert.ok(await lit() > 100, 'slide rendered');
step('PDF slides load (2 pages)');
assert.equal(await page.isDisabled('#rew'), true, 'rewind disabled before recording');
await page.click('#rec');
await page.waitForFunction(() => document.querySelector('#state').textContent === 'recording');
await wait(2200);
await page.keyboard.press('Enter');
await page.keyboard.press('ArrowRight');
await page.waitForFunction(() => document.querySelector('#slideCount').textContent === 'Slide 2 of 2');
await page.fill('.pinnote', 'Definition of entropy');
await wait(900);
await page.click('#pause');
const tPaused = await page.textContent('#clock'); await wait(1500);
assert.equal(await page.textContent('#clock'), tPaused, 'clock frozen while paused');
await page.click('#pause'); await wait(1200);
await page.keyboard.press('Enter'); // after a mouse click on a control, Enter must still pin
await wait(300);
assert.equal(await page.locator('#notes .pinnote').count(), 2, 'Enter pins after a mouse click on a control');
assert.equal(await page.textContent('#state'), 'recording');
await wait(1500);
const pinAt = (await page.$$eval('#notes .pinat', (b) => b.map((x) => x.textContent))).map(secs);
step('slides recording: pins, note, slide change, pause/resume');

// ---- instant replay (rewind / fast forward while recording) ----
assert.equal(await page.isDisabled('#ff'), true, 'fast forward disabled when already live');
await page.click('#rew');
await page.waitForSelector('#replay:not([hidden])');
await page.waitForFunction(() => document.querySelector('#rVideo').readyState >= 2);
near(await t('#rVideo'), pinAt[1], 0.8, 'rewind stops at the latest pin');
await page.click('#rew');
await wait(300);
near(await t('#rVideo'), pinAt[0], 0.8, 'second rewind stops at the earlier pin');
const frame = await page.evaluate(() => { const v = document.querySelector('#rVideo'), c = document.createElement('canvas'); c.width = 160; c.height = 90;
  const x = c.getContext('2d'); x.drawImage(v, 0, 0, 160, 90); const d = x.getImageData(0, 0, 160, 90).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200) n++; return n; });
assert.ok(frame > 200, 'replay shows the recorded slide: ' + frame);
assert.equal(await page.textContent('#state'), 'recording', 'still recording during replay');
await page.click('#ff');
await wait(300);
near(await t('#rVideo'), pinAt[1], 0.8, 'fast forward stops at the next pin');
const clockBefore = secs(await page.textContent('#clock'));
await page.click('#ff');
await page.waitForSelector('#replay', { state: 'hidden' });
assert.ok(secs(await page.textContent('#clock')) >= clockBefore, 'live clock kept running');
assert.equal(await page.isDisabled('#ff'), true);
step('instant replay: rewind stops at pins, shows the slide, fast forward returns to live');
await page.locator('#notes .pinat').first().click();
await page.waitForSelector('#replay:not([hidden])');
await page.waitForFunction(() => document.querySelector('#rVideo').readyState >= 2);
near(await t('#rVideo'), pinAt[0], 0.8, 'clicking a pin time replays from there');
await page.click('#rLive');
await page.waitForSelector('#replay', { state: 'hidden' });
step('pin timestamps replay from that moment; Back to live');
await wait(500);
const before = await page.textContent('#clock');
await page.click('#rec');
await page.waitForFunction(() => document.querySelector('#state').textContent === 'ready', null, { timeout: 20000 });
assert.ok(before >= '00:00:05', 'clock kept running to ' + before);
await page.waitForFunction((n) => document.querySelector('#n').textContent === n, MODE === 'static' ? '2' : '1');
assert.equal(await page.inputValue('#topic'), '');
step('stop saves the lecture');

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
const cards = await page.locator('.item').count();
assert.equal(cards, (screenOk ? 2 : 1) + (MODE === 'static' ? 1 : 0));
await page.fill('#q', 'slides');
assert.equal(await page.locator('.item').count(), 1);
step('library lists cassettes; search filters');
await page.click('.item .open');
await page.waitForSelector('#player[open]');
await page.waitForFunction(() => { const v = document.querySelector('#pVideo'); return v.readyState >= 1 && isFinite(v.duration) && v.duration > 0; }, null, { timeout: 15000 });
console.log('  video duration', (await page.evaluate(() => document.querySelector('#pVideo').duration)).toFixed(1), 's');
assert.equal(await page.inputValue('#pPins .pinnote'), 'Definition of entropy');
await page.locator('#pPins .pinat').first().click();
await wait(400);
near(await t('#pVideo'), pinAt[0], 0.8, 'pin seeks video');
await page.click('#pPlay'); // pause
await page.waitForFunction(() => document.querySelector('#pVideo').paused && document.querySelector('#pPlay').getAttribute('aria-label') === 'Play'
  && !document.querySelector('#pPlay .i-play').hidden, null, { timeout: 3000 });
await page.click('#pFf'); await wait(200);
near(await t('#pVideo'), pinAt[1], 0.5, 'player fast forward stops at next pin');
await page.click('#pFf'); await wait(200);
const dur = await page.evaluate(() => document.querySelector('#pVideo').duration);
near(await t('#pVideo'), dur, 0.5, 'fast forward with no more pins goes to the end');
await page.click('#pRew'); await wait(200);
near(await t('#pVideo'), pinAt[1], 0.5, 'player rewind stops at previous pin');
await page.click('#pRew'); await wait(200);
near(await t('#pVideo'), pinAt[0], 0.5, 'player rewind stops at the earlier pin');
await page.click('#pRew'); await wait(200);
near(await t('#pVideo'), 0, 0.3, 'rewind reaches the start');
step('player: pins seek; play/pause; rewind and fast forward stop at pins and reach both ends');
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

if (MODE === 'static') {
  // encryption at rest: nothing readable in the profile database
  const leak = await page.evaluate(async () => {
    const name = (await indexedDB.databases()).map((d) => d.name).find((n) => n.startsWith('lectra-p-'));
    const db = await new Promise((r) => { const q = indexedDB.open(name); q.onsuccess = () => r(q.result); });
    const all = (s) => new Promise((r) => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => r(q.result); });
    const recs = [...await all('lectures'), ...await all('pins')];
    const text = JSON.stringify(recs);
    db.close();
    return { keys: [...new Set(recs.flatMap(Object.keys))].sort(), leaked: /Renamed|entropy|Slides|Earlier|old note/.test(text), legacy: (await indexedDB.databases()).some((d) => d.name === 'lectra') };
  });
  assert.deepEqual(leak.keys, ['id', 'lectureId', 'm'], 'only ids are stored in the clear');
  assert.equal(leak.leaked, false, 'names/notes are encrypted at rest');
  assert.equal(leak.legacy, false, 'old unencrypted database removed after adoption');
  step('stored data is encrypted (names, notes and video not readable in IndexedDB)');

  // reload locks; wrong password rejected; a second profile sees nothing of the first
  await page.reload();
  await page.waitForSelector('#auth:not([hidden])');
  assert.equal(await page.getAttribute('[data-auth=login]', 'aria-pressed'), 'true');
  await login(page, ID, 'wrong-password');
  await page.waitForFunction(() => /incorrect/.test(document.querySelector('#authErr').textContent));
  await page.fill('#aPass', 'password123'); await page.click('#authSubmit');
  await loggedIn(page);
  await page.click('#tab-library');
  await page.waitForSelector('.item h3:has-text("Renamed lecture")');
  step('reload locks the app; wrong password rejected; right one unlocks');
  await page.click('#logout');
  await login(page, ID.toLowerCase(), 'password123', true);
  await page.waitForFunction(() => /already exists/.test(document.querySelector('#authErr').textContent));
  await login(page, 'Guest', 'guestpass1', true);
  await loggedIn(page);
  await page.click('#tab-library');
  await page.waitForSelector('#empty:not([hidden])');
  assert.equal(await page.locator('.item').count(), 0);
  assert.equal(await page.textContent('#n'), '0');
  step('second profile has its own empty library; duplicate names refused');
  await page.click('#logout');
  await login(page, 'Guest', '');
  await page.click('#forgot');
  await page.waitForFunction(() => document.querySelector('[data-auth=signup]').getAttribute('aria-pressed') === 'true');
  await login(page, 'Guest', 'guestpass1');
  await page.waitForFunction(() => /incorrect/.test(document.querySelector('#authErr').textContent));
  step('forgot password deletes that profile only');
  await page.fill('#aEmail', ID); await page.fill('#aPass', 'password123'); await page.click('#authSubmit');
  await loggedIn(page);
} else {
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#auth').hidden);
  step('reload keeps session');
}
await page.click('#tab-library');
await page.waitForSelector('.item h3:has-text("Renamed lecture")');

await page.click('.item .open');
await page.waitForSelector('#player[open]');
await page.click('#pDelete');
await page.waitForFunction((n) => document.querySelectorAll('.item').length === n, cards - 1);
step('delete lecture');

// interrupted recording recovery: start, then close the tab mid-recording
await page.click('#tab-record');
await page.click('[data-mode="Slides and voice"]');
await page.setInputFiles('#slideFile', pdfPath);
await page.waitForFunction(() => document.querySelector('#slideCount').textContent === 'Slide 1 of 2');
await page.fill('#topic', 'Crash test');
await page.click('#rec');
await page.waitForFunction(() => document.querySelector('#state').textContent === 'recording');
await wait(6500); // > one 5 s chunk saved
const p2 = await ctx.newPage(); watch(p2);
page.removeAllListeners('dialog');
await page.close({ runBeforeUnload: false });
page = p2;
await p2.goto(url + '#library');
if (MODE === 'static') { await login(p2, ID, 'password123'); await loggedIn(p2); }
await p2.waitForSelector('.item h3:has-text("Crash test")', { timeout: 10000 });
step('interrupted recording recovered into library');

if (MODE === 'static') {
  const bad = []; p2.on('request', (r) => { if (new URL(r.url()).origin !== new URL(url).origin && !/^(blob|data):/.test(r.url())) bad.push(r.url()); });
  await p2.reload(); await login(p2, ID, 'password123'); await loggedIn(p2);
  assert.deepEqual(bad, [], 'no third-party requests');
  step('no third-party network requests');
}
console.log(errors.length ? 'JS errors:\n' + errors.join('\n') : 'no JS errors');
await browser.close(); server.close(); fs.rmSync(dir, { recursive: true, force: true });
process.exit(errors.length ? 1 : 0);
