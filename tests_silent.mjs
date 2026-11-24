/**
 * HilinGo v4.13.12 — silent-switch hint, and the Safari audio session around speech and the mic.
 *   node tests_silent.mjs
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

try {
  {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/index.html?ptt=0&ios=0`, { waitUntil: 'domcontentloaded' });
    const desk = await page.evaluate(() => ({
      hint: document.getElementById('silentHint').classList.contains('hidden'),
      card: document.getElementById('silentOv').classList.contains('hidden'),
      rules: document.getElementById('rules').textContent.includes('כבו את המצב השקט'),
      log: document.getElementById('diagText').textContent,
    }));
    if (!desk.hint || !desk.card || !desk.rules) bad('desktop hint ' + JSON.stringify(desk));
    else ok('desktop hides the hint and the card, and the Hebrew rules mention silent mode');
    if (!desk.log.includes('audioSession none')) bad('missing api log ' + desk.log.slice(0, 180));
    else ok('the mic log says audioSession none when the API is missing');
    await page.click('#go');
    const card = await page.evaluate(() => document.getElementById('silentOv').classList.contains('hidden'));
    if (!card) bad('desktop showed the card');
    else ok('starting a game on desktop does not show the reminder');
    await page.close();
  }

  {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/index.html?ptt=0&ios=1`, { waitUntil: 'domcontentloaded' });
    const he = await page.evaluate(() => ({
      hidden: document.getElementById('silentHint').classList.contains('hidden'),
      text: document.getElementById('silentHint').textContent,
    }));
    if (he.hidden || he.text !== '🔔 כבו את המצב השקט בטלפון כדי לשמוע ולדבר') bad('ios hint ' + JSON.stringify(he));
    else ok('iOS home screen shows the Hebrew silent-mode hint');
    await page.click('#langs .opt[data-lang="en"]');
    const en = await page.evaluate(() => ({
      hint: document.getElementById('silentHint').textContent,
      rules: document.getElementById('rules').textContent.includes('Turn off silent mode'),
    }));
    if (!en.hint.includes('Turn off silent mode') || !en.rules) bad('en hint ' + JSON.stringify(en));
    else ok('English hint and rules say to turn off silent mode');
    await page.click('#modeLearn');
    await page.click('#go');
    const shown = await page.evaluate(() => ({
      hidden: document.getElementById('silentOv').classList.contains('hidden'),
      text: document.getElementById('silentText').textContent,
      ok: document.getElementById('silentOk').textContent,
    }));
    if (shown.hidden || !shown.text.includes('Turn off silent mode') || shown.ok !== 'OK') bad('card ' + JSON.stringify(shown));
    else ok('starting learn mode shows the reminder card');
    await page.click('#silentOk');
    const afterOk = await page.evaluate(() => ({
      hidden: document.getElementById('silentOv').classList.contains('hidden'),
      saved: localStorage.getItem('hilingo_silent_v4117'),
    }));
    if (!afterOk.hidden || afterOk.saved) bad('ok dismiss ' + JSON.stringify(afterOk));
    else ok('OK closes the card and does not save a dismissal');
    await page.evaluate(() => showSilentCard());
    await page.click('#silentHide');
    const gone = await page.evaluate(() => ({
      hidden: document.getElementById('silentOv').classList.contains('hidden'),
      saved: localStorage.getItem('hilingo_silent_v4117'),
      hint: document.getElementById('silentHint').classList.contains('hidden'),
    }));
    if (!gone.hidden || gone.saved !== '1' || gone.hint) bad('hide ' + JSON.stringify(gone));
    else ok('don\'t show again is stored, and the home hint stays');
    await page.evaluate(() => showSilentCard());
    const stayed = await page.evaluate(() => document.getElementById('silentOv').classList.contains('hidden'));
    if (!stayed) bad('card came back after dismissal');
    else ok('the card stays hidden after don\'t show again');
    await page.close();
  }

  const audio = await browser.newContext();
  await audio.addInitScript(() => {
    let type = 'auto';
    const session = {};
    Object.defineProperty(session, 'type', {
      get() { return type; },
      set(v) { type = String(v); window.__sets.push(type); },
    });
    Object.defineProperty(navigator, 'audioSession', { configurable: true, get() { return session; } });
    window.__sets = [];
    window.__starts = 0;
    window.__throwOnce = false;
    class FakeSR {
      start() {
        window.__startTypes = window.__startTypes || [];
        window.__startTypes.push(type);
        if (window.__throwOnce && type === 'play-and-record') {
          window.__throwOnce = false;
          const e = new Error('AudioSession category is not compatible with audio capture');
          e.name = 'InvalidStateError';
          throw e;
        }
        window.__starts++;
        if (this.onstart) this.onstart();
      }
      stop() { if (this.onend) this.onend(); }
      abort() {}
    }
    window.SpeechRecognition = FakeSR;
    window.webkitSpeechRecognition = FakeSR;
    window.speechSynthesis = {
      speaking: false, cancel() {}, resume() {}, getVoices() { return [{ lang: 'he-IL', name: 'Carmit' }]; },
      addEventListener() {},
      speak(u) { setTimeout(() => { if (u.onstart) u.onstart(); if (u.onend) u.onend(); }, 120); },
    };
  });
  const page = await audio.newPage();
  await page.goto(`http://127.0.0.1:${port}/index.html?ptt=0&ios=0`, { waitUntil: 'domcontentloaded' });
  const boot = await page.evaluate(() => document.getElementById('diagText').textContent);
  if (!boot.includes('audioSession auto')) bad('probe ' + boot.slice(0, 200));
  else ok('the mic log records the starting audioSession type');
  await page.click('#modeLearn');
  const afterTap = await page.evaluate(() => navigator.audioSession.type);
  if (afterTap !== 'playback') bad('gesture type ' + afterTap);
  else ok('the first gesture sets audioSession to playback');
  await page.click('#go');
  await page.evaluate(() => { try { releaseIntro('ended'); } catch (_) {} });
  await page.waitForFunction(() => document.getElementById('learn').dataset.state === 'IDLE_NATIVE');
  await page.evaluate(() => { window.__throwOnce = true; });
  await page.click('#learnMic');
  await page.waitForFunction(() => window.__starts >= 1 && document.getElementById('learn').dataset.state === 'LISTEN_NATIVE');
  const heard = await page.evaluate(() => ({
    type: navigator.audioSession.type,
    starts: window.__starts,
    types: window.__startTypes.slice(),
    log: document.getElementById('diagText').textContent,
  }));
  if (heard.type !== 'auto' || heard.starts !== 1 || heard.types[0] !== 'play-and-record' || !heard.types.includes('auto')) bad('fallback ' + JSON.stringify(heard));
  else ok('a failed play-and-record start retries once on auto');
  if (!heard.log.includes('audioSession play-and-record') || !heard.log.includes('audioSession auto') || !heard.log.includes('start retry auto')) bad('listen log ' + heard.log.slice(-300));
  else ok('the mic log shows play-and-record, then auto');
  await audio.close();
} finally {
  await browser.close();
  server.close();
}
if (problems.length) {
  console.log('\n' + problems.length + ' failure(s)');
  process.exit(1);
}
console.log('\nsilent checks passed');
