// Property-based tests (fast-check). Each property maps to a requirement in .kiro/specs/lectra/requirements.md.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fc from 'fast-check';
import { fmt, short } from '../docs/format.js';
import { streak } from '../docs/streak.js';
import { createApp } from '../server/app.js';

const BASE = Date.UTC(2026, 0, 1);
const isoDay = (offset) => new Date(BASE + offset * 86400000).toISOString().slice(0, 10);

// R2.4: the clock always renders as HH:MM:SS and parses back to the same number of seconds.
test('fmt round-trips seconds', () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 99 * 3600 + 3599 }), (s) => {
    const m = /^(\d{2}):([0-5]\d):([0-5]\d)$/.exec(fmt(s));
    assert.ok(m, fmt(s));
    assert.equal(+m[1] * 3600 + +m[2] * 60 + +m[3], s);
  }));
});

// R4.4: totals are always displayed in a well-formed way (never NaN/undefined).
test('short() renders every duration in a recognised unit format', () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 10 * 86400 }), (s) => {
    assert.match(short(s), /^\d+(s|m \d{2}s|h \d{2}m)$/);
  }));
});

// R4.4: streak semantics. n consecutive days ending today (or yesterday) => n, regardless of order,
// duplicates, older isolated days, or a gap before the run.
test('streak equals the length of the run ending today/yesterday', () => {
  fc.assert(fc.property(
    fc.integer({ min: 1, max: 30 }),          // run length
    fc.boolean(),                              // run ends yesterday instead of today
    fc.integer({ min: 2, max: 20 }),           // gap before the run (>=1 empty day)
    fc.array(fc.integer({ min: 0, max: 40 }), { maxLength: 10 }), // older noise beyond the gap
    fc.integer({ min: 100, max: 200 }),        // "today" as day offset
    (len, endsYesterday, gap, noise, today) => {
      const last = endsYesterday ? today - 1 : today;
      const run = Array.from({ length: len }, (_, i) => last - i);
      const olderNoise = noise.map((n) => last - len - gap - n);
      const all = [...run, ...olderNoise, ...run].reverse().map(isoDay);
      assert.equal(streak(all, isoDay(today)), len);
    }));
});

test('streak is 0 when the most recent lecture is 2+ days old, and never exceeds distinct days', () => {
  fc.assert(fc.property(
    fc.array(fc.integer({ min: 0, max: 60 }), { maxLength: 40 }), fc.integer({ min: 2, max: 30 }),
    (offsets, ahead) => {
      const dates = offsets.map(isoDay);
      const today = isoDay(60 + ahead);
      assert.equal(streak(dates, today), 0);
      assert.ok(streak(dates, isoDay(60)) <= new Set(dates).size);
    }));
});

// R2.6: however the recorder splits the stream into chunks, and even if a chunk upload is retried,
// the stored file is byte-identical to what was recorded.
let server, base, dir;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lectra-pbt-'));
  await new Promise((r) => { server = createApp({ dataDir: dir }).listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('chunked upload reassembles exactly, with retries', async () => {
  let cookie = '';
  const call = async (method, url, body) => {
    const isBuf = body instanceof Uint8Array;
    const res = await fetch(base + url, { method, headers: { cookie, 'content-type': isBuf ? 'application/octet-stream' : 'application/json' }, body: isBuf ? body : body && JSON.stringify(body) });
    const sc = res.headers.getSetCookie?.()[0]; if (sc) cookie = sc.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  };
  await call('POST', '/api/auth/signup', { email: 'pbt@x.io', password: 'password123' });

  await fc.assert(fc.asyncProperty(
    fc.array(fc.uint8Array({ minLength: 1, maxLength: 300 }), { minLength: 1, maxLength: 8 }),
    fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
    async (chunks, retry) => {
      const { data: { id } } = await call('POST', '/api/lectures', { name: 'p', mime: 'video/webm', date: '2026-01-01' });
      for (let i = 0; i < chunks.length; i++) {
        assert.equal((await call('PUT', `/api/lectures/${id}/chunk?seq=${i}`, chunks[i])).status, 200);
        if (retry[i]) assert.equal((await call('PUT', `/api/lectures/${id}/chunk?seq=${i}`, chunks[i])).data.duplicate, true);
      }
      assert.equal((await call('POST', `/api/lectures/${id}/finish`, { duration: 1 })).status, 200);
      const got = (await call('GET', `/api/lectures/${id}/media`)).data;
      assert.ok(Buffer.concat(chunks).equals(got), 'stored bytes differ from recorded bytes');
    }), { numRuns: 25 });
});
