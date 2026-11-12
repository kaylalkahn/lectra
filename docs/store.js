/* Storage backends with one interface.
 * - LocalStore: everything in this browser's IndexedDB. No server, no account. Used on static hosting (GitHub Pages).
 * - ServerStore: the optional Node server in /server (accounts, recordings on the server).
 * detectStore() picks ServerStore only if a Lectra API answers next to the page. */
import { api, ApiError, Uploader } from './api.js';
import { streak } from './streak.js';

const EXT = { 'video/webm': 'webm', 'video/mp4': 'mp4' };
const baseMime = (m) => String(m || '').split(';')[0].trim().toLowerCase();
export function fileName(l) {
  const safe = l.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'lecture';
  return `${safe}-${l.date}.${EXT[baseMime(l.mime)] || 'webm'}`;
}
function stats(rows, today) {
  return { count: rows.length, totalSeconds: rows.reduce((a, r) => a + r.duration, 0), streak: streak(rows.map((r) => r.date), today) };
}

/* ---------------- server ---------------- */
export class ServerStore {
  kind = 'server';
  me() { return api('GET', 'api/me').then((r) => r.user); }
  login(email, password) { return api('POST', 'api/auth/login', { email, password }).then((r) => r.user); }
  signup(email, password) { return api('POST', 'api/auth/signup', { email, password }).then((r) => r.user); }
  logout() { return api('POST', 'api/auth/logout'); }
  recover() { return api('POST', 'api/lectures/recover').then((r) => r.recovered); }
  async list(today) { return api('GET', `api/lectures?today=${today}`); }
  create(meta) { return api('POST', 'api/lectures', meta).then((r) => r.id); }
  writer(id, onError) { return new Uploader(id, onError); }
  finish(id, duration) { return api('POST', `api/lectures/${id}/finish`, { duration }); }
  addPin(id, at, note) { return api('POST', `api/lectures/${id}/pins`, { at, note }).then((r) => r.pin.id); }
  editPin(pinId, note) { return api('PATCH', `api/pins/${pinId}`, { note }); }
  deletePin(pinId) { return api('DELETE', `api/pins/${pinId}`); }
  get(id) { return api('GET', `api/lectures/${id}`); }
  rename(id, name) { return api('PATCH', `api/lectures/${id}`, { name }); }
  remove(id) { return api('DELETE', `api/lectures/${id}`); }
  async media(id) { return { src: `api/lectures/${id}/media`, download: `api/lectures/${id}/media?download=1`, filename: '', release() {} }; }
}

/* ---------------- browser (IndexedDB) ---------------- */
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (tx) => new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('Storage transaction aborted.')); });
function friendly(e) {
  if (e?.name === 'QuotaExceededError') return new ApiError(507, 'This browser is out of storage space. Delete or download old lectures to free some up.');
  return e instanceof Error ? e : new Error(String(e));
}

export class LocalStore {
  kind = 'local';
  constructor(dbName = 'lectra') { this.dbName = dbName; this.db = null; }
  async open() {
    if (this.db) return this.db;
    const r = indexedDB.open(this.dbName, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('lectures', { keyPath: 'id' });
      db.createObjectStore('chunks', { keyPath: ['lectureId', 'seq'] });
      db.createObjectStore('pins', { keyPath: 'id', autoIncrement: true }).createIndex('lecture', 'lectureId');
    };
    this.db = await req(r);
    navigator.storage?.persist?.().catch(() => {}); // ask the browser not to evict recordings
    return this.db;
  }
  async tx(stores, mode, fn) {
    const db = await this.open();
    const t = db.transaction(stores, mode);
    const out = fn(...stores.map((s) => t.objectStore(s)));
    try { await done(t); } catch (e) { throw friendly(e); }
    return out instanceof Promise ? out : out;
  }
  async me() { await this.open(); return { local: true }; }
  async logout() {}

  async lecture(id) { return this.tx(['lectures'], 'readonly', (l) => req(l.get(id))).then((p) => p); }
  async pinsOf(id) {
    const db = await this.open();
    return req(db.transaction('pins').objectStore('pins').index('lecture').getAll(id));
  }
  async allLectures() { const db = await this.open(); return req(db.transaction('lectures').objectStore('lectures').getAll()); }

