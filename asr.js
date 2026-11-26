// On-device speech for iPhone. Page load only caches Whisper base files.
// One pipeline is created on the first listen and reused. Never two at once.
// No server and no paid API.

const TINY = 'Xenova/whisper-tiny';
const BASE = 'Xenova/whisper-base';
const CRASH_KEY = 'hilingo_whisper_base_crash';
const FILE_CACHE = 'transformers-cache';
const RUNTIME = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const TARGET_RATE = 16000;
const VOICE_RMS = 0.012;
const SILENCE_MS = 700;
const MAX_MS = 5000;
const LEARN_MAX_MS = 7000;
const PRE_MS = 300;
const BASE_FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer_config.json',
  'tokenizer.json',
  'vocab.json',
  'merges.txt',
  'normalizer.json',
  'added_tokens.json',
  'special_tokens_map.json',
  'onnx/encoder_model_fp16.onnx',
  'onnx/decoder_model_merged_q4f16.onnx',
];

let pipe = null;
let pipeId = '';
let pipeInfo = null;
let baseBanned = false;
let crashNoted = false;
let busy = Promise.resolve();
let logger = function () {};
export function setLogger(fn){ logger = typeof fn === 'function' ? fn : function () {}; }
function note(msg){ try { logger(msg); } catch (_) {} }

function memLine(){
  try {
    const m = performance && performance.memory;
    if (!m || !m.usedJSHeapSize) return 'mem=na';
    const mb = n => Math.round(n / 1048576);
    return 'mem used=' + mb(m.usedJSHeapSize) + ' total=' + mb(m.totalJSHeapSize) + ' limit=' + mb(m.jsHeapSizeLimit);
  } catch (_) { return 'mem=na'; }
}
function locked(fn){
  const run = busy.then(fn, fn);
  busy = run.then(() => {}, () => {});
  return run;
}
function wantsTiny(){
  try { return /[?&]model=tiny(?:&|$)/.test(location.search || ''); } catch (_) { return false; }
}
function isIOS(){
  try {
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/.test(ua)) return true;
    if (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1) return true;
  } catch (_) {}
  return false;
}
function noteCrashOnce(){
  if (crashNoted) return;
  crashNoted = true;
  try {
    if (sessionStorage.getItem(CRASH_KEY) === '1') {
      baseBanned = true;
      sessionStorage.removeItem(CRASH_KEY);
      note('whisper base crashed previously, using tiny');
    }
  } catch (_) {}
}
function markBase(){
  try { sessionStorage.setItem(CRASH_KEY, '1'); } catch (_) {}
}
function clearBase(){
  try { sessionStorage.removeItem(CRASH_KEY); } catch (_) {}
}
function fileUrl(id, file){
  return 'https://huggingface.co/' + id + '/resolve/main/' + file;
}

function whisperName(tag){
  const t = String(tag || '').toLowerCase();
  if (t.startsWith('he')) return 'hebrew';
  if (t.startsWith('it')) return 'italian';
  if (t.startsWith('pt')) return 'portuguese';
  if (t.startsWith('nl')) return 'dutch';
  if (t.startsWith('es')) return 'spanish';
  if (t.startsWith('en')) return 'english';
  if (t.startsWith('fr')) return 'french';
  if (t.startsWith('de')) return 'german';
  return null;
}

let fetchLowered = false;
function lowerModelFetch(){
  if (fetchLowered || typeof fetch !== 'function') return;
  fetchLowered = true;
  const orig = fetch.bind(globalThis);
  globalThis.fetch = function (url, opts){
    const u = String((url && url.url) || url || '');
    if (/huggingface\.co|cdn-lfs|\.onnx/i.test(u)) {
      const next = Object.assign({}, opts || {});
      if (!next.priority) next.priority = 'low';
      return orig(url, next);
    }
    return orig(url, opts);
  };
}

function iosWasm(){ return isIOS() || baseBanned; }
function weightFiles(id){
  const q8 = iosWasm() || id === TINY;
  const enc = q8 ? 'onnx/encoder_model_quantized.onnx' : 'onnx/encoder_model_fp16.onnx';
  const dec = q8 ? 'onnx/decoder_model_merged_quantized.onnx' : 'onnx/decoder_model_merged_q4f16.onnx';
  return [
    'config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer_config.json',
    'tokenizer.json', 'vocab.json', 'merges.txt', 'normalizer.json', 'added_tokens.json', 'special_tokens_map.json',
    enc, dec,
  ];
}
async function baseFilesReady(){
  if (baseBanned || wantsTiny()) return false;
  try {
    const cache = await caches.open(FILE_CACHE);
    const files = weightFiles(BASE);
    const enc = await cache.match(fileUrl(BASE, files[files.length - 2]));
    const dec = await cache.match(fileUrl(BASE, files[files.length - 1]));
    return !!(enc && dec);
  } catch (_) { return false; }
}

async function cacheOne(id, file){
  const url = fileUrl(id, file);
  const cache = await caches.open(FILE_CACHE);
  try { if (await cache.match(url)) return true; } catch (_) {}
  let res;
  try { res = await fetch(url, { priority: 'low' }); } catch (_) { return false; }
  if (!res || !res.ok || !res.body) return false;
  const total = Number(res.headers.get('content-length') || 0);
  let loaded = 0;
  let last = -1;
  const stream = new TransformStream({
    transform(chunk, controller){
      loaded += chunk.byteLength || chunk.length || 0;
      const pct = total ? Math.min(99, Math.round(100 * loaded / total)) : 0;
      if (pct >= last + 25) { last = pct; note('whisper download ' + id + ' ' + file + ' ' + pct + '%'); }
      controller.enqueue(chunk);
    },
  });
  try {
    await cache.put(url, new Response(res.body.pipeThrough(stream), { status: 200, headers: { 'Content-Type': res.headers.get('content-type') || 'application/octet-stream' } }));
  } catch (_) {
    try {
      const again = await fetch(url, { priority: 'low' });
      if (!again.ok) return false;
      await cache.put(url, again);
    } catch (__) { return false; }
  }
  note('whisper download ' + id + ' ' + file + ' 100%');
  return true;
}

let warmStarted = false;
export function prefetch(){
  if (warmStarted) return;
  warmStarted = true;
  noteCrashOnce();
  lowerModelFetch();
  const want = modelsToWarm({ tiny: wantsTiny(), banned: baseBanned, ios: isIOS() })[0];
  (async () => {
    for (const file of weightFiles(want)) { try { await cacheOne(want, file); } catch (_) {} }
    const info = await ensureModel();
    note('whisper warm ready ' + ((info && info.model) || want));
  })().catch(err => { note('whisper warm fail ' + (err && err.message || err)); });
}

async function webgpuPlan(){
  try {
    if (!navigator.gpu) return null;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    const fp16 = !!(adapter.features && adapter.features.has('shader-f16'));
    if (!fp16) return null;
    return { spec: { encoder_model: 'fp16', decoder_model_merged: 'q4f16' }, label: 'encoder=fp16 decoder=q4f16' };
  } catch (_) { return null; }
}

