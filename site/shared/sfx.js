// Little synthesized sound effects for the paperclips, made with Web Audio, so there are no files to load.
// Browsers only allow sound after the visitor has clicked or pressed a key; nothing plays before then.
// localStorage "site.sound" = "off" silences them.

let ctx = null, out = null, noiseBuf = null;

function unlock() {
  if (ctx) {
    if (ctx.state === "suspended") ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  out = ctx.createGain();
  out.gain.value = 0.4;
  const limiter = ctx.createDynamicsCompressor(); // so a big clatter doesn't clip
  out.connect(limiter).connect(ctx.destination);
}
addEventListener("pointerdown", unlock, { capture: true });
addEventListener("keydown", unlock, { capture: true });

function muted() {
  try { return localStorage.getItem("site.sound") === "off"; } catch { return false; }
}
const ready = () => ctx && ctx.state === "running" && !document.hidden && !muted();

// At most perSec of a sound per second, so thousands of clips landing at once stay a clatter, not a roar.
const buckets = {};
function allow(name, perSec) {
  const now = performance.now();
  const b = (buckets[name] ??= { t: now, n: perSec });
  b.n = Math.min(perSec, b.n + ((now - b.t) / 1000) * perSec);
  b.t = now;
  if (b.n < 1) return false;
  b.n -= 1;
  return true;
}

function noise() {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  return src;
}

// A gain that rises to peak in `attack` seconds and dies away over `decay`.
function envelope(t, peak, attack, decay) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

function tone(type, t, from, to, dur, peak, into = out) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  if (to !== from) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  o.connect(envelope(t, peak, 0.004, dur)).connect(into);
  o.start(t);
  o.stop(t + dur + 0.05);
}

// A soft tick of plain noise, gently rounded off at both ends with no tone and no filter peak, so nothing in it
// rings: a clip tapping down. Broad, gentle, brief.
function tap(t, peak, top, decay) {
  const src = noise(), hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 180;
  hp.Q.value = 0.5;
  lp.type = "lowpass";
  lp.frequency.value = top;
  lp.Q.value = 0.5; // below 0.707: a gentle slope with no bump where it starts
  src.connect(hp).connect(lp).connect(envelope(t, peak, 0.004, decay)).connect(out);
  src.start(t, Math.random());
  src.stop(t + decay + 0.05);
}

// A clip landing. vol 0..1.
export function clink(vol = 0.5) {
  if (!ready() || !allow("clink", 22)) return;
  tap(ctx.currentTime, 0.2 * Math.min(1, vol), 1800 + Math.random() * 1400, 0.025 + Math.random() * 0.025);
}

// Clicking a clip: the same, a bit fuller and longer.
export function ping() {
  if (!ready()) return;
  tap(ctx.currentTime, 0.28, 2600, 0.06);
}

// A robot pops into being.
export function blip() {
  if (!ready() || !allow("blip", 8)) return;
  tone("square", ctx.currentTime, 420, 980, 0.09, 0.035);
}

// Nibbling a letter.
export function nibble() {
  if (!ready() || !allow("nibble", 14)) return;
  const t = ctx.currentTime, src = noise(), hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 2500 + Math.random() * 1500;
  src.connect(hp).connect(envelope(t, 0.07, 0.002, 0.025)).connect(out);
  src.start(t, Math.random());
  src.stop(t + 0.05);
}

// The eyes zapping something.
export function zap() {
  if (!ready() || !allow("zap", 6)) return;
  const t = ctx.currentTime, lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 2400;
  lp.connect(out);
  tone("sawtooth", t, 1100, 160, 0.24, 0.16, lp);
  tone("square", t, 1650, 240, 0.2, 0.05, lp);
}

// A long burn (on the shutdown button), lasting `seconds`.
export function burn(seconds) {
  if (!ready()) return;
  const t = ctx.currentTime, lp = ctx.createBiquadFilter(), g = ctx.createGain();
  lp.type = "lowpass";
  lp.frequency.value = 1400;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.12, t + 0.05);
  g.gain.setValueAtTime(0.12, t + seconds - 0.1);
  g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  lp.connect(g).connect(out);
  for (const f of [110, 113.5]) {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = f;
    o.connect(lp);
    o.start(t);
    o.stop(t + seconds + 0.05);
  }
}

// Paper tearing: band-passed noise that stutters as it goes. size 0..1.
export function rip(size = 0.5) {
  if (!ready() || !allow("rip", 2.5)) return;
  const t = ctx.currentTime, dur = 0.6 + size * 0.7, src = noise(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(2600, t);
  bp.frequency.exponentialRampToValueAtTime(900, t + dur);
  bp.Q.value = 0.8;
  g.gain.setValueAtTime(0.0001, t);
  for (let k = 0, s = t; s < t + dur; k++, s += 0.012 + Math.random() * 0.02) {
    g.gain.linearRampToValueAtTime((0.05 + Math.random() * 0.12) * (1 - (s - t) / dur), s);
  }
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(out);
  src.start(t, Math.random());
  src.stop(t + dur + 0.05);
}

// Everything letting go at the end: a falling whoosh, then a spill of clinks.
export function spill() {
  if (!ready()) return;
  const t = ctx.currentTime, src = noise(), lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(3000, t);
  lp.frequency.exponentialRampToValueAtTime(180, t + 1.3);
  src.connect(lp).connect(envelope(t, 0.12, 0.15, 1.2)).connect(out);
  src.start(t);
  src.stop(t + 1.5);
  for (let k = 0; k < 30; k++) setTimeout(() => clink(0.25 + Math.random() * 0.4), 150 + Math.random() * 1500);
}
