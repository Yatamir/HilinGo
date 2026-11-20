/**
 * HilinGo v4.10.3 — keep the whole utterance, and do not fail an iPad challenge
 * that never manages to listen.
 *   node tests_utter.mjs
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
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';

function serve(root) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.mp3': 'audio/mpeg', '.png': 'image/png' };
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
const context = await browser.newContext({
  viewport: { width: 820, height: 1180 },
  userAgent: IPAD,
  isMobile: true,
  hasTouch: true,
});
await context.addInitScript(() => {
  window.__langs = [];
  window.__times = [];
  window.__aborts = 0;
  window.__say = '';
  window.__game = null;
  const synth = {
    speaking: false,
    cancel(){ this.speaking = false; },
    resume(){},
    getVoices(){ return []; },
    addEventListener(){}, removeEventListener(){},
    speak(u){
      this.speaking = true;
      setTimeout(() => {
        try { if (u.onstart) u.onstart(); } catch (_) {}
        setTimeout(() => { this.speaking = false; try { if (u.onend) u.onend(); } catch (_) {} }, 30);
      }, 10);
    }
  };
  try { Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: synth }); }
  catch (_) { window.speechSynthesis = synth; }
  window.SpeechSynthesisUtterance = function (t) { this.text = t; this.onend = null; this.onstart = null; this.onerror = null; };
  class FakeSR {
    constructor(){ this.lang = ''; }
    start(){
      window.__langs.push(this.lang);
      window.__times.push(performance.now());
      window.__game = this;
      const self = this;
      const abort = this.lang === 'it-IT' && window.__aborts > 0;
      if (abort) window.__aborts--;
      if (self.onstart) self.onstart();
      if (self.onaudiostart) self.onaudiostart();
      if (abort) {
        if (self.onerror) self.onerror({ error: 'aborted' });
        if (self.onend) self.onend();
        return;
      }
      const text = window.__say || '';
      if (text && this.lang === 'it-IT' && self.onresult) {
        const item = { isFinal: true, length: 1, 0: { transcript: text } };
        self.onresult({ results: { length: 1, 0: item } });
      }
    }
    abort(){ this.onend = null; this.onerror = null; }
    stop(){ this.abort(); }
  }
  window.SpeechRecognition = FakeSR;
  window.webkitSpeechRecognition = FakeSR;
  window.Audio = class { play(){ return Promise.resolve(); } pause(){} load(){} addEventListener(){} };
});
const page = await context.newPage();
page.on('pageerror', e => bad('page ' + e.message));

function fire(text, final) {
  return page.evaluate(({ text, final }) => {
    const r = window.__game;
    if (!r || !r.onresult) return false;
    const item = { isFinal: !!final, length: 1, 0: { transcript: text } };
    r.onresult({ results: { length: 1, 0: item } });
    return true;
  }, { text, final });
}

try {
  await page.goto(`http://127.0.0.1:${port}/index.html?ptt=0`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { document.getElementById('sound').checked = false; });
  await page.click('#go');
  await page.waitForSelector('#half0');
  await page.evaluate(() => { try { releaseIntro('ended'); } catch (_) {} });
  await page.waitForFunction(() => window.__game && window.__game.lang === 'he-IL');
  await page.evaluate(() => { ['די', 'דינו', 'דינוזאור'].forEach(w => WG.addCustomWord(w)); });
  await fire('די', true);
  await page.waitForTimeout(200);
  await fire('דינו', true);
  await page.waitForTimeout(200);
  await fire('דינוזאור', true);
  const early = await page.evaluate(() => document.getElementById('history').textContent);
  if (early.includes('דינוזאור') || (early.includes('די') && !early.includes('דינו'))) bad('committed too early: ' + early);
  else ok('did not commit the short prefix');
  await page.waitForFunction(() => (document.getElementById('history').textContent || '').includes('דינוזאור'), { timeout: 4000 });
  const hist = await page.evaluate(() => document.getElementById('history').textContent);
  if (!hist.includes('דינוזאור') || /\bדי\b/.test(hist)) bad('history ' + hist);
  else ok('accepted דינוזאור, not די');

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { document.getElementById('sound').checked = false; window.__aborts = 99; window.__langs = []; window.__times = []; });
  await page.click('#trLangs .opt[data-tr="it"]');
  await page.click('#go');
  await page.waitForSelector('#half0');
  await page.evaluate(() => { try { releaseIntro('ended'); } catch (_) {} WG.addCustomWord('כלב'); });
  const sizeBefore = await page.evaluate(() => G.boards[0].size);
  await page.fill('#in0', 'כלב');
  await page.click('#send0');
  await page.waitForFunction(() => window.__langs.filter(l => l === 'it-IT').length >= 2, { timeout: 8000 });
  const gaps = await page.evaluate(() => {
    const ix = [];
    window.__langs.forEach((l, i) => { if (l === 'it-IT') ix.push(window.__times[i]); });
    return ix.slice(0, 3).map((t, i, a) => i ? Math.round(t - a[i - 1]) : 0);
  });
  console.log('  gaps', gaps.join(','));
  if (gaps.length < 2 || gaps[1] < 400) bad('retry gap ' + gaps.join(','));
  else ok('second it-IT start waited ' + gaps[1] + 'ms');
  const heEarly = await page.evaluate(() => {
    const i = window.__langs.indexOf('he-IL');
    const its = window.__langs.filter(l => l === 'it-IT').length;
    return i !== -1 && i < window.__langs.lastIndexOf('it-IT');
  });
  if (heEarly) bad('handed off to Hebrew while still retrying Italian');
  else ok('no Hebrew handoff during the Italian retries');
  await page.waitForFunction(() => {
    const ask = document.getElementById('trAsk').textContent || '';
    return ask.includes('מיקרופון') || ask.includes('Mic');
  }, { timeout: 12000 });
  const failed = await page.evaluate(() => document.getElementById('trOv').classList.contains('bad'));
  if (failed) bad('a dead mic was scored as a miss');
  else ok('a mic that never listens is not a miss');
  await page.waitForFunction(() => !trLock, { timeout: 4000 });
  const sizeAfter = await page.evaluate(() => G.boards[0].size);
  if (sizeAfter !== sizeBefore - 1) bad('penalty ' + sizeBefore + ' -> ' + sizeAfter);
  else ok('the turn passed with no extra penalty');
} finally {
  await browser.close();
  server.close();
}
if (problems.length) { console.log('\n' + problems.length + ' failed'); process.exit(1); }
console.log('\nutterance checks passed');
