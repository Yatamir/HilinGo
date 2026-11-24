/**
 * HilinGo — the existing send button opens Hebrew typing in learning and the game.
 *   node tests_type.mjs
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
  class FakeAudio {
    constructor(){ this._src=''; this.paused=true; this.currentTime=0; this._ls={}; this.onended=null; this.onerror=null; }
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
  class FakeSR { start(){ if (this.onstart) this.onstart(); } stop(){ if (this.onend) this.onend(); } abort(){ if (this.onend) this.onend(); } }
  window.SpeechRecognition = FakeSR;
  window.webkitSpeechRecognition = FakeSR;
  window.speechSynthesis = { getVoices(){ return []; }, cancel(){}, resume(){}, speak(){} };
});

try {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(String(err)));
  await page.goto('http://127.0.0.1:' + port + '/index.html?ios=1&ptt=1', { waitUntil: 'domcontentloaded' });
  if (await page.locator('#silentOk').isVisible()) await page.click('#silentOk');
  await page.click('#modeLearn');
  await page.click('#go');
  await page.evaluate(() => window.__fireIntro('ended'));
  await page.click('#learnSend');
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
  if (focused !== 'learnIn') bad('learn send did not open the field ' + focused);
  else ok('tapping the learn send button focuses the Hebrew field');
  const opened = await page.evaluate(() => (document.getElementById('diagText').textContent || '').includes('type open learn'));
  if (!opened) bad('learn type tap was not logged');
  else ok('the learn type tap is logged');
  await page.fill('#learnIn', 'כלב');
  await page.click('#learnSend');
  await page.waitForFunction(() => {
    const w = document.getElementById('learnOwnWord');
    return w && w.textContent.includes('כלב');
  });
  ok('a typed learning word is accepted');

  await page.click('#learnBack');
  await page.click('#modePlay');
  await page.click('#go');
  if (await page.locator('#silentOk').isVisible()) await page.click('#silentOk');
  await page.evaluate(() => { if (window.__fireIntro) window.__fireIntro('ended'); });
  await page.waitForSelector('#send0');
  await page.click('#send0');
  const gameFocus = await page.evaluate(() => document.activeElement && document.activeElement.id);
  if (gameFocus !== 'in0') bad('game send did not open the field ' + gameFocus);
  else ok('tapping the game send button focuses the Hebrew field');
  await page.fill('#in0', 'אבא');
  await page.click('#send0');
  await page.waitForFunction(() => {
    const w = document.getElementById('w0');
    return w && w.textContent.includes('אבא');
  });
  ok('a typed game word is accepted');
  if (errors.length) bad('page errors ' + errors.join('; '));
  else ok('no page error');
} catch (err) {
  bad(err && err.message || err);
} finally {
  await browser.close();
  server.close();
}

if (problems.length) {
  console.log('\n' + problems.length + ' failure(s)');
  process.exit(1);
}
console.log('\ntype checks passed');
