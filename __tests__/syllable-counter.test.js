import test from 'node:test'
import assert from 'node:assert/strict'
import { createCounter } from '../ui/studio/syllableCounter.js'

// build a per-frame (16 ms) voice from segments: ['v', ms, level0, level1] voiced with a linear level, ['s', ms] silence
const run = (segs) => {
  const step = createCounter(); let n = 0; const dt = 16
  for (const [k, ms, a = 0.6, b = a] of segs) for (let t = 0; t < ms; t += dt) n += step(k === 'v', k === 'v' ? a + (b - a) * (t / ms) : 0, dt) ? 1 : 0
  return n
}
const syl = (vms = 220) => [['v', 30, 0.1, 0.5], ['v', vms - 90, 0.5, 0.55], ['v', 60, 0.5, 0.1]]

test('"pa pa pa" at a normal pace counts 3, for several gaps', () => {
  for (const gap of [150, 250, 400, 700, 1200]) assert.equal(run([['s', 300], ...syl(), ['s', gap], ...syl(), ['s', gap], ...syl(), ['s', 500]]), 3, `gap ${gap}`)
})
test('fast "papapa" with only a quick loudness dip between syllables counts 3', () => {
  const fast = [['v', 60, 0.15, 0.6], ['v', 60, 0.6, 0.55], ['v', 70, 0.55, 0.12]]
  assert.equal(run([['s', 300], ...fast, ...fast, ...fast, ['s', 400]]), 3)
})
test('one "ba" with a short voicing dropout inside it counts once', () => {
  assert.equal(run([['s', 300], ['v', 70, 0.2, 0.5], ['s', 100], ['v', 160, 0.5, 0.2], ['s', 600]]), 1)
  assert.equal(run([['s', 300], ['v', 90, 0.3, 0.5], ['s', 60], ['v', 200, 0.5, 0.2], ['s', 600]]), 1)
})
test('a held "aaa" with a little wobble does not keep counting', () => {
  const wob = Array.from({ length: 30 }, (_, i) => ['v', 80, 0.55 + (i % 2 ? 0.08 : -0.08)])
  assert.equal(run([['s', 300], ...wob, ['s', 400]]), 1)
})
test('a quieter second and third syllable still count', () => {
  assert.equal(run([['s', 300], ...syl(), ['s', 300], ['v', 30, 0.05, 0.25], ['v', 130, 0.25, 0.22], ['v', 60, 0.2, 0.05], ['s', 300], ['v', 30, 0.04, 0.2], ['v', 130, 0.2, 0.18], ['v', 60, 0.15, 0.04], ['s', 400]]), 3)
})
test('silence and very short blips count nothing', () => {
  assert.equal(run([['s', 2000]]), 0)
  assert.equal(run([['s', 300], ['v', 32, 0.5], ['s', 300], ['v', 32, 0.5], ['s', 300]]), 0)
})
