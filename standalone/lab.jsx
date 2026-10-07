import { ServerRecognizer } from '../recognition/serverRecognizer.js'
// Phoneme lab: an EXPERIMENT page, separate from the game. Records one syllable at a time, runs an on-device
// phoneme recognizer on it, and shows what the model heard next to what you meant to say.
// Nothing is uploaded: audio stays in memory for the one recognition call and is dropped. The model itself is
// downloaded once from Hugging Face and cached by the browser.
//   /lab.html            real model (about 300 MB the first time)
//   /lab.html?mock=1     fake recognizer, to try the page without downloading anything
import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PhonationEngine, TransformersPhonemeRecognizer, MockRecognizer } from '../index.js'

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0'
const MODEL_ID = 'onnx-community/wav2vec2-lv-60-espeak-cv-ft-ONNX'
// Every consonant and vowel the scorer knows. Pick one of each; the syllable is consonant + vowel (e.g. sha, bi, thu).
const CONSONANTS = ['b', 'p', 'd', 't', 'g', 'k', 'm', 'n', 'f', 'v', 's', 'z', 'sh', 'zh', 'th', 'dh', 'h', 'l', 'r', 'y', 'w', 'ch', 'j']
const VOWELS = ['a', 'e', 'i', 'o', 'u']
const mock = new URLSearchParams(location.search).get('mock') === '1'
const VERDICT = { target_dominant: '✅ target', competitor_dominant: '❌ other sound', ambiguous: '🤔 unsure', weak_evidence: '… too weak' }

// Fake recognizer for trying the page offline: always "hears" the target, so the plumbing is visible.
const makeMock = () => new MockRecognizer((audio, sr, { level }) => ({
  experimental: true, kind: 'phoneme', ok: true, heard: level.syllable, audioSec: Math.round((audio.length / sr) * 100) / 100,
  consonant: { target: level.syllable[0], targetPeak: 0.9, bestCompetitor: null, competitorPeak: 0, llr: 3, verdict: 'target_dominant' },
  vowel: { target: level.syllable[1], targetPeak: 0.9, bestCompetitor: null, competitorPeak: 0, llr: 3, verdict: 'target_dominant' },
}), 'mock (not a real model)')

// Keeps the latest clip in memory so YOU can download it as a .wav for debugging. Nothing is uploaded.
const withCapture = (inner, store) => ({
  name: inner.name,
  ready: () => inner.ready(),
  recognize: async (audio, sr, ctx) => { store.current = { audio: new Float32Array(audio), sr }; return inner.recognize(audio, sr, ctx) },
})

function wavBlob(audio, sr) {
  const n = audio.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf)
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true)
  v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  w(36, 'data'); v.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, audio[i])) * 32767, true)
  return new Blob([buf], { type: 'audio/wav' })
}

