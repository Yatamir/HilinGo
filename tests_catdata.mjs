/**
 * HilinGo v4.11.10 — category files, lazy load, and the Wikidata fallback.
 *   node tests_catdata.mjs
 */
import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { gzipSync } from 'zlib';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const problems = [];
const bad = (m) => { problems.push(m); console.log('  FAIL', m); };
const ok = (m) => console.log('  ok  ', m);

const samples = {
  he: { country: 'צרפת', city: 'חיפה', animal: 'נמר', plant: 'ורד' },
  en: { country: 'brazil', city: 'lisbon', animal: 'cat', plant: 'tulip' },
  nl: { country: 'nederland', city: 'amsterdam', animal: 'kat', plant: 'tulp' },
  pt: { country: 'brasil', city: 'lisboa', animal: 'gato', plant: 'rosa' },
};
for (const [lang, need] of Object.entries(samples)) {
  const raw = fs.readFileSync(path.join(ROOT, 'cats', lang + '.json'));
  const data = JSON.parse(raw);
  const gz = gzipSync(raw).length;
  if (raw.length > 150000) bad(lang + ' too big ' + raw.length);
  else ok(lang + ' ' + raw.length + ' bytes, gzip ' + gz);
  for (const [kind, word] of Object.entries(need)) {
    if (!data[kind].includes(word)) bad(lang + ' missing ' + kind + ' ' + word);
  }
  ok(lang + ' samples ' + Object.values(need).join(' '));
}

function serve(root) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.mp3': 'audio/mpeg' };
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

const cityYes = {
  entities: {
    Q515: {
      claims: {
        P31: [{ mainsnak: { datavalue: { value: { id: 'Q515' } } } }],
      },
    },
  },
};
function installSR(context) {
  return context.addInitScript(() => {
    window.Audio = class { constructor(){ this.preload=''; } play(){ return Promise.resolve(); } pause(){} load(){} addEventListener(){} };
    window.SpeechRecognition = class { start(){} stop(){} abort(){} };
    window.webkitSpeechRecognition = window.SpeechRecognition;
  });
}
async function boot(page) {
  await page.goto(page.url() ? page.url() : 'about:blank');
}

const server = await serve(ROOT);
const port = server.address().port;
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

async function newGame(page) {
  await page.goto(`http://127.0.0.1:${port}/index.html?ptt=0`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { document.getElementById('sound').checked = false; });
  await page.click('#go');
  await page.waitForSelector('#half1');
  await page.evaluate(() => { try { releaseIntro('ended'); } catch (_) {} ['אבא','עץ','אטלנטיס','אגס'].forEach(w => WG.addCustomWord(w)); });
  await page.waitForFunction(() => window.__catsReady === 'he');
}

try {
  {
    const context = await browser.newContext();
    await installSR(context);
    const page = await context.newPage();
    const urls = [];
    page.on('request', req => { if (req.url().includes('/cats/')) urls.push(req.url()); });
    await page.route(/wikidata\.org/, route => route.abort());
    await newGame(page);
    const langs = [...new Set(urls.map(u => (u.match(/cats\/(\w+)/) || [])[1]))];
    if (langs.length !== 1 || langs[0] !== 'he') bad('loaded ' + langs.join(',') + ' ' + urls.join(' '));
    else ok('only the Hebrew list is loaded');
    await context.close();
  }

  {
    const context = await browser.newContext();
    await installSR(context);
    const page = await context.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route(/wikidata\.org/, async route => {
      const url = route.request().url();
      if (url.includes('wbsearchentities')) {
        await new Promise(r => setTimeout(r, 400));
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ search: [{ id: 'Q515' }] }) });
      } else {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(cityYes) });
      }
    });
    await newGame(page);
    await page.click('#catCity');
    await page.fill('#in0', 'אבא');
    await page.click('#send0');
    const before = await page.evaluate(() => G.timeLeft);
    const pending = page.waitForSelector('#catCheck:not(.hidden)');
    await page.fill('#in1', 'אטלנטיס');
    await page.click('#send1');
    await pending;
    ok('checking indicator shows while Wikidata is asked');
    await page.waitForFunction(() => G.history.some(h => h.word === 'אטלנטיס'));
    const after = await page.evaluate(() => ({ t: G.timeLeft, judge: !document.getElementById('catJudge').classList.contains('hidden') }));
    if (after.judge || after.t < before - 1) bad('confirm ' + JSON.stringify({ ...after, before }));
    else ok('Wikidata confirmation accepts the word and the clock waits');
    await context.close();
  }

  {
    const context = await browser.newContext();
    await installSR(context);
    const page = await context.newPage();
    await page.route(/wikidata\.org/, route => route.fulfill({ contentType: 'application/json', body: '{"search":[]}' }));
    await newGame(page);
    await page.click('#catCountry');
    await page.fill('#in0', 'אבא');
    await page.click('#send0');
    await page.fill('#in1', 'אטלנטיס');
    await page.click('#send1');
    await page.waitForSelector('#catJudge:not(.hidden)');
    const stay = await page.evaluate(() => ({ turn: G.turn, words: G.history.map(h => h.word).filter(Boolean) }));
    if (stay.turn !== 1 || stay.words.includes('אטלנטיס')) bad('empty ' + JSON.stringify(stay));
    else ok('nothing on Wikidata asks the players and does not reject');
    await context.close();
  }

  {
    const context = await browser.newContext();
    await installSR(context);
    const page = await context.newPage();
    await page.route(/wikidata\.org/, route => route.abort());
    await newGame(page);
    await page.click('#catCountry');
    await page.fill('#in0', 'אבא');
    await page.click('#send0');
    const before = await page.evaluate(() => G.timeLeft);
    await page.fill('#in1', 'אטלנטיס');
    await page.click('#send1');
    await page.waitForSelector('#catJudge:not(.hidden)', { timeout: 8000 });
    const after = await page.evaluate(() => G.timeLeft);
    if (after < before - 1) bad('timeout clock ' + before + ' -> ' + after);
    else ok('offline or a timeout still asks the players, clock held');
    await context.close();
  }

  if (problems.length) { console.log('\n' + problems.length + ' failed'); process.exitCode = 1; }
  else console.log('\ncat data checks passed');
} finally {
  await browser.close();
  server.close();
}
