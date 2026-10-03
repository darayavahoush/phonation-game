const first = (obj, names) => names.map((n) => obj[n]).find((f) => typeof f === 'function')
export function adapt(engine) {
  const end = first(engine, ['endTrial', 'finishTrial', 'stopTrial'])
  return {
    start: () => engine.start(),
    calibrate: (ms) => engine.calibrate(ms),
    begin: (level, opts) => engine.beginTrial(level, opts),
    end: (recognizer) => recognizer ? engine.endTrialAndRecognize(recognizer) : Promise.resolve(end.call(engine)),
    stop: () => engine.stop(),
    read() { const l = engine.live || {}; return { voiced: !!l.voiced, level: Math.max(0, Math.min(1, l.intensityNorm ?? l.intensity ?? 0)), pitch: l.f0Hz ?? l.pitchHz ?? l.f0 ?? l.pitch ?? null } },
  }
}
export const TYPE_LABEL = { sustained_voicing: 'Hold a sound', cv_syllable: 'Pop a syllable', syllable_train: 'Say it again and again', pitch_glide: 'Slide your voice', loudness_ramp: 'Soft to loud' }
export const levelList = (src) => (Array.isArray(src) ? src : Object.values(src || {}))
// i / n: position within its group, so levels with no name or target become "Level 1", "Level 2", ...
// The thing the child actually says: starter levels use `syllable` / `sound`, custom ones may use `target`.
export const levelTarget = (l) => l.target ?? l.syllable ?? l.sound ?? null
// Big text for the stage: a single syllable, repeated for trains ("ba ba ba"), stretched for sustained sounds ("aaa").
export const levelSay = (l) => {
  const t = levelTarget(l); if (!t) return null
  if (l.type === 'syllable_train') return `${t} ${t} ${t}`
  if (l.type === 'sustained_voicing' && t.length === 1) return t.repeat(3)
  return t
}
export const levelTitle = (l, i = 0, n = 1) => l.title ?? l.name ?? l.label ?? (levelTarget(l) ? `“${levelTarget(l)}”` : (l.target ? `“${l.target}”` : n > 1 ? `Level ${i + 1}` : TYPE_LABEL[l.type] ?? l.id))
export const levelPrompt = (l) => {
  if (l.prompt || l.hint) return l.prompt || l.hint
  const s = levelTarget(l) ? `“${levelTarget(l)}”` : 'a sound' // never "say your voice"
  return {
    sustained_voicing: `Say ${s} and keep it going.`,
    cv_syllable: `Say ${s} quickly, then rest.${l.reps ? ` Do it ${l.reps} times.` : ''}`,
    syllable_train: `Say ${s} again and again, steady and even.`,
    pitch_glide: 'Slide your voice up, or down, like a slide at the park.',
    loudness_ramp: 'Start quiet. Get louder, slowly.',
  }[l.type] ?? 'Make a sound.'
}
export const levelGoalMs = (l) => l.targetMs ?? l.minDurationMs ?? l.durationMs ?? (l.seconds ? l.seconds * 1000 : l.targetSeconds ? l.targetSeconds * 1000 : null)
export const silenceEndMs = (l) => (l.type === 'cv_syllable' ? 3000 : 1600)
// small facts that make levels of the same type look different on the menu
export const levelChips = (l) => {
  const ms = levelGoalMs(l), c = []
  if (ms) c.push(`⏱ ${Math.round(ms / 100) / 10} sec`)
  if (l.reps) c.push(`🔁 ${l.reps} times`)
  return c
}