function watchLost(session){
  try {
    const dev = session && (session.device || (session.handler && (session.handler.device || session.handler.gpuDevice)));
    if (!dev || !dev.lost || !dev.lost.then) return;
    dev.lost.then(info => {
      baseBanned = true;
      note('whisper gpu lost ' + ((info && info.message) || '') + ' ' + memLine());
    }).catch(() => {});
  } catch (_) {}
}

function hookLost(obj){
  try {
    const sessions = obj && obj.model && obj.model.sessions;
    if (!sessions) return;
    Object.keys(sessions).forEach(k => watchLost(sessions[k]));
  } catch (_) {}
}

async function disposePipe(why){
  const old = pipe;
  const id = pipeId;
  pipe = null;
  pipeId = '';
  pipeInfo = null;
  if (!old) return;
  note('whisper dispose ' + id + ' ' + (why || '') + ' ' + memLine());
  try { if (old.dispose) await old.dispose(); } catch (_) {}
  try { if (old.model && old.model.dispose) await old.model.dispose(); } catch (_) {}
}

async function buildPipe(id, device, spec){
  const { pipeline, env } = await import(RUNTIME);
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  const made = await pipeline('automatic-speech-recognition', id, {
    dtype: spec,
    device: device,
    progress_callback: (p) => {
      if (!p || p.status === 'progress') return;
      if (p.status === 'done' || p.status === 'initiate') note('whisper download ' + id + ' ' + (p.file || '') + ' ' + (p.status === 'done' ? '100' : '0') + '%');
    },
  });
  hookLost(made);
  return made;
}

async function createPipe(id){
  if (isIOS()) id = TINY;
  if (pipe && pipeId === id) return pipeInfo;
  if (pipe) await disposePipe('switch');
  let model = (isIOS() || (baseBanned && id === BASE)) ? TINY : id;
  let device = 'wasm';
  let spec = 'q8';
  let label = 'q8';
  if (model === BASE && !isIOS()) {
    const plan = await webgpuPlan();
    if (!plan || baseBanned) {
      note('whisper webgpu unavailable, using tiny');
      model = TINY;
    } else {
      device = 'webgpu';
      spec = plan.spec;
      label = plan.label;
    }
  }
  if (isIOS()) {
    device = 'wasm';
    spec = 'q8';
    label = 'q8';
    note('whisper ios wasm ' + model);
  }
  if (model === BASE) markBase();
  const t0 = performance.now();
  note('whisper load start ' + model + ' device=' + device + ' dtype=' + label + ' ' + memLine());
  try {
    const made = await buildPipe(model, device, spec);
    pipe = made;
    pipeId = model;
    pipeInfo = { ms: Math.round(performance.now() - t0), cached: false, device, dtype: label, model };
    note('whisper load end ' + model + ' ' + pipeInfo.ms + 'ms ' + memLine());
    return pipeInfo;
  } catch (err) {
    note('whisper load fail ' + (err && err.message || err) + ' ' + memLine());
    clearBase();
    await disposePipe('load-fail');
    if (model === BASE) {
      baseBanned = true;
      note('whisper base not ready, using tiny');
      return createPipe(TINY);
    }
    throw err;
  }
}

export function modelForSession(opts){
  return (opts && (opts.ios || opts.tiny || opts.banned)) ? TINY : BASE;
}
export function modelsToWarm(opts){
  return [modelForSession(opts)];
}
export async function ensureModel(){
  return locked(async () => {
    noteCrashOnce();
    lowerModelFetch();
    if (modelForSession({ tiny: wantsTiny(), banned: baseBanned, ios: isIOS() }) === TINY) {
      if (pipe && pipeId !== TINY) await disposePipe('tiny');
      return createPipe(TINY);
    }
    if (await baseFilesReady()) {
      if (pipe && pipeId !== BASE) await disposePipe('base');
      return createPipe(BASE);
    }
    note('whisper base not ready, using tiny');
    if (pipe && pipeId !== TINY) await disposePipe('tiny');
    return createPipe(TINY);
  });
}

function activePipe(){ return pipe; }

function rms(samples){
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (samples.length || 1));
}

function concat(chunks){
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Float32Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

function resample(input, fromRate){
  if (!input.length) return input;
  if (fromRate === TARGET_RATE) return input;
  const outLen = Math.max(1, Math.round(input.length * TARGET_RATE / fromRate));
  const out = new Float32Array(outLen);
  const step = fromRate / TARGET_RATE;
  for (let i = 0; i < outLen; i++) {
    const x = i * step;
    const i0 = Math.floor(x);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const f = x - i0;
    out[i] = input[i0] * (1 - f) + input[i1] * f;
  }
  return out;
}

function captureTrack(stream){
  return stream && stream.getAudioTracks ? stream.getAudioTracks()[0] : null;
}
function trackUnusable(stream){
  const t = captureTrack(stream);
  if (!t) return 'none';
  if (t.readyState === 'ended') return 'ended';
  if (t.muted) return 'muted';
  return '';
}
function watchTrack(track, log){
  if (!track || track.__capWatch) return;
  track.__capWatch = true;
  try {
    track.addEventListener('mute', () => { try { log('cap track mute'); } catch (_) {} });
    track.addEventListener('unmute', () => { try { log('cap track unmute'); } catch (_) {} });
  } catch (_) {}
}
function freshMic(){
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  });
}
function stopStream(stream){
  try { stream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} }); } catch (_) {}
}

function trackLine(stream){
  const t = stream && stream.getAudioTracks && stream.getAudioTracks()[0];
  if (!t) return 'none';
  return 'muted=' + (t.muted ? 'true' : 'false') + ' ready=' + (t.readyState || '');
}

function mimeForRecorder(){
  const list = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
  if (!window.MediaRecorder) return '';
  for (const t of list) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch (_) {}
  }
  return '';
}

