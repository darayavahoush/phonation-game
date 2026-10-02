// AudioWorklet processor: batches the 128-sample render quanta into 512-sample
// blocks (~10 ms at 48 kHz) and posts them to the main thread. No analysis here.
class PhonationCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(512);
    this.fill = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let i = 0;
    while (i < ch.length) {
      const n = Math.min(ch.length - i, this.block.length - this.fill);
      this.block.set(ch.subarray(i, i + n), this.fill);
      this.fill += n;
      i += n;
      if (this.fill === this.block.length) {
        const out = this.block;
        this.port.postMessage(out, [out.buffer]);
        this.block = new Float32Array(512);
        this.fill = 0;
      }
    }
    return true;
  }
}

registerProcessor('phonation-capture', PhonationCapture);
