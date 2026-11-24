/**
 * HilinGo v4.13.11 — phrases chain from the last word, and learning translates the whole sentence.
 *   node tests_phrase.mjs
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
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.mp3': 'audio/mpeg' };
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

const MAP = {
  'מה השעה': 'Che ore sono?',
  'איפה השירותים': 'Dove sono i bagni?',
  'אני אוהב גלידה': 'Mi piace il gelato',
  'what time is it': 'hoe laat is het',
  'where is the bathroom': 'waar is het toilet',
  'i like ice cream': 'ik hou van ijs',
  'hoe laat is het': 'what time is it',
  'waar is het toilet': 'where is the bathroom',
  'ik hou van ijs': 'I like ice cream',
};

const server = await serve(ROOT);
const port = server.address().port;
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
page.on('pageerror', e => bad('page ' + e.message));

try {
  await page.goto(`http://127.0.0.1:${port}/index.html?ptt=0`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    window.fetch = async (url) => {
      const u = decodeURIComponent(String(url));
      const q = (u.match(/[?&]q=([^&]+)/) || [])[1] || '';
      const text = window.__map[q] || window.__map[q.toLowerCase()] || '';
      return { ok: true, json: async () => [[[text, q]]] };
    };
  });
  await page.evaluate(map => { window.__map = map; }, MAP);

  const chain = await page.evaluate(() => {
    WG.addCustomWord('כלב');
    WG.addCustomWord('בית');
    WG.addCustomWord('גדול');
    const g = WG.newGame({ players: 2, names: ['א', 'ב'], seconds: 45 });
    const first = WG.play(g, 'כלב');
    const phrase = WG.play(g, 'בית גדול');
    const fresh = WG.newGame({ players: 2, names: ['א', 'ב'], seconds: 45 });
    G = fresh;
    const heard = firstValid(['כלב', 'כלב בית']);
    return {
      first: first.required,
      next: phrase.required,
      word: phrase.word,
      heard,
      removed: phrase.removed,
    };
  });
  if (chain.first !== 'ב' || chain.next !== 'ל' || chain.word !== 'בית גדול' || chain.heard !== 'כלב בית' || chain.removed !== 'ב') bad('chain ' + JSON.stringify(chain));
  else ok('a phrase chains from the last word and is not cut to the first');

  const used = await page.evaluate(() => {
    WG.addCustomWord('היכל');
    WG.addCustomWord('התרבות');
    const g = WG.newGame({ players: 2, names: ['א', 'ב'], seconds: 45 });
    WG.play(g, 'היכל');
    g.required = 'ה';
    const phrase = WG.play(g, 'היכל התרבות');
    const repeat = WG.check(g, 'היכל התרבות');
    const fresh = WG.newGame({ players: 2, names: ['א', 'ב'], seconds: 45 });
    const firstPhrase = WG.play(fresh, 'היכל התרבות');
    fresh.required = 'ה';
    const singleAfter = WG.check(fresh, 'היכל');
    return {
      phraseOk: phrase.ok,
      phrase: phrase.word,
      chain: phrase.required,
      repeat: repeat.reason,
      stored: [...g.used],
      firstChain: firstPhrase.required,
      singleAfter: singleAfter.ok,
      freshUsed: [...fresh.used],
    };
  });
  const phraseNew = used.phraseOk && used.phrase === 'היכל התרבות' && used.chain === 'ת' && used.repeat === 'used' && used.stored.join('|') === 'היכל|היכל התרבות';
  const wordAfter = used.firstChain === 'ת' && used.singleAfter && used.freshUsed.join('|') === 'היכל התרבות';
  if (!phraseNew || !wordAfter) bad('used ' + JSON.stringify(used));
  else ok('a phrase is new even when one of its words was already said');

  const match = await page.evaluate(() => ({
    yes: trMatch(['Che ore sono?'], 'Che ore sono?', 'it'),
    extra: trMatch(['allora che ore sono adesso'], 'Che ore sono?', 'it'),
    one: trMatch(['sono'], 'Che ore sono?', 'it'),
    order: trMatch(['che bello ore sono'], 'Che ore sono?', 'it'),
  }));
  if (!match.yes || !match.extra || match.one || !match.order) bad('match ' + JSON.stringify(match));
  else ok('a translation try must cover the whole phrase, in order');

  async function learn(ui, target, phrases) {
    return page.evaluate(async ({ ui, target, phrases }) => {
      applyLang(ui);
      setMode('learn');
      document.getElementById('learn').classList.remove('hidden');
      LEARN_TARGET = target;
      const out = [];
      for (const phrase of phrases) {
        await acceptNative(phrase);
        const otherEl = document.getElementById('learnOtherWord');
        const other = otherEl.textContent.trim();
        const sentence = otherEl.classList.contains('sentence');
        acceptRepeat([other]);
        out.push({
          own: document.getElementById('learnOwnWord').textContent.trim(),
          other,
          saved: readLearnWords().some(x => x.n === phrase && x.t === other),
          sentence,
        });
      }
      return out;
    }, { ui, target, phrases });
  }

  const he = await learn('he', 'it', ['מה השעה', 'איפה השירותים', 'אני אוהב גלידה']);
  const heWant = ['Che ore sono?', 'Dove sono i bagni?', 'Mi piace il gelato'];
  if (he.some((row, i) => row.other !== heWant[i] || row.own !== ['מה השעה', 'איפה השירותים', 'אני אוהב גלידה'][i] || !row.saved || !row.sentence)) bad('he learn ' + JSON.stringify(he));
  else ok('Hebrew sentences translate, wrap, and are saved');

  const en = await learn('en', 'nl', ['what time is it', 'where is the bathroom', 'i like ice cream']);
  const enWant = ['hoe laat is het', 'waar is het toilet', 'ik hou van ijs'];
  if (en.some((row, i) => row.other !== enWant[i] || !row.saved)) bad('en learn ' + JSON.stringify(en));
  else ok('English sentences translate');

  const nl = await learn('nl', 'en', ['hoe laat is het', 'waar is het toilet', 'ik hou van ijs']);
  const nlWant = ['what time is it', 'where is the bathroom', 'I like ice cream'];
  if (nl.some((row, i) => row.other !== nlWant[i] || !row.saved)) bad('nl learn ' + JSON.stringify(nl));
  else ok('Dutch sentences translate');

  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    class FakeSR {
      start(){
        const self = this;
        setTimeout(() => {
          if (self.onstart) self.onstart();
          if (self.onaudiostart) self.onaudiostart();
          const item = { isFinal: false, length: 1, 0: { transcript: 'כלב' } };
          if (self.onresult) self.onresult({ results: { length: 1, 0: item } });
        }, 20);
      }
      abort(){}
      stop(){ if (this.onend) this.onend(); }
    }
    window.SpeechRecognition = FakeSR;
    window.webkitSpeechRecognition = FakeSR;
    window.speechSynthesis = { cancel(){}, resume(){}, speak(){}, getVoices(){ return []; }, addEventListener(){} };
    window.SpeechSynthesisUtterance = function () {};
  });
  const mic = await ctx.newPage();
  mic.on('pageerror', e => bad('mic ' + e.message));
  await mic.goto(`http://127.0.0.1:${port}/index.html?ptt=0`, { waitUntil: 'domcontentloaded' });
  await mic.evaluate(() => { document.getElementById('sound').checked = false; document.getElementById('micAuto').click(); WG.addCustomWord('כלב'); });
  await mic.click('#go');
  await mic.waitForSelector('#half0');
  await mic.evaluate(() => { try { releaseIntro('ended'); } catch (_) {} });
  const committed = await mic.waitForFunction(() => {
    const log = (document.getElementById('diagText') && document.getElementById('diagText').textContent) || '';
    return /commit .+ reason=pause/.test(log) && /res interim כלב/.test(log);
  }, { timeout: 4000 }).then(() => true, () => false);
  const log = await mic.evaluate(() => (document.getElementById('diagText') && document.getElementById('diagText').textContent) || '');
  if (!committed) bad('interim was not committed ' + log.slice(-240));
  else ok('an interim word is committed without isFinal');
  await ctx.close();
} finally {
  await browser.close();
  server.close();
}

if (problems.length) {
  console.log('\n' + problems.length + ' failure(s)');
  process.exit(1);
}
console.log('\nphrase checks passed');
