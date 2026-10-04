import { listProfiles, getActiveProfile, setSetting, getRules, saveRules } from '../lib/db.js';
import { fillTab, scanTab, undoTab } from '../lib/fill-tab.js';
import { FIELD_KEYS } from '../lib/keys.js';

const $ = (id) => document.getElementById(id);
let tab;
let host = '';

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    host = new URL(tab.url).hostname;
  } catch { /* chrome:// など */ }
  $('host').textContent = host || 'このページ';

  const commands = await chrome.commands.getAll();
  const sc = commands.find((c) => c.name === 'fill-form')?.shortcut;
  if (sc) $('shortcut').textContent = sc;
  else $('sc-hint').hidden = true;

  const profiles = await listProfiles();
  if (!profiles.length) {
    $('empty').hidden = false;
    return;
  }
  $('main').hidden = false;
  const active = await getActiveProfile();
  for (const p of profiles) {
    const o = new Option(p.name || '名称未設定', p.id, false, p.id === active?.id);
    $('profile').add(o);
  }
  if (!/^https?:|^file:/.test(tab.url || '')) {
    for (const id of ['fill', 'review', 'undo']) $(id).disabled = true;
    showResult('このページ（Chromeの設定画面など）には入力できません。', true);
  }
}

function showResult(text, warn = false) {
  const el = $('result');
  el.hidden = false;
  el.textContent = text;
  el.classList.toggle('warn', warn);
}

function summarize(res) {
  if (!res) return showResult('入力できませんでした。ページを再読み込みしてお試しください。', true);
  if (res.error === 'no-profile') return showResult('プロフィールがありません。', true);
  const filled = res.fields.filter((f) => f.status === 'filled').length;
  const unknown = res.fields.filter((f) => f.status === 'unknown').length;
  const kept = res.fields.filter((f) => f.status === 'kept').length;
  if (!res.fields.length) return showResult('このページに入力欄が見つかりませんでした。', true);
  let text = `${filled}個の欄に入力しました。`;
  if (kept) text += ` 入力済みの${kept}欄はそのままです。`;
  if (unknown) text += ` 判定できなかった欄が${unknown}個あります。`;
  showResult(text, filled === 0);
}

async function run(fn) {
  try {
    return await fn();
  } catch (e) {
    showResult(`エラー: ${e.message}`, true);
    return null;
  }
}

$('fill').addEventListener('click', async () => {
  const profileId = Number($('profile').value);
  const res = await run(() => fillTab(tab.id, { profileId, overwrite: $('overwrite').checked }));
  if (res) summarize(res);
  if (!$('review-panel').hidden) renderReview(res);
});

$('profile').addEventListener('change', () => setSetting('activeProfileId', Number($('profile').value)));

$('undo').addEventListener('click', async () => {
  const n = await run(() => undoTab(tab.id));
  if (n != null) showResult(n ? `${n}個の欄を元に戻しました。` : '元に戻す入力はありません。');
});

$('review').addEventListener('click', async () => {
  const panel = $('review-panel');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) renderReview(await run(() => scanTab(tab.id)));
});

function renderReview(res) {
  const list = $('field-list');
  list.replaceChildren();
  for (const f of res?.fields || []) {
    const li = document.createElement('li');
    if (!f.key) li.className = 'unknown';
    const label = document.createElement('span');
    label.textContent = f.label;
    label.title = f.label;
    const sel = document.createElement('select');
    sel.dataset.sig = f.sig;
    sel.dataset.original = f.key || '';
    sel.add(new Option('（判定できず）', ''));
    for (const [k, text] of FIELD_KEYS) sel.add(new Option(text, k, false, k === f.key));
    li.append(label, sel);
    list.append(li);
  }
  if (!list.children.length) list.innerHTML = '<li><span>入力欄が見つかりませんでした</span></li>';
}

$('save-rules').addEventListener('click', async () => {
  const rules = await getRules(host);
  for (const sel of $('field-list').querySelectorAll('select')) {
    if (sel.value !== sel.dataset.original) {
      if (sel.value) rules[sel.dataset.sig] = sel.value;
      else delete rules[sel.dataset.sig];
    }
  }
  await saveRules(host, rules);
  await run(() => undoTab(tab.id));
  const res = await run(() => fillTab(tab.id, { profileId: Number($('profile').value), overwrite: $('overwrite').checked }));
  if (res) summarize(res);
  renderReview(res);
});

$('reset-rules').addEventListener('click', async () => {
  await saveRules(host, {});
  renderReview(await run(() => scanTab(tab.id)));
  showResult('このサイトの割り当て指定をリセットしました。');
});

const openOptions = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };
$('open-options').addEventListener('click', openOptions);
$('create-profile').addEventListener('click', openOptions);

init();