function trimSilence(audio, rate){
  if (!audio || !audio.length) return { samples: audio || new Float32Array(0), start: 0, end: 0 };
  const frame = Math.max(1, Math.round(rate * 0.03));
  let first = -1;
  let last = -1;
  for (let i = 0; i < audio.length; i += frame) {
    const slice = audio.subarray(i, Math.min(audio.length, i + frame));
    if (rms(slice) >= VOICE_RMS) {
      if (first < 0) first = i;
      last = i + slice.length;
    }
  }
  if (first < 0) return { samples: new Float32Array(0), start: 0, end: 0 };
  const pad = Math.round(rate * 0.3);
  const cap = Math.round(rate * 5);
  const minKeep = Math.min(audio.length, Math.round(rate * 1.0));
  let a = Math.max(0, first - pad);
  let b = Math.min(audio.length, last + pad);
  if (b - a < minKeep) {
    const mid = Math.floor((Math.max(0, first) + last) / 2);
    a = Math.max(0, mid - Math.floor(minKeep / 2));
    b = Math.min(audio.length, a + minKeep);
    if (b - a < minKeep) a = Math.max(0, b - minKeep);
  }
  if (b - a > cap) b = Math.min(audio.length, a + cap);
  return { samples: audio.subarray(a, b), start: a, end: b };
}
export function trimPcm(audio, rate){ return trimSilence(audio, rate); }
export function deafEarly(peak, elapsedMs){ return elapsedMs >= 600 && peak < 0.001; }
export function commitAllowed(tapAt, now){
  return !!(tapAt && now >= tapAt && (now - tapAt) < 4000);
}
export const SCORE_CAP = 8;
export const TOKEN_CAP = 3;
export const WATCH_MS = 8000;
export function watchExpired(elapsedMs, heard){
  return elapsedMs >= WATCH_MS && !heard;
}
export function typedWord(raw){
  const text = String(raw || '').replace(/[\u200e\u200f\u202a-\u202e]/g, '').trim();
  if (!text) return { commit: false, text: '' };
  return { commit: true, text };
}
export async function runLearnListen(env){
  if (!env || !env.tapped) return { commit: false, acquires: 0, why: 'no-tap' };
  let acquires = 0;
  let now = 0;
  let heard = false;
  for (let n = 1; n <= 2; n++) {
    if (watchExpired(now, heard)) return { commit: false, acquires, why: 'watch' };
    acquires++;
    const rec = await env.acquire({ attempt: n, fresh: n > 1, settleMs: 0 });
    now = rec && rec.at != null ? rec.at : now;
    if (rec && Number(rec.peak) >= 0.02) {
      heard = true;
      const text = await env.transcribe(rec.audio);
      const fixed = env.correct ? env.correct(text) : text;
      return { commit: true, acquires, text: fixed || '', why: 'commit' };
    }
  }
  if (watchExpired(now, heard)) return { commit: false, acquires, why: 'watch' };
  return { commit: false, acquires, why: 'silent', text: '' };
}

export function recordUtterance(opts){
  const onVoice = opts && opts.onVoice;
  const log = (opts && opts.log) || function () {};
  const givenCtx = opts && opts.ctx;
  const givenStream = opts && opts.stream;
  const keep = !!(opts && opts.keep);
  return new Promise((resolve, reject) => {
    let stream = null;
    let ctx = givenCtx || null;
    let proc = null;
    let source = null;
    let mute = null;
    let settled = false;
    let cap = 0;
    let tick = 0;
    let peak = 0;
    let sumSq = 0;
    let count = 0;
    let heard = false;
    let usedRecorder = false;
    let replaced = false;
    const all = [];
    const said = [];
    const t0 = performance.now();
    const measure = (copy) => {
      for (let i = 0; i < copy.length; i++) {
        const v = copy[i];
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
        sumSq += v * v;
      }
      count += copy.length;
    };
    const stats = (extra) => Object.assign({
      durationMs: Math.round(performance.now() - t0),
      peak,
      rms: count ? Math.sqrt(sumSq / count) : 0,
      samples: count,
      via: usedRecorder ? 'recorder' : 'processor',
    }, extra || {});
    const finishAudio = (why, audio, rate) => {
      if (settled) return;
      settled = true;
      clearTimeout(cap);
      clearInterval(tick);
      try { if (proc) { proc.onaudioprocess = null; proc.disconnect(); proc = null; } } catch (_) {}
      try { if (source) { source.disconnect(); source = null; } } catch (_) {}
      try { if (mute) { mute.disconnect(); mute = null; } } catch (_) {}
      stopStream(stream);
      stream = null;
      try { if (ctx && ctx.state !== 'closed') ctx.close(); } catch (_) {}
      ctx = null;
      const full = audio && audio.length ? resample(audio, rate || TARGET_RATE) : new Float32Array(0);
      let trimmed = trimSilence(full, TARGET_RATE);
      let slice = trimmed.samples;
      if (!slice.length && full.length) { slice = full; trimmed = { samples: full, start: 0, end: full.length }; }
      if (slice.length > TARGET_RATE * 5) {
        slice = slice.subarray(0, TARGET_RATE * 5);
        trimmed = { samples: slice, start: trimmed.start, end: trimmed.start + slice.length };
      }
      const out = new Float32Array(slice.length);
      if (slice.length) out.set(slice);
      all.length = 0;
      said.length = 0;
      try {
        log('cap rate ' + (rate || 0));
        log('pcm16k samples ' + full.length);
        log('pcm16k duration ' + (full.length / TARGET_RATE).toFixed(2) + 's');
        log('pcm16k kept ' + out.length);
        log('pcm16k kept start ' + Math.round(1000 * trimmed.start / TARGET_RATE) + 'ms end ' + Math.round(1000 * trimmed.end / TARGET_RATE) + 'ms');
      } catch (_) {}
      resolve(Object.assign({ heard: !!(out && out.length), why: why === 'silence' ? 'pause' : why, audio: out, rate: rate || 0 }, stats()));
    };
    const finishProcessor = (why) => {
      const rate = (ctx && ctx.sampleRate) || 48000;
      const audio = all.length ? concat(all) : new Float32Array(0);
      finishAudio(why, audio, rate);
    };
    const report = () => {
      const closed = !!(ctx && ctx.state === 'closed');
      let ended = false;
      try {
        const tracks = stream && stream.getAudioTracks ? stream.getAudioTracks() : [];
        ended = !!(tracks.length && tracks.every(t => t.readyState === 'ended'));
      } catch (_) {}
      if (settled || closed || ended) { clearInterval(tick); tick = 0; return; }
      try {
        log('cap level peak=' + peak.toFixed(2));
        log('cap ctx state ' + (ctx && ctx.state || 'none'));
        log('cap samples ' + count);
        log('cap track ' + trackLine(stream));
      } catch (_) {}
    };
    cap = setTimeout(() => { if (!usedRecorder) finishProcessor('timeout'); }, MAX_MS + 2000);
    const openGraph = async (s) => {
      stream = s;
      const bad = trackUnusable(stream);
      if (bad) {
        try { log('cap track ' + bad + ', fresh'); } catch (_) {}
        try { stopStream(stream); } catch (_) {}
        replaced = true;
        stream = await freshMic();
      }
      watchTrack(captureTrack(stream), log);
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!ctx || ctx.state === 'closed') ctx = new AC();
      const resume = (ctx.state === 'suspended' && ctx.resume) ? ctx.resume() : Promise.resolve();
      return Promise.resolve(resume).then(async () => {
        for (let i = 0; i < 12 && ctx.state !== 'running'; i++) {
          try { if (ctx.resume) await ctx.resume(); } catch (_) {}
          await new Promise(r => setTimeout(r, 40));
        }
        report();
        source = ctx.createMediaStreamSource(stream);
        proc = ctx.createScriptProcessor(4096, 1, 1);
        mute = ctx.createGain();
        mute.gain.value = 0;
        source.connect(proc);
        proc.connect(mute);
        mute.connect(ctx.destination);
        const rate = ctx.sampleRate || 48000;
        const preMax = Math.round(rate * PRE_MS / 1000);
        const pre = [];
        let preSamples = 0;
        let voiced = false;
        let lastVoice = 0;
        let speechAt = 0;
        const captureStart = performance.now();
        proc.onaudioprocess = (ev) => {
          if (settled || usedRecorder) return;
          const copy = new Float32Array(ev.inputBuffer.getChannelData(0));
          const now = performance.now();
          const level = rms(copy);
          measure(copy);
          all.push(copy);
          if (!heard) {
            pre.push(copy);
            preSamples += copy.length;
            while (preSamples > preMax && pre.length > 1) {
              preSamples -= pre[0].length;
              pre.shift();
            }
          }
          if (level >= VOICE_RMS) {
            if (!heard) {
              heard = true;
              speechAt = now;
              lastVoice = now;
              for (const c of pre) said.push(c);
              pre.length = 0;
              if (!voiced) { voiced = true; try { if (onVoice) onVoice(); } catch (_) {} }
            } else {
              said.push(copy);
              lastVoice = now;
            }
          } else if (heard) {
            said.push(copy);
            if (shouldCloseCapture(now, speechAt, lastVoice, heard)) { finishProcessor('pause'); return; }
          }
          if (now - captureStart >= MAX_MS) finishProcessor(heard ? 'max' : 'no-speech');
        };
        tick = setInterval(report, 1000);
        setTimeout(() => {
          if (settled || usedRecorder) return;
          if (count > 0) return;
          usedRecorder = true;
          clearTimeout(cap);
          cap = setTimeout(() => { if (!settled) finishProcessor('recorder-timeout'); }, MAX_MS + 3000);
          try { log('cap recorder fallback'); } catch (_) {}
          try { if (proc) { proc.onaudioprocess = null; proc.disconnect(); } } catch (_) {}
          recordWithRecorder(stream, ctx, log).then(done => {
            if (done && done.audio && done.audio.length) {
              peak = Math.max(peak, done.peak || 0);
              finishAudio('recorder', done.audio, done.rate || TARGET_RATE);
            } else finishProcessor('recorder-empty');
          }, () => finishProcessor('recorder-fail'));
        }, 1000);
      });
    };
    const streamP = givenStream || navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
    Promise.resolve(streamP).then(s => {
      if (settled) { if (s && !keep) stopStream(s); return; }
      if (!s) {
        return navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
        }).then(openGraph);
      }
      return openGraph(s);
    }).catch(reject);
  });
}

