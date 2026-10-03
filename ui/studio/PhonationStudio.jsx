import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PhonationEngine, STARTER_LEVELS } from '../../index.js'
import { MockEngine } from './mockEngine.js'
import { adapt, TYPE_LABEL, levelList, levelTitle, levelPrompt, levelSay, levelGoalMs, silenceEndMs, levelChips } from './engineAdapter.js'
import VoiceStage from './VoiceStage.jsx'
import Clinician from './Clinician.jsx'
import Face from './Face.jsx'
import './studio.css'

const ICON = { sustained_voicing: '🕯️', cv_syllable: '✨', syllable_train: '🥁', pitch_glide: '🎢', loudness_ramp: '📣' }
const HOWTO = {
  sustained_voicing: ['Take a big breath.', 'Say the sound and keep it going, like a long train.', 'Fill the ring all the way round!'],
  cv_syllable: ['Take a breath.', 'Say the sound short, then stop and rest.', 'Every pop lights up a dot!'],
  syllable_train: ['Take a breath.', 'Say it again and again, like a drum.', 'Keep it nice and steady.'],
  pitch_glide: ['Start with a low voice.', 'Slide up high, like a slide at the park.', 'Watch the glowing line follow you!'],
  loudness_ramp: ['Start super quiet, like a mouse.', 'Get louder and louder, slowly.', 'Lumi grows as you get louder!'],
  default: ['Take a big breath.', 'Make your sound.', 'Watch Lumi glow!'],
}
// What to tell the child, by the engine's own quality flag (first match wins). Wrong advice is worse than none:
// clipping means TOO loud, so "move closer" would make it worse.
const KID_ADVICE = [
  ['clipping', 'Wow, that was super loud! Try a little softer, or sit a bit further from the microphone.'],
  ['high_noise', 'The room is a bit noisy. Try somewhere quieter.'],
  ['low_snr', 'That one was a bit quiet for me. Try a little louder, or move closer to the microphone.'],
  ['no_voicing', 'I didn’t hear a sound that time. Take a breath and say it a little louder.'],
  ['not_calibrated', 'Let’s listen to the room again first.'],
  ['capture_processing', 'This microphone is changing the sound. A grown-up can try another microphone or browser.'],
]
const WHY = { clipping: 'Microphone is too loud (clipping)', low_snr: 'Voice is weak compared with room noise', high_noise: 'Room is noisy', no_voicing: 'No voicing detected', not_calibrated: 'Room noise was not measured', capture_processing: 'Device applied noise, echo or gain processing' }
const adviceFor = (q) => { const f = q?.flags || []; const hit = KID_ADVICE.find(([k]) => f.includes(k)); return hit ? { text: hit[1], why: f.map((k) => WHY[k] ?? k).join(' · ') } : { text: 'Try somewhere quiet, or say it a little louder.', why: f.length ? f.join(' · ') : 'The capture was marked unreliable' } }
const say = (t) => { try { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(t)) } catch { /* no speech on this device */ } }
const GAIN = { soft: 0.6, normal: 1, strong: 1.5 }
const MAX_TRIAL_MS = 30000
const demo = () => new URLSearchParams(location.search).has('demo')

async function defaultRecognizer() {
  const m = await import('../../index.js')
  const k = Object.keys(m).find((n) => /^create.*recogni[sz]er$/i.test(n))
  if (!k) throw new Error('No create…Recognizer export found in phonation/index.js')
  return m[k]()
}

