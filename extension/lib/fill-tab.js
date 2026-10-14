import { getActiveProfile, getProfile, getRules, getSetting, setSetting } from './db.js';

async function inject(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content/filler.js'] });
}

async function call(tabId, method, ...args) {
  await inject(tabId);
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (m, a) => window.__localAutofill[m](...a),
    args: [method, args],
  });
  return res?.result;
}

async function hostOf(tabId) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: () => location.hostname });
  return res?.result || '';
}

export async function fillTab(tabId, { profileId, overwrite = false } = {}) {
  const profile = profileId != null ? await getProfile(profileId) : await getActiveProfile();
  if (!profile) return { error: 'no-profile' };
  const rules = await getRules(await hostOf(tabId));
  // 前に入力した人のデータ。ページに残っていたら上書きして、2人の情報が混ざらないようにする
  const lastId = await getSetting('lastFilledProfileId');
  const prev = lastId != null && lastId !== profile.id ? await getProfile(lastId) : null;
  const res = await call(tabId, 'fill', profile.data, rules, { overwrite, prevData: prev?.data || null });
  if (res?.fields?.some((f) => f.status === 'filled')) await setSetting('lastFilledProfileId', profile.id);
  return res;
}

export async function scanTab(tabId) {
  const rules = await getRules(await hostOf(tabId));
  return call(tabId, 'scan', rules);
}

export const undoTab = (tabId) => call(tabId, 'undo');
