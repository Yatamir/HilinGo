/**
 * HilinGo v4.4 — no green/teal in the stylesheet, and the new palette on screen.
 *   node tests_colors.mjs
 */
import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const SHOTS = process.env.SHOTS || '/opt/cursor/artifacts';
fs.mkdirSync(SHOTS, { recursive: true });
const problems = [];
const bad = (m) => { problems.push(m); console.log('  FAIL', m); };
const ok = (m) => console.log('  ok  ', m);

function hueOf(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  if (!d) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
function satOf(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max ? (max - min) / max : 0;
}

const cssAll = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').split('<style>')[1].split('</style>')[0];
const sentenceRule = cssAll.match(/#history \.sentword\{[^}]*\}/);
const sentBtnRule = cssAll.match(/#sentStart\{[^}]*\}/);
const rulesSentRule = cssAll.match(/\.rules-sent\{[^}]*\}/);
if (!sentenceRule || !/#128A3E/i.test(sentenceRule[0])) bad('sentence words are not the one allowed green');
else ok('sentence words use the one green exception');
if (!sentBtnRule || !/#128A3E/i.test(sentBtnRule[0]) || !/#fff/i.test(sentBtnRule[0])) bad('sentence button is not green with white text');
else ok('sentence button is the other allowed green');
if (!rulesSentRule || !/#128A3E/i.test(rulesSentRule[0])) bad('rules sentence chip is not green');
else ok('rules sentence chip matches the button');
const css = cssAll
  .replace(/#history \.sentword\{[^}]*\}/g, '')
  .replace(/#sentStart\{[^}]*\}/g, '')
  .replace(/\.rules-sent\{[^}]*\}/g, '');
const hits = [];
for (const m of css.matchAll(/#([0-9A-Fa-f]{6})\b/g)) {
  const h = m[1];
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const hue = hueOf(r, g, b), sat = satOf(r, g, b);
  if (hue >= 80 && hue <= 190 && sat > 0.15) hits.push('#' + h);
}
for (const m of css.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) {
  const r = +m[1], g = +m[2], b = +m[3];
  const hue = hueOf(r, g, b), sat = satOf(r, g, b);
  if (hue >= 80 && hue <= 190 && sat > 0.15) hits.push(`rgb(${r},${g},${b})`);
}
if (hits.length) bad('green/teal ' + [...new Set(hits)].join(', '));
else ok('stylesheet has no green or teal hues');

const p2 = css.match(/--p2:(#[0-9A-Fa-f]{6})/);
const p3 = css.match(/--p3:(#[0-9A-Fa-f]{6})/);
const p4 = css.match(/--p4:(#[0-9A-Fa-f]{6})/);
if (!p2 || p2[1].toLowerCase() !== '#ff2d87') bad('p2 ' + (p2 && p2[1]));
else ok('player 2 is #FF2D87');
if (!p3 || p3[1].toLowerCase() !== '#1e88ff') bad('p3 ' + (p3 && p3[1]));
else ok('player 3 is #1E88FF');
if (!p4 || p4[1].toLowerCase() !== '#ff7a1a') bad('p4 ' + (p4 && p4[1]));
else ok('player 4 is #FF7A1A');

function serve(root) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mp3': 'audio/mpeg', '.png': 'image/png', '.json': 'application/json' };
  const server = http.createServer((req, res) => {
    let p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (p.endsWith('/')) p += 'index.html';
    fs.readFile(p, (err, buf) => {
      if (err) { res.writeHead(404); res.end('no'); return; }
      res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}
const server = await serve(ROOT);
const port = server.address().port;
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => {
    class FakeAudio {
      constructor() { this.preload = ''; this.paused = true; this.currentTime = 0; }
      load() {}
      play() { return Promise.resolve(); }
      pause() {}
      addEventListener() {}
      removeEventListener() {}
    }
    window.Audio = FakeAudio;
    class FakeSR { start() {} stop() {} abort() {} }
    window.SpeechRecognition = FakeSR;
    window.webkitSpeechRecognition = FakeSR;
  });
  await page.goto(`http://127.0.0.1:${port}/index.html?ptt=0`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.getElementById('autoMic').checked = false);
  await page.click('#playersCard .pc[data-n="4"]');
  await page.waitForSelector('#n4:not(.hidden)');
  await page.screenshot({ path: path.join(SHOTS, 'v44b-home.png') });
  await page.click('#go');
  await page.waitForSelector('#half3');
  await page.screenshot({ path: path.join(SHOTS, 'v44b-game-4p.png') });
  await page.evaluate(() => window.__hilingoFinish('empty'));
  await page.waitForSelector('#endov:not(.hidden)');
  await page.screenshot({ path: path.join(SHOTS, 'v44b-win.png') });
  await page.click('#again');
  await page.click('#pcSolo');
  await page.click('#go');
  await page.waitForSelector('#soloClock');
  await page.screenshot({ path: path.join(SHOTS, 'v44b-solo.png') });
  ok('screenshots');
} finally {
  await browser.close();
  server.close();
}
if (problems.length) {
  console.log('\n' + problems.length + ' failure(s)');
  process.exit(1);
}
console.log('\ncolor checks passed');
