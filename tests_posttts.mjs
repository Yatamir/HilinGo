/**
 * HilinGo — after the spoken word, the repeat tap asks for the microphone again.
 *   node tests_posttts.mjs
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const problems = [];
function bad(msg){ problems.push(msg); console.log('  FAIL', msg); }
function ok(msg){ console.log('  ok  ', msg); }

const pageSrc = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const captureAt = pageSrc.indexOf("markStage('capture start')");
const recordAt = pageSrc.indexOf('recordUtterance', captureAt);
const between = pageSrc.slice(captureAt, recordAt);
if (between.includes('releaseTtsClip') || between.includes('armStop') || !between.includes('captureForListen(false)')) bad('listen no longer matches 4.13.19 ' + between.slice(0, 240));
else ok('the listen grabs the stream and records it, without tearing the clip down in between');
if (!pageSrc.includes("diag('cap busy ignore')") || pageSrc.includes('cap stop tap') || pageSrc.includes('function releaseTtsClip')) bad('tap handling drifted');
else ok('a second tap during capture is ignored, as in 4.13.19');
if (!pageSrc.includes("diag('cap fresh after tts')") || !pageSrc.includes("diag('cap no preopen after tts')")) bad('post-tts sequence missing');
else ok('speech does not preopen the mic, and the following tap asks again');
if (pageSrc.includes('>למידה<') || pageSrc.includes("modeLearn:'למידה'") || pageSrc.includes('>למידה:')) bad('learn label still says למידה');
else if (!pageSrc.includes('>לימוד<') || !pageSrc.includes("modeLearn:'לימוד'") || !pageSrc.includes('לימוד:')) bad('learn label missing');
else ok('the home button and the rules say לימוד');

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
function serve(root){
  const types = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json', '.mp3':'audio/mpeg', '.png':'image/png' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let p = path.join(root, decodeURIComponent(url.pathname));
    if (p.endsWith('/')) p += 'index.html';
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    fs.readFile(p, (err, buf) => {
      if (err) { res.writeHead(404); res.end('missing'); return; }
      res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}
const server = await serve(ROOT);
const port = server.address().port;
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await context.addInitScript(() => {
  window.__intro = { plays: 0 };
  window.__gums = 0;
  window.__srs = [];
  class FakeAudio {
    constructor(src){ this._src=''; this.paused=true; this.currentTime=0; this.duration=1; this._ls={}; this.onended=null; this.onerror=null; if (src) this.src = src; }
    set src(v){ this._src=String(v||''); if (/hilingo/.test(this._src)) window.__intro.el=this; }
    get src(){ return this._src; }
    load(){}
    play(){ this.paused=false; if (/hilingo/.test(this._src)){ window.__intro.plays++; window.__intro.el=this; } return Promise.resolve(); }
    pause(){ this.paused=true; }
    addEventListener(type, fn){ (this._ls[type] ||= []).push(fn); }
    removeEventListener(){}
  }
  window.Audio = FakeAudio;
  window.__fireIntro = (type) => {
    const el = window.__intro.el;
    ((el && el._ls && el._ls[type]) || []).slice().forEach(fn => fn());
  };
  class FakeSR {
    start(){ window.__srs.push(this); if (this.onstart) this.onstart(); }
    stop(){ if (this.onend) this.onend(); }
    abort(){ if (this.onend) this.onend(); }
  }
  window.SpeechRecognition = FakeSR;
  window.webkitSpeechRecognition = FakeSR;
  window.speechSynthesis = {
    getVoices(){ return [{ lang: 'it-IT', name: 'Italian' }, { lang: 'he-IL', name: 'Hebrew' }]; },
    cancel(){}, resume(){},
    speak(u){ if (u && u.onend) setTimeout(() => u.onend(), 20); },
  };
  const track = () => ({ muted:false, readyState:'live', kind:'audio', stop(){ this.readyState='ended'; }, addEventListener(){} });
  Object.defineProperty(navigator, 'mediaDevices', { configurable:true, value: {
    getUserMedia(){
      window.__gums++;
      const t = track();
      return Promise.resolve({ getAudioTracks:() => [t], getTracks:() => [t] });
    }
  }});
});
try {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(String(err)));
  await page.goto('http://127.0.0.1:' + port + '/index.html?asr=whisper&ios=1&ptt=1', { waitUntil: 'domcontentloaded' });
  if (await page.locator('#silentOk').isVisible()) await page.click('#silentOk');
  const home = await page.locator('#modeLearn').innerText();
  if (home.trim() !== 'לימוד') bad('home button ' + home);
  else ok('the home button says לימוד');
  await page.click('#modeLearn');
  await page.click('#learnTargets button[data-lang="it"]');
  await page.click('#go');
  await page.evaluate(() => window.__fireIntro('ended'));
  await page.fill('#learnIn', 'אחד');
  await page.click('#learnSend');
  await page.waitForFunction(() => {
    const log = document.getElementById('diagText').textContent || '';
    return log.includes('cap no preopen after tts') && document.getElementById('learn').dataset.state === 'IDLE_TARGET';
  }, null, { timeout: 15000 });
  const before = await page.evaluate(() => window.__gums);
  if (await page.locator('#silentOk').isVisible()) await page.click('#silentOk');
  await page.click('#learnRepeatMic');
  await page.waitForFunction(() => {
    const log = document.getElementById('diagText').textContent || '';
    return log.includes('cap fresh after tts') && log.includes('gUM ok');
  }, null, { timeout: 8000 });
  const after = await page.evaluate(() => {
    const log = document.getElementById('diagText').textContent || '';
    const pre = log.indexOf('cap no preopen after tts');
    const fresh = log.indexOf('cap fresh after tts');
    const gum = log.lastIndexOf('gUM ok');
    return { gums: window.__gums, pre, fresh, gum, tail: log.slice(fresh - 80, gum + 20) };
  });
  if (after.gums <= before) bad('repeat reused the mic ' + JSON.stringify(after));
  else if (!(after.pre >= 0 && after.fresh > after.pre && after.gum > after.fresh)) bad('sequence ' + JSON.stringify(after));
  else ok('the repeat tap calls getUserMedia after the spoken word (' + before + ' -> ' + after.gums + ')');
  if (errors.length) bad('page error ' + errors.join('; '));
  else ok('no page error');
} catch (err) {
  let snap = '';
  try {
    const pages = context.pages();
    if (pages[0]) snap = await pages[0].evaluate(() => (document.getElementById('diagText').textContent || '').slice(-500));
  } catch (_) {}
  bad((err && err.message || String(err)) + ' ' + snap);
} finally {
  await browser.close();
  server.close();
}

if (problems.length) {
  console.log('\n' + problems.length + ' failure(s)');
  process.exit(1);
}
console.log('\npost-tts checks passed');
