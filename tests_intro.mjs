/**
 * HilinGo v4.11.11 — Hili's intro plays once when a game starts, and the mic waits.
 *   npm install playwright-core
 *   node tests_intro.mjs
 * Audio and speech recognition are mocked. The real clip is not decoded.
 */
import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const MP3 = path.join(ROOT, 'audio', 'hilingo.mp3');

const problems = [];
function bad(msg) { problems.push(msg); console.log('  FAIL', msg); }
function ok(msg) { console.log('  ok  ', msg); }

const hash = crypto.createHash('sha256').update(fs.readFileSync(MP3)).digest('hex');
const size = fs.statSync(MP3).size;
if (hash !== '321a89c75f99356cbf1d791c214d75527176dd8b0115e0a35419e7a67afe6464' || size !== 27062) {
  bad('audio/hilingo.mp3 hash/size ' + hash + ' ' + size);
} else ok('audio/hilingo.mp3 sha256 and 27062 bytes');

function serve(root) {
  const types = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.png': 'image/png', '.json': 'application/json', '.mp3': 'audio/mpeg',
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let p = path.join(root, decodeURIComponent(url.pathname));
    if (p.endsWith('/')) p += 'index.html';
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    fs.readFile(p, (err, buf) => {
      if (err) { res.writeHead(404); res.end('missing'); return; }
      res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const server = await serve(ROOT);
const port = server.address().port;
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext();
await context.addInitScript(() => {
  window.__intro = { plays: 0, loads: 0, src: '', preload: '', gameHiddenAtPlay: null, pauses: 0 };
  window.__srStarts = 0;
  window.__srLog = [];
  class FakeAudio {
    constructor(src) {
      this.src = src || '';
      this.preload = '';
      this.currentTime = 0;
      this.paused = true;
      this._ls = {};
      window.__intro.src = String(this.src);
      window.__intro.el = this;
    }
    load() { window.__intro.loads++; }
    set preload(v) { this._preload = v; window.__intro.preload = v; }
    get preload() { return this._preload; }
    play() {
      window.__intro.plays++;
      const game = document.getElementById('game');
      window.__intro.gameHiddenAtPlay = !!(game && game.classList.contains('hidden'));
      window.__intro.src = String(this.src);
      this.paused = false;
      if (window.__intro.fail) return Promise.reject(new Error('blocked'));
      return Promise.resolve();
    }
    pause() { this.paused = true; window.__intro.pauses++; }
    addEventListener(type, fn) { (this._ls[type] ||= []).push(fn); }
    removeEventListener(type, fn) { this._ls[type] = (this._ls[type] || []).filter(f => f !== fn); }
  }
  window.Audio = FakeAudio;
  window.__fireIntro = (type) => {
    const el = window.__intro.el;
    const list = el && el._ls && el._ls[type] ? el._ls[type].slice() : [];
    list.forEach(fn => fn());
  };
  class FakeSR {
    start() { window.__srStarts++; window.__srLog.push('start'); if (this.onstart) this.onstart(); }
    stop() { window.__srLog.push('stop'); }
    abort() { window.__srLog.push('abort'); }
  }
  window.SpeechRecognition = FakeSR;
  window.webkitSpeechRecognition = FakeSR;
});

async function open(page) {
  const errors = [];
  page.on('pageerror', err => errors.push(String(err)));
  await page.goto(`http://127.0.0.1:${port}/index.html?ptt=0`, { waitUntil: 'domcontentloaded' });
  await page.click('#micAuto');
  return errors;
}

async function snap(page) {
  return page.evaluate(() => ({
    plays: window.__intro.plays,
    loads: window.__intro.loads,
    preload: window.__intro.preload,
    src: window.__intro.src,
    hiddenAtPlay: window.__intro.gameHiddenAtPlay,
    sr: window.__srStarts,
    ver: document.querySelector('meta[name="hilingo-version"]').content,
    version: window.HILINGO_VERSION,
    err: document.getElementById('errbar').classList.contains('hidden') ? '' : document.getElementById('errbar').textContent,
    gameHidden: document.getElementById('game').classList.contains('hidden'),
    startHidden: document.getElementById('start').classList.contains('hidden'),
    endHidden: document.getElementById('endov').classList.contains('hidden'),
    active: [...document.querySelectorAll('.half')].findIndex(h => h.classList.contains('active')),
    history: document.getElementById('history').textContent,
    gone: [...document.querySelectorAll('#t0 .tile.gone')].map(t => t.dataset.l).join(''),
    lang: document.documentElement.lang,
  }));
}

try {
  // Hebrew: preload, play inside the start tap, hold the mic, then the first turn.
  {
    const page = await context.newPage();
    const errors = await open(page);
    let s = await snap(page);
    if (s.loads < 1 || s.preload !== 'auto' || !/hilingo\.mp3(\?v=[\d.]+)?$/.test(s.src)) bad('preload ' + JSON.stringify(s));
    else ok('preloaded audio/hilingo.mp3');
    if (s.ver !== '4.11.11' || s.version !== '4.11.11') bad('version ' + s.ver + ' / ' + s.version);
    else ok('version 4.11.11');

    await page.click('#go');
    s = await snap(page);
    if (s.plays !== 1 || s.hiddenAtPlay !== true || s.gameHidden || s.active !== 0) bad('start tap ' + JSON.stringify(s));
    else ok('start tap plays the intro before the board is shown');
    await page.waitForTimeout(500);
    s = await snap(page);
    if (s.sr !== 0) bad('mic started during the intro ' + s.sr);
    else ok('auto-mic stayed off while the intro was playing');

    await page.fill('#in0', 'אבא');
    await page.click('#send0');
    await page.waitForTimeout(450);
    s = await snap(page);
    if (s.active !== 1 || s.history !== 'אבא' || s.gone !== 'א' || s.sr !== 0 || s.plays !== 1) bad('first turn during intro ' + JSON.stringify(s));
    else ok('first turn accepted אבא while the mic was still waiting');

    await page.evaluate(() => window.__fireIntro('ended'));
    await page.waitForFunction(() => window.__srStarts >= 1, { timeout: 2000 });
    s = await snap(page);
    if (s.sr < 1 || s.plays !== 1) bad('mic after ended ' + JSON.stringify(s));
    else ok('mic opened after the intro ended');

    await page.click('#endBtn');
    s = await snap(page);
    if (s.endHidden || s.plays !== 1) bad('end screen ' + JSON.stringify({ endHidden: s.endHidden, plays: s.plays }));
    else ok('ending the game does not replay the intro');
    await page.click('#again');
    s = await snap(page);
    if (!s.startHidden || s.gameHidden || s.plays !== 1) bad('play again ' + JSON.stringify(s));
    else ok('משחק חדש starts the next game without a second intro');
    await page.fill('#in0', 'שלום');
    await page.click('#send0');
    await page.waitForTimeout(200);
    s = await snap(page);
    if (s.active !== 1 || s.history !== 'שלום' || s.err || errors.length) bad('rematch first turn ' + JSON.stringify(s) + ' ' + errors.join(';'));
    else ok('rematch first turn ran');
    await page.close();
  }

  // Blocked playback: the game and the first turn continue, and the mic does not wait out the 3s.
  {
    const page = await context.newPage();
    const errors = await open(page);
    await page.evaluate(() => { window.__intro.fail = true; });
    const t0 = Date.now();
    await page.click('#go');
    await page.waitForFunction(() => window.__srStarts >= 1, { timeout: 2000 });
    const waited = Date.now() - t0;
    let s = await snap(page);
    if (s.plays < 1 || s.gameHidden || s.active !== 0 || waited > 1500 || s.err || errors.length) bad('blocked start ' + JSON.stringify(s) + ' waited ' + waited);
    else ok('blocked playback still starts the game and the mic (' + waited + 'ms)');
    await page.fill('#in0', 'אבא');
    await page.click('#send0');
    await page.waitForTimeout(200);
    s = await snap(page);
    if (s.active !== 1 || s.history !== 'אבא') bad('blocked first turn ' + JSON.stringify(s));
    else ok('first turn runs when playback is blocked');
    await page.close();
  }

  // Safety timeout: no `ended` event, mic opens after ~3s and not at the usual 300ms.
  {
    const page = await context.newPage();
    await open(page);
    const t0 = Date.now();
    await page.click('#go');
    await page.waitForTimeout(500);
    let s = await snap(page);
    if (s.sr !== 0 || s.plays !== 1) bad('timeout early mic ' + JSON.stringify(s));
    await page.waitForFunction(() => window.__srStarts >= 1, { timeout: 4000 });
    const waited = Date.now() - t0;
    s = await snap(page);
    if (waited < 2500 || waited > 4000 || s.active !== 0) bad('safety timeout ' + waited + 'ms ' + JSON.stringify(s));
    else ok('mic opened on the 3s safety timeout (' + waited + 'ms)');
    await page.fill('#in0', 'אבא');
    await page.click('#send0');
    await page.waitForTimeout(200);
    s = await snap(page);
    if (s.active !== 1 || s.history !== 'אבא') bad('timeout first turn ' + JSON.stringify(s));
    else ok('first turn runs after the safety timeout');
    await page.close();
  }

  // Same start path in every language.
  const langs = [
    ['en', 'cat'],
    ['nl', 'huis'],
    ['pt', 'casa'],
    ['es', 'casa'],
    ['it', 'casa'],
  ];
  for (const [lang, word] of langs) {
    const page = await context.newPage();
    const errors = await open(page);
    await page.click(`#langs .opt[data-lang="${lang}"]`);
    await page.waitForFunction(() => !document.getElementById('go').disabled, { timeout: 20000 });
    await page.click('#go');
    await page.waitForTimeout(400);
    let s = await snap(page);
    if (s.plays !== 1 || s.sr !== 0 || s.gameHidden || s.active !== 0 || s.lang !== lang || s.hiddenAtPlay !== true) bad(lang + ' start ' + JSON.stringify(s));
    else ok(lang + ' intro is playing and the mic is waiting');
    await page.evaluate(() => window.__fireIntro('ended'));
    await page.waitForFunction(() => window.__srStarts >= 1, { timeout: 2000 });
    await page.fill('#in0', word);
    await page.click('#send0');
    await page.waitForTimeout(300);
    s = await snap(page);
    if (s.active !== 1 || s.history !== word || s.err || errors.length) bad(lang + ' first turn ' + JSON.stringify(s) + ' ' + errors.join(';'));
    else ok(lang + ' first turn ran (' + word + ')');
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

if (problems.length) {
  console.log('\n' + problems.length + ' failure(s)');
  process.exit(1);
}
console.log('\nintro checks passed');
