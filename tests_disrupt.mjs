/**
 * HilinGo v4.5 — only the next player can disrupt, 90s cooldown, not from hint/mic, off in solo and Learn.
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
    class FakeSR { start() {} stop() {} abort() {} }
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
    b0: window.__hilingoDisrupt.badge(0),
    b1: window.__hilingoDisrupt.badge(1),
    b2: window.__hilingoDisrupt.badge(2),
    l0: window.__hilingoDisrupt.left(0),
    l1: window.__hilingoDisrupt.left(1),
    l2: window.__hilingoDisrupt.left(2),
    turn: G.turn,
    letters: G.boards[0].size,
    time: G.timeLeft,
    paused: paused,
    labels: {
      he: STR.he.disruptReady, en: STR.en.disruptReady,
      nl: STR.nl.disruptReady, pt: STR.pt.disruptReady,
    },
  }));
  let s = await api();
  if (errors.length) bad(tag + ' error ' + errors.join(' | '));
  if (!s.allowed || s.ms !== 90000 || s.next !== 1) bad(tag + ' setup ' + JSON.stringify(s));
  else ok(tag + ' next player is 2, cooldown is 90s');
  if (s.b1 !== s.labels.he || s.b0 || s.b2) bad(tag + ' badge ' + JSON.stringify(s));
  else ok(tag + ' ready badge only on the next player');
  const labels = s.labels;
  if (labels.he !== '⚡ מוכן להפריע' || labels.en !== '⚡ Ready to disrupt' || labels.nl !== '⚡ Klaar om te storen' || labels.pt !== '⚡ Pronto para atrapalhar') bad(tag + ' i18n ' + JSON.stringify(labels));
  else ok(tag + ' badge copy is localized');

  for (const sel of ['#hb0', '#mic0', '#send0', '#in0', '#status', '#half0 .hhead', '#t1']) {
    await page.dblclick(sel);
  }
  s = await api();
  if (s.count !== 0) bad(tag + ' stray trigger ' + s.count);
  else ok(tag + ' hint, mic, send, input, status, header, and other boards do not disrupt');

  const lettersBefore = await page.evaluate(() => [...document.querySelectorAll('#t0 .tile')].map(t => t.dataset.l).join(''));
  await page.dblclick('#t0');
  s = await api();
  const fxOn = await page.evaluate(() => {
    const fx = document.getElementById('fx');
    return (fx && !fx.classList.contains('hidden')) || !!document.querySelector('#t0 .tile.fxflip') || !!document.querySelector('#t0.waving');
  });
  if (s.count !== 1 || !fxOn || s.l0 !== 0 || s.l2 !== 0 || s.l1 < 88000 || s.l1 > 90000) bad(tag + ' disrupt ' + JSON.stringify(s) + ' fx ' + fxOn);
  else ok(tag + ' active letter grid charges only the next player');
  if (!/^⚡ \d:\d\d$/.test(s.b1)) bad(tag + ' countdown ' + s.b1);
  else ok(tag + ' cooldown badge ' + s.b1);
  await page.dblclick('#t0');
  s = await api();
  if (s.count !== 1) bad(tag + ' cooldown ignored ' + s.count);
  else ok(tag + ' second tap is blocked for 90s');

  const t0 = s.time;
  await page.evaluate(() => window.__hilingoDisrupt.play('fog'));
  await page.waitForTimeout(450);
  s = await api();
  if (s.paused || s.time > t0 || t0 - s.time > 2 || s.letters !== 22) bad(tag + ' timer/board ' + JSON.stringify({ t0, time: s.time, letters: s.letters, paused: s.paused }));
  else ok(tag + ' effect does not pause the timer or change the board');
  const sameLetters = await page.evaluate(() => [...document.querySelectorAll('#t0 .tile')].map(t => t.dataset.l).join(''));
  if (sameLetters !== lettersBefore) bad(tag + ' letters changed');

  await page.evaluate(() => window.__hilingoDisrupt.play('scramble'));
  await page.waitForTimeout(200);
  const mid = await page.evaluate(() => document.querySelectorAll('#t0 .tile.fxflip').length);
  if (!mid) bad(tag + ' scramble did not flip');
  await page.waitForTimeout(2600);
  const restored = await page.evaluate(() => [...document.querySelectorAll('#t0 .tile')].every(t => t.textContent === t.dataset.l && !t.classList.contains('fxflip')));
  if (!restored) bad(tag + ' scramble did not restore');
  else ok(tag + ' scrambled letters return and the board is unchanged');

  const prev = await page.evaluate(() => window.__hilingoDisrupt.last());
  await page.evaluate(() => window.__hilingoDisrupt.backdate(1));
  await page.dblclick('#t0');
  s = await api();
  if (s.count !== 2 || !s.last || s.last === prev) bad(tag + ' repeat ' + prev + ' -> ' + s.last + ' count ' + s.count);
  else ok(tag + ' after 90s the next effect is a different one');

  await page.fill('#in0', 'אבא');
  await page.click('#send0');
  await page.waitForTimeout(200);
  s = await api();
  if (s.turn !== 1 || s.l1 < 80000 || s.b2 !== s.labels.he) bad(tag + ' across turns ' + JSON.stringify(s));
  else ok(tag + ' cooldown keeps counting for that player across turns');

  const rolls = await page.evaluate(() => {
    const orig = Math.random;
    Math.random = () => 0;
    const names = [];
    for (let i = 0; i < 6; i++) names.push(window.__hilingoDisrupt.roll());
    Math.random = orig;
    return names;
  });
  if (rolls.some((n, i) => i && n === rolls[i - 1])) bad(tag + ' adjacent ' + rolls.join(','));
  else ok(tag + ' the same effect is not picked twice in a row');
  if (errors.length) bad(tag + ' late error ' + errors.join(' | '));
  await context.close();
}

async function offModes(browser, tag) {
  const solo = await boot(browser);
  await solo.page.evaluate(() => { document.getElementById('autoMic').checked = false; });
  await solo.page.click('#pcSolo');
  await solo.page.click('#go');
  await solo.page.waitForSelector('#soloClock');
  await solo.page.dblclick('#t0');
  const soloState = await solo.page.evaluate(() => ({
    allowed: window.__hilingoDisrupt.allowed(),
    count: window.__hilingoDisrupt.count(),
    badge: window.__hilingoDisrupt.badge(1),
  }));
  if (soloState.allowed || soloState.count || soloState.badge) bad(tag + ' solo ' + JSON.stringify(soloState));
  else ok(tag + ' solo cannot disrupt');
  await solo.context.close();

  const learn = await boot(browser);
  await learn.page.click('#modeLearn');
  await learn.page.click('#go');
  await learn.page.waitForSelector('#learn:not(.hidden)');
  const learnState = await learn.page.evaluate(() => ({
    allowed: window.__hilingoDisrupt.allowed(),
    count: window.__hilingoDisrupt.count(),
  }));
  if (learnState.allowed || learnState.count) bad(tag + ' learn ' + JSON.stringify(learnState));
  else ok(tag + ' Learn cannot disrupt');
  if (learn.errors.length || solo.errors.length) bad(tag + ' errors ' + [...solo.errors, ...learn.errors].join(' | '));
  await learn.context.close();
}

async function shots(browser) {
  const { page, context } = await boot(browser);
  await page.evaluate(() => { document.getElementById('autoMic').checked = false; });
  await page.click('#go');
  await page.waitForSelector('#half1');
  const frames = [];
  const tmp = fs.mkdtempSync('/tmp/hilingo-fx-');
  let i = 0;
  for (const name of ['fireworks', 'bubbles', 'spotlight', 'emojis']) {
    await page.evaluate(n => window.__hilingoDisrupt.play(n), name);
    await page.waitForTimeout(name === 'fireworks' ? 700 : 450);
    const file = name === 'fireworks' ? 'v45-fireworks.png' : name === 'bubbles' ? 'v45-bubbles.png' : name === 'spotlight' ? 'v45-spotlight.png' : 'v45-emojis.png';
    await page.screenshot({ path: path.join(SHOTS, file) });
    const a = path.join(tmp, String(i++).padStart(2, '0') + '.png');
    await page.screenshot({ path: a });
    frames.push(a);
    await page.waitForTimeout(350);
    const b = path.join(tmp, String(i++).padStart(2, '0') + '.png');
    await page.screenshot({ path: b });
    frames.push(b);
  }
  await page.evaluate(() => window.__hilingoDisrupt.play('confetti'));
  await page.dblclick('#t0');
  await page.waitForTimeout(200);
  const cool = await page.evaluate(() => window.__hilingoDisrupt.badge(1));
  if (!/^⚡ \d:\d\d$/.test(cool)) bad('cooldown shot badge ' + cool);
  await page.evaluate(() => window.__hilingoDisrupt.clear());
  await page.screenshot({ path: path.join(SHOTS, 'v45-cooldown.png') });
  ok('screenshots');
  const gif = path.join(SHOTS, 'v45-effects.gif');
  const ff = spawnSync('ffmpeg', ['-y', '-framerate', '4', '-i', path.join(tmp, '%02d.png'), '-vf', 'fps=4,scale=390:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse', gif], { encoding: 'utf8' });
  if (ff.status !== 0 || !fs.existsSync(gif)) bad('gif ' + (ff.stderr || '').slice(-200));
  else ok('gif ' + gif);
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
    try {
      await rules(wk, 'webkit');
      await offModes(wk, 'webkit');
    } finally { await wk.close(); }
  } catch (e) { bad('webkit ' + e.message); }
} finally { server.close(); }

if (problems.length) {
  console.log('\n' + problems.length + ' failure(s)');
  process.exit(1);
}
console.log('\ndisrupt checks passed');
