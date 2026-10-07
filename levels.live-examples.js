// Paste into levels.js. Reuse whatever T.* type your game loop uses for "say it and be scored";
// the only new field is `target`. Levels without `target` keep using the server scorer.
export const LIVE_LEVELS = [
  { id: 'r-f3-hold', label: 'Make a growly "rrr"', target: { type: 'formant', formant: 3, belowHz: 2200, holdMs: 300 } },
  { id: 's-hiss',    label: 'Long snake "sss"',   target: { type: 'centroid', minHz: 6500, holdMs: 400 } },
  { id: 'sh-hush',   label: 'Quiet "shh"',        target: { type: 'centroid', maxHz: 4800, holdMs: 400 } },
];
