/**
 * HilinGo v4.13.16 — keep the whole utterance, and do not fail an iPad challenge
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
  try { localStorage.setItem('hilingo_mic_v4111', 'auto'); } catch (_) {}
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
  if (await page.locator('#silentOk').isVisible()) await page.locator('#silentOk').click();
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
  if (await page.locator('#silentOk').isVisible()) await page.locator('#silentOk').click();
  await page.waitForSelector('#half0');
  await page.evaluate(() => { try { releaseIntro('ended'); } catch (_) {} WG.addCustomWord('כלב'); });
  await page.waitForFunction(() => gameLangOk, { timeout: 3000 });
  const sizeBefore = await page.evaluate(() => G.boards[0].size);
  await page.fill('#in0', 'כלב');
  await page.click('#send0');
  await page.waitForSelector('#trTap.live', { timeout: 15000 });
  const skipOn = await page.evaluate(() => !document.getElementById('trSkip').classList.contains('hidden'));
  if (!skipOn) bad('iPad card has no skip');
  else ok('the card has a skip button from the start');
  const beforeTap = await page.evaluate(() => window.__langs.filter(l => l === 'it-IT').length);
  if (beforeTap) bad('Italian started before the tap ' + beforeTap);
  else ok('iPad waits for a tap before opening Italian');
  await page.screenshot({ path: '/opt/cursor/artifacts/v41316-tap.png' });
  const hit = await page.evaluate(() => {
    const b = document.getElementById('trTap');
    const r = b.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const cs = getComputedStyle(b);
    return { id: el && (el.id || el.tagName), pe: cs.pointerEvents, disp: cs.display, w: Math.round(r.width) };
  });
  if (hit.id !== 'trTap' || hit.pe === 'none' || hit.disp === 'none' || hit.w < 40) bad('speak button is not under the finger ' + JSON.stringify(hit));
  else ok('a finger lands on the speak button');
  const box = await page.locator('#trTap').boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  const tapped = await page.waitForFunction(() => window.__langs.filter(l => l === 'it-IT').length >= 1, { timeout: 4000 }).then(() => true, async () => {
    console.log('  tap miss', JSON.stringify(await page.evaluate(() => ({
      langs: window.__langs,
      on: typeof document.getElementById('trTap').ontouchend,
      tail: (document.getElementById('diagText').textContent || '').slice(-220),
    }))));
    return false;
  });
  if (!tapped) bad('touch did not start Italian');
  const back = await page.waitForSelector('#trTap.live', { timeout: 4000 }).then(() => true, async () => {
    console.log('  no button', JSON.stringify(await page.evaluate(() => ({
      lock: trLock, phase: trPhase, fails: trTapFails,
      cls: document.getElementById('trTap').className,
      ov: document.getElementById('trOv').className,
      langs: window.__langs,
      tail: (document.getElementById('diagText').textContent || '').slice(-300),
    }))));
    return false;
  });
  if (!back) bad('speak button did not return after the abort');
  const starts = await page.evaluate(() => window.__langs.filter(l => l === 'it-IT' || l === 'it' || l === 'it-CH').length);
  if (starts !== 1) bad('abort started again without a tap ' + starts);
  else ok('an abort does not start again until the next tap');
  const failed = await page.evaluate(() => document.getElementById('trOv').classList.contains('bad') || !trLock);
  if (failed) bad('a dead mic ended the turn');
  else ok('a mic that aborts is not a miss');
  const fresh = await page.evaluate(() => ({ built: window.__built, log: (document.getElementById('diag') && document.getElementById('diag').textContent) || '' }));
  if (fresh.built < 2) bad('recognizers created ' + fresh.built);
  else ok('the tap started a fresh recognizer (' + fresh.built + ')');
  await page.evaluate(() => document.getElementById('trTap').click());
  await page.waitForFunction(() => !trLock, { timeout: 4000 });
  const sizeAfter = await page.evaluate(() => G.boards[0].size);
  if (sizeAfter !== sizeBefore - 1) bad('penalty ' + sizeBefore + ' -> ' + sizeAfter);
  else ok('two failed taps close the card with no extra penalty');

  await page.goto(`http://127.0.0.1:${port}/index.html?ptt=0`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { document.getElementById('sound').checked = false; window.__muteOnce = true; window.__muted = false; window.__langs = []; window.__times = []; });
  await page.click('#go');
  if (await page.locator('#silentOk').isVisible()) await page.locator('#silentOk').click();
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
  if (await page.locator('#silentOk').isVisible()) await page.locator('#silentOk').click();
  await page.waitForSelector('#half0');
  await page.evaluate(() => { try { releaseIntro('ended'); } catch (_) {} WG.addCustomWord('כלב'); });
  await page.fill('#in0', 'כלב');
  await page.click('#send0');
  await page.waitForSelector('#trTap.live', { timeout: 15000 });
  const armed = await page.evaluate(() => window.__langs.filter(l => l === 'it-IT').length);
  if (armed) bad('watchdog saw a start before the tap');
  await page.evaluate(() => { armChallengeMic('watchdog'); armChallengeMic('watchdog'); });
  await page.evaluate(() => document.getElementById('trTap').click());
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
  await page.screenshot({ path: '/opt/cursor/artifacts/v41316-listening.png' });

  await page.goto(`http://127.0.0.1:${port}/mictest.html`, { waitUntil: 'domcontentloaded' });
  const info = await page.locator('#info').innerText();
  if (!info.includes('display-mode:') || !info.includes('languages:') || !info.toLowerCase().includes('ipad')) bad('mictest info ' + info.slice(0, 160));
  else ok('mictest shows display-mode, languages, and the user agent');
  const buttons = await page.locator('button').allInnerTexts();
  if (!buttons.some(t => t.includes('1. tap fresh it-IT')) || !buttons.some(t => t.includes('4. he-IL stop')) || !buttons.some(t => t.includes('6. TTS it-IT'))) bad('mictest buttons ' + buttons.join(' | '));
  else ok('mictest has the six isolate buttons');
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
