// Clip collector: builds YOUR OWN labelled dataset of syllables for training a small recognizer.
// Nothing is uploaded. Clips are kept in this browser (IndexedDB) until you export a .zip to your own disk.
// Audio goes through the same capture path as the game (PhonationEngine), so the saved clips are exactly what
// the recognizer would hear in the game: same mic settings, same sample rate.
//   /collect.html
import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PhonationEngine } from '../index.js'

const CONSONANTS = ['b', 'p', 'd', 't', 'g', 'k', 'm', 'n', 'f', 'v', 's', 'z', 'sh', 'zh', 'th', 'dh', 'ch', 'j', 'h', 'l', 'r', 'y', 'w']
const VOWELS = ['a', 'e', 'i', 'o', 'u']
const PRESETS = {
  'Stop pairs + a (the hard ones)': { c: ['b', 'p', 'd', 't', 'g', 'k'], v: ['a'] },
  'All consonants + a': { c: CONSONANTS, v: ['a'] },
  'ba + all vowels': { c: ['b'], v: VOWELS },
  'Stops + all vowels': { c: ['b', 'p', 'd', 't', 'g', 'k'], v: VOWELS },
}
const MAX_SEC = 3.5

// ---------- storage (IndexedDB) ----------
const dbp = () => new Promise((res, rej) => {
  const q = indexedDB.open('lumivox-collect', 1)
  q.onupgradeneeded = () => q.result.createObjectStore('clips', { keyPath: 'id' })
  q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error)
})
const tx = async (mode, fn) => { const d = await dbp(); return new Promise((res, rej) => { const t = d.transaction('clips', mode); const r = fn(t.objectStore('clips')); t.oncomplete = () => res(r.result); t.onerror = () => rej(t.error) }) }
const dbAll = () => tx('readonly', (s) => s.getAll())
const dbPut = (c) => tx('readwrite', (s) => s.put(c))
const dbDel = (id) => tx('readwrite', (s) => s.delete(id))
const dbClear = () => tx('readwrite', (s) => s.clear())

// ---------- wav + zip ----------
function wavBytes(pcm, sr) {
  const n = pcm.length, b = new ArrayBuffer(44 + n * 2), v = new DataView(b)
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 32767, true)
  return new Uint8Array(b)
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
const crc32 = (u) => { let c = 0xffffffff; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function makeZip(files) { // store-only zip, no dependency
  const enc = new TextEncoder(), parts = [], central = []; let off = 0
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), h = new DataView(new ArrayBuffer(30))
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint32(14, crc, true); h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, name.length, true)
    parts.push(new Uint8Array(h.buffer), name, f.data)
    const c = new DataView(new ArrayBuffer(46))
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint32(16, crc, true); c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true)
    central.push(new Uint8Array(c.buffer), name); off += 30 + name.length + f.data.length
  }
  const cs = central.reduce((a, x) => a + x.length, 0), e = new DataView(new ArrayBuffer(22))
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cs, true); e.setUint32(16, off, true)
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' })
}
const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000) }

// Where the speech is inside the clip (for the manifest only; the saved audio is never trimmed).
function speechSpan(pcm, sr) {
  const fl = Math.round(sr * 0.01), n = Math.floor(pcm.length / fl), e = new Float32Array(n)
  for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < fl; j++) s += pcm[i * fl + j] ** 2; e[i] = Math.sqrt(s / fl) }
  const peak = Math.max(...e, 1e-9), sorted = [...e].sort((a, b) => a - b), floor = sorted[Math.floor(n * 0.2)] || 0, thr = Math.max(floor * 3, peak * 0.1)
  let a = e.findIndex((x) => x > thr), b = n - 1; while (b > 0 && e[b] <= thr) b--
  return a < 0 ? { startMs: 0, endMs: 0, peakDb: -99 } : { startMs: a * 10, endMs: (b + 1) * 10, peakDb: Math.round(20 * Math.log10(peak) * 10) / 10 }
}
const shuffle = (a) => { const x = a.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]] } return x }
const box = { border: '1px solid #ddd', borderRadius: 12, padding: 12, margin: '12px 0' }
const chip = (on) => ({ marginRight: 6, marginBottom: 6, fontWeight: on ? 700 : 400, outline: on ? '2px solid #f90' : 'none' })

