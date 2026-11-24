/**
 * HilinGo v4.13.9 — learning mode stops the Hebrew mic and waits before Italian.
 *   node tests_handoff.mjs
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
  window.__stops = 0;
  window.__aborts = 0;
  window.__langs = [];
  window.__started = [];
  class FakeSR {
    start(){
      window.__langs.push(this.lang);
      window.__started.push(this);
      const self = this;
      if (self.onstart) self.onstart();
      if (self.onaudiostart) self.onaudiostart();
      if (this.lang === 'he-IL') {
        const item = { isFinal: false, length: 1, 0: { transcript: 'אחד' } };
        if (self.onresult) self.onresult({ results: { length: 1, 0: item } });
      }
    }
    stop(){
      window.__stops++;
      const end = this.onend;
      setTimeout(() => { if (end) end(); }, 40);
    }
    abort(){ window.__aborts++; }
  }
  window.SpeechRecognition = FakeSR;
  window.webkitSpeechRecognition = FakeSR;
  window.__spoken = [];
  window.__audioPlays = 0;
  const synth = {
    speaking: false, cancel(){}, resume(){},
    getVoices(){ return [{ lang:'it-IT', name:'Alice' }, { lang:'he-IL', name:'Carmit' }]; },
    addEventListener(){},
    speak(u){
      window.__spoken.push((u.text||'')+'/'+(u.lang||''));
      setTimeout(() => { if (u.onstart) u.onstart(); }, 30);
      setTimeout(() => { if (u.onend) u.onend(); }, 140);
    },
  };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, get(){ return synth; } });
  window.Audio = class {
    set src(v){
      this._src = v;
      const s = String(v || '');
      if (s && !s.startsWith('data:')) window.__audioPlays++;
    }
    play(){ return Promise.resolve(); }
    pause(){}
    load(){}
    addEventListener(){}
    removeAttribute(){}
  };
});
const page = await context.newPage();
page.on('pageerror', e => bad('page ' + e.message));

try {
  await page.goto(`http://127.0.0.1:${port}/index.html?ptt=0`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    document.getElementById('sound').checked = false;
    document.getElementById('micAuto').click();
    window.fetch = async () => ({ ok: true, json: async () => [[['uno', 'אחד']]] });
  });
  await page.click('#modeLearn');
  await page.evaluate(() => {
    document.querySelector('#learnTargets .opt[data-lang="it"]').click();
  });
  await page.click('#go');
  await page.evaluate(() => { try { releaseIntro('ended'); } catch (_) {} document.getElementById('learn').classList.remove('hidden'); });
  const heard = await page.waitForFunction(() => {
    const log = document.getElementById('diagText').textContent || '';
    return log.includes('commit אחד reason=pause') && window.__stops >= 1 && document.getElementById('learnOtherWord').textContent.includes('uno');
  }, { timeout: 8000 }).then(() => true, () => false);
  const snap = await page.evaluate(() => ({
    stops: window.__stops,
    aborts: window.__aborts,
    langs: window.__langs.slice(),
    other: document.getElementById('learnOtherWord').textContent,
    log: (document.getElementById('diagText').textContent || '').slice(-500),
  }));
  if (!heard || snap.aborts) bad('handoff ' + JSON.stringify(snap));
  else ok('Hebrew commit uses stop, not abort, then shows uno');
  const italian = await page.waitForFunction(() => window.__langs.includes('it-IT'), { timeout: 8000 }).then(() => true, () => false);
  const after = await page.evaluate(() => {
    const mic = document.getElementById('learnRepeatMic');
    const style = getComputedStyle(mic);
    return {
      order: window.__langs.join(','),
      on: mic.classList.contains('on'),
      label: mic.innerText,
      bg: style.backgroundColor,
      nativeOn: document.getElementById('learnMic').classList.contains('on'),
    };
  });
  if (!italian || after.order.indexOf('he-IL') > after.order.indexOf('it-IT')) bad('italian start ' + after.order);
  else ok('Italian starts only after the Hebrew recognizer was stopped (' + after.order + ')');
  if (!after.on || after.nativeOn || !after.label.includes('אני מקשיב') || !/255,\s*91,\s*110|rgb\(255 91 110\)/.test(after.bg)) bad('listen button ' + JSON.stringify(after));
  else ok('the learn mic is red and says אני מקשיב while listening');
  const speech = await page.evaluate(() => ({
    spoken: window.__spoken.slice(),
    audio: window.__audioPlays,
    log: document.getElementById('diagText').textContent || '',
  }));
  if (!speech.spoken.some(s => s.startsWith('uno/')) || speech.audio || !speech.log.includes('end speechSynthesis')) bad('speech path ' + JSON.stringify(speech));
  else ok('the Italian word is spoken with speechSynthesis, no audio element');
} finally {
  await browser.close();
  server.close();
}
if (problems.length) {
  console.log('\n' + problems.length + ' failure(s)');
  process.exit(1);
}
console.log('\nhandoff checks passed');
