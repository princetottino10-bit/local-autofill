// テスト: 1) 判定ロジック単体（3種類のフォーム） 2) 拡張機能として読み込んだ状態での通し動作
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const shots = path.join(root, 'test/screenshots');
await fs.mkdir(shots, { recursive: true });

const PROFILE = {
  last_name: '山田', first_name: '太郎', last_kana: 'やまだ', first_kana: 'たろう',
  birth: '1989-01-07', gender: 'male', email: 'taro@example.com', phone: '090-1234-5678',
  zip: '150-0001', pref: '東京都', city: '渋谷区', street: '神宮前1-2-3', building: 'テストタウン100号室',
  company: '', department: '',
};

// ---------- ローカルHTTPサーバー ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer(async (req, res) => {
  try {
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(root)) throw new Error('forbidden');
    const body = await fs.readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/test/pages/`;

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok ? '' : `  期待: ${JSON.stringify(expected)}  実際: ${JSON.stringify(actual)}`}`);
}

const values = (page) => page.evaluate(() => {
  const out = {};
  for (const el of document.querySelectorAll('input, select, textarea')) {
    const k = el.name || el.id;
    if (el.type === 'radio') { if (el.checked) out[k] = el.value; else out[k] ??= ''; }
    else out[k] = el.tagName === 'SELECT' ? el.options[el.selectedIndex]?.text ?? '' : el.value;
  }
  return out;
});

const EXPECT = {
  'furusato.html': {
    your_name: '山田 太郎', your_kana: 'やまだ たろう', birth_y: '1989年 昭和64年／平成元年', p1: '150', p2: '0001',
    pr: '東京都', c: '渋谷区', s: '神宮前1-2-3', b: 'テストタウン100号室', m: 'taro@example.com',
    t: '090-1234-5678', prop: '', msg: '', hp_email: '',
  },
  'table.html': {
    f01: '山田', f02: '太郎', f03: 'ヤマダ', f04: 'タロウ', f05: '1989', f06: '1', f07: '7', f08: '1',
    f09: '090', f10: '1234', f11: '5678', f12: 'taro@example.com', f13: 'taro@example.com', f14: '150-0001',
    f15: '東京都渋谷区神宮前１－２－３　テストタウン１００号室', f16: '', f17: '',
  },
  'react.html': {
    lastName: '山田', firstName: '太郎', lastKana: 'ヤマダ', firstKana: 'タロウ', email: 'taro@example.com',
    zip: '1500001', address1: '渋谷区神宮前1-2-3', address2: 'テストタウン100号室', birthday: '1989-01-07', pref: '東京',
  },
};

// ---------- 1) 判定ロジック単体 ----------
const browser = await chromium.launch();
for (const [file, expected] of Object.entries(EXPECT)) {
  console.log(`\n[単体] ${file}`);
  const page = await browser.newPage();
  await page.goto(base + file);
  await page.addScriptTag({ path: path.join(root, 'extension/content/filler.js') });
  await page.evaluate((d) => window.__localAutofill.fill(d, {}, {}), PROFILE);
  const got = await values(page);
  for (const [k, v] of Object.entries(expected)) check(k, got[k], v);
  if (file === 'react.html') {
    const state = JSON.parse(await page.textContent('#state'));
    check('Reactの状態に反映（姓）', state.lastName, '山田');
    check('Reactの状態に反映（都道府県）', state.pref, '13');
    check('Reactの状態に反映（生年月日）', state.birthday, '1989-01-07');
  }
  // 2回目は入力済みなので何も変えない／元に戻すで空に戻る
  const second = await page.evaluate((d) => window.__localAutofill.fill(d, {}, {}), PROFILE);
  check('2回目は入力済みの欄を上書きしない', second.fields.filter((f) => f.status === 'filled').length, 0);
  await page.evaluate(() => window.__localAutofill.undo());
  const afterUndo = await values(page);
  const firstKey = Object.keys(expected)[0];
  check('元に戻すで空欄に戻る', afterUndo[firstKey], '');
  await page.close();
}
await browser.close();

