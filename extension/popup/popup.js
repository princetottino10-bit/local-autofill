import { listProfiles, getActiveProfile, getSetting, setSetting, setDone, getRules, saveRules } from '../lib/db.js';
import { fillTab, scanTab, undoTab } from '../lib/fill-tab.js';
import { FIELD_KEYS } from '../lib/keys.js';
import { displayName, toHiragana, columnNames } from '../lib/csv.js';

const $ = (id) => document.getElementById(id);
const MAX_LIST = 50;
let tab;
let host = '';
let people = [];
let current = null;

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

  people = await listProfiles();
  if (!people.length) {
    $('empty').hidden = false;
    return;
  }
  $('main').hidden = false;
  const active = await getActiveProfile();
  current = people.find((p) => p.id === active?.id) || people.find((p) => !p.doneAt) || people[0];
  renderList();
  renderCurrent();
  $('search').focus();
  if (!/^https?:|^file:/.test(tab.url || '')) {
    for (const id of ['fill', 'review', 'undo']) $(id).disabled = true;
    showResult('このページ（Chromeの設定画面など）には入力できません。', true);
  }
}

// ---------- 名簿の検索・選択 ----------
function matches(p, q) {
  if (!q) return true;
  const d = p.data;
  const hay = [d.last_name, d.first_name, d.last_kana, d.first_kana, d.phone, d.email, p.memo].join(' ').toLowerCase();
  const compact = hay.replace(/[\s-]/g, '');
  return q.split(/\s+/).every((w) => hay.includes(w) || compact.includes(w.replace(/-/g, '')) || hay.includes(toHiragana(w)));
}

function visible() {
  const q = $('search').value.trim().toLowerCase();
  const todoOnly = $('todo-only').checked;
  return people.filter((p) => matches(p, q) && (!todoOnly || !p.doneAt || p.id === current?.id));
}

function renderList() {
  const list = $('people');
  list.replaceChildren();
  const all = visible();
  for (const p of all.slice(0, MAX_LIST)) {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    // 一覧の中でTabで止まるのは選択中の人だけ（矢印キーで移動）
    li.tabIndex = p.id === current?.id ? 0 : -1;
    li.setAttribute('aria-selected', String(p.id === current?.id));
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(p).then(() => $('fill').focus()); }
      if (e.key === 'ArrowDown') { e.preventDefault(); li.nextElementSibling?.focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); (li.previousElementSibling || $('search')).focus(); }
    });
    const name = document.createElement('span');
    name.textContent = (p.doneAt ? '✓ ' : '') + displayName(p.data);
    const sub = document.createElement('small');
    sub.textContent = [p.data.last_kana, p.data.first_kana].filter(Boolean).join(' ') || p.data.phone || '';
    li.append(name, sub);
    li.addEventListener('click', () => select(p));
    list.append(li);
  }
  if (!list.querySelector('li[tabindex="0"]') && list.firstElementChild) list.firstElementChild.tabIndex = 0;
  if (!all.length) list.innerHTML = '<li class="none">見つかりません</li>';
  else if (all.length > MAX_LIST) {
    const li = document.createElement('li');
    li.className = 'none';
    li.textContent = `ほか${all.length - MAX_LIST}人（検索で絞り込んでください）`;
    list.append(li);
  }
  const done = people.filter((p) => p.doneAt).length;
  $('progress').textContent = `${people.length}人中 ${done}人入力済み・残り${people.length - done}人`;
}

function renderCurrent() {
  const p = current;
  $('current').hidden = !p;
  $('fill').disabled = !p;
  $('done-next').disabled = !p;
  if (!p) return;
  const d = p.data;
  $('current-name').textContent = displayName(d);
  $('current-sub').textContent = [[d.last_kana, d.first_kana].filter(Boolean).join(' '), d.pref + d.city].filter(Boolean).join('・');
  $('current-badge').textContent = p.doneAt ? '入力済み' : '未入力';
  $('current-badge').className = `badge ${p.doneAt ? 'done' : 'todo'}`;
  $('done-next').textContent = p.doneAt ? '次の未入力の人へ' : '入力済みにして次の人へ';
}

async function select(p) {
  confirmDone = false;
  current = p;
  await setSetting('activeProfileId', p.id);
  renderList();
  renderCurrent();
}

$('search').addEventListener('input', renderList);
$('search').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    $('people').querySelector('li[role=option]')?.focus();
  }
  if (e.key === 'Enter') {
    const first = visible()[0];
    if (first) select(first);
  }
});
$('todo-only').addEventListener('change', renderList);