function Lab() {
  const rec = useRef(null), eng = useRef(null)
  const [model, setModel] = useState({ state: 'idle', msg: '' })
  const [mic, setMic] = useState('off') // off | calibrating | ready | recording | thinking
  const [cons, setCons] = useState('b')
  const [vow, setVow] = useState('a')
  const syl = cons + vow
  const [profile, setProfile] = useState('child')
  const [rows, setRows] = useState([])
  const [err, setErr] = useState('')
  const files = useRef({})
  const lastClip = useRef(null)
  const clips = useRef(new Map())

  async function loadModel() {
    setErr('')
    if (mock) { rec.current = withCapture(makeMock(), lastClip); setModel({ state: 'ready', msg: 'mock recognizer' }); return }
    if (new URLSearchParams(location.search).get('server')) { rec.current = withCapture(new ServerRecognizer(), lastClip); setModel({ state: 'loading', msg: 'waking the server…' }); rec.current.ready().then(() => setModel({ state: 'ready', msg: 'server recognizer' })).catch((e) => setModel({ state: 'error', msg: String(e.message || e) })); return }
    const t0 = Date.now()
    try {
      setModel({ state: 'loading', msg: 'starting…' })
      const transformers = await import(/* @vite-ignore */ TRANSFORMERS_URL) // loaded at runtime so the game build carries no ML dependency
      // This model repo ships vocab.json but no tokenizer.json, so fetch the vocabulary ourselves and pass it in.
      setModel({ state: 'loading', msg: 'fetching vocabulary…' })
      const vr = await fetch(`https://huggingface.co/${MODEL_ID}/resolve/main/vocab.json`)
      if (!vr.ok) throw new Error(`vocab.json: HTTP ${vr.status}`)
      const vocab = await vr.json()
      rec.current = new TransformersPhonemeRecognizer({
        transformers, modelId: MODEL_ID, dtype: 'q8', vocab,
        onProgress: (p) => {
          if (p.status === 'progress' && p.file) { files.current[p.file] = p; const f = Object.values(files.current); const loaded = f.reduce((a, x) => a + (x.loaded || 0), 0), total = f.reduce((a, x) => a + (x.total || 0), 0); setModel({ state: 'loading', msg: `downloading ${(loaded / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB` }) }
        },
      })
      rec.current = withCapture(rec.current, lastClip)
      await rec.current.ready()
      setModel({ state: 'ready', msg: `loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s` })
    } catch (e) { rec.current = null; setModel({ state: 'idle', msg: '' }); setErr(`Model failed to load: ${e.message}`) }
  }

  async function startMic() {
    setErr('')
    try {
      eng.current?.stop()
      eng.current = new PhonationEngine({ profile })
      await eng.current.start()
      setMic('calibrating')
      await eng.current.calibrate(1500)
      setMic('ready')
    } catch (e) { setErr(`Microphone: ${e.message}`); setMic('off') }
  }

  function record() {
    setErr('')
    eng.current.beginTrial({ id: 'lab', type: 'cv_syllable', syllable: syl, reps: 1, maxDurationSec: 4 }, { captureAudio: true })
    setMic('recording')
  }

  async function stopAndRecognize() {
    setMic('thinking')
    try {
      const r = await eng.current.endTrialAndRecognize(rec.current)
      const x = r.recognition || {}
      const rowN = rows.length + 1
      if (lastClip.current) { clips.current.set(rowN, lastClip.current); lastClip.current = null }
      setRows((rs) => [{
        n: rowN, target: syl, heard: x.heard ?? (x.reason || x.error || '—'), cons: x.consonant?.verdict ?? '', final: x.consonant?.final ?? '', by: x.consonant?.decidedBy ?? '', vot: x.voicingCue?.ok ? x.voicingCue.votMs : '', pre: x.voicingCue?.ok ? x.voicingCue.prevoicedMs : '', cue: x.voicingCue?.ok ? x.voicingCue.call : (x.voicingCue?.reason ?? ''), place: x.consonant?.place ?? '', voicing: x.consonant?.voicing ?? '', llrV: x.consonant?.voicingLlr ?? '', vowel: x.vowel?.verdict ?? '',
        llrC: x.consonant?.llr ?? '', comp: x.consonant?.bestCompetitor ?? '', count: r.metrics?.syllableCount ?? '', reliable: r.quality?.reliable, flags: (r.quality?.flags || []).join(' '), ok: x.ok !== false,
      }, ...rs])
    } catch (e) { setErr(e.message) }
    setMic('ready')
  }

  const ready = model.state === 'ready'
  const done = rows.filter((r) => r.cons)
  const hit = done.filter((r) => (r.final ? r.final === 'correct' : r.cons === 'target_dominant')).length
  const VOICE = { target: '✅ voiced right', twin: '↔ other voicing', unsure: '🤔 voicing unclear' }
  const FINAL = { correct: '✅ correct', wrong: '❌ wrong', unsure: '🤔 unsure' }
  const csv = () => {
    const h = ['n', 'target', 'heard', 'consonant', 'final', 'decided_by', 'vot_ms', 'prevoiced_ms', 'cue', 'place', 'voicing', 'llr_voicing', 'vowel', 'llr_consonant', 'best_competitor', 'acoustic_count', 'reliable', 'flags']
    const lines = [h.join(','), ...rows.slice().reverse().map((r) => [r.n, r.target, `"${r.heard}"`, r.cons, r.final, r.by, r.vot, r.pre, r.cue, r.place, r.voicing, r.llrV, r.vowel, r.llrC, r.comp, r.count, r.reliable, `"${r.flags}"`].join(','))]
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })); a.download = 'phoneme-lab.csv'; a.click()
  }

  return (
    <main style={{ font: '16px/1.5 system-ui, sans-serif', maxWidth: 720, margin: '0 auto', padding: 16, color: '#222' }}>
      <h1 style={{ marginBottom: 4 }}>🧪 Lumivox phoneme lab</h1>
      <p style={{ marginTop: 0, color: '#555' }}>Experiment only. It does not affect the game. Audio is never saved or uploaded; only the model is downloaded.{mock && <b> MOCK MODE: results are fake.</b>}</p>

      <section style={{ border: '1px solid #ddd', borderRadius: 12, padding: 12, margin: '12px 0' }}>
        <b>1. Model</b> <small>({mock ? 'fake' : 'wav2vec2 espeak, quantized, about 300 MB the first time, then cached'})</small><br />
        <button disabled={model.state !== 'idle'} onClick={loadModel}>{model.state === 'ready' ? 'Model ready' : model.state === 'loading' ? 'Loading…' : 'Load model'}</button> <span>{model.msg}</span>
      </section>

      <section style={{ border: '1px solid #ddd', borderRadius: 12, padding: 12, margin: '12px 0' }}>
        <b>2. Microphone</b> <label style={{ marginLeft: 8 }}>voice: <select value={profile} onChange={(e) => setProfile(e.target.value)} disabled={mic !== 'off'}><option value="child">child</option><option value="adult">adult</option></select></label><br />
        <button disabled={mic !== 'off'} onClick={startMic}>{mic === 'off' ? 'Start mic (then stay quiet 1.5 s)' : mic === 'calibrating' ? 'Listening to the room…' : 'Mic on'}</button>
      </section>

      <section style={{ border: '1px solid #ddd', borderRadius: 12, padding: 12, margin: '12px 0' }}>
        <b>3. Say one sound</b><br />
        <div style={{ margin: '8px 0' }}>
          <div>consonant: {CONSONANTS.map((c) => <button key={c} onClick={() => setCons(c)} disabled={mic === 'recording' || mic === 'thinking'} style={{ marginRight: 4, marginBottom: 4, fontWeight: c === cons ? 700 : 400, outline: c === cons ? '2px solid #f90' : 'none' }}>{c}</button>)}</div>
          <div>vowel: {VOWELS.map((v) => <button key={v} onClick={() => setVow(v)} disabled={mic === 'recording' || mic === 'thinking'} style={{ marginRight: 4, fontWeight: v === vow ? 700 : 400, outline: v === vow ? '2px solid #f90' : 'none' }}>{v}</button>)}</div>
        </div>
        {mic === 'recording'
          ? <button style={{ background: '#f55', color: '#fff' }} onClick={stopAndRecognize}>■ Stop and check “{syl}”</button>
          : <button disabled={!ready || mic !== 'ready'} onClick={record}>● Record “{syl}” (say it once, then press Stop)</button>}
        {mic === 'thinking' && <span> checking…</span>}
        {!ready && <small style={{ display: 'block', color: '#a60' }}>Load the model first.</small>}
      </section>

      {err && <p role="alert" style={{ color: '#b00' }}>{err}</p>}

      {rows.length > 0 && <section>
        <p><b>{hit} of {done.length}</b> attempts were CORRECT on the starting consonant (b and p are different sounds; an unclear one counts as not correct). <button onClick={csv}>Download CSV</button> <button onClick={() => { setRows([]); clips.current.clear() }}>Clear</button></p>
        <div style={{ overflowX: 'auto' }}><table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr>{['#', 'meant', 'model heard', 'consonant', 'voicing (model)', 'vot / pre-voicing ms', 'vowel', 'other sound', 'dots', 'mic', 'clip'].map((h) => <th key={h} style={{ textAlign: 'left', borderBottom: '2px solid #ccc', padding: 4 }}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r) => <tr key={r.n}>{[r.n, r.target, r.heard, (r.final ? FINAL[r.final] + (r.by === 'acoustic' ? ' (by audio cue)' : '') : VERDICT[r.cons]) || r.cons, VOICE[r.voicing] || '', r.vot === '' ? (r.cue || '') : `${r.vot} / ${r.pre} (${r.cue})`, VERDICT[r.vowel] || r.vowel, r.comp, r.count, r.reliable === false ? '⚠ ' + r.flags : 'ok', clips.current.has(r.n) ? <button onClick={() => { const c = clips.current.get(r.n); const a = document.createElement('a'); a.href = URL.createObjectURL(wavBlob(c.audio, c.sr)); a.download = `lab-${r.n}-${r.target}.wav`; a.click() }}>save .wav</button> : ''].map((c, i) => <td key={i} style={{ borderBottom: '1px solid #eee', padding: 4 }}>{typeof c === 'object' ? c : String(c)}</td>)}</tr>)}</tbody>
        </table></div>
        <small>“model heard” is the raw phone string; “consonant / vowel” compare the model’s confidence in what you meant against its best rival. Not validated on children or on disordered speech, so treat a ❌ as a clue, not a mistake by the child.</small>
      </section>}
    </main>
  )
}
createRoot(document.getElementById('r')).render(<Lab />)
