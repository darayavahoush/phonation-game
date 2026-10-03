// Scripted stand-in for PhonationEngine so the UI can be run and reviewed without a mic
// (`?demo`). It produces plausible live values and a result of the same general shape.
// It is NOT an analyzer: nothing it outputs is a measurement.
export class MockEngine {
  constructor() { this.t0 = 0; this.level = null }
  async start() { return { echoCancellation: false, noiseSuppression: false, autoGainControl: new URLSearchParams(location.search).get('demo') === 'agc' } }
  async calibrate() { await new Promise((r) => setTimeout(r, 1500)); return { warnings: [] } }
  beginTrial(level) { this.level = level; this.t0 = performance.now() }
  get live() {
    const s = (performance.now() - this.t0) / 1000
    const type = this.level?.type
    let on = false, pitch = null, lvl = 0
    if (type === 'sustained_voicing' || type === 'loudness_ramp') {
      on = s > 0.9 && s < 6.5
      lvl = on ? (type === 'loudness_ramp' ? Math.min(1, (s - 0.9) / 5) : 0.55 + 0.08 * Math.sin(s * 2)) : 0
      pitch = 210 + 6 * Math.sin(s * 3)
    } else if (type === 'pitch_glide') {
      on = s > 0.9 && s < 5
      lvl = on ? 0.6 : 0; pitch = 160 + ((s - 0.9) / 4.1) * 220
    } else {
      const k = (s - 0.8) % 1.1
      on = s > 0.8 && s < 6.5 && k < 0.32
      lvl = on ? 0.7 * Math.sin((k / 0.32) * Math.PI) + 0.2 : 0; pitch = 230
    }
    return { voiced: on, intensityNorm: lvl, pitchHz: on ? pitch : null }
  }
  async endTrial() {
    const contour = Array.from({ length: 120 }, (_, i) => ({ t: i * 0.05, db: -45 + 22 * Math.abs(Math.sin(i / 9)), f0: 210 + 12 * Math.sin(i / 11) }))
    return {
      passed: true, stars: 3,
      metrics: { voicedMs: 5400, voicingContinuity: 0.97, meanF0Hz: 211.4, f0SdSemitones: 0.42, levelSdDb: 1.8, onsets: 5, votMeanMs: 24, votSdMs: 6, mannerMatches: null },
      quality: new URLSearchParams(location.search).get('demo') === 'clip' ? { reliable: false, flags: ['clipping'] } : { reliable: true, flags: [] },
      contour,
    }
  }
  stop() {}
}
