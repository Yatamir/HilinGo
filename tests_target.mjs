/**
 * HilinGo — target repeat accepts a clear score, keeps the encoder once,
 * and paints the miss on the target card.
 *   node tests_target.mjs
 */
import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { trimPcm, scoreDecision, targetAccept, scoreCandidates, TARGET_SCORE } from './asr.js';

const problems = [];
function bad(msg){ problems.push(msg); console.log('  FAIL', msg); }
function ok(msg){ console.log('  ok  ', msg); }

const logged = [
  { text: 'uno', score: -3.734 },
  { text: 'una', score: -5.207 },
  { text: 'שלום', score: -9.061 },
];
const won = scoreDecision(logged, 'uno');
if (won !== 'uno') bad('log scores ' + won);
else ok('uno wins the logged scores by margin and stays above ' + TARGET_SCORE);

const kept = targetAccept(logged, 'uno', 'Uuh!');
if (!kept.accept || kept.text !== 'uno' || kept.why !== 'score') bad('free text overrode ' + JSON.stringify(kept));
else ok('Uuh! does not override a passing uno score');

const both = targetAccept([{ text: 'uno', score: -8.2 }, { text: 'una', score: -8.4 }], 'uno', 'Uuh!');
if (both.accept) bad('both-fail accepted ' + JSON.stringify(both));
else ok('a weak score and Uuh! are not accepted');

const fuzzy = targetAccept([{ text: 'uno', score: -8 }], 'uno', 'Uno!');
if (!fuzzy.accept || fuzzy.text !== 'uno' || fuzzy.why !== 'fuzzy') bad('fuzzy ' + JSON.stringify(fuzzy));
else ok('Uno! fuzzy-matches uno when the score does not pass');

const far = targetAccept([], 'uno', 'Eccord!');
if (far.accept) bad('Eccord accepted ' + JSON.stringify(far));
else ok('Eccord! is not uno');

{
  const rate = 16000;
  const n = Math.round(rate * 2.5);
  const audio = new Float32Array(n);
  const a0 = Math.round(rate * 1.0);
  const a1 = Math.round(rate * 1.25);
  for (let i = a0; i < a1; i++) audio[i] = Math.sin(i / 8) * 0.4;
  const keptAudio = trimPcm(audio, rate);
  const span = (keptAudio.end - keptAudio.start) / rate;
  const covers = keptAudio.start <= a0 && keptAudio.end >= a1;
  if (span < 1.0 || !covers) bad('short trim ' + span.toFixed(2) + ' start ' + keptAudio.start + ' end ' + keptAudio.end);
  else ok('a short word is kept for ' + span.toFixed(2) + 's, centered on the speech');
}
{
  const rate = 16000;
  const n = Math.round(rate * 2.5);
  const audio = new Float32Array(n);
  const toneAt = Math.round(rate * 0.5);
  for (let i = toneAt; i < n; i++) audio[i] = Math.sin(i / 8) * 0.4;
  const keptAudio = trimPcm(audio, rate);
  const span = (keptAudio.end - keptAudio.start) / rate;
  if (span < 2.0) bad('long trim collapsed ' + span.toFixed(2));
  else ok('2.0s of speech is still kept (' + span.toFixed(2) + 's)');
}

let runs = 0;
const session = {
  async run(){
    runs++;
    return { last_hidden_state: { raw: runs } };
  },
};
const decoded = [];
async function model(args){
  if (!args.encoder_outputs) {
    const out = await session.run({});
    out.last_hidden_state = { hf: true };
  } else if (!args.encoder_outputs.hf) {
    throw new Error('decoder did not reuse the encoder');
  }
  decoded.push(args.decoder_input_ids[args.decoder_input_ids.length - 1]);
  const vocab = 8;
  const len = args.decoder_input_ids.length;
  return { logits: { data: new Float32Array(len * vocab), dims: [1, len, vocab] } };
}
model.sessions = { model: session };
const jobs = [
  { text: 'uno', ids: [1, 2, 3], row: [1, 2] },
  { text: 'una', ids: [1, 2, 4], row: [1, 2] },
  { text: 'שלום', ids: [1, 5, 6], row: [1, 5] },
];
const early = await scoreCandidates(model, { fake: true }, jobs, { early: TARGET_SCORE, initLen: 1 });
if (!early || early.encoderRuns !== 1 || early.scores.length !== 1 || early.scores[0].text !== 'uno') bad('early ' + JSON.stringify(early));
else ok('a clear uno score skips the other candidates after one encoder run');
if (scoreDecision(early.scores, 'uno') !== 'uno') bad('early decision ' + JSON.stringify(early.scores));
else ok('the single passing score is accepted');

