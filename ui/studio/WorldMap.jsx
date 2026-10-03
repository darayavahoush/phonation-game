import { useEffect, useRef, useState } from 'react'

// An illustrated storybook map of the ten realms, drawn entirely in SVG (no emoji, so it looks the same on every device).
// The Hush's fog covers realms not reached yet and clears as you travel. Motion: the traveller hops along the trail,
// fog drifts slowly; both are instant/still under reduced motion.
const blob = (p, t = 0.5) => { // closed Catmull-Rom spline
  const n = p.length; let d = `M${p[0][0]} ${p[0][1]}`
  for (let i = 0; i < n; i++) {
    const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n], e = p[(i + 2) % n], k = t / 3
    d += ` C${b[0] + (c[0] - a[0]) * k} ${b[1] + (c[1] - a[1]) * k} ${c[0] - (e[0] - b[0]) * k} ${c[1] - (e[1] - b[1]) * k} ${c[0]} ${c[1]}`
  }
  return d + 'Z'
}
const trail = (a, b, c, d) => { const t = 0.18; return `M${b[0]} ${b[1]} C${b[0] + (c[0] - a[0]) * t} ${b[1] + (c[1] - a[1]) * t} ${c[0] - (d[0] - b[0]) * t} ${c[1] - (d[1] - b[1]) * t} ${c[0]} ${c[1]}` }
const star = (cx, cy, r) => Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? r * 0.45 : r; return `${(cx + Math.cos(a) * q).toFixed(1)},${(cy + Math.sin(a) * q).toFixed(1)}` }).join(' ')
const Tree = ({ x, y, s = 1, c = '#2f8f55' }) => <g transform={`translate(${x} ${y}) scale(${s})`}><rect x="-2" y="0" width="4" height="9" fill="#6b4423" /><path d="M0 -26 L12 -6 L-12 -6Z" fill={c} /><path d="M0 -16 L15 4 L-15 4Z" fill={c} /><path d="M0 -26 L5 -14 L-5 -14Z" fill="#fff" opacity=".18" /></g>
const Shroom = ({ x, y, s = 1 }) => <g transform={`translate(${x} ${y}) scale(${s})`}><rect x="-3" y="-2" width="6" height="9" rx="2" fill="#fff3d6" /><path d="M-11 -2 Q0 -22 11 -2Z" fill="#e5484d" /><circle cx="-3" cy="-8" r="2" fill="#fff" /><circle cx="4" cy="-6" r="1.6" fill="#fff" /></g>
const Cloud = ({ x, y, s = 1, o = 1 }) => <g transform={`translate(${x} ${y}) scale(${s})`} opacity={o} fill="#fff"><circle cx="-18" cy="4" r="11" /><circle cx="-3" cy="-2" r="15" /><circle cx="15" cy="3" r="12" /><rect x="-29" y="4" width="55" height="11" rx="5.5" /></g>

