export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(method, url, body) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(url, opts); } catch { throw new ApiError(0, 'Can’t reach the server. Check your connection.'); }
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status}).`);
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Uploads recording chunks one at a time, in order, retrying transient failures. */
export class Uploader {
  constructor(id, onError) { this.id = id; this.seq = 0; this.chain = Promise.resolve(); this.failed = false; this.onError = onError; }
  push(blob, elapsed) {
    if (!blob.size) return;
    const seq = this.seq++;
    this.chain = this.chain.then(() => this.failed ? null : this.send(seq, blob, elapsed)).catch((e) => {
      this.failed = true; this.onError?.(e);
    });
  }
  async send(seq, blob, elapsed) {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(`api/lectures/${this.id}/chunk?seq=${seq}&elapsed=${elapsed}`, {
          method: 'PUT', body: blob, credentials: 'same-origin', headers: { 'content-type': 'application/octet-stream' },
        });
        if (res.ok) return;
        if ([400, 401, 404, 409, 413].includes(res.status)) {
          let msg = ''; try { msg = (await res.json()).error; } catch { /* ignore */ }
          throw new ApiError(res.status, msg || 'Upload rejected.');
        }
      } catch (e) { if (e instanceof ApiError) throw e; }
      if (attempt >= 4) throw new ApiError(0, 'Upload failed after several retries.');
      await sleep(1000 * 2 ** attempt);
    }
  }
  flush() { return this.chain; }
}
