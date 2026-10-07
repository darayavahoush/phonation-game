// Pure DSP, no browser APIs. Safe to unit-test in Node.
// LPC (autocorrelation + Levinson-Durbin) -> smooth spectral envelope -> formant peaks.

export const ANALYSIS_RATE = 11025; // Hz after decimation; Nyquist 5.5 kHz covers F1-F4

/** Average-decimate native-rate samples to ~ANALYSIS_RATE (crude low-pass built in). */
export function decimate(samples, nativeRate) {
  const step = Math.max(1, Math.round(nativeRate / ANALYSIS_RATE));
  const n = Math.floor(samples.length / step);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < step; j++) s += samples[i * step + j];
    out[i] = s / step;
  }
  return { data: out, rate: nativeRate / step };
}

export function rms(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length));
}

/** Returns LPC coefficients a[0..order], a[0]=1, for A(z)=1+a1 z^-1+... */
export function lpc(frame, order) {
  const n = frame.length;
  const r = new Float64Array(order + 1);
  for (let k = 0; k <= order; k++) {
    let s = 0;
    for (let i = 0; i < n - k; i++) s += frame[i] * frame[i + k];
    r[k] = s;
  }
  r[0] = r[0] * 1.0001 + 1e-9; // white-noise correction, keeps it stable
  const a = new Float64Array(order + 1);
  a[0] = 1;
  let err = r[0];
  for (let i = 1; i <= order; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
    const k = -acc / err;
    const prev = a.slice();
    for (let j = 1; j < i; j++) a[j] = prev[j] + k * prev[i - j];
    a[i] = k;
    err *= 1 - k * k;
    if (err <= 0) break;
  }
  return a;
}

/** LPC envelope in dB on a uniform grid 0..rate/2. */
export function envelope(a, rate, bins = 256) {
  const db = new Float32Array(bins);
  const hz = new Float32Array(bins);
  for (let b = 0; b < bins; b++) {
    const w = (Math.PI * b) / (bins - 1);
    let re = 0, im = 0;
    for (let k = 0; k < a.length; k++) {
      re += a[k] * Math.cos(w * k);
      im -= a[k] * Math.sin(w * k);
    }
    db[b] = -10 * Math.log10(re * re + im * im + 1e-12);
    hz[b] = (rate / 2) * (b / (bins - 1));
  }
  return { db, hz };
}

/** Local maxima of the envelope, with parabolic refinement. Returns Hz ascending. */
export function pickPeaks(env, { minHz = 200, maxHz = 4800, max = 4 } = {}) {
  const { db, hz } = env;
  const out = [];
  for (let i = 1; i < db.length - 1; i++) {
    if (hz[i] < minHz || hz[i] > maxHz) continue;
    if (db[i] > db[i - 1] && db[i] >= db[i + 1]) {
      const d = db[i - 1] - 2 * db[i] + db[i + 1];
      const off = d !== 0 ? (0.5 * (db[i - 1] - db[i + 1])) / d : 0;
      const step = hz[1] - hz[0];
      out.push({ hz: hz[i] + off * step, db: db[i] });
    }
  }
  return out.slice(0, max);
}

/**
 * One analysis frame. `samples` = native-rate Float32Array (~25-40 ms).
 * Returns null when unvoiced / too quiet.
 */
export function analyzeFrame(samples, nativeRate, opts = {}) {
  const { minRms = 0.01, order = 12, bins = 256 } = opts;
  if (rms(samples) < minRms) return null;
  const { data, rate } = decimate(samples, nativeRate);
  // pre-emphasis + Hamming window
  const n = data.length;
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const pe = data[i] - (i ? 0.97 * data[i - 1] : 0);
    f[i] = pe * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  const a = lpc(f, order);
  const env = envelope(a, rate, bins);
  const peaks = pickPeaks(env);
  return {
    env,
    formants: peaks.map((p) => p.hz), // [F1, F2, F3, F4?]
    f1: peaks[0]?.hz ?? null,
    f2: peaks[1]?.hz ?? null,
    f3: peaks[2]?.hz ?? null,
  };
}

/** Spectral centroid (Hz) from a dB magnitude spectrum (AnalyserNode.getFloatFrequencyData). */
export function spectralCentroid(dbSpectrum, nativeRate, { minHz = 1500, maxHz = 11000 } = {}) {
  const binHz = nativeRate / 2 / dbSpectrum.length;
  let num = 0, den = 0;
  for (let i = Math.floor(minHz / binHz); i < Math.min(dbSpectrum.length, Math.floor(maxHz / binHz)); i++) {
    const mag = Math.pow(10, dbSpectrum[i] / 20);
    num += mag * (i * binHz);
    den += mag;
  }
  return den > 0 ? num / den : null;
}