let confirmDone = false;
$('done-next').addEventListener('click', async () => {
  if (!current) return;
  // 一度も入力していない人を「入力済み」にしようとしたら、もう一度押してもらう
  if (!current.doneAt && !confirmDone && (await getSetting('lastFilledProfileId')) !== current.id) {
    confirmDone = true;
    showResult(`${displayName(current.data)}さんはまだこのボタンから入力していません。入力済みにしてよければ、もう一度押してください。`, true);
    return;
  }
  confirmDone = false;
  if (!current.doneAt) {
    const updated = await setDone(current.id, true);
    people = people.map((p) => (p.id === updated.id ? updated : p));
  }
  const idx = people.findIndex((p) => p.id === current.id);
  const next = [...people.slice(idx + 1), ...people.slice(0, idx)].find((p) => !p.doneAt);
  $('result').hidden = true;
  if (next) {
    $('search').value = '';
    await select(next);
  } else {
    current = people.find((p) => p.id === current.id);
    renderList();
    renderCurrent();
    showResult('全員の入力が終わりました。');
  }
});

// ---------- 入力 ----------
function showResult(text, warn = false) {
  const el = $('result');
  el.hidden = false;
  el.textContent = text;
  el.classList.toggle('warn', warn);
}

const labels = (fields, status) => fields.filter((f) => f.status === status).map((f) => `「${f.label}」`);

function summarize(res) {
  if (!res) return showResult('入力できませんでした。ページを再読み込みしてお試しください。', true);
  if (res.error === 'no-profile') return showResult('名簿に人がいません。', true);
  const fields = res.fields.filter((f) => f.status !== 'other-form');
  if (!fields.length) return showResult('このページに入力欄が見つかりませんでした。', true);
  const filled = fields.filter((f) => f.status === 'filled');
  const replaced = filled.filter((f) => f.replaced).length;
  const kept = labels(fields, 'kept');
  const noMatch = labels(fields, 'no-match');
  const noValue = labels(fields, 'no-value');
  const unknown = labels(fields, 'unknown');
  const lines = [`${displayName(current.data)}さんの情報を${filled.length}個の欄に入力しました。`];
  if (replaced) lines.push(`前の人の情報が残っていた${replaced}欄は書き換えました。`);
  if (kept.length) lines.push(`⚠ 最初から入力されていたため、そのままにした欄: ${kept.join('')}（違う人の情報なら「入力済みの欄も上書きする」にチェックして入力し直してください）`);
  if (noMatch.length) lines.push(`⚠ 選択肢が合わず選べなかった欄: ${noMatch.join('')}`);
  if (noValue.length) lines.push(`名簿にデータがない欄: ${noValue.join('')}`);
  if (unknown.length) lines.push(`判定できなかった欄: ${unknown.join('')}（「欄の割り当てを確認」で項目や名簿の列を指定できます）`);
  showResult(lines.join('\n'), filled.length === 0 || kept.length > 0 || noMatch.length > 0);
}

async function run(fn) {
  try {
    return await fn();
  } catch (e) {
    showResult(`エラー: ${e.message}`, true);
    return null;
  }
}

const doFill = () => fillTab(tab.id, { profileId: current.id, overwrite: $('overwrite').checked });

$('fill').addEventListener('click', async () => {
  if (!current) return;
  const res = await run(doFill);
  if (res) summarize(res);
  if (!$('review-panel').hidden) renderReview(res);
});

$('undo').addEventListener('click', async () => {
  const n = await run(() => undoTab(tab.id));
  if (n != null) showResult(n ? `${n}個の欄を元に戻しました。` : '元に戻す入力はありません。');
});

// ---------- 欄の割り当て ----------
$('review').addEventListener('click', async () => {
  const panel = $('review-panel');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) {
    renderReview(await run(() => scanTab(tab.id)));
    panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
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
    const standard = document.createElement('optgroup');
    standard.label = '決まった項目';
    for (const [k, text] of FIELD_KEYS) standard.append(new Option(text, k, false, k === f.key));
    sel.append(standard);
    // 名簿の列（CSVの見出し）。割り当て済みの列が今の名簿にない場合も残して表示する
    const cols = columnNames(people);
    if (f.key?.startsWith('col:') && !cols.includes(f.key.slice(4))) cols.push(f.key.slice(4));
    if (cols.length) {
      const group = document.createElement('optgroup');
      group.label = '名簿の列（CSVの見出し）';
      for (const name of cols) group.append(new Option(`列「${name}」`, `col:${name}`, false, f.key === `col:${name}`));
      sel.append(group);
    }
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
  const res = await run(doFill);
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
