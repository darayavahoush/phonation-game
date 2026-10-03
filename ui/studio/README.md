# Voice Lantern (ui/studio)

Calm, clinician-aware front end for the phonation engine. Adds files only; nothing existing is edited.

```jsx
import { PhonationStudio } from './ui/studio'
<PhonationStudio onResult={(result, level) => { /* send de-identified result */ }} />
```

- `?demo` runs against a scripted `MockEngine` (no microphone). `?demo=agc` simulates a device that applies auto-gain.
- `engineAdapter.js` is the only file that calls `PhonationEngine`. If a method name differs, change it there.
- Props: `engineFactory`, `levels`, `recognizerFactory`, `denoiser`, `onResult`.

## Optional noise reduction (standalone harness only)
RNNoise is applied to the in-memory clip given to the experimental recognizer, never to the acoustic analyzer
(it changes intensity, onsets and voicing). The dependency stays out of the main app's package.json:

```bash
cd frontend/src/phonation/standalone && npm i @shiguredo/rnnoise-wasm
```
```jsx
<PhonationStudio denoiser={() => import('../denoise/rnnoise.js')} />
```
The ~4.8 MB module loads only when the option is switched on. Check it with `node denoise/rnnoise.check.mjs`.

## Not verified
Run against a stub engine and a mock only: a real microphone, a real PhonationEngine and a real recognizer model have not been tried.
The sound check and denoiser are unvalidated for children's and disordered speech.
