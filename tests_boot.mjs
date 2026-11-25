/**
 * HilinGo v4.13.21 — the home screen must load with no page error.
 * A saved solo record used to read SOLO_CAP before its const ran.
 *   node tests_boot.mjs
 */
import { chromium, webkit } from 'playwright-core';
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

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const capAt = html.indexOf('const SOLO_CAP');
const bootAt = html.indexOf("applyLang('he')");
if (capAt < 0 || bootAt < 0 || capAt > bootAt) bad('SOLO_CAP is not declared before applyLang');
else ok('SOLO_CAP is declared before startup');

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

function stub(context) {
  return context.addInitScript(() => {
    class FakeAudio {
      constructor() { this.preload = ''; this.paused = true; this.currentTime = 0; }
      load() {}
      play() { this.paused = false; return Promise.resolve(); }
      pause() { this.paused = true; }
      addEventListener() {}
      removeEventListener() {}
    }
    window.Audio = FakeAudio;
    class FakeSR { start() {} stop() {} abort() {} }
    window.SpeechRecognition = FakeSR;
    window.webkitSpeechRecognition = FakeSR;
  });
}

async function open(browser, seed) {
  const context = await browser.newContext();
  await stub(context);
  if (seed) {
    await context.addInitScript(saved => {
      localStorage.clear();
      for (const [k, v] of Object.entries(saved)) localStorage.setItem(k, v);
    }, seed);
  } else {
    await context.addInitScript(() => { localStorage.clear(); });
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(String(err && err.message || err)));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:${port}/index.html?ptt=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(150);
  return { page, context, errors };
}

async function assertClean(page, errors, tag) {
  const bar = await page.evaluate(() => {
    const e = document.getElementById('errbar');
    return { hidden: !e || e.classList.contains('hidden'), text: e ? e.textContent : '' };
  });
  if (errors.length) bad(tag + ' pageerror ' + errors.join(' | '));
  else if (!bar.hidden || /שגיאה|ReferenceError|before initialization/.test(bar.text)) bad(tag + ' banner ' + bar.text);
  else ok(tag + ' no page error');
}

const saved = {
  hilingo_solo_best2_he: '127',
  hilingo_solo_best2_en: '65',
  hilingo_solo_best2_pt: '40',
  hilingo_solo_best2_nl: '50',
  hilingo_automic_v2: '1',
  hilingo_learn_he_pt: JSON.stringify([{ n: 'כלב', t: 'cachorro' }]),
  hilingo_custom_words_he: JSON.stringify(['שלום']),
};

try {
  const engines = [
    ['chromium', await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] })],
  ];
  try { engines.push(['webkit', await webkit.launch()]); }
  catch (e) { bad('webkit launch ' + e.message); }

  for (const [tag, browser] of engines) {
    try {
      const legacy = await open(browser, { hilingo_automic_v2: '0', hilingo_automic: '0' });
      const mic = await legacy.page.evaluate(() => ({
        on: document.getElementById('autoMic').checked,
        mode: localStorage.getItem('hilingo_mic_v4111'),
        old: localStorage.getItem('hilingo_automic_v2'),
        tap: document.getElementById('micTap').classList.contains('sel'),
      }));
      if (mic.on || mic.mode !== 'tap' || !mic.tap) bad(tag + ' legacy mic ' + JSON.stringify(mic));
      else ok(tag + ' an old auto value loads as tap');
      await legacy.context.close();
      const fresh = await open(browser, null);
      await assertClean(fresh.page, fresh.errors, tag + ' fresh');
      const ver = await fresh.page.evaluate(() => document.querySelector('meta[name="hilingo-version"]').content);
      if (tag === 'chromium' && ver !== '4.13.21') bad('version ' + ver);
      if (tag === 'chromium') {
        const labels = await fresh.page.evaluate(() => {
          const want = ['he','en','nl','pt','es','it'];
          return want.map(code => {
            applyLang(code);
            showTrReplay(true);
            const b = document.getElementById('trReplay');
            const rules = document.getElementById('rules').textContent;
            return {
              code,
              text: document.getElementById('trReplayLbl').textContent,
              dir: b.dir,
              five: /5/.test(rules),
              auto: /אוטומטי|Automatic|Automatisch|Automático|Automatico/.test(rules),
              old: /turns itself on every turn|נדלק לבד בכל תור/.test(rules),
            };
          });
        });
        const expect = { he:['שמע שוב','rtl'], en:['Hear again','ltr'], nl:['Opnieuw horen','ltr'], pt:['Ouvir de novo','ltr'], es:['Escuchar otra vez','ltr'], it:['Ascolta ancora','ltr'] };
        const badRow = labels.find(row => row.text !== expect[row.code][0] || row.dir !== expect[row.code][1] || !row.five || !row.auto || row.old);
        if (badRow) bad('replay labels ' + JSON.stringify(badRow));
        else ok('replay button and rules follow the UI language');
        await fresh.page.evaluate(() => { applyLang('he'); showTrReplay(false); });
      }
      await fresh.context.close();

      const kept = await open(browser, saved);
      await assertClean(kept.page, kept.errors, tag + ' saved');
      const rec = (await kept.page.locator('#soloBest').innerText()).trim();
      if (!rec.startsWith('My New record ')) bad(tag + ' record ' + rec);
      else ok(tag + ' record paints ' + rec);
      if (tag === 'chromium') await kept.page.screenshot({ path: path.join(SHOTS, 'v441-home.png') });
      await kept.page.evaluate(() => {
        setPlayers('solo');
        setPlayers(4);
        setMode('learn');
        setMode('play');
        setPlayers(4);
      });
      await assertClean(kept.page, kept.errors, tag + ' modes');
      const n4 = await kept.page.locator('#n4').isVisible();
      const learnHidden = await kept.page.locator('#learn').evaluate(el => el.classList.contains('hidden'));
      if (!n4 || !learnHidden) bad(tag + ' home after modes n4=' + n4 + ' learnHidden=' + learnHidden);
      else ok(tag + ' solo, 4 players, and learn mode do not throw');
      await kept.context.close();
    } finally {
      await browser.close();
    }
  }
} finally {
  server.close();
}

if (problems.length) {
  console.log('\n' + problems.length + ' failure(s)');
  process.exit(1);
}
console.log('\nboot checks passed');
