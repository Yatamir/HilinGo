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

export function recordUtterance(onVoice){
  return new Promise((resolve, reject) => {
    let stream = null;
    let ctx = null;
    let proc = null;
    let settled = false;
    let cap = 0;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(cap);
      try { if (proc) { proc.onaudioprocess = null; proc.disconnect(); } } catch (_) {}
      stopStream(stream);
      try { if (ctx && ctx.state !== 'closed') ctx.close(); } catch (_) {}
      resolve(result);
    };
    cap = setTimeout(() => finish({ heard: false, why: 'timeout', audio: new Float32Array(0) }), MAX_MS + 1000);
    navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    }).then(s => {
      if (settled) { stopStream(s); return; }
      stream = s;
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      const resume = ctx.state === 'suspended' && ctx.resume ? ctx.resume() : Promise.resolve();
      return Promise.resolve(resume).then(() => {
        const source = ctx.createMediaStreamSource(stream);
        proc = ctx.createScriptProcessor(4096, 1, 1);
        const mute = ctx.createGain();
        mute.gain.value = 0;
        source.connect(proc);
        proc.connect(mute);
        mute.connect(ctx.destination);
        const rate = ctx.sampleRate || 48000;
        const preMax = Math.round(rate * PRE_MS / 1000);
        const pre = [];
        let preSamples = 0;
        const said = [];
        let heard = false;
        let voiced = false;
        let lastVoice = 0;
        const t0 = performance.now();
        proc.onaudioprocess = (ev) => {
          const input = ev.inputBuffer.getChannelData(0);
          const copy = new Float32Array(input);
          const now = performance.now();
          const level = rms(copy);
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
            if (now - lastVoice >= SILENCE_MS) {
              finish({ heard: true, why: 'silence', audio: resample(concat(said), rate) });
              return;
            }
          }
          if (now - t0 >= MAX_MS) {
            finish({
              heard,
              why: heard ? 'max' : 'no-speech',
              audio: heard ? resample(concat(said), rate) : new Float32Array(0),
            });
          }
        };
      });
    }).catch(reject);
  });
}

export async function transcribe(audio, tag){
  const language = whisperName(tag);
  const opts = { task: 'transcribe', return_timestamps: false };
  if (language) opts.language = language;
  const out = await pipe(audio, opts);
  return String((out && out.text) || '').replace(/\s+/g, ' ').trim();
}
