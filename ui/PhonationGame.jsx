import { useEffect, useRef, useState, useCallback } from 'react'
import { PhonationEngine, STARTER_LEVELS } from '../index.js'
import './phonation-ui.css'

const FLAG_TEXT = {
  not_calibrated: 'Room noise was not measured',
  high_noise: 'Room is noisy',
  clipping: 'Microphone is too loud (clipping)',
  capture_processing: 'Device applied noise/echo/gain processing',
  low_snr: 'Voice is weak compared with room noise',
  no_voicing: 'No voicing detected',
}
const INTENSITY = { soft: 0.35, normal: 0.6, strong: 0.9 }
const SILENCE_END_MS = 1600 // stop after this much silence once voicing has occurred

function maxSeconds(l) {
  if (l.maxDurationSec) return l.maxDurationSec
  if (l.type === 'sustained_voicing') return l.targetDurationSec + 6
  if (l.type === 'syllable_train') return (l.durationSec || 5) + 2
  if (l.type === 'cv_syllable') return 4 + 2 * (l.reps || 3)
  return 8
}
const hintFor = (l) => ({
  sustained_voicing: `Keep your voice on for ${l.targetDurationSec} seconds`,
  cv_syllable: `Say it ${l.reps || 3} times, with a little pause between`,
  syllable_train: 'Say it again and again, steadily',
  pitch_glide: l.direction === 'up' ? 'Slide your voice from low to high' : 'Slide your voice from high to low',
  loudness_ramp: l.direction === 'up' ? 'Start quiet and get louder' : 'Start loud and get quieter',
}[l.type])

function Sparkline({ contour }) {
  const pts = (contour || []).filter((p) => p.db != null)
  if (pts.length < 2) return <p className="ph-muted">No contour recorded.</p>
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t || 1
  const lo = Math.min(...pts.map((p) => p.db)), hi = Math.max(...pts.map((p) => p.db))
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(((p.t - t0) / (t1 - t0 || 1)) * 300).toFixed(1)},${(38 - ((p.db - lo) / (hi - lo || 1)) * 36).toFixed(1)}`).join(' ')
  return (
    <svg viewBox="0 0 300 40" className="ph-spark" role="img" aria-label="Level contour">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function TherapistPanel({ result }) {
  const q = result.quality
  const download = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }))
    a.download = `phonation-${result.levelId}-${result.startedAt.replace(/[:.]/g, '-')}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  return (
    <section className="ph-panel" aria-label="Clinician view">
      <h3>{result.levelId} · {result.type.replace('_', ' ')}</h3>
      <p>
        {result.passed ? 'Passed' : 'Not passed'} · progress {Math.round(result.progress * 100)}% · {result.durationSec.toFixed(1)} s
        <span className={q.reliable ? 'ph-badge ok' : 'ph-badge warn'}>{q.reliable ? 'Reliable' : 'Interpret with caution'}</span>
      </p>
      {q.flags.length > 0 && <ul>{q.flags.map((f) => <li key={f}>{FLAG_TEXT[f] || f}</li>)}</ul>}
      <table>
        <tbody>
          {Object.entries(result.metrics).map(([k, v]) => (
            <tr key={k}><th>{k}</th><td>{typeof v === 'number' ? Math.round(v * 1000) / 1000 : String(v)}</td></tr>
          ))}
          <tr><th>SNR (dB)</th><td>{q.snrDb != null ? q.snrDb.toFixed(1) : '–'}</td></tr>
        </tbody>
      </table>
      <Sparkline contour={result.contour} />
      <p className="ph-muted">Level is relative dBFS, not dB SPL. Use for within-child change only.</p>
      <button className="ph-btn ph-ghost" onClick={download}>Download trial JSON</button>
    </section>
  )
}

