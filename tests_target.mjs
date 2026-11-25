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
import { readFileSync } from 'node:fs';
import { trimPcm, scoreDecision, targetAccept, scoreCandidates, hearWithModel, resolveHebrew, pickHebrew, followCapture, TARGET_FLOOR } from './asr.js';

const problems = [];
function bad(msg){ problems.push(msg); console.log('  FAIL', msg); }
function ok(msg){ console.log('  ok  ', msg); }

const pageSrc = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const asrSrc = readFileSync(new URL('./asr.js', import.meta.url), 'utf8');
if (asrSrc.includes("log('cap zero restart')") || pageSrc.includes('freshAfterTts') || pageSrc.includes('releaseTtsClip') || pageSrc.includes('cap stop tap')) bad('capture regression still present');
else if (!pageSrc.includes("diag('cap busy ignore')") || !pageSrc.includes("diag('cap fresh after tts')")) bad('post-tts fresh mic missing');
else ok('a quiet start is not restarted, and the tap after speech asks for the mic again');
if (!pageSrc.includes("trPhase='hold'") || !pageSrc.includes('function showTrMiss') || !pageSrc.includes('resolveHebrew')) bad('page wiring');
else ok('the voice word waits on the bar, a miss can be retried, and Hebrew uses the skeleton');

const logged = [
  { text: 'uno', score: -3.734 },
  { text: 'una', score: -5.207 },
  { text: 'Uuh', score: -4.4 },
];
const won = scoreDecision(logged, 'uno', 'Uuh');
if (won !== 'uno') bad('log scores ' + won);
else ok('uno still beats a worse free decode and stays above ' + TARGET_FLOOR);

const kept = targetAccept(logged, 'uno', 'Uuh!');
if (!kept.accept || kept.text !== 'uno' || kept.why !== 'score') bad('free text overrode ' + JSON.stringify(kept));
else ok('Uuh! does not override a passing uno score');

for (const row of [
  ['uno', -3.6, 'Uno'],
  ['cosa', -3.96, 'cosa'],
  ['ciao', -3.9, 'Ciao!'],
  ['sistema', -4.65, 'sistema'],
]) {
  const hit = targetAccept([{ text: row[0], score: row[1] }, { text: 'grazie', score: row[1] - 1.2 }], row[0], row[2]);
  if (!hit.accept || hit.text !== row[0]) bad('correct ' + row[0] + ' ' + JSON.stringify(hit));
  else ok(row[0] + ' ' + row[1] + ' is accepted (' + hit.why + ')');
}
const byScore = targetAccept([
  { text: 'sistema', score: -4.65 },
  { text: 'ciao', score: -6.4 },
], 'sistema', 'ciao');
if (!byScore.accept || byScore.why !== 'score') bad('big margin ' + JSON.stringify(byScore));
else ok('a correct word that beats a different free decode by a wide margin is accepted');

const wrongCiao = targetAccept([
  { text: 'ciao', score: -3.917 },
  { text: 'grazie', score: -3.4 },
  { text: 'uno', score: -4.2 },
], 'ciao', 'grazie');
if (wrongCiao.accept) bad('grazie accepted ' + JSON.stringify(wrongCiao));
else ok('ciao does not win when the free decode is grazie');
const wrongDay = targetAccept([
  { text: 'ciao', score: -3.9 },
  { text: 'buongiorno', score: -3.2 },
], 'ciao', 'buongiorno');
if (wrongDay.accept || wrongDay.why !== 'different') bad('buongiorno ' + JSON.stringify(wrongDay));
else ok('ciao is rejected when the free decode is buongiorno');
const alone = targetAccept([{ text: 'Capisci quello che sto dicendo?', score: -4.416 }], 'Capisci quello che sto dicendo?', '');
if (alone.accept) bad('blanket accept ' + JSON.stringify(alone));
else ok('a target score alone, with no free decode, is not accepted');
const rishon = targetAccept([
  { text: 'Rishon LeZion', score: -8.28 },
  { text: 'E la vi', score: -2.1 },
], 'Rishon LeZion', 'E la vi');
if (rishon.accept) bad('rishon accepted ' + JSON.stringify(rishon));
else ok('a wrong translation repeat stays rejected');

