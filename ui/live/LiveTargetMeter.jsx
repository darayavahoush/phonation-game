import { useEffect, useMemo, useRef, useState } from 'react';
import { startLiveAnalyzer } from '../../recognition/liveAnalyzer.js';
import { measure, inZone, createHoldTracker, R_F3_PRESETS, R_F3_MIN_HZ } from '../../recognition/liveTarget.js';

const FORMANT_RANGE = [0, 5000];
const CENTROID_RANGE = [1500, 10000];

export default function LiveTargetMeter({ target, active = true, onSuccess, showControls = false, height = 220 }) {
  const canvasRef = useRef(null);
  const latest = useRef(null);
  const hold = useMemo(() => createHoldTracker(target.holdMs ?? 300), [target.holdMs]);
  const [limit, setLimit] = useState(target.belowHz ?? null);
  const [hit, setHit] = useState(false);
  const [error, setError] = useState(null);
  const tgt = useMemo(() => (limit != null ? { ...target, belowHz: limit } : target), [target, limit]);
  const tgtRef = useRef(tgt); tgtRef.current = tgt;
  const doneRef = useRef(false);

  useEffect(() => { setHit(false); doneRef.current = false; hold.reset(); }, [target, hold]);

  useEffect(() => {
    if (!active) return;
    let h, cancelled = false;
    startLiveAnalyzer({ onFrame: (f) => { latest.current = f; } })
      .then((a) => { if (cancelled) a.stop(); else h = a; })
      .catch((e) => setError(e.name === 'NotAllowedError' ? 'Microphone is blocked. Allow it in the browser address bar.' : 'Could not start the microphone.'));
    return () => { cancelled = true; h?.stop(); };
  }, [active]);

  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext('2d');
    let raf;
    const draw = () => {
      const t = tgtRef.current, f = latest.current;
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const isF = t.type === 'formant';
      const [lo, hi] = isF ? FORMANT_RANGE : CENTROID_RANGE;
      const X = (hz) => ((hz - lo) / (hi - lo)) * w;
      const value = measure(t, f);
      const ok = inZone(t, value);
      const { progress, done } = hold.update(ok);
      if (done && !doneRef.current) { doneRef.current = true; setHit(true); onSuccess?.(); }

      // success zone
      ctx.fillStyle = ok ? 'rgba(20,160,120,0.22)' : 'rgba(20,160,120,0.10)';
      const zl = t.minHz != null ? X(t.minHz) : 0;
      const zr = t.belowHz != null ? X(t.belowHz) : t.maxHz != null ? X(t.maxHz) : w;
      ctx.fillRect(Math.max(0, zl), 0, Math.max(0, Math.min(w, zr) - Math.max(0, zl)), h);

      // spectrum envelope (formant mode only)
      if (isF && f?.voiced) {
        const { db, hz } = f.env;
        let mn = Infinity, mx = -Infinity;
        for (const v of db) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
        ctx.beginPath();
        for (let i = 0; i < db.length; i++) {
          const x = X(hz[i]), y = h - 12 - ((db[i] - mn) / (mx - mn || 1)) * (h - 40);
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.lineWidth = 3; ctx.strokeStyle = ok ? '#0f9a73' : '#3b4a8f'; ctx.stroke();
      }
      // target line(s)
      ctx.setLineDash([6, 5]); ctx.lineWidth = 2; ctx.strokeStyle = '#c2410c';
      for (const hz of [t.belowHz, t.minHz, t.maxHz]) if (hz != null) {
        ctx.beginPath(); ctx.moveTo(X(hz), 0); ctx.lineTo(X(hz), h); ctx.stroke();
      }
      ctx.setLineDash([]);
      // live marker
      if (value != null) {
        ctx.fillStyle = ok ? '#0f9a73' : '#3b4a8f';
        ctx.beginPath(); ctx.arc(X(Math.min(hi, Math.max(lo, value))), h - 12, 9, 0, 7); ctx.fill();
      }
      // hold progress
      ctx.fillStyle = '#0f9a73'; ctx.fillRect(0, h - 4, w * progress, 4);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [hold, onSuccess]);

  return (
    <div>
      <canvas ref={canvasRef} role="img" aria-label="Live sound meter"
        style={{ width: '100%', height, display: 'block', borderRadius: 12, background: 'var(--meter-bg, #f4f6fb)' }} />
      {error && <p role="alert">{error}</p>}
      {hit && <p aria-live="polite">Got it!</p>}
      {showControls && target.type === 'formant' && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <label>Preset{' '}
            <select defaultValue="" onChange={(e) => { const [s, a] = e.target.value.split('|'); if (s) setLimit(R_F3_PRESETS[s][a]); }}>
              <option value="">Choose age / sex</option>
              {Object.entries(R_F3_PRESETS).flatMap(([s, ages]) => Object.keys(ages).map((a) => (
                <option key={s + a} value={`${s}|${a}`}>{s}, {a} years</option>)))}
            </select>
          </label>
          <label>Target {limit ?? target.belowHz} Hz{' '}
            <input type="range" min={R_F3_MIN_HZ} max={3000} step={50} value={limit ?? target.belowHz}
              onChange={(e) => setLimit(+e.target.value)} />
          </label>
        </div>
      )}
    </div>
  );
}
