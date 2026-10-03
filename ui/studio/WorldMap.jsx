import { useEffect, useState } from 'react'
import { WORLDS } from './worlds.js'

// An illustrated parchment map of the ten realms. The Hush's fog covers realms not reached yet and clears as you travel.
// Pure SVG; the only motion is the traveller hopping along the trail (instant under reduced motion).
const PTS = [[120, 470], [300, 535], [335, 345], [165, 235], [420, 130], [610, 250], [785, 110], [870, 335], [700, 470], [880, 555]]
const trail = (a, b, c, d) => { // Catmull-Rom -> cubic bezier for one segment b->c
  const t = 0.18
  return `M${b[0]} ${b[1]} C${b[0] + (c[0] - a[0]) * t} ${b[1] + (c[1] - a[1]) * t} ${c[0] - (d[0] - b[0]) * t} ${c[1] - (d[1] - b[1]) * t} ${c[0]} ${c[1]}`
}
const rgb = (c, a = 1) => `rgba(${c.join(',')},${a})`

export default function WorldMap({ quests, arc, openAll, avatar, reduced, onGo }) {
  const here = Math.min(arc, quests.length - 1)
  const [at, setAt] = useState(here)
  const [going, setGoing] = useState(false)
  useEffect(() => { setAt(here) }, [here])
  const go = (i) => {
    if (going) return
    setGoing(true); setAt(i)
    setTimeout(() => { setGoing(false); onGo(i) }, reduced ? 0 : 950)
  }
  const open = (i) => openAll || i <= arc
  const [mx, my] = PTS[at]
  return (
    <figure className="st-map">
      <svg viewBox="0 0 1000 620" role="group" aria-label="Map of the ten realms">
        <defs>
          <radialGradient id="mp-paper" cx="50%" cy="45%" r="75%"><stop offset="0" stopColor="#f6e7bf" /><stop offset="1" stopColor="#d9b97a" /></radialGradient>
          <radialGradient id="mp-fog"><stop offset="0" stopColor="#8d93a6" stopOpacity=".95" /><stop offset=".7" stopColor="#8d93a6" stopOpacity=".7" /><stop offset="1" stopColor="#8d93a6" stopOpacity="0" /></radialGradient>
        </defs>
        <rect x="4" y="4" width="992" height="612" rx="26" fill="url(#mp-paper)" stroke="#8a5a2b" strokeWidth="6" />
        <rect x="18" y="18" width="964" height="584" rx="18" fill="none" stroke="#8a5a2b" strokeWidth="1.5" strokeDasharray="3 6" opacity=".6" />
        {quests.map((q, i) => { const W = WORLDS[q.world]; return <g key={'r' + i}>
          <circle cx={PTS[i][0]} cy={PTS[i][1]} r="125" fill={rgb(W.sky[2], 0.42)} />
          <circle cx={PTS[i][0]} cy={PTS[i][1]} r="82" fill={rgb(W.sky[1], 0.35)} />
          {W.deco.map((d, k) => <text key={k} x={PTS[i][0] + Math.cos(k * 1.7 + i) * 92} y={PTS[i][1] + Math.sin(k * 1.7 + i) * 74} fontSize="26" textAnchor="middle" opacity=".85">{d}</text>)}
        </g> })}
        <text x="500" y="52" textAnchor="middle" fontSize="30" fontWeight="800" fill="#6b3f17" style={{ fontFamily: 'var(--display)' }}>The Kingdom of Echoes</text>
        <text x="60" y="590" fontSize="26">🧭</text><text x="930" y="75" fontSize="24" opacity=".7">🌊</text><text x="40" y="95" fontSize="24" opacity=".7">🌊</text><text x="560" y="590" fontSize="24" opacity=".7">🌊</text>
        {PTS.slice(0, -1).map((p, i) => {
          const d = trail(PTS[Math.max(0, i - 1)], p, PTS[i + 1], PTS[Math.min(PTS.length - 1, i + 2)])
          return <g key={'t' + i}><path d={d} fill="none" stroke="#6b3f17" strokeOpacity=".45" strokeWidth="5" strokeDasharray="2 12" strokeLinecap="round" />
            {(i < arc || openAll) && <path d={d} fill="none" stroke="#e0a122" strokeWidth="6" strokeLinecap="round" />}</g>
        })}
        {quests.map((q, i) => {
          const [x, y] = PTS[i], ok = open(i), done = i < arc, W = WORLDS[q.world]
          return (
            <g key={q.id} className={`st-node ${ok ? 'open' : 'locked'} ${i === arc ? 'now' : ''}`} transform={`translate(${x} ${y})`} role="button" tabIndex={ok ? 0 : -1} aria-disabled={!ok} aria-label={`${q.title}${done ? ', finished' : ok ? '' : ', hidden in fog'}`}
              onClick={() => ok && go(i)} onKeyDown={(e) => { if (ok && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go(i) } }}>
              {i === arc && !openAll && <circle r="52" className="st-pulse" fill="none" stroke="#e0a122" strokeWidth="5" />}
              <circle r="42" fill={rgb(W.sky[1])} stroke={done ? '#e0a122' : '#6b3f17'} strokeWidth="5" />
              <circle r="42" fill="url(#mp-fog)" opacity="0" />
              <text y="14" fontSize="42" textAnchor="middle">{q.icon}</text>
              <text y="68" textAnchor="middle" fontSize="19" fontWeight="800" fill="#4b2a0d" stroke="#f6e7bf" strokeWidth="5" paintOrder="stroke" style={{ fontFamily: 'var(--display)' }}>{q.title.replace(/^\d+\.\s*/, '')}</text>
              <circle cx="-34" cy="-34" r="15" fill="#fff" stroke="#6b3f17" strokeWidth="3" /><text x="-34" y="-28" fontSize="17" fontWeight="800" textAnchor="middle" fill="#4b2a0d">{i + 1}</text>
              {done && <text x="34" y="-28" fontSize="26" textAnchor="middle">⭐</text>}
              {!ok && <g className="st-fog"><circle r="96" fill="url(#mp-fog)" /><circle cx="-34" cy="14" r="62" fill="url(#mp-fog)" /><circle cx="38" cy="-8" r="62" fill="url(#mp-fog)" /><text y="14" fontSize="34" textAnchor="middle">🌫️</text></g>}
            </g>
          )
        })}
        <g className="st-trav" style={{ transform: `translate(${mx}px, ${my - 58}px)`, transition: reduced ? 'none' : 'transform .9s cubic-bezier(.5,0,.3,1)' }}>
          <text className="st-hop" fontSize="44" textAnchor="middle" style={{ filter: 'drop-shadow(0 4px 3px rgba(0,0,0,.35))' }}>{avatar.badge}</text>
        </g>
      </svg>
      <figcaption>Tap a glowing place to travel there. The Hush’s fog clears as you finish each realm.</figcaption>
    </figure>
  )
}