// One drawn landmark per realm, centred on (0,0), about 100 px across.
const LANDMARK = [
  () => <g> {/* Dragon Mountain: volcano with lava and smoke */}
    <ellipse cx="0" cy="34" rx="58" ry="9" fill="#2a1a1f" opacity=".25" />
    <path d="M-52 34 L-15 -30 L15 -30 L52 34Z" fill="#7a5545" /><path d="M-52 34 L-15 -30 L-4 -30 L-16 34Z" fill="#9a7058" opacity=".6" /><path d="M52 34 L15 -30 L6 -30 L22 34Z" fill="#4e2f27" opacity=".55" />
    <path d="M-15 -30 L-9 -38 L9 -38 L15 -30Z" fill="#ff7a2f" /><ellipse cx="0" cy="-34" rx="10" ry="4" fill="#ffd36b" />
    <path d="M0 -32 Q-8 -8 -16 32" stroke="#ff8a3a" strokeWidth="6" fill="none" strokeLinecap="round" /><path d="M6 -30 Q14 0 22 30" stroke="#ff6a2a" strokeWidth="4" fill="none" strokeLinecap="round" />
    <circle cx="8" cy="-54" r="8" fill="#b9aebd" opacity=".75" /><circle cx="-2" cy="-68" r="11" fill="#cfc6d2" opacity=".6" /><circle cx="14" cy="-82" r="9" fill="#e0d9e3" opacity=".45" /></g>,
  () => <g> {/* Starlit Sea: island, palm, fallen star */}
    <ellipse cx="0" cy="28" rx="58" ry="20" fill="#5fc7d0" opacity=".5" /><ellipse cx="0" cy="26" rx="46" ry="15" fill="#f4dfa0" /><ellipse cx="0" cy="22" rx="36" ry="10" fill="#e7c978" />
    <path d="M14 22 Q20 -2 8 -22" stroke="#8a5a2b" strokeWidth="5" fill="none" strokeLinecap="round" />
    <path d="M8 -22 q-26 -4 -32 12 q20 -12 32 -12z" fill="#3fa65b" /><path d="M8 -22 q22 -10 34 4 q-18 -6 -34 -4z" fill="#34a05a" /><path d="M8 -22 q-6 -16 8 -22 q0 12 -8 22z" fill="#3fa65b" />
    <circle cx="-26" cy="4" r="17" fill="#ffe27a" opacity=".35" /><polygon points={star(-26, 4, 13)} fill="#ffd23f" stroke="#e0a122" strokeWidth="2" strokeLinejoin="round" />
    <path d="M-60 40 q8 -6 16 0 t16 0 t16 0 t16 0 t16 0" stroke="#fff" strokeWidth="3" fill="none" opacity=".6" strokeLinecap="round" /></g>,
  () => <g> {/* Cloud Kingdom: castle on a cloud with a rainbow */}
    {['#e5484d', '#f5a524', '#3fa65b', '#4a8cff'].map((c, i) => <path key={c} d={`M${-50 + i * 4} 20 A${50 - i * 4} ${50 - i * 4} 0 0 1 ${50 - i * 4} 20`} stroke={c} strokeWidth="4" fill="none" opacity=".85" />)}
    <rect x="-24" y="-12" width="48" height="36" fill="#f8cbe0" /><rect x="-34" y="-28" width="17" height="52" fill="#f2a9cc" /><rect x="17" y="-28" width="17" height="52" fill="#f2a9cc" /><rect x="-8" y="-42" width="16" height="66" fill="#fbd7e8" />
    <path d="M-37 -28 L-25 -46 L-14 -28Z" fill="#7c5cd6" /><path d="M14 -28 L25 -46 L37 -28Z" fill="#7c5cd6" /><path d="M-11 -42 L0 -64 L11 -42Z" fill="#7c5cd6" /><rect x="-0.8" y="-76" width="1.8" height="14" fill="#6b3f17" /><path d="M1 -76 l10 4 l-10 4z" fill="#f5a524" />
    <path d="M-6 24 V6 a6 6 0 0 1 12 0 V24Z" fill="#7c5cd6" /><circle cx="-25" cy="-12" r="3" fill="#ffe27a" /><circle cx="25" cy="-12" r="3" fill="#ffe27a" />
    <Cloud x={-24} y={26} s={1.3} /><Cloud x={30} y={28} s={1.1} /></g>,
  () => <g> {/* Whisper Woods: pines and mushrooms */}
    <ellipse cx="0" cy="30" rx="56" ry="10" fill="#14412f" opacity=".35" />
    <Tree x={-34} y={16} s={1.1} c="#287a4b" /><Tree x={34} y={14} s={1.2} c="#2f8f55" /><Tree x={0} y={10} s={1.6} c="#2f9d5d" /><Tree x={-16} y={26} s={.9} c="#36a863" /><Tree x={20} y={28} s={.9} c="#287a4b" />
    <Shroom x={-48} y={30} s={1.1} /><Shroom x={44} y={32} /><circle cx="-6" cy="-30" r="2.5" fill="#ffe27a" /><circle cx="14" cy="-18" r="2" fill="#ffe27a" /></g>,
  () => <g> {/* Crystal Cave: rock with glowing crystals */}
    <ellipse cx="0" cy="34" rx="58" ry="9" fill="#101a2e" opacity=".3" />
    <path d="M-56 34 Q-48 -24 0 -34 Q48 -24 56 34Z" fill="#6c7a9c" /><path d="M-56 34 Q-48 -24 0 -34 Q-24 -10 -22 34Z" fill="#8d9bbd" opacity=".55" /><path d="M56 34 Q48 -24 0 -34 Q22 -6 26 34Z" fill="#3e4a6b" opacity=".5" />
    <path d="M-17 34 Q-17 4 0 4 Q17 4 17 34Z" fill="#171330" /><circle cx="0" cy="26" r="9" fill="#7ae6ff" opacity=".35" />
    <polygon points="-40,34 -34,6 -28,34" fill="#7ae6ff" /><polygon points="-30,34 -24,14 -19,34" fill="#bff3ff" /><polygon points="26,34 32,0 38,34" fill="#c58cff" /><polygon points="36,34 41,16 46,34" fill="#e3c4ff" /><polygon points="-6,-24 0,-40 6,-24 0,-18" fill="#9dedff" /></g>,
  () => <g> {/* Honey Woods: trees and a beehive */}
    <ellipse cx="0" cy="30" rx="56" ry="10" fill="#14412f" opacity=".3" />
    <Tree x={-38} y={16} s={1.2} c="#3a9a52" /><Tree x={40} y={16} s={1.2} c="#2f8f55" />
    <g transform="translate(0 -2)"><ellipse cx="0" cy="22" rx="24" ry="9" fill="#e9a52f" /><ellipse cx="0" cy="10" rx="21" ry="9" fill="#f5b83a" /><ellipse cx="0" cy="-2" rx="17" ry="8" fill="#f9c74f" /><ellipse cx="0" cy="-12" rx="11" ry="6" fill="#fcd56a" /><ellipse cx="0" cy="12" rx="5" ry="6" fill="#4b2a0d" />
      <path d="M-22 16 H22 M-18 4 H18 M-14 -7 H14" stroke="#c98a1c" strokeWidth="1.5" /></g>
    <circle cx="-22" cy="-20" r="4" fill="#ffd23f" /><path d="M-24 -20 h4" stroke="#4b2a0d" strokeWidth="1.5" /><circle cx="26" cy="-10" r="4" fill="#ffd23f" /><path d="M24 -10 h4" stroke="#4b2a0d" strokeWidth="1.5" /></g>,
  () => <g> {/* Clockwork Castle: floating island with tower and gear */}
    <ellipse cx="0" cy="84" rx="40" ry="8" fill="#0a2a3a" opacity=".22" />
    <path d="M-48 14 Q-32 54 0 64 Q32 54 48 14Z" fill="#7b6a58" /><path d="M-48 14 Q-32 54 0 64 Q-14 34 -12 14Z" fill="#9a8570" opacity=".6" />
    <ellipse cx="0" cy="14" rx="48" ry="11" fill="#58b368" /><ellipse cx="0" cy="11" rx="44" ry="8" fill="#6cc87b" />
    <rect x="-16" y="-34" width="32" height="46" fill="#c9b79a" /><path d="M-22 -34 L0 -62 L22 -34Z" fill="#b5503a" /><circle cx="0" cy="-16" r="11" fill="#fff6e0" stroke="#6b3f17" strokeWidth="2.5" /><path d="M0 -16 V-23 M0 -16 L6 -13" stroke="#6b3f17" strokeWidth="2.5" strokeLinecap="round" />
    <circle cx="30" cy="0" r="13" fill="none" stroke="#d9a441" strokeWidth="7" strokeDasharray="5 4" /><circle cx="30" cy="0" r="9" fill="#f3d27a" /><circle cx="30" cy="0" r="3" fill="#8a5a2b" />
    <circle cx="-30" cy="-6" r="8" fill="none" stroke="#c0873a" strokeWidth="5" strokeDasharray="3.5 3" /></g>,
  () => <g> {/* Sunken Library: half-drowned tower */}
    <ellipse cx="0" cy="30" rx="58" ry="20" fill="#5fc7d0" opacity=".45" />
    <ellipse cx="0" cy="28" rx="44" ry="13" fill="#4a6a9a" opacity=".6" />
    <rect x="-18" y="-30" width="36" height="56" fill="#8878c8" /><rect x="-18" y="-30" width="12" height="56" fill="#a79ae0" opacity=".5" /><path d="M-24 -30 L0 -58 L24 -30Z" fill="#4b3d8f" />
    <path d="M-5 26 V8 a5 5 0 0 1 10 0 V26Z" fill="#241a4d" /><rect x="-12" y="-20" width="7" height="12" rx="3.5" fill="#ffe27a" /><rect x="5" y="-20" width="7" height="12" rx="3.5" fill="#ffe27a" />
    <rect x="30" y="-6" width="18" height="13" rx="2" fill="#e5484d" transform="rotate(-14 39 0)" /><rect x="32" y="-4" width="14" height="3" fill="#fff" opacity=".7" transform="rotate(-14 39 0)" />
    <path d="M-60 30 q8 -7 15 0 t15 0 t15 0 t15 0 t15 0 t15 0" stroke="#fff" strokeWidth="3" fill="none" opacity=".75" strokeLinecap="round" /><circle cx="-34" cy="-16" r="4" fill="#fff" opacity=".6" /><circle cx="-42" cy="-30" r="3" fill="#fff" opacity=".5" /></g>,
  () => <g> {/* Hush Fortress: dark castle in fog */}
    <ellipse cx="0" cy="32" rx="58" ry="9" fill="#1a1426" opacity=".35" />
    <rect x="-30" y="-8" width="60" height="40" fill="#3b3350" /><rect x="-42" y="-30" width="20" height="62" fill="#2e2740" /><rect x="22" y="-30" width="20" height="62" fill="#2e2740" /><rect x="-9" y="-44" width="18" height="76" fill="#463d5e" />
    <path d="M-45 -30 L-32 -58 L-19 -30Z" fill="#1b1628" /><path d="M19 -30 L32 -58 L45 -30Z" fill="#1b1628" /><path d="M-12 -44 L0 -74 L12 -44Z" fill="#1b1628" />
    <rect x="-34" y="-18" width="6" height="9" rx="3" fill="#ffb347" /><rect x="29" y="-18" width="6" height="9" rx="3" fill="#ffb347" /><rect x="-3" y="-30" width="6" height="10" rx="3" fill="#ff7a59" />
    <path d="M-8 32 V14 a8 8 0 0 1 16 0 V32Z" fill="#120d1c" />
    <circle cx="-44" cy="30" r="12" fill="#a9a5b8" opacity=".6" /><circle cx="42" cy="32" r="13" fill="#a9a5b8" opacity=".55" /><circle cx="0" cy="38" r="12" fill="#c7c3d3" opacity=".5" /></g>,
  () => <g> {/* Final Chorus: golden crown on a stage, music notes */}
    <ellipse cx="0" cy="28" rx="58" ry="20" fill="#5fc7d0" opacity=".45" /><ellipse cx="0" cy="26" rx="46" ry="14" fill="#f4dfa0" /><ellipse cx="0" cy="23" rx="36" ry="9" fill="#e7c978" />
    <path d="M-30 20 L-34 -14 L-16 0 L0 -26 L16 0 L34 -14 L30 20Z" fill="#ffc938" stroke="#c98a1c" strokeWidth="3" strokeLinejoin="round" /><rect x="-30" y="12" width="60" height="10" fill="#e8a91f" stroke="#c98a1c" strokeWidth="2" />
    <circle cx="0" cy="-26" r="4.5" fill="#e5484d" /><circle cx="-34" cy="-14" r="4" fill="#4a8cff" /><circle cx="34" cy="-14" r="4" fill="#3fa65b" /><circle cx="-14" cy="17" r="3" fill="#fff" /><circle cx="0" cy="17" r="3" fill="#e5484d" /><circle cx="14" cy="17" r="3" fill="#fff" />
    <g fill="#7c5cd6" stroke="#7c5cd6" strokeWidth="2.5"><circle cx="-52" cy="-30" r="4" stroke="none" /><path d="M-48 -30 V-52 l10 4" fill="none" strokeLinecap="round" /><circle cx="48" cy="-40" r="4" stroke="none" /><path d="M52 -40 V-60 l-9 4" fill="none" strokeLinecap="round" /></g></g>,
]


