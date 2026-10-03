// RNNoise (WASM) offline denoiser for the OPTIONAL recognition path.
//
// Scope, on purpose: this is applied to the in-memory trial audio that is handed to a
// phoneme/word recognizer. It is NEVER applied before the acoustic analyzer: noise
// suppression changes intensity, onsets and voicing, which are exactly what the
// clinical measures (voicing, RMS, VOT, onsets) are computed from.
//
// RNNoise runs at 48 kHz on 480-sample frames and expects 16-bit-PCM scale (+-32768).
// The ~4.8 MB package is loaded lazily, only when someone turns the option on.

const RN_RATE = 48000

let loading = null
const loadRnnoise = () => {
  if (!loading) loading = import('@shiguredo/rnnoise-wasm').then((m) => m.Rnnoise.load())
  return loading
}

export function resampleLinear(x, from, to) {
  if (from === to) return x
  const n = Math.max(1, Math.round((x.length * to) / from))
  const out = new Float32Array(n)
  const k = from / to
  for (let i = 0; i < n; i++) {
    const p = i * k
    const j = Math.floor(p)
    const f = p - j
    const a = x[j] ?? 0
    const b = x[j + 1] ?? a
    out[i] = a + (b - a) * f
  }
  return out
}

/**
 * Denoise mono float audio ([-1, 1]) and return it at its ORIGINAL sample rate.
 * Linear resampling is adequate for speech-band recognition input; it is not a
 * mastering-grade converter.
 */
export async function denoiseForRecognition(samples, sampleRate) {
  const rn = await loadRnnoise()
  const state = rn.createDenoiseState()
  try {
    const up = resampleLinear(samples, sampleRate, RN_RATE)
    const fs = rn.frameSize // 480
    const out = new Float32Array(up.length)
    const frame = new Float32Array(fs)
    for (let i = 0; i < up.length; i += fs) {
      const n = Math.min(fs, up.length - i)
      frame.fill(0)
      for (let j = 0; j < n; j++) frame[j] = up[i + j] * 32768
      state.processFrame(frame)
      for (let j = 0; j < n; j++) out[i + j] = frame[j] / 32768
    }
    return resampleLinear(out, RN_RATE, sampleRate)
  } finally {
    state.destroy()
  }
}

/**
 * Wrap a recognizer so any call that receives a Float32Array as its first argument
 * gets denoised audio instead. Works with whatever method name the recognizer uses.
 * Returned calls are async.
 */
export function withDenoise(recognizer, { onApplied } = {}) {
  return new Proxy(recognizer, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver)
      if (typeof v !== 'function') return v
      return async (...args) => {
        if (args[0] instanceof Float32Array) {
          const sr = typeof args[1] === 'number' ? args[1] : 16000
          args = [await denoiseForRecognition(args[0], sr), ...args.slice(1)]
          onApplied?.()
        }
        return v.apply(target, args)
      }
    },
  })
}
