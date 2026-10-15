// 紹介・ダウンロードページ用のデータ（docs/site/release.js）を作り、
// 配布セットの zip を公開の置き場所（link リポジトリの GitHub Pages）にコピーする。
//   npm run site -- ../link   … link リポジトリの local-autofill/ に zip を置く
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PAGES_URL = 'https://princetottino10-bit.github.io/link/local-autofill/';
const repo = fileURLToPath(new URL('..', import.meta.url));
const pagesRepo = process.argv[2];

execFileSync('node', [path.join(repo, 'scripts/build-bundle.mjs')], { stdio: 'inherit' });
const { version } = JSON.parse(await fs.readFile(path.join(repo, 'extension/manifest.json'), 'utf8'));
const zip = await fs.readFile(path.join(repo, 'dist', `ローカル入力_v${version}.zip`));
const notes = JSON.parse(await fs.readFile(path.join(repo, 'docs/site/changelog.json'), 'utf8'));
if (notes[0]?.version !== version) throw new Error(`changelog.json の先頭が v${version} になっていません`);

// 公開用のファイル名は半角英数字（URL で文字化けしないように）
const versioned = `local-autofill-v${version}.zip`;
if (pagesRepo) {
  const dir = path.join(path.resolve(pagesRepo), 'local-autofill');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, versioned), zip);
  await fs.writeFile(path.join(dir, 'local-autofill-latest.zip'), zip);
  console.log(`${dir} に ${versioned} と local-autofill-latest.zip を置きました`);
}

const release = {
  version, date: notes[0].date, size: zip.length, notes,
  url: PAGES_URL + versioned, latestUrl: PAGES_URL + 'local-autofill-latest.zip', downloadName: versioned,
};
await fs.writeFile(path.join(repo, 'docs/site/release.js'), `window.RELEASE = ${JSON.stringify(release)};\n`);
console.log(`docs/site/release.js（v${version}, ${Math.round(zip.length / 1024)}KB）`);