// ---------- 2) 拡張機能として通し動作 ----------
console.log('\n[拡張機能] 読み込み → プロフィール登録 → ポップアップから入力 → サイト別の割り当て保存');
// テスト時だけ host_permissions を足したコピーを使う（本番は activeTab のみ）
const extDir = await fs.mkdtemp(path.join(os.tmpdir(), 'la-ext-'));
await fs.cp(path.join(root, 'extension'), extDir, { recursive: true });
const manifest = JSON.parse(await fs.readFile(path.join(extDir, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['http://127.0.0.1/*'];
await fs.writeFile(path.join(extDir, 'manifest.json'), JSON.stringify(manifest));

const userDir = await fs.mkdtemp(path.join(os.tmpdir(), 'la-user-'));
const ctx = await chromium.launchPersistentContext(userDir, {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  locale: 'ja-JP',
});
let [sw] = ctx.serviceWorkers();
sw ??= await ctx.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;

// インストール直後に設定ページが自動で開く
let options;
for (let i = 0; i < 50 && !options; i++) {
  options = ctx.pages().find((p) => p.url().includes('options.html'));
  if (!options) await new Promise((r) => setTimeout(r, 200));
}
if (!options) throw new Error('設定ページが開きませんでした');
await options.waitForLoadState();
check('インストール時に設定ページが開く', options.url(), `chrome-extension://${extId}/options/options.html`);
await options.setViewportSize({ width: 1000, height: 1250 });
await options.fill('[name=profile_name]', '個人用');
for (const k of ['last_name', 'first_name', 'last_kana', 'first_kana', 'email', 'phone', 'zip', 'city', 'street', 'building']) {
  await options.fill(`[name=${k}]`, PROFILE[k]);
}
await options.fill('[name=birth]', PROFILE.birth);
await options.selectOption('[name=gender]', 'male');
await options.selectOption('[name=pref]', '東京都');
await options.click('button[type=submit]');
await options.waitForSelector('#status:has-text("保存しました")');
await options.screenshot({ path: path.join(shots, 'options.png') });

const form = await ctx.newPage();
await form.goto(base + 'furusato.html');
const popup = await ctx.newPage();
await popup.setViewportSize({ width: 360, height: 600 });
await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
await form.bringToFront(); // ポップアップから見た「今のタブ」をフォームにする
await popup.reload();
await popup.waitForSelector('#main:not([hidden])');
check('ポップアップにホスト名が出る', await popup.textContent('#host'), '127.0.0.1');
await popup.click('#fill');
await popup.waitForSelector('#result:not([hidden])');
check('結果表示', await popup.textContent('#result'), '11個の欄に入力しました。');
const got = await values(form);
for (const [k, v] of Object.entries(EXPECT['furusato.html'])) check(`通し: ${k}`, got[k], v);

// 割り当て確認: 「ご希望の物件名」を建物名として保存 → 入力し直し
await popup.click('#review');
await popup.waitForSelector('#field-list select');
await popup.screenshot({ path: path.join(shots, 'popup.png'), fullPage: true });
await popup.selectOption('select[data-sig="n:prop@0"]', 'building');
await popup.click('#save-rules');
await popup.waitForFunction(() => document.querySelector('#result').textContent.includes('12個'));
check('サイト別の割り当てが効く', (await values(form)).prop, 'テストタウン100号室');

// 別タブでリロードしても割り当てが残る
await form.reload();
await popup.evaluate(() => { document.querySelector('#result').textContent = ''; });
await popup.click('#fill');
await popup.waitForFunction(() => document.querySelector('#result').textContent.includes('12個'));
check('割り当てが保存されている', (await values(form)).prop, 'テストタウン100号室');

// 拡張のページからは外部通信できない（CSP connect-src 'none'）
const net = await popup.evaluate((u) => fetch(u).then(() => 'sent', () => 'blocked'), base + 'furusato.html');
check('拡張のページから通信できない', net, 'blocked');

// 書き出しファイル
await options.bringToFront();
await options.reload();
const [download] = await Promise.all([options.waitForEvent('download'), options.click('#export')]);
const exported = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
check('書き出しにプロフィールが含まれる', exported.profiles[0].data.last_name, '山田');
check('書き出しにサイト別割り当てが含まれる', exported.siteRules[0].rules['n:prop@0'], 'building');

await ctx.close();
server.close();
console.log(failures ? `\n${failures}件失敗` : '\nすべて成功');
process.exit(failures ? 1 : 0);
