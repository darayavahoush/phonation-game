// Synthetic audio for tests. Deterministic (seeded PRNG).
export const FS = 48000;

export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Background noise at roughly `db` dBFS RMS. */
export function noise(dur, db = -70, seed = 7, fs = FS) {
  const r = rng(seed);
  const a = Math.sqrt(3) * 10 ** (db / 20);
  const out = new Float32Array(Math.round(dur * fs));
  for (let i = 0; i < out.length; i++) out[i] = (r() * 2 - 1) * a;
  return out;
}

/**
 * Harmonic "vowel-like" tone: 1/h harmonic rolloff, phase-continuous.
 * f0 may be a number or a function of time (s); amp may be a number or fn(t).
 */
export function tone(f0, dur, { amp = 0.2, harmonics = 10, fs = FS, attack = 0.015 } = {}) {
  const n = Math.round(dur * fs);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    const f = typeof f0 === 'function' ? f0(t) : f0;
    const a = typeof amp === 'function' ? amp(t) : amp;
    phase += (2 * Math.PI * f) / fs;
    let s = 0;
    for (let h = 1; h <= harmonics; h++) if (f * h < fs / 2 * 0.9) s += Math.sin(h * phase) / h;
    const env = Math.min(1, t / attack, (dur - t) / attack);
    out[i] = a * s * Math.max(0, env) * 0.6;
  }
  return out;
}

/** Broadband noise burst / aspiration. */
export function burst(dur, amp, seed = 3, fs = FS) {
  const r = rng(seed);
  const out = new Float32Array(Math.round(dur * fs));
  for (let i = 0; i < out.length; i++) out[i] = (r() * 2 - 1) * amp;
  return out;
}

export function silence(dur, fs = FS) {
  return new Float32Array(Math.round(dur * fs));
}

export function concat(...parts) {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Add low-level background noise to a signal. */
export function withNoise(sig, db = -70, seed = 11) {
  const n = noise(sig.length / FS, db, seed);
  const out = new Float32Array(sig.length);
  for (let i = 0; i < sig.length; i++) out[i] = sig[i] + n[i];
  return out;
}

/** Feed a signal to an analyzer in fixed-size blocks (like an AudioWorklet would). */
export function feed(analyzer, sig, block = 512) {
  for (let i = 0; i < sig.length; i += block) analyzer.push(sig.subarray(i, Math.min(sig.length, i + block)));
}

/** Calibrate on `dur` seconds of background noise. */
export function calibrate(analyzer, db = -70, dur = 1.5) {
  analyzer.startCalibration();
  feed(analyzer, noise(dur, db, 99));
  return analyzer.finishCalibration();
}
