#!/usr/bin/env node
// Writes a few synthetic WAVs + a manifest so you can smoke-test the pipeline end to end.
// This proves the HARNESS works. It says nothing about clinical validity: for that you need real recordings.
import fs from 'node:fs';
import { tone, noise, silence, concat, FS } from '../__tests__/synth.js';
import { writeWav } from './wav.mjs';

const dir = new URL('./data-synthetic/', import.meta.url).pathname;
fs.mkdirSync(dir, { recursive: true });
const lead = (s = 7) => noise(1.0, -70, s);
const syl = (f, d = 0.12) => tone(f, d, { amp: 0.25, attack: 0.01 });
const entries = [];
function add(id, parts, level, truth, extra = {}) {
  writeWav(`${dir}${id}.wav`, concat(lead(), ...parts), FS);
  entries.push({ id, file: `data-synthetic/${id}.wav`, group: extra.group ?? 'synthetic', device: 'synthetic', profile: 'child', calibSec: 0.8, level, truth });
}
const MPT = { id: 'mpt', type: 'sustained_voicing', targetDurationSec: 3 };
[2.0, 3.5, 4.5, 6.0, 1.2, 2.8].forEach((d, i) => add(`sust_${i}`, [tone(220 + i * 15, d, { amp: 0.25 })], MPT, { passed: d >= 3, mptSec: d, f0MeanHz: 220 + i * 15 }));
const TRAIN = { id: 'train', type: 'syllable_train', syllable: 'ba', durationSec: 5, minSyllables: 5 };
[4, 5, 6, 8, 3].forEach((n, i) => {
  const parts = []; for (let k = 0; k < n; k++) parts.push(syl(260), silence(0.14 + (i % 2) * 0.05));
  add(`train_${n}`, parts, TRAIN, { passed: n >= 5, count: n });
});
const GLIDE = { id: 'glide', type: 'pitch_glide', direction: 'up', minRangeSemitones: 4 };
[3, 6, 9].forEach((st) => add(`glide_${st}`, [tone((t) => 200 * 2 ** ((st * t) / 12 / 1.5), 1.5, { amp: 0.25 })], GLIDE, { passed: st >= 4 }));
fs.writeFileSync(`${dir}../manifest-synthetic.json`, JSON.stringify(entries, null, 2));
console.log(`wrote ${entries.length} wavs + validation/manifest-synthetic.json`);
