/* Local profiles: a login screen for people sharing one browser. Each profile has its own IndexedDB database,
 * encrypted with a key derived from its password. Nothing leaves the device, so passwords can't be reset. */
import { deriveKey, sealJSON, openJSON } from './crypto.js';
import { LocalStore } from './store.js';

const DB = 'lectra-profiles', CHECK = 'lectra-profile-v1';
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
let dbp;
function db() {
  dbp ||= (() => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('profiles', { keyPath: 'id' }).createIndex('key', 'key', { unique: true });
    return req(r);
  })();
  return dbp;
}
const keyOf = (name) => name.trim().toLowerCase();
async function byName(name) { return req((await db()).transaction('profiles').objectStore('profiles').index('key').get(keyOf(name))); }
export const dbName = (profile) => `lectra-p-${profile.id}`;
export async function count() { return req((await db()).transaction('profiles').objectStore('profiles').count()); }

export async function create(name, password) {
  name = String(name || '').trim();
  if (!name || name.length > 40) throw new Error('Choose a name of 1 to 40 characters.');
  if (String(password).length < 8) throw new Error('Password must be at least 8 characters.');
  if (await byName(name)) throw new Error('A profile with that name already exists in this browser.');
  const first = (await count()) === 0;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  const profile = { id: crypto.randomUUID(), name, key: keyOf(name), salt, check: await sealJSON(key, CHECK), createdAt: Date.now() };
  try { await req((await db()).transaction('profiles', 'readwrite').objectStore('profiles').add(profile)); }
  catch { throw new Error('A profile with that name already exists in this browser.'); }
  return { profile, key, first };
}

export async function unlock(name, password) {
  const profile = await byName(String(name || ''));
  const key = profile && await deriveKey(String(password), profile.salt);
  let ok = false;
  try { ok = !!profile && (await openJSON(key, profile.check)) === CHECK; } catch { ok = false; }
  if (!ok) throw new Error('Name or password is incorrect.');
  return { profile, key, first: false };
}

const deleteDb = (name) => new Promise((res, rej) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = res; r.onerror = () => rej(r.error); r.onblocked = res; });
export async function remove(name) {
  const profile = await byName(String(name || ''));
  if (!profile) throw new Error('No profile with that name in this browser.');
  await deleteDb(dbName(profile));
  await req((await db()).transaction('profiles', 'readwrite').objectStore('profiles').delete(profile.id));
}

/** Lectures saved before profiles existed (unencrypted `lectra` database) move into the first profile created. */
export async function adoptLegacy(target) {
  if (indexedDB.databases && !(await indexedDB.databases()).some((d) => d.name === 'lectra')) return 0;
  const legacy = new LocalStore('lectra');
  try {
    await legacy.recover();
    const n = await target.importFrom(legacy);
    legacy.close();
    await deleteDb('lectra');
    return n;
  } catch { legacy.close(); return 0; }
}
