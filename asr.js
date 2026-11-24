// On-device speech for iPhone after a clip has played.
// Whisper tiny (multilingual, 8-bit) runs in the browser. Weights come from
// the public Hugging Face CDN once, then the Cache API keeps them.
// No server and no paid API.

const MODEL = 'Xenova/whisper-tiny';
const RUNTIME = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const TARGET_RATE = 16000;
const VOICE_RMS = 0.012;
const SILENCE_MS = 700;
const MAX_MS = 5000;
const PRE_MS = 300;

let pipe = null;
let loading = null;
let warmed = false;

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

async function pickDevice(){
  try {
    if (navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) return 'webgpu';
    }
  } catch (_) {}
  return 'wasm';
}

export async function ensureModel(){
  if (pipe) return { ms: 0, cached: true, device: pipe.__device || '' };
  if (loading) return loading;
  const t0 = performance.now();
  loading = (async () => {
    const { pipeline, env } = await import(RUNTIME);
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    let device = await pickDevice();
    const make = (dev) => pipeline('automatic-speech-recognition', MODEL, { dtype: 'q8', device: dev });
    try {
      pipe = await make(device);
    } catch (err) {
      if (device === 'wasm') throw err;
      device = 'wasm';
      pipe = await make(device);
    }
    pipe.__device = device;
    return { ms: Math.round(performance.now() - t0), cached: false, device };
  })();
  try {
    return await loading;
  } catch (err) {
    loading = null;
    throw err;
  }
}

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
  if (!audio || !audio.length) return audio;
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
  if (first < 0) return new Float32Array(0);
  const pad = Math.round(rate * 0.2);
  const a = Math.max(0, first - pad);
  const b = Math.min(audio.length, last + pad);
  return audio.subarray(a, b);
}

export function recordUtterance(opts){
  const onVoice = opts && opts.onVoice;
  const log = (opts && opts.log) || function () {};
  const givenCtx = opts && opts.ctx;
  const givenStream = opts && opts.stream;
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
      try { if (proc) { proc.onaudioprocess = null; proc.disconnect(); } } catch (_) {}
      try { if (source) source.disconnect(); } catch (_) {}
      try { if (mute) mute.disconnect(); } catch (_) {}
      stopStream(stream);
      try { if (ctx && ctx.state !== 'closed') ctx.close(); } catch (_) {}
      const out = audio && audio.length ? resample(audio, rate || TARGET_RATE) : new Float32Array(0);
      resolve(Object.assign({ heard: !!(out && out.length), why, audio: out }, stats()));
    };
    const finishProcessor = (why) => {
      const rate = (ctx && ctx.sampleRate) || 48000;
      const audio = said.length ? concat(said) : new Float32Array(0);
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
    const openGraph = (s) => {
      stream = s;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!ctx || ctx.state === 'closed') ctx = new AC();
      const resume = (ctx.state === 'suspended' && ctx.resume) ? ctx.resume() : Promise.resolve();
      return Promise.resolve(resume).then(() => {
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
        const captureStart = performance.now();
        proc.onaudioprocess = (ev) => {
          if (settled || usedRecorder) return;
          const copy = new Float32Array(ev.inputBuffer.getChannelData(0));
          const now = performance.now();
          const level = rms(copy);
          measure(copy);
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
            if (now - lastVoice >= SILENCE_MS) { finishProcessor('silence'); return; }
          }
          if (now - captureStart >= MAX_MS) finishProcessor(heard ? 'max' : 'no-speech');
        };
        tick = setInterval(report, 1000);
        setTimeout(() => {
          if (settled || usedRecorder) return;
          if (count > 0 && peak > 0) return;
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
      if (settled) { stopStream(s); return; }
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
        resolve({ audio: kept.length ? kept : copy, rate, peak, rms: copy.length ? Math.sqrt(sum / copy.length) : 0 });
      }).catch(reject);
    };
    try { rec.start(); } catch (err) { reject(err); return; }
    setTimeout(() => { try { if (rec.state === 'recording') rec.stop(); } catch (_) {} }, MAX_MS);
  });
}

export async function warmUp(){
  if (warmed || !pipe) return;
  const n = TARGET_RATE;
  const audio = new Float32Array(n);
  for (let i = 0; i < n; i++) audio[i] = (Math.random() * 2 - 1) * 0.01;
  await pipe(audio, { task: 'transcribe', language: 'hebrew', return_timestamps: false });
  warmed = true;
}

export async function transcribe(audio, tag){
  const language = whisperName(tag);
  const opts = { task: 'transcribe', return_timestamps: false };
  if (language) opts.language = language;
  const out = await pipe(audio, opts);
  return String((out && out.text) || '').replace(/\s+/g, ' ').trim();
}
