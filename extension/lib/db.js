// 端末内の IndexedDB にだけ保存する小さなデータベース。
const DB_NAME = 'local-autofill';
const DB_VERSION = 1;

let dbPromise;
function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('profiles', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('siteRules', { keyPath: 'host' });
      db.createObjectStore('settings', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const listProfiles = () => run('profiles', 'readonly', (s) => s.getAll());
export const getProfile = (id) => run('profiles', 'readonly', (s) => s.get(id));
export const saveProfile = (p) => run('profiles', 'readwrite', (s) => s.put(p));
export const deleteProfile = (id) => run('profiles', 'readwrite', (s) => s.delete(id));
export const clearProfiles = () => run('profiles', 'readwrite', (s) => s.clear());
export async function addProfiles(records) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('profiles', 'readwrite');
    const store = tx.objectStore('profiles');
    for (const r of records) store.add(r);
    tx.oncomplete = () => resolve(records.length);
    tx.onerror = () => reject(tx.error);
  });
}
export async function setDone(id, done) {
  const p = await getProfile(id);
  if (!p) return null;
  p.doneAt = done ? new Date().toLocaleString('ja-JP') : null;
  await saveProfile(p);
  return p;
}

export const getRules = async (host) => (await run('siteRules', 'readonly', (s) => s.get(host)))?.rules || {};
export const saveRules = (host, rules) =>
  run('siteRules', 'readwrite', (s) => (Object.keys(rules).length ? s.put({ host, rules }) : s.delete(host)));
export const listRules = () => run('siteRules', 'readonly', (s) => s.getAll());
export const deleteRules = (host) => run('siteRules', 'readwrite', (s) => s.delete(host));

export const getSetting = async (key, fallback = null) =>
  (await run('settings', 'readonly', (s) => s.get(key)))?.value ?? fallback;
export const setSetting = (key, value) => run('settings', 'readwrite', (s) => s.put({ key, value }));

export async function getActiveProfile() {
  const id = await getSetting('activeProfileId');
  const p = id != null ? await getProfile(id) : null;
  return p || (await listProfiles())[0] || null;
}

export async function exportAll() {
  return {
    app: 'local-autofill',
    version: 1,
    exportedAt: new Date().toISOString(),
    profiles: await listProfiles(),
    siteRules: await listRules(),
  };
}

export async function importAll(data) {
  if (data?.app !== 'local-autofill') throw new Error('このアプリの書き出しファイルではありません');
  for (const p of data.profiles || []) {
    const { id, ...rest } = p;
    await saveProfile(rest);
  }
  for (const r of data.siteRules || []) await saveRules(r.host, r.rules || {});
}
