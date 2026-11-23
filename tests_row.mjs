/**
 * HilinGo v4.11.7 — the full button row stays bright, the header fits, and an
 * automatic not-allowed does not show the settings card.
 *   node tests_row.mjs
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
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.mp3': 'audio/mpeg', '.json': 'application/json' };
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
  window.Audio = class { constructor(){ this.preload=''; } play(){ return Promise.resolve(); } pause(){} load(){} addEventListener(){} };
  window.__fireIntro = (type) => {
    const el = window.__intro && window.__intro.el;
    const list = el && el._ls && el._ls[type] ? el._ls[type].slice() : [];
    list.forEach(fn => fn());
  };
  window.__intro = { el: null };
  const Orig = window.Audio;
  window.Audio = class extends Orig {
    constructor(src) { super(); this.src = src; this._ls = {}; window.__intro.el = this; }
    addEventListener(type, fn) { (this._ls[type] ||= []).push(fn); }
    removeEventListener() {}
  };
  window.__srs = [];
  class FakeSR {
    constructor() { this.handlers = {}; window.__srs.push(this); }
    set onstart(fn) { this.handlers.start = fn; }
    set onend(fn) { this.handlers.end = fn; }
    set onerror(fn) { this.handlers.error = fn; }
    set onresult(fn) { this.handlers.result = fn; }
    set onaudiostart(fn) { this.handlers.audiostart = fn; }
    set onaudioend(fn) { this.handlers.audioend = fn; }
    set onsoundstart(fn) { this.handlers.soundstart = fn; }
    set onsoundend(fn) { this.handlers.soundend = fn; }
    set onspeechstart(fn) { this.handlers.speechstart = fn; }
    set onspeechend(fn) { this.handlers.speechend = fn; }
    set onnomatch(fn) { this.handlers.nomatch = fn; }
    start() { this.started = true; if (this.handlers.audiostart) this.handlers.audiostart(); if (this.handlers.start) this.handlers.start(); }
    stop() {}
    abort() { this.aborted = true; }
    fire(name, ev) { const fn = this.handlers[name]; if (fn) fn(ev); }
  }
  window.SpeechRecognition = FakeSR;
  window.webkitSpeechRecognition = FakeSR;
});
const page = await context.newPage();
await page.setViewportSize({ width: 390, height: 844 });

async function start(mode) {
  await page.goto(`http://127.0.0.1:${port}/index.html?ptt=0`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { document.getElementById('sound').checked = false; });
  await page.click('#micAuto');
  if (mode === 'solo') await page.click('#pcSolo');
  await page.click('#go');
  await page.waitForSelector('#half0');
  await page.evaluate(() => { try { window.__fireIntro('ended'); } catch (_) {} try { releaseIntro('ended'); } catch (_) {} });
  await page.waitForTimeout(80);
}

function rowInfo() {
  return page.evaluate(() => {
    const ids = ['sentStart','catCountry','catCity','catAnimal','catPlant','crazyBtn'];
    const bar = document.getElementById('topbar').getBoundingClientRect();
    const kids = [...document.getElementById('topbar').children].filter(el => el.getClientRects().length && !el.classList.contains('hidden'));
    const clipped = kids.filter(el => {
      const r = el.getBoundingClientRect();
      return r.left < bar.left - 1 || r.right > bar.right + 1 || r.width < 8;
    }).map(el => el.id);
    const buttons = ids.map(id => {
      const el = document.getElementById(id);
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { id, hidden: el.classList.contains('hidden') || r.width < 2, opacity: cs.opacity, filter: cs.filter, text: el.textContent.trim(), right: Math.round(r.right) };
    });
    return {
      buttons,
      wide: document.getElementById('playrow').scrollWidth <= 392,
      header: document.getElementById('topbar').scrollWidth <= document.getElementById('topbar').clientWidth + 1,
      clipped,
      sent: !!sent,
    };
  });
}

try {
  await start('two');
  let row = await rowInfo();
  const labels = row.buttons.map(b => b.text).join(',');
  const bright = row.buttons.every(b => !b.hidden && b.opacity !== '1' && (b.filter === 'none' || b.filter === ''));
  const rights = row.buttons.map(b => b.right);
  const ordered = rights.every((n, i) => i === 0 || rights[i - 1] >= n - 1);
  if (!bright || !ordered || !labels.startsWith('משפט,ארץ,עיר,חי,צומח') || !row.wide || !row.header || row.clipped.length) bad('2p row ' + JSON.stringify(row));
  else ok('2 players: the row starts dimmed and the header fits at 390px');

  await page.click('#sentStart');
  const armed = await page.evaluate(() => ({
    sent: getComputedStyle(document.getElementById('sentStart')).opacity,
    city: getComputedStyle(document.getElementById('catCity')).opacity,
    hint: document.getElementById('rowHint').classList.contains('hidden'),
  }));
  if (armed.sent !== '1' || armed.city === '1' || !armed.hint) bad('arm ' + JSON.stringify(armed));
  else ok('tapping משפט lights only that button');

  const pause = await page.evaluate(() => {
    const b = document.getElementById('pauseBtn');
    const cs = getComputedStyle(b);
    const show = (sel) => getComputedStyle(b.querySelector(sel)).display !== 'none';
    return {
      text: b.textContent.trim(),
      label: b.getAttribute('aria-label'),
      pause: show('.ico-pause'),
      play: show('.ico-play'),
      bg: cs.backgroundColor,
      paused,
    };
  });
  if (pause.text || pause.play || !pause.pause || pause.paused || pause.bg !== 'rgb(107, 44, 255)') bad('pause icon ' + JSON.stringify(pause));
  else ok('running game shows a purple pause icon and no label');
  const beforeClock = await page.evaluate(() => G.timeLeft);
  await page.click('#pauseBtn');
  await page.waitForTimeout(400);
  const held = await page.evaluate(() => {
    const b = document.getElementById('pauseBtn');
    const show = (sel) => getComputedStyle(b.querySelector(sel)).display !== 'none';
    return { play: show('.ico-play'), pause: show('.ico-pause'), paused, left: G.timeLeft, label: b.getAttribute('aria-label') };
  });
  if (!held.play || held.pause || !held.paused || held.left < beforeClock - 0.15 || held.label !== 'המשך') bad('paused ' + JSON.stringify({ ...held, beforeClock }));
  else ok('pause swaps to a play icon and holds the clock');
  await page.click('#pauseBtn');
  const resumed = await page.evaluate(() => ({ paused, label: document.getElementById('pauseBtn').getAttribute('aria-label') }));
  if (resumed.paused || resumed.label !== 'השהיה') bad('resume ' + JSON.stringify(resumed));
  else ok('play resumes the game');

  await start('solo');
  row = await rowInfo();
  const soloLabels = row.buttons.map(b => b.text).join(',');
  const soloBright = row.buttons.every(b => !b.hidden && b.opacity !== '1');
  if (!soloBright || !soloLabels.startsWith('משפט,ארץ,עיר,חי,צומח') || !row.header || row.clipped.length) bad('solo ' + JSON.stringify(row));
  else ok('solo shows the same full row');

  await start('two');
  await page.waitForFunction(() => window.__srs.some(s => s.started));
  const before = await page.evaluate(() => window.__srs.length);
  await page.evaluate(() => {
    const r = window.__srs[window.__srs.length - 1];
    r.fire('error', { error: 'not-allowed' });
  });
  await page.waitForTimeout(500);
  const auto = await page.evaluate(() => ({
    msg: document.getElementById('m0').textContent,
    checked: document.getElementById('autoMic').checked,
    starts: window.__srs.length,
    host: location.hostname,
  }));
  if (!auto.checked || auto.msg.includes('Safari') || auto.starts !== before) bad('auto denied ' + JSON.stringify(auto));
  else ok('an automatic not-allowed stays quiet and does not restart');

  await page.evaluate(() => { window.__srs.forEach(s => { s.started = false; }); });
  await page.click('#mic0');
  await page.waitForFunction(() => window.__srs.some(s => s.started));
  await page.evaluate(() => {
    const r = window.__srs[window.__srs.length - 1];
    r.fire('error', { error: 'not-allowed' });
  });
  const tapped = await page.evaluate(() => ({
    msg: document.getElementById('m0').textContent,
    host: location.hostname,
  }));
  if (!tapped.msg.includes(tapped.host) || tapped.msg.includes('localhost')) bad('tap denied ' + JSON.stringify(tapped));
  else ok('a tapped not-allowed names this site, not localhost');

  await page.evaluate(() => { const b = document.getElementById('verLblStart'); for (let i = 0; i < 5; i++) b.click(); });
  const copy = await page.evaluate(() => {
    const b = document.getElementById('dbgCopy');
    const r = b.getBoundingClientRect();
    return { text: b.textContent, w: r.width, h: r.height, top: r.top, hidden: document.getElementById('learnDbg').classList.contains('hidden') };
  });
  if (copy.hidden || !copy.text.includes('העתק הכל') || copy.w < 40 || copy.h < 30 || copy.top > 844) bad('copy ' + JSON.stringify(copy));
  else ok('the debug log shows Copy all on screen');

  if (problems.length) { console.log('\n' + problems.length + ' failed'); process.exitCode = 1; }
  else console.log('\nrow checks passed');
} finally {
  await browser.close();
  server.close();
}