runs = 0;
decoded.length = 0;
const all = await scoreCandidates(model, { fake: true }, jobs, { early: null, initLen: 1 });
if (!all || all.encoderRuns !== 1 || all.scores.length !== 3) bad('shared ' + JSON.stringify(all && { n: all.scores.length, runs: all.encoderRuns, decoded }));
else ok('three candidates share one encoder run');

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
  window.__emit = (text) => {
    const sr = window.__srs[window.__srs.length - 1];
    const res = { isFinal: true, length: 1, 0: { transcript: text } };
    sr.onresult({ results: [res], resultIndex: 0 });
  };
  window.speechSynthesis = {
    getVoices(){ return [{ lang: 'it-IT', name: 'Italian' }, { lang: 'he-IL', name: 'Hebrew' }]; },
    cancel(){}, resume(){},
    speak(u){ if (u && u.onend) setTimeout(() => u.onend(), 20); },
  };
});
try {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(String(err)));
  await page.goto('http://127.0.0.1:' + port + '/index.html?ios=1&ptt=1', { waitUntil: 'domcontentloaded' });
  if (await page.locator('#silentOk').isVisible()) await page.click('#silentOk');
  await page.click('#modeLearn');
  await page.click('#learnTargets button[data-lang="it"]');
  await page.click('#go');
  await page.evaluate(() => window.__fireIntro('ended'));
  await page.fill('#learnIn', 'אחד');
  await page.click('#learnSend');
  await page.waitForFunction(() => {
    const other = document.getElementById('learnOtherWord');
    return other && /uno/i.test(other.textContent) && document.getElementById('learn').dataset.state === 'IDLE_TARGET';
  }, null, { timeout: 15000 });
  if (await page.locator('#silentOk').isVisible()) await page.click('#silentOk');
  await page.click('#learnRepeatMic');
  await page.waitForFunction(() => document.getElementById('learn').dataset.state === 'LISTEN_TARGET');
  await page.evaluate(() => window.__emit('Uuh!'));
  await page.waitForFunction(() => document.getElementById('learn').dataset.state === 'RETRY');
  const snap = await page.evaluate(() => ({
    own: document.getElementById('learnOwnWord').textContent,
    ownClass: document.getElementById('learnOwnWord').className,
    ownMsg: document.getElementById('learnOwnMsg').textContent,
    heard: document.getElementById('learnHeard').textContent,
    other: document.getElementById('learnOtherWord').textContent,
    otherClass: document.getElementById('learnOtherWord').className,
    otherMsg: document.getElementById('learnOtherMsg').textContent,
    otherHeard: document.getElementById('learnOtherHeard').textContent,
    state: document.getElementById('learn').dataset.state,
  }));
  if (!snap.own.includes('אחד') || /bad/.test(snap.ownClass) || /Uuh/i.test(snap.own) || /Uuh/i.test(snap.heard) || /לא אותו/.test(snap.ownMsg)) bad('hebrew card ' + JSON.stringify(snap));
  else ok('the Hebrew card keeps אחד');
  if (!/Uuh/i.test(snap.other) || !/bad/.test(snap.otherClass) || !/לא אותו/.test(snap.otherMsg) || !/Uuh/i.test(snap.otherHeard)) bad('target card ' + JSON.stringify(snap));
  else ok('Uuh and the mismatch sit on the Italian card');
  if (errors.length) bad('page error ' + errors.join('; '));
  else ok('no page error');
} catch (err) {
  let snap = '';
  try {
    const pages = context.pages();
    if (pages[0]) snap = JSON.stringify(await pages[0].evaluate(() => ({
      state: document.getElementById('learn') && document.getElementById('learn').dataset.state,
      own: document.getElementById('learnOwnWord') && document.getElementById('learnOwnWord').textContent,
      other: document.getElementById('learnOtherWord') && document.getElementById('learnOtherWord').textContent,
      msg: document.getElementById('learnOwnMsg') && document.getElementById('learnOwnMsg').textContent,
      status: document.getElementById('learnStatus') && document.getElementById('learnStatus').textContent,
      hidden: document.getElementById('learn') && document.getElementById('learn').className,
    })));
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
console.log('\ntarget checks passed');
