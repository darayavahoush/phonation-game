#!/usr/bin/env node
// Runs recorded WAV files through PhonationAnalyzer exactly as the browser would (calibrate, then one trial),
// and writes one JSON line per recording. Nothing is uploaded; audio stays on your machine.
//
//   node validation/run-engine.mjs validation/manifest.json --out validation/out/clean.jsonl
//   node validation/run-engine.mjs validation/manifest.json --snr 20 --out validation/out/snr20.jsonl
//
// manifest.json = array of entries:
//   { "id": "spk01_a", "file": "data/spk01_a.wav", "group": "control", "device": "usb-mic",
//     "profile": "adult",                       // 'child' | 'adult' (engine profile)
//     "level": { "id": "mpt", "type": "sustained_voicing", "targetDurationSec": 5 },
//     "calibSec": 0.8,                          // use the first N s of the file as the "stay quiet" calibration (0 = skip)
//     "noiseFile": "data/room.wav",             // OR a separate noise-only clip for calibration
//     "truth": { "passed": true, "count": 5, "mptSec": 6.2 } }   // whatever labels you have
import fs from 'node:fs';
import path from 'node:path';
import { PhonationAnalyzer } from '../PhonationAnalyzer.js';
import { readWav } from './wav.mjs';

const args = process.argv.slice(2);
const manifestPath = args.find((a) => !a.startsWith('--') && a.endsWith('.json'));
const opt = (name, d) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : d; };
if (!manifestPath) { console.error('usage: run-engine.mjs manifest.json [--out file.jsonl] [--snr dB] [--seed n]'); process.exit(1); }
const outPath = opt('out', 'validation/out/results.jsonl');
const snrDb = opt('snr', null) != null ? Number(opt('snr')) : null;
const seed = Number(opt('seed', 1));
const BLOCK = 512;

function rng(s) { s >>>= 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

/** RMS of the "active" part: 20 ms windows within 20 dB of the loudest window. Used only to set the mix SNR. */
function activeRms(x, fs) {
  const w = Math.max(1, Math.round(0.02 * fs)), r = [];
  for (let i = 0; i + w <= x.length; i += w) { let s = 0; for (let j = 0; j < w; j++) s += x[i + j] ** 2; r.push(s / w); }
  const mx = Math.max(...r, 1e-20), act = r.filter((v) => v > mx / 100);
  return Math.sqrt(act.reduce((a, b) => a + b, 0) / Math.max(1, act.length));
}

function addNoise(x, rms, rand) {
  const a = rms * Math.sqrt(3); // uniform noise with this RMS
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = Math.max(-1, Math.min(1, x[i] + (rand() * 2 - 1) * a));
  return y;
}

function feed(an, x) { for (let i = 0; i < x.length; i += BLOCK) an.push(x.subarray(i, Math.min(i + BLOCK, x.length))); }

function runOne(e, base) {
  const wav = readWav(path.resolve(base, e.file));
  let x = wav.samples; const fs_ = wav.fs;
  let noiseClip = null;
  if (e.noiseFile) { const nw = readWav(path.resolve(base, e.noiseFile)); if (nw.fs !== fs_) throw new Error(`${e.id}: noiseFile sample rate differs`); noiseClip = nw.samples; }
  if (snrDb != null) {
    const rand = rng(seed + e.id.length * 7919);
    const rms = activeRms(x, fs_) / 10 ** (snrDb / 20);
    x = addNoise(x, rms, rand);
    if (noiseClip) noiseClip = addNoise(noiseClip, rms, rand);
  }
  const calibSec = e.calibSec ?? (noiseClip ? 0 : 0.8);
  const an = new PhonationAnalyzer({ sampleRate: fs_, profile: e.profile ?? 'child' });
  // Offline files: we cannot know whether AGC/NS were on. Declare them off; record that this was an assumption.
  an.setCaptureInfo({ autoGainControl: false, noiseSuppression: false, echoCancellation: false });

  let calib = { ok: null, warnings: ['skipped'], source: 'none' }, trialStart = 0;
  if (noiseClip || calibSec > 0) {
    an.startCalibration();
    if (noiseClip) { feed(an, noiseClip); trialStart = 0; calib.source = 'noiseFile'; }
    else { const n = Math.round(calibSec * fs_); feed(an, x.subarray(0, n)); trialStart = n; calib.source = 'lead-in'; }
    const c = an.finishCalibration();
    calib = { ok: c.ok, warnings: c.warnings, noiseDb: c.noise?.db ?? null, transientFraction: c.transientFraction ?? null, source: calib.source };
  }
  an.beginTrial(e.level);
  feed(an, x.subarray(trialStart));
  feed(an, new Float32Array(Math.round(0.15 * fs_))); // let the last frames flush
  const result = an.endTrial();
  return { id: e.id, group: e.group ?? null, device: e.device ?? null, profile: e.profile ?? 'child', fs: fs_, snrMixDb: snrDb, calib, result };
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const base = path.dirname(path.resolve(manifestPath));
fs.mkdirSync(path.dirname(outPath), { recursive: true });
const lines = []; let failed = 0;
for (const e of manifest) {
  try { lines.push(JSON.stringify(runOne(e, base))); }
  catch (err) { failed++; console.error(`! ${e.id}: ${err.message}`); lines.push(JSON.stringify({ id: e.id, error: err.message })); }
}
fs.writeFileSync(outPath, lines.join('\n') + '\n');
const ok = lines.map((l) => JSON.parse(l)).filter((r) => r.result);
const rel = ok.filter((r) => r.result.quality.reliable).length;
console.log(`${ok.length}/${manifest.length} recordings run${snrDb != null ? ` (noise mixed at ${snrDb} dB SNR)` : ''}; ${rel} judged reliable; ${failed} failed -> ${outPath}`);