export default function PhonationStudio({ engineFactory, levels = STARTER_LEVELS, recognizerFactory = defaultRecognizer, denoiser, onResult }) {
  const [stage, setStage] = useState('welcome') // welcome | calibrating | menu | play | result
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [capture, setCapture] = useState(null)
  const [calWarn, setCalWarn] = useState([])
  const [level, setLevel] = useState(null)
  const [heard, setHeard] = useState(false)
  const [tally, setTally] = useState(0)
  const [result, setResult] = useState(null)
  const [count, setCount] = useState(null)
  const [label, setLabel] = useState('')
  const [nudge, setNudge] = useState(false)
  const [seenHow, setSeenHow] = useState(false)
  const [nextIdx, setNextIdx] = useState(() => Math.max(0, levelList(levels).findIndex((l) => l.type === 'cv_syllable'))) // start on a real syllable // Lumi's suggestion: moves on after each reliable pass; nothing is stored
  const [showAll, setShowAll] = useState(false)
  const [set, setSet] = useState({ gain: 'normal', clinician: false, recog: false, denoise: false })
  const reduced = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, [])

  useEffect(() => { window.scrollTo?.(0, 0) }, [stage]) // new screen starts at the top (phones keep the menu's scroll otherwise)

  const A = useRef(null)
  const trial = useRef({ t0: 0, last: 0, heard: false })
  const recog = useRef(null)
  const onResultRef = useRef(onResult); onResultRef.current = onResult

  useEffect(() => () => A.current?.stop(), []) // always release the mic: browser recording indicator must go off
  const list = useMemo(() => levelList(levels), [levels])
  const groups = useMemo(() => list.reduce((m, l) => ((m[l.type] ||= []).push(l), m), {}), [list])

  const begin = async () => {
    if (busy) return
    setBusy(true); setNotice(null)
    try {
      const engine = engineFactory ? engineFactory() : demo() ? new MockEngine() : new PhonationEngine()
      A.current = adapt(engine)
      const cs = await A.current.start()
      setCapture(cs); setStage('calibrating')
      const cal = await A.current.calibrate(1500)
      setCalWarn(cal?.warnings || []); setStage('howto')
    } catch (e) {
      setNotice({ kind: 'warn', text: e?.name === 'NotAllowedError' ? 'The microphone is blocked. Allow it in your browser’s address bar, then press Start again.' : `Could not start the microphone: ${e?.message ?? e}` })
      setStage('welcome')
    } finally { setBusy(false) }
  }

  const recalibrate = async () => {
    setStage('calibrating')
    const cal = await A.current.calibrate(1500)
    setCalWarn(cal?.warnings || []); setStage('menu')
  }

  const choose = (l, name) => { setLevel(l); setLabel(name ?? levelTitle(l)); setResult(null); setNotice(null); setCount(null); setStage('ready') }

  useEffect(() => {
    if (count === null) return
    const t = setTimeout(() => { if (count === 0) { setCount(null); play(level) } else setCount((c) => c - 1) }, count === 0 ? 600 : 900)
    return () => clearTimeout(t)
  }, [count]) // eslint-disable-line react-hooks/exhaustive-deps

  const play = useCallback((l) => {
    setLevel(l); setResult(null); setHeard(false); setTally(0); setNotice(null); setNudge(false)
    trial.current = { t0: performance.now(), last: performance.now(), heard: false, nudged: false }
    A.current.begin(l, { captureAudio: set.recog })
    setStage('play')
  }, [set.recog])

  const finish = useCallback(async () => {
    if (trial.current.done) return
    trial.current.done = true
    try {
      let r
      if (set.recog) {
        try {
          if (!recog.current) { setNotice({ kind: 'info', text: 'Loading the sound check model…' }); recog.current = await recognizerFactory() }
          let rec = recog.current
          if (set.denoise && denoiser) { const { withDenoise } = await denoiser(); rec = withDenoise(rec) }
          r = await A.current.end(rec)
          setNotice(null)
        } catch (e) {
          setNotice({ kind: 'warn', text: `The sound check could not run (${e?.message ?? e}). Your acoustic results are still valid.` })
          r = await A.current.end()
        }
      } else r = await A.current.end()
      if (r.passed && r.quality?.reliable !== false) setNextIdx((i) => (i + 1) % Math.max(list.length, 1))
      setResult(r); setStage('result'); onResultRef.current?.(r, level)
    } catch (e) {
      setNotice({ kind: 'warn', text: `That try could not be scored: ${e?.message ?? e}` }); setStage('menu')
    }
  }, [set.recog, set.denoise, recognizerFactory, denoiser, level])

  // trial end rules + hidden-tab abort (rAF pauses in background tabs, so a trial would overrun)
  useEffect(() => {
    if (stage !== 'play') return
    const id = setInterval(() => {
      const T = trial.current, now = performance.now(), v = A.current.read()
      if (!T.heard && !T.nudged && now - T.t0 > 5000) { T.nudged = true; setNudge(true) }
      if (v.voiced) { T.last = now; if (!T.heard) { T.heard = true; setHeard(true) } }
      if ((T.heard && now - T.last > silenceEndMs(level)) || now - T.t0 > MAX_TRIAL_MS) finish()
    }, 100)
    const hide = () => { if (document.hidden) { clearInterval(id); trial.current.done = true; A.current.end().catch(() => {}); setNotice({ kind: 'info', text: 'Paused because the tab was hidden. Pick a level to try again.' }); setStage('menu') } }
    document.addEventListener('visibilitychange', hide)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', hide) }
  }, [stage, level, finish])

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ level: { id: level.id, type: level.type, target: level.target }, result, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' })
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `phonation-${level.id ?? level.type}.json` })
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  const goal = stage === 'play' && level && (level.type === 'sustained_voicing') ? levelGoalMs(level) : null
  const reps = level?.reps
  const processing = capture && (capture.autoGainControl || capture.noiseSuppression || capture.echoCancellation)
  const recognition = result?.recognition ?? result?.recognizer ?? null

  return (
    <div className="st-root" data-stage={stage}>
      <header className="st-top">
        <h1>Voice Lantern</h1>
        {stage !== 'welcome' && (
          <details className="st-settings">
            <summary>Settings</summary>
            <div>
              <fieldset><legend>How strongly the lantern reacts</legend>
                {Object.keys(GAIN).map((g) => <label key={g}><input type="radio" name="gain" checked={set.gain === g} onChange={() => setSet({ ...set, gain: g })} />{g[0].toUpperCase() + g.slice(1)}</label>)}
              </fieldset>
              <label><input type="checkbox" checked={set.clinician} onChange={(e) => setSet({ ...set, clinician: e.target.checked })} />Clinician view <small>(display only, not access-controlled)</small></label>
              <label><input type="checkbox" checked={set.recog} onChange={(e) => setSet({ ...set, recog: e.target.checked })} />On-device sound check <small>(experimental; a short clip is held in memory until the try is scored)</small></label>
              {denoiser && <label className={set.recog ? '' : 'off'}><input type="checkbox" disabled={!set.recog} checked={set.denoise} onChange={(e) => setSet({ ...set, denoise: e.target.checked })} />Reduce room noise for the sound check only <small>(your loudness and pitch results always use the original sound)</small></label>}
            </div>
          </details>
        )}
      </header>

      {notice && <p role="status" className={`st-notice ${notice.kind}`}>{notice.text}</p>}

      {stage === 'welcome' && (
        <main className="st-welcome">
          <div className="st-idle" aria-hidden="true"><Face /></div>
          <h2>Hi! I’m Lumi.</h2>
          <p>Let’s turn your voice into light! Find a quiet spot first.</p>
          <p className="st-fine">Your voice is never recorded or sent anywhere. Only loudness and pitch measurements are used.</p>
          <button className="st-btn" onClick={begin} disabled={busy}>{busy ? 'Starting…' : 'Light the lantern'}</button>
        </main>
      )}

      {stage === 'calibrating' && (
        <main className="st-welcome"><div className="st-idle" aria-hidden="true"><Face /></div><h2>Shh. Lumi is listening to the room.</h2><p>Stay quiet for a moment.</p></main>
      )}

      {stage === 'howto' && (
        <main className="st-howto">
          <div className="st-orb" aria-hidden="true"><Face /></div>
          <h2>How to play</h2>
          <ol className="st-big3">
            {[['🌬️', 'Take a big breath'], ['🗣️', 'Make a sound, like “aaah”'], ['🌟', 'Watch Lumi glow! Louder and longer makes Lumi brighter.']].map(([e, t], i) => <li key={i}><i>{e}</i><b>{i + 1}</b><span>{t}</span></li>)}
          </ol>
          <p className="st-fine">You can’t get it wrong. Every try makes Lumi happy.</p>
          <div className="st-actions"><button className="st-btn big" onClick={() => { setSeenHow(true); setStage('menu') }}>Let’s play!</button><button className="st-btn ghost" onClick={() => say('Take a big breath. Make a sound, like aaah. Watch Lumi glow! Louder and longer makes Lumi brighter.')}>🔊 Hear it</button></div>
        </main>
      )}

      {stage === 'ready' && level && (
        <main className="st-ready">
          <div className="st-orb" aria-hidden="true"><Face /></div>
          <div className="st-readycard">
            <div className="st-bigico" aria-hidden="true">{ICON[level.type] ?? '🔆'}</div>
            {levelSay(level) && <div className="st-say" aria-hidden="true">{levelSay(level)}</div>}
            <h2>{label || levelTitle(level)}</h2>
            <p className="st-lead">{levelPrompt(level)}</p>
            <ol className="st-steps">{(HOWTO[level.type] || HOWTO.default).map((s, i) => <li key={i}><b>{i + 1}</b>{s}</li>)}</ol>
            {count === null
              ? <div className="st-actions"><button className="st-btn big" onClick={() => setCount(3)}>I’m ready!</button><button className="st-btn ghost" onClick={() => say(`${levelPrompt(level)} ${(HOWTO[level.type] || HOWTO.default).join(' ')}`)}>🔊 Hear it</button><button className="st-link" onClick={() => setStage('menu')}>Back</button></div>
              : <div className="st-count" role="status" aria-live="assertive" key={count}>{count === 0 ? 'Go!' : count}</div>}
          </div>
        </main>
      )}

      {stage === 'menu' && (
        <main className="st-menu">
          <h2 className="st-menuhead">Ready for the next one?</h2>
          {processing && <p className="st-notice warn" role="alert">This device is changing the sound (noise, echo or volume processing). Results will be marked unreliable. Try another microphone or browser.</p>}
          {calWarn.includes('unstable_background') && <p className="st-notice warn">We heard sound while measuring the room, so quiet voices may be missed. <button className="st-link" onClick={recalibrate}>Measure the room again</button></p>}
          {!showAll && list[nextIdx] && (() => { const l = list[nextIdx]; const name = levelTitle(l, 0, 1); return (
            <section className="st-next"><button className="st-level" onClick={() => choose(l, name)}><i className="st-ico" aria-hidden="true">{ICON[l.type] ?? '🔆'}</i><strong>{name}</strong><span>{levelPrompt(l)}</span></button></section>
          ) })()}
          {showAll && Object.entries(groups).map(([type, ls]) => (
            <section key={type}>
              <h2>{TYPE_LABEL[type] ?? type}</h2>
              <div className="st-levels">{ls.map((l, i) => { const name = levelTitle(l, i, ls.length); return <button key={l.id ?? name + i} className="st-level" onClick={() => choose(l, name)}><i className="st-ico" aria-hidden="true">{ICON[l.type] ?? '🔆'}</i><strong>{name}</strong><span>{levelPrompt(l)}</span>{levelChips(l).length > 0 && <em className="st-chips">{levelChips(l).map((c) => <b key={c}>{c}</b>)}</em>}</button> })}</div>
            </section>
          ))}
          <div className="st-menufoot"><button className="st-link" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Back to Lumi’s pick' : 'Choose a different game'}</button><button className="st-link" onClick={() => setStage('howto')}>How to play</button><button className="st-link" onClick={recalibrate}>Measure the room again</button></div>
        </main>
      )}

      {(stage === 'play' || stage === 'result') && level && (
        <main className="st-play">
          <VoiceStage read={A.current.read} active={stage === 'play'} goalMs={goal} glide={level.type === 'pitch_glide'} gain={GAIN[set.gain]} reduced={reduced} onOnset={() => setTally((n) => n + 1)} />
          <div className="st-copy" aria-live="polite">
            {stage === 'play' && <>
              {levelSay(level) && <div className="st-say" aria-hidden="true">{levelSay(level)}</div>}
              <h2>{levelPrompt(level)}</h2>
              <p className="st-coach">{heard ? (goal ? 'Keep going! You’re doing it! 🚂' : 'Nice! I can hear you! 🎉') : 'Take a breath… then say it!'}</p>
              {nudge && !heard && <p className="st-nudge">Try a little louder, or move closer to the mic 🎤</p>}
              {reps && <div className="st-dots" aria-label={`${Math.min(tally, reps)} of ${reps}`}>{Array.from({ length: reps }, (_, i) => <i key={i} className={i < tally ? 'on' : ''} />)}</div>}
              <button className="st-btn ghost" onClick={finish}>I’m done</button>
            </>}
            {stage === 'result' && result && <>
              {result.passed && result.quality?.reliable !== false && <div className="st-confetti" aria-hidden="true">{Array.from({ length: 16 }, (_, i) => <i key={i} style={{ left: `${(i * 6.3 + 3) % 100}%`, animationDelay: `${(i % 6) * 0.25}s`, background: ['#FF9B54', '#FFD08A', '#2FB8A6', '#60A5FA', '#F0604A'][i % 5] }} />)}</div>}
              {result.quality?.reliable !== false && <div className="st-stars" aria-label={`${result.stars ?? 0} of 3 stars`}>{[0, 1, 2].map((i) => <b key={i} className={i < (result.stars ?? 0) ? 'on' : ''}>★</b>)}</div>}
              <h2>{result.quality?.reliable === false ? 'Hmm, I couldn’t hear that one clearly.' : result.passed ? 'Lovely. You did it.' : 'Good try. Let’s go again.'}</h2>
              {result.quality?.reliable === false && <><p>{adviceFor(result.quality).text}</p><p className="st-why">Why: {adviceFor(result.quality).why}{result.quality.noiseFloorDb != null && ` (room floor ${result.quality.noiseFloorDb} dB, your voice ${result.quality.snrDb ?? '–'} dB above it)`}</p></>}
              <div className="st-actions"><button className="st-btn" onClick={() => play(level)}>Again</button><button className="st-btn ghost" onClick={() => { setShowAll(false); setStage('menu') }}>Next game</button></div>
            </>}
          </div>
          {stage === 'result' && result && set.clinician && <Clinician result={result} level={level} recognition={recognition} onExport={exportJson} />}
        </main>
      )}
    </div>
  )
}