function recordWithRecorder(stream, ctx, log){
  return new Promise((resolve, reject) => {
    let rec;
    const chunks = [];
    try {
      const mime = mimeForRecorder();
      rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch (err) { reject(err); return; }
    rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
    rec.onerror = () => reject(new Error('recorder'));
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/mp4' });
      blob.arrayBuffer().then(buf => ctx.decodeAudioData(buf.slice(0))).then(decoded => {
        const rate = decoded.sampleRate || TARGET_RATE;
        const audio = decoded.getChannelData(0);
        const copy = new Float32Array(audio.length);
        copy.set(audio);
        let peak = 0;
        let sum = 0;
        for (let i = 0; i < copy.length; i++) {
          const a = copy[i] < 0 ? -copy[i] : copy[i];
          if (a > peak) peak = a;
          sum += copy[i] * copy[i];
        }
        try { log('cap samples ' + copy.length); } catch (_) {}
        const kept = trimSilence(copy, rate);
        const audioOut = kept.samples && kept.samples.length ? kept.samples : copy;
        resolve({ audio: audioOut, rate, peak, rms: copy.length ? Math.sqrt(sum / copy.length) : 0 });
      }).catch(reject);
    };
    try { rec.start(); } catch (err) { reject(err); return; }
    setTimeout(() => { try { if (rec.state === 'recording') rec.stop(); } catch (_) {} }, MAX_MS);
  });
}

export async function warmUp(){
  return;
}

function cleanText(out){
  let t = String((out && out.text) || '').replace(/\s+/g, ' ').trim();
  if (t.length > 80) t = t.slice(0, 80).trim();
  return t;
}

async function runPipe(audio, tag){
  const current = activePipe();
  if (!current) throw new Error('no model');
  const language = whisperName(tag);
  const opts = {
    task: 'transcribe',
    return_timestamps: false,
    max_new_tokens: 16,
    no_repeat_ngram_size: 3,
  };
  if (language) opts.language = language;
  try {
    return cleanText(await current(audio, opts));
  } catch (err) {
    const msg = String(err && err.message || err || '');
    if (/device lost|out of memory|webgpu/i.test(msg)) throw err;
    const plain = { task: 'transcribe', return_timestamps: false };
    if (language) plain.language = language;
    return cleanText(await current(audio, plain));
  }
}

async function fallBackTiny(){
  clearBase();
  baseBanned = true;
  await disposePipe('fallback');
  await createPipe(TINY);
}

export async function transcribe(audio, tag){
  return locked(async () => {
    if (!pipe) await createPipe(wantsTiny() || baseBanned ? TINY : (pipeId || TINY));
    const model = pipeId;
    if (model === BASE) markBase();
    note('whisper infer start ' + model + ' ' + memLine());
    try {
      const text = await runPipe(audio, tag);
      if (model === BASE) clearBase();
      note('whisper infer end ' + model + ' ' + memLine());
      return text;
    } catch (err) {
      note('whisper infer fail ' + (err && err.message || err) + ' ' + memLine());
      if (model !== TINY) {
        await fallBackTiny();
        try {
          const text = await runPipe(audio, tag);
          note('whisper infer end tiny ' + memLine());
          return text;
        } catch (err2) {
          note('whisper infer fail tiny ' + (err2 && err2.message || err2));
        }
      }
      clearBase();
      return '';
    }
  });
}

function logSumExp(data, offset, vocab){
  let max = -Infinity;
  for (let i = 0; i < vocab; i++) {
    const v = data[offset + i];
    if (v > max) max = v;
  }
  let sum = 0;
  for (let i = 0; i < vocab; i++) sum += Math.exp(data[offset + i] - max);
  return max + Math.log(sum);
}