const Fog = ({ k }) => <g className="st-fog" style={{ animationDelay: `${-k * 1.3}s` }}>
  {[[-40, 8, 40], [0, -6, 50], [42, 6, 40], [-14, 30, 36], [26, 32, 34], [0, 12, 46]].map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill="url(#mp-fog)" />)}</g>

// ---- layout: a Candy-Crush-style road that winds UP the page, chapter 1 at the bottom. 10 zones x 5 chapters. ----
const N = 50, ZH = 550, H = N * 110 + 260, W = 1000
const nx = (k) => 500 + 190 * Math.sin(k * 0.8 + 0.4)
const ny = (k) => H - 150 - k * 110
const NODES = Array.from({ length: N }, (_, k) => [nx(k), ny(k)])
const ZONE = { volcano: ['#4a1f26', '#b2512c'], sea: ['#1b7595', '#0e4a78'], clouds: ['#9d8ae6', '#f3b0d0'], forest: ['#2c8650', '#74c35e'], cave: ['#222f5e', '#4c5da0'] }
const NODECOL = { volcano: '#ff7a2f', sea: '#25b5d6', clouds: '#d86bd0', forest: '#3fb05f', cave: '#8a66e8' }
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }

const Spark = ({ x, y, s = 1, c = '#fff', o = 0.8 }) => <path transform={`translate(${x} ${y}) scale(${s})`} d="M0 -9 Q1.5 -1.5 9 0 Q1.5 1.5 0 9 Q-1.5 1.5 -9 0 Q-1.5 -1.5 0 -9Z" fill={c} opacity={o} />
const Flower = ({ x, y, s = 1, c = '#ff8fb8' }) => <g transform={`translate(${x} ${y}) scale(${s})`}>{[0, 72, 144, 216, 288].map((a) => <ellipse key={a} cx="0" cy="-6" rx="4" ry="6" fill={c} transform={`rotate(${a})`} />)}<circle r="3.5" fill="#ffd23f" /></g>
const Crystal = ({ x, y, s = 1, c = '#7ae6ff' }) => <g transform={`translate(${x} ${y}) scale(${s})`}><polygon points="-8,10 -4,-18 2,10" fill={c} /><polygon points="0,10 6,-8 12,10" fill={c} opacity=".75" /><polygon points="-4,-18 -1,-6 -6,-4" fill="#fff" opacity=".5" /></g>
const Spire = ({ x, y, s = 1 }) => <g transform={`translate(${x} ${y}) scale(${s})`}><polygon points="-12,12 -2,-26 10,12" fill="#3a2024" /><polygon points="-2,-26 3,-8 -6,-4" fill="#6b3a34" opacity=".7" /></g>
const Crack = ({ x, y, s = 1 }) => <path transform={`translate(${x} ${y}) scale(${s})`} d="M-18 0 L-6 -5 L2 4 L12 -3 L20 3" stroke="#ff9a3a" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
const Shell = ({ x, y, s = 1 }) => <g transform={`translate(${x} ${y}) scale(${s})`}><path d="M-10 6 Q-12 -10 0 -12 Q12 -10 10 6Z" fill="#ffb6c8" /><path d="M0 6 V-10 M-5 6 L-6 -8 M5 6 L6 -8" stroke="#e57a98" strokeWidth="1.5" /></g>
const Bubble = ({ x, y, s = 1 }) => <circle cx={x} cy={y} r={5 * s} fill="#fff" opacity=".35" stroke="#fff" strokeOpacity=".6" />
const Wave = ({ x, y, s = 1 }) => <path transform={`translate(${x} ${y}) scale(${s})`} d="M-22 0 q8 -8 16 0 t16 0 t16 0" stroke="#fff" strokeWidth="3" fill="none" opacity=".55" strokeLinecap="round" />
const DECOR = {
  forest: [Tree, Tree, Shroom, Flower, Flower, Tree],
  volcano: [Spire, Crack, Spire, Crack, ({ x, y }) => <circle cx={x} cy={y} r="3" fill="#ffb347" opacity=".8" />],
  sea: [Wave, Wave, Shell, Bubble, Bubble, ({ x, y, s }) => <polygon points={star(x, y, 11 * s)} fill="#ff9a56" />],
  clouds: [Cloud, Cloud, Spark, Spark, ({ x, y, s }) => <path d={`M${x - 26 * s} ${y} a${26 * s} ${26 * s} 0 0 1 ${52 * s} 0`} stroke="#ffd5ea" strokeWidth="5" fill="none" opacity=".7" />],
  cave: [Crystal, Crystal, ({ x, y }) => <circle cx={x} cy={y} r="3" fill="#9dedff" opacity=".8" />, Spire, ({ x, y }) => <Spark x={x} y={y} c="#c8b8ff" />],
}
const ZONES = Array.from({ length: 10 }, (_, r) => {
  const bottom = H - 100 - r * ZH, top = bottom - ZH, midy = (top + bottom) / 2
  const mean = NODES.slice(r * 5, r * 5 + 5).reduce((a, p) => a + p[0], 0) / 5
  const lx = mean > 500 ? 150 : 850
  return { r, top: r === 9 ? 0 : top, bottom: r === 0 ? H : bottom, midy, lx }
})

