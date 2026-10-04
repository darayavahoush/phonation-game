// Live "one count per spoken syllable" for the dots on screen. Display only: the real score still comes from the engine.
// A new syllable starts when
//   (a) voicing restarts after a real gap (>= GAP_MS), or
//   (b) loudness dips well below the last peak and comes back up (fast "pa-pa-pa" with no silent gap).
// A tiny dropout inside ONE syllable (e.g. the burst of "ba") is not a gap, and counts are at least MIN_APART_MS apart.
export const GAP_MS = 130, MIN_RUN_MS = 60, MIN_APART_MS = 200, DIP = 0.45, RISE = 0.7, DIP_MS = 40

export function createCounter() {
  const S = { was: false, gap: 1e9, run: 0, pend: false, pk: 0, dipMs: 0, since: 1e9 }
  return function step(voiced, level, dtMs) { // returns true on the frame a new syllable is confirmed
    S.since += dtMs
    let hit = false
    if (voiced) {
      if (!S.was) { S.pend = S.gap >= GAP_MS; S.gap = 0; S.run = 0 }
      S.run += dtMs
      S.pk = Math.max(S.pk * (1 - dtMs * 0.0004), level) // the "last peak" fades slowly so a quieter next syllable still counts
      if (S.pend) { if (S.run >= MIN_RUN_MS && S.since >= MIN_APART_MS) hit = true }
      else if (level < DIP * S.pk) S.dipMs += dtMs
      else if (level > RISE * S.pk) { if (S.dipMs >= DIP_MS && S.since >= MIN_APART_MS) hit = true; else S.dipMs = 0 }
      if (hit) { S.since = 0; S.pend = false; S.pk = level; S.dipMs = 0 }
    } else { S.gap += dtMs; S.run = 0; S.pend = false; S.dipMs = 0 }
    S.was = voiced
    return hit
  }
}
