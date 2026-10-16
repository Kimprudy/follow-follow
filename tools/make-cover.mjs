// Renders tools/cover.html in headless Chrome and saves cover.png (1600×1000).
//   node tools/make-cover.mjs [path to Chrome]
// Needs Google Chrome (or Chromium) and Node 22+.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const chromePath = process.argv[2] || {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
}[process.platform] || 'google-chrome';
const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(chromePath, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cover-'))}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50 && !targets; i++) {
  try {
    targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  } catch {
    await sleep(200);
  }
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const waiting = new Map();
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  waiting.get(msg.id)?.(msg.result);
});
const send = (method, params = {}) => new Promise((r) => {
  waiting.set(++id, r);
  ws.send(JSON.stringify({ id, method, params }));
});

await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: pathToFileURL(join(here, 'cover.html')).href });
for (let i = 0; i < 60; i++) {
  const r = await send('Runtime.evaluate', { expression: 'document.body?.dataset.ready === "1"', returnByValue: true });
  if (r.result.value) break;
  await sleep(250);
}
await sleep(500);
const shot = await send('Page.captureScreenshot', { format: 'png' });
const out = join(here, '..', 'cover.png');
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log(`wrote ${out}`);
ws.close();
chrome.kill();