export default function WorldMap({ quests, prog = 0, stars = [], openAll, avatar, reduced, onGo }) {
  const cur = Math.min(prog, N - 1)
  const [at, setAt] = useState(cur)
  const [going, setGoing] = useState(false)
  const box = useRef(null), svgRef = useRef(null)
  useEffect(() => { setAt(cur) }, [cur])
  useEffect(() => { // bring the current stop into view
    const b = box.current, sv = svgRef.current; if (!b || !sv) return
    const y = (ny(at) / H) * sv.getBoundingClientRect().height - b.clientHeight / 2
    b.scrollTo({ top: Math.max(0, y), behavior: reduced ? 'auto' : 'smooth' })
  }, [cur, reduced]) // eslint-disable-line react-hooks/exhaustive-deps
  const open = (k) => openAll || k <= prog
  const go = (k) => { if (going || !open(k)) return; setGoing(true); setAt(k); setTimeout(() => { setGoing(false); onGo(k) }, reduced ? 0 : 700) }
  const [mx, my] = NODES[at]
  const decor = ZONES.flatMap((z) => {
    const R = rng(z.r * 77 + 5), kind = quests[z.r]?.world || 'forest', Set = DECOR[kind], out = []
    for (let i = 0; i < 26 && out.length < 15; i++) {
      const x = 40 + R() * 920, y = z.top + 30 + R() * (z.bottom - z.top - 60)
      if (NODES.some(([a, b]) => Math.hypot(a - x, b - y) < 78) || Math.hypot(x - z.lx, y - z.midy) < 150) continue
      out.push({ key: `${z.r}-${i}`, C: Set[Math.floor(R() * Set.length)], x, y, s: 0.8 + R() * 0.7 })
    }
    return out
  })
  return (
    <figure className="st-map">
      <div className="st-mapscroll" ref={box}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Story map: fifty chapters winding up through ten realms">
          <defs>
            {Object.entries(ZONE).map(([k, [a, b]]) => <linearGradient key={k} id={`mz-${k}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={a} /><stop offset="1" stopColor={b} /></linearGradient>)}
            <radialGradient id="mp-fog"><stop offset="0" stopColor="#eef0f7" stopOpacity=".97" /><stop offset=".65" stopColor="#d3d7e6" stopOpacity=".85" /><stop offset="1" stopColor="#d3d7e6" stopOpacity="0" /></radialGradient>
            <pattern id="mp-waves" width="64" height="26" patternUnits="userSpaceOnUse"><path d="M0 13 q16 -11 32 0 t32 0" stroke="#fff" strokeOpacity=".1" strokeWidth="2.5" fill="none" strokeLinecap="round" /></pattern>
          </defs>
          {ZONES.map((z) => <g key={'z' + z.r}><rect x="0" y={z.top} width={W} height={z.bottom - z.top + 1} fill={`url(#mz-${quests[z.r].world})`} />{quests[z.r].world === 'sea' && <rect x="0" y={z.top} width={W} height={z.bottom - z.top} fill="url(#mp-waves)" />}</g>)}
          {ZONES.slice(1).map((z) => { const a = quests[z.r - 1].world, b = quests[z.r].world, y = z.bottom; return <g key={'b' + z.r}><linearGradient id={`bl-${z.r}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={ZONE[b][1]} /><stop offset="1" stopColor={ZONE[a][0]} /></linearGradient><rect x="0" y={y - 50} width={W} height="100" fill={`url(#bl-${z.r})`} /></g> })}
          {decor.map(({ key, C, x, y, s }) => <C key={key} x={x} y={y} s={s} />)}

          {/* realm landmarks, big, on the side the road is not */}
          {ZONES.map((z) => { const q = quests[z.r], seen = openAll || z.r * 5 <= prog, name = q.title.replace(/^\d+\.\s*/, ''), w = name.length * 10.5 + 34
            return <g key={'l' + z.r} transform={`translate(${z.lx} ${z.midy})`}>
              <g transform="scale(1.7)" opacity={seen ? 1 : 0.55}>{LANDMARK[z.r]()}</g>
              {!seen && <g transform="scale(1.7)"><Fog k={z.r} /></g>}
              <g transform="translate(0 122)"><rect x={-w / 2} y="-17" width={w} height="34" rx="17" fill={seen ? '#fbf0cf' : '#dfe2ee'} stroke="#6b3f17" strokeWidth="3.5" /><text y="7" textAnchor="middle" fontSize="19" fontWeight="800" fill="#3b2410" style={{ fontFamily: 'var(--display)' }}>{name}</text></g>
              <g transform="translate(-70 -112)"><circle r="19" fill={seen ? '#ffd23f' : '#aab0c6'} stroke="#6b3f17" strokeWidth="3.5" /><text y="7" textAnchor="middle" fontSize="19" fontWeight="800" fill="#3b2410">{z.r + 1}</text></g>
            </g> })}

          {/* the road: dark edge, cream surface, gold where you have been */}
          {NODES.slice(0, -1).map((p, i) => <path key={'e' + i} d={trail(NODES[Math.max(0, i - 1)], p, NODES[i + 1], NODES[Math.min(N - 1, i + 2)])} fill="none" stroke="#5a3513" strokeWidth="36" strokeLinecap="round" opacity=".55" />)}
          {NODES.slice(0, -1).map((p, i) => { const d = trail(NODES[Math.max(0, i - 1)], p, NODES[i + 1], NODES[Math.min(N - 1, i + 2)]), on = i < prog || openAll
            return <g key={'r' + i}><path d={d} fill="none" stroke={on ? '#ffd23f' : '#f3e2b3'} strokeWidth="26" strokeLinecap="round" /><path d={d} fill="none" stroke={on ? '#e0a122' : '#caa86a'} strokeWidth="3" strokeDasharray="2 12" strokeLinecap="round" /></g> })}

          {/* start sign and finish flag */}
          <g transform={`translate(${NODES[0][0] - 130} ${NODES[0][1] + 20})`}><rect x="-4" y="0" width="8" height="46" fill="#6b3f17" /><path d="M-48 -26 H48 L58 -12 L48 2 H-48Z" fill="#fbf0cf" stroke="#6b3f17" strokeWidth="4" strokeLinejoin="round" /><text y="-6" textAnchor="middle" fontSize="20" fontWeight="800" fill="#3b2410" style={{ fontFamily: 'var(--display)' }}>START</text></g>
          <g transform="translate(500 56)"><path d="M-235 -28 H235 L215 0 L235 28 H-235 L-215 0Z" fill="#fbf0cf" stroke="#8a5a2b" strokeWidth="4" strokeLinejoin="round" /><text y="10" textAnchor="middle" fontSize="30" fontWeight="800" fill="#6b3f17" style={{ fontFamily: 'var(--display)' }}>The Kingdom of Echoes</text></g>

          {/* chapter stops */}
          {NODES.map(([x, y], k) => {
            const z = Math.floor(k / 5), q = quests[z], ch = q.chapters[k % 5], ok = open(k), done = k < prog, boss = k % 5 === 4, R = boss ? 44 : 34, col = NODECOL[q.world], now = k === prog && !openAll, st = stars[k] || 0
            return (
              <g key={k} className={`st-node ${ok ? 'open' : 'locked'}`} transform={`translate(${x} ${y})`} role="button" tabIndex={ok ? 0 : -1} aria-disabled={!ok}
                aria-label={`Chapter ${k + 1}, ${q.title.replace(/^\d+\.\s*/, '')}${done ? `, done, ${st} stars` : ok ? '' : ', locked'}`}
                onClick={() => go(k)} onKeyDown={(e) => { if (ok && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go(k) } }}>
                <circle r={R + 20} fill="transparent" />
                {now && <circle r={R + 8} className="st-pulse" fill="none" stroke="#fff" strokeWidth="6" />}
                <circle cy="6" r={R + 3} fill="#000" opacity=".28" />
                <circle r={R + 3} fill={done ? '#ffd23f' : '#fff'} /><circle r={R - 2} fill={ok ? col : '#9aa0b8'} />
                <ellipse cx={-R * 0.28} cy={-R * 0.45} rx={R * 0.5} ry={R * 0.26} fill="#fff" opacity=".4" />
                <text y={boss ? 10 : 8} textAnchor="middle" fontSize={boss ? 30 : 26} fontWeight="800" fill="#fff" stroke="rgba(0,0,0,.35)" strokeWidth="4" paintOrder="stroke" style={{ fontFamily: 'var(--display)' }}>{k + 1}</text>
                {boss && <g transform={`translate(0 ${-R - 6})`}><rect x="-1.5" y="-22" width="3" height="24" fill="#6b3f17" /><path d="M1 -22 l20 7 l-20 7z" fill={ok ? '#ffd23f' : '#aab0c6'} stroke="#6b3f17" strokeWidth="2" strokeLinejoin="round" /></g>}
                {ch.twist && <g transform={`translate(${R * 0.78} ${-R * 0.78})`}><circle r="12" fill="#7c3aed" stroke="#fff" strokeWidth="3" /><text y="5" textAnchor="middle" fontSize="15" fontWeight="800" fill="#fff">?</text></g>}
                {!ok && <g transform={`translate(${-R * 0.78} ${-R * 0.78})`}><circle r="12" fill="#6b6f87" stroke="#fff" strokeWidth="3" /><rect x="-5" y="-1" width="10" height="8" rx="2" fill="#fff" /><path d="M-3.5 -1 v-3 a3.5 3.5 0 0 1 7 0 v3" stroke="#fff" strokeWidth="2.2" fill="none" /></g>}
                {done && <g transform={`translate(0 ${R + 15})`}>{[0, 1, 2].map((i) => <polygon key={i} transform={`translate(${(i - 1) * 20} ${i === 1 ? -3 : 0})`} points={star(0, 0, 9.5)} fill={i < st ? '#ffc938' : '#7a6a90'} stroke={i < st ? '#c98a1c' : '#4b3d63'} strokeWidth="2" strokeLinejoin="round" />)}</g>}
              </g>
            )
          })}

          <g style={{ transform: `translate(${mx}px, ${my - 82}px)`, transition: reduced ? 'none' : 'transform .7s cubic-bezier(.5,0,.3,1)', pointerEvents: 'none' }}>
            <g className="st-hop"><circle r="30" fill="#fff" stroke="#6b3f17" strokeWidth="4" /><text y="15" fontSize="40" textAnchor="middle">{avatar.badge}</text><path d="M-9 27 L0 40 L9 27Z" fill="#fff" stroke="#6b3f17" strokeWidth="3" strokeLinejoin="round" /></g>
          </g>
        </svg>
      </div>
      <figcaption>Scroll up the road! Tap any stop you’ve unlocked. Purple <b>?</b> stops hide a plot twist.</figcaption>
    </figure>
  )
}
