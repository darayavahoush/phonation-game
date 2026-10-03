import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PhonationEngine, STARTER_LEVELS } from '../../index.js'
import { MockEngine } from './mockEngine.js'
import { adapt, TYPE_LABEL, levelList, levelTitle, levelPrompt, levelSay, levelGoalMs, silenceEndMs, levelChips } from './engineAdapter.js'
import VoiceStage from './VoiceStage.jsx'
import Clinician from './Clinician.jsx'
import Face from './Face.jsx'
import WorldMap from './WorldMap.jsx'
import Scene from './Scene.jsx'
import { REALM_STORY, AVATARS, WORLDS, SOUNDS, MODES, QUESTS, CAST, SURPRISES, makeLevel, cleanSound, chapterLevel } from './worlds.js'
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
  const [avatarId, setAvatarId] = useState('lumi')
  const [tab, setTab] = useState('quests') // quests | sounds | friends
  const [run, setRun] = useState(null) // { quest, i, twisted } while on a story; session only, nothing is stored
  const [sound, setSound] = useState('ba')
  const [mode, setMode] = useState('pop')
  const [outfit, setOutfit] = useState(null)
  const [prizes, setPrizes] = useState([])
  const [toast, setToast] = useState(null)
  const [plays, setPlays] = useState(0)
  const [scene, setScene] = useState(null)
  const [prog, setProg] = useState(0) // chapters finished this session (nothing is stored)
  const [starsWon, setStarsWon] = useState([])
  const avatar = AVATARS.find((a) => a.id === avatarId) || AVATARS[0]
  const worldId = run ? run.quest.world : Object.keys(WORLDS)[plays % Object.keys(WORLDS).length]
  const world = WORLDS[worldId]
  const [set, setSet] = useState({ gain: 'normal', clinician: false, recog: false, denoise: false, openAll: false })
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

  const choose = (l, name) => { setRun(null); setLevel(l); setLabel(name ?? levelTitle(l)); setResult(null); setNotice(null); setCount(null); setStage('ready') }

  const startChapter = (quest, i, twisted = false) => {
    const ch = quest.chapters[i], l = chapterLevel(ch, twisted, quest, i)
    if (!l) return
    const lines = []
    if (i === 0) (REALM_STORY[QUESTS.indexOf(quest)]?.intro || []).forEach((t) => lines.push({ who: 'narr', text: t }))
    if (twisted && ch.twist) lines.push({ who: 'narr', tag: 'twist', text: ch.twist })
    lines.push({ who: ch.who, text: ch.text })
    setRun({ quest, i, twisted }); setLevel(l); setLabel(`Chapter ${QUESTS.indexOf(quest) * 5 + i + 1} of ${QUESTS.length * 5}`); setResult(null); setNotice(null); setCount(null)
    setScene({ lines }); setStage('scene')
  }
  const startFromMap = (k) => { const q = QUESTS[Math.floor(k / 5)], c = k % 5; startChapter(q, c, !!q.chapters[c].twist) }
  const startFree = () => { const l = makeLevel(sound, mode); if (l) choose(l, `“${cleanSound(sound)}”`) }
  const afterPass = () => { // surprise gift on about every other pass
    if (Math.random() < 0.55) { const g = SURPRISES[Math.floor(Math.random() * SURPRISES.length)]; setOutfit(g.gift); setToast(g); setTimeout(() => setToast(null), 3800) }
  }
  const nextChapter = () => {
    const { quest, i } = run
    const idx = QUESTS.indexOf(quest) * 5 + i
    setProg((p) => Math.max(p, idx + 1)); setStarsWon((a) => { const c = [...a]; c[idx] = Math.max(c[idx] || 0, result?.stars || 1); return c })
    if (i + 1 >= quest.chapters.length) { setPrizes((p) => (p.includes(quest.prize.icon) ? p : [...p, quest.prize.icon])); setStage('finale'); return }
    const nx = quest.chapters[i + 1]; startChapter(quest, i + 1, !!nx.twist)
  }

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
      if (r.passed && r.quality?.reliable !== false) { setNextIdx((i) => (i + 1) % Math.max(list.length, 1)); afterPass() }
      setPlays((n) => n + 1)
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
    <div className="st-root" data-stage={stage} data-world={worldId} style={{ background: `linear-gradient(180deg, ${world.sky[0]} 0%, ${world.sky[1]} 50%, ${world.sky[2]} 100%)`, '--av0': `rgb(${avatar.glow})`, '--av1': `rgb(${avatar.body})` }}>
      <div className="st-deco" aria-hidden="true">{world.deco.map((d, i) => <span key={d + i} style={{ left: `${8 + i * 24}%`, animationDelay: `${i * -3.2}s` }}>{d}</span>)}</div>
      {toast && <div className="st-toast" role="status"><i>{toast.icon}</i>{toast.text}</div>}
      <header className="st-top">
        <h1>Voice Quest</h1>
        {stage !== 'welcome' && (
          <details className="st-settings">
            <summary>Settings</summary>
            <div>
              <fieldset><legend>How strongly the lantern reacts</legend>
                {Object.keys(GAIN).map((g) => <label key={g}><input type="radio" name="gain" checked={set.gain === g} onChange={() => setSet({ ...set, gain: g })} />{g[0].toUpperCase() + g.slice(1)}</label>)}
              </fieldset>
              <label><input type="checkbox" checked={set.openAll} onChange={(e) => setSet({ ...set, openAll: e.target.checked })} />Open all realms on the map <small>(for grown-ups: skip the fog)</small></label>
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
          <div className="st-idle" aria-hidden="true"><Face /><span className="st-hat">{avatar.badge}</span></div>
          <h2>Hi! I’m {avatar.name}.</h2>
          <p>Your voice is magic here. Let’s go on quests and meet dragons, unicorns and more! Find a quiet spot first.</p>
          <p className="st-fine">Your voice is never recorded or sent anywhere. Only loudness and pitch measurements are used.</p>
          <button className="st-btn" onClick={begin} disabled={busy}>{busy ? 'Starting…' : 'Begin the adventure'}</button>
        </main>
      )}

      {stage === 'calibrating' && (
        <main className="st-welcome"><div className="st-idle" aria-hidden="true"><Face /><span className="st-hat">{avatar.badge}</span></div><h2>Shh. {avatar.name} is listening to the room.</h2><p>Stay quiet for a moment.</p></main>
      )}

      {stage === 'howto' && (
        <main className="st-howto">
          <div className="st-orb" aria-hidden="true"><Face /><span className="st-hat">{outfit || avatar.badge}</span></div>
          <h2>How to play</h2>
          <ol className="st-big3">
            {[['🌬️', 'Take a big breath'], ['🗣️', 'Make a sound, like “aaah”'], ['🌟', 'Watch the magic! Louder and longer makes it brighter.']].map(([e, t], i) => <li key={i}><i>{e}</i><b>{i + 1}</b><span>{t}</span></li>)}
          </ol>
          <p className="st-fine">You can’t get it wrong. Every try makes Lumi happy.</p>
          <div className="st-actions"><button className="st-btn big" onClick={() => { setSeenHow(true); setStage('menu') }}>Let’s play!</button><button className="st-btn ghost" onClick={() => say('Take a big breath. Make a sound, like aaah. Watch Lumi glow! Louder and longer makes Lumi brighter.')}>🔊 Hear it</button></div>
        </main>
      )}

      {stage === 'ready' && level && (
        <main className="st-ready">
          <div className="st-orb" aria-hidden="true"><Face /><span className="st-hat">{outfit || avatar.badge}</span></div>
          <div className="st-readycard">
            <div className="st-bigico" aria-hidden="true">{ICON[level.type] ?? '🔆'}</div>
            {levelSay(level) && <div className="st-say" aria-hidden="true">{levelSay(level)}</div>}
            <h2>{label || levelTitle(level)}</h2>
            {run && <p className="st-from">{(CAST[run.quest.chapters[run.i].who] || CAST.narr).icon} {(CAST[run.quest.chapters[run.i].who] || CAST.narr).name} is counting on you</p>}
            <p className="st-lead">{levelPrompt(level)}</p>
            <ol className="st-steps">{(HOWTO[level.type] || HOWTO.default).map((s, i) => <li key={i}><b>{i + 1}</b>{s}</li>)}</ol>
            {count === null
              ? <div className="st-actions"><button className="st-btn big" onClick={() => setCount(3)}>I’m ready!</button><button className="st-btn ghost" onClick={() => say(`${levelPrompt(level)} ${(HOWTO[level.type] || HOWTO.default).join(' ')}`)}>🔊 Hear it</button><button className="st-link" onClick={() => { setRun(null); setStage('menu') }}>Back</button></div>
              : <div className="st-count" role="status" aria-live="assertive" key={count}>{count === 0 ? 'Go!' : count}</div>}
          </div>
        </main>
      )}

      {stage === 'scene' && scene && <Scene lines={scene.lines} cast={CAST} reduced={reduced} world={world} onSpeak={say} onDone={() => { setScene(null); setStage('ready') }} />}

      {stage === 'menu' && (
        <main className="st-menu">
          <h2 className="st-menuhead">Where to, {avatar.name}’s friend?</h2>
          {processing && <p className="st-notice warn" role="alert">This device is changing the sound (noise, echo or volume processing). Results will be marked unreliable. Try another microphone or browser.</p>}
          {calWarn.includes('unstable_background') && <p className="st-notice warn">We heard sound while measuring the room, so quiet voices may be missed. <button className="st-link" onClick={recalibrate}>Measure the room again</button></p>}
          <nav className="st-tabs" aria-label="Choose what to do">
            {[['quests', '🗺️ Story quests'], ['sounds', '🎵 Sounds'], ['friends', `${avatar.badge} Friends`]].map(([id, t]) => <button key={id} className={tab === id ? 'on' : ''} aria-pressed={tab === id} onClick={() => setTab(id)}>{t}</button>)}
            {prizes.length > 0 && <span className="st-prizes" aria-label="Prizes won">{prizes.join(' ')}</span>}
          </nav>

          {tab === 'quests' && prog < QUESTS.length * 5 && <div className="st-continue"><button className="st-btn big" onClick={() => startFromMap(prog)}>{prog ? 'Continue the saga' : 'Begin the saga'} · chapter {prog + 1} of {QUESTS.length * 5}</button></div>}
          {tab === 'quests' && <WorldMap quests={QUESTS} prog={prog} stars={starsWon} openAll={set.openAll} avatar={avatar} reduced={reduced} onGo={startFromMap} />}

          {tab === 'sounds' && <section className="st-sounds">
            <h2>Pick a sound, or type your own</h2>
            <div className="st-chipgrid" role="group" aria-label="Sounds">{SOUNDS.map((x) => <button key={x} className={sound === x ? 'on' : ''} aria-pressed={sound === x} onClick={() => setSound(x)}>{x}</button>)}</div>
            <label className="st-own">Or type your own <input value={sound} maxLength={6} onChange={(e) => setSound(cleanSound(e.target.value))} placeholder="e.g. bo" aria-label="Type your own sound" /></label>
            <div className="st-modes" role="group" aria-label="How to say it">{MODES.map((m) => <button key={m.id} className={mode === m.id ? 'on' : ''} aria-pressed={mode === m.id} onClick={() => setMode(m.id)}><i>{m.icon}</i><b>{m.label}</b><small>{m.hint}</small></button>)}</div>
            <div className="st-actions"><button className="st-btn big" disabled={!cleanSound(sound)} onClick={startFree}>Play “{cleanSound(sound) || '…'}”</button></div>
            <button className="st-link" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Hide more games' : 'More games: slides and loud/quiet'}</button>
            {showAll && Object.entries(groups).filter(([t]) => t === 'pitch_glide' || t === 'loudness_ramp').map(([type, ls]) => (
              <div key={type} className="st-levels">{ls.map((l, i) => { const name = levelTitle(l, i, ls.length); return <button key={l.id ?? name + i} className="st-level" onClick={() => choose(l, name)}><i className="st-ico" aria-hidden="true">{ICON[l.type] ?? '🔆'}</i><strong>{name}</strong><span>{levelPrompt(l)}</span></button> })}</div>))}
          </section>}

          {tab === 'friends' && <div className="st-friends">{AVATARS.map((a) => (
            <button key={a.id} className={avatarId === a.id ? 'on' : ''} aria-pressed={avatarId === a.id} onClick={() => { setAvatarId(a.id); setOutfit(null) }}>
              <i style={{ background: `radial-gradient(circle at 35% 30%, rgb(${a.glow}), rgb(${a.body}))` }}>{a.badge}</i><strong>{a.name}</strong><span>{a.kind}</span><small>{a.blurb}</small>
            </button>))}</div>}

          <div className="st-menufoot"><button className="st-link" onClick={() => setStage('howto')}>How to play</button><button className="st-link" onClick={recalibrate}>Measure the room again</button></div>
        </main>
      )}

      {stage === 'finale' && run && (
        <main className="st-howto">
          <div className="st-confetti" aria-hidden="true">{Array.from({ length: 24 }, (_, i) => <i key={i} style={{ left: `${(i * 4.3 + 2) % 100}%`, animationDelay: `${(i % 8) * 0.2}s`, background: ['#FF9B54', '#FFD08A', '#2FB8A6', '#60A5FA', '#F0604A'][i % 5] }} />)}</div>
          <div className="st-orb" aria-hidden="true"><Face /><span className="st-hat">{run.quest.prize.icon}</span></div>
          <h2>Quest complete!</h2>
          <p className="st-lead st-outro">{REALM_STORY[QUESTS.indexOf(run.quest)]?.outro}</p>
          <p className="st-lead">You won the {run.quest.prize.name} {run.quest.prize.icon}</p>
          <div className="st-actions">{QUESTS[QUESTS.indexOf(run.quest) + 1] ? <button className="st-btn big" onClick={() => startChapter(QUESTS[QUESTS.indexOf(run.quest) + 1], 0)}>Next realm →</button> : <p className="st-lead">🎉 The whole saga is complete. You saved the kingdom!</p>}<button className="st-btn ghost" onClick={() => { setRun(null); setStage('menu') }}>Back to the map</button></div>
        </main>
      )}

      {(stage === 'play' || stage === 'result') && level && (
        <main className="st-play">
          <VoiceStage read={A.current.read} active={stage === 'play'} goalMs={goal} glide={level.type === 'pitch_glide'} gain={GAIN[set.gain]} reduced={reduced} onOnset={() => setTally((n) => n + 1)} avatar={avatar} world={world} outfit={outfit} />
          <div className="st-copy" aria-live="polite">
            {stage === 'play' && <>
              {levelSay(level) && <div className="st-say" aria-hidden="true">{levelSay(level)}</div>}
              {run ? <p className="st-playstory">{(CAST[run.quest.chapters[run.i].who] || CAST.narr).icon} {run.quest.chapters[run.i].text}</p> : null}
              <h2>{levelPrompt(level)}</h2>
              <p className="st-coach">{heard ? (goal ? 'Keep going! You’re doing it! 🚂' : 'Nice! I can hear you! 🎉') : 'Take a breath… then say it!'}</p>
              {nudge && !heard && <p className="st-nudge">Try a little louder, or move closer to the mic 🎤</p>}
              {reps && <div className="st-dots" aria-label={`${Math.min(tally, reps)} of ${reps}`}>{Array.from({ length: reps }, (_, i) => <i key={i} className={i < tally ? 'on' : ''} />)}</div>}
              <button className="st-btn ghost" onClick={finish}>I’m done</button>
            </>}
            {stage === 'result' && result && <>
              {result.passed && result.quality?.reliable !== false && <div className="st-confetti" aria-hidden="true">{Array.from({ length: 16 }, (_, i) => <i key={i} style={{ left: `${(i * 6.3 + 3) % 100}%`, animationDelay: `${(i % 6) * 0.25}s`, background: ['#FF9B54', '#FFD08A', '#2FB8A6', '#60A5FA', '#F0604A'][i % 5] }} />)}</div>}
              {result.quality?.reliable !== false && <div className="st-stars" aria-label={`${result.stars ?? 0} of 3 stars`}>{[0, 1, 2].map((i) => <b key={i} className={i < (result.stars ?? 0) ? 'on' : ''}>★</b>)}</div>}
              {run && result.passed && result.quality?.reliable !== false && (() => { const c = CAST[run.quest.chapters[run.i].who] || CAST.narr; return <div className="st-speak"><i aria-hidden="true">{c.icon}</i><div><b>{c.name}</b><p>{c.cheer[run.i % 2]}</p></div></div> })()}
              <h2>{result.quality?.reliable === false ? 'Hmm, I couldn’t hear that one clearly.' : result.passed ? 'Lovely. You did it.' : 'Good try. Let’s go again.'}</h2>
              {result.quality?.reliable === false && <><p>{adviceFor(result.quality).text}</p><p className="st-why">Why: {adviceFor(result.quality).why}{result.quality.noiseFloorDb != null && ` (room floor ${result.quality.noiseFloorDb} dB, your voice ${result.quality.snrDb ?? '–'} dB above it)`}</p></>}
              <div className="st-actions">{run && result.passed && result.quality?.reliable !== false
                ? <><button className="st-btn big" onClick={nextChapter}>{run.i + 1 >= run.quest.chapters.length ? 'Finish the quest!' : 'Next chapter'}</button><button className="st-btn ghost" onClick={() => play(level)}>Again</button></>
                : <><button className="st-btn" onClick={() => play(level)}>Again</button><button className="st-btn ghost" onClick={() => { setRun(null); setShowAll(false); setStage('menu') }}>Back to the map</button></>}</div>
            </>}
          </div>
          {stage === 'result' && result && set.clinician && <Clinician result={result} level={level} recognition={recognition} onExport={exportJson} />}
        </main>
      )}
    </div>
  )
}
