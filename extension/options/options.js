import {
  listProfiles, saveProfile, deleteProfile, getSetting, setSetting,
  listRules, deleteRules, exportAll, importAll,
} from '../lib/db.js';
import { PREFECTURES } from '../lib/keys.js';

const $ = (id) => document.getElementById(id);
const form = $('form');
const DATA_KEYS = ['last_name', 'first_name', 'last_kana', 'first_kana', 'birth', 'gender', 'email', 'phone',
  'zip', 'pref', 'city', 'street', 'building', 'company', 'department'];

let profiles = [];
let currentId = null;
let activeId = null;

for (const p of PREFECTURES) $('pref').add(new Option(p, p));

function status(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
  if (!error) setTimeout(() => { if ($('status').textContent === text) $('status').textContent = ''; }, 3000);
}

async function refresh(selectId = currentId) {
  profiles = await listProfiles();
  activeId = await getSetting('activeProfileId', profiles[0]?.id ?? null);
  if (!profiles.find((p) => p.id === activeId)) activeId = profiles[0]?.id ?? null;
  const list = $('profile-list');
  list.replaceChildren();
  for (const p of profiles) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = p.name || '名称未設定';
    if (p.id === activeId) b.insertAdjacentHTML('beforeend', '<small>使用中</small>');
    b.addEventListener('click', () => load(p.id));
    li.append(b);
    list.append(li);
  }
  load(profiles.find((p) => p.id === selectId) ? selectId : profiles[0]?.id ?? null);
  renderRules();
}

function load(id) {
  currentId = id;
  const p = profiles.find((x) => x.id === id);
  form.reset();
  form.profile_name.value = p ? p.name : profiles.length ? '' : '個人用';
  for (const k of DATA_KEYS) form[k].value = p?.data?.[k] ?? '';
  [...$('profile-list').querySelectorAll('button')].forEach((b, i) => b.classList.toggle('selected', profiles[i]?.id === id));
  $('active-badge').hidden = !p || p.id !== activeId;
  $('delete').disabled = !p;
  $('duplicate').disabled = !p;
  $('use-profile').disabled = !p || p.id === activeId;
}

function readForm() {
  const data = {};
  for (const k of DATA_KEYS) data[k] = form[k].value.trim();
  data.zip = data.zip.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  data.phone = data.phone.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  return { name: form.profile_name.value.trim() || '名称未設定', data };
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const p = readForm();
  if (currentId != null) p.id = currentId;
  const id = await saveProfile(p);
  if (activeId == null) await setSetting('activeProfileId', id);
  await refresh(id);
  status('保存しました');
});

$('new-profile').addEventListener('click', () => {
  load(null);
  form.profile_name.value = '';
  form.profile_name.focus();
});

$('duplicate').addEventListener('click', async () => {
  const p = readForm();
  p.name += '（コピー）';
  const id = await saveProfile(p);
  await refresh(id);
  status('複製しました');
});

$('use-profile').addEventListener('click', async () => {
  await setSetting('activeProfileId', currentId);
  await refresh(currentId);
  status('このプロフィールを使うように設定しました');
});

$('delete').addEventListener('click', async () => {
  const p = profiles.find((x) => x.id === currentId);
  if (!p || !confirm(`「${p.name}」を削除しますか？元に戻せません。`)) return;
  await deleteProfile(currentId);
  if (activeId === currentId) await setSetting('activeProfileId', null);
  await refresh(null);
  status('削除しました');
});

$('export').addEventListener('click', async () => {
  const blob = new Blob([JSON.stringify(await exportAll(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `local-autofill-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('import').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    await importAll(JSON.parse(await file.text()));
    await refresh();
    status('読み込みました');
  } catch (err) {
    status(`読み込めませんでした: ${err.message}`, true);
  }
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
