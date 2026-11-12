import { ApiError } from './api.js';
import { detectStore } from './store.js';
import { cassette, esc, hash } from './cassette.js';
import { Deck } from './slides.js';
import { fmt, short } from './format.js';
import { supported, screenSupported, pickMime, openCapture, CaptureError } from './capture.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const today = () => new Date().toLocaleDateString('en-CA');
function toast(m) { const e = $('#toast'); e.textContent = m; e.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { e.hidden = true; }, 3200); }
function debounce(fn, ms) { let h; const d = (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; d.flush = (...a) => { clearTimeout(h); fn(...a); }; return d; }

let store = null, user = null, lib = [], mode = 'Screen and voice';
// recording session state: ready | starting | recording | paused | saving
let state = 'ready', acc = 0, segStart = 0, clockTimer = null, pins = [], pi = -1, rs = null;

/* ---------- view routing ---------- */
function go(v) {
  ['record', 'library'].forEach((x) => {
    $('#' + x).hidden = x !== v;
    const b = $('#tab-' + x);
    if (x === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
  renderLib();
}
$$('[data-go]').forEach((b) => { b.onclick = () => go(b.dataset.go); });
window.addEventListener('hashchange', () => go(location.hash === '#library' ? 'library' : 'record'));

/* ---------- auth ---------- */
let authMode = 'login';
function setAuthMode(m) {
  authMode = m;
  $$('[data-auth]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.auth === m));
  $('#authTitle').textContent = m === 'login' ? 'Welcome back' : 'Create your account';
  $('#authSubmit').textContent = m === 'login' ? 'Log in' : 'Create account';
  $('#aPass').autocomplete = m === 'login' ? 'current-password' : 'new-password';
  $('#passHint').textContent = m === 'signup' ? '(at least 8 characters)' : '';
  $('#authErr').textContent = '';
}
$$('[data-auth]').forEach((b) => { b.onclick = () => setAuthMode(b.dataset.auth); });
$('#authForm').onsubmit = async (e) => {
  e.preventDefault();
  const btn = $('#authSubmit'); btn.disabled = true; $('#authErr').textContent = '';
  try {
    const email = $('#aEmail').value, pass = $('#aPass').value;
    user = authMode === 'login' ? await store.login(email, pass) : await store.signup(email, pass);
    $('#aPass').value = '';
    await enterApp();
  } catch (err) { $('#authErr').textContent = err.message; }
  btn.disabled = false;
};
$('#logout').onclick = async () => {
  if (state !== 'ready') { toast('Stop your recording before logging out.'); return; }
  await store.logout().catch(() => {});
  user = null; lib = []; showAuth();
};
function showAuth() {
  $('#auth').hidden = false; $('#logout').hidden = true;
  $('#record').hidden = true; $('#library').hidden = true;
  setAuthMode('login'); $('#aEmail').focus();
}
async function enterApp() {
  $('#auth').hidden = true; $('#logout').hidden = store.kind === 'local';
  $('#logout').title = user.email || '';
  try {
    const n = await store.recover();
    if (n) toast(`Recovered ${n} interrupted recording${n > 1 ? 's' : ''}.`);
  } catch { /* non-fatal */ }
  await loadLib();
  go(location.hash === '#library' ? 'library' : 'record');
}
function handleAuthLoss(e) {
  if (e instanceof ApiError && e.status === 401) { user = null; showAuth(); toast('Your session expired. Please log in again.'); return true; }
  return false;
}

/* ---------- stage cassette ---------- */
function stage() {
  const s = $('#topic').value.trim();
  $('#stageTape').innerHTML = cassette(s || 'New lecture', today(), hash(s || 'new'));
}
$('#topic').oninput = stage;

/* ---------- mode + slides ---------- */
const deck = new Deck($('#slideCanvas'), slideUi);
function applyMode() {
  $$('.seg button[data-mode]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.mode === mode));
  $('#slides').hidden = mode !== 'Slides and voice';
  $('#modehelp').textContent = 'Both are saved as a video.';
}
$$('.seg button[data-mode]').forEach((b) => {
  b.onclick = () => { if (state !== 'ready') return; mode = b.dataset.mode; applyMode(); };
});
function slideUi() {
  const n = deck.count;
  $('#slideCount').textContent = n ? `Slide ${deck.index + 1} of ${n}` : 'No slides loaded';
  $('#prevSlide').disabled = !n || deck.index === 0;
  $('#nextSlide').disabled = !n || deck.index >= n - 1;
}
$('#slideFile').onchange = async (e) => {
  const files = e.target.files; if (!files.length) return;
  $('#slideCount').textContent = 'Loading…';
  try { await deck.load(files); toast(`Loaded ${deck.count} slide${deck.count === 1 ? '' : 's'}.`); }
  catch (err) { toast('Couldn’t load slides: ' + err.message); }
  e.target.value = ''; slideUi();
};
$('#prevSlide').onclick = () => deck.prev();
$('#nextSlide').onclick = () => deck.next();

/* ---------- clock (time-based, so it does not drift) ---------- */
const elapsedMs = () => acc + (state === 'recording' ? performance.now() - segStart : 0);
const elapsedSec = () => Math.floor(elapsedMs() / 1000);
function startClock() { clearInterval(clockTimer); clockTimer = setInterval(() => { $('#clock').textContent = fmt(elapsedSec()); }, 250); }

/* ---------- pins ---------- */
function renderPins() {
  const ul = $('#notes');
  if (!pins.length) { ul.innerHTML = '<li class="none">No pins yet. Press Enter while recording to mark a moment.</li>'; return; }
  ul.innerHTML = '';
  pins.forEach((p, i) => {
    const li = document.createElement('li');
    const at = document.createElement('span'); at.textContent = fmt(p.at);
    const inp = document.createElement('input');
    inp.className = 'pinnote'; inp.maxLength = 500; inp.value = p.note; inp.placeholder = 'Pinned moment: add a note';
    inp.setAttribute('aria-label', `Note for pin at ${fmt(p.at)}`);
    const save = debounce((v) => p.ready.then((id) => id != null && store.editPin(id, v)).catch(() => toast('Couldn’t save that note.')), 500);
    inp.oninput = () => { p.note = inp.value; save(inp.value); };
    inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } };
    const x = document.createElement('button'); x.className = 'pinx'; x.textContent = '×'; x.setAttribute('aria-label', 'Delete pin');
    x.onclick = () => { pins.splice(i, 1); pi = -1; p.ready.then((id) => id != null && store.deletePin(id)).catch(() => {}); renderPins(); ui(); };
    li.append(at, inp, x); ul.append(li);
  });
}
function addPin() {
  if (state !== 'recording' && state !== 'paused') return;
  const at = elapsedSec();
  const p = { at, note: '' };
  p.ready = store.addPin(rs.id, at, '').catch(() => { toast('Couldn’t save that pin.'); return null; });
  pins.push(p); renderPins(); ui();
  const inputs = $$('#notes .pinnote'); inputs[inputs.length - 1]?.scrollIntoView({ block: 'nearest' });
}
function stepPin(dir) {
  if (!pins.length) return;
  pi = dir < 0 ? (pi <= 0 ? pins.length - 1 : pi - 1) : (pi >= pins.length - 1 ? 0 : pi + 1);
  $$('#notes .pinnote')[pi]?.focus();
  toast(`Pin at ${fmt(pins[pi].at)}`);
}
$('#rew').onclick = () => stepPin(-1);
$('#ff').onclick = () => stepPin(1);
$('#pinbtn').onclick = addPin;

/* ---------- recording ---------- */
function ui() {
  const live = state === 'recording';
  document.body.classList.toggle('live', live);
  $('#stageTape').classList.toggle('spin', state === 'recording' || state === 'paused');
  $('#stageTape').classList.toggle('paused', state === 'paused');
  $('#state').textContent = { ready: 'ready', starting: 'starting…', recording: 'recording', paused: 'paused', saving: 'saving…' }[state];
  $('#clock').textContent = fmt(state === 'ready' ? 0 : elapsedSec());
  const active = state === 'recording' || state === 'paused';
  $('#rec').setAttribute('aria-label', state === 'ready' ? 'Start recording' : 'Stop and save');
  $('#rec').disabled = state === 'starting' || state === 'saving';
  $('#pause').disabled = !active;
  $('#pause').setAttribute('aria-label', state === 'paused' ? 'Resume' : 'Pause');
  $('#pinbtn').disabled = !active;
  $('#rew').disabled = $('#ff').disabled = !pins.length;
  $('#topic').disabled = state !== 'ready';
  $$('.seg button[data-mode]').forEach((b) => { b.disabled = state !== 'ready' || (b.dataset.mode === 'Screen and voice' && !screenSupported()); });
}

async function startRecording() {
  if (!user) { showAuth(); return; }
  if (mode === 'Slides and voice' && !deck.count) { toast('Load your slides first, then press record.'); return; }
  state = 'starting'; ui();
  let cap, id;
  try {
    cap = await openCapture(mode, deck);
    const mime = pickMime();
    const name = $('#topic').value.trim() || 'Untitled lecture';
    const mr = new MediaRecorder(cap.stream, mime ? { mimeType: mime } : undefined);
    id = await store.create({ name, mode, mime: mr.mimeType || mime, date: today() });
    const up = store.writer(id, (e) => { toast('Saving problem: ' + e.message); });
    rs = { id, mr, cap, up, name, ended: false };
    mr.ondataavailable = (e) => { up.push(e.data, elapsedSec()); };
    mr.onerror = () => { toast('The recorder hit an error.'); stopRecording(); };
    cap.videoTrack.onended = () => { toast('Screen sharing ended. Saving your lecture.'); stopRecording(); };
    acc = 0; segStart = performance.now(); pins = []; pi = -1;
    mr.start(5000);
    state = 'recording'; startClock(); renderPins(); ui();
    if (mode === 'Screen and voice' && !cap.hasSystemAudio) toast('Recording your voice. The shared screen has no audio of its own.');
  } catch (e) {
    cap?.cleanup(); rs = null; state = 'ready'; ui();
    if (!handleAuthLoss(e)) toast(e instanceof CaptureError || e instanceof ApiError ? e.message : 'Couldn’t start recording: ' + e.message);
  }
}

async function stopRecording() {
  if (state !== 'recording' && state !== 'paused') return;
  const s = rs;
  if (state === 'recording') acc += performance.now() - segStart; // freeze the clock at the true duration
  const duration = Math.floor(acc / 1000);
  state = 'saving'; clearInterval(clockTimer); ui();
  try {
    await new Promise((resolve) => {
      if (s.mr.state === 'inactive') return resolve();
      s.mr.onstop = resolve; s.mr.stop();
    });
    s.cap.cleanup();
    await s.up.flush();
    await Promise.all(pins.map((p) => p.ready));
    await store.finish(s.id, duration);
    toast('Saved to your library as a new cassette.');
  } catch (e) {
    if (!handleAuthLoss(e)) toast(e.message || 'Couldn’t finish saving. Reopen Lectra to recover what was captured.');
  }
  rs = null; state = 'ready'; acc = 0; pins = []; pi = -1;
  $('#topic').value = ''; stage(); renderPins(); ui();
  await loadLib().catch(() => {});
}

// After a mouse click the button keeps focus, and Enter would then re-activate it instead of pinning.
const blurIfMouse = (e) => { if (e.detail > 0) e.currentTarget.blur(); };
$('#rec').onclick = (e) => { blurIfMouse(e); if (state === 'ready') startRecording(); else stopRecording(); };
$('#pause').onclick = (e) => {
  blurIfMouse(e);
  if (state === 'recording') { acc += performance.now() - segStart; state = 'paused'; rs.mr.pause(); }
  else if (state === 'paused') { segStart = performance.now(); state = 'recording'; rs.mr.resume(); }
  ui();
};
window.addEventListener('beforeunload', (e) => { if (state === 'recording' || state === 'paused') { e.preventDefault(); e.returnValue = ''; } });

document.addEventListener('keydown', (e) => {
  if ($('#player').open || !$('#auth').hidden) return;
  const tag = document.activeElement.tagName;
  const typing = /^(BUTTON|INPUT|TEXTAREA|SELECT|A)$/.test(tag);
  if (e.key === 'Enter' && (state === 'recording' || state === 'paused') && !typing) { e.preventDefault(); addPin(); }
  if (!typing && !$('#record').hidden && mode === 'Slides and voice') {
    if (e.key === 'ArrowRight') { e.preventDefault(); deck.next(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); deck.prev(); }
  }
});

/* ---------- library ---------- */
async function loadLib() {
  try {
    const r = await store.list(today());
    lib = r.lectures;
    $('#n').textContent = r.stats.count; $('#tot').textContent = short(r.stats.totalSeconds); $('#streak').textContent = r.stats.streak;
  } catch (e) { if (!handleAuthLoss(e)) toast(e.message); }
  renderLib();
}
function renderLib() {
  const q = $('#q').value.toLowerCase().trim();
  const list = lib.filter((l) => l.name.toLowerCase().includes(q));
  $('#empty').hidden = lib.length > 0;
  $('#ghost').innerHTML = cassette('Empty tape', '', 2);
  $('#shelf').innerHTML = list.map((l) => {
    const m = /slide/i.test(l.mode) ? 'Slides and voice' : 'Screen and voice';
    return `<article class="item"><button class="open" data-id="${esc(l.id)}" aria-label="Open ${esc(l.name)}">${cassette(l.name, l.date, hash(l.name + l.id))}<h3>${esc(l.name)}</h3><div class="row"><span>${esc(l.date)}</span><span>${short(l.duration)}</span></div><p>${m}, ${l.pins} ${l.pins === 1 ? 'pin' : 'pins'}</p></button></article>`;
  }).join('') || (lib.length ? '<p class="small">No cassettes match that search.</p>' : '');
}
$('#q').oninput = renderLib;
$('#shelf').onclick = (e) => { const b = e.target.closest('.open'); if (b) openPlayer(b.dataset.id); };

/* ---------- player ---------- */
const dlg = $('#player'), vid = $('#pVideo');
let cur = null, media = null;
async function openPlayer(id) {
  let r;
  try { r = await store.get(id); media = await store.media(id); } catch (e) { if (!handleAuthLoss(e)) toast(e.message); return; }
  cur = r.lecture;
  $('#pTitle').value = cur.name;
  $('#pMeta').textContent = `${cur.date} · ${short(cur.duration)} · ${cur.mode}`;
  $('#pDownload').href = media.download;
  if (media.filename) $('#pDownload').download = media.filename; else $('#pDownload').removeAttribute('download');
  vid.src = media.src;
  renderPlayerPins(r.pins);
  dlg.showModal();
}
// MediaRecorder WebM has no duration header; this makes the seek bar work.
vid.addEventListener('loadedmetadata', () => {
  if (vid.duration === Infinity) {
    vid.currentTime = 1e101;
    vid.addEventListener('timeupdate', () => { vid.currentTime = 0; }, { once: true });
  }
});
function renderPlayerPins(list) {
  const ul = $('#pPins');
  if (!list.length) { ul.innerHTML = '<li class="none">No pins on this lecture.</li>'; return; }
  ul.innerHTML = '';
  list.forEach((p) => {
    const li = document.createElement('li');
    const at = document.createElement('button'); at.className = 'pinat'; at.textContent = fmt(p.at);
    at.setAttribute('aria-label', `Jump to ${fmt(p.at)}`);
    at.onclick = () => { vid.currentTime = p.at; vid.play().catch(() => {}); };
    const inp = document.createElement('input'); inp.className = 'pinnote'; inp.maxLength = 500; inp.value = p.note; inp.placeholder = 'Add a note';
    inp.setAttribute('aria-label', `Note for pin at ${fmt(p.at)}`);
    const save = debounce((v) => store.editPin(p.id, v).catch(() => toast('Couldn’t save that note.')), 500);
    inp.oninput = () => save(inp.value);
    inp.onkeydown = (e) => { if (e.key === 'Enter') inp.blur(); };
    const x = document.createElement('button'); x.className = 'pinx'; x.textContent = '×'; x.setAttribute('aria-label', 'Delete pin');
    x.onclick = async () => {
      try { await store.deletePin(p.id); li.remove(); const l = lib.find((z) => z.id === cur.id); if (l) l.pins--; renderLib();
        if (!$('#pPins').children.length) renderPlayerPins([]); } catch (e) { toast(e.message); }
    };
    li.append(at, inp, x); ul.append(li);
  });
}
const rename = async () => {
  const name = $('#pTitle').value.trim();
  if (!cur || !name || name === cur.name) { if (cur) $('#pTitle').value = cur.name; return; }
  try { await store.rename(cur.id, name); cur.name = name; const l = lib.find((z) => z.id === cur.id); if (l) l.name = name; renderLib(); }
  catch (e) { toast(e.message); $('#pTitle').value = cur.name; }
};
$('#pTitle').onchange = rename;
$('#pTitle').onkeydown = (e) => { if (e.key === 'Enter') e.target.blur(); };
$('#pDelete').onclick = async () => {
  if (!cur || !confirm(`Delete “${cur.name}” and its recording? This can’t be undone.`)) return;
  try { await store.remove(cur.id); dlg.close(); toast('Lecture deleted.'); await loadLib(); }
  catch (e) { toast(e.message); }
};
$('#pClose').onclick = () => dlg.close();
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
dlg.addEventListener('close', () => { vid.pause(); vid.removeAttribute('src'); vid.load(); media?.release(); media = null; cur = null; });

/* ---------- boot ---------- */
async function boot() {
  stage(); applyMode(); slideUi(); renderPins(); ui();
  if (!supported()) { $('#unsupported').hidden = false; $('#rec').disabled = true; }
  else if (!screenSupported()) {
    mode = 'Slides and voice'; applyMode();
    const b = $('.seg button[data-mode="Screen and voice"]'); b.disabled = true; b.title = 'Screen sharing isn’t available in this browser';
    b.dataset.mode = 'Screen and voice';
  }
  store = await detectStore();
  if (store.kind === 'local') {
    // No server: everything stays in this browser. Same design, no sign-in needed.
    $('#lede').textContent = 'The speaker’s voice is always recorded. Add the screen or slide deck they are presenting, and Lectra keeps the recording and your timestamped notes together, privately, in this browser.';
    $('#libLede').textContent = 'Every recording and set of notes you’ve made in this browser, one cassette per lecture. Nothing is uploaded.';
  }
  try { user = await store.me(); await enterApp(); }
  catch { showAuth(); }
}
boot();
