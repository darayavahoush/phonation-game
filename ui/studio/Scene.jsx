import { useEffect, useState } from 'react'

// A story moment: a big character, a speech bubble that types itself, tap to go on. Reads aloud if asked.
export default function Scene({ lines, cast, reduced, onDone, onSpeak, world }) {
  const [i, setI] = useState(0), [n, setN] = useState(0)
  const L = lines[i], w = cast[L.who] || cast.narr, full = L.text.length
  useEffect(() => { setN(reduced ? full : 0) }, [i, reduced, full])
  useEffect(() => { if (n >= full) return; const t = setTimeout(() => setN((c) => Math.min(full, c + 2)), 28); return () => clearTimeout(t) }, [n, full])
  const last = i === lines.length - 1
  const next = () => (n < full ? setN(full) : last ? onDone() : setI(i + 1))
  return (
    <main className="st-scene" onClick={next}>
      <div className="st-scenebg" aria-hidden="true">{world.deco.map((d, k) => <span key={k} style={{ left: `${12 + k * 22}%`, top: `${12 + (k % 2) * 18}%`, animationDelay: `${k * -1.3}s` }}>{d}</span>)}</div>
      <div className={`st-actor ${L.tag === 'twist' ? 'twist' : ''}`} key={i} aria-hidden="true">{L.tag === 'twist' ? '🌀' : w.icon}</div>
      <div className="st-bubble" role="status" aria-live="polite">
        <b>{L.tag === 'twist' ? 'PLOT TWIST!' : w.name}</b>
        <p>{L.text.slice(0, n)}<span className="st-caret">{n < full ? '▌' : ''}</span></p>
        <div className="st-bubblebar">
          <span>{i + 1} / {lines.length}</span>
          <button className="st-link" onClick={(e) => { e.stopPropagation(); onSpeak(L.text) }}>🔊 Hear it</button>
          <button className="st-btn" onClick={(e) => { e.stopPropagation(); next() }}>{n < full ? 'Skip' : last ? 'Let’s go!' : 'Next ▶'}</button>
        </div>
      </div>
    </main>
  )
}
