/**
 * HilinGo v4.13.6 — the learning target mic starts like the game translation tap.
 *   node tests_learntap.mjs
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
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.mp3': 'audio/mpeg' };
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
  try { localStorage.setItem('hilingo_mic_v4111', 'tap'); } catch (_) {}
  window.__intro = { plays: 0 };
  window.__srStarts = 0;
  window.__srLangs = [];
  window.__srs = [];
  window.__silent = [];
  class FakeAudio {
    constructor(src) { this.src = src || ''; this._ls = {}; window.__audios = window.__audios || []; window.__audios.push(this); }
    set src(v) { this._src = String(v || ''); if (/hilingo/.test(this._src)) window.__intro.el = this; }
    get src() { return this._src || ''; }
    load() { this._loaded = true; }
    removeAttribute(name) { if (name === 'src') { this._src = ''; this._removed = true; } }
    pause() { this.paused = true; }
    play() {
      window.__silent.push(this._src.slice(0, 24));
      if (/hilingo/.test(this._src || '')) { window.__intro.plays++; window.__intro.el = this; }
      return Promise.resolve();
    }
    addEventListener(type, fn) { (this._ls[type] ||= []).push(fn); }
    removeEventListener() {}
  }
  window.Audio = FakeAudio;
  window.__fireIntro = (type) => {
    const el = window.__intro.el;
    ((el && el._ls && el._ls[type]) || []).slice().forEach(fn => fn());
  };
  class FakeSR {
    start() {
      window.__srStarts++;
      window.__srLangs.push(this.lang);
      window.__srs.push(this);
      if (this.onstart) this.onstart();
      if (this.onaudiostart) this.onaudiostart();
    }
    stop() { if (this.onend) this.onend(); }
    abort() {}
  }
  window.SpeechRecognition = FakeSR;
  window.webkitSpeechRecognition = FakeSR;
  window.SpeechSynthesisUtterance = class { constructor(text){ this.text = text; this.lang = ''; this.onend = null; this.onstart = null; } };
  const synth = {
    getVoices() { return [{ lang: 'pt-BR', name: 'Brazilian' }, { lang: 'he-IL', name: 'Hebrew' }]; },
    cancel() {}, resume() {}, addEventListener() {},
    speak(u) {
      window.__spoken = u.text + '/' + u.lang;
      u.__at = performance.now();
      if (u.onstart) u.onstart();
    },
  };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, get() { return synth; } });
  window.__endSpeech = () => {
    const u = window.__lastUtt;
    // The page keeps the utterance on ttsHold. End whichever is current.
  };
  window.__emit = (text) => {
    const sr = window.__srs[window.__srs.length - 1];
    const res = { isFinal: false, length: 1, 0: { transcript: text } };
    sr.onresult({ results: { length: 1, 0: res } });
  };
});
const page = await context.newPage();
page.on('pageerror', e => bad('page ' + e.message));

try {
  await page.goto(`http://127.0.0.1:${port}/index.html?ptt=1&ios=0`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const orig = window.speechSynthesis.speak;
    window.speechSynthesis.speak = (u) => { window.__lastUtt = u; return orig(u); };
  });
  await page.click('#modeLearn');
  await page.click('#learnTargets .opt[data-lang="it"]');
  await page.click('#go');
  await page.evaluate(() => window.__fireIntro('ended'));
  await page.waitForFunction(() => document.getElementById('learn').dataset.state === 'IDLE_NATIVE');
  await page.click('#learnMic');
  await page.waitForFunction(() => window.__srLangs.at(-1) === 'he-IL');
  await page.evaluate(() => window.__emit('כלב'));
  await page.waitForFunction(() => document.getElementById('learnOtherWord').textContent.includes('cane'));
  await page.waitForFunction(() => (document.getElementById('diagText').textContent || '').includes('silent-audio play ok'));
  const during = await page.evaluate(() => ({
    sr: window.__srStarts,
    it: window.__srLangs.includes('it-IT'),
  }));
  if (during.sr !== 1 || during.it) bad('mic opened during speech ' + JSON.stringify(during));
  else ok('the target mic stays closed while the word is spoken');
  await page.evaluate(() => {
    const u = window.__lastUtt;
    const wait = Math.max(0, 120 - (performance.now() - (u && u.__at || 0)));
    setTimeout(() => { if (u && u.onend) u.onend(); }, wait);
  });
  await page.waitForFunction(() => document.getElementById('learn').dataset.state === 'IDLE_TARGET');
  const idle = await page.evaluate(() => ({
    sr: window.__srStarts,
    it: window.__srLangs.includes('it-IT'),
    log: document.getElementById('diagText').textContent || '',
  }));
  if (idle.sr !== 1 || idle.it || !idle.log.includes('silent-audio off') || !idle.log.includes('rec ended before tts=yes')) bad('after speech ' + JSON.stringify(idle).slice(0, 500));
  else ok('speech ends after the recognizer, the silent clip is destroyed, and Italian has not started');
  const offAt = idle.log.indexOf('silent-audio off');
  const onAt = idle.log.indexOf('silent-audio play ok');
  if (onAt < 0 || offAt < onAt) bad('silent order ' + idle.log.slice(-300));
  else ok('silent-audio turns on before it turns off');
  await page.click('#learnRepeatMic');
  await page.waitForFunction(() => window.__srLangs.includes('it-IT'));
  const tap = await page.evaluate(() => ({
    lang: window.__srLangs.at(-1),
    state: document.getElementById('learn').dataset.state,
    on: document.getElementById('learnRepeatMic').classList.contains('on'),
    log: document.getElementById('diagText').textContent || '',
  }));
  const startAt = tap.log.indexOf('tr start new it-IT');
  const freshAt = tap.log.indexOf('tr fresh it-IT not reuse');
  if (tap.lang !== 'it-IT' || tap.state !== 'LISTEN_TARGET' || !tap.on) bad('listen ' + JSON.stringify(tap).slice(0, 400));
  else ok('the repeat tap is listening in Italian');
  if (freshAt < 0 || startAt < freshAt || tap.log.includes('wait 450ms') || tap.log.includes('release audio')) bad('tap log ' + tap.log.slice(-400));
  else ok('the start is the translation tap, with no 450ms wait and no audio release');
  if (tap.log.indexOf('silent-audio off') > startAt) bad('silent clip still up at start');
  else ok('the silent clip is off before the recognizer starts');
} finally {
  await browser.close();
  server.close();
}
if (problems.length) {
  console.log('\n' + problems.length + ' failure(s)');
  process.exit(1);
}
console.log('\nlearn tap checks passed');