  async recover() {
    let n = 0;
    for (const l of (await this.allLectures()).filter((x) => x.status === 'recording')) {
      if (l.chunks > 0) { l.status = 'saved'; l.duration = l.elapsed; await this.tx(['lectures'], 'readwrite', (s) => s.put(l)); n++; }
      else await this.remove(l.id);
    }
    return n;
  }
  async list(today) {
    const rows = (await this.allLectures()).filter((l) => l.status === 'saved').sort((a, b) => b.createdAt - a.createdAt);
    const counts = new Map();
    const db = await this.open();
    for (const p of await req(db.transaction('pins').objectStore('pins').getAll())) counts.set(p.lectureId, (counts.get(p.lectureId) || 0) + 1);
    const lectures = rows.map((l) => ({ id: l.id, name: l.name, mode: l.mode, duration: l.duration, date: l.date, size: l.size, pins: counts.get(l.id) || 0 }));
    return { lectures, stats: stats(lectures, today) };
  }
  async create({ name, mode, mime, date }) {
    const l = { id: crypto.randomUUID(), name, mode, mime: baseMime(mime) || 'video/webm', date, status: 'recording',
      duration: 0, size: 0, chunks: 0, elapsed: 0, createdAt: Date.now() };
    await this.tx(['lectures'], 'readwrite', (s) => s.put(l));
    return l.id;
  }
  writer(id, onError) {
    let seq = 0, chain = Promise.resolve(), failed = false;
    return {
      push: (blob, elapsed) => {
        if (!blob.size) return;
        const n = seq++;
        chain = chain.then(async () => {
          if (failed) return;
          const data = await blob.arrayBuffer(); // store bytes, not Blob: survives Safari/Firefox restarts reliably
          await this.tx(['chunks', 'lectures'], 'readwrite', (c, ls) => {
            c.put({ lectureId: id, seq: n, data });
            const g = ls.get(id);
            g.onsuccess = () => { const l = g.result; l.chunks = n + 1; l.size += data.byteLength; l.elapsed = elapsed; ls.put(l); };
          });
        }).catch((e) => { failed = true; onError?.(friendly(e)); });
      },
      flush: () => chain,
    };
  }
  async finish(id, duration) {
    const l = await this.lecture(id);
    if (!l) throw new ApiError(404, 'Lecture not found.');
    if (!l.chunks) { await this.remove(id); throw new ApiError(400, 'Nothing was recorded.'); }
    l.status = 'saved'; l.duration = Math.max(0, duration | 0);
    await this.tx(['lectures'], 'readwrite', (s) => s.put(l));
  }
  async addPin(id, at, note) {
    let key;
    await this.tx(['pins'], 'readwrite', (s) => { const r = s.add({ lectureId: id, at, note }); r.onsuccess = () => { key = r.result; }; });
    return key;
  }
  async editPin(pinId, note) {
    await this.tx(['pins'], 'readwrite', (s) => { const g = s.get(pinId); g.onsuccess = () => { if (g.result) s.put({ ...g.result, note }); }; });
  }
  async deletePin(pinId) { await this.tx(['pins'], 'readwrite', (s) => s.delete(pinId)); }
  async get(id) {
    const l = await this.lecture(id);
    if (!l || l.status !== 'saved') throw new ApiError(404, 'Lecture not found.');
    const pins = (await this.pinsOf(id)).sort((a, b) => a.at - b.at || a.id - b.id).map(({ id: pid, at, note }) => ({ id: pid, at, note }));
    return { lecture: { id: l.id, name: l.name, mode: l.mode, duration: l.duration, date: l.date, size: l.size, mime: l.mime }, pins };
  }
  async rename(id, name) {
    const l = await this.lecture(id);
    if (!l) throw new ApiError(404, 'Lecture not found.');
    l.name = name; await this.tx(['lectures'], 'readwrite', (s) => s.put(l));
  }
  async remove(id) {
    const pins = await this.pinsOf(id);
    await this.tx(['lectures', 'chunks', 'pins'], 'readwrite', (ls, cs, ps) => {
      ls.delete(id);
      cs.delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
      pins.forEach((p) => ps.delete(p.id));
    });
  }
  async media(id) {
    const l = await this.lecture(id);
    const db = await this.open();
    const chunks = await req(db.transaction('chunks').objectStore('chunks').getAll(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])));
    const blob = new Blob(chunks.sort((a, b) => a.seq - b.seq).map((c) => c.data), { type: l.mime });
    const url = URL.createObjectURL(blob);
    return { src: url, download: url, filename: fileName(l), release: () => URL.revokeObjectURL(url) };
  }
}

/** Use the server only if one is actually there; otherwise run fully in the browser. */
export async function detectStore() {
  try {
    const res = await fetch('api/me', { credentials: 'same-origin' });
    if ((res.headers.get('content-type') || '').includes('application/json')) return new ServerStore();
  } catch { /* offline or static host */ }
  return new LocalStore();
}
