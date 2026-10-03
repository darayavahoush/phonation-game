import { useEffect, useState } from 'react'

// An illustrated storybook map of the ten realms, drawn entirely in SVG (no emoji, so it looks the same on every device).
// The Hush's fog covers realms not reached yet and clears as you travel. Motion: the traveller hops along the trail,
// fog drifts slowly; both are instant/still under reduced motion.
const PTS = [[130, 440], [300, 546], [335, 335], [165, 230], [420, 150], [610, 255], [785, 105], [875, 335], [700, 460], [885, 540]]
const COAST = [[70, 250], [100, 150], [200, 110], [330, 95], [470, 100], [570, 120], [660, 160], [745, 215], [775, 300], [770, 385], [790, 455], [750, 520], [670, 545], [590, 510], [500, 535], [410, 500], [310, 480], [210, 520], [110, 520], [62, 430], [55, 340]]
const isl = (cx, cy, rx, ry) => [[cx - rx, cy], [cx - rx * 0.6, cy - ry * 0.9], [cx + rx * 0.2, cy - ry], [cx + rx, cy - ry * 0.2], [cx + rx * 0.7, cy + ry * 0.8], [cx - rx * 0.1, cy + ry], [cx - rx * 0.8, cy + ry * 0.7]]
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

export default function WorldMap({ quests, arc, openAll, avatar, reduced, onGo }) {
  const here = Math.min(arc, quests.length - 1)
  const [at, setAt] = useState(here)
  const [going, setGoing] = useState(false)
  useEffect(() => { setAt(here) }, [here])
  const go = (i) => { if (going) return; setGoing(true); setAt(i); setTimeout(() => { setGoing(false); onGo(i) }, reduced ? 0 : 950) }
  const open = (i) => openAll || i <= arc
  const [mx, my] = PTS[at]
  const land = blob(COAST, 0.9)
  return (
    <figure className="st-map">
      <svg viewBox="0 0 1000 640" role="group" aria-label="Map of the ten realms">
        <defs>
          <linearGradient id="mp-sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1f7d99" /><stop offset="1" stopColor="#0f4b78" /></linearGradient>
          <linearGradient id="mp-land" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8fd16a" /><stop offset=".55" stopColor="#6fbf5c" /><stop offset="1" stopColor="#53a559" /></linearGradient>
          <radialGradient id="mp-fog"><stop offset="0" stopColor="#eef0f7" stopOpacity=".97" /><stop offset=".65" stopColor="#d3d7e6" stopOpacity=".85" /><stop offset="1" stopColor="#d3d7e6" stopOpacity="0" /></radialGradient>
          <radialGradient id="mp-ash"><stop offset="0" stopColor="#9a5a3a" stopOpacity=".6" /><stop offset="1" stopColor="#9a5a3a" stopOpacity="0" /></radialGradient>
          <radialGradient id="mp-wood"><stop offset="0" stopColor="#1f7a4a" stopOpacity=".6" /><stop offset="1" stopColor="#1f7a4a" stopOpacity="0" /></radialGradient>
          <radialGradient id="mp-rock"><stop offset="0" stopColor="#7d86a8" stopOpacity=".55" /><stop offset="1" stopColor="#7d86a8" stopOpacity="0" /></radialGradient>
          <pattern id="mp-waves" width="64" height="26" patternUnits="userSpaceOnUse"><path d="M0 13 q16 -11 32 0 t32 0" stroke="#fff" strokeOpacity=".14" strokeWidth="2.5" fill="none" strokeLinecap="round" /></pattern>
          <clipPath id="mp-clip"><path d={land} /></clipPath>
        </defs>
        <rect width="1000" height="640" rx="28" fill="url(#mp-sea)" /><rect width="1000" height="640" rx="28" fill="url(#mp-waves)" />
        {/* islands: realms 2, 8, 10 */}
        {[[PTS[1], 66, 36], [PTS[7], 62, 52], [PTS[9], 64, 40]].map(([p, rx, ry], i) => <g key={'i' + i}><path d={blob(isl(p[0], p[1] + 8, rx + 18, ry + 14), 0.9)} fill="#7fdbe0" opacity=".45" /><path d={blob(isl(p[0], p[1] + 8, rx, ry), 0.9)} fill="#f1dca0" /><path d={blob(isl(p[0], p[1] + 5, rx - 10, ry - 8), 0.9)} fill="url(#mp-land)" /></g>)}
        {/* mainland: shallows, sand, grass, biomes */}
        <path d={land} fill="none" stroke="#7fdbe0" strokeOpacity=".4" strokeWidth="34" strokeLinejoin="round" /><path d={land} fill="none" stroke="#a6ecef" strokeOpacity=".35" strokeWidth="20" strokeLinejoin="round" />
        <path d={land} fill="#f1dca0" stroke="#f1dca0" strokeWidth="12" strokeLinejoin="round" /><path d={land} fill="url(#mp-land)" />
        <g clipPath="url(#mp-clip)">
          {[0, 8].map((i) => <circle key={i} cx={PTS[i][0]} cy={PTS[i][1]} r="150" fill="url(#mp-ash)" />)}
          {[3, 5].map((i) => <circle key={i} cx={PTS[i][0]} cy={PTS[i][1]} r="150" fill="url(#mp-wood)" />)}
          <circle cx={PTS[4][0]} cy={PTS[4][1]} r="150" fill="url(#mp-rock)" />
          {[[240, 330], [470, 300], [520, 410], [250, 150], [560, 190], [640, 360], [90, 330], [400, 420], [700, 250], [190, 400]].map(([x, y], i) => <Tree key={i} x={x} y={y} s={0.7 + (i % 3) * 0.12} c={i % 2 ? '#3a9a52' : '#2f8f55'} />)}
          {[[330, 160], [370, 135], [470, 175], [510, 130], [210, 180]].map(([x, y], i) => <path key={i} d={`M${x - 24} ${y + 14} L${x} ${y - 24} L${x + 24} ${y + 14}Z`} fill="#8b95b3" />)}
          {[[330, 160], [370, 135], [470, 175], [510, 130], [210, 180]].map(([x, y], i) => <path key={'s' + i} d={`M${x - 8} ${y - 8} L${x} ${y - 24} L${x + 8} ${y - 8}Z`} fill="#fff" />)}
        </g>
        {/* roads */}
        {PTS.slice(0, -1).map((p, i) => { const d = trail(PTS[Math.max(0, i - 1)], p, PTS[i + 1], PTS[Math.min(PTS.length - 1, i + 2)]); const on = i < arc || openAll
          return <g key={'t' + i}><path d={d} fill="none" stroke="#7a4a1c" strokeOpacity=".55" strokeWidth="7" strokeLinecap="round" strokeDasharray="1 13" />{on && <path d={d} fill="none" stroke="#ffd23f" strokeWidth="7" strokeLinecap="round" strokeDasharray="1 11" />}</g> })}
        {/* decor: ship, compass, title */}
        <g transform="translate(150 585)"><path d="M-24 0 H24 L16 12 H-16Z" fill="#8a5a2b" /><rect x="-1.5" y="-30" width="3" height="30" fill="#4b2a0d" /><path d="M2 -28 L22 -6 H2Z" fill="#fff" /><path d="M-2 -24 L-16 -6 H-2Z" fill="#f5e6c0" /><path d="M-30 16 q6 -5 12 0 t12 0 t12 0 t12 0 t12 0" stroke="#fff" strokeWidth="2.5" fill="none" opacity=".7" /></g>
        <g transform="translate(925 90)"><circle r="34" fill="#fbf0cf" stroke="#8a5a2b" strokeWidth="3" opacity=".95" /><polygon points="0,-30 6,0 0,30 -6,0" fill="#e5484d" /><polygon points="-30,0 0,-6 30,0 0,6" fill="#6b3f17" /><circle r="4" fill="#fbf0cf" /><text y="-38" fontSize="14" fontWeight="800" textAnchor="middle" fill="#fff">N</text></g>
        <g transform="translate(500 40)"><path d="M-170 -22 H170 L154 0 L170 22 H-170 L-154 0Z" fill="#fbf0cf" stroke="#8a5a2b" strokeWidth="4" strokeLinejoin="round" /><text y="9" textAnchor="middle" fontSize="27" fontWeight="800" fill="#6b3f17" style={{ fontFamily: 'var(--display)' }}>The Kingdom of Echoes</text></g>
        {/* realms */}
        {quests.map((q, i) => {
          const [x, y] = PTS[i], ok = open(i), done = i < arc, name = q.title.replace(/^\d+\.\s*/, ''), w = name.length * 9.6 + 30, L = LANDMARK[i]
          return (
            <g key={q.id} className={`st-node ${ok ? 'open' : 'locked'} ${i === arc ? 'now' : ''}`} transform={`translate(${x} ${y})`} role="button" tabIndex={ok ? 0 : -1} aria-disabled={!ok} aria-label={`${q.title}${done ? ', finished' : ok ? '' : ', hidden in fog'}`}
              onClick={() => ok && go(i)} onKeyDown={(e) => { if (ok && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go(i) } }}>
              <circle r="74" fill="transparent" />
              {i === arc && !openAll && <ellipse cy="26" rx="70" ry="30" className="st-pulse" fill="none" stroke="#ffd23f" strokeWidth="5" />}
              <g className="st-lm" opacity={ok ? 1 : 0.55}>{L()}</g>
              {!ok && <Fog k={i} />}
              <g transform="translate(0 66)"><rect x={-w / 2} y="-15" width={w} height="30" rx="15" fill={ok ? '#fbf0cf' : '#dfe2ee'} stroke={done ? '#e0a122' : '#6b3f17'} strokeWidth="3" /><text y="6" textAnchor="middle" fontSize="17" fontWeight="800" fill="#3b2410" style={{ fontFamily: 'var(--display)' }}>{name}</text></g>
              <g transform="translate(-46 -46)"><circle r="15" fill={ok ? '#ffd23f' : '#aab0c6'} stroke="#6b3f17" strokeWidth="3" /><text y="6" textAnchor="middle" fontSize="17" fontWeight="800" fill="#3b2410">{i + 1}</text></g>
              {done && <g transform="translate(46 -46)"><circle r="16" fill="#fff" stroke="#e0a122" strokeWidth="3" /><polygon points={star(0, 0, 11)} fill="#ffc938" stroke="#c98a1c" strokeWidth="1.5" strokeLinejoin="round" /></g>}
              {!ok && <g transform="translate(46 -46)"><circle r="15" fill="#aab0c6" stroke="#6b3f17" strokeWidth="3" /><rect x="-6" y="-2" width="12" height="9" rx="2" fill="#3b2410" /><path d="M-4 -2 v-3 a4 4 0 0 1 8 0 v3" stroke="#3b2410" strokeWidth="2.5" fill="none" /></g>}
            </g>
          )
        })}
        <g style={{ transform: `translate(${mx}px, ${my - 92}px)`, transition: reduced ? 'none' : 'transform .9s cubic-bezier(.5,0,.3,1)', pointerEvents: 'none' }}>
          <g className="st-hop"><circle r="26" fill="#fff" stroke="#6b3f17" strokeWidth="4" /><text y="14" fontSize="36" textAnchor="middle">{avatar.badge}</text><path d="M-8 24 L0 36 L8 24Z" fill="#fff" stroke="#6b3f17" strokeWidth="3" strokeLinejoin="round" /></g>
        </g>
      </svg>
      <figcaption>Tap a glowing place to travel there. The Hush’s fog clears as you finish each realm.</figcaption>
    </figure>
  )
}
