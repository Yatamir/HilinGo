/**
 * HilinGo v4.3 — fixed boards, solo clock placement, records, auto-mic.
 *   node tests_v43.mjs
 */
import { chromium, webkit } from 'playwright-core';
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

function serve(root) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.mp3': 'audio/mpeg', '.json': 'application/json' };
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

async function boxes(page) {
  return page.evaluate(() => [...document.querySelectorAll('#halves .half')].map(el => {
    const r = el.getBoundingClientRect();
    return { id: el.id, top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width), active: el.classList.contains('active') };
  }));
}
function sameFrame(a, b) {
  if (a.length !== b.length || !a.length) return false;
  const dy = b[0].top - a[0].top;
  return a.every((x, i) => Math.abs((b[i].top - x.top) - dy) <= 1 && Math.abs(x.h - b[i].h) <= 1 && Math.abs(x.w - b[i].w) <= 1 && x.active === b[i].active);
}

async function run(browser, tag, shot) {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    class FakeAudio {
      constructor() { this.preload = ''; this.paused = true; this.currentTime = 0; }
      load() {}
      play() { this.paused = false; return Promise.resolve(); }
      pause() { this.paused = true; }
      addEventListener() {}
      removeEventListener() {}
    }
    window.Audio = FakeAudio;
    class FakeSR { start() {} stop() {} abort() {} }
    window.SpeechRecognition = FakeSR;
    window.webkitSpeechRecognition = FakeSR;
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:${port}/index.html?ptt=0`, { waitUntil: 'domcontentloaded' });
  const auto = await page.evaluate(() => document.getElementById('autoMic').checked);
  if (auto) bad(tag + ' tap is not the default');
  else ok(tag + ' tap is the default');
  const one = (await page.locator('#pcSolo').innerText()).trim();
  if (one !== '1') bad(tag + ' button ' + one);
  else ok(tag + ' player button is 1');
  if (shot) await page.screenshot({ path: path.join(SHOTS, 'v43-home-1.png') });

  await page.evaluate(() => { document.getElementById('autoMic').checked = false; });
  await page.click('#go');
  await page.waitForSelector('#half1');
  const before = await boxes(page);
  if (!before[0].active || before[1].active) bad(tag + ' initial active ' + JSON.stringify(before));
  await page.fill('#in0', 'אבא');
  await page.click('#send0');
  await page.waitForFunction(() => document.querySelector('#halves .half.active') && document.querySelector('#halves .half.active').id === 'half1');
  const after = await boxes(page);
  if (!sameFrame(before, after)) bad(tag + ' boxes moved\n' + JSON.stringify(before) + '\n' + JSON.stringify(after));
  else ok(tag + ' card frames stay put across the turn');
  if (after[0].id !== 'half1' || after[1].id !== 'half0') bad(tag + ' order ' + after.map(x => x.id).join(','));
  else ok(tag + ' active card stays the top slot');

  await page.click('#endBtn');
  await page.click('#endClose');
  await page.click('#pcSolo');
  await page.click('#go');
  await page.waitForSelector('#soloTime');
  const turn1 = await boxes(page);
  if (shot) await page.screenshot({ path: path.join(SHOTS, 'v43-turn1.png') });
  await page.fill('#in0', 'אבא');
  await page.click('#send0');
  await page.waitForFunction(() => document.querySelector('#halves .half.active').id === 'half1');
  const turn2 = await boxes(page);
  if (!sameFrame(turn1, turn2)) bad(tag + ' solo frames\n' + JSON.stringify(turn1) + '\n' + JSON.stringify(turn2));
  else ok(tag + ' solo frames stay put');
  if (shot) await page.screenshot({ path: path.join(SHOTS, 'v43-turn2.png') });

  for (const [w, h] of [[375, 667], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(100);
    const fit = await page.evaluate(() => {
      const cards = document.getElementById('halves').getBoundingClientRect();
      const timer = document.getElementById('soloTimer').getBoundingClientRect();
      const overlap = !(timer.bottom <= cards.top + 1 || timer.top >= cards.bottom - 1);
      return { overlap, timerTop: Math.round(timer.top), cardsBottom: Math.round(cards.bottom), hidden: document.getElementById('soloTimer').classList.contains('hidden') };
    });
    if (fit.hidden || fit.overlap || fit.timerTop < fit.cardsBottom - 2) bad(tag + ' overlap ' + w + ' ' + JSON.stringify(fit));
    else ok(tag + ' timer is below the keyboards at ' + w + 'x' + h);
  }

  await page.click('#endBtn');
  const manual = await page.evaluate(() => localStorage.getItem('hilingo_solo_best2_he'));
  if (manual != null) bad(tag + ' end game saved ' + manual);
  else ok(tag + ' end game does not save');
  await page.click('#again');
  await page.waitForSelector('#soloTime');
  await page.evaluate(() => window.__hilingoFinish('empty'));
  await page.waitForSelector('#endRecord:not(.hidden)');
  const won = await page.evaluate(() => ({
    rec: document.getElementById('endRecord').textContent,
    store: localStorage.getItem('hilingo_solo_best2_he'),
  }));
  if (!/^My New record \d\d:\d\d$/.test(won.rec) || won.store == null) bad(tag + ' natural ' + JSON.stringify(won));
  else ok(tag + ' natural finish saves ' + won.rec);
  await context.close();
}

try {
  const chrome = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try { await run(chrome, 'chromium', true); } finally { await chrome.close(); }
  const wk = await webkit.launch();
  try { await run(wk, 'webkit', false); } finally { await wk.close(); }
} finally { server.close(); }

if (problems.length) {
  console.log('\n' + problems.length + ' failure(s)');
  process.exit(1);
}
console.log('\nv4.3 checks passed');
