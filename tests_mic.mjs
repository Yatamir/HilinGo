/**
 * HilinGo v4.6 — an interruption tears speech recognition down and a new instance starts.
 *   node tests_mic.mjs
 */
import { chromium, webkit } from 'playwright-core';
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
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mp3': 'audio/mpeg', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' };
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

async function run(browser, tag) {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    class FakeAudio {
      constructor() { this.preload = ''; this.paused = true; this.currentTime = 0; }
      load() {}
      play() { return Promise.resolve(); }
      pause() {}
      addEventListener() {}
      removeEventListener() {}
    }
    window.Audio = FakeAudio;
    window.__fireIntro = (type) => {
      const el = window.__intro && window.__intro.el;
      const list = el && el._ls && el._ls[type] ? el._ls[type].slice() : [];
      list.forEach(fn => fn());
    };
    window.__intro = { el: null };
    const Orig = FakeAudio;
    window.Audio = class extends Orig {
      constructor(src) { super(); this.src = src; this._ls = {}; window.__intro.el = this; }
      addEventListener(type, fn) { (this._ls[type] ||= []).push(fn); }
      removeEventListener() {}
    };
    window.__srs = [];
    class FakeSR {
      constructor() {
        this.handlers = {};
        this.aborted = false;
        window.__srs.push(this);
      }
      set onstart(fn) { this.handlers.start = fn; }
      set onend(fn) { this.handlers.end = fn; }
      set onerror(fn) { this.handlers.error = fn; }
      set onresult(fn) { this.handlers.result = fn; }
      set onaudiostart(fn) { this.handlers.audiostart = fn; }
      set onaudioend(fn) { this.handlers.audioend = fn; }
      set onsoundstart(fn) { this.handlers.soundstart = fn; }
      set onsoundend(fn) { this.handlers.soundend = fn; }
      set onspeechstart(fn) { this.handlers.speechstart = fn; }
      set onspeechend(fn) { this.handlers.speechend = fn; }
      set onnomatch(fn) { this.handlers.nomatch = fn; }
      get onend() { return this.handlers.end || null; }
      get onerror() { return this.handlers.error || null; }
      start() {
        this.started = true;
        if (this.handlers.audiostart) this.handlers.audiostart();
        if (this.handlers.start) this.handlers.start();
      }
      stop() { this.stopped = true; }
      abort() { this.aborted = true; }
      fire(name, ev) { const fn = this.handlers[name]; if (fn) fn(ev); }
    }
    window.SpeechRecognition = FakeSR;
    window.webkitSpeechRecognition = FakeSR;
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(String(err && err.message || err)));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:${port}/index.html?ptt=0`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { document.getElementById('autoMic').checked = true; });
  await page.click('#go');
  await page.evaluate(() => window.__fireIntro('ended'));
  await page.waitForFunction(() => window.__srs.length >= 1 && window.__srs[0].started);
  const live = await page.evaluate(() => window.__srs.length);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
  });
  await page.waitForTimeout(500);
  const afterFocus = await page.evaluate(() => window.__srs.length);
  if (afterFocus !== live) bad(tag + ' focus restarted ' + live + ' -> ' + afterFocus);
  else ok(tag + ' blur and focus do not restart a live session');
  const beforeErr = live;
  await page.evaluate(() => {
    const r = window.__srs[window.__srs.length - 1];
    window.__first = r;
    r.fire('error', { error: 'audio-capture', message: 'interrupted' });
  });
  const dead = await page.evaluate(() => ({
    on: document.getElementById('mic0').classList.contains('on'),
    aborted: window.__first.aborted,
  }));
  if (dead.on || !dead.aborted) bad(tag + ' teardown ' + JSON.stringify(dead));
  else ok(tag + ' audio-capture aborts the instance and drops the listening light');
  await page.waitForFunction(n => window.__srs.length === n + 1, beforeErr);
  ok(tag + ' one fresh recognizer starts after audio-capture');
  await page.waitForTimeout(700);
  const extra = await page.evaluate(n => window.__srs.length, beforeErr);
  if (extra !== beforeErr + 1) bad(tag + ' restart loop ' + extra);
  else ok(tag + ' the error does not restart in a loop');

  await page.evaluate(() => {
    window.__vis = 'visible';
    const getter = { configurable: true, get() { return window.__vis; } };
    try { Object.defineProperty(document, 'visibilityState', getter); }
    catch (_) { try { Object.defineProperty(Document.prototype, 'visibilityState', getter); } catch (e) { window.__visErr = String(e); } }
    window.__vis = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    window.__vis = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(500);
  const afterVis = await page.evaluate(() => window.__srs.length);
  const log = await page.evaluate(() => document.getElementById('diag').textContent || '');
  if (afterVis !== beforeErr + 1 || !/skip recover, live session/.test(log)) bad(tag + ' vis ' + afterVis + ' ' + log.slice(-220));
  else ok(tag + ' returning to the page does not abort a live session');
  const heard = await page.evaluate(() => {
    const n0 = window.__srs.length;
    const r = window.__srs[n0 - 1];
    const alt = { transcript: 'אבא' };
    const res = { isFinal: false, length: 1, 0: alt };
    r.fire('result', { results: { length: 1, 0: res } });
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
    return {
      n: window.__srs.length,
      n0,
      word: document.getElementById('w0').textContent,
      heard: document.getElementById('hd0').textContent,
    };
  });
  await page.waitForTimeout(500);
  const still = await page.evaluate(() => window.__srs.length);
  if (heard.n !== heard.n0 || still !== heard.n0 || !/אבא/.test(heard.word + heard.heard)) bad(tag + ' result lost ' + JSON.stringify({ ...heard, still }));
  else ok(tag + ' a result still reaches the board, and focus does not restart');
  if (errors.length) bad(tag + ' ' + errors.join(' | '));

  if (tag === 'chromium') {
    const shot = await context.newPage();
    await shot.setViewportSize({ width: 390, height: 844 });
    await shot.goto(`http://127.0.0.1:${port}/index.html?ptt=0`, { waitUntil: 'domcontentloaded' });
    await shot.evaluate(() => { document.getElementById('autoMic').checked = false; document.getElementById('sound').checked = false; });
    await shot.click('#go');
    await shot.evaluate(() => { try { releaseIntro('ended'); } catch (_) {} });
    await shot.waitForSelector('#pt0');
    const ring = await shot.evaluate(() => getComputedStyle(document.getElementById('pt0'), '::before').content);
    if (ring && ring !== 'none') bad('timer ring ' + ring);
    else ok('countdown has no ring');
    await shot.screenshot({ path: '/opt/cursor/artifacts/v461-timer-full.png' });
    await shot.evaluate(() => { G.timeLeft = 2.2; render(); });
    const low = await shot.evaluate(() => document.getElementById('pt0').textContent);
    if (low !== '3' && low !== '2') bad('low digits ' + low);
    await shot.screenshot({ path: '/opt/cursor/artifacts/v461-timer-low.png' });
    ok('timer screenshots ' + low);
    await shot.close();
  }
  await context.close();
}

try {
  const chrome = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try { await run(chrome, 'chromium'); }
  finally { await chrome.close(); }
  try {
    const wk = await webkit.launch();
    try { await run(wk, 'webkit'); }
    finally { await wk.close(); }
  } catch (e) { bad('webkit ' + e.message); }
} finally { server.close(); }

if (problems.length) {
  console.log('\n' + problems.length + ' failure(s)');
  process.exit(1);
}
console.log('\nmic checks passed');
