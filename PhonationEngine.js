import { PhonationAnalyzer } from './PhonationAnalyzer.js';
import { WORKLET_SOURCE } from './workletSource.js';

/**
 * Microphone I/O around PhonationAnalyzer.
 *
 * Capture is requested with echo cancellation, noise suppression and automatic
 * gain control OFF: all three alter intensity, onsets and voicing, which are
 * exactly what we measure. If the browser/device ignores that request, the
 * trial result is flagged `capture_processing` and marked `reliable: false`.
 *
 * MUST be started from a user gesture (click/tap): iOS Safari and Chrome keep
 * the AudioContext suspended otherwise.
 *
 *   const engine = new PhonationEngine({ profile: 'child', onLive: s => latest = s });
 *   await engine.start();
 *   const cal = await engine.calibrate(1500);   // child stays quiet
 *   engine.beginTrial(level);  ...  const result = engine.endTrial();
 *   engine.stop();
 *
 * `onLive` fires ~100x/s. Store the latest state and read it from
 * requestAnimationFrame rather than calling setState on every callback.
 */
export class PhonationEngine {
  /**
   * @param {{profile?: 'child'|'adult', onLive?: Function, onError?: Function, workletUrl?: string}} opts
   *        workletUrl: optional URL of phonation-worklet.js served as a real file. By default the worklet is
   *        loaded from an in-memory Blob URL (needs no bundler config; strict CSPs may need `worker-src blob:`).
   */
  constructor({ profile = 'child', onLive = null, onError = null, workletUrl = null } = {}) {
    this.workletUrl = workletUrl;
    this.profile = profile;
    this.onLive = onLive;
    this.onError = onError;
    this.analyzer = null;
    this.ctx = null;
    this.stream = null;
    this.node = null;
    this.source = null;
    this.running = false;
  }

  get live() {
    return this.analyzer ? this.analyzer.live : null;
  }

  get calibrated() {
    return !!this.analyzer && this.analyzer.calibrated;
  }

  async start() {
    if (this.running) return this.analyzer.captureInfo;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Microphone capture is not supported in this browser');
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
    const track = this.stream.getAudioTracks()[0];
    track.addEventListener('ended', () => {
      this.running = false;
      if (this.onError) this.onError(new Error('Microphone disconnected'));
    });

    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    this.analyzer = new PhonationAnalyzer({ sampleRate: this.ctx.sampleRate, profile: this.profile });
    const s = track.getSettings ? track.getSettings() : {};
    this.analyzer.setCaptureInfo({
      echoCancellation: s.echoCancellation === true,
      noiseSuppression: s.noiseSuppression === true,
      autoGainControl: s.autoGainControl === true,
      sampleRate: this.ctx.sampleRate,
      deviceLabel: track.label || null,
    });

    this.source = this.ctx.createMediaStreamSource(this.stream);
    const handle = (block) => {
      const live = this.analyzer.push(block);
      if (this.onLive) this.onLive(live);
    };

    let workletOk = false;
    if (this.ctx.audioWorklet) {
      const url = this.workletUrl || URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
      try {
        await this.ctx.audioWorklet.addModule(url);
        this.node = new AudioWorkletNode(this.ctx, 'phonation-capture', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        this.node.port.onmessage = (e) => handle(e.data);
        workletOk = true;
      } catch (e) {
        console.warn('AudioWorklet unavailable, falling back to ScriptProcessor:', e && e.message);
      } finally {
        if (!this.workletUrl) URL.revokeObjectURL(url);
      }
    }
    if (!workletOk) {
      // Fallback for old browsers / strict CSP (ScriptProcessorNode is deprecated but universal).
      this.node = this.ctx.createScriptProcessor(1024, 1, 1);
      this.node.onaudioprocess = (e) => handle(new Float32Array(e.inputBuffer.getChannelData(0)));
    }

    // The node must be pulled by the graph to run; route it to a muted gain so the
    // child never hears their own microphone.
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.source.connect(this.node);
    this.node.connect(mute);
    mute.connect(this.ctx.destination);

    this.running = true;
    return this.analyzer.captureInfo;
  }

  /** Measure room noise for `ms`. Ask the child to stay quiet meanwhile. */
  calibrate(ms = 1500) {
    this._need();
    this.analyzer.startCalibration();
    return new Promise((resolve) => setTimeout(() => resolve(this.analyzer.finishCalibration()), ms));
  }

  /**
   * @param {object} level
   * @param {{captureAudio?: boolean}} [opts] captureAudio keeps this trial's audio IN MEMORY so an
   *        on-device recognizer can run after it. Default false. Audio is never stored or sent.
   */
  beginTrial(level, opts) {
    this._need();
    return this.analyzer.beginTrial(level, opts);
  }

  endTrial() {
    this._need();
    return this.analyzer.endTrial();
  }

  /**
   * Ends a trial that was started with { captureAudio: true } and runs an on-device recognizer
   * on its audio. The acoustic result (passed / stars / metrics) is identical to endTrial();
   * recognizer output is attached as `result.recognition` and is always marked experimental.
   * Recognizer failures never fail the trial: they become `{ experimental: true, ok: false, error }`.
   * The audio buffer is dropped before this returns.
   */
  async endTrialAndRecognize(recognizer) {
    this._need();
    const { result, level, audio, sampleRate } = this.analyzer.endTrialWithAudio();
    if (!recognizer || !audio || result.quality.flags.includes('no_voicing')) return result;
    try {
      const rec = await recognizer.recognize(audio, sampleRate, { level });
      if (rec) result.recognition = rec;
    } catch (e) {
      result.recognition = { experimental: true, ok: false, recognizer: recognizer.name || 'unknown', error: String(e && e.message ? e.message : e) };
    }
    return result;
  }

  cancelTrial() {
    if (this.analyzer) this.analyzer.cancelTrial();
  }

  stop() {
    this.running = false;
    try { if (this.node) this.node.disconnect(); } catch { /* already disconnected */ }
    try { if (this.source) this.source.disconnect(); } catch { /* already disconnected */ }
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.ctx && this.ctx.state !== 'closed') this.ctx.close();
    this.node = this.source = this.stream = this.ctx = null;
  }

  _need() {
    if (!this.running) throw new Error('PhonationEngine is not running — call start() from a user gesture first');
  }
}
