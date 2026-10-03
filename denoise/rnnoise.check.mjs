// Manual check, deliberately not named *.test.js so default `node --test` runs never pick it up.
// Run in the standalone harness after installing @shiguredo/rnnoise-wasm: node ../denoise/rnnoise.check.mjs
// The package targets browsers, so Node needs a `window` shim to load it.
import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.window = globalThis
const { denoiseForRecognition, resampleLinear } = await import('./rnnoise.js')

const rms = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)) }

test('resampleLinear keeps duration', () => {
  assert.equal(resampleLinear(new Float32Array(16000), 16000, 48000).length, 48000)
})

test('suppresses stationary room noise by at least 20 dB and preserves length', async () => {
  const sr = 16000, N = sr * 2, noisy = new Float32Array(N)
  let seed = 1; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) - 0.5
  for (let i = 0; i < N; i++) {
    const t = i / sr, f0 = 200 + 20 * Math.sin(2 * Math.PI * 3 * t)
    let v = 0; for (let h = 1; h <= 10; h++) v += Math.sin(2 * Math.PI * f0 * h * t) / h
    noisy[i] = (t > 0.5 && t < 1.5 ? 0.25 * v : 0) + 0.05 * (rnd() + rnd() + rnd()) + 0.02 * Math.sin(2 * Math.PI * 120 * t)
  }
  const out = await denoiseForRecognition(noisy, sr)
  assert.equal(out.length, noisy.length)
  const n = Math.floor(0.4 * sr)
  assert.ok(20 * Math.log10(rms(noisy, 0, n) / rms(out, 0, n)) > 20)
})
