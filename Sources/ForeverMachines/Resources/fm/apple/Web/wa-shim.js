/*
 * Forever Machines AUv3: Web Audio, played by the plugin.
 * A web view's own audio cannot reach the host, so inside the AUv3 every machine gets this AudioContext instead.
 * It keeps the Web Audio API the kit and the machines use, and sends each operation (create, connect, automate,
 * start, stop, buffers) to the plugin's native engine, which renders the same graph in the host's render block.
 * The native side answers with its clock, ended sources and analyser snapshots.
 * Injected before kit.js into each machine's frame (see au-host.js and plugin.js srcdoc()).
 */
(function () {
  'use strict';
  if (window.__fmWA) return;
  const RealOffline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  // this machine's layer in the engine (the page's locked machines play at once, each on its own layer): its node
  // and buffer ids carry it in their high bits, and its reset and run touch only it (FMEngine.hpp, kLayerBits)
  const LAYER = Math.max(0, Math.min(15, window.FM_AU_LAYER | 0));
  let nextId = LAYER * 0x100000 + 1;
  let queue = [];
  const flush = () => {
    if (!queue.length) return;
    const ops = queue; queue = [];
    parent.postMessage({ fmwa: ops }, '*');
  };
  // a silent miniature (the grid view) runs the machine without sound: nothing goes to the engine, and its clock
  // and timers run on their own
  const op = window.FM_AU_SILENT ? () => {} : (...a) => { if (!queue.length) queueMicrotask(flush); queue.push(a); };
  const nodes = new Map();   // id → node (weakly: freed nodes are reported to the engine)
  const gone = new FinalizationRegistry((id) => op('f', id));
  const goneBuf = new FinalizationRegistry((id) => op('fb', id));

  // 16-bit, base64: half the size of Float32 over the bridge, plenty for these sounds
  function pack(f32) {
    let peak = 0;
    for (let i = 0; i < f32.length; i++) { const a = Math.abs(f32[i]); if (a > peak && a === a && a !== Infinity) peak = a; }
    const scale = peak > 0 ? peak : 1;
    const i16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) { const v = f32[i] / scale; i16[i] = v !== v ? 0 : Math.max(-32767, Math.min(32767, Math.round(v * 32767))); }
    const bytes = new Uint8Array(i16.buffer);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return [btoa(s), scale];
  }

  // ── time: the engine's clock, extrapolated between its ticks ──
  let engineT = 0, engineAt = performance.now(), sampleRate = 48000, synced = false;
  const LEAD = 0.025; // 'now' is a little ahead, so immediate events land in the engine's future, sample-accurately
  const nowT = () => engineT + (performance.now() - engineAt) / 1000 + LEAD;
  let lastNow = 0, at = null;
  const currentTime = () => { const t = nowT(); if (t > lastNow) lastNow = t; return at != null && at > lastNow ? at : lastNow; };
  // a MIDI note from the host is handled 'at' its own audio time (plus a fixed delay): whatever the machine
  // schedules for 'now' while handling it lands exactly there, so played notes are tight, not jittery
  window.__fmAt = (t, fn) => { at = +t; try { fn(); } finally { at = null; } };

  // ── timers the plugin keeps running: WebKit slows timers on pages it thinks are hidden (a closed plugin
  // window, a collapsed view), and the machine's clock and steps live on timers. Here they run on a schedule
  // that real timers drive while visible and that every message from the engine (~30 a second) also drives,
  // so the music keeps time with the window closed. ──
  const realSI = window.setInterval.bind(window), realCI = window.clearInterval.bind(window);
  const realST = window.setTimeout.bind(window), realCT = window.clearTimeout.bind(window);
  const timers = new Map();
  let timerId = 1e7, running = false;
  function runDue() {
    if (running) return;
    running = true;
    const now = performance.now();
    for (const id of [...timers.keys()]) {
      const t = timers.get(id);
      if (!t || now < t.at) continue;
      if (t.every) t.at = Math.max(t.at + t.every, now + 1); else timers.delete(id);   // late intervals fire once, no burst
      try { t.fn.apply(window, t.args); } catch (e) { realST(() => { throw e; }); }
    }
    running = false;
  }
  window.setInterval = (fn, ms, ...args) => {
    if (typeof fn !== 'function') return realSI(fn, ms);
    const id = ++timerId, every = Math.max(4, +ms || 0);
    timers.set(id, { fn, args, every, at: performance.now() + every });
    return id;
  };
  window.setTimeout = (fn, ms, ...args) => {
    if (typeof fn !== 'function') return realST(fn, ms);
    const id = ++timerId;
    timers.set(id, { fn, args, every: 0, at: performance.now() + Math.max(0, +ms || 0) });
    return id;
  };
  window.clearInterval = window.clearTimeout = (id) => { if (timers.has(id)) timers.delete(id); else { realCI(id); realCT(id); } };
  realSI(runDue, 4);

  // ── analysers: snapshots arrive from the engine; frequency data is computed here ──
  const snaps = new Map();
  function fftMag(x) { // magnitude spectrum of a real signal, Hann-windowed (n = power of two)
    const n = x.length, re = new Float32Array(n), im = new Float32Array(n);
    for (let i = 0; i < n; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; } }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const ar = re[i + k], ai = im[i + k], br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ar + br; im[i + k] = ai + bi; re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
    const out = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) out[i] = Math.hypot(re[i], im[i]) / n;
    return out;
  }

  // ── parameters ──
  class Param {
    constructor(node, name, def, min = -3.4e38, max = 3.4e38) { this._node = node; this._name = name; this._v = def; this.defaultValue = def; this.minValue = min; this.maxValue = max; this.automationRate = 'a-rate'; }
    get value() { return this._v; }
    set value(v) { v = +v; if (v !== v) return; this._v = v; op('v', this._node._id, this._name, v); }
    _ev(kind, t, v, x) { v = +v; t = +t; if (v !== v || t !== t) return this; this._v = v; op('a', this._node._id, this._name, kind, t, v, x == null ? 0 : +x); return this; }
    setValueAtTime(v, t) { return this._ev(0, t, v); }
    linearRampToValueAtTime(v, t) { return this._ev(1, t, v); }
    exponentialRampToValueAtTime(v, t) { return this._ev(2, t, v); }
    setTargetAtTime(v, t, tc) { return this._ev(3, t, v, Math.max(1e-4, +tc || 1e-4)); }
    setValueCurveAtTime(curve, t, dur) { // approximated as a run of linear ramps
      const n = curve.length; if (!n) return this;
      this.setValueAtTime(curve[0], t);
      for (let i = 1; i < n; i++) this.linearRampToValueAtTime(curve[i], t + (dur * i) / (n - 1));
      return this;
    }
    cancelScheduledValues(t) { op('x', this._node._id, this._name, +t || 0); return this; }
    cancelAndHoldAtTime(t) { return this.cancelScheduledValues(t); }
  }

  // ── nodes ──
  const listeners = Symbol('l');
  class Node {
    constructor(ctx, type, extra) {
      this._id = nextId++; this.context = ctx; this.numberOfInputs = 1; this.numberOfOutputs = 1;
      this.channelCount = 2; this.channelCountMode = 'max'; this.channelInterpretation = 'speakers';
      this[listeners] = [];
      op('c', this._id, type, extra == null ? 0 : extra);
      nodes.set(this._id, new WeakRef(this));
      gone.register(this, this._id);
    }
    connect(dest, out = 0, inp = 0) {
      if (dest && dest._route) { const to = dest._route(inp | 0); if (to) op('k', this._id, to._id, 0, 0); return dest; } // a splitter's or merger's input
      if (dest instanceof Param) op('kp', this._id, dest._node._id, dest._name);
      else if (dest && dest._id) op('k', this._id, dest._id, out | 0, inp | 0);
      return dest;
    }
    disconnect(dest) {
      if (dest && dest._routes) { for (const r of dest._routes()) op('d', this._id, r._id, ''); return; }
      if (dest == null || typeof dest === 'number') op('d', this._id, 0, '');
      else if (dest instanceof Param) op('d', this._id, dest._node._id, dest._name);
      else if (dest._id) op('d', this._id, dest._id, '');
    }
    addEventListener(type, fn) { if (type === 'ended' && typeof fn === 'function') this[listeners].push(fn); }
    removeEventListener(type, fn) { this[listeners] = this[listeners].filter((f) => f !== fn); }
    _ended() { const e = { type: 'ended', target: this }; try { if (this.onended) this.onended(e); } catch (_) {} for (const f of this[listeners]) { try { f(e); } catch (_) {} } }
  }
  class Source extends Node {
    start(when = 0, offset = 0, duration) { op('st', this._id, +when || 0, +offset || 0, duration == null ? -1 : +duration); }
    stop(when = 0) { op('sp', this._id, +when || 0); }
  }
  class Oscillator extends Source {
    constructor(ctx) { super(ctx, 'osc'); this.frequency = new Param(this, 'frequency', 440, -24000, 24000); this.detune = new Param(this, 'detune', 0); this._type = 'sine'; }
    get type() { return this._type; }
    set type(t) { this._type = String(t); op('s', this._id, 'type', this._type); }
    setPeriodicWave(w) { // the engine builds band-limited tables from the coefficients
      if (!w || !w._pw) { this.type = 'sine'; return; }
      this._type = 'custom'; op('pw', this._id, w.real, w.imag, w.norm);
    }
  }
  class AudioBufferShim {
    constructor(ch, len, sr) {
      this._id = nextId++; this.numberOfChannels = Math.max(1, ch | 0); this.length = Math.max(1, len | 0); this.sampleRate = sr || sampleRate;
      this.duration = this.length / this.sampleRate; this._data = []; for (let c = 0; c < this.numberOfChannels; c++) this._data.push(new Float32Array(this.length));
      this._sent = false; goneBuf.register(this, this._id);
    }
    getChannelData(c) { return this._data[c]; }
    copyToChannel(src, c, start = 0) { this._data[c].set(src, start); this._sent = false; }
    copyFromChannel(dst, c, start = 0) { dst.set(this._data[c].subarray(start, start + dst.length)); }
    _send() { // uploaded once, the first time a node uses it
      if (this._sent) return; this._sent = true;
      if (typeof __fm !== 'undefined') { op('bf', this._id, this.numberOfChannels, this.length, this.sampleRate, this._data); return; }   // (FM Core takes the floats as they are: no packing)
      const chans = this._data.map(pack);
      op('b', this._id, this.numberOfChannels, this.length, this.sampleRate, chans.map((c) => c[0]), chans.map((c) => c[1]));
    }
  }
  class BufferSource extends Source {
    constructor(ctx) {
      super(ctx, 'buf'); this.playbackRate = new Param(this, 'playbackRate', 1); this.detune = new Param(this, 'detune', 0);
      this._buffer = null; this._loop = false; this._ls = 0; this._le = 0;
    }
    get buffer() { return this._buffer; }
    set buffer(b) { this._buffer = b; if (b && b._send) { b._send(); op('s', this._id, 'buffer', b._id); } }
    get loop() { return this._loop; } set loop(v) { this._loop = !!v; op('s', this._id, 'loop', this._loop ? 1 : 0); }
    get loopStart() { return this._ls; } set loopStart(v) { this._ls = +v || 0; op('s', this._id, 'loopStart', this._ls); }
    get loopEnd() { return this._le; } set loopEnd(v) { this._le = +v || 0; op('s', this._id, 'loopEnd', this._le); }
  }
  class Gain extends Node { constructor(ctx) { super(ctx, 'gain'); this.gain = new Param(this, 'gain', 1); } }
  class Biquad extends Node {
    constructor(ctx) {
      super(ctx, 'biquad'); this.frequency = new Param(this, 'frequency', 350, 0, 24000); this.Q = new Param(this, 'Q', 1);
      this.gain = new Param(this, 'gain', 0); this.detune = new Param(this, 'detune', 0); this._type = 'lowpass';
    }
    get type() { return this._type; } set type(t) { this._type = String(t); op('s', this._id, 'type', this._type); }
    getFrequencyResponse(f, mag, phase) { mag.fill(1); phase.fill(0); }
  }
  class Panner extends Node { constructor(ctx) { super(ctx, 'pan'); this.pan = new Param(this, 'pan', 0, -1, 1); } }
  class Delay extends Node { constructor(ctx, max) { super(ctx, 'delay', Math.max(0.01, +max || 1)); this.delayTime = new Param(this, 'delayTime', 0, 0, +max || 1); } }
  class Shaper extends Node {
    constructor(ctx) { super(ctx, 'shaper'); this._curve = null; this._os = 'none'; }
    get curve() { return this._curve; }
    set curve(c) { this._curve = c; if (c && c.length) { const [b64, s] = pack(c); op('s', this._id, 'curve', b64, s, c.length); } }
    get oversample() { return this._os; } set oversample(v) { this._os = v; }
  }
  class Compressor extends Node {
    constructor(ctx) {
      super(ctx, 'comp');
      this.threshold = new Param(this, 'threshold', -24); this.knee = new Param(this, 'knee', 30); this.ratio = new Param(this, 'ratio', 12);
      this.attack = new Param(this, 'attack', 0.003); this.release = new Param(this, 'release', 0.25); this.reduction = 0;
    }
  }
  class Convolver extends Node {
    constructor(ctx) { super(ctx, 'conv'); this._buffer = null; this._norm = true; }
    get normalize() { return this._norm; } set normalize(v) { this._norm = !!v; op('s', this._id, 'normalize', this._norm ? 1 : 0); }
    get buffer() { return this._buffer; }
    set buffer(b) { this._buffer = b; if (b && b._send) { b._send(); op('s', this._id, 'buffer', b._id); } }
  }
  class Analyser extends Node {
    constructor(ctx) {
      super(ctx, 'an'); this._fft = 2048; this.smoothingTimeConstant = 0.8; this.minDecibels = -100; this.maxDecibels = -30; this._asked = false; this._smooth = null;
    }
    get fftSize() { return this._fft; } set fftSize(v) { this._fft = Math.max(32, Math.min(32768, v | 0)); op('s', this._id, 'fftSize', this._fft); }
    get frequencyBinCount() { return this._fft / 2; }
    _snap() {
      if (!this._asked) { this._asked = true; op('aw', this._id); }
      const s = snaps.get(this._id);
      if (!s) return new Float32Array(this._fft);
      if (s.length === this._fft) return s;
      const o = new Float32Array(this._fft); o.set(s.subarray(Math.max(0, s.length - this._fft)), Math.max(0, this._fft - s.length)); return o;
    }
    getFloatTimeDomainData(a) { a.set(this._snap().subarray(0, a.length)); }
    getByteTimeDomainData(a) { const s = this._snap(); for (let i = 0; i < a.length && i < s.length; i++) a[i] = Math.max(0, Math.min(255, Math.round(128 + s[i] * 128))); }
    _spectrum() {
      const mag = fftMag(this._snap()), k = this.smoothingTimeConstant;
      if (!this._smooth || this._smooth.length !== mag.length) this._smooth = new Float32Array(mag.length);
      for (let i = 0; i < mag.length; i++) this._smooth[i] = k * this._smooth[i] + (1 - k) * mag[i];
      return this._smooth;
    }
    getFloatFrequencyData(a) { const m = this._spectrum(); for (let i = 0; i < a.length && i < m.length; i++) a[i] = 20 * Math.log10(m[i] + 1e-12); }
    getByteFrequencyData(a) {
      const m = this._spectrum(), lo = this.minDecibels, hi = this.maxDecibels;
      for (let i = 0; i < a.length && i < m.length; i++) a[i] = Math.max(0, Math.min(255, Math.round(((20 * Math.log10(m[i] + 1e-12) - lo) / (hi - lo)) * 255)));
    }
  }
  class StreamDest extends Node { constructor(ctx) { super(ctx, 'sink'); try { this.stream = new MediaStream(); } catch (_) { this.stream = null; } } }
  // what comes into the plugin (Forever Effects: the host's audio, or a machine playing as the source): the engine's input
  class Input extends Node { constructor(ctx) { super(ctx, 'in'); this.numberOfInputs = 0; } }
  class Destination extends Node { constructor(ctx) { super(ctx, 'dest'); this.maxChannelCount = 2; this.numberOfOutputs = 0; } }

  // IIRFilterNode: the engine runs it; its frequency response is computed here, from the coefficients
  class IIRFilter extends Node {
    constructor(ctx, ff, fb) {
      super(ctx, 'iir');
      this._b = Array.from(ff || [], Number); this._a = Array.from(fb || [], Number);
      if (!this._b.length || !this._a.length || !this._a[0]) throw new DOMException('IIRFilter: bad coefficients', 'NotSupportedError');
      op('iir', this._id, this._b, this._a);
    }
    getFrequencyResponse(freqs, mag, phase) {
      const sr = this.context.sampleRate;
      for (let i = 0; i < freqs.length; i++) {
        const w = (2 * Math.PI * freqs[i]) / sr;
        let nr = 0, ni = 0, dr = 0, di = 0;
        this._b.forEach((c, k) => { nr += c * Math.cos(-w * k); ni += c * Math.sin(-w * k); });
        this._a.forEach((c, k) => { dr += c * Math.cos(-w * k); di += c * Math.sin(-w * k); });
        const d = dr * dr + di * di || 1e-30, re = (nr * dr + ni * di) / d, im = (ni * dr - nr * di) / d;
        if (mag) mag[i] = Math.hypot(re, im);
        if (phase) phase[i] = Math.atan2(im, re);
      }
    }
  }
  // ChannelSplitter / ChannelMerger, made of the engine's 'pick' and 'place' nodes (the engine is stereo: channels
  // past the second are silent / dropped)
  class Splitter {
    constructor(ctx, n = 6) {
      this.context = ctx; this.numberOfInputs = 1; this.numberOfOutputs = Math.max(1, n | 0);
      this._in = new Gain(ctx);
      this._picks = Array.from({ length: this.numberOfOutputs }, (_, k) => { const p = new Node(ctx, 'pick', k); this._in.connect(p); return p; });
    }
    _route() { return this._in; }
    _routes() { return [this._in]; }
    connect(dest, out = 0, inp = 0) { const p = this._picks[out | 0]; if (p) p.connect(dest, 0, inp); return dest; }
    disconnect(dest) { for (const p of this._picks) p.disconnect(dest); }
  }
  class Merger {
    constructor(ctx, n = 6) {
      this.context = ctx; this.numberOfInputs = Math.max(1, n | 0); this.numberOfOutputs = 1;
      this._out = new Gain(ctx);
      this._places = Array.from({ length: this.numberOfInputs }, (_, k) => { const p = new Node(ctx, 'place', k); p.connect(this._out); return p; });
    }
    _route(inp) { return this._places[inp | 0] || null; }
    _routes() { return this._places; }
    connect(dest, out, inp) { return this._out.connect(dest, 0, inp); }
    disconnect(dest) { this._out.disconnect(dest); }
  }

  // ── the context ──
  class Context {
    constructor() {
      if (window.__fmCtx) op('reset', LAYER);
      window.__fmCtx = this;
      this.sampleRate = sampleRate; this.baseLatency = 0; this.outputLatency = 0; this.onstatechange = null;
      this._state = 'running'; this.listener = {};
      this.destination = new Destination(this);
    }
    get currentTime() { return currentTime(); }
    get state() { return this._state; }
    getOutputTimestamp() { return { contextTime: currentTime(), performanceTime: performance.now() }; }
    resume() { if (this._state !== 'running') { this._state = 'running'; op('run', 1, LAYER); } return Promise.resolve(); }
    suspend() { if (this._state === 'running') { this._state = 'suspended'; op('run', 0, LAYER); } return Promise.resolve(); }
    close() { this._state = 'closed'; op('reset', LAYER); return Promise.resolve(); }
    addEventListener() {} removeEventListener() {}
    __fmInput() { return this._in || (this._in = new Input(this)); }   // one per context, kept for its whole life
    createGain() { return new Gain(this); }
    createOscillator() { return new Oscillator(this); }
    createBiquadFilter() { return new Biquad(this); }
    createStereoPanner() { return new Panner(this); }
    createBufferSource() { return new BufferSource(this); }
    createBuffer(ch, len, sr) { return new AudioBufferShim(ch, len, sr); }
    createDelay(max) { return new Delay(this, max); }
    createWaveShaper() { return new Shaper(this); }
    createDynamicsCompressor() { return new Compressor(this); }
    createConvolver() { return new Convolver(this); }
    createAnalyser() { return new Analyser(this); }
    createMediaStreamDestination() { return new StreamDest(this); }
    createPeriodicWave(real, imag, opts) {
      const take = (x) => Array.from(x || [], (v) => (Number.isFinite(+v) ? +v : 0)).slice(0, 1024);
      return { _pw: true, real: take(real), imag: take(imag), norm: !(opts && opts.disableNormalization) };
    }
    createIIRFilter(ff, fb) { return new IIRFilter(this, ff, fb); }
    createChannelSplitter(n) { return new Splitter(this, n); }
    createChannelMerger(n) { return new Merger(this, n); }
    createConstantSource() { const g = new BufferSource(this); g.offset = new Param(g, 'gain', 1); return g; }
    decodeAudioData(data, ok, fail) {
      // WebKit inside the app cannot decode compressed audio, so the app does it (AVAudioFile, via au-host.js);
      // the browser's own decoder is the fallback
      const keep = data.slice(0), id = nextDecode++;
      const viaBrowser = (resolve, reject) => {
        if (!RealOffline) { reject(new Error('cannot decode audio here')); return; }
        new RealOffline(1, 1, 44100).decodeAudioData(keep, (real) => {
          const b = new AudioBufferShim(real.numberOfChannels, real.length, real.sampleRate);
          for (let c = 0; c < real.numberOfChannels; c++) b._data[c].set(real.getChannelData(c));
          resolve(b);
        }, (e) => reject(e || new Error('could not decode')));
      };
      const p = new Promise((resolve, reject) => {
        decodes.set(id, (r) => {
          if (!r || !r.pcm) { viaBrowser(resolve, reject); return; }
          const b = new AudioBufferShim(r.ch, r.len, r.sr);
          for (let c = 0; c < r.ch; c++) b._data[c].set(new Float32Array(r.pcm, c * r.len * 4, r.len));
          resolve(b);
        });
        parent.postMessage({ fmDecode: id, data }, '*', [data]);
      });
      if (ok) p.then(ok, fail || (() => {}));
      return p;
    }
  }
  // FM Core only: a reverb's impulse (noise under a (1 - t)^decay tail) made by the core, the page neither generates nor uploads its samples
  if (typeof __fm !== 'undefined') Context.prototype.createImpulse = function (seconds, decay) {
    const b = new AudioBufferShim(2, Math.floor(this.sampleRate * seconds), this.sampleRate); b._sent = true; op('imp', b._id, b.length, b.sampleRate, decay); return b;
  };
  window.AudioContext = window.webkitAudioContext = Context;
  let nextDecode = 1;
  const decodes = new Map();
  addEventListener('message', (e) => {
    const d = e.data && e.data.fmDecoded;
    if (!d || !decodes.has(d.id)) return;
    const done = decodes.get(d.id); decodes.delete(d.id); done(d);
  });

  // ── from the engine ──
  addEventListener('message', (e) => {
    const d = e.data && e.data.fmwaIn;
    if (!d) return;
    runDue();   // every message from the engine is also a tick for the machine's timers
    if (d.t != null) { // its clock: smoothed, never backwards
      if (d.sr) sampleRate = d.sr;
      const now = performance.now(), est = engineT + (now - engineAt) / 1000, diff = d.t - est;
      if (!synced || Math.abs(diff) > 0.05) { engineT = d.t; engineAt = now; synced = true; } else { engineT = est + diff * 0.1; engineAt = now; }
    }
    if (d.ended) for (const id of d.ended) { const r = nodes.get(id), n = r && r.deref(); if (n) { nodes.delete(id); n._ended(); } }
    if (d.an) for (const id in d.an) {
      const bin = atob(d.an[id]), u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      snaps.set(+id, new Float32Array(u.buffer));
    }
  });
  window.__fmWA = true;
})();
