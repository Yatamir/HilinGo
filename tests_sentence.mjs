/**
 * HilinGo v4.12.2 — a five-word sentence on top of the letter chain.
 *   node tests_sentence.mjs
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
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mp3': 'audio/mpeg', '.png': 'image/png', '.json': 'application/json' };
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
  class FakeAudio {
    constructor() { this.preload = ''; this.paused = true; this.currentTime = 0; }
    load() {}
    play() { return Promise.resolve(); }
    pause() {}
    addEventListener() {}
    removeEventListener() {}
  }
  window.Audio = FakeAudio;
  class FakeSR { start() {} stop() {} abort() {} }
  window.SpeechRecognition = FakeSR;
  window.webkitSpeechRecognition = FakeSR;
});
const page = await context.newPage();
await page.setViewportSize({ width: 390, height: 844 });
try {
  await page.goto(`http://127.0.0.1:${port}/index.html?ptt=0`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { document.getElementById('sound').checked = false; });
  await page.click('#go');
  await page.waitForSelector('#half1');
  await page.evaluate(() => { try { releaseIntro('ended'); } catch (_) {} ['אבא','אגס','סוס','ספר','רגל','אור'].forEach(w => WG.addCustomWord(w)); });

  await page.fill('#in0', 'הילי');
  await page.click('#send0');
  const rejected = await page.evaluate(() => ({
    turn: G.turn,
    hist: G.history.filter(h => h.word).map(h => h.word),
  }));
  if (rejected.turn !== 0 || rejected.hist.length) bad('hili accepted ' + JSON.stringify(rejected));
  else ok('Hili is rejected as a normal word');

  await page.click('#sentStart');
  await page.fill('#in0', 'אבא');
  await page.click('#send0');
  const btn = await page.locator('#sentStart').innerText();
  if (btn.trim() !== 'משפט' || !(await page.locator('#sentStart').isVisible())) bad('button ' + btn);
  else ok('sentence button after a valid word');
  await page.screenshot({ path: path.join(SHOTS, 'v47-button.png') });
  const started = await page.evaluate(() => ({
    green: document.querySelectorAll('#history .sentword').length,
    msg: document.getElementById('sentMsg').textContent,
    hist: document.getElementById('history').textContent,
  }));
  if (started.green !== 1 || !/המשפט התחיל/.test(started.msg)) bad('start ' + JSON.stringify(started));
  else ok('sentence started, first word is green');
  await page.screenshot({ path: path.join(SHOTS, 'v47-sentence.png') });

  const beforeVoid = await page.evaluate(() => G.boards[1].size);
  await page.fill('#in1', 'אגס');
  await page.click('#send1');
  const wrong = await page.evaluate(() => {
    const n = G.history.length;
    const box = document.getElementById('in0');
    box.value = 'כלב';
    return { n };
  });
  await page.click('#send0');
  const still = await page.evaluate(() => G.history.filter(h => h.word).map(h => h.word).join(' '));
  if (still !== 'אבא אגס') bad('bad letter accepted ' + still + ' ' + JSON.stringify(wrong));
  else ok('a sentence word must still start with the last letter');

  if (!(await page.locator('#sentNo').isVisible())) bad('not logical hidden');
  else ok('not logical button is shown to the next player');
  await page.screenshot({ path: path.join(SHOTS, 'v47-not-logical.png') });
  await page.click('#sentNo');
  const voided = await page.evaluate(() => ({
    words: G.history.filter(h => h.word).map(h => h.word),
    turn: G.turn,
    size: G.boards[1].size,
    green: document.querySelectorAll('#history .sentword').length,
  }));
  if (voided.words.join(' ') !== 'אבא' || voided.turn !== 1 || voided.size !== beforeVoid || voided.green !== 1) bad('void ' + JSON.stringify(voided));
  else ok('not logical removes the word, restores the letter, and gives the turn back');

  await page.fill('#in1', 'אגס');
  await page.click('#send1');
  await page.fill('#in0', 'סוס');
  await page.click('#send0');
  await page.fill('#in1', 'ספר');
  await page.click('#send1');
  const penBefore = await page.evaluate(() => G.boards[0].size);
  await page.fill('#in0', 'הילי');
  await page.click('#send0');
  const cancelled = await page.evaluate(() => ({
    size: G.boards[0].size,
    green: document.querySelectorAll('#history .sentword').length,
    msg: document.getElementById('sentMsg').textContent,
    arrow: document.getElementById('history').innerHTML.includes('←') || document.getElementById('history').textContent.includes('←'),
    words: G.history.filter(h => h.word).map(h => h.word),
  }));
  if (cancelled.green || cancelled.size !== penBefore + 2 || !/הילי/.test(cancelled.msg) || cancelled.words.includes('הילי')) bad('hili ' + JSON.stringify(cancelled));
  else ok('Hili cancels the sentence and restores two letters');
  await page.screenshot({ path: path.join(SHOTS, 'v47-hili.png') });

  await page.click('#endBtn');
  await page.click('#again');
  await page.evaluate(() => { ['אבא','אגס','סוס','ספר','רגל'].forEach(w => WG.addCustomWord(w)); try { releaseIntro('ended'); } catch (_) {} });
  await page.waitForSelector('#in0');
  const chain = [['#in0','#send0','אבא'],['#in1','#send1','אגס'],['#in0','#send0','סוס'],['#in1','#send1','ספר'],['#in0','#send0','רגל']];
  await page.click('#sentStart');
  await page.fill(chain[0][0], chain[0][2]);
  await page.click(chain[0][1]);
  for (let i = 1; i < chain.length; i++) {
    await page.fill(chain[i][0], chain[i][2]);
    await page.click(chain[i][1]);
  }
  const done = await page.evaluate(() => ({
    over: G.over,
    fx: !document.getElementById('fx').classList.contains('hidden'),
    bits: document.querySelectorAll('#fx .bit').length,
    msg: document.getElementById('sentMsg').textContent,
    green: document.querySelectorAll('#history .sentword').length,
    pts: sentPoints.slice(),
  }));
  if (done.green || done.pts[0] !== 3 || done.pts[1] !== 2 || !/בונוס משפט/.test(done.msg) || done.bits < 10) bad('complete ' + JSON.stringify(done));
  else ok('five words close the sentence with confetti and bonus deletions');
  await page.screenshot({ path: path.join(SHOTS, 'v47-complete.png') });
  await page.evaluate(() => window.__hilingoFinish('manual'));
  await page.waitForSelector('#endov:not(.hidden)');
  const end = await page.locator('#endSent').innerText();
  if (!/3 נקודות משפט/.test(end) || !/2 נקודות משפט/.test(end)) bad('end points ' + end);
  else ok('end screen shows sentence points');
  await page.screenshot({ path: path.join(SHOTS, 'v47-end-points.png') });
} finally {
  await browser.close();
  server.close();
}
if (problems.length) {
  console.log('\n' + problems.length + ' failure(s)');
  process.exit(1);
}
console.log('\nsentence checks passed');
