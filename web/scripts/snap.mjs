// Capture PNG stills of the film at given times (s): node scripts/snap.mjs outdir 0 8 14 ...
import { chromium } from 'playwright';
import { createServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const [outDir, ...times] = process.argv.slice(2);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.mkdirSync(outDir, { recursive: true });
const server = await createServer({ root, logLevel: 'error', server: { port: 5198 } });
await server.listen();
const fps = 10, w = Number(process.env.SNAP_W) || 1280, h = Number(process.env.SNAP_H) || 720;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.error('[page]', m.text()); });
page.on('pageerror', (e) => console.error('[page error]', e.message));
await page.goto(`${server.resolvedUrls.local[0]}?record=1&w=${w}&h=${h}&fps=${fps}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
let cur = 0;
for (const t of times.map(Number)) {
  const n = Math.round(t * fps) - cur;
  if (n > 1) await page.evaluate((k) => window.__skip(k), n - 1);
  await page.evaluate(() => window.__frame());
  cur += Math.max(n, 1);
  await page.screenshot({ path: path.join(outDir, `t${String(t).padStart(3, '0')}.png`) });
  console.log('shot', t);
}
await browser.close(); await server.close();
