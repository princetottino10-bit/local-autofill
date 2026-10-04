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

// ---------- 2) CSV 読み込み（Node で直接） ----------
console.log('\n[CSV] 名簿の読み込み');
const csv = await import('../extension/lib/csv.js');
{
  const utf = csv.recordsFromCSV(csv.decode(await fs.readFile(path.join(root, 'test/fixtures/roster-utf8.csv'))));
  const [yamada, suzuki, sato] = utf.records.map((r) => r.data);
  check('人数', utf.records.length, 3);
  check('氏名を姓名に分割', `${yamada.last_name}/${yamada.first_name}`, '山田/太郎');
  check('カタカナのふりがな → ひらがなで保存', yamada.last_kana, 'やまだ');
  check('住所を分割（都道府県）', yamada.pref, '東京都');
  check('住所を分割（市区町村）', yamada.city, '渋谷区');
  check('住所を分割（番地）', yamada.street, '神宮前1-2-3');
  check('住所を分割（建物）', yamada.building, 'テストタウン100号室');
  check('政令市の区', suzuki.city, '札幌市中央区');
  check('先頭の0が消えた携帯番号', yamada.phone, '090-1234-5678');
  check('先頭の0が消えた固定電話', suzuki.phone, '03-1234-5678');
  check('先頭の0が消えた郵便番号', suzuki.zip, '060-0001');
  check('和暦（平成2年4月1日）', suzuki.birth, '1990-04-01');
  check('和暦（S60.12.31）', sato.birth, '1985-12-31');
  check('性別（男）', yamada.gender, 'male');
  check('性別（女性）', suzuki.gender, 'female');
  check('カンマ入りのメモ', utf.records[2].memo, 'メモ,カンマ入り');
  const sj = csv.recordsFromCSV(csv.decode(await fs.readFile(path.join(root, 'test/fixtures/roster-sjis.csv'))));
  check('Shift_JIS の CSV', sj.records[0].data.last_name, '高橋');
  check('Shift_JIS: 姓（フリガナ）列', sj.records[0].data.last_kana, 'たかはし');
  check('使わない列を報告', sj.unknown.join(), '社員番号');
  const round = csv.recordsFromCSV(csv.decode(new TextEncoder().encode(csv.toCSV(utf.records))));
  check('書き出し → 読み込みで元に戻る', JSON.stringify(round.records.map((r) => r.data)), JSON.stringify(utf.records.map((r) => r.data)));
}

// ---------- 3) 拡張機能として通し動作 ----------
console.log('\n[拡張機能] 読み込み → CSV取り込み → ポップアップで選んで入力 → 入力済みにして次へ');
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

// インストール直後に名簿ページが自動で開く
let options;
for (let i = 0; i < 50 && !options; i++) {
  options = ctx.pages().find((p) => p.url().includes('options.html'));
  if (!options) await new Promise((r) => setTimeout(r, 200));
}
if (!options) throw new Error('設定ページが開きませんでした');
await options.waitForLoadState();
check('インストール時に名簿ページが開く', options.url(), `chrome-extension://${extId}/options/options.html`);
await options.setViewportSize({ width: 1000, height: 900 });
await options.setInputFiles('#csv-file', path.join(root, 'test/fixtures/roster-utf8.csv'));
await options.waitForSelector('#import-status:has-text("取り込みました")');
await options.setInputFiles('#csv-file', path.join(root, 'test/fixtures/roster-sjis.csv'));
await options.waitForFunction(() => document.querySelector('#count').textContent.startsWith('4人'));
check('CSVを2つ取り込んで4人', await options.textContent('#count'), '4人（入力済み 0・未入力 4）');
await options.screenshot({ path: path.join(shots, 'options.png') });

// 1人を開いて編集できる
await options.click('#rows tr:nth-child(2)');
await options.waitForSelector('#editor:not([hidden])');
check('編集画面に読み込まれる', await options.inputValue('[name=city]'), '札幌市中央区');

