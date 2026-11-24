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
  try { if (await cache.match(url)) { note('whisper download ' + id + ' ' + file + ' 100%'); return true; } } catch (_) {}
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

export function prefetch(){
  noteCrashOnce();
  lowerModelFetch();
  const want = (wantsTiny() || baseBanned) ? TINY : BASE;
  (async () => {
    if (want === TINY) {
      for (const file of weightFiles(TINY)) { try { await cacheOne(TINY, file); } catch (_) {} }
      const info = await ensureModel();
      note('whisper warm ready ' + ((info && info.model) || TINY));
      return;
    }
    for (const file of weightFiles(TINY)) { try { await cacheOne(TINY, file); } catch (_) {} }
    let info = await ensureModel();
    note('whisper warm ready ' + ((info && info.model) || TINY));
    for (const file of weightFiles(BASE)) { try { await cacheOne(BASE, file); } catch (_) {} }
    info = await ensureModel();
    note('whisper warm ready ' + ((info && info.model) || ''));
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
  if (pipe && pipeId === id) return pipeInfo;
  if (pipe) await disposePipe('switch');
  let model = (baseBanned && id === BASE) ? TINY : id;
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

export async function ensureModel(){
  return locked(async () => {
    noteCrashOnce();
    lowerModelFetch();
    if (wantsTiny() || baseBanned) {
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
  let a = Math.max(0, first - pad);
  let b = Math.min(audio.length, last + pad);
  const minKeep = Math.min(audio.length, Math.round(rate * 1.2));
  if (b - a < minKeep) {
    const mid = Math.floor((first + last) / 2);
    a = Math.max(0, mid - Math.floor(minKeep / 2));
    b = Math.min(audio.length, a + minKeep);
    if (b - a < minKeep) a = Math.max(0, b - minKeep);
  }
  return { samples: audio.subarray(a, b), start: a, end: b };
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
      if (!keep) {
        stopStream(stream);
        stream = null;
        try { if (ctx && ctx.state !== 'closed') ctx.close(); } catch (_) {}
        ctx = null;
      }
      const full = audio && audio.length ? resample(audio, rate || TARGET_RATE) : new Float32Array(0);
      let trimmed = trimSilence(full, TARGET_RATE);
      let slice = trimmed.samples;
      if (!slice.length && full.length) { slice = full; trimmed = { samples: full, start: 0, end: full.length }; }
      if (slice.length > TARGET_RATE * 3) {
        slice = slice.subarray(0, TARGET_RATE * 3);
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
      try {
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
        let voiceAt = 0;
        let sawSample = false;
        const captureStart = performance.now();
        proc.onaudioprocess = (ev) => {
          if (settled || usedRecorder) return;
          const copy = new Float32Array(ev.inputBuffer.getChannelData(0));
          const now = performance.now();
          const level = rms(copy);
          const before = count;
          measure(copy);
          if (!sawSample && count > before) {
            sawSample = true;
            try { if (opts && opts.onFirstSample) opts.onFirstSample(); } catch (_) {}
          }
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
              voiceAt = now;
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
            const spokeFor = voiceAt ? (now - voiceAt) : 0;
            if (now - lastVoice >= SILENCE_MS && spokeFor >= 1800) { finishProcessor('pause'); return; }
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
    max_new_tokens: 12,
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
export function scoreDecision(scores, expected){
  const real = (scores || []).filter(s => s && typeof s.score === 'number' && s.score > -20);
  if (!real.length || !expected) return '';
  const best = real.slice().sort((a, b) => b.score - a.score)[0];
  const mine = real.find(s => s.text === expected);
  if (mine && best && best.text === expected && mine.score > -3) return expected;
  return '';
}
export function scoreBest(scores, min){
  const floor = min == null ? -3 : min;
  const real = (scores || []).filter(s => s && typeof s.score === 'number' && s.score > -20);
  if (!real.length) return null;
  real.sort((a, b) => b.score - a.score);
  return real[0].score > floor ? real[0] : null;
}
export function learnPick(raw, scores){
  const fold = heFold(String(raw || '').replace(/[^\u05D0-\u05EA]/g, ''));
  const real = (scores || []).filter(s => s && typeof s.score === 'number' && s.score > -3);
  if (!real.length) return '';
  const rawHit = real.find(s => heFold(s.text) === fold);
  const longer = real.filter(s => heFold(s.text).length > fold.length);
  longer.sort((a, b) => b.score - a.score);
  if (fold.length <= 2 && longer.length) {
    const base = rawHit ? rawHit.score : -99;
    if (longer[0].score >= base - 1) return longer[0].text;
  }
  real.sort((a, b) => b.score - a.score);
  return real[0].text;
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
    for (const w of list) {
      const n = heFold(w);
      if (!n || Math.abs(n.length - seed.length) > 2) continue;
      if (letter && n[0] !== letter) continue;
      const d = edits(seed, n, 2);
      if (d <= 2) hits.push({ n, d });
    }
    hits.sort((a, b) => a.d - b.d || a.n.length - b.n.length);
    for (const h of hits.slice(0, 6)) add(h.n);
  }
  return out.filter(Boolean).slice(0, 8);
}

async function scoreOnce(audio, tag, texts){
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
  if (!input_features) return null;
  const eos = cfg.eos_token_id || 50257;
  const out = [];
  for (const text of texts) {
    const word = tokenIds(current.tokenizer, text);
    note('whisper score tokens "' + text + '" n=' + word.length);
    if (!word.length) continue;
    const ids = init.concat(word, [eos]);
    const row = ids.slice(0, -1);
    let result = null;
    try {
      result = await current.model({ input_features, decoder_input_ids: row });
    } catch (_) {
      try {
        const T = input_features.constructor;
        const data = BigInt64Array.from(row.map(n => BigInt(n)));
        result = await current.model({ input_features, decoder_input_ids: new T('int64', data, [1, row.length]) });
      } catch (__) { return null; }
    }
    const logits = result && result.logits;
    const data = logits && logits.data;
    const dims = logits && logits.dims;
    if (!data || !dims) { out.push({ text: String(text), score: -99 }); continue; }
    const vocab = dims[dims.length - 1];
    const from = Math.max(0, init.length - 1);
    let sum = 0, n = 0;
    for (let pos = from; pos < ids.length - 1; pos++) {
      const offset = pos * vocab;
      const target = ids[pos + 1];
      if (target < 0 || target >= vocab) continue;
      sum += data[offset + target] - logSumExp(data, offset, vocab);
      n++;
    }
    out.push({ text: String(text), score: n ? Math.round((sum / n) * 1000) / 1000 : -99 });
  }
  return out;
}

export async function scoreTexts(audio, tag, texts){
  return locked(async () => {
    const model = pipeId;
    if (model === BASE) markBase();
    note('whisper infer start score ' + (model || 'none') + ' ' + memLine());
    try {
      const scored = await scoreOnce(audio, tag, texts);
      if (model === BASE) clearBase();
      note('whisper infer end score ' + memLine());
      return scored;
    } catch (err) {
      note('whisper infer fail score ' + (err && err.message || err) + ' ' + memLine());
      clearBase();
      if (model && model !== TINY) {
        try {
          await fallBackTiny();
          return await scoreOnce(audio, tag, texts);
        } catch (_) { return null; }
      }
      return null;
    }
  });
}
