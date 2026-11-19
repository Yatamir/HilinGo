/**
 * HilinGo v4.0 — WebKit, iPhone 14 Pro, standalone display-mode.
 * Confirms the white outline mic and the blue waveform actually paint.
 *   npx playwright install webkit && node tests_learn_webkit.mjs
 */
import { webkit } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
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

const IPHONE = {
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
};

const server = await serve(ROOT);
const port = server.address().port;
let browser;
try {
  browser = await webkit.launch();
  const context = await browser.newContext(IPHONE);
  await context.addInitScript(() => {
    const orig = window.matchMedia ? window.matchMedia.bind(window) : null;
    window.matchMedia = (q) => {
      if (String(q).includes('display-mode')) {
        return { matches: true, media: String(q), addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } };
      }
      return orig ? orig(q) : { matches: false, media: String(q), addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} };
    };
    try { Object.defineProperty(navigator, 'standalone', { configurable: true, get() { return true; } }); } catch (_) {}
    window.__intro = { plays: 0, el: null };
    window.__srStarts = 0;
    window.__srLangs = [];
    window.__srs = [];
    class FakeAudio {
      constructor(src) { this._src = ''; this.paused = true; this.currentTime = 0; this.preload = 'auto'; this._ls = {}; this.src = src || ''; }
      set src(v) { this._src = String(v || ''); if (/hilingo/.test(this._src)) window.__intro.el = this; }
      get src() { return this._src; }
      load() {}
      play() {
        this.paused = false;
        if (/hilingo/.test(this._src)) { window.__intro.plays++; window.__intro.el = this; }
        return Promise.resolve();
      }
      pause() { this.paused = true; }
      addEventListener(type, fn) { (this._ls[type] ||= []).push(fn); }
      removeEventListener() {}
    }
    window.Audio = FakeAudio;
    window.__fireIntro = (type) => {
      const el = window.__intro.el;
      ((el && el._ls && el._ls[type]) || []).forEach(fn => fn());
    };
    class FakeSR {
      start() { window.__srStarts++; window.__srLangs.push(this.lang); window.__srs.push(this); if (this.onstart) this.onstart(); }
      stop() {}
      abort() { if (this.onend) this.onend(); }
    }
    window.SpeechRecognition = FakeSR;
    window.webkitSpeechRecognition = FakeSR;
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/index.html?ios=1&ptt=0`, { waitUntil: 'domcontentloaded' });
  const standalone = await page.evaluate(() => matchMedia('(display-mode: standalone)').matches && navigator.standalone === true);
  if (!standalone) bad('standalone media query did not match');
  else ok('standalone display-mode');
  const ptLabel = (await page.locator('#langs [data-lang="pt"]').innerText()).trim();
  if (ptLabel !== 'Português' || /🇵🇹|🇧🇷/.test(ptLabel)) bad('pt label ' + ptLabel);
  else ok('Portuguese button has no flags');
  await page.screenshot({ path: path.join(SHOTS, 'lang-webkit-iphone.png') });
  await page.click('#modeLearn');
  await page.click('#go');
  await page.evaluate(() => window.__fireIntro('ended'));
  await page.waitForFunction(() => document.getElementById('learn').dataset.state === 'IDLE_NATIVE');
  const idle = await page.evaluate(() => {
    const mic = document.querySelector('#learnMic .ico-mic');
    const rect = mic.querySelector('rect');
    const b = mic.getBoundingClientRect();
    return {
      w: b.width, h: b.height,
      stroke: getComputedStyle(rect).stroke,
      attr: rect.getAttribute('stroke'),
      hidden: document.getElementById('learnListenMark').classList.contains('hidden'),
    };
  });
  if (idle.w < 20 || idle.h < 20 || idle.attr !== '#fff' || !/255/.test(idle.stroke) || !idle.hidden) bad('idle mic ' + JSON.stringify(idle));
  else ok('outline mic paints at ' + Math.round(idle.w) + 'px, stroke ' + idle.stroke);
  await page.screenshot({ path: path.join(SHOTS, 'learn-webkit-idle-iphone.png') });

  await page.click('#learnMic');
  await page.waitForFunction(() => document.getElementById('learn').dataset.state === 'LISTEN_NATIVE');
  const listen = await page.evaluate(() => {
    const mark = document.querySelector('#learnListenMark .ico-listen');
    const b = mark.getBoundingClientRect();
    const circle = mark.querySelector('circle');
    return {
      w: b.width, h: b.height,
      fill: circle.getAttribute('fill'),
      hidden: document.getElementById('learnListenMark').classList.contains('hidden'),
    };
  });
  if (listen.hidden || listen.w < 24 || listen.h < 24 || listen.fill !== '#4060E0') bad('waveform ' + JSON.stringify(listen));
  else ok('blue waveform paints while listening');
  await page.screenshot({ path: path.join(SHOTS, 'learn-webkit-listening-iphone.png') });
  for (let i = 0; i < 5; i++) await page.click('#verLblLearn');
  await page.waitForFunction(() => !document.getElementById('learnDbg').classList.contains('hidden'));
  const copy = await page.evaluate(() => {
    const rects = [...document.querySelectorAll('#dbgCopy .ico-copy rect')];
    const bar = document.querySelector('.dbgbar').getBoundingClientRect();
    const box = document.querySelector('#learnDbg').getBoundingClientRect();
    return { stroke: rects.map(r => r.getAttribute('stroke')).join(','), barTop: bar.top, boxTop: box.top };
  });
  if (copy.stroke !== '#fff,#fff' || copy.barTop > copy.boxTop + 2) bad('debug copy icon ' + JSON.stringify(copy));
  else ok('white copy icon is pinned at the top of the log');
  await page.screenshot({ path: path.join(SHOTS, 'learn-webkit-debug-iphone.png') });

  const play = await context.newPage();
  play.on('pageerror', e => errors.push(String(e)));
  await play.goto(`http://127.0.0.1:${port}/index.html?ptt=1`, { waitUntil: 'domcontentloaded' });
  await play.click('#go');
  await play.evaluate(() => window.__fireIntro('ended'));
  await play.waitForTimeout(400);
  // A game start forces auto-mic on. Turning it off mid-game still stops the open mic.
  await play.evaluate(() => {
    document.getElementById('autoMic').checked = false;
    try { stopRec(); } catch (_) {}
  });
  const playIdle = await play.evaluate(() => {
    const mic = document.querySelector('#mic0 .ico-mic');
    const b = mic.getBoundingClientRect();
    return {
      w: b.width, h: b.height,
      stroke: mic.querySelector('rect').getAttribute('stroke'),
      on: document.getElementById('mic0').classList.contains('on'),
      wave: getComputedStyle(document.querySelector('#half0 .play-wave')).display,
    };
  });
  if (playIdle.on || playIdle.wave !== 'none' || playIdle.w < 20 || playIdle.stroke !== '#fff') bad('play idle mic ' + JSON.stringify(playIdle));
  else ok('Play outline mic is white and the waveform is hidden until listening');
  await play.screenshot({ path: path.join(SHOTS, 'play-webkit-idle-iphone.png') });
  await play.click('#mic0');
  await play.waitForFunction(() => document.getElementById('mic0').classList.contains('on'));
  const playListen = await play.evaluate(() => {
    const wave = document.querySelector('#half0 .play-wave');
    const b = wave.getBoundingClientRect();
    return { w: b.width, h: b.height, display: getComputedStyle(wave).display, fill: wave.querySelector('circle').getAttribute('fill') };
  });
  if (playListen.display === 'none' || playListen.w < 24 || playListen.fill !== '#4060E0') bad('play waveform ' + JSON.stringify(playListen));
  else ok('Play shows the blue waveform while listening');
  await play.screenshot({ path: path.join(SHOTS, 'play-webkit-listening-iphone.png') });
  if (errors.length) bad(errors.join(';'));
} catch (err) {
  bad('webkit ' + (err && err.message || err));
} finally {
  if (browser) await browser.close();
  server.close();
}
if (problems.length) {
  console.log('\n' + problems.length + ' webkit failure(s)');
  process.exit(1);
}
console.log('\nwebkit learn checks passed');
