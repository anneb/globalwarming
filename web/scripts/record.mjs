// Render the film camera path frame-by-frame and encode to mp4.
// Usage: npm run record -- --seconds 70 --fps 30 --w 1920 --h 1080 --from 0 --out ../video/blok.mp4
import { chromium } from 'playwright';
import { createServer } from 'vite';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const seconds = Number(arg('seconds', 12));
const fps = Number(arg('fps', 30));
const w = Number(arg('w', 1280));
const h = Number(arg('h', 720));
const from = Number(arg('from', 0));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(root, arg('out', '../video/blok-proef.mp4'));

fs.mkdirSync(path.dirname(out), { recursive: true });
const server = await createServer({ root, logLevel: 'error', server: { port: 5199, hmr: false, watch: null } });
await server.listen();
const url = `${server.resolvedUrls.local[0]}?record=1&w=${w}&h=${h}&fps=${fps}`;

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });
page.on('pageerror', (e) => console.error('[page error]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });

page.on("framenavigated", (f) => { if (f === page.mainFrame() && started) { console.error("pagina herladen tijdens opname — afgebroken"); process.exit(1); } });
let started = false;
if (from > 0) await page.evaluate((n) => window.__skip(n), Math.round(from * fps));

const ff = spawn(ffmpegPath, [
  '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', out,
], { stdio: ['pipe', 'inherit', 'inherit'] });

started = true;
const total = Math.round(seconds * fps);
const t0 = Date.now();
for (let i = 0; i < total; i++) {
  await page.evaluate(() => window.__frame());
  const buf = await page.screenshot({ type: 'png' });
  if (!ff.stdin.write(buf)) await once(ff.stdin, 'drain');
  if (i % fps === 0) {
    const s = (Date.now() - t0) / 1000;
    process.stdout.write(`frame ${i}/${total}  ${s.toFixed(0)}s elapsed\n`);
  }
}
ff.stdin.end();
await once(ff, 'close');
await browser.close();
await server.close();
console.log(`klaar: ${out}`);
