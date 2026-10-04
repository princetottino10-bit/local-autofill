import {
  listProfiles, saveProfile, deleteProfile, clearProfiles, addProfiles, setSetting,
  listRules, deleteRules, exportAll, importAll,
} from '../lib/db.js';
import { PREFECTURES } from '../lib/keys.js';
import { decode, recordsFromCSV, toCSV, templateCSV, displayName, DATA_KEYS, toHiragana, normalizePhone, normalizeZip } from '../lib/csv.js';

const $ = (id) => document.getElementById(id);
const form = $('form');
const PAGE = 200;

let people = [];
let currentId = null;
let shown = PAGE;

for (const p of PREFECTURES) $('pref').add(new Option(p, p));

function status(el, text, error = false) {
  el.textContent = text;
  el.classList.toggle('error', error);
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const today = () => new Date().toISOString().slice(0, 10);
const kataToHira = (s) => toHiragana(s || '');

// ---------- 一覧 ----------
function matches(p, q) {
  if (!q) return true;
  const d = p.data;
  const hay = [d.last_name, d.first_name, d.last_kana, d.first_kana, d.phone, d.email, p.memo].join(' ').toLowerCase();
  const hayNoSpace = hay.replace(/[\s-]/g, '');
  return q.split(/\s+/).every((w) => hay.includes(w) || hayNoSpace.includes(w.replace(/-/g, '')) || hay.includes(kataToHira(w)));
}

function filtered() {
  const q = $('search').value.trim().toLowerCase();
  const f = $('filter').value;
  return people.filter((p) => matches(p, q) && (f === 'all' || (f === 'done' ? p.doneAt : !p.doneAt)));
}

function render() {
  const list = filtered();
  const done = people.filter((p) => p.doneAt).length;
  $('count').textContent = people.length ? `${people.length}人（入力済み ${done}・未入力 ${people.length - done}）` : '';
  $('empty').hidden = people.length > 0;
  const tbody = $('rows');
  tbody.replaceChildren();
  for (const p of list.slice(0, shown)) {
    const tr = document.createElement('tr');
    tr.dataset.id = p.id;
    if (p.id === currentId) tr.className = 'selected';
    const d = p.data;
    const cells = [
      `<span class="badge ${p.doneAt ? 'done' : 'todo'}">${p.doneAt ? '入力済み' : '未入力'}</span>`,
      displayName(d), [d.last_kana, d.first_kana].filter(Boolean).join(' '), d.phone,
      [d.pref + d.city + d.street, d.building].filter(Boolean).join(' '),
    ];
    cells.forEach((c, i) => {
      const td = document.createElement('td');
      if (i === 0) td.innerHTML = c; else td.textContent = c || '';
      tr.append(td);
    });
    tr.addEventListener('click', () => openEditor(p.id));
    tbody.append(tr);
  }
  $('more').hidden = list.length <= shown;
  $('more').textContent = `さらに表示（残り${list.length - shown}人）`;
}

async function refresh() {
  people = await listProfiles();
  render();
  renderRules();
}

$('search').addEventListener('input', () => { shown = PAGE; render(); });
$('filter').addEventListener('change', () => { shown = PAGE; render(); });
$('more').addEventListener('click', () => { shown += PAGE; render(); });

// ---------- 編集 ----------
function openEditor(id) {
  currentId = id;
  const p = people.find((x) => x.id === id);
  form.reset();
  for (const k of DATA_KEYS) form[k].value = p?.data?.[k] ?? '';
  form.memo.value = p?.memo ?? '';
  form.done.checked = !!p?.doneAt;
  $('done-at').textContent = p?.doneAt ? `（${p.doneAt}）` : '';
  $('editor-title').textContent = p ? displayName(p.data) : '新しい人を追加';
  $('delete').hidden = !p;
  status($('status'), '');
  $('editor').hidden = false;
  render();
  $('editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('new-person').addEventListener('click', () => openEditor(null));
$('close-editor').addEventListener('click', () => { $('editor').hidden = true; currentId = null; render(); });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {};
  for (const k of DATA_KEYS) data[k] = form[k].value.trim();
  data.last_kana = kataToHira(data.last_kana);
  data.first_kana = kataToHira(data.first_kana);
  data.phone = normalizePhone(data.phone);
  data.zip = normalizeZip(data.zip);
  const old = people.find((x) => x.id === currentId);
  const p = { name: displayName(data), data, memo: form.memo.value.trim(),
    doneAt: form.done.checked ? old?.doneAt || new Date().toLocaleString('ja-JP') : null };
  if (currentId != null) p.id = currentId;
  currentId = await saveProfile(p);
  if (!old) await setSetting('activeProfileId', currentId);
  await refresh();
  openEditor(currentId);
  status($('status'), '保存しました');
});

$('delete').addEventListener('click', async () => {
  const p = people.find((x) => x.id === currentId);
  if (!p || !confirm(`「${displayName(p.data)}」を削除しますか？元に戻せません。`)) return;
  await deleteProfile(currentId);
  currentId = null;
  $('editor').hidden = true;
  await refresh();
});

// ---------- CSV ----------
$('template').addEventListener('click', () => download('名簿ひな形.csv', templateCSV(), 'text/csv'));
$('export-csv').addEventListener('click', () => download(`名簿-${today()}.csv`, toCSV(people), 'text/csv'));
$('import-csv').addEventListener('click', () => $('csv-file').click());
$('csv-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const { records, unknown } = recordsFromCSV(decode(await file.arrayBuffer()));
    if (!records.length) throw new Error('取り込める行がありませんでした');
    const replace = $('replace-on-import').checked;
    if (replace && people.length && !confirm(`今の名簿（${people.length}人）を消して、${records.length}人を取り込みます。よろしいですか？`)) return;
    if (replace) await clearProfiles();
    await addProfiles(records);
    let msg = `${records.length}人を取り込みました。`;
    if (unknown.length) msg += `\n使わなかった列: ${unknown.join('、')}`;
    status($('import-status'), msg);
    await refresh();
  } catch (err) {
    status($('import-status'), `取り込めませんでした: ${err.message}`, true);
  }
});

// ---------- バックアップ ----------
$('export').addEventListener('click', async () => {
  download(`local-autofill-backup-${today()}.json`, JSON.stringify(await exportAll(), null, 2), 'application/json');
});
$('import').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    await importAll(JSON.parse(await file.text()));
    await refresh();
    status($('import-status'), 'バックアップから復元しました');
  } catch (err) {
    status($('import-status'), `復元できませんでした: ${err.message}`, true);
  }
});
$('clear-all').addEventListener('click', async () => {
  if (!people.length || !confirm(`名簿の${people.length}人を全部削除します。元に戻せません。よろしいですか？`)) return;
  await clearProfiles();
  $('editor').hidden = true;
  currentId = null;
  await refresh();
});

async function renderRules() {
  const list = $('rules-list');
  list.replaceChildren();
  const rules = await listRules();
  if (!rules.length) {
    list.innerHTML = '<li class="empty">まだありません</li>';
    return;
  }
  for (const r of rules) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = `${r.host}（${Object.keys(r.rules).length}欄）`;
    const del = document.createElement('button');
    del.textContent = '削除';
    del.className = 'danger';
    del.addEventListener('click', async () => { await deleteRules(r.host); renderRules(); });
    li.append(name, del);
    list.append(li);
  }
}

refresh();
