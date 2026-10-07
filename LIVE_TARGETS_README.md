# Live in-browser targets

Copy into the repo root (matches your `recognition/` and `ui/` layout):

    recognition/formantTracker.js   LPC + formant peaks + spectral centroid (pure DSP, tested in Node)
    recognition/liveAnalyzer.js     mic -> per-frame {formants, centroid, env}
    recognition/liveTarget.js       target schema, engineFor(level), hold-to-succeed, age/sex presets
    ui/live/LiveTargetMeter.jsx     canvas meter with target line + optional clinician controls
    levels.live-examples.js         example level entries to paste into levels.js

## Wiring (two small edits in your game loop)

    import { engineFor } from './recognition/liveTarget.js';
    import LiveTargetMeter from './ui/live/LiveTargetMeter.jsx';

    // where you currently start the server recognizer for a level:
    if (engineFor(level) === 'live') {
      // render <LiveTargetMeter target={level.target} onSuccess={() => completeLevel(level)} showControls={isClinician} />
    } else {
      // existing ServerRecognizer path, unchanged
    }

Levels with no `target` field behave exactly as before.

## Notes
- Needs HTTPS or localhost for the mic (Render is HTTPS, so fine).
- Safari works with this Web Audio code; staRt itself does not.
- Thresholds (minRms 0.01, order 12, 5-frame median) are starting points. Tune with real child audio:
  child F3 is higher and formants are harder to track than in adults, so expect to adjust.
- Fricative centroid thresholds (6500 / 4800 Hz) are rough placeholders, calibrate on your recordings.
- /r/ F3 values come from the staRt page's table (Lee, Potamianos & Narayanan, 1999).
