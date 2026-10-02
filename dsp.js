/**
 * Pure DSP + statistics helpers.
 * No DOM / Web Audio dependencies, so everything here runs (and is tested) in Node.
 */

export const EPS = 1e-12;

export const ampToDb = (a) => 20 * Math.log10(Math.max(Math.abs(a), EPS));
export const powToDb = (p) => 10 * Math.log10(Math.max(p, EPS));
export const hzToSemitones = (hz, refHz = 100) => 12 * Math.log2(hz / refHz);
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const round = (x, d = 2) => {
  if (x == null || !Number.isFinite(x)) return null;
  const m = 10 ** d;
  return Math.round(x * m) / m;
};

// ---------------------------------------------------------------- statistics

export function rmsOf(buf, start = 0, end = buf.length) {
  let s = 0;
  const n = end - start;
  for (let i = start; i < end; i++) s += buf[i] * buf[i];
  return n > 0 ? Math.sqrt(s / n) : 0;
}

export function mean(a) {
  if (!a.length) return NaN;
  let s = 0;
  for (const x of a) s += x;
  return s / a.length;
}

/** Sample standard deviation (n-1). NaN for fewer than 2 values. */
export function sd(a) {
  if (a.length < 2) return NaN;
  const m = mean(a);
  let s = 0;
  for (const x of a) s += (x - m) ** 2;
  return Math.sqrt(s / (a.length - 1));
}

/** Percentile with linear interpolation, p in [0, 100]. */
export function percentile(a, p) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const r = (clamp(p, 0, 100) / 100) * (s.length - 1);
  const lo = Math.floor(r);
  const hi = Math.ceil(r);
  return s[lo] + (s[hi] - s[lo]) * (r - lo);
}

export const median = (a) => percentile(a, 50);

export function medianFilter(a, k = 5) {
  const h = k >> 1;
  return a.map((_, i) => median(a.slice(Math.max(0, i - h), Math.min(a.length, i + h + 1))));
}

export function movingAverage(a, k = 5) {
  const h = k >> 1;
  return a.map((_, i) => mean(a.slice(Math.max(0, i - h), Math.min(a.length, i + h + 1))));
}

/** Least-squares slope of ys against xs. */
export function slope(xs, ys) {
  const n = xs.length;
  if (n < 2) return NaN;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den > 0 ? num / den : NaN;
}

// ----------------------------------------------------------------------- FFT

export class FFT {
  constructor(n) {
    if (n < 2 || (n & (n - 1)) !== 0) throw new Error('FFT size must be a power of two');
    this.n = n;
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      const a = (-2 * Math.PI * i) / n;
      this.cos[i] = Math.cos(a);
      this.sin[i] = Math.sin(a);
    }
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      this.rev[i] = r;
    }
  }

  /** In-place forward transform. */
  forward(re, im) {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const j = this.rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j;
          const b = a + half;
          const tr = this.cos[k] * re[b] - this.sin[k] * im[b];
          const ti = this.cos[k] * im[b] + this.sin[k] * re[b];
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }
}

export function hannWindow(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

// ------------------------------------------------------------- decimation

/**
 * Streaming anti-aliased decimator (windowed-sinc FIR, Hamming).
 * Brings any capture rate (44.1k / 48k / ...) to ~16 kHz so the rest of the
 * pipeline has one cost profile on every device.
 */
export class Decimator {
  constructor(sampleRate, targetRate = 16000) {
    this.factor = Math.max(1, Math.round(sampleRate / targetRate));
    this.rate = sampleRate / this.factor;
    if (this.factor === 1) return;
    const N = 24 * this.factor + 1;
    const fc = 0.43 / this.factor; // cycles/input-sample; output Nyquist is 0.5/factor
    const mid = (N - 1) / 2;
    const h = new Float64Array(N);
    let sum = 0;
    for (let k = 0; k < N; k++) {
      const x = 2 * fc * (k - mid);
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      h[k] = 2 * fc * sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * k) / (N - 1)));
      sum += h[k];
    }
    for (let k = 0; k < N; k++) h[k] /= sum;
    this.h = h;
    this.tail = new Float32Array(N - 1); // zeros: history before stream start
    this.base = -(N - 1); // global input index of tail[0]
    this.nextOut = 0; // global input index of next output sample
  }

  process(input) {
    if (this.factor === 1) return input;
    const N = this.h.length;
    const merged = new Float32Array(this.tail.length + input.length);
    merged.set(this.tail, 0);
    merged.set(input, this.tail.length);
    const lastGlobal = this.base + merged.length - 1;
    const out = [];
    while (this.nextOut <= lastGlobal) {
      const end = this.nextOut - this.base;
      let acc = 0;
      for (let k = 0; k < N; k++) acc += this.h[k] * merged[end - k];
      out.push(acc);
      this.nextOut += this.factor;
    }
    const keep = N - 1;
    this.tail = merged.slice(merged.length - keep);
    this.base = lastGlobal - keep + 1;
    return Float32Array.from(out);
  }
}

// ----------------------------------------------------------------- pitch (YIN)

/**
 * YIN fundamental-frequency estimator (de Cheveigné & Kawahara, 2002).
 * Reads buf[start .. start + W + tauMax].
 *
 * @returns {{f0: number, aperiodicity: number}}  f0 = 0 when no periodicity
 *          below `threshold` was found; aperiodicity is the CMNDF minimum
 *          (0 = perfectly periodic, ~1 = noise).
 */
export function yin(buf, start, sampleRate, opts = {}) {
  const { fMin = 75, fMax = 600, threshold = 0.2, windowSize = 400 } = opts;
  const tauMin = Math.max(2, Math.floor(sampleRate / fMax));
  const tauMax = Math.ceil(sampleRate / fMin);
  const W = windowSize;
  if (start < 0 || start + W + tauMax >= buf.length) return { f0: 0, aperiodicity: 1 };

  const cm = new Float64Array(tauMax + 1);
  cm[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    let d = 0;
    for (let j = 0; j < W; j++) {
      const diff = buf[start + j] - buf[start + j + tau];
      d += diff * diff;
    }
    running += d;
    cm[tau] = running > 0 ? (d * tau) / running : 1;
  }

  let tau = -1;
  for (let t = tauMin; t < tauMax; t++) {
    if (cm[t] < threshold) {
      while (t + 1 < tauMax && cm[t + 1] < cm[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) {
    let minV = Infinity;
    for (let t = tauMin; t < tauMax; t++) if (cm[t] < minV) minV = cm[t];
    return { f0: 0, aperiodicity: Number.isFinite(minV) ? minV : 1 };
  }

  let better = tau;
  if (tau > 1 && tau < tauMax) {
    const s0 = cm[tau - 1];
    const s1 = cm[tau];
    const s2 = cm[tau + 1];
    const denom = 2 * (s0 + s2 - 2 * s1);
    if (denom !== 0) better = tau + (s0 - s2) / denom;
  }
  return { f0: sampleRate / better, aperiodicity: cm[tau] };
}
