import test from 'node:test';
import assert from 'node:assert/strict';
import { stopVoicingCue, decideConsonant } from '../recognition/voicingCue.js';

const SR = 16000;
let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 - 0.5; };

/** Synthetic CV: closure, optional pre-voicing, burst, aspiration of `asp` ms, then a voiced vowel. */
function makeStop({ preMs = 0, aspMs = 0, f0 = 130 }) {
  const parts = [];
  const noise = (ms, amp) => { const a = new Float32Array(Math.round(SR * ms / 1000)); for (let i = 0; i < a.length; i++) a[i] = rnd() * amp; return a; };
  const voiced = (ms, amp) => {
    const a = new Float32Array(Math.round(SR * ms / 1000));
    for (let i = 0; i < a.length; i++) { let v = 0; for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * f0 * h * i / SR) / h; a[i] = amp * v; }
    return a;
  };
  parts.push(noise(150, 0.0004));
  if (preMs) parts.push(voiced(preMs, 0.02));
  parts.push(noise(6, 0.5)); // release burst
  if (aspMs) parts.push(noise(aspMs, 0.08));
  parts.push(voiced(300, 0.3));
  parts.push(noise(100, 0.0004));
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

test('aspirated voiceless stop: long VOT, no pre-voicing', () => {
  const c = stopVoicingCue(makeStop({ aspMs: 55 }), SR);
  assert.equal(c.ok, true);
  assert.ok(c.votMs >= 40 && c.votMs <= 75, `vot ${c.votMs}`);
  assert.ok(c.prevoicedMs < 10);
  assert.equal(c.call, 'voiceless');
});

test('voiced stop with a voice bar: pre-voicing detected', () => {
  const c = stopVoicingCue(makeStop({ preMs: 60, aspMs: 0 }), SR);
  assert.equal(c.ok, true);
  assert.ok(c.prevoicedMs >= 30, `pre ${c.prevoicedMs}`);
  assert.equal(c.call, 'voiced');
});

test('voiced stop with immediate voicing: short VOT', () => {
  const c = stopVoicingCue(makeStop({ aspMs: 0 }), SR);
  assert.equal(c.ok, true);
  assert.ok(c.votMs <= 10, `vot ${c.votMs}`);
  assert.equal(c.call, 'voiced');
});

test('silence and noise give no cue rather than a guess', () => {
  assert.equal(stopVoicingCue(new Float32Array(8000), SR).ok, false);
  const n = new Float32Array(16000); for (let i = 0; i < n.length; i++) n[i] = rnd() * 0.1;
  assert.equal(stopVoicingCue(n, SR).ok, false);
});

const ON = { useCue: true };
const cons = (over) => ({ target: 'p', twin: 'b', place: 'ok', voicing: 'unsure', verdict: 'ambiguous', llr: 0.1, bestCompetitor: 'b', ...over });

test('p vs b: b heard is WRONG, not accepted as the same sound', () => {
  const r = decideConsonant(cons({ verdict: 'competitor_dominant', voicing: 'twin', llr: -2.2 }), { ok: false }, 'p');
  assert.equal(r.final, 'wrong');
});

test('unsure model + clear voiceless cue rescues p; clear voiced cue condemns it', () => {
  assert.deepEqual(decideConsonant(cons(), { ok: true, call: 'voiceless' }, 'p', ON), { final: 'correct', decidedBy: 'acoustic' });
  assert.deepEqual(decideConsonant(cons(), { ok: true, call: 'voiced' }, 'p', ON), { final: 'wrong', decidedBy: 'acoustic' });
  assert.equal(decideConsonant(cons(), { ok: true, call: 'unclear' }, 'p', ON).final, 'unsure');
  assert.equal(decideConsonant(cons(), { ok: false }, 'p', ON).final, 'unsure');
});

test('model and audio disagreeing is reported unsure, not forced either way', () => {
  const win = cons({ verdict: 'target_dominant', voicing: 'target', llr: 0.9 });
  assert.equal(decideConsonant(win, { ok: true, call: 'voiced' }, 'p', ON).final, 'unsure');
  assert.equal(decideConsonant({ ...win, llr: 3 }, { ok: true, call: 'voiced' }, 'p', ON).final, 'correct');
});

test('the cue is never used for non-stops', () => {
  const m = { target: 'm', verdict: 'ambiguous', llr: 0.2, place: undefined };
  assert.equal(decideConsonant(m, { ok: true, call: 'voiceless' }, 'm').final, 'unsure');
});

test('cue is off by default: a clear model result is not changed by it', () => {
  const win = cons({ verdict: 'target_dominant', voicing: 'target', llr: 1.2 });
  assert.equal(decideConsonant(win, { ok: true, call: 'voiced' }, 'p').final, 'correct');
  assert.equal(decideConsonant(cons(), { ok: true, call: 'voiceless' }, 'p').final, 'unsure');
});
