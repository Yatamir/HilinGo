/**
 * HilinGo v4.2 — solo mode stopwatch.
 *   node tests_solo.mjs
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
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.mp3': 'audio/mpeg' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let p = path.join(root, decodeURIComponent(url.pathname));
    if (p.endsWith('/')) p += 'index.html';
    fs.readFile(p, (err, buf) => {
      if (err) { res.writeHead(404); res.end('missing'); return; }
      res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function check(page, tag, shot) {
  const solo = (await page.locator('#pcSolo').innerText()).trim();
  if (solo !== '1') bad(tag + ' he label ' + solo);
  else ok(tag + ' solo button is 1');
  await page.click('#langs .opt[data-lang="en"]');
  const en = (await page.locator('#pcSolo').innerText()).trim();
  await page.click('#langs .opt[data-lang="nl"]');
  const nl = (await page.locator('#pcSolo').innerText()).trim();
  await page.click('#langs .opt[data-lang="he"]');
  if (en !== '1' || nl !== '1') bad(tag + ' labels ' + en + ' / ' + nl);
  else ok(tag + ' solo button stays 1');

  await page.click('#playersCard .pc[data-n="2"]');
  await page.click('#go');
  if (await page.locator('#silentOk').isVisible()) await page.locator('#silentOk').click();
  await page.waitForSelector('#half1');
  const multi = await page.evaluate(() => ({
    hidden: document.getElementById('soloTimer').classList.contains('hidden'),
    boards: document.querySelectorAll('#halves .half').length,
  }));
  if (!multi.hidden || multi.boards !== 2) bad(tag + ' multi timer ' + JSON.stringify(multi));
  else ok(tag + ' two-player game hides the stopwatch');
  await page.click('#endBtn');
  await page.click('#again');

  await page.click('#pcSolo');
  await page.click('#go');
  if (await page.locator('#silentOk').isVisible()) await page.locator('#silentOk').click();
  await page.waitForSelector('#soloTime');
  const names = await page.evaluate(() => [...document.querySelectorAll('#halves .pname')].map(e => e.childNodes[0] ? e.childNodes[0].textContent : e.textContent).map(t => t.trim()));
  if (names[0] !== 'שחקן 1' || names[1] !== 'שחקן 2') bad(tag + ' names ' + names.join('|'));
  else ok(tag + ' solo keeps both keyboards');
  await page.waitForFunction(() => document.getElementById('soloTime').textContent !== '00:00');
  const running = await page.evaluate(() => ({
    t: document.getElementById('soloTime').textContent,
    hidden: document.getElementById('soloTimer').classList.contains('hidden'),
    saved: localStorage.getItem('hilingo_solo_best2_he'),
    under: document.getElementById('learn').classList.contains('hidden'),
  }));
  if (!/^\d\d:\d\d$/.test(running.t) || running.t === '00:00' || running.hidden || running.saved != null) bad(tag + ' running ' + JSON.stringify(running));
  else ok(tag + ' timer counts and does not save yet ' + running.t);
  if (shot) await page.screenshot({ path: path.join(SHOTS, 'solo-timer-phone.png') });

  await page.evaluate(() => document.getElementById('start').classList.remove('hidden'));
  await page.click('#go');
  if (await page.locator('#silentOk').isVisible()) await page.locator('#silentOk').click();
  const dropped = await page.evaluate(() => localStorage.getItem('hilingo_solo_best2_he'));
  if (dropped != null) bad(tag + ' restart saved ' + dropped);
  else ok(tag + ' restart before the end does not save');

  await page.waitForFunction(() => document.getElementById('soloTime').textContent !== '00:00');
  await page.evaluate(() => window.__hilingoFinish('empty'));
  await page.waitForSelector('#endRecord:not(.hidden)');
  const done = await page.evaluate(() => ({
    rec: document.getElementById('endRecord').textContent,
    store: localStorage.getItem('hilingo_solo_best2_he'),
    clock: document.getElementById('soloTimer').classList.contains('hidden'),
  }));
  if (!/^My New record \d\d:\d\d$/.test(done.rec) || done.store == null || !done.clock) bad(tag + ' finish ' + JSON.stringify(done));
  else ok(tag + ' finish saves ' + done.rec);
  await page.click('#again');
  const home = (await page.locator('#soloBest').innerText()).trim();
  if (home !== done.rec.replace(/\s+/g, ' ')) bad(tag + ' home ' + home);
  else ok(tag + ' home shows ' + home);
  if (shot) await page.screenshot({ path: path.join(SHOTS, 'solo-record-home.png') });

  await page.click('#modeLearn');
  await page.click('#go');
  if (await page.locator('#silentOk').isVisible()) await page.locator('#silentOk').click();
  const learn = await page.evaluate(() => document.getElementById('soloTimer').classList.contains('hidden') && !document.getElementById('learn').classList.contains('hidden'));
  if (!learn) bad(tag + ' learn shows the stopwatch');
  else ok(tag + ' Learn hides the stopwatch');
}

const server = await serve(ROOT);
const port = server.address().port;
async function open(browser, extra) {
  const context = await browser.newContext(extra || {});
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
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:${port}/index.html?ptt=0`, { waitUntil: 'domcontentloaded' });
  return page;
}

try {
  const chrome = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await open(chrome);
    await check(page, 'chromium', true);
  } finally { await chrome.close(); }
  const wk = await webkit.launch();
  try {
    const page = await open(wk, {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      isMobile: true,
      hasTouch: true,
    });
    await check(page, 'webkit', false);
    await page.screenshot({ path: path.join(SHOTS, 'solo-record-home-webkit.png') });
  } finally { await wk.close(); }
} finally { server.close(); }

if (problems.length) {
  console.log('\n' + problems.length + ' failure(s)');
  process.exit(1);
}
console.log('\nsolo checks passed');
