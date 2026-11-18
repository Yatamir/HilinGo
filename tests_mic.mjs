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
  await page.goto(`http://127.0.0.1:${port}/index.html?ptt=0`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { document.getElementById('autoMic').checked = true; });
  await page.click('#go');
  await page.evaluate(() => window.__fireIntro('ended'));
  await page.waitForFunction(() => window.__srs.length >= 1 && window.__srs[0].started);
  const first = await page.evaluate(() => window.__srs.length);
  await page.evaluate(() => {
    const r = window.__srs[window.__srs.length - 1];
    window.__first = r;
    r.fire('error', { error: 'audio-capture', message: 'interrupted' });
  });
  const dead = await page.evaluate(() => ({
    on: document.getElementById('mic0').classList.contains('on'),
    nulled: window.__first.onend === null && window.__first.onerror === null,
    aborted: window.__first.aborted,
  }));
  if (dead.on || !dead.nulled || !dead.aborted) bad(tag + ' teardown ' + JSON.stringify(dead));
  else ok(tag + ' audio-capture aborts the instance and drops the listening light');
  await page.waitForFunction(n => window.__srs.length > n, first);
  const afterErr = await page.evaluate(() => window.__srs.length);
  if (afterErr <= first) bad(tag + ' no new recognizer after audio-capture');
  else ok(tag + ' a fresh recognizer starts after audio-capture');

  const beforeEnd = afterErr;
  await page.evaluate(() => {
    const r = window.__srs[window.__srs.length - 1];
    window.__second = r;
    r.fire('end');
  });
  await page.waitForFunction(n => window.__srs.length > n, beforeEnd);
  ok(tag + ' onend creates another recognizer');

  const beforeVis = await page.evaluate(() => window.__srs.length);
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(n => window.__srs.length > n, beforeVis);
  const log = await page.evaluate(() => document.getElementById('diag').textContent || '');
  if (!/interrupt|restart|recover/.test(log)) bad(tag + ' log ' + log.slice(-180));
  else ok(tag + ' visibilitychange is logged and recreates recognition');

  const beforeTap = await page.evaluate(() => window.__srs.length);
  await page.click('#mic0');
  const afterTap = await page.evaluate(() => window.__srs.length);
  if (afterTap <= beforeTap) bad(tag + ' mic tap did not reset');
  else ok(tag + ' mic tap forces a new recognizer');
  if (errors.length) bad(tag + ' ' + errors.join(' | '));
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
