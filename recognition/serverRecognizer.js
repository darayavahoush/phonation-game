// Phoneme recognizer backed by the Modal /score endpoint. Same interface as TransformersPhonemeRecognizer.
function wavBlobFrom(audio, sr) {
  const n = audio.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const s = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  s(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); s(8, 'WAVE'); s(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  s(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, audio[i])) * 0x7fff, true);
  return new Blob([buf], { type: 'audio/wav' });
}

// Turn the server's ranked list into the engine's verdict names.
function verdictFor(target, ranked) {
  const [topLabel, topP] = ranked[0] || [null, 0];
  const pt = (ranked.find(([l]) => l === target) || [null, 0])[1];
  const comp = ranked.find(([l]) => l !== target) || [null, 0];
  if (topP < 0.25) return { verdict: 'weak_evidence', pt, comp };
  if (topLabel === target) return { verdict: pt - comp[1] >= 0.15 ? 'target_dominant' : 'ambiguous', pt, comp };
  return { verdict: topP >= 0.5 ? 'competitor_dominant' : 'ambiguous', pt, comp };
}

const DIGRAPHS = ['ch', 'sh', 'ng', 'ny', 'zh'];
function splitSyllable(s) {
  if (Array.isArray(s)) return s;
  const c = DIGRAPHS.find((d) => s.startsWith(d)) || s[0];
  return [c, s.slice(c.length)];
}

export class ServerRecognizer {
  constructor({ baseUrl = import.meta.env.VITE_SCORER_URL, timeoutMs = 90000 } = {}) {
    if (!baseUrl) throw new Error('ServerRecognizer: set VITE_SCORER_URL');
    this.base = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.name = 'modal-wav2vec2-ft';
    this._ready = null;
  }
  ready() { // wakes the container; first call can take 20-60 s
    if (!this._ready) this._ready = fetch(`${this.base}/health`).then((r) => { if (!r.ok) throw new Error('scorer ' + r.status); }).catch((e) => { this._ready = null; throw e; });
    return this._ready;
  }
  async recognize(audio, sampleRate, { level } = {}) {
    const base = { kind: 'phoneme', recognizer: this.name, modelId: this.name };
    const audioSec = audio.length / sampleRate;
    if (audioSec < 0.15) return { ...base, ok: false, reason: 'too_short', audioSec };
    const syl = level && level.syllable ? splitSyllable(level.syllable) : null;
    const fd = new FormData();
    fd.append('file', wavBlobFrom(audio, sampleRate), 'clip.wav');
    if (syl) fd.append('target', syl[0] + syl[1]);
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), this.timeoutMs);
    let r;
    try { r = await fetch(`${this.base}/score`, { method: 'POST', body: fd, signal: ctl.signal }); }
    catch (e) { return { ...base, ok: false, reason: 'server_unreachable', error: String(e) }; }
    finally { clearTimeout(t); }
    if (r.status === 422) return { ...base, ok: false, reason: 'no_speech', audioSec };
    if (!r.ok) return { ...base, ok: false, reason: 'server_error', error: 'HTTP ' + r.status };
    const j = await r.json();
    const heard = j.consonant.top + j.vowel.top;
    if (!syl) return { ...base, ok: true, heard, audioSec };
    const c = verdictFor(syl[0], j.consonant.ranked), w = verdictFor(syl[1], j.vowel.ranked);
    return {
      ...base, ok: true, heard, audioSec,
      consonant: { target: syl[0], targetPeak: c.pt, bestCompetitor: c.comp[0], competitorPeak: c.comp[1], llr: Math.log((c.pt + 1e-4) / (c.comp[1] + 1e-4)), verdict: c.verdict },
      vowel: { target: syl[1], targetPeak: w.pt, bestCompetitor: w.comp[0], competitorPeak: w.comp[1], llr: Math.log((w.pt + 1e-4) / (w.comp[1] + 1e-4)), verdict: w.verdict },
      server: { ms: j.ms, onset_ms: j.onset_ms, consonant: j.consonant.ranked.slice(0, 3), vowel: j.vowel.ranked.slice(0, 2) },
    };
  }
}
