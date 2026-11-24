/**
 * HilinGo — a learning tap that hears a word must translate and speak,
 * with no error banner and no stuck "thinking" mic.
 *   node tests_whisperflow.mjs
 */
import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const problems = [];
function bad(msg){ problems.push(msg); console.log('  FAIL', msg); }
function ok(msg){ console.log('  ok  ', msg); }

const FAKE_ASR = `
export function setLogger(){}
export function prefetch(){}
export async function ensureModel(){ return { ms: 1, device: 'wasm', dtype: 'q8', model: 'tiny' }; }
export async function recordUtterance(){
  return { peak: 0.8, rms: 0.2, audio: new Float32Array([0.2, 0.2]), samples: 2, durationMs: 400, why: 'pause', via: 'processor' };
}
export async function transcribe(){ return 'כלב'; }
export function cheapScores(){ return [{ text: 'כלב', score: -0.5 }]; }
export function decideLearn(){ return { commit: true, text: 'כלב', best: 'כלב', score: -0.5, ask: [] }; }
export function scoreTexts(){ return []; }
export function scoreDecision(){ return ''; }
export function scoreBest(){ return null; }
export function nearWords(){ return ['כלב']; }
`;

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
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(() => {
  window.__rejects = [];
  window.addEventListener('unhandledrejection', ev => {
    window.__rejects.push(String(ev.reason && (ev.reason.message || ev.reason) || ev.reason));
  });
  window.__intro = { plays: 0 };
  class FakeAudio {
    constructor(src){ this._src=''; this.paused=true; this.currentTime=0; this.duration=1; this._ls={}; this.onended=null; this.onerror=null; if (src) this.src = src; }
    set src(v){ this._src=String(v||''); if (/hilingo/.test(this._src)) window.__intro.el=this; }
    get src(){ return this._src; }
    load(){}
    play(){
      this.paused=false;
      if (/hilingo/.test(this._src)){ window.__intro.plays++; window.__intro.el=this; }
      setTimeout(() => { if (typeof this.onended === 'function') this.onended(); }, 20);
      return Promise.resolve();
    }
    pause(){ this.paused=true; if (typeof this.onpause === 'function') this.onpause(); }
    addEventListener(type, fn){ (this._ls[type] ||= []).push(fn); }
    removeEventListener(){}
  }
  window.Audio = FakeAudio;
  window.__fireIntro = (type) => {
    const el = window.__intro.el;
    ((el && el._ls && el._ls[type]) || []).slice().forEach(fn => fn());
  };
  class FakeSR { start(){ if (this.onstart) this.onstart(); } stop(){ if (this.onend) this.onend(); } abort(){ if (this.onend) this.onend(); } }
  window.SpeechRecognition = FakeSR;
  window.webkitSpeechRecognition = FakeSR;
  window.speechSynthesis = { getVoices(){ return []; }, cancel(){}, resume(){}, speak(u){ if (u && u.onend) u.onend(); } };
  const tracks = () => [{ muted:false, readyState:'live', kind:'audio', stop(){ this.readyState='ended'; }, addEventListener(){} }];
  Object.defineProperty(navigator, 'mediaDevices', { configurable:true, value: {
    getUserMedia(){ return Promise.resolve({ getAudioTracks: tracks, getTracks: tracks }); }
  }});
});

try {
  await context.route(/\/asr\.js(\?|$)/, route => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: FAKE_ASR
  }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(String(err)));
  await page.goto('http://127.0.0.1:' + port + '/index.html?asr=whisper&ios=1&ptt=1', { waitUntil: 'domcontentloaded' });
  if (await page.locator('#silentOk').isVisible()) await page.click('#silentOk');
  await page.click('#modeLearn');
  await page.click('#go');
  await page.evaluate(() => window.__fireIntro('ended'));
  await page.click('#learnMic');
  try {
  await page.waitForFunction(() => {
    const word = document.getElementById('learnOwnWord');
    const other = document.getElementById('learnOtherWord');
    const status = document.getElementById('learnStatus');
    const own = word && word.textContent.includes('כלב');
    const spoke = other && other.textContent && other.textContent !== '\u00a0' && other.textContent !== '…';
    const thinking = status && /חושב|thinking|denk|pensando|penso/i.test(status.textContent || '');
    return own && spoke && !thinking;
  }, null, { timeout: 8000 });
  } catch (err) {
    const dbg = await page.evaluate(() => ({
      bar: document.getElementById('errbar').textContent,
      status: document.getElementById('learnStatus').textContent,
      own: document.getElementById('learnOwnWord').textContent,
      other: document.getElementById('learnOtherWord').textContent,
      state: document.getElementById('learn').dataset.state,
      log: (document.getElementById('diagText').textContent || '').slice(-800),
      rejects: window.__rejects
    }));
    bad('flow did not finish ' + JSON.stringify(dbg));
    throw err;
  }
  const snap = await page.evaluate(() => ({
    bar: (document.getElementById('errbar') && document.getElementById('errbar').textContent) || '',
    hidden: document.getElementById('errbar').classList.contains('hidden'),
    status: document.getElementById('learnStatus').textContent,
    mic: document.getElementById('learnMic').className,
    other: document.getElementById('learnOtherWord').textContent,
    rejects: window.__rejects || []
  }));
  if (snap.bar.includes('שגיאה') || !snap.hidden) bad('error banner ' + snap.bar);
  else ok('no error banner after a heard word');
  if (snap.rejects.length) bad('unhandled rejection ' + snap.rejects.join('; '));
  else ok('no unhandled rejection');
  if (/on/.test(snap.mic) || /חושב/.test(snap.status)) bad('stuck listening ' + JSON.stringify(snap));
  else ok('the mic is idle and the thinking line is gone');
  if (!snap.other || snap.other === '…') bad('translation did not speak ' + snap.other);
  else ok('the translation is shown (' + snap.other.trim() + ')');
  const saved = await page.evaluate(() => localStorage.getItem('hilingo_cur_log') || '');
  if (!saved.includes('capture start') && !saved.includes('asr engine=whisper')) bad('log not persisted');
  else ok('the session log is saved for the next launch');
  const home = await page.locator('#homeLog').count();
  if (!home) bad('home log button missing');
  else ok('the home screen has a log copy button');
  if (errors.length) bad('page error ' + errors.join('; '));
  else ok('no page error');
} catch (err) {
  bad(err && err.message || String(err));
} finally {
  await browser.close();
  server.close();
}

if (problems.length) {
  console.log('\n' + problems.length + ' failure(s)');
  process.exit(1);
}
console.log('\nwhisper-flow checks passed');
