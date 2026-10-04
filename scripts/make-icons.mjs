// アイコンPNGを SVG から生成する（Playwright の Chromium を利用）
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const out = fileURLToPath(new URL('../extension/icons/', import.meta.url));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect x="4" y="4" width="120" height="120" rx="28" fill="#1f7a5a"/>
  <rect x="26" y="34" width="76" height="16" rx="5" fill="#fff" opacity=".95"/>
  <rect x="26" y="58" width="76" height="16" rx="5" fill="#fff" opacity=".95"/>
  <rect x="26" y="82" width="44" height="16" rx="5" fill="#fff" opacity=".95"/>
  <path d="M80 90 l9 9 l17 -20" fill="none" stroke="#ffd166" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style><img src="data:image/svg+xml,${encodeURIComponent(svg)}" width="${size}" height="${size}">`);
  await page.screenshot({ path: `${out}icon${size}.png`, omitBackground: true });
}
await browser.close();
