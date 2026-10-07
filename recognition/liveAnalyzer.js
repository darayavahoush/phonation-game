// Browser-only: mic -> AnalyserNode -> per-frame formants / centroid. No server involved.
import { analyzeFrame, spectralCentroid } from './formantTracker.js';

const median = (a) => {
  const s = a.filter((v) => v != null).sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

export async function startLiveAnalyzer({ onFrame, windowMs = 30, minRms = 0.01, stream: existing } = {}) {
  const stream = existing || (await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  }));
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 2048;
  an.smoothingTimeConstant = 0;
  src.connect(an);

  const rate = ctx.sampleRate;
  const win = Math.round((windowMs / 1000) * rate);
  const td = new Float32Array(an.fftSize);
  const fd = new Float32Array(an.frequencyBinCount);
  const hist = [];
  let raf = 0, stopped = false;

  const tick = () => {
    if (stopped) return;
    an.getFloatTimeDomainData(td);
    const frame = analyzeFrame(td.subarray(td.length - win), rate, { minRms });
    an.getFloatFrequencyData(fd);
    const centroid = frame ? spectralCentroid(fd, rate) : null;
    hist.push(frame?.f3 ?? null);
    if (hist.length > 5) hist.shift();
    onFrame?.(frame
      ? { voiced: true, env: frame.env, formants: frame.formants,
          f1: frame.f1, f2: frame.f2, f3: median(hist), centroid }
      : { voiced: false });
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return {
    sampleRate: rate,
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      src.disconnect();
      ctx.close();
      if (!existing) stream.getTracks().forEach((t) => t.stop());
    },
  };
}
