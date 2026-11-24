/**
 * HilinGo v4.13.12 — iPad aborts the Italian challenge immediately, and
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

async function checkSplit(p, tag){
  await p.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await p.click('#micTap');
  await p.evaluate(() => {
    document.getElementById('sound').checked = false;
    window.__aborts = 0;
    window.__speaks = [];
    const s = window.speechSynthesis;
    if (s && !s.__wrapped) {
      const orig = s.speak.bind(s);
      s.speak = u => { window.__speaks.push(String(u && u.text || '')); return orig(u); };
      s.__wrapped = true;
    }
  });
  await p.click('#trLangs .opt[data-tr="it"]');
  await p.click('#go');
  if (await p.locator('#silentOk').isVisible()) await p.locator('#silentOk').click();
  await p.waitForSelector('#half0');
  await p.evaluate(() => { try { releaseIntro('ended'); } catch (_) {} WG.addCustomWord('כלב'); });
  await p.fill('#in0', 'כלב');
  await p.click('#send0');
  await p.waitForSelector('#trTap.live', { timeout: 8000 });
  const ghost = await p.evaluate(() => {
    window.__speaks = [];
    window.__langs = window.__langs.filter(l => l !== 'it-IT');
    const tap = document.getElementById('trTap');
    const replay = document.getElementById('trReplay');
    const opts = { bubbles: true, cancelable: true, pointerId: 1 };
    tap.dispatchEvent(new PointerEvent('pointerdown', opts));
    tap.dispatchEvent(new PointerEvent('pointerup', opts));
    replay.dispatchEvent(new MouseEvent('click', opts));
    const log = (document.getElementById('diagText') && document.getElementById('diagText').textContent) || '';
    return {
      it: window.__langs.filter(l => l === 'it-IT').length,
      speaks: window.__speaks.filter(t => t.trim()),
      mic: log.includes('tr mic tap'),
      replay: log.includes('tr replay tap'),
    };
  });
  if (ghost.it < 1 || ghost.speaks.length || !ghost.mic || ghost.replay) bad(tag + ' ghost ' + JSON.stringify(ghost));
  else ok(tag + ' mic tap listens and a leftover click does not speak');
  await p.evaluate(() => {
    window.__speaks = [];
    const replay = document.getElementById('trReplay');
    const opts = { bubbles: true, cancelable: true, pointerId: 1 };
    replay.dispatchEvent(new PointerEvent('pointerdown', opts));
    replay.dispatchEvent(new PointerEvent('pointerup', opts));
  });
  const heard = await p.waitForFunction(() => {
    if (window.__speaks.some(t => t && t.trim() && t.trim() !== ' ')) return true;
    const log = (document.getElementById('diagText') && document.getElementById('diagText').textContent) || '';
    return log.includes('tr replay tap') && log.includes('tts start audio-only');
  }, { timeout: 3000 }).then(() => true, () => false);
  const replayLog = await p.evaluate(() => (document.getElementById('diagText') && document.getElementById('diagText').textContent) || '');
  if (!heard || !replayLog.includes('tr replay tap')) bad(tag + ' replay ' + JSON.stringify({ heard, log: replayLog.slice(-180) }));
  else ok(tag + ' שמע שוב speaks from its own button');
}

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
  if (mode.auto) bad('tap is not the default');
  else ok('tap is the default');

  await page.evaluate(() => { document.getElementById('sound').checked = false; document.getElementById('n1').value = 'נועה'; document.getElementById('n2').value = 'דני'; });
  await page.click('#trLangs .opt[data-tr="it"]');
  await page.click('.lvl[data-s="30"]');
  const before = await page.evaluate(() => ({
    players: NPLAYERS, seconds, lang: LANG, tr: TR, solo: SOLO, mode: MODE,
    n1: document.getElementById('n1').value, n2: document.getElementById('n2').value,
  }));
  await page.evaluate(() => { window.__aborts = 1; window.__say = ''; window.__langs = []; });
  await page.click('#go');
  if (await page.locator('#silentOk').isVisible()) await page.locator('#silentOk').click();
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
  if (await phone.locator('#silentOk').isVisible()) await phone.locator('#silentOk').click();
  await phone.waitForSelector('#half0');
  await phone.evaluate(() => { try { releaseIntro('ended'); } catch (_) {} });
  const idle = await phone.evaluate(() => ({
    on: document.getElementById('mic0').classList.contains('on'),
    label: document.getElementById('mic0').innerText.replace(/\s+/g, ' ').trim(),
    left: G.timeLeft,
  }));
  await phone.waitForTimeout(700);
  const later = await phone.evaluate(() => ({ left: G.timeLeft, starts: window.__langs.length }));
  if (idle.on || !idle.label.includes('לחצו ודברו') || later.starts) bad('idle mic ' + JSON.stringify({ idle, later }));
  else ok('the mic stays idle until a tap');
  if (later.left > idle.left - 0.4) bad('clock held ' + idle.left + ' -> ' + later.left);
  else ok('the clock runs before the tap');
  await phone.click('#mic0');
  await phone.waitForFunction(() => document.getElementById('mic0').classList.contains('on'));
  const listening = await phone.evaluate(() => document.getElementById('mic0').innerText.replace(/\s+/g, ' ').trim());
  if (!listening.includes('אני מקשיב')) bad('listening label ' + listening);
  else ok('the button says אני מקשיב');
  await phone.waitForFunction(() => window.__langs.length >= 1);
  const one = await phone.evaluate(() => window.__langs.length);
  await phone.click('#mic0');
  await phone.waitForFunction(() => !document.getElementById('mic0').classList.contains('on'));
  await phone.waitForTimeout(400);
  const cancelled = await phone.evaluate(() => window.__langs.length);
  if (cancelled !== one) bad('cancel restarted ' + one + ' -> ' + cancelled);
  else ok('a second tap cancels and does not restart');
  await phone.evaluate(() => { WG.addCustomWord('כלב'); });
  await phone.fill('#in0', 'כלב');
  await phone.click('#send0');
  await phone.waitForSelector('#trTap.live', { timeout: 8000 });
  const replay = await phone.locator('#trReplay').isVisible();
  const early = await phone.evaluate(() => window.__langs.filter(l => l === 'it-IT').length);
  if (!replay || early) bad('tap card ' + JSON.stringify({ replay, early }));
  else ok('iPhone tap mode waits, and שמע שוב is there');
  await phone.click('#trTap');
  await phone.waitForFunction(() => window.__langs.includes('it-IT'), { timeout: 6000 });
  ok('the translation tap starts Italian');
  await phone.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await phone.evaluate(() => { document.getElementById('sound').checked = false; window.__langs = []; window.__aborts = 99; });
  await phone.click('#micAuto');
  await phone.click('#trLangs .opt[data-tr="it"]');
  await phone.click('#go');
  if (await phone.locator('#silentOk').isVisible()) await phone.locator('#silentOk').click();
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

  await checkSplit(page, 'iPad');
  const phone2 = await iphone.newPage();
  phone2.on('pageerror', e => bad('iphone split ' + e.message));
  await checkSplit(phone2, 'iPhone');
  await iphone.close();
} finally {
  await browser.close();
  server.close();
}
if (problems.length) { console.log('\n' + problems.length + ' failed'); process.exit(1); }
console.log('\nipad checks passed');
