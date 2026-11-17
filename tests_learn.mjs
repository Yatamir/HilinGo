/**
 * HilinGo v3.8 — Learn mode audio state machine.
 *   npm install playwright-core
 *   node tests_learn.mjs
 * Speech recognition, speechSynthesis and the intro clip are mocked.
 * Screenshots land in /opt/cursor/artifacts (phone 390×844 and iPad 820×1180).
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
function bad(msg) { problems.push(msg); console.log('  FAIL', msg); }
function ok(msg) { console.log('  ok  ', msg); }

function serve(root) {
  const types = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.png': 'image/png', '.json': 'application/json', '.mp3': 'audio/mpeg',
  };
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

const server = await serve(ROOT);
const port = server.address().port;
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext();
await context.addInitScript(() => {
  window.__intro = { plays: 0 };
  window.__srStarts = 0;
  window.__srLangs = [];
  window.__srs = [];
  window.__utts = [];
  window.__ev = [];
  window.__resumes = 0;
  window.__fetches = [];
  window.__fetchMode = 'ok';
  window.__fetchText = 'palavra';
  class FakeAudio {
    constructor(src) { this.src = src || ''; this.preload = ''; this.paused = true; this.currentTime = 0; this._ls = {}; window.__intro.el = this; }
    load() {}
    set preload(v) { this._preload = v; }
    get preload() { return this._preload; }
    play() { window.__intro.plays++; this.paused = false; if (window.__intro.fail) return Promise.reject(new Error('blocked')); return Promise.resolve(); }
    pause() { this.paused = true; }
    addEventListener(type, fn) { (this._ls[type] ||= []).push(fn); }
    removeEventListener(type, fn) { this._ls[type] = (this._ls[type] || []).filter(f => f !== fn); }
  }
  window.Audio = FakeAudio;
  window.__fireIntro = (type) => {
    const el = window.__intro.el;
    ((el && el._ls && el._ls[type]) || []).slice().forEach(fn => fn());
  };
  class FakeSR {
    start() {
      if (window.__startThrows) {
        window.__startThrows--;
        const e = new Error('invalid');
        e.name = 'InvalidStateError';
        throw e;
      }
      window.__srStarts++; window.__srLangs.push(this.lang); window.__srs.push(this); window.__ev.push('start:' + this.lang); if (this.onstart) this.onstart();
    }
    stop() { window.__ev.push('stop'); }
    abort() { window.__ev.push('abort'); if (this.onend) this.onend(); }
  }
  window.SpeechRecognition = FakeSR;
  window.webkitSpeechRecognition = FakeSR;
  window.SpeechSynthesisUtterance = class {
    constructor(text){ this.text = text; this.lang = ''; this.voice = null; this.volume = 1; this.rate = 1; this.onend = null; this.onerror = null; }
  };
  window.__emit = (text, extra) => {
    const sr = window.__srs[window.__srs.length - 1];
    if (!sr || !sr.onresult) throw new Error('no recognizer');
    let alts, isFinal = true;
    if (extra && !Array.isArray(extra)) {
      alts = extra.alts || [text];
      isFinal = extra.final !== false;
    } else alts = [text].concat(extra || []);
    const res = { isFinal, length: alts.length };
    alts.forEach((t, i) => { res[i] = { transcript: t }; });
    sr.onresult({ results: [res], resultIndex: 0 });
  };
  const synth = {
    getVoices() {
      return [
        { lang: 'pt-PT', name: 'European' },
        { lang: 'pt-BR', name: 'Brazilian' },
        { lang: 'he-IL', name: 'Hebrew' },
        { lang: 'nl-NL', name: 'Dutch' },
        { lang: 'en-US', name: 'English' },
      ];
    },
    cancel() { window.__ev.push('cancel'); },
    resume() { window.__resumes++; window.__ev.push('resume'); },
    speak(u) {
      window.__utts.push({ text: u.text, lang: u.lang, voice: u.voice && u.voice.lang, volume: u.volume });
      window.__ev.push('speak:' + u.lang + ':' + u.text);
      window.__lastUtt = u;
    },
  };
  try {
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: synth });
  } catch (_) { window.speechSynthesis = synth; }
  window.__endSpeech = () => { const u = window.__lastUtt; if (u && u.onend) u.onend(); };
  window.fetch = async (url) => {
    window.__fetches.push(String(url));
    if (window.__fetchMode === 'fail') throw new Error('offline');
    if (window.__fetchMode === 'warn') {
      return { ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY' } }) };
    }
    return { ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: window.__fetchText || 'palavra' } }) };
  };
});

async function open(page, viewport, extra) {
  const errors = [];
  page.on('pageerror', err => errors.push(String(err)));
  if (viewport) await page.setViewportSize(viewport);
  await page.goto(`http://127.0.0.1:${port}/index.html?ptt=0${extra || ''}`, { waitUntil: 'domcontentloaded' });
  return errors;
}
async function shot(page, name) {
  const file = path.join(SHOTS, name + '.png');
  await page.screenshot({ path: file, fullPage: true });
  return file;
}
function lastLang(state) { return state.langs[state.langs.length - 1]; }

try {
  // Start-button label follows the UI language only while Learn is selected.
  {
    const page = await context.newPage();
    const errors = await open(page, { width: 1024, height: 768 });
    const play = await page.locator('#go').innerText();
    if (play !== 'יאללה, מתחילים!') bad('play label ' + play);
    else ok('play label unchanged');
    await page.click('#modeLearn');
    const labels = [
      ['he', 'יאללה, לומדים!'],
      ['en', "Let's learn!"],
      ['nl', 'Laten we leren!'],
      ['pt', 'Vamos aprender!'],
    ];
    for (const [lang, text] of labels) {
      if (lang !== 'he') await page.click(`#langs .opt[data-lang="${lang}"]`);
      const got = (await page.locator('#go').innerText()).trim();
      const dir = await page.evaluate(() => document.documentElement.dir);
      const playersHidden = await page.evaluate(() => document.getElementById('playersCard').classList.contains('hidden'));
      const target = await page.evaluate(() => [...document.querySelectorAll('#learnTargets .opt.sel')].map(b => b.dataset.lang).join(','));
      const ui = await page.evaluate(() => document.documentElement.lang);
      if (got !== text || ui !== lang || !playersHidden) bad(lang + ' learn label ' + JSON.stringify({ got, dir, target, ui, playersHidden }));
      else ok(lang + ' learn button “' + got + '” target ' + target + ' dir ' + dir);
      if (lang === 'he' && (dir !== 'rtl' || target !== 'pt')) bad('he defaults ' + dir + ' ' + target);
      if (lang === 'pt' && (dir !== 'ltr' || target !== 'he')) bad('pt defaults ' + dir + ' ' + target);
    }
    await page.click('#modePlay');
    await page.click('#langs .opt[data-lang="he"]');
    const back = (await page.locator('#go').innerText()).trim();
    const playersBack = await page.evaluate(() => !document.getElementById('playersCard').classList.contains('hidden') && document.getElementById('pairCard').classList.contains('hidden'));
    if (back !== 'יאללה, מתחילים!' || !playersBack) bad('back to play ' + back + ' ' + playersBack);
    else ok('play mode restored');
    if (errors.length) bad('label errors ' + errors.join(';'));
    await page.close();
  }

  // Full he → pt: כלב, cachorro, close miss, ✅, My words, tap to practice again.
  {
    const page = await context.newPage();
    const errors = await open(page, { width: 390, height: 844 });
    await page.click('#modeLearn');
    await shot(page, 'learn-start-he-phone');
    await page.click('#go');
    let s = await page.evaluate(() => ({
      plays: window.__intro.plays,
      sr: window.__srStarts,
      learn: !document.getElementById('learn').classList.contains('hidden'),
      game: document.getElementById('game').classList.contains('hidden'),
    }));
    if (s.plays !== 1 || s.sr !== 0 || !s.learn || !s.game) bad('learn start ' + JSON.stringify(s));
    else ok('intro is playing and the learn mic is waiting');
    const duringIntro = await page.evaluate(() => ({ utts: window.__utts.length, state: document.getElementById('learn').dataset.state }));
    if (duringIntro.utts !== 0 || duringIntro.state !== 'INTRO') bad('intro not exclusive ' + JSON.stringify(duringIntro));
    else ok('intro owns the audio: no speechSynthesis and no mic yet');
    await page.evaluate(() => window.__fireIntro('ended'));
    await page.waitForFunction(() => window.__srStarts >= 1);
    s = await page.evaluate(() => ({ lang: window.__srLangs[window.__srLangs.length - 1], sr: window.__srStarts }));
    if (s.lang !== 'he-IL') bad('native mic lang ' + s.lang);
    else ok('mic opened in he-IL after the intro');

    const fetchesBefore = await page.evaluate(() => window.__fetches.length);
    await page.evaluate(() => window.__emit('כלב'));
    await page.waitForFunction(() => document.getElementById('learnOtherWord').textContent.includes('cachorro'));
    s = await page.evaluate(() => ({
      other: document.getElementById('learnOtherWord').textContent,
      own: document.getElementById('learnOwnWord').textContent,
      utt: window.__utts[window.__utts.length - 1],
      sr: window.__srStarts,
      fetches: window.__fetches.length,
    }));
    if (s.other !== 'cachorro' || s.own !== 'כלב' || !s.utt || s.utt.text !== 'cachorro' || s.utt.lang !== 'pt-BR' || s.utt.voice !== 'pt-BR') {
      bad('translation speech ' + JSON.stringify(s));
    } else if (s.sr !== 1) bad('mic reopened during speech ' + s.sr);
    else if (s.fetches !== fetchesBefore) bad('dictionary hit called MyMemory');
    else ok('כלב → cachorro spoken with pt-BR, mic still closed');
    const order = await page.evaluate(() => window.__ev.join(' | '));
    const speakAt = order.lastIndexOf('speak:pt-BR:cachorro');
    const startPt = order.indexOf('start:pt-BR');
    const abortAt = order.lastIndexOf('abort', speakAt);
    if (speakAt < 0 || abortAt < 0 || abortAt > speakAt || (startPt >= 0 && startPt < speakAt)) bad('speak/mic order ' + order);
    else ok('recognizer aborted before the target word is spoken');
    await shot(page, 'learn-translation-phone');

    await page.evaluate(() => window.__endSpeech());
    await page.waitForFunction(() => window.__srStarts >= 2);
    s = await page.evaluate(() => window.__srLangs[window.__srLangs.length - 1]);
    if (s !== 'pt-BR') bad('repeat mic ' + s);
    else ok('mic switched to pt-BR after the speech');
    const listen = await page.locator('#learnStatus').innerText();
    if (!listen.includes('Português')) bad('listening status ' + listen);
    else ok('status says listening in Português');
    const icons = await page.evaluate(() => ({
      mics: document.querySelectorAll('#learn .ico-mic').length,
      emoji: /🎤/.test(document.getElementById('learn').innerText),
      mark: !document.getElementById('learnListenMark').classList.contains('hidden'),
      onSpeak: document.getElementById('learnSpeak').classList.contains('listening'),
    }));
    if (icons.mics !== 1 || icons.emoji || !icons.mark || !icons.onSpeak) bad('listen icons ' + JSON.stringify(icons));
    else ok('one outline mic; waveform on the status row and the replay spot');
    await shot(page, 'learn-listening-phone');

    await page.evaluate(() => window.__emit('gato'));
    await page.waitForFunction(() => document.getElementById('learnOwnWord').textContent.includes('gato'));
    s = await page.evaluate(() => ({
      own: document.getElementById('learnOwnWord').textContent,
      heard: document.getElementById('learnHeard').textContent,
      other: document.getElementById('learnOtherWord').textContent,
      skip: !document.getElementById('learnSkip').classList.contains('hidden'),
      speak: !document.getElementById('learnSpeak').classList.contains('hidden'),
      check: document.getElementById('learnOtherWord').textContent.includes('✅'),
    }));
    if (!s.own.includes('gato') || !s.heard.includes('gato') || s.other !== 'cachorro' || !s.skip || !s.speak || s.check) bad('mismatch ' + JSON.stringify(s));
    else ok('mismatch shows what was heard, 🔊 and skip');
    {
      const before = await page.evaluate(() => ({ sr: window.__srStarts, n: window.__utts.length }));
      await page.click('#learnSpeak');
      const mid = await page.evaluate(() => ({ sr: window.__srStarts, utt: window.__utts[window.__utts.length - 1], n: window.__utts.length }));
      if (mid.sr !== before.sr || !mid.utt || mid.utt.text !== 'cachorro' || mid.utt.lang !== 'pt-BR' || mid.n <= before.n) bad('🔊 tap ' + JSON.stringify(mid));
      else ok('🔊 speaks from the tap while the mic stays closed');
      await page.evaluate(() => window.__endSpeech());
      await page.waitForFunction(n => window.__srStarts > n && window.__srLangs.at(-1) === 'pt-BR', before.sr);
    }

    await page.evaluate(() => window.__emit('cachorru'));
    await page.waitForFunction(() => document.getElementById('learnOtherWord').textContent.includes('✅'));
    s = await page.evaluate(() => ({
      mark: document.getElementById('learnOtherWord').textContent,
      saved: JSON.parse(localStorage.getItem('hilingo_learn_he_pt') || '[]'),
      mic: window.__srLangs[window.__srLangs.length - 1],
    }));
    if (!s.mark.includes('✅') || !s.saved.some(w => w.n === 'כלב' && w.t === 'cachorro')) bad('saved ' + JSON.stringify(s));
    else if (s.mic !== 'he-IL') bad('after ✅ mic ' + s.mic);
    else ok('close match ✅ and saved; mic is back to Hebrew');
    await shot(page, 'learn-ok-phone');

    await page.click('#learnWordsBtn');
    await page.waitForSelector('#wordsList .mw-pair');
    const listed = await page.evaluate(() => document.querySelector('#wordsList .mw-pair').textContent.replace(/\s+/g, ' ').trim());
    if (!listed.includes('כלב') || !listed.includes('cachorro')) bad('my words ' + listed);
    else ok('My words lists כלב · cachorro');
    await shot(page, 'learn-words-phone');

    const plays = await page.evaluate(() => window.__intro.plays);
    const utts = await page.evaluate(() => window.__utts.length);
    await page.click('#wordsList .mw-pair');
    await page.waitForFunction(n => window.__utts.length > n, utts);
    s = await page.evaluate(() => ({
      plays: window.__intro.plays,
      utt: window.__utts[window.__utts.length - 1],
      sr: window.__srStarts,
      other: document.getElementById('learnOtherWord').textContent,
      overlay: document.getElementById('wordsov').classList.contains('hidden'),
    }));
    if (s.plays !== plays || s.utt.text !== 'cachorro' || s.utt.voice !== 'pt-BR' || s.other !== 'cachorro' || !s.overlay) bad('repractice ' + JSON.stringify(s));
    else ok('tap practices again: speaks cachorro, no second intro');
    const srAtSpeech = s.sr;
    await page.waitForTimeout(200);
    const srDuring = await page.evaluate(() => window.__srStarts);
    if (srDuring !== srAtSpeech) bad('mic opened during replay speech ' + srDuring);
    else ok('replay keeps the mic closed until speech ends');
    await page.evaluate(() => window.__endSpeech());
    await page.waitForFunction(n => window.__srLangs[window.__srLangs.length - 1] === 'pt-BR' && window.__srStarts > n, srAtSpeech);
    await page.evaluate(() => window.__emit('cachorro'));
    await page.waitForFunction(() => document.getElementById('learnOtherWord').textContent.includes('✅'));
    ok('repractice repeat accepted');

    // Delete the word.
    await page.click('#learnWordsBtn');
    await page.click('#wordsList .mw-x');
    await page.click('#wordsList .mw-yes');
    const left = await page.evaluate(() => JSON.parse(localStorage.getItem('hilingo_learn_he_pt') || '[]').length);
    if (left !== 0) bad('delete left ' + left);
    else ok('deleted the saved pair');
    await page.click('#wordsClose');

    // Nikud and final-letter folding: כֶּלֶב is כלב.
    await page.fill('#learnIn', 'כֶּלֶב');
    await page.click('#learnSend');
    await page.waitForFunction(() => document.getElementById('learnOtherWord').textContent.includes('cachorro'));
    ok('nikud כֶּלֶב still translates to cachorro');

    if (errors.length) bad('flow errors ' + errors.join(';'));
    await page.close();
  }

  // iPad portrait + landscape screenshots, and the panels stay on screen.
  for (const [name, w, h] of [['ipad', 820, 1180], ['ipad-land', 1180, 820]]) {
    const page = await context.newPage();
    const errors = await open(page, { width: w, height: h });
    await page.click('#modeLearn');
    if (name === 'ipad') await shot(page, 'learn-start-he-ipad');
    await page.click('#langs .opt[data-lang="pt"]');
    if (name === 'ipad') await shot(page, 'learn-start-pt-ipad');
    await page.click('#langs .opt[data-lang="he"]');
    await page.click('#go');
    await page.evaluate(() => window.__fireIntro('ended'));
    await page.waitForFunction(() => window.__srStarts >= 1);
    await page.evaluate(() => window.__emit('כלב'));
    await page.waitForFunction(() => document.getElementById('learnOtherWord').textContent.includes('cachorro'));
    const fit = await page.evaluate(() => {
      const vw = innerWidth, vh = innerHeight;
      const boxes = ['learnOwn', 'learnOther', 'learnMic', 'learnIn', 'learnSend', 'learnOtherWord', 'learnSpeak'].map(id => {
        const r = document.getElementById(id).getBoundingClientRect();
        return { id, top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height };
      });
      const off = boxes.filter(b => b.left < -1 || b.right > vw + 1 || b.top < -1 || b.bottom > vh + 1).map(b => b.id);
      const own = boxes[0], mic = boxes[2];
      return { off, scroll: document.documentElement.scrollWidth > vw + 2, micBelow: mic.top + 1 >= own.bottom - own.h * 0.15, dir: document.documentElement.dir, vw, vh };
    });
    if (fit.off.length || fit.scroll || fit.dir !== 'rtl') bad(name + ' layout ' + JSON.stringify(fit));
    else ok(name + ' learn panels on screen, mic in the panel');
    if (name === 'ipad') await shot(page, 'learn-translation-ipad');
    if (name === 'ipad-land') await shot(page, 'learn-translation-ipad-land');
    await page.evaluate(() => { window.__endSpeech(); });
    await page.waitForFunction(() => window.__srLangs.at(-1) === 'pt-BR');
    if (name === 'ipad') await shot(page, 'learn-listening-ipad');
    await page.evaluate(() => window.__emit('cachorro'));
    await page.waitForFunction(() => document.getElementById('learnOtherWord').textContent.includes('✅'));
    if (name === 'ipad') {
      await shot(page, 'learn-ok-ipad');
      await page.click('#learnWordsBtn');
      await page.waitForSelector('#wordsList .mw-pair');
      await shot(page, 'learn-words-ipad');
    }
    if (errors.length) bad(name + ' errors ' + errors.join(';'));
    await page.close();
  }

  // Phone portrait of the Portuguese start screen was the he one above; capture pt phone too.
  {
    const page = await context.newPage();
    await open(page, { width: 390, height: 844 });
    await page.click('#modeLearn');
    await page.click('#langs .opt[data-lang="pt"]');
    const label = (await page.locator('#go').innerText()).trim();
    if (label !== 'Vamos aprender!') bad('pt phone label ' + label);
    await shot(page, 'learn-start-pt-phone');
    await page.close();
    ok('pt phone start shot');
  }

  // MyMemory fallback: hit, warning, and network failure.
  {
    const page = await context.newPage();
    const errors = await open(page, { width: 800, height: 700 });
    await page.click('#modeLearn');
    await page.click('#langs .opt[data-lang="en"]');
    await page.click('#go');
    await page.evaluate(() => window.__fireIntro('ended'));
    await page.waitForFunction(() => window.__srStarts >= 1);
    await page.evaluate(() => { window.__fetchText = 'palavra'; window.__emit('xyzzyqq'); });
    await page.waitForFunction(() => document.getElementById('learnOtherWord').textContent.includes('palavra'));
    let s = await page.evaluate(() => ({
      url: window.__fetches[window.__fetches.length - 1],
      other: document.getElementById('learnOtherWord').textContent,
      utt: window.__utts[window.__utts.length - 1],
      sr: window.__srStarts,
    }));
    const pair = decodeURIComponent(s.url.split('langpair=')[1] || '');
    if (!s.url.includes('api.mymemory.translated.net/get') || !pair.startsWith('en|pt-BR') || !s.url.includes('q=xyzzyqq')) bad('fallback url ' + s.url);
    else if (s.other !== 'palavra' || s.utt.lang !== 'pt-BR' || s.sr !== 1) bad('fallback show ' + JSON.stringify(s));
    else ok('MyMemory fallback en|pt-BR → palavra, mic waits');
    await page.evaluate(() => window.__endSpeech());
    await page.waitForFunction(() => window.__srLangs.at(-1) === 'pt-BR');
    await page.evaluate(() => window.__emit('palavra'));
    await page.waitForFunction(() => document.getElementById('learnOtherWord').textContent.includes('✅'));
    s = await page.evaluate(() => JSON.parse(localStorage.getItem('hilingo_learn_en_pt') || '[]'));
    if (!s.some(w => w.n === 'xyzzyqq' && w.t === 'palavra')) bad('fallback not saved ' + JSON.stringify(s));
    else ok('fallback pair saved');

    await page.evaluate(() => { window.__fetchMode = 'warn'; });
    await page.fill('#learnIn', 'qqzzww');
    await page.click('#learnSend');
    await page.waitForFunction(() => /Couldn't translate/.test(document.getElementById('learnOwnMsg').textContent));
    ok('MyMemory warning shows “Couldn\'t translate, try another word”');

    await page.evaluate(() => { window.__fetchMode = 'fail'; });
    await page.fill('#learnIn', 'zzqqww');
    await page.click('#learnSend');
    await page.waitForFunction(() => /Couldn't translate/.test(document.getElementById('learnOwnMsg').textContent));
    const still = await page.evaluate(() => ({
      hidden: document.getElementById('errbar').classList.contains('hidden'),
      learn: !document.getElementById('learn').classList.contains('hidden'),
    }));
    if (!still.hidden || !still.learn || errors.length) bad('fallback failure threw ' + JSON.stringify(still) + ' ' + errors.join(';'));
    else ok('network failure stays on the learn screen');
    await page.close();
  }

  // Another direction: pt → he, typed.
  {
    const page = await context.newPage();
    const errors = await open(page, { width: 900, height: 700 });
    await page.click('#modeLearn');
    await page.click('#langs .opt[data-lang="pt"]');
    await page.click('#go');
    await page.evaluate(() => window.__fireIntro('ended'));
    await page.waitForFunction(() => window.__srLangs.at(-1) === 'pt-BR');
    await page.fill('#learnIn', 'Cachorro');
    await page.click('#learnSend');
    await page.waitForFunction(() => document.getElementById('learnOtherWord').textContent.includes('כלב'));
    const spoken = await page.evaluate(() => window.__utts.at(-1));
    if (!spoken || spoken.lang !== 'he-IL' || spoken.text !== 'כלב') bad('pt→he ' + JSON.stringify(spoken));
    else ok('pt Cachorro → כלב spoken in he-IL');
    if (errors.length) bad(errors.join(';'));
    await page.close();
  }

  // nl UI label already checked. en → nl typed dog → hond.
  {
    const page = await context.newPage();
    await open(page, { width: 900, height: 700 });
    await page.click('#modeLearn');
    await page.click('#langs .opt[data-lang="en"]');
    await page.click('#learnTargets .opt[data-lang="nl"]');
    await page.click('#go');
    await page.evaluate(() => window.__fireIntro('ended'));
    await page.waitForFunction(() => window.__srStarts >= 1);
    await page.fill('#learnIn', 'dog');
    await page.click('#learnSend');
    await page.waitForFunction(() => document.getElementById('learnOtherWord').textContent.toLowerCase().includes('hond'));
    const v = await page.evaluate(() => ({ t: document.getElementById('learnOtherWord').textContent, lang: window.__utts.at(-1).lang }));
    if (v.t !== 'hond' || v.lang !== 'nl-NL') bad('en→nl ' + JSON.stringify(v));
    else ok('en dog → nl hond');
    await page.evaluate(() => window.__endSpeech());
    await page.waitForFunction(() => window.__srLangs.at(-1) === 'nl-NL');
    const status = await page.locator('#learnStatus').innerText();
    if (!status.includes('Nederlands')) bad('nl listening status ' + status);
    else ok('status says listening in Nederlands');
    await page.evaluate(() => window.__emit('de hond'));
    await page.waitForFunction(() => document.getElementById('learnOtherWord').textContent.includes('✅'));
    ok('article "de hond" matches hond');
    await page.close();
  }

  // Interim result (not final) still counts, and a missing voice does not block speech.
  {
    const page = await context.newPage();
    const errors = await open(page, { width: 800, height: 700 });
    await page.evaluate(() => { window.speechSynthesis.getVoices = () => []; });
    await page.click('#modeLearn');
    await page.click('#go');
    await page.evaluate(() => window.__fireIntro('ended'));
    await page.waitForFunction(() => window.__srLangs.at(-1) === 'he-IL');
    await page.evaluate(() => window.__emit('כלב'));
    await page.waitForFunction(() => document.getElementById('learnOtherWord').textContent.includes('cachorro'));
    const spoken = await page.evaluate(() => window.__utts.at(-1));
    if (!spoken || spoken.lang !== 'pt-BR' || spoken.voice) bad('no-voice fallback ' + JSON.stringify(spoken));
    else ok('no exact voice: utterance.lang is pt-BR and speak still runs');
    await page.evaluate(() => window.__endSpeech());
    await page.waitForFunction(() => window.__srLangs.at(-1) === 'pt-BR');
    await page.evaluate(() => window.__emit('cachorro', { final: false }));
    await page.waitForFunction(() => document.getElementById('learnOtherWord').textContent.includes('✅'));
    if (errors.length) bad('interim errors ' + errors.join(';'));
    else ok('interim (not final) "cachorro" is accepted');
    await page.close();
  }

  // iOS quirks: no auto-listen, no restart loop, TTS timeout, InvalidStateError once.
  {
    const page = await context.newPage();
    const errors = await open(page, { width: 390, height: 844 }, '&ios=1');
    await page.click('#modeLearn');
    await page.click('#go');
    await page.evaluate(() => window.__fireIntro('ended'));
    await page.waitForTimeout(250);
    let s = await page.evaluate(() => ({
      sr: window.__srStarts,
      state: document.getElementById('learn').dataset.state,
      status: document.getElementById('learnStatus').textContent,
      heard: document.getElementById('learnHeard').textContent,
    }));
    if (s.sr !== 0 || s.state !== 'IDLE_NATIVE' || /מקשיב|Listening|Luistert|Ouvindo/.test(s.status + s.heard)) bad('ios auto mic ' + JSON.stringify(s));
    else ok('iOS stays idle after the intro (no listening label)');
    const idleIcons = await page.evaluate(() => ({
      mics: document.querySelectorAll('#learn .ico-mic').length,
      mark: document.getElementById('learnListenMark').classList.contains('hidden'),
      onSpeak: document.getElementById('learnSpeak').classList.contains('listening'),
    }));
    if (idleIcons.mics !== 1 || !idleIcons.mark || idleIcons.onSpeak) bad('idle icons ' + JSON.stringify(idleIcons));
    else ok('idle hides the waveform and keeps a single mic button');
    await shot(page, 'learn-idle-phone');
    await page.setViewportSize({ width: 820, height: 1180 });
    await shot(page, 'learn-idle-ipad');
    await page.setViewportSize({ width: 390, height: 844 });

    await page.click('#learnMic');
    await page.waitForFunction(() => window.__srStarts === 1 && document.getElementById('learn').dataset.state === 'LISTEN_NATIVE');
    s = await page.evaluate(() => document.getElementById('learnStatus').textContent);
    if (!s.includes('מקשיב') || !s.includes('עברית')) bad('ios listen label ' + s);
    else ok('מקשיב only while the native recognizer is running');

    await page.evaluate(() => {
      const sr = window.__srs[window.__srs.length - 1];
      sr.onerror({ error: 'no-speech' });
      sr.onend();
    });
    await page.waitForFunction(() => document.getElementById('learn').dataset.state === 'IDLE_NATIVE');
    s = await page.evaluate(() => ({
      sr: window.__srStarts,
      status: document.getElementById('learnStatus').textContent,
    }));
    if (s.sr !== 1 || /מקשיב/.test(s.status)) bad('no-speech restarted ' + JSON.stringify(s));
    else ok('no-speech ends the session and does not restart');

    await page.evaluate(() => { window.__startThrows = 1; });
    await page.click('#learnMic');
    await page.waitForFunction(() => window.__srStarts === 2 && document.getElementById('learn').dataset.state === 'LISTEN_NATIVE');
    s = await page.evaluate(() => window.__srStarts);
    if (s !== 2) bad('InvalidStateError recovery ' + s);
    else ok('InvalidStateError retries start once on the same recognizer');

    await page.evaluate(() => window.__emit('כלב'));
    await page.waitForFunction(() => document.getElementById('learn').dataset.state === 'SPEAK_TARGET');
    const srAtSpeak = await page.evaluate(() => window.__srStarts);
    await page.waitForFunction(() => document.getElementById('learn').dataset.state === 'IDLE_TARGET', null, { timeout: 4000 });
    s = await page.evaluate(() => ({
      sr: window.__srStarts,
      state: document.getElementById('learn').dataset.state,
      hidden: document.getElementById('learnSpeak').classList.contains('hidden'),
      disabled: document.getElementById('learnSpeak').disabled,
      status: document.getElementById('learnStatus').textContent,
    }));
    if (s.sr !== srAtSpeak || s.state !== 'IDLE_TARGET' || s.hidden || s.disabled || /מקשיב/.test(s.status)) bad('tts timeout ' + JSON.stringify(s));
    else ok('TTS with no onend still returns to idle and keeps 🔊');

    await page.evaluate(() => { window.__startThrows = 0; });
    await page.click('#learnMic');
    await page.waitForFunction(() => document.getElementById('learn').dataset.state === 'LISTEN_TARGET');
    const starts = await page.evaluate(() => window.__srStarts);
    await page.evaluate(() => {
      const sr = window.__srs[window.__srs.length - 1];
      sr.onerror({ error: 'aborted' });
      sr.onend();
    });
    await page.waitForTimeout(400);
    s = await page.evaluate(() => ({ sr: window.__srStarts, state: document.getElementById('learn').dataset.state }));
    // aborted is ignored by the handler; onend with no text goes idle (or one pt-PT try).
    if (s.sr > starts + 1) bad('aborted loop ' + JSON.stringify(s));
    else ok('aborted/onend does not loop (' + s.state + ', starts +' + (s.sr - starts) + ')');

    for (let i = 0; i < 5; i++) await page.click('#verLblLearn');
    const dbg = await page.evaluate(() => ({
      hidden: document.getElementById('learnDbg').classList.contains('hidden'),
      text: document.getElementById('learnDbg').textContent,
    }));
    if (dbg.hidden || !/INTRO/.test(dbg.text) || !/LISTEN_/.test(dbg.text)) bad('debug log ' + JSON.stringify(dbg).slice(0, 300));
    else ok('five taps on v3.8 open the debug log');
    if (errors.length) bad('ios errors ' + errors.join(';'));
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
console.log('\nlearn checks passed');
