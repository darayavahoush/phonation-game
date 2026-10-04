import { useEffect, useRef } from 'react'
import { createCounter } from './syllableCounter.js'

// One calm moving element: a lantern that swells and warms while the voice is on.
// Everything is drawn from requestAnimationFrame reading a ref; React never re-renders per frame.
// No flashing: nothing changes brightness faster than ~4 Hz, and ripples are slow and soft.
const PAL = { glass: [143, 224, 212], lamp: [255, 155, 84] } // mint-light -> ember (tailwind.config.js)
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t))
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`

export default function VoiceStage({ read, active, goalMs, glide, gain = 1, reduced, onOnset, avatar, world, outfit }) {
  const ref = useRef(null)
  const cfg = useRef({})
  cfg.current = { read, active, goalMs, glide, gain, reduced, onOnset, avatar, world, outfit }

  useEffect(() => {
    const cv = ref.current
    const ctx = cv.getContext('2d')
    let raf, last = performance.now(), W = 0, H = 0
    const S = { hist: new Array(90).fill(0), hacc: 0, count: createCounter(), t: 0, r: 0, warm: 0, run: 0, was: false, trail: [], ripples: [], acc: 0, lv: 0, ph: 0, amp: 0, cyc: 3, sparks: [], sec: 0 }
    const fit = () => {
      const d = Math.min(2, window.devicePixelRatio || 1), b = cv.getBoundingClientRect()
      W = b.width; H = b.height; cv.width = W * d; cv.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0)
    }
    fit(); const ro = new ResizeObserver(fit); ro.observe(cv)

    const frame = (now) => {
      const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); last = now
      if (W < 2 || H < 2) { raf = requestAnimationFrame(frame); return } // canvas not laid out yet
      const { read, active, goalMs, glide, gain, reduced, onOnset, avatar, world, outfit } = cfg.current
      const v = active ? read() : { voiced: false, level: 0, pitch: null }
      const k = reduced ? 1 : 1 - Math.exp(-dt / 0.09) // ~90 ms response: feels instant, not jittery
      const base = Math.min(W, H) * 0.2
      const target = base * (1 + (v.voiced ? 0.2 + v.level * 0.55 * gain : 0))
      S.r += (target - S.r) * k
      S.warm += ((v.voiced ? 1 : 0) - S.warm) * (reduced ? 1 : 1 - Math.exp(-dt / 0.25))
      if (v.voiced) S.run += dt * 1000; else S.run = 0
      if (S.count(v.voiced, v.level, dt * 1000)) { onOnset?.(); if (!reduced && S.ripples.length < 5) S.ripples.push({ age: 0 }) } // one dot per spoken syllable

      S.lv += ((v.voiced ? v.level : 0) - S.lv) * 0.3 // smoothed so the trail tapers instead of ending in a cliff
      S.acc += dt
      while (S.acc > 1 / 30) { S.acc -= 1 / 30; S.trail.push({ p: v.voiced ? v.pitch : null, l: S.lv }); if (S.trail.length > 240) S.trail.shift() }

      ctx.clearRect(0, 0, W, H)
      const cx = W * 0.62, cy = H * 0.5, AV = avatar || { body: PAL.lamp, glow: PAL.lamp }, WD = world || { wave: PAL.glass, spark: [255, 226, 150] }, col = mix(WD.wave, AV.body, S.warm)

      // trail: pitch ribbon for glide levels, soft loudness swell for everything else
      if (glide && S.trail.length > 2) {
        const span = cx - W * 0.06, step = span / 240, off = 240 - S.trail.length
        ctx.lineCap = 'round'; ctx.lineJoin = 'round'
        if (glide) {
          const lo = Math.log2(80), hi = Math.log2(500), y = (p) => H * 0.82 - ((Math.log2(p) - lo) / (hi - lo)) * H * 0.64
          ctx.lineWidth = 6; ctx.strokeStyle = rgba(col, 0.75); ctx.beginPath(); let pen = false
          S.trail.forEach((s, i) => { if (s.p) { const X = cx - span + (off + i) * step; pen ? ctx.lineTo(X, y(s.p)) : ctx.moveTo(X, y(s.p)); pen = true } else pen = false })
          ctx.stroke()
        }
      }

      // sound wave: the height at each point is how loud you were at that moment (newest on the right, scrolling left),
      // so it rises and falls with your voice. Tighter humps = higher pitch. Drawn from level + pitch, not raw samples.
      if (!glide) {
        S.ph += reduced ? 0 : dt * (v.voiced ? 9 : 2.2)
        S.hacc += dt; while (S.hacc > 1 / 60) { S.hacc -= 1 / 60; S.hist.push(v.voiced ? Math.min(1, v.level * gain) : 0); S.hist.shift() }
        const pn = v.voiced && v.pitch ? Math.max(0, Math.min(1, (Math.log2(v.pitch) - Math.log2(100)) / (Math.log2(500) - Math.log2(100)))) : null
        S.cyc += ((pn == null ? S.cyc : 2 + pn * 4) - S.cyc) * 0.06
        const N = S.hist.length
        for (let L = 0; L < 3; L++) {
          ctx.beginPath(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'
          for (let x = 0; x <= W; x += 4) {
            const t = x / W, h = S.hist[Math.min(N - 1, Math.floor(t * N))], env = Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.5 + 0.5)), 0.5)
            const y = H * 0.5 + Math.sin(t * S.cyc * 6.283 * (1 + L * 0.3) - S.ph * (1 + L * 0.35) + L * 1.3) * (0.035 + h * 0.9) * env * H * 0.44 * (1 - L * 0.27)
            x ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
          }
          ctx.lineWidth = 8 - L * 2; ctx.strokeStyle = rgba(col, [0.9, 0.5, 0.3][L]); ctx.stroke()
        }
        // live level meter: little bars that jump up and down with the voice
        const bars = 14, bw = Math.min(14, W / 60), bx = W * 0.04
        for (let b = 0; b < bars; b++) {
          const hh = 6 + (S.hist[N - 1 - b * 4] || 0) * H * 0.3
          ctx.fillStyle = rgba(col, 0.55 - b * 0.03); ctx.beginPath(); ctx.roundRect?.(bx + b * bw * 1.6, H * 0.96 - hh, bw, hh, 5); ctx.roundRect ? ctx.fill() : ctx.fillRect(bx + b * bw * 1.6, H * 0.96 - hh, bw, hh)
        }
      }

      // ripples on each new voice onset
      S.ripples = S.ripples.filter((r) => (r.age += dt) < 1.6)
      S.ripples.forEach((r) => { const t = r.age / 1.6; ctx.strokeStyle = rgba(col, 0.35 * (1 - t)); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, S.r + t * base * 2.6, 0, 7); ctx.stroke() })

      // Lumi bounces to the beat of the voice
      const by = cy - (v.voiced && !reduced ? Math.abs(Math.sin(S.t * 8)) * S.r * 0.14 * (0.4 + Math.min(1, v.level)) : 0)
      // glow + lantern body
      const gr = Math.max(2, Math.min(S.r * 2.4, H / 2 - 1, W - cx - 1)) // keep the glow inside the canvas so it never shows an edge
      const glow = ctx.createRadialGradient(cx, by, Math.min(S.r * 0.2, gr * 0.5), cx, by, gr)
      glow.addColorStop(0, rgba(col, 0.38 + 0.2 * S.warm)); glow.addColorStop(1, rgba(col, 0))
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, by, gr, 0, 7); ctx.fill()
      const body = ctx.createRadialGradient(cx - S.r * 0.3, by - S.r * 0.35, S.r * 0.1, cx, by, S.r)
      body.addColorStop(0, rgba(mix(col, AV.glow, 0.55), 1)); body.addColorStop(1, rgba(col, 0.92))
      ctx.fillStyle = body; ctx.beginPath(); ctx.arc(cx, by, S.r, 0, 7); ctx.fill()
      // avatar accessories (drawn behind the face): each friend looks different
      const R = S.r, st = Math.sin(S.t * 6) * (v.voiced ? 1 : 0.3)
      ctx.fillStyle = rgba(mix(AV.body, [255, 255, 255], 0.25), 1); ctx.strokeStyle = rgba(mix(AV.body, [0, 0, 0], 0.3), 0.6); ctx.lineWidth = 2
      const tri = (x1, y1, x2, y2, x3, y3, f) => { ctx.fillStyle = f; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath(); ctx.fill() }
      if (AV.id === 'ember') { [-1, 1].forEach((sd) => { tri(cx + sd * R * 0.45, by - R * 0.85, cx + sd * R * 0.3, by - R * 1.3, cx + sd * R * 0.7, by - R * 0.9, '#ffe9a8'); tri(cx + sd * R * 0.95, by + R * 0.1, cx + sd * R * (1.5 + 0.1 * st), by - R * 0.35, cx + sd * R * 1.0, by + R * 0.5, rgba(AV.body, 0.9)) }) }
      if (AV.id === 'stardust') { tri(cx - R * 0.1, by - R * 0.9, cx, by - R * (1.55 + 0.1 * S.lv), cx + R * 0.1, by - R * 0.9, '#fff3b0'); [-1, 1].forEach((sd) => tri(cx + sd * R * 0.5, by - R * 0.8, cx + sd * R * 0.55, by - R * 1.15, cx + sd * R * 0.78, by - R * 0.7, rgba(AV.body, 1))) }
      if (AV.id === 'merlo') { tri(cx - R * 0.8, by - R * 0.55, cx + R * 0.1 + st * 4, by - R * 1.75, cx + R * 0.8, by - R * 0.55, '#4a3aa8'); ctx.fillStyle = '#ffd86b'; ctx.beginPath(); ctx.ellipse(cx, by - R * 0.58, R * 0.95, R * 0.12, 0, 0, 7); ctx.fill() }
      if (AV.id === 'fizz') { [-1, 1].forEach((sd) => { ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.ellipse(cx + sd * R * 1.15, by - R * 0.15 + st * 3, R * 0.5, R * (0.8 + 0.1 * st), sd * 0.5, 0, 7); ctx.fill() }) }
      if (outfit) { ctx.font = `${Math.round(R * 0.7)}px serif`; ctx.textAlign = 'center'; ctx.fillText(outfit, cx + (AV.id === 'lumi' ? R * 0.6 : 0), by - R * (AV.id === 'merlo' ? 1.5 : 1.05)) }
      // face: blinks every ~4 s, mouth opens with the voice
      S.t += dt
      const er = S.r * 0.085, ex = S.r * 0.3, ey = by - S.r * 0.1, blink = !reduced && S.t % 4 < 0.12 ? 0.15 : 1
      ctx.fillStyle = 'rgba(255,107,74,.38)'; [-1, 1].forEach((s) => { ctx.beginPath(); ctx.arc(cx + s * S.r * 0.52, by + S.r * 0.18, S.r * 0.12, 0, 7); ctx.fill() })
      if (v.voiced && S.run > 350) { ctx.strokeStyle = '#2b1b3d'; ctx.lineWidth = Math.max(2, S.r * 0.06); ctx.lineCap = 'round'; [-1, 1].forEach((s) => { ctx.beginPath(); ctx.arc(cx + s * ex, ey + er * 0.7, er * 1.4, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke() }) }
      else { ctx.fillStyle = '#2b1b3d'; [-1, 1].forEach((s) => { ctx.beginPath(); ctx.ellipse(cx + s * ex, ey, er, er * 1.35 * blink, 0, 0, 7); ctx.fill() }) }
      if (v.voiced) { const o = 0.4 + v.level * 0.6; ctx.beginPath(); ctx.ellipse(cx, by + S.r * 0.3, S.r * 0.15, S.r * (0.05 + 0.17 * o), 0, 0, 7); ctx.fill() }
      else { ctx.strokeStyle = '#2b1b3d'; ctx.lineWidth = Math.max(2, S.r * 0.05); ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(cx, by + S.r * 0.12, S.r * 0.22, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke() }

      // sparkles float up while voicing; a bigger burst for every full second kept going
      if (!reduced) {
        if (v.voiced && S.sparks.length < 40 && Math.random() < dt * (6 + v.level * 22)) S.sparks.push({ x: cx + (Math.random() - 0.5) * S.r * 1.5, y: by - S.r * 1.0, vx: (Math.random() - 0.5) * 30, vy: -(35 + Math.random() * 55), a: 0, size: 3 + Math.random() * 5 })
        const sec = Math.floor(S.run / 1000)
        if (v.voiced && sec > S.sec) for (let i = 0; i < 12; i++) S.sparks.push({ x: cx, y: by, vx: Math.cos(i * 0.52) * 110, vy: Math.sin(i * 0.52) * 110, a: 0, size: 5 + Math.random() * 4 })
        S.sec = v.voiced ? sec : 0
        S.sparks = S.sparks.filter((p) => (p.a += dt) < 1.4)
        S.sparks.forEach((p) => {
          p.x += p.vx * dt; p.y += p.vy * dt
          const al = 1 - p.a / 1.4, z = p.size * (0.6 + 0.4 * al)
          ctx.fillStyle = rgba(WD.spark, 0.9 * al); ctx.beginPath()
          ctx.moveTo(p.x, p.y - z); ctx.lineTo(p.x + z * 0.3, p.y - z * 0.3); ctx.lineTo(p.x + z, p.y); ctx.lineTo(p.x + z * 0.3, p.y + z * 0.3)
          ctx.lineTo(p.x, p.y + z); ctx.lineTo(p.x - z * 0.3, p.y + z * 0.3); ctx.lineTo(p.x - z, p.y); ctx.lineTo(p.x - z * 0.3, p.y - z * 0.3); ctx.closePath(); ctx.fill()
        })
      }
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
