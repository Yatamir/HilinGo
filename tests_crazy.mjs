/**
 * HilinGo v4.10.3 — one silly word per turn, and Hili is never allowed.
 *   node tests_crazy.mjs
 */
import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const problems = [];
const bad = (m) => { problems.push(m); console.log('  FAIL', m); };
const ok = (m) => console.log('  ok  ', m);

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
const context = await browser.newContext();
await context.addInitScript(() => {
  window.Audio = class { constructor(){ this.preload=''; } play(){ return Promise.resolve(); } pause(){} load(){} addEventListener(){} };
  window.SpeechRecognition = class { start(){} stop(){} abort(){} };
  window.webkitSpeechRecognition = window.SpeechRecognition;
});
const page = await context.newPage();
await page.setViewportSize({ width: 390, height: 844 });
try {
  await page.goto(`http://127.0.0.1:${port}/index.html?ptt=0`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { document.getElementById('sound').checked = false; });
  await page.click('#go');
  await page.waitForSelector('#half0');
  await page.evaluate(() => { try { releaseIntro('ended'); } catch (_) {} WG.addCustomWord('אבא'); G.timeLeft = 18; });

  await page.click('#crazyBtn');
  await page.fill('#in0', 'הילי');
  await page.click('#send0');
  const hili = await page.evaluate(() => ({
    turn: G.turn,
    words: G.history.filter(h => h.word).map(h => h.word),
    armed: crazyArmed,
    t: G.timeLeft,
  }));
  if (hili.turn !== 0 || hili.words.length || !hili.armed) bad('hili crazy ' + JSON.stringify(hili));
  else ok('Hili is rejected even with the crazy button');

  await page.fill('#in0', 'היליה');
  await page.click('#send0');
  const related = await page.evaluate(() => G.history.filter(h => h.word).length);
  if (related) bad('related hili was accepted');
  else ok('a word related to Hili is rejected too');

  const before = await page.evaluate(() => ({ size: G.boards[0].size, t: G.timeLeft }));
  await page.fill('#in0', 'בלהבלה');
  await page.click('#send0');
  const silly = await page.evaluate(() => {
    const h = G.history.filter(x => x.word).at(-1);
    const el = document.querySelector('#history .crazyword');
    const color = el ? getComputedStyle(el).color : '';
    return {
      turn: G.turn,
      size: G.boards[0].size,
      t: G.timeLeft,
      crazy: !!(h && h.crazy),
      word: h && h.word,
      zanies: document.querySelectorAll('#fx .zany').length,
      opacity: getComputedStyle(document.getElementById('crazyBtn')).opacity,
      color,
      green: !!(el && el.classList.contains('sentword')),
    };
  });
  if (silly.turn !== 0 || silly.size !== before.size || silly.t > before.t + 0.2 || silly.t < 5 || !silly.crazy || silly.word !== 'בלהבלה' || silly.zanies < 10 || silly.opacity === '1' || silly.green || silly.color === 'rgb(18, 138, 62)') bad('silly ' + JSON.stringify(silly));
  else ok('silly word stays on this turn, deletes nothing, and bursts 🤪');

  await page.fill('#in0', 'אבא');
  await page.click('#send0');
  const real = await page.evaluate(() => ({ turn: G.turn, used: G.history.filter(h => h.word && !h.crazy).map(h => h.word) }));
  if (real.turn !== 1 || real.used.join(' ') !== 'אבא') bad('real ' + JSON.stringify(real));
  else ok('a real word is still required after the silly one');

  if (problems.length) { console.log('\n' + problems.length + ' failed'); process.exitCode = 1; }
  else console.log('\ncrazy checks passed');
} finally {
  await browser.close();
  server.close();
}
