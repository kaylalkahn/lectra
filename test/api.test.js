import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

let server, base, dir;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lectra-'));
  const app = createApp({ dataDir: dir, maxLectureBytes: 1024 });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

// tiny cookie-aware client
function client() {
  let cookie = '';
  return async (method, url, body, opts = {}) => {
    const headers = { cookie };
    let payload;
    if (body instanceof Buffer) { payload = body; headers['content-type'] = 'application/octet-stream'; }
    else if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    const res = await fetch(base + url, { method, headers: { ...headers, ...opts.headers }, body: payload });
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) cookie = c.startsWith('lectra_sid=;') || /Max-Age=0/.test(c) ? '' : c.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, data: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  };
}

test('auth: signup validation, login, logout, protected routes', async () => {
  const c = client();
  assert.equal((await c('GET', '/api/me')).status, 401);
  assert.equal((await c('POST', '/api/auth/signup', { email: 'bad', password: 'longenough' })).status, 400);
  assert.equal((await c('POST', '/api/auth/signup', { email: 'a@b.co', password: 'short' })).status, 400);
  const s = await c('POST', '/api/auth/signup', { email: 'A@b.co', password: 'password123' });
  assert.equal(s.status, 201);
  assert.equal((await c('GET', '/api/me')).data.user.email, 'a@b.co');
  assert.equal((await c('POST', '/api/auth/signup', { email: 'a@b.co', password: 'password123' })).status, 409);
  await c('POST', '/api/auth/logout');
  assert.equal((await c('GET', '/api/me')).status, 401);
  assert.equal((await c('POST', '/api/auth/login', { email: 'a@b.co', password: 'wrongwrong' })).status, 401);
  assert.equal((await c('POST', '/api/auth/login', { email: 'a@b.co', password: 'password123' })).status, 200);
  assert.equal((await c('GET', '/api/me')).status, 200);
});

test('lecture lifecycle: chunks, pins, finish, media, rename, delete, isolation', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { email: 'l@x.io', password: 'password123' });
  const { data: { id } } = await c('POST', '/api/lectures', { name: 'Quantum', mode: 'Slides and voice', mime: 'video/webm;codecs=vp9,opus', date: '2026-11-12' });
  assert.ok(id);
  assert.equal((await c('POST', '/api/lectures', { name: 'x', mime: 'text/html' })).status, 400);

  const a = Buffer.from('hello '), b = Buffer.from('world');
  assert.equal((await c('PUT', `/api/lectures/${id}/chunk?seq=1`, b)).status, 409); // out of order
  assert.equal((await c('PUT', `/api/lectures/${id}/chunk?seq=0&elapsed=5`, a)).status, 200);
  assert.equal((await c('PUT', `/api/lectures/${id}/chunk?seq=0&elapsed=5`, a)).data.duplicate, true); // retry-safe
  assert.equal((await c('PUT', `/api/lectures/${id}/chunk?seq=1&elapsed=10`, b)).status, 200);
  assert.equal((await c('PUT', `/api/lectures/${id}/chunk?seq=2`, Buffer.alloc(2000))).status, 413);

  const pin = await c('POST', `/api/lectures/${id}/pins`, { at: 7, note: 'Key idea' });
  assert.equal(pin.status, 201);
  assert.equal((await c('PATCH', `/api/pins/${pin.data.pin.id}`, { note: 'Edited' })).status, 200);

  // not listed until finished
  assert.equal((await c('GET', '/api/lectures?today=2026-11-12')).data.lectures.length, 0);
  assert.equal((await c('POST', `/api/lectures/${id}/finish`, { duration: 10 })).status, 200);
  const list = (await c('GET', '/api/lectures?today=2026-11-12')).data;
  assert.equal(list.lectures[0].pins, 1);
  assert.equal(list.stats.count, 1);
  assert.equal(list.stats.totalSeconds, 10);
  assert.equal(list.stats.streak, 1);

  const media = await c('GET', `/api/lectures/${id}/media`);
  assert.equal(media.data.toString(), 'hello world');
  const range = await c('GET', `/api/lectures/${id}/media`, undefined, { headers: { range: 'bytes=6-' } });
  assert.equal(range.status, 206);
  assert.equal(range.data.toString(), 'world');
  assert.match((await c('GET', `/api/lectures/${id}/media?download=1`)).headers.get('content-disposition'), /Quantum-2026-11-12\.webm/);

  const detail = (await c('GET', `/api/lectures/${id}`)).data;
  assert.equal(detail.pins[0].note, 'Edited');

  // another user cannot touch it
  const o = client();
  await o('POST', '/api/auth/signup', { email: 'o@x.io', password: 'password123' });
  for (const [m, u] of [['GET', `/api/lectures/${id}`], ['GET', `/api/lectures/${id}/media`], ['DELETE', `/api/lectures/${id}`], ['PATCH', `/api/pins/${pin.data.pin.id}`]])
    assert.equal((await o(m, u, m === 'PATCH' ? { note: 'x' } : undefined)).status, 404, `${m} ${u}`);

  assert.equal((await c('PATCH', `/api/lectures/${id}`, { name: 'Renamed' })).data.name, 'Renamed');
  assert.equal((await c('PATCH', `/api/lectures/${id}`, { name: '  ' })).status, 400);
  assert.equal((await c('DELETE', `/api/pins/${pin.data.pin.id}`)).status, 200);
  assert.equal((await c('DELETE', `/api/lectures/${id}`)).status, 200);
  assert.equal((await c('GET', `/api/lectures/${id}`)).status, 404);
});

