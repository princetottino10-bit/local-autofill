// 友達に送る配布セット（拡張機能フォルダ＋手順書HTML＋名簿ひな形CSV）を dist/ に作る
import { marked } from 'marked';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const repo = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const outDir = path.join(repo, 'dist');
const version = JSON.parse(await fs.readFile(`${repo}/extension/manifest.json`, 'utf8')).version;
const top = path.join(outDir, `local-autofill-v${version}`);
await fs.rm(top, { recursive: true, force: true });
await fs.mkdir(top, { recursive: true });
await fs.cp(`${repo}/extension`, path.join(top, 'local-autofill-extension'), { recursive: true });
const csv = await import(`${repo}/extension/lib/csv.js`);
await fs.writeFile(path.join(top, '名簿ひな形.csv'), csv.templateCSV());

let md = await fs.readFile(`${repo}/docs/INSTALL_mac.md`, 'utf8');
md = md.replace(/## 1\. ファイルを置く[\s\S]*?(?=## 2\.)/, `## 1. ファイルを置く

1. 受け取ったファイル（\`ローカル入力_v${version}.zip\`）をダブルクリックして展開します。
2. できた「local-autofill-v${version}」フォルダの中に、次の3つが入っています。
   - \`local-autofill-extension\` … 拡張機能の本体（このフォルダを Chrome に読み込みます）
   - \`はじめにお読みください.html\` … この手順書
   - \`名簿ひな形.csv\` … 名簿の見本
3. 「local-autofill-v${version}」フォルダごと、「書類」など消さない場所に移動します。
   - **このフォルダを削除すると拡張機能が動かなくなります。**ダウンロードフォルダに置いたままにしないでください。
   - **読み込んだ後は、フォルダの場所を変えないでください。**別の場所に移して読み込み直すと Chrome からは別の拡張機能として扱われ、名簿が空に見えます（元の場所に戻すと見えます）。移したいときは、先に名簿画面の「バックアップを書き出す」で保存してから移し、移した先で「バックアップから復元」してください。

`);
md = md.replace('4. 手順1で移動したフォルダ（`manifest.json` が入っているフォルダ）を選んで「選択」を押します。',
  '4. 手順1で移動したフォルダの中の **`local-autofill-extension`** フォルダを選んで「選択」を押します。');
md = md.replace(/1\. 名簿画面の \*\*「ひな形CSVをダウンロード」\*\* で見本を保存し、Numbers か Excel で開きます。/,
  '1. 同じフォルダの **`名簿ひな形.csv`** を Numbers か Excel で開きます（名簿画面の「ひな形CSVをダウンロード」でも同じものが手に入ります）。');
md = md.replace(/古いフォルダの中身を新しい zip の中身に入れ替えて/, '古い `local-autofill-extension` フォルダの中身を、新しいものの中身に入れ替えて');
if (!md.includes('local-autofill-extension`** フォルダを選んで')) throw new Error('手順書の置き換えに失敗');

// 「。**」の直後に文字が続くと太字にならないので、先にタグへ置き換える
md = md.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ローカル入力 はじめにお読みください</title><style>
:root{--bg:#f6f8f6;--fg:#17201c;--muted:#5b6964;--rule:#d7dfda;--accent:#1f7a5a;--soft:#e3f1ea;--code:#eef2ef}
@media (prefers-color-scheme:dark){:root{--bg:#131a17;--fg:#e5ece8;--muted:#9fb1a8;--rule:#2d3934;--accent:#4cc394;--soft:#1c3229;--code:#1d2723}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.85 -apple-system,BlinkMacSystemFont,"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif;padding:32px 20px 64px}
main{max-width:720px;margin:0 auto}h1{font-size:26px;line-height:1.4;margin:0 0 8px}h2{font-size:20px;margin:40px 0 10px;padding-top:20px;border-top:1px solid var(--rule)}
h1+p{color:var(--muted)}li{margin:6px 0}code{background:var(--code);border-radius:4px;padding:1px 6px;font-size:.92em}
blockquote{margin:16px 0;padding:10px 16px;background:var(--soft);border-radius:8px}blockquote p{margin:0}strong{color:var(--accent)}
</style></head><body><main>${marked.parse(md)}</main></body></html>`;
await fs.writeFile(path.join(top, 'はじめにお読みください.html'), html);
console.log(top);
// zip にまとめる（Mac の「アーカイブユーティリティ」で日本語のファイル名が化けないよう UTF-8 で記録）
const zipName = `ローカル入力_v${version}.zip`;
await fs.rm(path.join(outDir, zipName), { force: true });
const py = `import os, sys, zipfile
top, name = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(name, 'w', zipfile.ZIP_DEFLATED) as z:
    for d, _, files in os.walk(top):
        for f in sorted(files):
            if not f.startswith('.'):
                z.write(os.path.join(d, f))`;
execFileSync('python3', ['-I', '-c', py, path.basename(top), zipName], { cwd: outDir });
console.log(path.join(outDir, zipName));
