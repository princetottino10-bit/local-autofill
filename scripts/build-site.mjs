// 紹介・ダウンロードページ用に、配布セットの zip と更新履歴を docs/site/release.js に書き出す
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
execFileSync('node', [path.join(repo, 'scripts/build-bundle.mjs')], { stdio: 'inherit' });
const { version } = JSON.parse(await fs.readFile(path.join(repo, 'extension/manifest.json'), 'utf8'));
const filename = `ローカル入力_v${version}.zip`;
const zip = await fs.readFile(path.join(repo, 'dist', filename));
const notes = JSON.parse(await fs.readFile(path.join(repo, 'docs/site/changelog.json'), 'utf8'));
if (notes[0]?.version !== version) throw new Error(`changelog.json の先頭が v${version} になっていません`);
const release = { version, date: notes[0].date, filename, size: zip.length, b64: zip.toString('base64'), notes };
await fs.writeFile(path.join(repo, 'docs/site/release.js'), `window.RELEASE = ${JSON.stringify(release)};\n`);
console.log(`docs/site/release.js（v${version}, ${Math.round(zip.length / 1024)}KB）`);
