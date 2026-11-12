import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { streak } from './streak.js';

const scrypt = promisify(crypto.scrypt);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 86400000;
const SESSION_COOKIE = 'lectra_sid';
const MIMES = { 'video/webm': 'webm', 'video/mp4': 'mp4' };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const clip = (s, n) => String(s ?? '').trim().slice(0, n);

export function createApp({ dataDir, secureCookies = false, maxLectureBytes = 4 * 1024 ** 3 } = {}) {
  const db = openDb(dataDir);
  const mediaDir = path.join(dataDir, 'media');
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', 1);

  // ---------- security headers ----------
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        "worker-src 'self' blob:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
      ].join('; '),
    });
    next();
  });

  // ---------- helpers ----------
  const q = {
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    insertUser: db.prepare('INSERT INTO users(email,name,pass_hash,salt,created_at) VALUES(?,?,?,?,?)'),
    insertSession: db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)'),
    sessionUser: db.prepare(
      'SELECT u.id,u.email,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?'),
    delSession: db.prepare('DELETE FROM sessions WHERE token_hash=?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at<=?'),
    lecture: db.prepare('SELECT * FROM lectures WHERE id=? AND user_id=?'),
    saved: db.prepare(`SELECT l.id,l.name,l.mode,l.duration,l.date,l.size,l.created_at,
        (SELECT COUNT(*) FROM pins p WHERE p.lecture_id=l.id) AS pins
        FROM lectures l WHERE l.user_id=? AND l.status='saved' ORDER BY l.created_at DESC`),
    pins: db.prepare('SELECT id,at,note FROM pins WHERE lecture_id=? ORDER BY at,id'),
    pinOwned: db.prepare(`SELECT p.id,p.lecture_id FROM pins p JOIN lectures l ON l.id=p.lecture_id
        WHERE p.id=? AND l.user_id=?`),
  };

  function cookies(req) {
    const out = {};
    for (const part of (req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }
  function setSession(res, token) {
    const flags = `Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${secureCookies ? '; Secure' : ''}`;
    res.append('Set-Cookie', `${SESSION_COOKIE}=${token}; ${flags}`);
  }
  function clearSession(res) {
    res.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  }
  function auth(req, res, next) {
    const token = cookies(req)[SESSION_COOKIE];
    const user = token && q.sessionUser.get(sha(token), Date.now());
    if (!user) return res.status(401).json({ error: 'Please log in.' });
    req.user = user;
    next();
  }
  const fail = (res, code, error) => res.status(code).json({ error });
  const mediaPath = (l) => path.join(mediaDir, `${l.id}.${MIMES[l.mime] || 'webm'}`);

  // very small in-memory rate limiter for auth attempts
  const hits = new Map();
  function limited(req, res, next) {
    const key = req.ip, now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < 10 * 60000);
    hits.set(key, list);
    if (list.length >= 20) return fail(res, 429, 'Too many attempts. Try again in a few minutes.');
    next();
  }
  function strike(req) { // only failed logins and signups count against the limit
    const list = hits.get(req.ip) || [];
    list.push(Date.now()); hits.set(req.ip, list);
    if (hits.size > 5000) hits.clear();
  }

  const json = express.json({ limit: '32kb' });

  // ---------- auth ----------
  async function startSession(res, userId) {
    const token = crypto.randomBytes(32).toString('hex');
    q.purgeSessions.run(Date.now());
    q.insertSession.run(sha(token), userId, Date.now() + 30 * DAY);
    setSession(res, token);
  }
  app.post('/api/auth/signup', limited, json, async (req, res) => {
    const email = clip(req.body?.email, 200).toLowerCase();
    const password = String(req.body?.password ?? '');
    const name = clip(req.body?.name, 80);
    strike(req);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'Enter a valid email address.');
    if (password.length < 8 || password.length > 200) return fail(res, 400, 'Password must be at least 8 characters.');
    if (q.userByEmail.get(email)) return fail(res, 409, 'An account with that email already exists.');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = (await scrypt(password, salt, 64)).toString('hex');
    let id;
    try { id = Number(q.insertUser.run(email, name, hash, salt, Date.now()).lastInsertRowid); }
    catch { return fail(res, 409, 'An account with that email already exists.'); }
    await startSession(res, id);
    res.status(201).json({ user: { id, email, name } });
  });
  app.post('/api/auth/login', limited, json, async (req, res) => {
    const email = clip(req.body?.email, 200).toLowerCase();
    const password = String(req.body?.password ?? '');
    const u = q.userByEmail.get(email);
    // always run scrypt to keep timing similar for unknown emails
    const hash = (await scrypt(password, u?.salt || 'x'.repeat(32), 64));
    const ok = u && crypto.timingSafeEqual(hash, Buffer.from(u.pass_hash, 'hex'));
    if (!ok) { strike(req); return fail(res, 401, 'Email or password is incorrect.'); }
    await startSession(res, u.id);
    res.json({ user: { id: u.id, email: u.email, name: u.name } });
  });
  app.post('/api/auth/logout', (req, res) => {
    const token = cookies(req)[SESSION_COOKIE];
    if (token) q.delSession.run(sha(token));
    clearSession(res);
    res.json({ ok: true });
  });
  app.get('/api/me', auth, (req, res) => res.json({ user: req.user }));

  // ---------- lectures ----------
  app.get('/api/lectures', auth, (req, res) => {
    const today = DATE_RE.test(req.query.today) ? req.query.today : new Date().toISOString().slice(0, 10);
    const rows = q.saved.all(req.user.id);
    res.json({
      lectures: rows,
      stats: {
        count: rows.length,
        totalSeconds: rows.reduce((a, r) => a + r.duration, 0),
        streak: streak(rows.map((r) => r.date), today),
      },
    });
  });

  app.post('/api/lectures', auth, json, (req, res) => {
    const name = clip(req.body?.name, 120) || 'Untitled lecture';
    const mode = req.body?.mode === 'Slides and voice' ? 'Slides and voice' : 'Screen and voice';
    const base = String(req.body?.mime || '').split(';')[0].trim().toLowerCase();
    if (!MIMES[base]) return fail(res, 400, 'Unsupported recording format.');
    const date = DATE_RE.test(req.body?.date) ? req.body.date : new Date().toISOString().slice(0, 10);
    const id = crypto.randomUUID(), now = Date.now();
    db.prepare(`INSERT INTO lectures(id,user_id,name,mode,mime,date,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(id, req.user.id, name, mode, base, date, now, now);
    res.status(201).json({ id });
  });

  const rawChunk = express.raw({ type: () => true, limit: '64mb' });
  app.put('/api/lectures/:id/chunk', auth, rawChunk, async (req, res) => {
    const l = q.lecture.get(req.params.id, req.user.id);
    if (!l) return fail(res, 404, 'Lecture not found.');
    if (l.status !== 'recording') return fail(res, 409, 'This lecture is already saved.');
    const seq = Number(req.query.seq);
    if (!Number.isInteger(seq) || seq < 0) return fail(res, 400, 'Bad chunk number.');
    if (seq < l.chunks) return res.json({ ok: true, duplicate: true }); // safe retry
    if (seq > l.chunks) return fail(res, 409, 'Chunk out of order.');
    if (!Buffer.isBuffer(req.body) || !req.body.length) return fail(res, 400, 'Empty chunk.');
    if (l.size + req.body.length > maxLectureBytes) return fail(res, 413, 'Lecture is too large.');
    await fs.promises.appendFile(mediaPath(l), req.body);
    const elapsed = Math.max(0, Math.min(Number(req.query.elapsed) | 0, 7 * 86400));
    db.prepare('UPDATE lectures SET size=size+?, chunks=chunks+1, elapsed=?, updated_at=? WHERE id=?')
      .run(req.body.length, elapsed, Date.now(), l.id);
    res.json({ ok: true });
  });

  function finalize(l, duration) {
    if (l.size === 0) { // nothing was captured; drop the empty draft
      db.prepare('DELETE FROM lectures WHERE id=?').run(l.id);
      fs.rmSync(mediaPath(l), { force: true });
      return false;
    }
    db.prepare(`UPDATE lectures SET status='saved', duration=?, updated_at=? WHERE id=?`)
      .run(Math.max(0, duration | 0), Date.now(), l.id);
    return true;
  }

  app.post('/api/lectures/recover', auth, (req, res) => {
    const drafts = db.prepare(`SELECT * FROM lectures WHERE user_id=? AND status='recording'`).all(req.user.id);
    let recovered = 0;
    for (const l of drafts) if (finalize(l, l.elapsed)) recovered++;
    res.json({ recovered });
  });

  app.post('/api/lectures/:id/finish', auth, json, (req, res) => {
    const l = q.lecture.get(req.params.id, req.user.id);
    if (!l) return fail(res, 404, 'Lecture not found.');
    if (l.status === 'saved') return res.json({ ok: true });
    const dur = Number.isFinite(+req.body?.duration) ? +req.body.duration : l.elapsed;
    if (!finalize(l, Math.min(dur, 7 * 86400))) return fail(res, 400, 'Nothing was recorded.');
    res.json({ ok: true });
  });

  app.get('/api/lectures/:id', auth, (req, res) => {
    const l = q.lecture.get(req.params.id, req.user.id);
    if (!l || l.status !== 'saved') return fail(res, 404, 'Lecture not found.');
    res.json({
      lecture: { id: l.id, name: l.name, mode: l.mode, duration: l.duration, date: l.date, size: l.size },
      pins: q.pins.all(l.id),
    });
  });

  app.patch('/api/lectures/:id', auth, json, (req, res) => {
    const l = q.lecture.get(req.params.id, req.user.id);
    if (!l) return fail(res, 404, 'Lecture not found.');
    const name = clip(req.body?.name, 120);
    if (!name) return fail(res, 400, 'Name cannot be empty.');
    db.prepare('UPDATE lectures SET name=? WHERE id=?').run(name, l.id);
    res.json({ ok: true, name });
  });

  app.delete('/api/lectures/:id', auth, (req, res) => {
    const l = q.lecture.get(req.params.id, req.user.id);
    if (!l) return fail(res, 404, 'Lecture not found.');
    db.prepare('DELETE FROM lectures WHERE id=?').run(l.id);
    fs.rmSync(mediaPath(l), { force: true });
    res.json({ ok: true });
  });

  app.get('/api/lectures/:id/media', auth, (req, res) => {
    const l = q.lecture.get(req.params.id, req.user.id);
    if (!l || l.status !== 'saved') return fail(res, 404, 'Lecture not found.');
    const file = mediaPath(l);
    if (!fs.existsSync(file)) return fail(res, 404, 'Recording file is missing.');
    res.type(l.mime);
    res.set('Cache-Control', 'private, max-age=0');
    if (req.query.download) {
      const safe = l.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'lecture';
      res.set('Content-Disposition', `attachment; filename="${safe}-${l.date}.${MIMES[l.mime]}"`);
    }
    res.sendFile(file); // handles Range requests
  });

  // ---------- pins ----------
  app.post('/api/lectures/:id/pins', auth, json, (req, res) => {
    const l = q.lecture.get(req.params.id, req.user.id);
    if (!l) return fail(res, 404, 'Lecture not found.');
    const at = Math.max(0, Math.min(Number(req.body?.at) | 0, 7 * 86400));
    const note = clip(req.body?.note, 500);
    const id = Number(db.prepare('INSERT INTO pins(lecture_id,at,note) VALUES(?,?,?)').run(l.id, at, note).lastInsertRowid);
    res.status(201).json({ pin: { id, at, note } });
  });
  app.patch('/api/pins/:id', auth, json, (req, res) => {
    const p = q.pinOwned.get(Number(req.params.id), req.user.id);
    if (!p) return fail(res, 404, 'Pin not found.');
    const note = clip(req.body?.note, 500);
    db.prepare('UPDATE pins SET note=? WHERE id=?').run(note, p.id);
    res.json({ ok: true, note });
  });
  app.delete('/api/pins/:id', auth, (req, res) => {
    const p = q.pinOwned.get(Number(req.params.id), req.user.id);
    if (!p) return fail(res, 404, 'Pin not found.');
    db.prepare('DELETE FROM pins WHERE id=?').run(p.id);
    res.json({ ok: true });
  });

  // ---------- static ----------
  app.use('/vendor/pdfjs', express.static(path.join(root, 'node_modules/pdfjs-dist/build')));
  app.use(express.static(path.join(root, 'public')));
  app.use('/api', (req, res) => fail(res, 404, 'Not found.'));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return fail(res, 413, 'Request too large.');
    if (err.type === 'entity.parse.failed') return fail(res, 400, 'Bad JSON.');
    console.error(err);
    fail(res, 500, 'Something went wrong.');
  });

  app.locals.db = db;
  return app;
}
