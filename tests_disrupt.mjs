/**
 * HilinGo v4.6 — secret disruptions on the next player's own board, 20s cooldown.
 *   node tests_disrupt.mjs
 */
import { chromium, webkit } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

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

async function boot(browser) {
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
    class FakeSR { start() { if (this.onstart) this.onstart(); } stop() {} abort() {} }
    window.SpeechRecognition = FakeSR;
    window.webkitSpeechRecognition = FakeSR;
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(String(err && err.message || err)));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:${port}/index.html?ptt=0`, { waitUntil: 'domcontentloaded' });
  return { page, context, errors };
}

async function rules(browser, tag) {
  const { page, context, errors } = await boot(browser);
  await page.evaluate(() => { document.getElementById('autoMic').checked = false; });
  await page.click('#playersCard .pc[data-n="3"]');
  await page.click('#go');
  await page.waitForSelector('#half2');
  const api = () => page.evaluate(() => ({
    allowed: window.__hilingoDisrupt.allowed(),
    ms: window.__hilingoDisrupt.MS,
    next: window.__hilingoDisrupt.next(),
    count: window.__hilingoDisrupt.count(),
    last: window.__hilingoDisrupt.last(),
    l0: window.__hilingoDisrupt.left(0),
    l1: window.__hilingoDisrupt.left(1),
    l2: window.__hilingoDisrupt.left(2),
    turn: G.turn,
    letters: G.boards[0].size,
    time: G.timeLeft,
    paused: paused,
    badges: document.querySelectorAll('.dbadge').length,
    secret: !/מוכן להפריע|Ready to disrupt|Klaar om te storen|Pronto para atrapalhar/.test(document.body.innerText),
  }));
  let s = await api();
  if (errors.length) bad(tag + ' error ' + errors.join(' | '));
  if (!s.allowed || s.ms !== 20000 || s.next !== 1 || s.badges || !s.secret) bad(tag + ' setup ' + JSON.stringify(s));
  else ok(tag + ' secret, next player, 20s cooldown');

  await page.dblclick('#t0');
  await page.dblclick('#t2');
  await page.evaluate(() => {
    ['#hb1', '#mic1', '#half1 .hhead'].forEach(sel => {
      const el = document.querySelector(sel);
      if (!el) return;
      const fire = () => el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 8, clientY: 8 }));
      fire(); fire();
    });
  });
  s = await api();
  if (s.count !== 0) bad(tag + ' stray ' + s.count);
  else ok(tag + ' active board, other boards, hint and mic do not disrupt');

  const lettersBefore = await page.evaluate(() => [...document.querySelectorAll('#t0 .tile')].map(t => t.dataset.l).join(''));
  await page.dblclick('#t1');
  s = await api();
  const fxOn = await page.evaluate(() => {
    const fx = document.getElementById('fx');
    return (fx && !fx.classList.contains('hidden')) || !!document.querySelector('#t0 .tile.fxflip') || !!document.querySelector('#half0.fxglitch, #half0.fxzoom, #half0.fxmirror, #t0.waving');
  });
  if (s.count !== 1 || !fxOn || s.l0 !== 0 || s.l2 !== 0 || s.l1 < 18000 || s.l1 > 20000) bad(tag + ' disrupt ' + JSON.stringify(s) + ' fx ' + fxOn);
  else ok(tag + ' next player board charges only that player');
  await page.dblclick('#t1');
  s = await api();
  if (s.count !== 1) bad(tag + ' cooldown ignored ' + s.count);
  else ok(tag + ' second tap within 20s is a no-op');

  const t0 = s.time;
  await page.evaluate(() => window.__hilingoDisrupt.play('fog'));
  const hit = await page.evaluate(() => {
    const mic = document.getElementById('mic0');
    const r = mic.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!(el && (el === mic || mic.contains(el)));
  });
  if (!hit) bad(tag + ' overlay ate the mic');
  else ok(tag + ' mic stays under the effect');
  await page.evaluate(() => { try { releaseIntro('ended'); } catch (_) {} });
  await page.click('#mic0');
  const micOn = await page.evaluate(() => document.getElementById('mic0').classList.contains('on'));
  if (!micOn) bad(tag + ' mic click during effect');
  else ok(tag + ' mic button click works during an effect');
  await page.waitForTimeout(400);
  s = await api();
  if (s.paused || s.time > t0 || t0 - s.time > 3 || s.letters !== 22) bad(tag + ' timer ' + JSON.stringify(s));
  else ok(tag + ' effect does not pause the timer');
  const same = await page.evaluate(() => [...document.querySelectorAll('#t0 .tile')].map(t => t.dataset.l).join(''));
  if (same !== lettersBefore) bad(tag + ' letters changed');

  await page.evaluate(() => window.__hilingoDisrupt.backdate(1));
  const prev = await page.evaluate(() => window.__hilingoDisrupt.last());
  await page.dblclick('#t1');
  s = await api();
  if (s.count !== 2 || !s.last || s.last === prev) bad(tag + ' repeat ' + prev + ' -> ' + s.last);
  else ok(tag + ' after 20s the next effect differs');
  if (errors.length) bad(tag + ' late ' + errors.join(' | '));
  await context.close();
}

async function offModes(browser, tag) {
  const solo = await boot(browser);
  await solo.page.evaluate(() => { document.getElementById('autoMic').checked = false; });
  await solo.page.click('#pcSolo');
  await solo.page.click('#go');
  await solo.page.waitForSelector('#soloClock');
  await solo.page.dblclick('#t1');
  const soloState = await solo.page.evaluate(() => ({
    allowed: window.__hilingoDisrupt.allowed(),
    count: window.__hilingoDisrupt.count(),
  }));
  if (soloState.allowed || soloState.count) bad(tag + ' solo ' + JSON.stringify(soloState));
  else ok(tag + ' solo cannot disrupt');
  await solo.context.close();

  const learn = await boot(browser);
  await learn.page.click('#modeLearn');
  await learn.page.click('#go');
  await learn.page.waitForSelector('#learn:not(.hidden)');
  const learnState = await learn.page.evaluate(() => window.__hilingoDisrupt.allowed());
  if (learnState) bad(tag + ' learn allowed');
  else ok(tag + ' Learn cannot disrupt');
  await learn.context.close();
}

async function shots(browser) {
  const { page, context } = await boot(browser);
  await page.evaluate(() => { document.getElementById('autoMic').checked = false; });
  await page.click('#go');
  await page.waitForSelector('#half1');
  await page.screenshot({ path: path.join(SHOTS, 'v46-nobadge.png') });
  const secret = await page.evaluate(() => !document.querySelector('.dbadge') && !/מוכן להפריע/.test(document.body.innerText));
  if (!secret) bad('badge still visible');
  else ok('no badge on the inactive card');
  const tmp = fs.mkdtempSync('/tmp/hilingo-fx-');
  let i = 0;
  const names = ['fireworks', 'bubbles', 'rain', 'cat', 'disco', 'snow'];
  for (const name of names) {
    await page.evaluate(n => window.__hilingoDisrupt.play(n), name);
    await page.waitForTimeout(name === 'fireworks' ? 600 : 450);
    if (name === 'fireworks') {
      const pix = await page.evaluate(() => window.__hilingoDisrupt.pixels());
      if (!pix.ok) bad('fireworks pixels ' + JSON.stringify(pix));
      else ok('fireworks canvas ' + pix.w + 'x' + pix.h + ' ink ' + pix.n);
    }
    await page.screenshot({ path: path.join(SHOTS, 'v46-' + name + '.png') });
    const a = path.join(tmp, String(i++).padStart(2, '0') + '.png');
    await page.screenshot({ path: a });
    await page.waitForTimeout(280);
    const b = path.join(tmp, String(i++).padStart(2, '0') + '.png');
    await page.screenshot({ path: b });
  }
  const gif = path.join(SHOTS, 'v46-effects.gif');
  const ff = spawnSync('ffmpeg', ['-y', '-framerate', '4', '-i', path.join(tmp, '%02d.png'), '-vf', 'fps=4,scale=390:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse', gif], { encoding: 'utf8' });
  if (ff.status !== 0 || !fs.existsSync(gif)) bad('gif ' + (ff.stderr || '').slice(-180));
  else ok('gif');
  await context.close();
}

try {
  const chrome = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    await rules(chrome, 'chromium');
    await offModes(chrome, 'chromium');
    await shots(chrome);
  } finally { await chrome.close(); }
  try {
    const wk = await webkit.launch();
    try { await rules(wk, 'webkit'); await offModes(wk, 'webkit'); }
    finally { await wk.close(); }
  } catch (e) { bad('webkit ' + e.message); }
} finally { server.close(); }

if (problems.length) {
  console.log('\n' + problems.length + ' failure(s)');
  process.exit(1);
}
console.log('\ndisrupt checks passed');
