/* Storage backends with one interface.
 * - LocalStore: everything in this browser's IndexedDB. No server, no account. Used on static hosting (GitHub Pages).
 * - ServerStore: the optional Node server in /server (accounts, recordings on the server).
 * detectStore() picks ServerStore only if a Lectra API answers next to the page. */
import { api, ApiError, Uploader } from './api.js';
import { streak } from './streak.js';
import { sealBytes, openBytes, sealJSON, openJSON } from './crypto.js';

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
const range = (id) => IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
function friendly(e) {
  if (e?.name === 'QuotaExceededError') return new ApiError(507, 'This browser is out of storage space. Delete or download old lectures to free some up.');
  return e instanceof Error ? e : new Error(String(e));
}

/** IndexedDB store. With `key` (a profile's AES key) every record is encrypted: only ids, lecture ids and
 *  chunk numbers stay readable, so the database reveals nothing about names, notes or recordings. */
export class LocalStore {
  kind = 'local';
  constructor(dbName = 'lectra', key = null) { this.dbName = dbName; this.key = key; this.db = null; }
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
  close() { this.db?.close(); this.db = null; this.key = null; }
  async tx(stores, mode, fn) {
    const t = (await this.open()).transaction(stores, mode);
    fn(...stores.map((s) => t.objectStore(s)));
    try { await done(t); } catch (e) { throw friendly(e); }
  }
  async all(store, query) { return req((await this.open()).transaction(store).objectStore(store).getAll(query)); }
  async put(store, rec) { await this.tx([store], 'readwrite', (s) => s.put(rec)); }

  // ---- record codecs (encryption happens outside transactions: IDB transactions can't await crypto) ----
  async encL(l) { return this.key ? { id: l.id, m: await sealJSON(this.key, l) } : l; }
  async decL(r) { return r && (this.key ? openJSON(this.key, r.m) : r); }
  async encP(p) { const { id, lectureId, at, note } = p; const base = id == null ? { lectureId } : { id, lectureId };
    return this.key ? { ...base, m: await sealJSON(this.key, { at, note }) } : { ...base, at, note }; }
  async decP(r) { return this.key ? { id: r.id, lectureId: r.lectureId, ...(await openJSON(this.key, r.m)) } : r; }
  async encC(lectureId, seq, data) { return this.key ? { lectureId, seq, d: await sealBytes(this.key, data) } : { lectureId, seq, data }; }
  async decC(r) { return this.key ? openBytes(this.key, r.d) : r.data; }

  async me() { await this.open(); return { local: true }; }
  async logout() {}
  async lecture(id) { return this.decL(await req((await this.open()).transaction('lectures').objectStore('lectures').get(id))); }
  async saveLecture(l) { await this.put('lectures', await this.encL(l)); }
  async allLectures() { return Promise.all((await this.all('lectures')).map((r) => this.decL(r))); }
  async pinsOf(id) {
    const recs = await req((await this.open()).transaction('pins').objectStore('pins').index('lecture').getAll(id));
    return Promise.all(recs.map((r) => this.decP(r)));
  }

  async recover() {
    let n = 0;
    for (const l of (await this.allLectures()).filter((x) => x.status === 'recording')) {
      if (l.chunks > 0) { l.status = 'saved'; l.duration = l.elapsed; await this.saveLecture(l); n++; } else await this.remove(l.id);
    }
    return n;
  }
  async list(today) {
    const rows = (await this.allLectures()).filter((l) => l.status === 'saved').sort((a, b) => b.createdAt - a.createdAt);
    const counts = new Map();
    for (const p of await this.all('pins')) counts.set(p.lectureId, (counts.get(p.lectureId) || 0) + 1); // lectureId is not secret
    const lectures = rows.map((l) => ({ id: l.id, name: l.name, mode: l.mode, duration: l.duration, date: l.date, size: l.size, pins: counts.get(l.id) || 0 }));
    return { lectures, stats: stats(lectures, today) };
  }
  async create({ name, mode, mime, date }) {
    const l = { id: crypto.randomUUID(), name, mode, mime: baseMime(mime) || 'video/webm', date, status: 'recording',
      duration: 0, size: 0, chunks: 0, elapsed: 0, createdAt: Date.now() };
    await this.saveLecture(l);
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
          const chunk = await this.encC(id, n, data);
          const l = await this.lecture(id);
          l.chunks = n + 1; l.size += data.byteLength; l.elapsed = elapsed;
          const meta = await this.encL(l);
          await this.tx(['chunks', 'lectures'], 'readwrite', (c, ls) => { c.put(chunk); ls.put(meta); }); // chunk + counters together
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
    await this.saveLecture(l);
  }
  async addPin(id, at, note) {
    const rec = await this.encP({ lectureId: id, at, note });
    let key;
    await this.tx(['pins'], 'readwrite', (s) => { const r = s.add(rec); r.onsuccess = () => { key = r.result; }; });
    return key;
  }
  async editPin(pinId, note) {
    const r = await req((await this.open()).transaction('pins').objectStore('pins').get(pinId));
    if (!r) return;
    const p = await this.decP(r);
    await this.put('pins', await this.encP({ ...p, note }));
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
    l.name = name; await this.saveLecture(l);
  }
  async remove(id) {
    await this.tx(['lectures', 'chunks', 'pins'], 'readwrite', (ls, cs, ps) => {
      ls.delete(id); cs.delete(range(id));
      const k = ps.index('lecture').getAllKeys(id);
      k.onsuccess = () => k.result.forEach((x) => ps.delete(x));
    });
  }
  async media(id) {
    const l = await this.lecture(id);
    const recs = (await this.all('chunks', range(id))).sort((a, b) => a.seq - b.seq);
    const parts = [];
    for (const r of recs) parts.push(await this.decC(r));
    const url = URL.createObjectURL(new Blob(parts, { type: l.mime }));
    return { src: url, download: url, filename: fileName(l), release: () => URL.revokeObjectURL(url) };
  }
  /** Copy every saved lecture (video, pins) from another LocalStore into this one, keeping ids. */
  async importFrom(src) {
    let n = 0;
    for (const l of (await src.allLectures()).filter((x) => x.status === 'saved')) {
      for (const c of await src.all('chunks', range(l.id))) await this.put('chunks', await this.encC(l.id, c.seq, await src.decC(c)));
      for (const p of await src.pinsOf(l.id)) await this.put('pins', await this.encP({ lectureId: l.id, at: p.at, note: p.note }));
      await this.saveLecture(l); n++;
    }
    return n;
  }
}

/** Returns a ServerStore if a Lectra server answers next to the page, otherwise null (browser-only mode). */
export async function detectStore() {
  try {
    const res = await fetch('api/me', { credentials: 'same-origin' });
    if ((res.headers.get('content-type') || '').includes('application/json')) return new ServerStore();
  } catch { /* offline or static host */ }
  return null;
}