function asIdList(ids){
  if (!ids) return [];
  if (ids.input_ids) return asIdList(ids.input_ids);
  if (ids.data) return asIdList(ids.data);
  if (typeof ids.length !== 'number') return [];
  return Array.from(ids).map(Number).filter(id => id >= 0 && id < 50257);
}
export function tokenIds(tok, text){
  const word = String(text || '');
  if (!tok || !word) return [];
  try {
    if (tok.encode) return asIdList(tok.encode(word, { add_special_tokens: false }));
  } catch (_) {}
  try {
    if (typeof tok === 'function') return asIdList(tok(word, { add_special_tokens: false }));
  } catch (_) {}
  return [];
}
export const TARGET_FLOOR = -5.2;
export const TARGET_MARGIN = 0.28;
export const TARGET_BIG = 1;
export function shouldCloseCapture(now, speechAt, lastVoice, heard){
  if (!heard || !speechAt) return false;
  return now - lastVoice >= SILENCE_MS && now - speechAt >= 1500;
}
export function followCapture(events){
  let speechAt = 0;
  let lastVoice = 0;
  let heard = false;
  let end = 0;
  for (const ev of events || []) {
    end = ev.ms;
    if (ev.rms >= 0.012) {
      if (!heard) speechAt = ev.ms;
      heard = true;
      lastVoice = ev.ms;
    } else if (shouldCloseCapture(ev.ms, speechAt, lastVoice, heard)) {
      return { heard, end: ev.ms, speechAt, restarted: false };
    }
  }
  return { heard, end, speechAt, restarted: false };
}
export function foldLatin(raw){
  return String(raw || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
}
function sameTarget(a, b){
  if (String(a || '') === String(b || '')) return true;
  const fa = foldLatin(a);
  const fb = foldLatin(b);
  return !!(fa && fb && fa === fb);
}
function squashLatin(raw){
  return foldLatin(raw).replace(/(.)\1+/g, '$1');
}
function consonantSkeleton(raw){
  return squashLatin(raw).replace(/[aeiou]/g, '');
}
export function phoneticTarget(heard, expected){
  const h = squashLatin(heard);
  const e = squashLatin(expected);
  if (!h || !e) return false;
  const spokenGap = Math.abs(foldLatin(heard).length - foldLatin(expected).length);
  if (spokenGap > 2) return false;
  if (h === e) return true;
  if (h[0] === e[0]) {
    const limit = Math.max(1, Math.round(Math.max(h.length, e.length) * 0.35));
    if (edits(h, e, limit) <= limit) return true;
  }
  const hc = consonantSkeleton(heard);
  const ec = consonantSkeleton(expected);
  if (!hc || !ec) return false;
  const longer = hc.length >= ec.length ? hc : ec;
  const shorter = longer === hc ? ec : hc;
  if (edits(hc, ec, Math.max(hc.length, ec.length)) > 1) return false;
  let i = 0;
  for (const ch of longer) if (ch === shorter[i]) i++;
  return i === shorter.length;
}
export function fuzzyTarget(heard, expected){
  return phoneticTarget(heard, expected);
}
function cleanRealWord(raw){
  const s = String(raw || '').trim().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return /^[A-Za-z]{3,}$/.test(s);
}
export function clearlyDifferent(heard, expected){
  const h = foldLatin(heard);
  const e = foldLatin(expected);
  if (!h || !e || h[0] === e[0]) return false;
  const d = edits(h, e, Math.max(h.length, e.length));
  return d > Math.max(h.length, e.length) * 0.5;
}
export function targetAccept(scores, expected, freeText){
  const rows = (scores || []).filter(s => s && typeof s.score === 'number' && s.score > -20);
  const mine = rows.find(s => sameTarget(s.text, expected));
  if (freeText && phoneticTarget(freeText, expected)) {
    return { accept: true, text: expected, why: 'fuzzy', score: mine ? mine.score : 0, scores: rows };
  }
  if (!freeText || !mine) {
    return { accept: false, text: String(freeText || ''), why: 'miss', score: mine ? mine.score : null, scores: rows };
  }
  const freeFold = foldLatin(freeText);
  const freeRow = rows.find(s => !sameTarget(s.text, expected) && foldLatin(s.text) === freeFold);
  const distractors = rows.filter(s => !sameTarget(s.text, expected) && foldLatin(s.text) !== freeFold);
  const freeIsReal = !!(freeRow && cleanRealWord(freeText) && clearlyDifferent(freeText, expected));
  const rivals = freeIsReal ? distractors.concat([freeRow]) : distractors;
  let gap = rivals.length ? Infinity : 0;
  let ahead = null;
  for (const row of rivals) {
    const lead = mine.score - row.score;
    if (lead < gap) { gap = lead; ahead = row; }
  }
  if (gap < TARGET_MARGIN) {
    const why = (freeIsReal && freeRow && mine.score < freeRow.score - TARGET_BIG) || (ahead && clearlyDifferent(ahead.text, expected)) ? 'different' : 'miss';
    return { accept: false, text: String(freeText), why, score: mine.score, scores: rows };
  }
  if (mine.score <= TARGET_FLOOR) {
    return { accept: false, text: String(freeText), why: 'miss', score: mine.score, scores: rows };
  }
  if (freeIsReal && mine.score < freeRow.score - TARGET_BIG) {
    return { accept: false, text: String(freeText), why: 'different', score: mine.score, scores: rows };
  }
  return { accept: true, text: expected, why: 'score', score: mine.score, scores: rows };
}
export function scoreDecision(scores, expected, freeText){
  const hit = targetAccept(scores, expected, freeText || '');
  return hit.accept ? expected : '';
}
const HE_PLACES = ['באר שבע'];
const SKEL_DROP = { 'א': 1, 'ע': 1, 'ה': 1, 'י': 1 };
const SKEL_MAP = { 'ח': 'כ', 'ט': 'ת', 'ק': 'כ', 'ס': 'ש', 'ב': 'ו', 'ו': 'ו' };
export function hebSkeleton(raw){
  const folded = heFold(String(raw || '')).replace(/[^\u05D0-\u05EA]/g, '');
  let out = '';
  for (const ch of folded) {
    if (SKEL_DROP[ch]) continue;
    out += SKEL_MAP[ch] || ch;
  }
  return out;
}
function hebShow(word){
  const text = String(word || '').replace(/\s+/g, ' ').trim();
  return text;
}
function skelDist(a, b){
  const longer = Math.max(a.length, b.length);
  if (!longer) return 1;
  const d = edits(a, b, longer);
  return d / longer;
}
export function resolveHebrew(raw, letter, words){
  const tokens = heToks(raw).map(heFold);
  const joined = tokens.join('');
  const sk = hebSkeleton(joined);
  if (!joined || joined.length < 3) return { text: '', candidates: [], skeleton: sk, tooShort: true };
  const hits = [];
  const push = (text) => {
    const shown = hebShow(text);
    const letters = heFold(shown).replace(/[^\u05D0-\u05EA]/g, '');
    if (!letters) return;
    const skN = hebSkeleton(shown);
    if (!skN || skelDist(sk, skN) > 0.35) return;
    const diff = Math.abs(letters.length - joined.length);
    if (diff > 3 && !HE_PLACES.includes(shown)) return;
    if (!hits.some(h => h.text === shown)) hits.push({ text: shown, diff, dist: skelDist(sk, skN), first: letters[0] });
  };
  for (const place of HE_PLACES) push(place);
  if (words) for (const item of words) push(item);
  hits.sort((a, b) => a.dist - b.dist || a.diff - b.diff || a.text.length - b.text.length);
  const place = hits.find(h => HE_PLACES.includes(h.text) && h.dist === 0 && (!letter || h.first === letter));
  const candidates = hits.map(h => h.text).slice(0, 8);
  return { text: place ? place.text : '', candidates, skeleton: sk, tooShort: false };
}
export function pickHebrew(raw, letter, scores){
  const letters = heFold(String(raw || '')).replace(/[^\u05D0-\u05EA]/g, '');
  if (letters.length < 3) return { text: '', why: 'short' };
  const ranked = (scores || []).filter(s => s && typeof s.score === 'number' && s.score > -20)
    .slice().sort((a, b) => b.score - a.score);
  if (!ranked.length) return { text: '', why: 'none' };
  const best = ranked[0];
  const first = heFold(best.text).replace(/[^\u05D0-\u05EA]/g, '')[0];
  if (letter && first && first !== letter) return { text: best.text, why: 'letter' };
  return { text: best.text, why: 'ok' };
}
export function targetVariants(expected, words){
  const raw = String(expected || '').trim();
  const fold = foldLatin(raw);
  const out = [];
  const seen = new Set();
  const add = (w) => {
    const s = String(w || '').trim();
    const key = s.toLowerCase();
    if (!s || !key || key === raw.toLowerCase() || seen.has(key) || out.length >= 6) return;
    seen.add(key);
    out.push(s);
  };
  const vowels = 'aeiou';
  if (fold) {
    let swaps = 0;
    for (let i = 0; i < fold.length && swaps < 2; i++) {
      const at = vowels.indexOf(fold[i]);
      if (at < 0) continue;
      add(fold.slice(0, i) + vowels[(at + 1) % vowels.length] + fold.slice(i + 1));
      swaps++;
    }
    if (fold.length > 3) add(fold.slice(0, -2));
    add(fold + fold.slice(-1));
  }
  const want = fold.length || raw.length;
  const similar = [];
  for (const w of words || []) {
    const n = foldLatin(w);
    if (!n || n === fold || Math.abs(n.length - want) > 1) continue;
    similar.push(String(w));
  }
  const step = Math.max(1, Math.floor(similar.length / 3));
  for (let i = 0; i < similar.length && out.length < 6; i += step) add(similar[i]);
  return out;
}
export function scoreBest(scores, min){
  const floor = min == null ? -3 : min;
  const real = (scores || []).filter(s => s && typeof s.score === 'number' && s.score > -20);
  if (!real.length) return null;
  real.sort((a, b) => b.score - a.score);
  return real[0].score > floor ? real[0] : null;
}
export function learnPick(raw, scores){
  const picked = decideLearn(raw, scores, false);
  return picked.commit ? picked.text : '';
}
export function decideLearn(raw, scores, inDict){
  const fold = heFold(String(raw || '').replace(/[^\u05D0-\u05EA]/g, ''));
  const ranked = (scores || []).filter(s => s && typeof s.score === 'number' && s.score > -20)
    .slice().sort((a, b) => b.score - a.score || heFold(b.text).length - heFold(a.text).length);
  const rawHit = ranked.find(s => heFold(s.text) === fold);
  const good = ranked.filter(s => s.score > -3);
  let pick = null;
  if (fold.length <= 2) {
    const longer = good.filter(s => heFold(s.text).length > fold.length);
    if (longer.length && longer[0].score >= (rawHit ? rawHit.score : -99) - 1) pick = longer[0];
  }
  if (!pick && good.length) {
    const top = good[0];
    if (!inDict || fold.length <= 2 || heFold(top.text) !== fold) pick = top;
    else if (rawHit && top.text !== rawHit.text && top.score >= rawHit.score + 1) pick = top;
    else if (inDict && fold.length > 2) pick = rawHit || { text: fold, score: 'exact' };
  } else if (!pick && inDict && fold.length > 2) {
    pick = rawHit || { text: fold, score: 'exact' };
  }
  const text = pick ? pick.text : '';
  const score = pick ? pick.score : 'none';
  const sameRaw = text && heFold(text) === fold;
  const commit = !!(text && ((inDict && sameRaw && fold.length > 2) || (typeof score === 'number' && score > -3 && !sameRaw) || (inDict && sameRaw && typeof score === 'number' && score > -3)));
  const ask = commit ? [] : ranked.slice(0, 3).map(s => s.text).filter(w => heFold(w) !== fold);
  return { commit, text, best: text, score, candidates: ranked.length, ask };
}
const HE_FIN = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
function heFold(w){
  return String(w || '').replace(/[\u0591-\u05C7]/g, '').replace(/[ךםןףץ]/g, ch => HE_FIN[ch] || ch);
}
function heToks(raw){
  return String(raw || '').replace(/[\u0591-\u05C7]/g, '').replace(/[^\u05D0-\u05EA\s]/g, ' ').match(/[\u05D0-\u05EA]+/g) || [];
}
function edits(a, b, max){
  if (!a || !b || Math.abs(a.length - b.length) > max) return max + 1;
  let prev = [];
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
export function nearWords(raw, letter, words){
  const tokens = heToks(raw).map(heFold);
  const seeds = tokens.slice();
  if (tokens.length > 1) seeds.push(tokens.join(''));
  const heads = ['א', 'ה', 'ע', 'י'];
  const out = [];
  const seen = new Set();
  const known = new Set((words || []).map(heFold));
  const add = (w) => {
    const n = heFold(w);
    if (!n || seen.has(n)) return;
    if (letter && n[0] !== letter) return;
    seen.add(n);
    out.push(n);
  };
  if (tokens.length > 1) out.push(tokens.join(' '));
  for (const t of tokens) {
    if (known.has(t)) add(t);
    for (const h of heads) if (known.has(h + t)) add(h + t);
  }
  const list = words || [];
  for (const w of list) {
    const n = heFold(w);
    if (!n) continue;
    for (const seed of seeds) {
      if (seed && n.endsWith(seed) && n.length > seed.length && n.length - seed.length <= 2) add(n);
    }
  }
  for (const seed of seeds) {
    if (!seed || seed.length < 2 || seed.length > 14) continue;
    const hits = [];
    const keep = (n, d) => {
      let i = 0;
      while (i < hits.length && (hits[i].d < d || (hits[i].d === d && hits[i].n.length <= n.length))) i++;
      if (i >= SCORE_CAP) return;
      hits.splice(i, 0, { n, d });
      if (hits.length > SCORE_CAP) hits.pop();
    };
    for (const w of list) {
      const n = heFold(w);
      if (!n || Math.abs(n.length - seed.length) > 2) continue;
      if (letter && n[0] !== letter) continue;
      const d = edits(seed, n, 2);
      if (d <= 2) keep(n, d);
    }
    for (const h of hits) add(h.n);
  }
  return out.filter(Boolean).slice(0, SCORE_CAP);
}
export function cheapScores(raw, words){
  const fold = heFold(String(raw || '').replace(/[^\u05D0-\u05EA]/g, ''));
  const list = nearWords(raw, '', words || []);
  const longer = list.some(w => {
    const n = heFold(w);
    return n && n !== fold && n.length > fold.length && edits(fold, n, 2) <= 2;
  });
  return list.map(w => {
    const n = heFold(w);
    const d = edits(fold, n, 2);
    let score = -2.4;
    if (n === fold) score = (fold.length <= 2 && longer) ? -4 : -0.5;
    else if (fold.length <= 2 && n.length > fold.length && d <= 2) score = d <= 1 ? -1.0 : -1.2;
    else if (fold && ['א', 'ה', 'ע', 'י'].some(h => n === h + fold)) score = -1.2;
    else if (d <= 0) score = -0.5;
    else if (d === 1) score = -1.4;
    else if (n.endsWith(fold) && n.length - fold.length > 0 && n.length - fold.length <= 2) score = -1.3;
    else score = -2.2;
    return { text: w, score };
  });
}
function dictSurface(words, folded, rawJoined){
  const raw = String(rawJoined || '');
  let plain = '';
  let finals = '';
  for (const item of words || []) {
    const shown = String(item).trim();
    if (!shown) continue;
    const flat = shown.replace(/\s/g, '');
    if (flat === raw || shown === raw) return shown;
    if (heFold(flat) !== folded && heFold(shown) !== folded) continue;
    if (/[ךםןףץ]/.test(flat)) finals = finals || shown;
    else plain = plain || shown;
  }
  if (finals) return finals;
  if (/[ךםןףץ]/.test(raw) && heFold(raw) === folded) return raw;
  return plain;
}
export function learnRescore(raw, words){
  const original = String(raw || '').replace(/[^\u05D0-\u05EA\s]/g, '').replace(/\s+/g, ' ').trim();
  const rawTokens = heToks(original);
  const joinedRaw = rawTokens.join('');
  const tokens = rawTokens.map(heFold);
  const joined = tokens.join('');
  if (!joined) return { text: original, best: '', score: 'none', candidates: 0, commit: false, ask: [] };
  const exact = dictSurface(words, joined, joinedRaw);
  if (exact && heFold(exact.replace(/\s/g, '')) === joined) return { text: exact, best: exact, score: 0, candidates: 1, commit: true, ask: [] };
  const skHit = resolveHebrew(joined, joined[0], words);
  if (!skHit.tooShort && skHit.text && skHit.candidates.length === 1 && hebSkeleton(skHit.text) === hebSkeleton(joined)) {
    return { text: skHit.text, best: skHit.text, score: 0, candidates: 1, commit: true, ask: [] };
  }
  const maxEdits = Math.floor(joined.length * 0.25);
  const weak = new Set(['א', 'ה', 'ע']);
  const penalty = (a, b) => {
    if (a.length !== b.length) return Math.abs(a.length - b.length) + 1;
    let p = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) continue;
      if (!(weak.has(a[i]) && weak.has(b[i]))) p++;
    }
    return p;
  };
  let best = '';
  let bestShown = '';
  let bestD = maxEdits + 1;
  let bestP = 99;
  let seen = 0;
  const ask = [];
  if (maxEdits >= 1 && words) {
    for (const item of words) {
      const shown = String(item).trim();
      const n = heFold(shown);
      if (!n || n === joined) continue;
      const diff = Math.abs(n.length - joined.length);
      if (diff > maxEdits) continue;
      const ratio = Math.max(n.length, joined.length) / Math.min(n.length, joined.length);
      if (ratio > 1.25) continue;
      seen++;
      const d = edits(joined, n, maxEdits);
      if (d > maxEdits) continue;
      const norm = d / Math.max(joined.length, n.length);
      const p = penalty(joined, n);
      if (d < bestD || (d === bestD && diff < Math.abs(best.length - joined.length)) || (d === bestD && diff === Math.abs(best.length - joined.length) && p < bestP)) {
        bestD = d; best = n; bestShown = shown; bestP = p;
      }
      if (ask.length < 3 && norm <= 0.25 && diff === 0 && ask.indexOf(shown) < 0) ask.push(shown);
    }
  }
  if (bestShown) {
    const norm = bestD / Math.max(joined.length, best.length);
    const ratio = Math.max(best.length, joined.length) / Math.min(best.length, joined.length);
    if (norm <= 0.25 && ratio <= 1.25 && !(joined.length >= 5 && best.length <= 3)) {
      return { text: bestShown, best: bestShown, score: Math.round(-norm * 1000) / 1000, candidates: seen, commit: true, ask: [] };
    }
  }
  return { text: joinedRaw || original, best: bestShown || joinedRaw || original, score: 'raw', candidates: seen, commit: false, ask: ask.filter(w => w !== bestShown) };
}