test('recover: interrupted recordings are saved, empty ones dropped', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { email: 'r@x.io', password: 'password123' });
  const mk = async () => (await c('POST', '/api/lectures', { name: 'n', mime: 'video/webm', date: '2026-11-12' })).data.id;
  const full = await mk(), empty = await mk();
  await c('PUT', `/api/lectures/${full}/chunk?seq=0&elapsed=42`, Buffer.from('data'));
  assert.equal((await c('POST', '/api/lectures/recover')).data.recovered, 1);
  const list = (await c('GET', '/api/lectures')).data.lectures;
  assert.equal(list.length, 1);
  assert.equal(list[0].duration, 42);
  assert.equal((await c('POST', `/api/lectures/${empty}/finish`, { duration: 1 })).status, 404);
});

test('streak counts consecutive days, alive if last was yesterday', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { email: 's@x.io', password: 'password123' });
  for (const date of ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-05']) {
    const { data: { id } } = await c('POST', '/api/lectures', { name: date, mime: 'video/webm', date });
    await c('PUT', `/api/lectures/${id}/chunk?seq=0`, Buffer.from('x'));
    await c('POST', `/api/lectures/${id}/finish`, { duration: 1 });
  }
  assert.equal((await c('GET', '/api/lectures?today=2026-11-12')).data.stats.streak, 3);
  assert.equal((await c('GET', '/api/lectures?today=2026-11-13')).data.stats.streak, 0);
});

test('serves static app with CSP', async () => {
  const res = await fetch(base + '/');
  assert.ok(res.headers.get('content-security-policy'));
});

test('rate limit counts failures only: many good logins never lock you out, bad ones do', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { email: 'rl@x.io', password: 'password123' });
  for (let i = 0; i < 25; i++) assert.equal((await c('POST', '/api/auth/login', { email: 'rl@x.io', password: 'password123' })).status, 200);
  let last;
  for (let i = 0; i < 25; i++) last = (await c('POST', '/api/auth/login', { email: 'rl@x.io', password: 'nope-nope' })).status;
  assert.equal(last, 429);
});

test('healthz reports ok (used by host health checks)', async () => {
  const res = await fetch(base + '/healthz');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ok');
});
