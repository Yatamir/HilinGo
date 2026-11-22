/**
 * HilinGo v4.11.0 — iPad aborts the Italian challenge immediately, and
 * משחק חדש starts the same game again.
 *   node tests_ipad.mjs
 */
import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const SHOTS = process.env.SHOTS || '/opt/cursor/artifacts';
fs.mkdirSync(SHOTS, { recursive: true });
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
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: IPAD,
});
await context.addInitScript(() => {
  window.__langs = [];
  window.__aborts = 0;
  window.__say = '';
  const synth = {
    cancel(){}, resume(){}, getVoices(){ return []; },
    addEventListener(){}, removeEventListener(){},
    speak(u){ setTimeout(() => { try { if (u.onstart) u.onstart(); } catch (_) {} setTimeout(() => { try { if (u.onend) u.onend(); } catch (_) {} }, 15); }, 5); }
  };
  try { Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: synth }); }
  catch (_) { window.speechSynthesis = synth; }
  window.SpeechSynthesisUtterance = function (text) { this.text = text; this.onend = null; this.onstart = null; };
  class FakeSR {
    constructor(){ this.lang = ''; }
    start(){
      window.__langs.push(this.lang);
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

try {
  await page.goto(`http://127.0.0.1:${port}/index.html?ptt=0`, { waitUntil: 'domcontentloaded' });
  // ?ptt=0 is the test override. Reload without it so the iPad UA is classified as Safari.
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  const mode = await page.evaluate(() => ({
    ptt: PTT,
    auto: document.getElementById('autoMic').checked,
    safari: /Safari/.test(navigator.userAgent) && !/Chrome|CriOS/.test(navigator.userAgent),
  }));
  if (!mode.safari || !mode.ptt) bad('iPad not seen as Safari PTT ' + JSON.stringify(mode));
  else ok('iPad Safari is the tap-to-talk browser');
  if (!mode.auto) bad('auto-mic checkbox is off');
  else ok('auto-mic stays on without a tap');

  await page.evaluate(() => { document.getElementById('sound').checked = false; document.getElementById('n1').value = 'נועה'; document.getElementById('n2').value = 'דני'; });
  await page.click('#trLangs .opt[data-tr="it"]');
  await page.click('.lvl[data-s="30"]');
  const before = await page.evaluate(() => ({
    players: NPLAYERS, seconds, lang: LANG, tr: TR, solo: SOLO, mode: MODE,
    n1: document.getElementById('n1').value, n2: document.getElementById('n2').value,
  }));
  await page.evaluate(() => { window.__aborts = 1; window.__say = ''; window.__langs = []; });
  await page.click('#go');
  await page.waitForSelector('#half0');
  await page.evaluate(() => { try { releaseIntro('ended'); } catch (_) {} });
  await page.fill('#in0', 'כלב');
  await page.click('#send0');
  await page.waitForSelector('#trTap.live', { timeout: 8000 });
  const shown = (await page.locator('#trWord').innerText()).trim();
  await page.evaluate(w => { window.__say = w; }, shown);
  const tapAt = async () => page.evaluate(() => document.getElementById('trTap').click());
  await tapAt();
  const returned = await page.waitForSelector('#trTap.live', { timeout: 4000 }).then(() => true, async () => {
    console.log('  no return', JSON.stringify(await page.evaluate(() => ({
      langs: window.__langs, lock: trLock, fails: trTapFails,
      tail: (document.getElementById('diagText').textContent || '').slice(-240),
    }))));
    return false;
  });
  if (!returned) bad('first tap did not return the button');
  else {
    await page.waitForTimeout(500);
    await tapAt();
  }
  const heard2 = await page.waitForFunction(() => window.__langs.filter(l => l === 'it-IT').length >= 2, { timeout: 6000 }).then(() => true, async () => {
    console.log('  langs', JSON.stringify(await page.evaluate(() => window.__langs)));
    return false;
  });
  if (!heard2) bad('no second Italian start');
  const mid = await page.evaluate(() => window.__langs.slice());
  const firstHe = mid.indexOf('he-IL');
  const secondIt = mid.indexOf('it-IT', mid.indexOf('it-IT') + 1);
  if (secondIt < 0) bad('no it-IT restart ' + mid.join(','));
  else if (firstHe !== -1 && firstHe < secondIt) bad('Hebrew handoff before the Italian retry ' + mid.join(','));
  else ok('aborted it-IT restarts in it-IT before any Hebrew handoff (' + mid.join(',') + ')');
  await page.waitForSelector('#trOv.good', { timeout: 8000 });
  await page.screenshot({ path: path.join(SHOTS, 'v4102-it-ipad.png') });
  ok('Italian challenge recovered after an immediate abort');
  await page.waitForFunction(() => document.getElementById('trOv').classList.contains('hidden'));

  await page.evaluate(() => { G.winner = -1; G.reason = 'manual'; endScreen(); });
  await page.waitForSelector('#endov:not(.hidden)');
  await page.screenshot({ path: path.join(SHOTS, 'v4102-end.png') });
  await page.click('#again');
  await page.waitForFunction(() => document.getElementById('endov').classList.contains('hidden') && document.getElementById('start').classList.contains('hidden') && !document.getElementById('game').classList.contains('hidden'));
  const after = await page.evaluate(() => ({
    players: NPLAYERS, seconds, lang: LANG, tr: TR, solo: SOLO, mode: MODE,
    n1: document.getElementById('n1').value, n2: document.getElementById('n2').value,
    turn: G && G.turn, boards: G && G.boards.length,
  }));
  if (after.players !== before.players || after.seconds !== 30 || after.lang !== 'he' || after.tr !== 'it' || after.n1 !== 'נועה' || after.n2 !== 'דני' || after.boards !== 2 || after.turn !== 0) bad('settings ' + JSON.stringify({ before, after }));
  else ok('משחק חדש restarts the same game (' + after.seconds + 's, ' + after.tr + ', ' + after.n1 + ')');
  await page.evaluate(() => { try { releaseIntro('ended'); } catch (_) {} });
  await page.screenshot({ path: path.join(SHOTS, 'v4102-again.png') });

  await page.evaluate(() => { G.winner = -1; G.reason = 'manual'; endScreen(); });
  await page.click('#endClose');
  const home = await page.evaluate(() => ({
    start: !document.getElementById('start').classList.contains('hidden'),
    game: document.getElementById('game').classList.contains('hidden'),
    end: document.getElementById('endov').classList.contains('hidden'),
  }));
  if (!home.start || !home.game || !home.end) bad('home ' + JSON.stringify(home));
  else ok('✕ returns to the home screen');

  const iphone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  });
  await iphone.addInitScript(() => {
    window.__langs = [];
    window.__aborts = 99;
    window.__say = '';
    const synth = {
      speaking: false,
      cancel(){ this.speaking = false; }, resume(){}, getVoices(){ return []; },
      addEventListener(){}, removeEventListener(){},
      speak(u){ this.speaking = true; setTimeout(() => { try { if (u.onstart) u.onstart(); } catch (_) {} setTimeout(() => { this.speaking = false; try { if (u.onend) u.onend(); } catch (_) {} }, 20); }, 5); }
    };
    try { Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: synth }); }
    catch (_) { window.speechSynthesis = synth; }
    window.SpeechSynthesisUtterance = function (text) { this.text = text; this.onend = null; this.onstart = null; };
    class FakeSR {
      constructor(){ this.lang = ''; }
      start(){
        window.__langs.push(this.lang);
        const self = this;
        if (self.onstart) self.onstart();
        if (self.onaudiostart) self.onaudiostart();
        if (this.lang === 'it-IT' && window.__aborts > 0) {
          window.__aborts--;
          if (self.onerror) self.onerror({ error: 'aborted', message: '' });
          if (self.onend) self.onend();
        }
      }
      abort(){ this.onend = null; this.onerror = null; }
      stop(){ this.abort(); }
    }
    window.SpeechRecognition = FakeSR;
    window.webkitSpeechRecognition = FakeSR;
    window.Audio = class { play(){ return Promise.resolve(); } pause(){} load(){} addEventListener(){} };
  });
  const phone = await iphone.newPage();
  phone.on('pageerror', e => bad('iphone ' + e.message));
  await phone.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  const kind = await phone.evaluate(() => ({ ipad: isIPadOS(), touch: navigator.maxTouchPoints }));
  if (kind.ipad) bad('iPhone was treated as an iPad ' + JSON.stringify(kind));
  else ok('iPhone stays on the automatic mic');
  await phone.evaluate(() => { document.getElementById('sound').checked = false; });
  await phone.click('#trLangs .opt[data-tr="it"]');
  await phone.click('#go');
  await phone.waitForSelector('#half0');
  await phone.evaluate(() => { try { releaseIntro('ended'); } catch (_) {} WG.addCustomWord('כלב'); });
  await phone.waitForFunction(() => gameLangOk, { timeout: 3000 });
  const size0 = await phone.evaluate(() => G.boards[0].size);
  const mark = await phone.evaluate(() => window.__langs.length);
  await phone.fill('#in0', 'כלב');
  await phone.click('#send0');
  await phone.waitForFunction(() => window.__langs.includes('it-IT'), { timeout: 15000 });
  const added = await phone.evaluate(start => window.__langs.slice(start), mark);
  if (added[0] !== 'it-IT') bad('iPhone started ' + added.join(',') + ' instead of it-IT');
  else ok('after speech the challenge starts it-IT');
  const waited = await phone.evaluate(() => document.getElementById('trTap').classList.contains('live') && !window.__langs.includes('it-IT'));
  if (waited) bad('iPhone waited for a tap');
  else ok('iPhone started Italian without a tap');
  await phone.waitForFunction(() => {
    const ov = document.getElementById('trOv');
    return ov.classList.contains('hidden') && !trLock;
  }, { timeout: 8000 });
  const afterPhone = await phone.evaluate(() => ({
    turn: G.turn,
    size: G.boards[0].size,
    hidden: document.getElementById('trOv').classList.contains('hidden'),
  }));
  if (!afterPhone.hidden || afterPhone.size !== size0 - 1) bad('iphone resume ' + JSON.stringify(afterPhone));
  else ok('a failed iPhone challenge closes the card and the turn continues');
  await iphone.close();
} finally {
  await browser.close();
  server.close();
}
if (problems.length) { console.log('\n' + problems.length + ' failed'); process.exit(1); }
console.log('\nipad checks passed');
