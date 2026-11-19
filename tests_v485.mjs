/**
 * HilinGo v4.8.5 — category hints, and hiding an inactive board once a turn.
 *   node tests_v485.mjs
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
const FINALS = {'ך':'כ','ם':'מ','ן':'נ','ף':'פ','ץ':'צ'};
const fold = w => String(w||'').replace(/[ךםןףץ]/g, ch => FINALS[ch] || ch);

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
const context = await browser.newContext();
await context.addInitScript(() => {
  window.Audio = class { play(){ return Promise.resolve(); } pause(){} load(){} addEventListener(){} };
  window.SpeechRecognition = class { start(){} stop(){} abort(){} };
});
const page = await context.newPage();
await page.setViewportSize({ width: 390, height: 844 });

async function boot(solo) {
  await page.goto(`http://127.0.0.1:${port}/index.html?ptt=0`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { document.getElementById('sound').checked = false; });
  if (solo) await page.click('#pcSolo');
  await page.click('#go');
  await page.waitForSelector('#half0');
  await page.evaluate(() => { try { releaseIntro('ended'); } catch (_) {} });
  await page.evaluate(() => loadCats('he'));
  await page.waitForFunction(() => catMemo.he);
}

try {
  const hints = JSON.parse(fs.readFileSync(path.join(ROOT, 'cats/he.json'), 'utf8'));
  const curated = fs.readFileSync(path.join(ROOT, 'cat_hints.js'), 'utf8');
  if (!curated.includes('חבש') || !curated.includes('חיפה')) bad('curated clues missing');
  else ok('curated clues are present');

  await boot(false);
  await page.evaluate(() => { G.required = 'ח'; render(); });
  await page.click('#catCountry');
  await page.click('#hb0');
  await page.waitForFunction(() => document.getElementById('hn0').dataset.answer);
  const country = await page.evaluate(() => ({
    answer: document.getElementById('hn0').dataset.answer,
    text: document.getElementById('hn0').textContent,
    used: G.hintsThisTurn,
    arm: arm,
  }));
  const cWord = fold(country.answer);
  const cOk = hints.country.includes(cWord) && cWord.startsWith('ח') && !country.text.includes(country.answer) && !country.text.includes('חלון') && country.text.includes('מדינה') && country.used === 1;
  if (!cOk) bad('country hint ' + JSON.stringify(country));
  else ok('ח + ארץ hints ' + country.answer + ' — ' + country.text.replace(/\s+/g, ' ').slice(0, 80));

  await page.click('#catAnimal');
  await page.click('#hb0');
  await page.waitForFunction(() => {
    const a = document.getElementById('hn0').dataset.answer || '';
    return foldCat(a).startsWith('ח') && catMemo.he.animal.has(foldCat(a));
  });
  const animal = await page.evaluate(() => ({
    answer: document.getElementById('hn0').dataset.answer,
    text: document.getElementById('hn0').textContent,
  }));
  const aWord = fold(animal.answer);
  if (!hints.animal.includes(aWord) || !aWord.startsWith('ח') || animal.text.includes(animal.answer)) bad('animal hint ' + JSON.stringify(animal));
  else ok('ח + חי hints ' + animal.answer + ' — ' + animal.text.replace(/\s+/g, ' ').slice(0, 80));

  const before = await page.evaluate(() => G.hintsThisTurn);
  await page.evaluate(() => {
    [...catMemo.he.country].filter(w => w.startsWith('ח')).forEach(w => catMemo.he.country.delete(w));
    hintUI.shown = new Set();
  });
  await page.click('#catCountry');
  await page.click('#hb0');
  await page.waitForFunction(() => document.getElementById('hn0').textContent.includes('אין מילה'));
  const none = await page.evaluate(() => ({ text: document.getElementById('hn0').textContent, used: G.hintsThisTurn, answer: document.getElementById('hn0').dataset.answer || '' }));
  if (none.answer || none.used !== before || !none.text.includes('אפשר לדלג')) bad('empty ' + JSON.stringify(none));
  else ok('no country for the letter shows a pass message and does not spend a hint');

  await boot(false);
  const eyes = await page.evaluate(() => ({
    on: document.getElementById('halves').classList.contains('veils'),
    active: getComputedStyle(document.getElementById('vb0')).display,
    idle: getComputedStyle(document.getElementById('vb1')).display,
    label: document.getElementById('vb1').textContent.trim(),
  }));
  if (!eyes.on || eyes.active !== 'none' || eyes.idle === 'none' || eyes.label) bad('eyes ' + JSON.stringify(eyes));
  else ok('only the inactive board shows an icon eye');

  await page.click('#vb1');
  const covered = await page.evaluate(() => {
    const cover = document.getElementById('vl1');
    const cs = getComputedStyle(cover);
    const btn = document.getElementById('vb1');
    return {
      hidden: cover.classList.contains('hidden'),
      digit: cover.querySelector('.veilnum').textContent,
      bg: cs.backgroundColor,
      events: cs.pointerEvents,
      disabled: btn.disabled,
      opacity: getComputedStyle(btn).opacity,
    };
  });
  if (covered.hidden || covered.digit !== '10' || covered.bg !== 'rgb(255, 45, 135)' || covered.events === 'none' || !covered.disabled || covered.opacity === '1') bad('cover ' + JSON.stringify(covered));
  else ok('the board covers in player pink with a 10, and the eye goes dim');

  const until = await page.evaluate(() => veilUntil[1]);
  await page.evaluate(() => hideBoard(1));
  const again = await page.evaluate(() => veilUntil[1]);
  if (again !== until) bad('second hide ' + until + ' ' + again);
  else ok('a second tap in the same turn does not hide again');

  await page.evaluate(() => {
    const cover = document.getElementById('vl1');
    const fire = (x) => cover.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: 200, bubbles: true }));
    fire(80); fire(84);
  });
  const disrupted = await page.evaluate(() => disruptCount);
  if (disrupted < 1) bad('cover disrupt ' + disrupted);
  else ok('a double tap on the cover still sends a disruption');

  await page.evaluate(() => { WG.addCustomWord('אבא'); });
  await page.fill('#in0', 'אבא');
  await page.click('#send0');
  const passed = await page.evaluate(() => ({
    turn: G.turn,
    cover: document.getElementById('vl1').classList.contains('hidden'),
    p0: document.getElementById('vb0').disabled,
    p1: document.getElementById('vb1').disabled,
  }));
  if (passed.turn !== 1 || !passed.cover || passed.p0 || !passed.p1) bad('turn ' + JSON.stringify(passed));
  else ok('the next turn reveals the board and arms the eye for the player who is waiting');

  await boot(true);
  const solo = await page.evaluate(() => ({
    on: document.getElementById('halves').classList.contains('veils'),
    show: getComputedStyle(document.getElementById('vb1')).display,
  }));
  if (solo.on || solo.show !== 'none') bad('solo ' + JSON.stringify(solo));
  else ok('solo does not offer a hide button');

  if (problems.length) { console.log('\n' + problems.length + ' failed'); process.exitCode = 1; }
  else console.log('\nv4.8.5 checks passed');
} finally {
  await browser.close();
  server.close();
}
