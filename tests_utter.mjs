/**
 * HilinGo v4.10.5 — keep the whole utterance, and do not fail an iPad challenge
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
    constructor(){ this.lang = ''; window.__built = (window.__built || 0) + 1; }
    start(){
      window.__langs.push(this.lang);
      window.__times.push(performance.now());
      window.__game = this;
      const self = this;
      const abort = /^(it-IT|it|it-CH)$/.test(this.lang) && window.__aborts > 0;
      if (!abort && this.lang === 'he-IL' && window.__muteOnce && !window.__muted) {
        window.__muted = true;
        if (self.onstart) self.onstart();
        if (self.onaudiostart) self.onaudiostart();
        if (self.onerror) self.onerror({ error: 'audio-capture', message: 'Source is muted' });
        if (self.onend) self.onend();
        return;
      }
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
  await page.evaluate(() => { const r = window.__game; if (r && r.onend) setTimeout(() => r.onend(), 100); });
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
  await page.waitForFunction(() => gameLangOk, { timeout: 3000 });
  const sizeBefore = await page.evaluate(() => G.boards[0].size);
  await page.fill('#in0', 'כלב');
  await page.click('#send0');
  await page.waitForFunction(() => window.__langs.filter(l => l === 'it-IT').length >= 2, { timeout: 8000 });
  const gaps = await page.evaluate(() => {
    const ix = [];
    window.__langs.forEach((l, i) => { if (l === 'it-IT') ix.push(window.__times[i]); });
    return ix.slice(0, 3).map((t, i, a) => i ? Math.round(t - a[i - 1]) : 0);
  });
  console.log('  it-IT gaps', gaps.join(',') || 'one start');
  ok('it-IT attempts stayed single-file');
  const heMid = await page.evaluate(() => {
    const langs = window.__langs;
    const first = langs.findIndex(l => l === 'it-IT' || l === 'it' || l === 'it-CH');
    const last = Math.max(langs.lastIndexOf('it-IT'), langs.lastIndexOf('it'), langs.lastIndexOf('it-CH'));
    return langs.slice(first, last).includes('he-IL');
  });
  if (heMid) bad('handed off to Hebrew while still retrying Italian');
  else ok('no Hebrew handoff during the Italian retries');
  await page.waitForFunction(() => {
    const ask = document.getElementById('trAsk').textContent || '';
    return ask.includes('איטלקית') || ask.includes('מיקרופון') || ask.includes('Mic');
  }, { timeout: 20000 });
  const failed = await page.evaluate(() => document.getElementById('trOv').classList.contains('bad'));
  if (failed) bad('a dead mic was scored as a miss');
  else ok('a mic that never listens is not a miss');
  const retryShown = await page.evaluate(() => !document.getElementById('trRetry').classList.contains('hidden'));
  if (!retryShown) bad('notice has no tap-to-retry mic');
  else ok('the notice offers a tap to try the mic');
  await page.screenshot({ path: '/opt/cursor/artifacts/v4105-retry.png' });
  const savedOnce = await page.evaluate(() => sessionStorage.getItem('hilingo_nospeech_it'));
  if (savedOnce) bad('Italian was skipped after one challenge');
  else ok('one failed challenge does not skip the language');
  const built = await page.evaluate(() => window.__built);
  if (built !== 1) bad('recognizers created ' + built);
  else ok('the challenge reused the one game recognizer');
  await page.waitForFunction(() => !trLock, { timeout: 9000 });
  const sizeAfter = await page.evaluate(() => G.boards[0].size);
  if (sizeAfter !== sizeBefore - 1) bad('penalty ' + sizeBefore + ' -> ' + sizeAfter);
  else ok('the turn passed with no extra penalty');
  const starts = await page.evaluate(() => window.__langs.filter(l => l==='it-IT' || l==='it' || l==='it-CH').length);
  if (starts > 3) bad('too many starts ' + starts);
  else ok('at most 3 recognition starts (' + starts + ')');
  await page.evaluate(() => { WG.addCustomWord('בית'); });
  await page.waitForFunction(() => G.turn === 1, { timeout: 4000 });
  await page.fill('#in1', 'בית');
  await page.click('#send1');
  await page.waitForFunction(() => sessionStorage.getItem('hilingo_nospeech_it') === '1', { timeout: 20000 });
  ok('a second failed challenge skips Italian for this launch');

  await page.goto(`http://127.0.0.1:${port}/index.html?ptt=0`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { document.getElementById('sound').checked = false; window.__muteOnce = true; window.__muted = false; window.__langs = []; window.__times = []; });
  await page.click('#go');
  await page.waitForSelector('#half0');
  await page.evaluate(() => { try { releaseIntro('ended'); } catch (_) {} });
  const heardMic = await page.waitForFunction(() => window.__langs.filter(l => l === 'he-IL').length >= 2, { timeout: 5000 }).then(() => true, async () => {
    console.log('  mute langs', JSON.stringify(await page.evaluate(() => window.__langs)));
    return false;
  });
  if (!heardMic) { bad('muted mic did not restart'); } else {
  const muteGap = await page.evaluate(() => {
    const ts = [];
    window.__langs.forEach((l, i) => { if (l === 'he-IL') ts.push(window.__times[i]); });
    return Math.round(ts[1] - ts[0]);
  });
  if (muteGap < 700) bad('muted restart gap ' + muteGap);
  else ok('muted audio-capture restarts after ' + muteGap + 'ms');
  }

  await page.goto(`http://127.0.0.1:${port}/index.html?ptt=0`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    document.getElementById('sound').checked = false;
    window.__aborts = 0; window.__say = ''; window.__langs = []; window.__times = [];
  });
  await page.click('#trLangs .opt[data-tr="it"]');
  await page.click('#go');
  await page.waitForSelector('#half0');
  await page.evaluate(() => { try { releaseIntro('ended'); } catch (_) {} WG.addCustomWord('כלב'); });
  await page.fill('#in0', 'כלב');
  await page.click('#send0');
  await page.waitForFunction(() => trPhase === 'arming' || trRestartT, { timeout: 4000 });
  await page.evaluate(() => { armChallengeMic('watchdog'); armChallengeMic('watchdog'); });
  await page.waitForSelector('#trOv:not(.hidden)');
  const shown = (await page.locator('#trWord').innerText()).trim();
  await page.evaluate(w => { window.__say = w; }, shown);
  await page.waitForTimeout(1200);
  const burst = await page.evaluate(() => {
    const its = [];
    window.__langs.forEach((l, i) => { if (l === 'it-IT') its.push(window.__times[i]); });
    let close = 0;
    for (let i = 1; i < its.length; i++) if (its[i] - its[i - 1] < 80) close++;
    return { n: its.length, close };
  });
  if (burst.close) bad('two Italian starts in the same moment ' + JSON.stringify(burst));
  else ok('watchdog did not start a second recognizer (' + burst.n + ')');
  const micOn = await page.evaluate(() => document.getElementById('trMic').classList.contains('on'));
  if (!micOn) bad('translation card has no listening mic');
  else ok('the translation card shows a listening mic');
  await page.screenshot({ path: '/opt/cursor/artifacts/v4105-listening.png' });

  await page.goto(`http://127.0.0.1:${port}/mictest.html`, { waitUntil: 'domcontentloaded' });
  const info = await page.locator('#info').innerText();
  if (!info.includes('languages:') || !info.toLowerCase().includes('ipad')) bad('mictest info ' + info.slice(0, 120));
  else ok('mictest shows languages and the user agent');
  await page.click('#langs button:nth-of-type(1)');
  await page.waitForFunction(() => document.getElementById('log').textContent.includes('call start() he-IL'));
  await page.click('#esShort');
  await page.waitForFunction(() => {
    const t = document.getElementById('log').textContent;
    return t.includes('new instance es') && t.includes('call start() es ');
  });
  await page.click('#reuse');
  await page.waitForFunction(() => document.getElementById('log').textContent.includes('new instance for reuse'));
  await page.click('#reuse');
  await page.waitForFunction(() => document.getElementById('log').textContent.includes('reuse'));
  const builtPage = await page.evaluate(() => window.__built);
  if (builtPage < 2) bad('mictest built ' + builtPage);
  else ok('mictest fresh buttons make new recognizers and reuse keeps one');
  await page.click('#copy');
  ok('mictest has a copy button');
} finally {
  await browser.close();
  server.close();
}
if (problems.length) { console.log('\n' + problems.length + ' failed'); process.exit(1); }
console.log('\nutterance checks passed');
