/**
 * HilinGo v4.12.1 — category round, and the sentence strip starts on the right.
 *   node tests_categories.mjs
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
  window.Audio = class { constructor(){ this.preload=''; } play(){ return Promise.resolve(); } pause(){} load(){} addEventListener(){} };
  window.SpeechRecognition = class { start(){} stop(){} abort(){} };
  window.webkitSpeechRecognition = window.SpeechRecognition;
});
const page = await context.newPage();
await page.route(/wikidata\.org/, route => route.abort());
await page.setViewportSize({ width: 390, height: 844 });

async function boot() {
  await page.goto(`http://127.0.0.1:${port}/index.html?ptt=0`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { document.getElementById('sound').checked = false; });
  await page.click('#go');
  await page.waitForSelector('#half1');
  await page.evaluate(() => { try { releaseIntro('ended'); } catch (_) {} ['אבא','אגס','אנגליה','היפופוטם'].forEach(w => WG.addCustomWord(w)); });
}

try {
  await boot();
  await page.fill('#in0', 'אבא');
  await page.click('#send0');
  await page.click('#sentStart');
  await page.fill('#in1', 'אגס');
  await page.click('#send1');
  const strip = await page.evaluate(() => {
    const hist = document.getElementById('history');
    const word = hist.querySelector('.sentword');
    const hr = hist.getBoundingClientRect();
    const wr = word ? word.getBoundingClientRect() : null;
    return {
      text: hist.textContent,
      green: hist.querySelectorAll('.sentword').length,
      rightGap: wr ? Math.round(hr.right - wr.right) : 999,
    };
  });
  if (strip.text.includes('אבא') || !strip.text.includes('אגס') || strip.green !== 1 || strip.rightGap > 24) bad('strip ' + JSON.stringify(strip));
  else ok('sentence strip drops the old words and starts at the right');

  await boot();
  const row = await page.evaluate(() => {
    const ids = ['sentStart','catCountry','catCity','catAnimal','catPlant','crazyBtn'];
    const boxes = ids.map(id => {
      const el = document.getElementById(id);
      const r = el.getBoundingClientRect();
      return { id, hidden: el.classList.contains('hidden'), text: el.textContent.trim(), right: Math.round(r.right), w: Math.round(r.width) };
    });
    const greens = boxes.filter(b => b.id === 'sentStart');
    const cs = getComputedStyle(document.getElementById('sentStart'));
    return { boxes, bg: cs.backgroundColor, color: cs.color, wide: document.getElementById('playrow').scrollWidth <= 390 };
  });
  const vis = row.boxes.filter(b => !b.hidden);
  const rights = vis.map(b => b.right);
  const ordered = rights.every((n, i) => i === 0 || rights[i - 1] >= n - 1);
  const labels = vis.map(b => b.text).join(',');
  if (!ordered || !labels.startsWith('משפט,ארץ,עיר,חי,צומח') || !row.bg.includes('18, 138, 62') || row.color !== 'rgb(255, 255, 255)') bad('row ' + JSON.stringify(row));
  else ok('button row is right-to-left and משפט is green');

  await page.click('#catCountry');
  await page.fill('#in0', 'אבא');
  await page.click('#send0');
  const size0 = await page.evaluate(() => G.boards.map(b => b.size));
  const banner = await page.locator('#catBanner').innerText();
  const sentShown = await page.locator('#sentStart').isVisible();
  if (!sentShown || !banner.includes('ארץ') || !banner.includes('א')) bad('banner ' + banner + ' sentShown ' + sentShown);
  else ok('category banner tells the next player the letter');

  await page.fill('#in1', 'אגס');
  await page.click('#send1');
  await page.waitForSelector('#catJudge:not(.hidden)', { timeout: 8000 });
  const judge = await page.locator('#catJudge').isVisible();
  const still = await page.evaluate(() => ({ turn: G.turn, sizes: G.boards.map(b => b.size), streak: G.missStreak }));
  if (!judge || still.turn !== 1 || still.sizes.join() !== size0.join()) bad('judge ' + judge + ' ' + JSON.stringify(still));
  else ok('a word missing from the list asks the players');
  await page.click('#catNo');
  const noed = await page.evaluate(() => ({ turn: G.turn, judge: !document.getElementById('catJudge').classList.contains('hidden') }));
  if (noed.turn !== 1 || noed.judge) bad('reject ' + JSON.stringify(noed));
  else ok('✗ keeps the turn');

  await page.click('#catPass');
  const passed = await page.evaluate(() => ({ turn: G.turn, sizes: G.boards.map(b => b.size), streak: G.missStreak, cat: cat }));
  if (passed.turn !== 0 || passed.streak !== 0 || passed.cat || passed.sizes.join() !== size0.join()) bad('pass ' + JSON.stringify(passed));
  else ok('pass moves the turn with no penalty');

  await page.click('#catAnimal');
  await page.fill('#in0', 'אנגליה');
  await page.click('#send0');
  const before = await page.evaluate(() => G.boards[1].size);
  await page.fill('#in1', 'היפופוטם');
  await page.click('#send1');
  await page.waitForFunction(() => G.history.some(h => h.word === 'היפופוטם'), null, { timeout: 8000 });
  const got = await page.evaluate(() => ({
    size: G.boards[1].size,
    cat: cat,
    turn: G.turn,
    words: G.history.filter(h => h.word).map(h => h.word),
  }));
  if (got.size !== before - 1 || got.cat || !got.words.includes('היפופוטם')) bad('accept ' + JSON.stringify(got));
  else ok('a listed category word deletes one letter and nothing extra');

  if (problems.length) { console.log('\n' + problems.length + ' failed'); process.exitCode = 1; }
  else console.log('\ncategory checks passed');
} finally {
  await browser.close();
  server.close();
}
