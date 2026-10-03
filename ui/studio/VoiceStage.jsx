import { useEffect, useRef } from 'react'

// One calm moving element: a lantern that swells and warms while the voice is on.
// Everything is drawn from requestAnimationFrame reading a ref; React never re-renders per frame.
// No flashing: nothing changes brightness faster than ~4 Hz, and ripples are slow and soft.
const PAL = { glass: [143, 224, 212], lamp: [255, 155, 84] } // mint-light -> ember (tailwind.config.js)
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t))
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`

export default function VoiceStage({ read, active, goalMs, glide, gain = 1, reduced, onOnset }) {
  const ref = useRef(null)
  const cfg = useRef({})
  cfg.current = { read, active, goalMs, glide, gain, reduced, onOnset }

  useEffect(() => {
    const cv = ref.current
    const ctx = cv.getContext('2d')
    let raf, last = performance.now(), W = 0, H = 0
    const S = { t: 0, r: 0, warm: 0, run: 0, was: false, trail: [], ripples: [], acc: 0, lv: 0 }
    const fit = () => {
      const d = Math.min(2, window.devicePixelRatio || 1), b = cv.getBoundingClientRect()
      W = b.width; H = b.height; cv.width = W * d; cv.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0)
    }
    fit(); const ro = new ResizeObserver(fit); ro.observe(cv)

    const frame = (now) => {
      const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); last = now
      if (W < 2 || H < 2) { raf = requestAnimationFrame(frame); return } // canvas not laid out yet
      const { read, active, goalMs, glide, gain, reduced, onOnset } = cfg.current
      const v = active ? read() : { voiced: false, level: 0, pitch: null }
      const k = reduced ? 1 : 1 - Math.exp(-dt / 0.09) // ~90 ms response: feels instant, not jittery
      const base = Math.min(W, H) * 0.2
      const target = base * (1 + (v.voiced ? 0.2 + v.level * 0.55 * gain : 0))
      S.r += (target - S.r) * k
      S.warm += ((v.voiced ? 1 : 0) - S.warm) * (reduced ? 1 : 1 - Math.exp(-dt / 0.25))
      if (v.voiced) S.run += dt * 1000; else S.run = 0
      if (v.voiced && !S.was) { onOnset?.(); if (!reduced && S.ripples.length < 5) S.ripples.push({ age: 0 }) }
      S.was = v.voiced

      S.lv += ((v.voiced ? v.level : 0) - S.lv) * 0.3 // smoothed so the trail tapers instead of ending in a cliff
      S.acc += dt
      while (S.acc > 1 / 30) { S.acc -= 1 / 30; S.trail.push({ p: v.voiced ? v.pitch : null, l: S.lv }); if (S.trail.length > 240) S.trail.shift() }

      ctx.clearRect(0, 0, W, H)
      const cx = W * 0.62, cy = H * 0.5, col = mix(PAL.glass, PAL.lamp, S.warm)

      // trail: pitch ribbon for glide levels, soft loudness swell for everything else
      if (S.trail.length > 2) {
        const span = cx - W * 0.06, step = span / 240, off = 240 - S.trail.length
        ctx.lineCap = 'round'; ctx.lineJoin = 'round'
        if (glide) {
          const lo = Math.log2(80), hi = Math.log2(500), y = (p) => H * 0.82 - ((Math.log2(p) - lo) / (hi - lo)) * H * 0.64
          ctx.lineWidth = 6; ctx.strokeStyle = rgba(col, 0.75); ctx.beginPath(); let pen = false
          S.trail.forEach((s, i) => { if (s.p) { const X = cx - span + (off + i) * step; pen ? ctx.lineTo(X, y(s.p)) : ctx.moveTo(X, y(s.p)); pen = true } else pen = false })
          ctx.stroke()
        } else {
          ctx.beginPath(); ctx.moveTo(cx - span + off * step, cy)
          S.trail.forEach((s, i) => ctx.lineTo(cx - span + (off + i) * step, cy - s.l * H * 0.4 * gain))
          for (let i = S.trail.length - 1; i >= 0; i--) ctx.lineTo(cx - span + (off + i) * step, cy + S.trail[i].l * H * 0.4 * gain)
          ctx.closePath(); ctx.strokeStyle = rgba(col, 0.9); ctx.lineWidth = 3; const g = ctx.createLinearGradient(cx - span, 0, cx, 0)
          g.addColorStop(0, rgba(col, 0)); g.addColorStop(1, rgba(col, 0.5)); ctx.fillStyle = g; ctx.fill(); ctx.stroke()
        }
      }

      // ripples on each new voice onset
      S.ripples = S.ripples.filter((r) => (r.age += dt) < 1.6)
      S.ripples.forEach((r) => { const t = r.age / 1.6; ctx.strokeStyle = rgba(col, 0.35 * (1 - t)); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, S.r + t * base * 2.6, 0, 7); ctx.stroke() })

      // glow + lantern body
      const gr = Math.max(2, Math.min(S.r * 2.4, H / 2 - 1, W - cx - 1)) // keep the glow inside the canvas so it never shows an edge
      const glow = ctx.createRadialGradient(cx, cy, Math.min(S.r * 0.2, gr * 0.5), cx, cy, gr)
      glow.addColorStop(0, rgba(col, 0.38 + 0.2 * S.warm)); glow.addColorStop(1, rgba(col, 0))
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, gr, 0, 7); ctx.fill()
      const body = ctx.createRadialGradient(cx - S.r * 0.3, cy - S.r * 0.35, S.r * 0.1, cx, cy, S.r)
      body.addColorStop(0, rgba(mix(col, [255, 255, 255], 0.35), 1)); body.addColorStop(1, rgba(col, 0.92))
      ctx.fillStyle = body; ctx.beginPath(); ctx.arc(cx, cy, S.r, 0, 7); ctx.fill()
      // face: blinks every ~4 s, mouth opens with the voice
      S.t += dt
      const er = S.r * 0.085, ex = S.r * 0.3, ey = cy - S.r * 0.1, blink = !reduced && S.t % 4 < 0.12 ? 0.15 : 1
      ctx.fillStyle = 'rgba(255,107,74,.38)'; [-1, 1].forEach((s) => { ctx.beginPath(); ctx.arc(cx + s * S.r * 0.52, cy + S.r * 0.18, S.r * 0.12, 0, 7); ctx.fill() })
      ctx.fillStyle = '#2b1b3d'; [-1, 1].forEach((s) => { ctx.beginPath(); ctx.ellipse(cx + s * ex, ey, er, er * 1.35 * blink, 0, 0, 7); ctx.fill() })
      if (v.voiced) { const o = 0.4 + v.level * 0.6; ctx.beginPath(); ctx.ellipse(cx, cy + S.r * 0.3, S.r * 0.15, S.r * (0.05 + 0.17 * o), 0, 0, 7); ctx.fill() }
      else { ctx.strokeStyle = '#2b1b3d'; ctx.lineWidth = Math.max(2, S.r * 0.05); ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(cx, cy + S.r * 0.12, S.r * 0.22, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke() }

      // progress ring for "keep it going" levels
      if (goalMs) {
        ctx.lineWidth = 6; ctx.lineCap = 'round'
        ctx.strokeStyle = 'rgba(255,255,255,0.14)'
        ctx.beginPath(); ctx.arc(cx, cy, base * 2.05, 0, 7); ctx.stroke()
        ctx.strokeStyle = rgba(PAL.lamp, 0.9); ctx.beginPath()
        ctx.arc(cx, cy, base * 2.05, -Math.PI / 2, -Math.PI / 2 + Math.min(1, S.run / goalMs) * Math.PI * 2); ctx.stroke()
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [])

  return <canvas ref={ref} className="st-canvas" aria-hidden="true" />
}