function Collect() {
  const eng = useRef(null), audioEl = useRef(null)
  const [clips, setClips] = useState([])
  const [speaker, setSpeaker] = useState(() => localStorage.getItem('collect.speaker') || '')
  const [voice, setVoice] = useState(() => localStorage.getItem('collect.voice') || 'adult')
  const [consent, setConsent] = useState(false)
  const [cons, setCons] = useState(PRESETS['Stop pairs + a (the hard ones)'].c)
  const [vows, setVows] = useState(['a'])
  const [takes, setTakes] = useState(10)
  const [mic, setMic] = useState('off') // off | calibrating | ready | recording
  const [queue, setQueue] = useState([])
  const [pending, setPending] = useState(null) // { pcm, sr, syl, url, span }
  const [err, setErr] = useState('')

  const refresh = async () => setClips(await dbAll())
  useEffect(() => { refresh().catch((e) => setErr('Storage: ' + e.message)) }, [])
  useEffect(() => { localStorage.setItem('collect.speaker', speaker); localStorage.setItem('collect.voice', voice) }, [speaker, voice])

  const syllables = useMemo(() => cons.flatMap((c) => vows.map((v) => c + v)), [cons, vows])
  const mine = clips.filter((c) => c.speaker === speaker.trim())
  const countOf = (s) => mine.filter((c) => c.syllable === s).length
  const cur = queue[0]
  const toggle = (arr, set, x) => set(arr.includes(x) ? arr.filter((y) => y !== x) : [...arr, x])
  const idOk = /^[A-Za-z0-9_-]{1,20}$/.test(speaker.trim())

  function buildQueue() { // round by round, shuffled inside each round, so quitting early still leaves an even set
    const have = Object.fromEntries(syllables.map((s) => [s, countOf(s)])), q = []
    for (let r = 1; r <= takes; r++) q.push(...shuffle(syllables.filter((s) => have[s] < r)))
    setQueue(q); setPending(null)
  }

  async function startMic() {
    setErr('')
    try {
      eng.current?.stop(); eng.current = new PhonationEngine({ profile: voice })
      await eng.current.start(); setMic('calibrating'); await eng.current.calibrate(1500); setMic('ready')
    } catch (e) { setErr('Microphone: ' + e.message); setMic('off') }
  }
  const timer = useRef(null)
  function record() {
    if (!cur || mic !== 'ready') return
    setErr(''); eng.current.beginTrial({ id: 'collect', type: 'cv_syllable', syllable: cur, reps: 1, maxDurationSec: MAX_SEC }, { captureAudio: true })
    setMic('recording'); timer.current = setTimeout(stop, MAX_SEC * 1000)
  }
  function stop() {
    clearTimeout(timer.current)
    if (!eng.current?.analyzer?._trial) return
    try {
      const { audio, sampleRate } = eng.current.analyzer.endTrialWithAudio()
      const span = speechSpan(audio, sampleRate)
      setPending({ pcm: audio, sr: sampleRate, syl: cur, span, url: URL.createObjectURL(new Blob([wavBytes(audio, sampleRate)], { type: 'audio/wav' })) })
    } catch (e) { setErr(e.message) }
    setMic('ready')
  }
  const play = () => { if (pending) { audioEl.current.src = pending.url; audioEl.current.play() } }
  async function keep() {
    const p = pending; if (!p) return
    const take = countOf(p.syl) + 1, sp = speaker.trim()
    await dbPut({ id: `${sp}_${p.syl}_${String(take).padStart(2, '0')}_${Date.now()}`, speaker: sp, voice, syllable: p.syl, consonant: cons.find((c) => p.syl.startsWith(c) && VOWELS.includes(p.syl.slice(c.length))) || p.syl.slice(0, -1), vowel: p.syl.slice(-1), take, sr: p.sr, createdAt: new Date().toISOString(), ...p.span, pcm: p.pcm.buffer })
    URL.revokeObjectURL(p.url); setPending(null); setQueue((q) => q.slice(1)); refresh()
  }
  const redo = () => { if (pending) URL.revokeObjectURL(pending.url); setPending(null) }
  const skip = () => { redo(); setQueue((q) => q.slice(1)) }

  useEffect(() => { // Space = record/stop, Enter = keep, R = redo, P = play
    const on = (e) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return
      if (e.code === 'Space') { e.preventDefault(); if (pending) return; mic === 'recording' ? stop() : record() }
      else if (e.key === 'Enter' && pending) keep(); else if (e.key.toLowerCase() === 'r' && pending) redo(); else if (e.key.toLowerCase() === 'p' && pending) play()
    }
    window.addEventListener('keydown', on); return () => window.removeEventListener('keydown', on)
  })

  async function exportZip() {
    const all = await dbAll(), files = [], enc = new TextEncoder()
    const head = ['file', 'speaker', 'voice', 'syllable', 'consonant', 'vowel', 'take', 'sample_rate', 'speech_start_ms', 'speech_end_ms', 'peak_db', 'created_at']
    const rows = all.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((c) => {
      const f = `clips/${c.id}.wav`; files.push({ name: f, data: wavBytes(new Float32Array(c.pcm), c.sr) })
      return [f, c.speaker, c.voice, c.syllable, c.consonant, c.vowel, c.take, c.sr, c.startMs, c.endMs, c.peakDb, c.createdAt].join(',')
    })
    files.unshift({ name: 'manifest.csv', data: enc.encode([head.join(','), ...rows].join('\n') + '\n') })
    download(makeZip(files), `lumivox-clips-${new Date().toISOString().slice(0, 10)}.zip`)
  }
  async function wipe() { if (confirm(`Delete all ${clips.length} clips from this browser? Export first if you want to keep them.`)) { await dbClear(); refresh() } }

  const total = clips.length, ready = mic === 'ready' || mic === 'recording'
  return (
    <main style={{ font: '16px/1.5 system-ui, sans-serif', maxWidth: 760, margin: '0 auto', padding: 16, color: '#222' }}>
      <h1 style={{ marginBottom: 4 }}>🎙️ Lumivox clip collector</h1>
      <p style={{ marginTop: 0, color: '#555' }}>Records your own labelled syllables to train a small recognizer. Clips stay in this browser until you export a .zip to your own disk. Nothing is uploaded.</p>

      <section style={box}>
        <b>1. Who is speaking</b><br />
        <label>speaker id <input value={speaker} onChange={(e) => setSpeaker(e.target.value)} placeholder="e.g. s01" style={{ width: 90 }} /></label>{' '}
        <label>voice <select value={voice} onChange={(e) => setVoice(e.target.value)} disabled={mic !== 'off'}><option value="adult">adult</option><option value="child">child</option></select></label>
        {!idOk && speaker !== '' && <small style={{ color: '#b00' }}> letters, digits, - or _ only</small>}
        <p style={{ margin: '8px 0 0' }}><label><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> I am the speaker, or a parent/guardian has agreed for a child. Use a code, not a real name. Clips are not uploaded anywhere.</label></p>
      </section>

      <section style={box}>
        <b>2. What to record</b> <small>({syllables.length} syllables, about {syllables.length * takes} clips, roughly {Math.ceil(syllables.length * takes * 6 / 60)} min)</small><br />
        <div style={{ margin: '6px 0' }}>{Object.keys(PRESETS).map((k) => <button key={k} style={{ marginRight: 6 }} onClick={() => { setCons(PRESETS[k].c); setVows(PRESETS[k].v) }}>{k}</button>)}</div>
        <div>consonants: {CONSONANTS.map((c) => <button key={c} onClick={() => toggle(cons, setCons, c)} style={chip(cons.includes(c))}>{c}</button>)}</div>
        <div>vowels: {VOWELS.map((v) => <button key={v} onClick={() => toggle(vows, setVows, v)} style={chip(vows.includes(v))}>{v}</button>)}</div>
        <label>takes each <input type="number" min="1" max="30" value={takes} onChange={(e) => setTakes(Math.max(1, Math.min(30, +e.target.value || 1)))} style={{ width: 56 }} /></label>
        <small style={{ display: 'block', color: '#555' }}>Vowel letters mean “ah, eh, ee, oh, oo”. Say each sound the way your target speakers would, then tell me what you want the game to accept.</small>
      </section>

      <section style={box}>
        <b>3. Microphone</b><br />
        <button disabled={mic !== 'off' || !consent || !idOk} onClick={startMic}>{mic === 'off' ? 'Start mic (then stay quiet 1.5 s)' : mic === 'calibrating' ? 'Listening to the room…' : 'Mic on'}</button>
        <small style={{ color: '#555' }}> Quiet room, about a hand’s width from the mic, same mic you will use in the game.</small>
      </section>

      <section style={box}>
        <b>4. Record</b>{' '}
        <button disabled={!ready || !syllables.length || mic === 'recording'} onClick={buildQueue}>{queue.length ? 'Rebuild list' : 'Make the list'}</button>
        {queue.length > 0 && <small> {queue.length} left</small>}
        {cur ? (
          <div style={{ textAlign: 'center', margin: '12px 0' }}>
            <div style={{ fontSize: 72, fontWeight: 700, letterSpacing: 2 }}>{cur}</div>
            {!pending && (mic === 'recording'
              ? <button style={{ background: '#f55', color: '#fff', fontSize: 18, padding: '8px 20px' }} onClick={stop}>■ Stop (Space)</button>
              : <button style={{ fontSize: 18, padding: '8px 20px' }} disabled={mic !== 'ready'} onClick={record}>● Record (Space)</button>)}
            {!pending && <div><small style={{ color: '#555' }}>Press, say it once, press again. Auto-stops after {MAX_SEC} s.</small></div>}
            {pending && <div>
              <div style={{ margin: '6px 0' }}>{pending.span.endMs === 0 ? '⚠ I could not find any speech in that clip.' : `Speech from ${pending.span.startMs} to ${pending.span.endMs} ms, peak ${pending.span.peakDb} dB.`}</div>
              <button onClick={play}>▶ Play (P)</button>{' '}<button onClick={keep} style={{ fontWeight: 700 }}>✓ Keep as “{pending.syl}” (Enter)</button>{' '}<button onClick={redo}>↺ Redo (R)</button>{' '}<button onClick={skip}>Skip</button>
              <div><small style={{ color: '#555' }}>Only keep it if it really sounds like “{pending.syl}”. A wrong label teaches the model the wrong thing.</small></div>
            </div>}
          </div>
        ) : <p style={{ color: '#555' }}>{ready ? 'Press “Make the list” to start.' : 'Start the mic first.'}</p>}
        <audio ref={audioEl} />
      </section>

      {err && <p role="alert" style={{ color: '#b00' }}>{err}</p>}

      <section>
        <p><b>{total}</b> clips in this browser{speaker.trim() && <> ({mine.length} from “{speaker.trim()}”)</>}. <button disabled={!total} onClick={exportZip}>Export .zip</button> <button disabled={!total} onClick={wipe}>Delete all</button></p>
        {syllables.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{syllables.map((s) => { const n = countOf(s); return <span key={s} style={{ border: '1px solid #ddd', borderRadius: 8, padding: '2px 8px', background: n >= takes ? '#dfd' : n ? '#ffd' : '#fff' }}>{s} {n}/{takes}</span> })}</div>}
        <small style={{ display: 'block', marginTop: 8, color: '#555' }}>Clips are stored in this browser profile. Clearing site data erases them, so export after each session.</small>
      </section>
    </main>
  )
}
createRoot(document.getElementById('r')).render(<Collect />)