const form = await ctx.newPage();
await form.goto(base + 'furusato.html');
const popup = await ctx.newPage();
await popup.setViewportSize({ width: 360, height: 700 });
await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
await form.bringToFront(); // ポップアップから見た「今のタブ」をフォームにする
await popup.reload();
await popup.waitForSelector('#main:not([hidden])');
check('ポップアップにホスト名が出る', await popup.textContent('#host'), '127.0.0.1');
check('最初は先頭の未入力の人', await popup.textContent('#current-name'), '山田 太郎');
await popup.click('#fill');
await popup.waitForSelector('#result:not([hidden])');
check('結果表示', await popup.textContent('#result'), '山田 太郎さんの情報を11個の欄に入力しました。');
const got = await values(form);
for (const [k, v] of Object.entries(EXPECT['furusato.html'])) check(`通し: ${k}`, got[k], v);

// 割り当て確認: 「ご希望の物件名」を建物名として保存 → 入力し直し
await popup.click('#review');
await popup.waitForSelector('#field-list select');
await popup.selectOption('select[data-sig="n:prop@0"]', 'building');
await popup.click('#save-rules');
await popup.waitForFunction(() => document.querySelector('#result').textContent.includes('12個'));
check('サイト別の割り当てが効く', (await values(form)).prop, 'テストタウン100号室');
await popup.click('#review');

// 入力済みにして次の人へ
await popup.click('#done-next');
await popup.waitForFunction(() => document.querySelector('#current-name').textContent === '鈴木 花子');
check('次の人に進む', await popup.textContent('#current-name'), '鈴木 花子');
check('進捗表示', await popup.textContent('#progress'), '4人中 1人入力済み・残り3人');
await popup.screenshot({ path: path.join(shots, 'popup.png'), fullPage: true });

// 検索して選ぶ → 表形式のフォームに入力
await form.goto(base + 'table.html');
await popup.fill('#search', 'たかはし');
check('ふりがなで検索', await popup.locator('#people li').count(), 1);
await popup.press('#search', 'Enter');
await popup.waitForFunction(() => document.querySelector('#current-name').textContent === '高橋 一郎');
await popup.click('#fill');
await popup.waitForFunction(() => document.querySelector('#result').textContent.includes('高橋'));
const t = await values(form);
check('通し(表): 姓', t.f01, '高橋');
check('通し(表): セイ', t.f03, 'タカハシ');
check('通し(表): 電話3分割', `${t.f09}-${t.f10}-${t.f11}`, '090-9876-5432');
check('通し(表): 郵便番号', t.f14, '100-0001');
check('通し(表): 住所（建物なし）', t.f15, '東京都千代田区千代田１－１');
await popup.fill('#search', '0312345678');
check('電話番号（ハイフンなし）で検索', await popup.locator('#people li').count(), 1);

// 拡張のページからは外部通信できない（CSP connect-src 'none'）
const net = await popup.evaluate((u) => fetch(u).then(() => 'sent', () => 'blocked'), base + 'furusato.html');
check('拡張のページから通信できない', net, 'blocked');

// CSV 書き出し → 上書き取り込みで入力済みが残る
await options.bringToFront();
await options.reload();
const [csvDl] = await Promise.all([options.waitForEvent('download'), options.click('#export-csv')]);
const csvBuf = await fs.readFile(await csvDl.path());
check('CSVはBOM付きUTF-8', csvBuf.subarray(0, 3).toString('hex'), 'efbbbf');
check('CSVに入力済みの記録', /^"?\d/.test(csvBuf.toString('utf8').split('\r\n')[1]), true);
await options.check('#replace-on-import');
options.once('dialog', (d) => d.accept());
await options.setInputFiles('#csv-file', await csvDl.path());
await options.waitForSelector('#import-status:has-text("4人を取り込みました")');
check('上書き取り込み後も4人・入力済み1人', await options.textContent('#count'), '4人（入力済み 1・未入力 3）');

// バックアップ
const [download] = await Promise.all([options.waitForEvent('download'), options.click('#export')]);
const exported = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
check('バックアップに名簿が含まれる', exported.profiles.length, 4);
check('バックアップにサイト別割り当てが含まれる', exported.siteRules[0].rules['n:prop@0'], 'building');

await ctx.close();
server.close();
console.log(failures ? `\n${failures}件失敗` : '\nすべて成功');
process.exit(failures ? 1 : 0);