export default function PhonationGame({ profile = 'child', levels = STARTER_LEVELS, onResult, onExit }) {
  const [stage, setStage] = useState('intro') // intro | calibrating | menu | trial | result
  const [error, setError] = useState(null)
  const [calWarn, setCalWarn] = useState([])
  const [level, setLevel] = useState(null)
  const [result, setResult] = useState(null)
  const [clinician, setClinician] = useState(false)
  const [intensity, setIntensity] = useState('normal')
  const engine = useRef(null)
  const orb = useRef(null), bar = useRef(null), dbg = useRef(null)
  const trial = useRef({ active: false, seen: false, lastVoice: 0, start: 0 })
  const debug = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug')

  const finish = useCallback(() => {
    const t = trial.current
    if (!t.active || !engine.current) return
    t.active = false
    try {
      const r = engine.current.endTrial()
      setResult(r)
      onResult?.(r)
      setStage('result')
    } catch (e) { setError(e.message); setStage('menu') }
  }, [onResult])

  // Single rAF loop: reads engine.live and writes DOM directly (no per-frame setState).
  useEffect(() => {
    if (stage !== 'menu' && stage !== 'trial') return
    let raf, smooth = 0
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const loop = () => {
      const s = engine.current?.live
      const k = INTENSITY[intensity]
      const target = s?.voiced ? s.intensityNorm : 0
      smooth += (target - smooth) * 0.18
      if (orb.current) {
        orb.current.style.transform = reduce ? 'none' : `scale(${1 + smooth * k})`
        orb.current.style.opacity = String(0.45 + 0.55 * Math.min(1, smooth * 1.5 + (s?.voiced ? 0.2 : 0)))
        orb.current.dataset.on = s?.voiced ? '1' : '0'
      }
      if (dbg.current && s) dbg.current.textContent = `voiced ${s.voiced} · f0 ${s.f0Hz?.toFixed(0) ?? '–'} Hz · ${s.db?.toFixed(1) ?? '–'} dB · snr ${s.snrDb?.toFixed(1) ?? '–'}${s.clipping ? ' · CLIP' : ''}`
      const t = trial.current
      if (stage === 'trial' && t.active && s) {
        const now = performance.now()
        if (s.voiced) { t.seen = true; t.lastVoice = now }
        if (level.type === 'sustained_voicing' && bar.current) bar.current.style.width = `${Math.min(100, (s.voicedRunSec / level.targetDurationSec) * 100)}%`
        if ((t.seen && now - t.lastVoice > SILENCE_END_MS) || now - t.start > maxSeconds(level) * 1000) { finish(); return }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [stage, level, intensity, finish])

  useEffect(() => () => {
    if (trial.current.active) engine.current?.cancelTrial()
    engine.current?.stop()
  }, [])

  const begin = async () => { // must run from a click (iOS needs a user gesture)
    setError(null)
    try {
      engine.current = new PhonationEngine({ profile, onError: (e) => setError(e.message) })
      await engine.current.start()
      setStage('calibrating')
      const cal = await engine.current.calibrate(1500)
      setCalWarn(cal.warnings || [])
      setStage('menu')
    } catch (e) {
      setError(e.name === 'NotAllowedError' ? 'Microphone permission was blocked. Allow it in the browser and try again.' : e.message)
      setStage('intro')
    }
  }

  const startTrial = (l) => {
    setError(null); setLevel(l); setResult(null)
    try {
      engine.current.beginTrial(l)
      trial.current = { active: true, seen: false, lastVoice: 0, start: performance.now() }
      setStage('trial')
    } catch (e) { setError(e.message) }
  }

  const idx = level ? levels.findIndex((l) => l.id === level.id) : -1
  const next = idx >= 0 ? levels[idx + 1] : null

  return (
    <main className="ph-root">
      <header className="ph-top">
        {onExit && <button className="ph-btn ph-ghost" onClick={onExit}>Back</button>}
        <label className="ph-muted">Movement{' '}
          <select value={intensity} onChange={(e) => setIntensity(e.target.value)}>
            <option value="soft">Soft</option><option value="normal">Normal</option><option value="strong">Strong</option>
          </select>
        </label>
        <label className="ph-muted"><input type="checkbox" checked={clinician} onChange={(e) => setClinician(e.target.checked)} /> Clinician view</label>
      </header>

      {error && <p role="alert" className="ph-error">{error}</p>}

      {stage === 'intro' && (
        <section className="ph-center">
          <h1>Voice game</h1>
          <p>We use the microphone to see your voice. Nothing is recorded or saved, only how loud and how high it is.</p>
          <button className="ph-btn" onClick={begin}>Start</button>
        </section>
      )}

      {stage === 'calibrating' && <section className="ph-center"><h2>Shh… stay quiet for a moment</h2><div className="ph-orb" data-on="0" /></section>}

      {(stage === 'menu' || stage === 'trial') && (
        <div className="ph-orbwrap"><div className="ph-orb" ref={orb} /></div>
      )}

      {stage === 'menu' && (
        <section className="ph-center">
          {calWarn.length > 0 && <p className="ph-muted">The room sounds {calWarn.includes('high_noise') ? 'noisy' : 'unsettled'}. A quieter spot will give better results.</p>}
          <h2>Pick a sound</h2>
          <p className="ph-muted">Make any sound to see the circle move.</p>
          <div className="ph-grid">
            {levels.map((l) => <button key={l.id} className="ph-btn ph-card" onClick={() => startTrial(l)}>{l.label || l.id}</button>)}
          </div>
          {debug && <p className="ph-muted" ref={dbg} />}
        </section>
      )}

      {stage === 'trial' && (
        <section className="ph-center">
          <h2>{level.label || level.id}</h2>
          <p>{hintFor(level)}</p>
          {level.type === 'sustained_voicing' && <div className="ph-track"><div className="ph-fill" ref={bar} /></div>}
          <button className="ph-btn ph-ghost" onClick={finish}>Done</button>
          {debug && <p className="ph-muted" ref={dbg} />}
        </section>
      )}

      {stage === 'result' && result && (
        <section className="ph-center">
          <h2>{result.stars >= 3 ? 'Great job!' : result.stars >= 1 ? 'Nice try!' : 'Let’s try again'}</h2>
          <p className="ph-stars" aria-label={`${result.stars} of 3 stars`}>{'★'.repeat(result.stars)}{'☆'.repeat(3 - result.stars)}</p>
          <div className="ph-row">
            <button className="ph-btn" onClick={() => startTrial(level)}>Again</button>
            {next && <button className="ph-btn" onClick={() => startTrial(next)}>Next</button>}
            <button className="ph-btn ph-ghost" onClick={() => setStage('menu')}>Menu</button>
          </div>
        </section>
      )}

      {clinician && result && stage === 'result' && <TherapistPanel result={result} />}
    </main>
  )
}
