/**
 * HilinGo v4.9 — translation card, hands-free repeat, and the word bank.
 *   node tests_translate.mjs
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
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await context.addInitScript(() => {
  window.__srs = [];
  window.speechSynthesis = {
    cancel(){}, resume(){}, getVoices(){ return []; },
    speak(u){ window.__utt = u; }
  };
  window.SpeechSynthesisUtterance = function(text){ this.text = text; this.lang = ''; this.onend = null; this.onerror = null; };
  class FakeSR {
    constructor(){ this.lang = ''; window.__srs.push(this); }
    start(){ this.started = true; window.__live = this; if (this.onstart) this.onstart(); }
    abort(){ this.aborted = true; }
    stop(){ this.abort(); }
  }
  window.SpeechRecognition = FakeSR;
  window.webkitSpeechRecognition = FakeSR;
  window.Audio = class { play(){ return Promise.resolve(); } pause(){} load(){} addEventListener(){} };
});
const page = await context.newPage();
await page.setViewportSize({ width: 390, height: 844 });
page.on('pageerror', e => bad('page ' + e.message));

async function boot() {
  await page.goto(`http://127.0.0.1:${port}/index.html?ptt=0`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { document.getElementById('sound').checked = false; });
}

function fire(transcript, final) {
  return page.evaluate(({ transcript, final }) => {
    const r = window.__live;
    if (!r || !r.onresult) return false;
    const item = { isFinal: !!final, transcript, length: 1, 0: { transcript } };
    r.onresult({ results: { length: 1, 0: item } });
    return true;
  }, { transcript, final });
}

try {
  await boot();
  const setup = await page.evaluate(() => ({
    none: document.querySelector('#trLangs .opt[data-tr=""]').classList.contains('sel'),
    label: document.getElementById('trLbl').textContent,
  }));
  if (!setup.none || !setup.label.includes('תרגום')) bad('setup ' + JSON.stringify(setup));
  else ok('translation defaults to off');
  await page.click('#trLangs .opt[data-tr="en"]');
  await page.locator('#trCardSetup').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, 'v49-setup.png') });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const kept = await page.evaluate(() => document.querySelector('#trLangs .opt[data-tr="en"]').classList.contains('sel'));
  if (!kept) bad('choice was not remembered');
  else ok('the last translation language is remembered');

  await page.evaluate(() => { document.getElementById('sound').checked = false; });
  await page.click('#go');
  await page.waitForSelector('#half0');
  await page.evaluate(() => { try { releaseIntro('ended'); } catch (_) {} WG.addCustomWord('אבא'); WG.addCustomWord('בלהבלה'); });
  const size0 = await page.evaluate(() => G.boards[0].size);
  await page.fill('#in0', 'אבא');
  await page.click('#send0');
  await page.waitForSelector('#trOv:not(.hidden)');
  const card = await page.evaluate(() => ({
    word: document.getElementById('trWord').textContent,
    on: document.getElementById('mic0').classList.contains('on'),
    deaf: trDeaf,
    lang: window.__live && window.__live.lang,
    left: G.timeLeft,
    turn: G.turn,
  }));
  if (!card.word || !card.on || !card.deaf || card.lang !== 'en-US' || card.turn !== 1) bad('card ' + JSON.stringify(card));
  else ok('card shows ' + card.word + ' while the mic stays on in English and stays deaf');
  await fire('חלון', true);
  const still = await page.evaluate(() => trDeaf && !trScored && !document.getElementById('trOv').classList.contains('bad'));
  if (!still) bad('a result during speech was scored');
  else ok('results while the app is speaking are ignored');
  await page.screenshot({ path: path.join(SHOTS, 'v49-card.png') });
  const held = await page.evaluate(() => G.timeLeft);
  if (held < card.left - 0.2) bad('clock moved ' + card.left + ' -> ' + held);
  else ok('the clock stays paused on the translation card');
  await page.evaluate(() => { if (window.__utt && window.__utt.onend) window.__utt.onend(); });
  await page.waitForFunction(() => trDeaf === false);
  const stillOn = await page.evaluate(() => document.getElementById('mic0').classList.contains('on'));
  if (!stillOn) bad('mic turned off when listening began');
  else ok('the mic light stays on as listening starts');
  await fire(card.word, true);
  await page.waitForSelector('#trOv.good');
  await page.screenshot({ path: path.join(SHOTS, 'v49-ok.png') });
  const won = await page.evaluate(() => ({
    size: G.boards[0].size,
    mark: document.getElementById('trMark').textContent,
    bank: readBank().length,
  }));
  if (won.size !== size0 - 2 || won.mark !== '✅' || won.bank < 1) bad('success ' + JSON.stringify(won));
  else ok('a correct repeat removes one bonus letter and saves the pair');
  await page.waitForFunction(() => document.getElementById('trOv').classList.contains('hidden'));
  const back = await page.evaluate(() => ({
    on1: document.getElementById('mic1').classList.contains('on'),
    lang: window.__live && window.__live.lang,
  }));
  if (!back.on1 || back.lang !== 'he-IL') bad('handoff ' + JSON.stringify(back));
  else ok('the mic stays lit and switches back to Hebrew for the next player');

  await page.click('#endBtn');
  await page.click('#again');
  await page.evaluate(() => { document.getElementById('sound').checked = false; });
  await page.click('#go');
  await page.waitForSelector('#in0');
  await page.evaluate(() => { try { releaseIntro('ended'); } catch (_) {} WG.addCustomWord('אבא'); });
  const before = await page.evaluate(() => G.boards[0].size);
  await page.fill('#in0', 'אבא');
  await page.click('#send0');
  await page.waitForSelector('#trOv:not(.hidden)');
  await page.evaluate(() => { if (window.__utt && window.__utt.onend) window.__utt.onend(); });
  await page.waitForFunction(() => trDeaf === false);
  await fire('zzzznotaword', true);
  await page.waitForSelector('#trOv.bad');
  const missed = await page.evaluate(() => ({
    size: G.boards[0].size,
    mark: document.getElementById('trMark').textContent,
    bg: getComputedStyle(document.getElementById('trOv')).backgroundColor,
    color: getComputedStyle(document.getElementById('trMark')).color,
  }));
  if (missed.size !== before - 1 || missed.mark !== 'X' || missed.color !== 'rgb(255, 255, 255)') bad('miss ' + JSON.stringify(missed));
  else ok('a miss is a white X on red and does not remove a bonus letter');
  await page.screenshot({ path: path.join(SHOTS, 'v49-x.png') });

  await page.evaluate(() => {
    if (trLock) { trScored = true; endTranslation(); }
    WG.addCustomWord('בלהבלה');
    arm = 'crazy'; crazyArmed = true;
    submit(G.turn, 'בלהבלה');
  });
  const crazy = await page.evaluate(() => document.getElementById('trOv').classList.contains('hidden'));
  if (!crazy) bad('silly word opened a translation');
  else ok('a silly word is not translated');

  await page.evaluate(() => openBank());
  await page.waitForSelector('#bankov:not(.hidden)');
  const bank = await page.evaluate(() => document.getElementById('bankList').textContent);
  if (!bank.includes('אבא')) bad('bank ' + bank);
  else ok('the word bank lists the saved pair');
  await page.screenshot({ path: path.join(SHOTS, 'v49-bank.png') });

  if (problems.length) { console.log('\n' + problems.length + ' failed'); process.exitCode = 1; }
  else console.log('\ntranslation checks passed');
} finally {
  await browser.close();
  server.close();
}