async function scoreOnce(audio, tag, texts, earlyScore){
  const current = activePipe();
  if (!current || !current.model || !audio || !audio.length) return null;
  const lang = whisperName(tag) || 'english';
  let cfg, init;
  try {
    cfg = current.model._prepare_generation_config(null, { language: lang, task: 'transcribe', return_timestamps: false });
    init = current.model._retrieve_init_tokens(cfg);
  } catch (_) { return null; }
  if (!init || !init.length) return null;
  let features;
  try {
    features = await current.processor(audio);
  } catch (_) { return null; }
  const input_features = features && features.input_features;
  if (!input_features) { dropTensor(features); return null; }
  const eos = cfg.eos_token_id || 50257;
  const jobs = [];
  for (const text of texts) {
    const word = tokenIds(current.tokenizer, text);
    note('whisper score tokens "' + text + '" n=' + word.length);
    if (!word.length) continue;
    const ids = init.concat(word, [eos]);
    jobs.push({ text: String(text), ids, row: ids.slice(0, -1) });
  }
  const scored = await scoreCandidates(current.model, input_features, jobs, { early: earlyScore, initLen: init.length });
  dropTensor(input_features);
  features = null;
  if (!scored) return null;
  note('whisper encoder runs ' + scored.encoderRuns);
  return scored.scores;
}
function openEncoder(model){
  const session = model && model.sessions && model.sessions.model;
  const orig = session && typeof session.run === 'function' ? session.run.bind(session) : null;
  let runs = 0;
  let hidden = null;
  if (orig) {
    session.run = async function (feeds){
      runs++;
      const out = await orig(feeds);
      if (!out || typeof out !== 'object') return out;
      return new Proxy(out, {
        set(target, prop, value){
          target[prop] = value;
          if (prop === 'last_hidden_state') hidden = value;
          return true;
        },
      });
    };
  }
  return {
    runs(){ return runs; },
    hidden(){ return hidden; },
    restore(){ if (orig && session) session.run = orig; },
  };
}
function scoreLogits(logits, ids, initLen){
  const data = logits && logits.data;
  const dims = logits && logits.dims;
  if (!data || !dims) return -99;
  const vocab = dims[dims.length - 1];
  const from = Math.max(0, initLen - 1);
  let sum = 0, n = 0;
  for (let pos = from; pos < ids.length - 1; pos++) {
    const offset = pos * vocab;
    const target = ids[pos + 1];
    if (target < 0 || target >= vocab) continue;
    sum += data[offset + target] - logSumExp(data, offset, vocab);
    n++;
  }
  return n ? Math.round((sum / n) * 1000) / 1000 : -99;
}
export async function scoreCandidates(model, input_features, jobs, opts){
  if (!model || !input_features) return null;
  const early = opts && opts.early;
  const initLen = opts && opts.initLen || 0;
  const share = openEncoder(model);
  const scores = [];
  try {
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      const row = job.row || job.ids;
      const args = { decoder_input_ids: row };
      if (share.hidden()) args.encoder_outputs = share.hidden();
      else args.input_features = input_features;
      let result = null;
      try {
        result = await model(args);
      } catch (_) {
        try {
          const T = input_features.constructor;
          const data = BigInt64Array.from(row.map(n => BigInt(n)));
          const retry = Object.assign({}, args, { decoder_input_ids: new T('int64', data, [1, row.length]) });
          result = await model(retry);
        } catch (__) {
          dropTensor(result && result.logits);
          return null;
        }
      }
      const logits = result && result.logits;
      const score = scoreLogits(logits, job.ids, initLen);
      dropTensor(logits);
      scores.push({ text: job.text, score });
      if (i === 0 && typeof early === 'number' && score > early) break;
    }
  } finally {
    share.restore();
  }
  return { scores, encoderRuns: share.runs() };
}
async function forwardJob(model, input_features, share, job){
  const row = job.row || job.ids;
  const args = { decoder_input_ids: row };
  if (share.hidden()) args.encoder_outputs = share.hidden();
  else args.input_features = input_features;
  let result = null;
  try {
    result = await model(args);
  } catch (_) {
    const T = input_features.constructor;
    const data = BigInt64Array.from(row.map(n => BigInt(n)));
    result = await model(Object.assign({}, args, { decoder_input_ids: new T('int64', data, [1, row.length]) }));
  }
  return result;
}
export async function hearWithModel(model, features, jobs, decode, makeJob, opts){
  if (!model || !features) return null;
  const share = openEncoder(model);
  const initLen = opts && opts.initLen || 0;
  const scores = [];
  let text = '';
  try {
    for (const job of jobs || []) {
      const result = await forwardJob(model, features, share, job);
      const logits = result && result.logits;
      scores.push({ text: job.text, score: scoreLogits(logits, job.ids, initLen), tokens: job.ids.length });
      dropTensor(logits);
    }
    if (decode) text = await decode(features, share.hidden()) || '';
    if (text && makeJob && !scores.some(s => sameTarget(s.text, text))) {
      const job = makeJob(text);
      if (job) {
        const result = await forwardJob(model, features, share, job);
        const logits = result && result.logits;
        scores.push({ text: job.text, score: scoreLogits(logits, job.ids, initLen), tokens: job.ids.length });
        dropTensor(logits);
      }
    }
  } finally {
    share.restore();
  }
  return { scores, text, encoderRuns: share.runs() };
}
export function greedyOptions(features, hidden, lang){
  const opts = {
    input_features: features,
    task: 'transcribe',
    return_timestamps: false,
    max_new_tokens: 16,
  };
  if (lang) opts.language = lang;
  if (hidden) opts.encoder_outputs = hidden;
  return opts;
}
async function greedyOrPipe(current, audio, features, hidden, tag){
  const lang = whisperName(tag);
  const started = Date.now();
  if (features && current.model && current.model.generate) {
    try {
      const gen = await current.model.generate(features, greedyOptions(features, hidden, lang));
      const seq = Array.isArray(gen) ? (gen[0] || gen) : (gen && (gen.sequences || gen));
      if (current.tokenizer && current.tokenizer.decode && seq) {
        const text = current.tokenizer.decode(seq, { skip_special_tokens: true });
        if (text && String(text).trim()) {
          note('whisper greedy ms ' + (Date.now() - started));
          return cleanText({ text });
        }
      }
    } catch (err) {
      note('whisper greedy ' + (err && err.message || err));
    }
  }
  const text = await runPipe(audio, tag);
  note('whisper greedy fallback ms ' + (Date.now() - started));
  return text;
}
export async function targetHear(audio, tag, texts){
  return locked(async () => {
    const current = activePipe();
    if (!current || !current.model || !audio || !audio.length) return { scores: [], text: '', encoderRuns: 0 };
    const lang = whisperName(tag) || 'english';
    let cfg, init;
    try {
      cfg = current.model._prepare_generation_config(null, { language: lang, task: 'transcribe', return_timestamps: false });
      init = current.model._retrieve_init_tokens(cfg);
    } catch (_) { return { scores: [], text: '', encoderRuns: 0 }; }
    if (!init || !init.length) return { scores: [], text: '', encoderRuns: 0 };
    let features;
    try { features = await current.processor(audio); }
    catch (_) { return { scores: [], text: '', encoderRuns: 0 }; }
    const input_features = features && features.input_features;
    if (!input_features) { dropTensor(features); return { scores: [], text: '', encoderRuns: 0 }; }
    const eos = cfg.eos_token_id || 50257;
    const jobs = [];
    for (const text of (texts || []).slice(0, 8)) {
      const word = tokenIds(current.tokenizer, text);
      note('whisper score tokens "' + text + '" n=' + word.length);
      if (!word.length) continue;
      const ids = init.concat(word, [eos]);
      jobs.push({ text: String(text), ids, row: ids.slice(0, -1) });
    }
    note('whisper infer start score ' + (pipeId || 'none') + ' ' + memLine());
    const heard = await hearWithModel(current.model, input_features, jobs, (feat, hidden) => greedyOrPipe(current, audio, feat, hidden, tag), (text) => {
      const word = tokenIds(current.tokenizer, text);
      if (!word.length) return null;
      const ids = init.concat(word, [eos]);
      return { text: String(text), ids, row: ids.slice(0, -1) };
    }, { initLen: init.length });
    dropTensor(input_features);
    note('whisper encoder runs ' + ((heard && heard.encoderRuns) || 0));
    note('whisper infer end score ' + memLine());
    return heard || { scores: [], text: '', encoderRuns: 0 };
  });
}
function dropTensor(t){
  try { if (t && typeof t.dispose === 'function') t.dispose(); } catch (_) {}
}

export async function scoreTexts(audio, tag, texts, opts){
  const cap = opts && opts.limit ? opts.limit : TOKEN_CAP;
  const capped = (texts || []).slice(0, cap);
  const early = opts && typeof opts.early === 'number' ? opts.early : null;
  return locked(async () => {
    const model = pipeId;
    if (model === BASE) markBase();
    note('whisper infer start score ' + (model || 'none') + ' ' + memLine());
    try {
      const scored = await scoreOnce(audio, tag, capped, early);
      if (model === BASE) clearBase();
      note('whisper infer end score ' + memLine());
      return scored;
    } catch (err) {
      note('whisper infer fail score ' + (err && err.message || err) + ' ' + memLine());
      clearBase();
      if (model && model !== TINY) {
        try {
          await fallBackTiny();
          return await scoreOnce(audio, tag, capped, early);
        } catch (_) { return null; }
      }
      return null;
    }
  });
}
