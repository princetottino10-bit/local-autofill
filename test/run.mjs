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
  // 2回目は同じ値なので何も書き換えない／元に戻すで空に戻る
  const second = await page.evaluate((d) => window.__localAutofill.fill(d, {}, {}), PROFILE);
  check('同じ人を2回入力しても書き換えない', second.fields.filter((f) => f.status === 'filled' && !f.same).length, 0);
  check('同じ人を2回入力しても値は同じ', JSON.stringify(await values(page)), JSON.stringify(got));
  await page.evaluate(() => window.__localAutofill.undo());
  const afterUndo = await values(page);
  const firstKey = Object.keys(expected)[0];
  check('元に戻すで空欄に戻る', afterUndo[firstKey], '');
  await page.close();
}
// ---------- 問題が起きやすいフォーム ----------
console.log('\n[単体] tricky.html（関係ないフォーム・見えない欄・初期値・性別・前の人の残り）');
{
  const SUZUKI = { ...PROFILE, last_name: '鈴木', first_name: '花子', gender: 'female', zip: '060-0001', pref: '北海道', email: 'hanako@example.com' };
  const page = await browser.newPage();
  await page.goto(base + 'tricky.html');
  await page.addScriptTag({ path: path.join(root, 'extension/content/filler.js') });
  const r = await page.evaluate((d) => window.__localAutofill.fill(d, {}, {}), SUZUKI);
  const v = await values(page);
  check('ヘッダーのログイン欄には入れない', v.login_mail, '');
  check('フッターのメルマガ欄には入れない', v.news_mail, '');
  check('透明な欄には入れない', v.trap_tel, '');
  check('画面外の欄には入れない', v.trap_addr, '');
  check('1pxの欄には入れない', v.trap_tiny, '');
  check('初期値「東京都」の選択欄を北海道に直す', v.pref, '北海道');
  check('初期値「男性」のラジオを女性に直す', v.g, 'f');
  check('見出しなし・本体が透明な性別ラジオも選ぶ', v.sx, '2');
  check('選択肢が合わない欄を報告する', r.fields.find((f) => f.sig === 'n:by@0')?.status, 'no-match');
  check('自動生成のidを目印に使わない', r.fields.some((f) => f.sig.includes(':r1:')), false);
  check('自動生成idの欄も入力はする', v[':r1:'], '鈴木');
  // 前の人（鈴木）の値が残ったまま次の人（高橋）を入力する
  await page.reload();
  await page.addScriptTag({ path: path.join(root, 'extension/content/filler.js') });
  await page.evaluate((d) => window.__localAutofill.fill(d, {}, {}), SUZUKI);
  await page.reload(); // フォームの値はブラウザが復元しないので、残った状態を手で再現
  await page.addScriptTag({ path: path.join(root, 'extension/content/filler.js') });
  await page.evaluate(() => { document.querySelector('[name=nm]').value = '鈴木 花子'; document.querySelector('[name=z]').value = '0600001'; document.querySelector('[name=pref]').value = '北海道'; });
  const TAKAHASHI = { ...PROFILE, last_name: '高橋', first_name: '一郎', zip: '100-0001', pref: '東京都', gender: 'male' };
  const r2 = await page.evaluate(([d, prev]) => window.__localAutofill.fill(d, {}, { prevData: prev }), [TAKAHASHI, SUZUKI]);
  const v2 = await values(page);
  check('前の人の名前を書き換える', v2.nm, '高橋 一郎');
  check('前の人の郵便番号を書き換える', v2.z, '1000001');
  check('前の人の都道府県を書き換える', v2.pref, '東京都');
  check('書き換えた欄を報告する', r2.fields.filter((f) => f.replaced).length, 3);
  // 本人が手で入れた別の値は残す
  await page.evaluate(() => { document.querySelector('[name=nm]').value = '手入力 さん'; });
  const r3 = await page.evaluate(([d, prev]) => window.__localAutofill.fill(d, {}, { prevData: prev }), [TAKAHASHI, SUZUKI]);
  check('手で入れた値は上書きしない', (await values(page)).nm, '手入力 さん');
  check('上書きしなかった欄を報告する', r3.fields.find((f) => f.sig === 'n:nm@0')?.status, 'kept');
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
  const w = csv.recordsFromCSV('氏名,電話番号,携帯電話,生年月日,住所\n山田太郎,,09012345678,1/7/1989,どこか1-1\n鈴木 花子,0311112222,09000000000,1990/4/1,東京都渋谷区1\n');
  check('スペースなしの氏名を警告', w.warnings.noSpaceName.join(), '山田太郎');
  check('読めない生年月日を警告', w.warnings.badBirth.length, 1);
  check('分けられない住所を警告', w.warnings.badAddress.join(), 'どこか1-1');
  check('電話番号の列が2つ: 左が空なら右を使う', w.records[0].data.phone, '090-1234-5678');
  check('電話番号の列が2つ: 左を優先', w.records[1].data.phone, '03-1111-2222');
  check('列の重複を説明', w.duplicated.length, 1);
  const u16 = csv.decode(Buffer.from('\ufeff氏名\n山田 太郎\n', 'utf16le'));
  check('UTF-16 の CSV', csv.recordsFromCSV(u16 + '\n').records[0]?.data.last_name, '山田');
  const cities = { '三重県四日市市安島1-1': '四日市市', '新潟県十日町市本町1': '十日町市', '東京都東村山市本町1-2': '東村山市',
    '奈良県大和郡山市北郡山町248': '大和郡山市', '東京都千代田区市ケ谷1': '千代田区', '東京都西多摩郡瑞穂町箱根ケ崎2335': '西多摩郡瑞穂町',
    '千葉県市川市八幡1-1': '市川市', '茨城県かすみがうら市上土田461': 'かすみがうら市' };
  for (const [addr, city] of Object.entries(cities)) check(`住所の分割: ${city}`, csv.splitAddress(addr).city, city);
  check('同じ人の目印は同じ人で一致', csv.personKey(utf.records[0]), csv.personKey(JSON.parse(JSON.stringify(utf.records[0]))));
  check('同じ人の目印は別の人で異なる', csv.personKey(utf.records[0]) === csv.personKey(utf.records[1]), false);
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
await options.setInputFiles('#csv-file', path.join(root, 'test/fixtures/roster-utf8.csv'));
await options.waitForSelector('#import-status:has-text("すでに名簿にいる3人")');
check('同じCSVをもう一度取り込んでも増えない', await options.textContent('#count'), '4人（入力済み 0・未入力 4）');
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
// まだ入力していない人で「入力済みにして次へ」を押すと、まず確認が出る
await popup.click('#done-next');
const confirmShown = await popup.waitForFunction(() => document.querySelector('#result').textContent.includes('もう一度押してください'), null, { timeout: 3000 }).then(() => true, () => false);
check('未入力の人は確認が出る', confirmShown, true);
check('確認の時点では進まない', await popup.textContent('#current-name'), '鈴木 花子');
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