const both = targetAccept([{ text: 'uno', score: -8.2 }, { text: 'una', score: -8.4 }], 'uno', 'Uuh!');
if (both.accept) bad('both-fail accepted ' + JSON.stringify(both));
else ok('a weak score and Uuh! are not accepted');

const fuzzy = targetAccept([{ text: 'uno', score: -8 }], 'uno', 'Uno!');
if (!fuzzy.accept || fuzzy.text !== 'uno' || fuzzy.why !== 'fuzzy') bad('fuzzy ' + JSON.stringify(fuzzy));
else ok('Uno! fuzzy-matches uno when the score does not pass');

const far = targetAccept([], 'uno', 'Eccord!');
if (far.accept) bad('Eccord accepted ' + JSON.stringify(far));
else ok('Eccord! is not uno');

const beer = resolveHebrew('ברשב', 'ב', ['במשב', 'בעשב', 'בקשב', 'אחד']);
if (beer.text !== 'באר שבע' || beer.candidates[0] !== 'באר שבע') bad('beer ' + JSON.stringify(beer));
else ok('ברשב with chain letter ב is באר שבע');
const beerOther = resolveHebrew('ברשב', 'א', ['באר שבע']);
if (!beerOther.candidates.includes('באר שבע')) bad('place dropped ' + JSON.stringify(beerOther));
else ok('באר שבע stays a candidate even when the chain letter differs');
const vav = resolveHebrew('ו', 'א', ['אב', 'או', 'אחד', 'בא']);
if (vav.text || (vav.candidates || []).length) bad('ו snapped ' + JSON.stringify(vav));
else ok('ו is not snapped to אב');
const picked = pickHebrew('ו', 'א', [{ text: 'אב', score: -5.86 }, { text: 'או', score: -4.66 }]);
if (picked.text) bad('short pick ' + JSON.stringify(picked));
else ok('a one-letter hear is not replaced by the best score');
const best = pickHebrew('אחד', 'א', [{ text: 'אב', score: -5.86 }, { text: 'או', score: -4.66 }]);
if (best.text !== 'או') bad('best score ' + JSON.stringify(best));
else ok('the higher score wins, not the first candidate');
const wrongLetter = pickHebrew('שלום', 'א', [{ text: 'שלום', score: -1.2 }, { text: 'אבא', score: -3 }]);
if (wrongLetter.why !== 'letter' || wrongLetter.text !== 'שלום') bad('letter ' + JSON.stringify(wrongLetter));
else ok('a closer word with the wrong letter is rejected as the wrong letter');
{
  const events = [];
  for (let t = 0; t <= 2000; t += 100) events.push({ ms: t, rms: 0 });
  for (let t = 2100; t <= 3200; t += 100) events.push({ ms: t, rms: 0.2 });
  for (let t = 3300; t <= 5200; t += 100) events.push({ ms: t, rms: 0 });
  const kept = followCapture(events);
  if (!kept.heard || kept.restarted || kept.end < 3500) bad('zeros then speech ' + JSON.stringify(kept));
  else ok('two seconds of zeros then speech is kept (' + kept.end + 'ms), with no restart');
}

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
const heardOnce = await hearWithModel(model, { fake: true }, jobs, async (features, hidden) => {
  if (!hidden || !hidden.hf) throw new Error('decode ran before the encoder');
  return 'grazie';
}, (text) => ({ text, ids: [1, 9, 9], row: [1, 9] }), { initLen: 1 });
if (!heardOnce || heardOnce.encoderRuns !== 1 || heardOnce.text !== 'grazie' || heardOnce.scores.length !== 4) bad('hear ' + JSON.stringify(heardOnce && { n: heardOnce.scores.length, runs: heardOnce.encoderRuns, text: heardOnce.text }));
else ok('free decode and every candidate share one encoder run');

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
