// Minimal WAV reader/writer (PCM 8/16/24/32-bit and float32). Returns mono Float32Array in [-1, 1].
import fs from 'node:fs';

export function readWav(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${file}: not a RIFF/WAVE file`);
  let o = 12, fmt = null, data = null;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4);
    const size = b.readUInt32LE(o + 4);
    const body = o + 8;
    if (id === 'fmt ') {
      fmt = { tag: b.readUInt16LE(body), ch: b.readUInt16LE(body + 2), fs: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) };
      if (fmt.tag === 0xfffe) fmt.tag = b.readUInt16LE(body + 24); // WAVE_FORMAT_EXTENSIBLE sub-format
    } else if (id === 'data') {
      data = b.subarray(body, Math.min(body + size, b.length));
    }
    o = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error(`${file}: missing fmt or data chunk`);
  const bytes = fmt.bits / 8, n = Math.floor(data.length / (bytes * fmt.ch));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < fmt.ch; c++) {
      const p = (i * fmt.ch + c) * bytes;
      let v;
      if (fmt.tag === 3 && fmt.bits === 32) v = data.readFloatLE(p);
      else if (fmt.bits === 16) v = data.readInt16LE(p) / 32768;
      else if (fmt.bits === 24) v = data.readIntLE(p, 3) / 8388608;
      else if (fmt.bits === 32) v = data.readInt32LE(p) / 2147483648;
      else if (fmt.bits === 8) v = (data[p] - 128) / 128;
      else throw new Error(`${file}: unsupported ${fmt.bits}-bit format ${fmt.tag}`);
      s += v;
    }
    out[i] = s / fmt.ch;
  }
  return { samples: out, fs: fmt.fs, channels: fmt.ch };
}

export function writeWav(file, samples, fs_, bits = 16) {
  const n = samples.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(fs_, 24); buf.writeUInt32LE(fs_ * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(file, buf);
}
