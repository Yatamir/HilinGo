/**
 * HilinGo v4.11.12 — iPad / tablet boards must fit.
 *   npm install playwright-core
 *   node tests_tablet.mjs
 * Uses system Google Chrome (override with CHROME=...).
 * Serves this directory itself. Fails if a letter tile overlaps the controls,
 * leaves the viewport, or a second board is clipped. Phone and desktop are
 * included so the tablet rules don't regress them.
 */
import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';

const VIEWPORTS = [
  [768, 1024],
  [1024, 768],
  [820, 1180],
  [1180, 820],
  [1024, 1366],
  [1024, 640], // iPad landscape with Safari's tab bar eating height
  [390, 844],
  [1440, 900],
];

function serve(root) {
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.mp3': 'audio/mpeg' };
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
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function measure(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const boards = [...document.querySelectorAll('.half')].map(half => {
      const tiles = [...half.querySelectorAll('.tile')].map(t => {
        const r = t.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, text: t.textContent, inactive: t.classList.contains('inactive') };
      });
      const input = half.querySelector('.inputs').getBoundingClientRect();
      const hrow = half.querySelector('.hrow');
      const hr = hrow ? hrow.getBoundingClientRect() : null;
      const box = half.getBoundingClientRect();
      const hrowShown = hr && hr.width > 2 && hr.height > 2 && getComputedStyle(hrow).display !== 'none';
      const inputShown = input.width > 2 && input.height > 2 && getComputedStyle(half.querySelector('.inputs')).visibility !== 'hidden';
      return {
        id: half.id,
        n: tiles.length,
        tiles,
        tile: tiles[0] ? { w: tiles[0].width, h: tiles[0].height } : null,
        inactive: tiles.filter(t => t.inactive).map(t => t.text).join(''),
        inputShown,
        hrowShown,
        overlapInput: inputShown ? tiles.filter(t => overlapBox(t, input) > 1).length : 0,
        overlapHrow: hrowShown ? tiles.filter(t => overlapBox(t, hr) > 1).length : 0,
        inputBelow: !inputShown || !tiles.length || input.top + 0.5 >= Math.max(...tiles.map(t => t.bottom)) - 1,
        halfOff: box.left < -1 || box.right > vw + 1 || box.top < -1 || box.bottom > vh + 1,
      };
      function overlapBox(t, b) {
        const x = Math.max(0, Math.min(t.right, b.right) - Math.max(t.left, b.left));
        const y = Math.max(0, Math.min(t.bottom, b.bottom) - Math.max(t.top, b.top));
        return x * y;
      }
    });
    const clipped = boards.flatMap(b => b.tiles.filter(t => t.left < -0.5 || t.right > vw + 0.5 || t.top < -0.5 || t.bottom > vh + 0.5).map(t => b.id + ':' + t.text));
    return {
      vw, vh,
      ver: document.querySelector('meta[name="hilingo-version"]').content,
      dir: document.documentElement.dir,
      scrollW: document.documentElement.scrollWidth,
      zBefore: getComputedStyle(document.querySelector('.ptimer'), '::before').zIndex,
      boards, clipped,
    };
  });
}

const problems = [];
function bad(msg) { problems.push(msg); console.log('  FAIL', msg); }
function ok(msg) { console.log('  ok  ', msg); }

const server = await serve(ROOT);
const port = server.address().port;
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext();
await context.addInitScript(() => {
  class FakeSR { start() {} stop() {} abort() {} }
  window.SpeechRecognition = FakeSR;
  window.webkitSpeechRecognition = FakeSR;
});

try {
  for (const lang of ['pt', 'he']) {
    for (const [w, h] of VIEWPORTS) {
      const page = await context.newPage();
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`http://127.0.0.1:${port}/index.html?ptt=1`, { waitUntil: 'domcontentloaded' });
      await page.evaluate((lang) => {
        document.querySelector(`#langs .opt[data-lang="${lang}"]`).click();
        document.querySelector('.pc[data-n="2"]').click();
        const mic = document.getElementById('autoMic');
        if (mic) mic.checked = false;
      }, lang);
      await page.click('#go');
      await page.waitForSelector('#halves .tile');
      await page.evaluate(() => {
        const mic = document.getElementById('mic0');
        if (mic) mic.classList.add('on', 'ptt');
        const hd = document.getElementById('hd0');
        if (hd) hd.textContent = document.documentElement.lang === 'he' ? 'מקשיב…' : 'Ouvindo…';
        document.getElementById('pauseBtn').click();
      });
      const m = await measure(page);
      const label = `${lang} ${w}x${h}`;
      const fails = [];
      if (m.ver !== '4.11.12') fails.push('version ' + m.ver);
      if (m.scrollW > w + 2) fails.push('horizontal scroll ' + m.scrollW);
      if (m.zBefore === '-1') fails.push('timer ring still z-index -1');
      if (m.clipped.length) fails.push('tiles offscreen ' + m.clipped.slice(0, 8).join(','));
      for (const b of m.boards) {
        if (b.n !== (lang === 'pt' ? 26 : 22)) fails.push(b.id + ' count ' + b.n);
        if (!b.tile || b.tile.w < 16 || Math.abs(b.tile.w - b.tile.h) > 2) fails.push(b.id + ' tile ' + JSON.stringify(b.tile));
        if (b.overlapInput) fails.push(b.id + ' overlaps controls ' + b.overlapInput);
        if (b.overlapHrow) fails.push(b.id + ' overlaps heard row ' + b.overlapHrow);
        if (!b.inputBelow) fails.push(b.id + ' controls not below the grid');
        if (b.halfOff) fails.push(b.id + ' board outside the viewport');
        if (w >= 1400 && b.tile.w < 60) fails.push(b.id + ' desktop tiles shrunk to ' + b.tile.w);
      }
      if (lang === 'pt' && m.boards[0].inactive !== 'KWY') fails.push('K/W/Y not dimmed (' + m.boards[0].inactive + ')');
      if (lang === 'he') {
        if (m.dir !== 'rtl') fails.push('dir ' + m.dir);
        if (m.boards[0].inactive) fails.push('Hebrew tiles dimmed ' + m.boards[0].inactive);
      }
      if (fails.length) bad(label + ' — ' + fails.join('; '));
      else ok(label + ' tiles ' + m.boards.map(b => Math.round(b.tile.w) + 'px').join('/'));
      await page.close();
    }
  }

  // A typed Portuguese word still removes its first letter and chains on the last.
  {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(`http://127.0.0.1:${port}/index.html?ptt=0`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      document.querySelector('#langs .opt[data-lang="pt"]').click();
      document.getElementById('autoMic').checked = false;
    });
    await page.click('#go');
    await page.waitForSelector('#in0');
    await page.fill('#in0', 'casa');
    await page.click('#send0');
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => ({
      turn: G.turn,
      required: G.required,
      c: document.querySelector('#t0 [data-l="C"]').className,
      k: document.querySelector('#t0 [data-l="K"]').className,
    }));
    if (r.turn !== 1 || r.required !== 'A' || !/\bgone\b/.test(r.c) || !/\binactive\b/.test(r.k)) {
      bad('play casa — ' + JSON.stringify(r));
    } else ok('casa removes C, next word starts with A, K stays inactive');
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

if (problems.length) {
  console.log('\n' + problems.length + ' failure(s)');
  process.exit(1);
}
console.log('\nall tablet layout checks passed');
