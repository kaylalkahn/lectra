// Property-based tests (fast-check). Each property maps to a requirement in .kiro/specs/lectra/requirements.md.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fc from 'fast-check';
import { fmt, short } from '../docs/format.js';
import { streak } from '../docs/streak.js';
import { seekTarget } from '../docs/transport.js';
import { deriveKey, sealBytes, openBytes, sealJSON, openJSON } from '../docs/crypto.js';
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

// R3.4: Rewind/Fast-forward behave like a tape deck: move at most 15 s, never past either end, never skip a pin.
const pinsArb = fc.array(fc.integer({ min: 0, max: 600 }), { maxLength: 12 });
test('rewind stays within 15 s, stops at the nearest earlier pin, never skips one', () => {
  fc.assert(fc.property(pinsArb, fc.double({ min: 0, max: 600, noNaN: true }), (pins, t) => {
    const r = seekTarget(pins, t, -1);
    assert.ok(r >= Math.max(0, t - 15) - 1e-9 && r <= t, `r=${r} t=${t}`);
    assert.ok(!pins.some((a) => a > r && a < t - 1), 'skipped a pin');
  }));
});
test('fast forward stays within 15 s and the end, stops at the nearest later pin, never skips one', () => {
  fc.assert(fc.property(pinsArb, fc.double({ min: 0, max: 600, noNaN: true }), fc.double({ min: 0, max: 700, noNaN: true }), (pins, t, end) => {
    const f = seekTarget(pins, t, 1, { end });
    assert.ok(f >= t && f <= Math.max(t, Math.min(end, t + 15)) + 1e-9, `f=${f} t=${t} end=${end}`);
    assert.ok(!pins.some((a) => a > t + 0.5 && a < f), 'skipped a pin');
  }));
});
test('repeated rewinds always reach 0 and repeated fast-forwards always reach the end (no getting stuck)', () => {
  fc.assert(fc.property(pinsArb, fc.integer({ min: 0, max: 600 }), (pins, start) => {
    let t = start, n = 0;
    while (t > 0 && n++ < 200) t = seekTarget(pins, t, -1);
    assert.equal(t, 0);
    t = 0; n = 0;
    while (t < 600 && n++ < 200) t = seekTarget(pins, t, 1, { end: 600 });
    assert.equal(t, 600);
  }));
});

// R1 (profiles): what one profile encrypts, only the same password can read; ciphertexts never repeat.
test('profile encryption round-trips and rejects the wrong password', async () => {
  const salt = new Uint8Array(16).fill(7);
  const right = await deriveKey('correct horse', salt, 1000), wrong = await deriveKey('battery staple', salt, 1000);
  await fc.assert(fc.asyncProperty(fc.uint8Array({ maxLength: 2048 }), fc.jsonValue(), async (bytes, json) => {
    const sb = await sealBytes(right, bytes);
    assert.ok(Buffer.from(await openBytes(right, sb)).equals(Buffer.from(bytes)));
    await assert.rejects(openBytes(wrong, sb));
    const sj = await sealJSON(right, json);
    assert.deepEqual(await openJSON(right, sj), JSON.parse(JSON.stringify(json)));
    const again = await sealBytes(right, bytes);
    assert.notDeepEqual(Buffer.from(again.iv), Buffer.from(sb.iv));
  }), { numRuns: 60 });
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
