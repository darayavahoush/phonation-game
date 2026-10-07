// Target definitions + success logic for live (in-browser) levels. Pure JS.
//
// Level shapes:
//   { target: { type: 'phoneme' } }                          -> server scorer (default)
//   { target: { type: 'formant', formant: 3, belowHz: 2200, holdMs: 300 } }   // /r/
//   { target: { type: 'centroid', minHz: 6500, holdMs: 300 } }                // /s/
//   { target: { type: 'centroid', maxHz: 4800, holdMs: 300 } }                // /sh/

export const engineFor = (level) =>
  level?.target && level.target.type !== 'phoneme' ? 'live' : 'server';

// /r/ F3 targets from the staRt tool's published table (Lee, Potamianos & Narayanan, 1999).
// Don't set below ~1500 Hz.
export const R_F3_PRESETS = {
  male:   { '5-9': 2200, '9-13': 2100, '13+': 1700 },
  female: { '5-9': 2400, '9-13': 2200, '13+': 2000 },
};
export const R_F3_MIN_HZ = 1500;

/** Current measured value for the target, or null if nothing usable this frame. */
export function measure(target, frame) {
  if (!frame?.voiced) return null;
  if (target.type === 'formant') return frame.formants?.[(target.formant || 3) - 1] ?? null;
  if (target.type === 'centroid') return frame.centroid ?? null;
  return null;
}

export function inZone(target, value) {
  if (value == null) return false;
  if (target.belowHz != null && !(value < target.belowHz)) return false;
  if (target.minHz != null && !(value > target.minHz)) return false;
  if (target.maxHz != null && !(value < target.maxHz)) return false;
  return true;
}

/** Success only after the value stays in the zone for holdMs (avoids one-frame flukes). */
export function createHoldTracker(holdMs = 300) {
  let since = null;
  return {
    update(ok, now = performance.now()) {
      if (!ok) { since = null; return { progress: 0, done: false }; }
      if (since == null) since = now;
      const progress = Math.min(1, (now - since) / holdMs);
      return { progress, done: progress >= 1 };
    },
    reset() { since = null; },
  };
}
