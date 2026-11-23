/**
 * HilinGo v4.11.14 — the translation mic keeps restarting, and the results screen can close.
 *   node tests_trmic.mjs
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
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await context.addInitScript(() => {
  window.__langs = [];
  window.__drops = 0;
  window.__say = '';
  window.__live = null;
  const synth = {
    cancel(){}, resume(){}, getVoices(){ return []; },
    addEventListener(){}, removeEventListener(){},
    speak(u){
      window.__utt = u;
      setTimeout(() => { try { if (u.onstart) u.onstart(); } catch (_) {} setTimeout(() => { try { if (u.onend) u.onend(); } catch (_) {} }, 15); }, 5);
    }
  };
  try { Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: synth }); }
  catch (_) { window.speechSynthesis = synth; }
  window.SpeechSynthesisUtterance = function (text) { this.text = text; this.lang = ''; this.onend = null; this.onstart = null; this.onerror = null; };
  class FakeSR {
    constructor(){ this.lang = ''; }
    start(){
      window.__live = this;
      window.__langs.push(this.lang);
      const self = this;
      setTimeout(() => {
        if (self.onstart) self.onstart();
        if (self.onaudiostart) self.onaudiostart();
        if (window.__drops > 0) { window.__drops--; setTimeout(() => { if (self.onend) self.onend(); }, 20); return; }
        const text = window.__say || '';
        if (text && self.onresult) {
          const item = { isFinal: true, length: 1, 0: { transcript: text } };
          self.onresult({ results: { length: 1, 0: item } });
        }
      }, 10);
    }
    abort(){ this.onend = null; this.aborted = true; }
    stop(){ this.abort(); }
  }
  window.SpeechRecognition = FakeSR;
  window.webkitSpeechRecognition = FakeSR;
  window.Audio = class { play(){ return Promise.resolve(); } pause(){} load(){} addEventListener(){} };
});
const page = await context.newPage();
page.on('pageerror', e => bad('page ' + e.message));

const expect = {
  it: 'it-IT', es: 'es-ES', en: 'en-US', nl: 'nl-NL', pt: 'pt-BR'
};
const words = ['כלב', 'בית', 'תפוח', 'חלון', 'נחש', 'שמש', 'שולחן', 'נמר', 'ראש', 'שמח'];

try {
  await page.goto(`http://127.0.0.1:${port}/index.html?ptt=0`, { waitUntil: 'domcontentloaded' });
  const audit = await page.evaluate(() => {
    const list = ['ריצה','תמיר','הרד','ראשון','נור','שבת','ראש','הרבה','נחלה','המנון','דירה','אחד','דובר','עז','פה','הלכו','הלכה','כבשה'];
    const out = {};
    for (const w of list) out[w] = { it: dictTranslate('he','it', w) || '', es: dictTranslate('he','es', w) || '' };
    return out;
  });
  const want = {
    'ריצה': ['corsa', 'carrera'],
    'ראשון': ['primo', 'primero'],
    'שבת': ['sabato', 'sábado'],
    'ראש': ['testa', 'cabeza'],
    'הרבה': ['molto', 'mucho'],
    'נחלה': ['eredità', 'herencia'],
    'המנון': ['inno', 'himno'],
    'דירה': ['appartamento', 'apartamento'],
    'אחד': ['uno', 'uno'],
    'דובר': ['portavoce', 'portavoz'],
    'עז': ['capra', 'cabra'],
    'פה': ['bocca', 'boca'],
    'הלכו': ['sono andati', 'fueron'],
  };
  for (const [w, pair] of Object.entries(want)) {
    const got = audit[w];
    if (!got || got.it !== pair[0] || got.es !== pair[1]) bad(w + ' ' + JSON.stringify(got));
  }
  if (audit['תמיר'].it || audit['הרד'].it || audit['נור'].it) bad('names translated ' + JSON.stringify({ תמיר: audit['תמיר'], הרד: audit['הרד'], נור: audit['נור'] }));
  else ok('names and nonsense are not translated');
  if (!problems.length) ok('curated he→it/es sample');

  await page.evaluate(() => {
    localStorage.setItem('hilingo_bank', JSON.stringify([
      { src: 'he', dst: 'it', from: 'ריצה', to: 'Ritz' },
      { src: 'he', dst: 'it', from: 'תמיר', to: 'Alto' },
      { src: 'he', dst: 'it', from: 'הרד', to: 'scaricamento' },
      { src: 'he', dst: 'it', from: 'ראשון', to: 'prima' },
      { src: 'he', dst: 'it', from: 'נור', to: 'bagliore' },
      { src: 'he', dst: 'it', from: 'שבת', to: 'Sabato' },
      { src: 'he', dst: 'it', from: 'אחד', to: 'uno' },
    ]));
    localStorage.removeItem('hilingo_bank_v4101');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const bank = await page.evaluate(() => readBank().map(x => x.from + '→' + x.to));
  console.log('  bank', bank.join(' | '));
  const badLeft = bank.filter(x => /→(Ritz|Alto|scaricamento|bagliore|prima|Sabato)$/.test(x));
  if (badLeft.length) bad('bad pairs kept ' + badLeft.join(','));
  else ok('bad saved pairs are gone or corrected');
  if (!bank.includes('ריצה→corsa') || !bank.includes('ראשון→primo') || !bank.includes('שבת→sabato')) bad('replacements ' + bank.join(','));
  else ok('ריצה, ראשון and שבת were rewritten');

  await page.evaluate(() => { document.getElementById('sound').checked = false; });
  await page.click('#go');
  await page.waitForSelector('#half0');
  await page.evaluate(() => { try { releaseIntro('ended'); } catch (_) {} G.winner = -1; G.reason = 'manual'; endScreen(); });
  await page.waitForSelector('#endov:not(.hidden)');
  const box = await page.locator('#endClose').boundingBox();
  const title = await page.locator('#endTitle').innerText();
  if (!box || box.width < 44 || box.height < 44) bad('close size ' + JSON.stringify(box));
  else ok('close button is ' + Math.round(box.width) + '×' + Math.round(box.height));
  if (!title.includes('תיקו')) bad('title ' + title);
  else ok('title ' + title);
  await page.screenshot({ path: path.join(SHOTS, 'v4101-end.png') });
  await page.click('#endClose');
  const home = await page.evaluate(() => ({
    end: document.getElementById('endov').classList.contains('hidden'),
    start: !document.getElementById('start').classList.contains('hidden'),
    game: document.getElementById('game').classList.contains('hidden'),
  }));
  if (!home.end || !home.start || !home.game) bad('home ' + JSON.stringify(home));
  else ok('X closes the results and returns home');

  const only = (process.env.ONLY || '').split(',').filter(Boolean);
  for (const lang of Object.keys(expect).filter(l => !only.length || only.includes(l))) {
    await page.goto(`http://127.0.0.1:${port}/index.html?ptt=0`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => { document.getElementById('sound').checked = false; window.__langs = []; });
    await page.click(`#trLangs .opt[data-tr="${lang}"]`);
    await page.click('#micAuto');
    await page.click('#go');
    await page.waitForSelector('#half0');
    await page.evaluate(() => { try { releaseIntro('ended'); } catch (_) {} });
    let heard = 0;
    for (let n = 0; n < words.length; n++) {
      const word = words[n];
      const mark = await page.evaluate(() => window.__langs.length);
      await page.evaluate(drops => { window.__drops = drops; window.__say = ''; }, n === 0 ? 2 : 1);
      const p = await page.evaluate(() => G.turn);
      await page.evaluate(w => { try { WG.addCustomWord(w); } catch (_) {} }, word);
      await page.fill('#in' + p, word);
      await page.click('#send' + p);
      const opened = await page.waitForSelector('#trOv:not(.hidden)', { timeout: 8000 }).then(() => true, async () => {
        const snap = await page.evaluate(() => ({
          turn: G && G.turn,
          msg: (document.querySelector('#m' + (G ? G.turn : 0)) || {}).textContent || '',
          ov: document.getElementById('trOv').className,
          hist: document.getElementById('history').textContent,
          langs: window.__langs.slice(),
        }));
        console.log('  no card', word, JSON.stringify(snap));
        return false;
      });
      if (!opened) { bad(lang + ' no card for ' + word); break; }
      const shown = (await page.locator('#trWord').innerText()).trim();
      await page.evaluate(shownWord => { window.__say = shownWord; }, shown);
      if (lang === 'it' && n === 0) {
        await page.waitForFunction(() => trDeaf === false, { timeout: 8000 });
        await page.screenshot({ path: path.join(SHOTS, 'v4101-it-challenge.png') });
      }
      const good = await page.waitForSelector('#trOv.good', { timeout: 25000 }).then(() => true, async () => {
        const snap = await page.evaluate(() => ({
          target: trTarget, alts: trAlts, phase: trPhase, drops: window.__drops, say: window.__say,
          langs: window.__langs.slice(-8), scored: trScored, cls: document.getElementById('trOv').className,
        }));
        console.log('  no good', lang, n, word, JSON.stringify(snap));
        return false;
      });
      if (!good) { bad(lang + ' missed ' + word); break; }
      await page.waitForFunction(() => document.getElementById('trOv').classList.contains('hidden'), { timeout: 4000 });
      await page.waitForFunction(start => window.__langs.slice(start).includes('he-IL'), mark, { timeout: 4000 });
      const langs = await page.evaluate(start => window.__langs.slice(start), mark);
      const tag = expect[lang];
      if (!langs.includes(tag)) bad(lang + ' turn ' + (n + 1) + ' langs ' + langs.join(','));
      if (!langs.includes('he-IL')) bad(lang + ' turn ' + (n + 1) + ' did not return to Hebrew ' + langs.join(','));
      const challengeStarts = langs.filter(x => x === tag).length;
      if (n === 0 && challengeStarts !== 3) bad(lang + ' started ' + challengeStarts + ' times');
      heard++;
    }
    if (heard === 10) ok(lang + ' heard 10 challenges in a row (' + expect[lang] + ')');
  }

  await page.goto(`http://127.0.0.1:${port}/index.html?ptt=0`, { waitUntil: 'domcontentloaded' });
  await page.locator('#verLblStart').dispatchEvent('pointerdown');
  await page.waitForTimeout(750);
  const logOpen = await page.evaluate(() => !document.getElementById('diag').classList.contains('hidden'));
  await page.locator('#verLblStart').dispatchEvent('pointerup');
  if (!logOpen) bad('long-press did not open the mic log');
  else ok('long-press on the version label opens the mic log');
} finally {
  await browser.close();
  server.close();
}

if (problems.length) {
  console.log('\n' + problems.length + ' failed');
  process.exit(1);
}
console.log('\nmic and result checks passed');
