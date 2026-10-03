// Clinician-facing result view. Everything the engine reports is shown, with its
// reliability next to it; unvalidated measures are labelled so they are not read as norms.
const EXPERIMENTAL = new Set(['votMeanMs', 'votSdMs', 'mannerMatches'])
const FLAG_TEXT = {
  not_calibrated: 'Room noise was not measured',
  high_noise: 'Room is noisy',
  clipping: 'Microphone is too loud (clipping)',
  capture_processing: 'Device applied noise, echo or gain processing',
  low_snr: 'Voice is weak compared with room noise',
  no_voicing: 'No voicing detected',
}
const human = (k) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
const fmt = (v) => (v == null ? '–' : typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : typeof v === 'object' ? JSON.stringify(v) : String(v))

function Sparkline({ data, k, label }) {
  const pts = (data || []).map((d) => d[k]).filter((v) => typeof v === 'number' && isFinite(v))
  if (pts.length < 2) return null
  const lo = Math.min(...pts), hi = Math.max(...pts), r = hi - lo || 1
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${(i / (pts.length - 1)) * 300},${46 - ((v - lo) / r) * 42}`).join('')
  return (
    <figure className="st-spark">
      <svg viewBox="0 0 300 50" role="img" aria-label={`${label} over the trial`}><path d={d} /></svg>
      <figcaption>{label} <span>{Math.round(lo)} to {Math.round(hi)}</span></figcaption>
    </figure>
  )
}

export default function Clinician({ result, level, recognition, onExport }) {
  const q = result.quality || {}
  return (
    <section className="st-clin" aria-label="Clinician view">
      <header>
        <h3>{level?.id ?? 'Trial'} · {level?.type}</h3>
        <span className={`st-badge ${q.reliable ? 'ok' : 'warn'}`}>{q.reliable ? 'Reliable capture' : 'Unreliable capture'}</span>
      </header>
      {!!q.flags?.length && <ul className="st-flags">{q.flags.map((f) => <li key={f}>{FLAG_TEXT[f] ?? f}</li>)}</ul>}
      <table>
        <tbody>
          {Object.entries(result.metrics || {}).map(([k, v]) => (
            <tr key={k}>
              <th scope="row">{human(k)}{EXPERIMENTAL.has(k) && <span className="st-badge warn">experimental</span>}</th>
              <td>{fmt(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="st-sparks">
        <Sparkline data={result.contour} k="db" label="Level (dB, relative)" />
        <Sparkline data={result.contour} k="f0" label="Pitch (Hz)" />
      </div>
      {recognition && (
        <div className="st-recog">
          <h4>On-device sound check <span className="st-badge warn">experimental · not validated for children</span></h4>
          <table><tbody>{Object.entries(recognition).map(([k, v]) => <tr key={k}><th scope="row">{human(k)}</th><td>{fmt(v)}</td></tr>)}</tbody></table>
          <p>Scores come from a speech model trained mostly on adult speech. It can hide errors or invent them. It never changes pass, stars or the metrics above.</p>
        </div>
      )}
      <p className="st-note">Level is relative dBFS, so compare within one child only. No audio is stored. Jitter, shimmer and HNR are not reported: browser microphones cannot support valid values.</p>
      <button className="st-btn ghost" onClick={onExport}>Download trial data (JSON)</button>
    </section>
  )
}
