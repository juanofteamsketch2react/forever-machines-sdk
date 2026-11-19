/*
 * Forever Machines — device kit.
 * Runs inside a sandboxed iframe. Exposes window.FM.
 * A machine file calls FM.define({ title, blurb, thoughts, build(m) }).
 * See docs/MACHINE_API.md for the contract.
 */
(function () {
  'use strict';

  const FM = (window.FM = {});
  let SPEC = null;
  let lastError = null;

  // Timers on a worker (the website only, once a machine is powered). Browsers slow the timers of a frame that is out of
  // sight (Safari does it for cross-origin frames, which every machine on the site is): a locked machine scrolled away
  // from would starve its sequencer and go quiet. A worker's timer is not slowed that way; its tick is a message.
  // Nothing changes if the worker cannot start (a blocked blob, an old browser): the native timers carry on.
  FM._timers = (() => {
    const nSet = window.setInterval.bind(window), nClear = window.clearInterval.bind(window);
    const reg = new Map(); let next = 0x40000000, w = null, failed = false, ticks = 0, installed = false;
    function fallback() {
      failed = true;
      if (w) { try { w.terminate(); } catch (_) {} w = null; }
      for (const t of reg.values()) if (t.nid == null) t.nid = nSet(t.run, t.ms);
    }
    function toWorker(id, t) { if (t.nid != null) { nClear(t.nid); t.nid = null; } w.postMessage({ id, ms: t.ms }); }
    function install() {
      if (installed) return; installed = true;
      window.setInterval = (fn, ms, ...args) => {
        if (typeof fn !== 'function') return nSet(fn, ms, ...args);
        const id = ++next, t = { ms: Math.max(4, +ms || 0), nid: null, run: () => fn(...args) };
        reg.set(id, t);
        if (w) w.postMessage({ id, ms: t.ms }); else t.nid = nSet(t.run, t.ms);
        return id;
      };
      window.clearInterval = (id) => {
        const t = reg.get(id);
        if (!t) return nClear(id);
        if (t.nid != null) nClear(t.nid);
        if (w) w.postMessage({ id, off: 1 });
        reg.delete(id);
      };
    }
    function useWorker() {
      if (w || failed || !installed) return;
      try {
        const src = 'const t=new Map();onmessage=e=>{const d=e.data;if(d.off){clearInterval(t.get(d.id));t.delete(d.id)}else{clearInterval(t.get(d.id));t.set(d.id,setInterval(()=>postMessage(d.id),d.ms))}}';
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        w = new Worker(url);
        w.onmessage = (e) => { ticks++; const t = reg.get(e.data); if (t) { try { t.run(); } catch (err) { setTimeout(() => { throw err; }, 0); } } };
        w.onerror = fallback;
        for (const [id, t] of reg) toWorker(id, t);
        setTimeout(() => { if (w && !ticks && reg.size) fallback(); }, 1500);   // (a worker that never ticks: back to the plain timers)
      } catch (_) { fallback(); }
    }
    return { install, useWorker };
  })();

  window.addEventListener('error', (e) => { lastError = e.message || String(e.error); });

  FM.define = function (spec) { SPEC = spec; };
  // an effect inserted on a machine (the site's Mixer): its file runs in the machine's own frame after the machine's,
  // so FM.define is called twice; the machine's spec is kept aside and the effect's is read from FM._fxSpec
  let stashed = null;
  FM._stash = () => { stashed = SPEC; };
  FM._unstash = () => { FM._fxSpec = SPEC; SPEC = stashed; };

  // ── music ──────────────────────────────────────────────────────────────
  FM.scales = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    pentatonic: [0, 2, 4, 7, 9],
    minpent: [0, 3, 5, 7, 10],
    hirajoshi: [0, 2, 3, 7, 8],
    pelog: [0, 1, 3, 7, 8],
    wholetone: [0, 2, 4, 6, 8, 10],
    harmonic: [0, 2, 3, 5, 7, 8, 11],
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  };
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  FM.mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);
  FM.ftom = (f) => 69 + 12 * Math.log2(f / 440);
  FM.noteName = (n) => NOTE_NAMES[((Math.round(n) % 12) + 12) % 12] + (Math.floor(Math.round(n) / 12) - 1);
  FM.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  FM.lerp = (a, b, t) => a + (b - a) * t;

  FM.fmt = {
    pct: (v) => Math.round(v * 100) + ' %',
    hz: (v) => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 1 : 2) + ' kHz' : (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + ' Hz'),
    ms: (v) => (v >= 1 ? v.toFixed(2) + ' s' : Math.round(v * 1000) + ' ms'),
    db: (v) => v.toFixed(1) + ' dB',
    st: (v) => (v > 0 ? '+' : '') + Math.round(v) + ' st',
    bpm: (v) => v.toFixed(0) + ' bpm',
    int: (v) => String(Math.round(v)),
    note: (v) => FM.noteName(v),
  };

  // colour helpers (theme colours are CSS strings)
  FM.rgb = function (c) {
    c = String(c).trim();
    if (c[0] === '#') {
      let h = c.slice(1);
      if (h.length === 3) h = h.split('').map((x) => x + x).join('');
      const n = parseInt(h.slice(0, 6), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const m = c.match(/[\d.]+/g);
    return m ? [+m[0], +m[1], +m[2]] : [0, 0, 0];
  };
  FM.mix = function (a, b, t) {
    const A = FM.rgb(a), B = FM.rgb(b);
    return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`;
  };
  FM.alpha = function (c, a) {
    const A = FM.rgb(c);
    return `rgba(${A[0]},${A[1]},${A[2]},${a})`;
  };

  // ── randomness ─────────────────────────────────────────────────────────
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash32(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  FM.hash = hash32;

  // ── DOM helpers ────────────────────────────────────────────────────────
  function el(tag, cls, parent, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  const SVGNS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function arcPath(cx, cy, r, a0, a1) {
    const p = (a) => { const t = ((a - 90) * Math.PI) / 180; return [cx + r * Math.cos(t), cy + r * Math.sin(t)]; };
    if (Math.abs(a1 - a0) < 0.01) return '';
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
    const sweep = a1 > a0 ? 1 : 0;
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }
  function defaultFmt(v, o) {
    const u = o.unit || '';
    if (o.step >= 1) return Math.round(v) + u;
    const a = Math.abs(v);
    return (a < 10 ? v.toFixed(2) : a < 100 ? v.toFixed(1) : v.toFixed(0)) + u;
  }

  // ── machine ────────────────────────────────────────────────────────────
  function createMachine(cfg, root) {
    const m = {};
    const errors = [];

    m.seed = cfg.seed >>> 0;
    m.index = cfg.index;
    m.name = cfg.name;
    m.original = !!cfg.original;
    m.theme = cfg.theme ? cfg.theme.name : 'live';

    // randomness: machine stream + kit stream so kit choices don't shift machine's
    const r = mulberry32(m.seed);
    const kr = mulberry32(m.seed ^ 0x9e3779b9);
    m.rand = r;
    m.range = (a, b) => a + (b - a) * r();
    m.int = (a, b) => Math.floor(a + (b - a + 1) * r());
    m.pick = (arr) => arr[Math.floor(r() * arr.length)];
    m.chance = (p) => r() < p;
    m.shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    m.rng = (salt) => mulberry32(m.seed ^ hash32(String(salt)));

    // tuning
    const musical = ['minor', 'dorian', 'minpent', 'pentatonic', 'lydian', 'hirajoshi', 'major', 'phrygian', 'mixolydian', 'pelog'];
    m.root = 45 + Math.floor(kr() * 12);
    m.scale = musical[Math.floor(kr() * musical.length)];
    m.scaleNames = Object.keys(FM.scales);
    // Master key (set by the page): every machine plays in the same key and scale. Each keeps its own
    // register: the root moves to the nearest note of the master pitch class.
    let keyLock = null, keySaved = null;
    const nearestPc = (midi, pc) => midi + ((((pc - midi) % 12) + 18) % 12) - 6;
    m.setScale = (n) => {
      if (!FM.scales[n]) return;
      if (keyLock && n !== keyLock.scale) return; // locked to the master scale
      m.scale = n;
    };
    m.setRoot = (n) => {
      n = Math.round(n);
      m.root = keyLock ? nearestPc(n, keyLock.pc) : n;
    };
    m.midi = (deg, oct) => {
      const s = FM.scales[m.scale] || FM.scales.minor;
      const n = s.length;
      const d = Math.round(deg);
      const o = Math.floor(d / n);
      const i = ((d % n) + n) % n;
      return m.root + 12 * (o + (oct || 0)) + s[i];
    };
    m.freq = (deg, oct) => FM.mtof(m.midi(deg, oct));
    // numbers into notes, in the machine's key: v in 0…1 → one of `span` scale steps upwards from the root (oct shifts it);
    // m.toNotes(1618033) or m.toNotes('2026-10-31') → one note per digit (0 is the root, 9 the ninth step)
    m.toNote = (v, span, oct) => m.midi(Math.floor(FM.clamp(fin(v, 0), 0, 0.9999) * Math.max(1, fin(span, 14))), oct);
    m.toNotes = (x, oct) => String(x).replace(/[^0-9]/g, '').slice(0, 256).split('').map((d) => m.midi(+d, oct));
    m.quantize = (midi) => {
      const s = FM.scales[m.scale] || FM.scales.minor;
      let best = midi, bd = 99;
      const base = Math.floor((midi - m.root) / 12) * 12 + m.root;
      for (let o = -12; o <= 12; o += 12) for (const x of s) { const c = base + o + x; const d = Math.abs(c - midi); if (d < bd) { bd = d; best = c; } }
      return best;
    };

    // colours
    const colorCache = {};
    m.color = (name) => {
      if (!(name in colorCache)) colorCache[name] = getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim() || '#888';
      return colorCache[name];
    };

    // ── audio graph ──
    const AC = window.AudioContext || window.webkitAudioContext;
    // phones and tablets crackle with small buffers; give them the larger, steadier ones
    const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || (window.matchMedia && matchMedia('(pointer: coarse)').matches);
    // the Steam Deck (plugin.js marks its frames): Chromium's 'interactive' is a buffer of about 10 ms on Linux, and a
    // busy moment (a drag, Steam's overlay) emptied it: the sound stuck for an instant. 40 ms is still quick to play.
    const deck = document.documentElement.classList.contains('fm-deck');
    const ac = new AC({ latencyHint: deck ? 0.04 : mobile ? 'playback' : 'interactive' });
    const master = ac.createGain(); master.gain.value = 0;
    const fin0 = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);
    const out = ac.createGain();
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -12; comp.knee.value = 8; comp.ratio.value = 8; comp.attack.value = 0.004; comp.release.value = 0.2;
    const analyser = ac.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.6;

    function impulse(seconds, decay) {
      const len = Math.floor(ac.sampleRate * seconds);
      const b = ac.createBuffer(2, len, ac.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = b.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
      return b;
    }
    const verb = ac.createConvolver(); verb.buffer = ac.createImpulse ? ac.createImpulse(3.4, 2.4) : impulse(3.4, 2.4);   // (FM Core makes the impulse itself)
    const verbIn = ac.createGain();
    const verbOut = ac.createGain(); verbOut.gain.value = 0.7;
    // (an effect pays for the kit's reverb and echo only if it uses them: m.verb / m.echo connect them on first use)
    const lazyFX = !!(SPEC && SPEC.kind === 'effect');
    verbIn.connect(verb); verb.connect(verbOut); if (!lazyFX) verbOut.connect(master);
    // idle (Android: this window is not the one in front, so the app gets about half the CPU): the reverb is about half of a machine's
    // audio cost, and Chromium's convolver costs the same however short its tail is. So it is switched off for as long as that lasts
    // (the machine sounds drier) and back on with the app.
    const VERB_OUT = 0.7; let verbSwap = 0, verbOff = false, verbWant = false;
    function verbIdle(on) {
      clearTimeout(verbSwap); verbWant = on;
      if (!on) {   // the app is back: reconnect at once and fade in
        if (verbOff) { try { verbIn.connect(verb); } catch (_) {} verbOff = false; }
        const t = ac.currentTime; verbOut.gain.cancelScheduledValues(t); verbOut.gain.setTargetAtTime(VERB_OUT, t, 0.05);
        return;
      }
      if (verbOff) return;
      verbSwap = setTimeout(() => {   // (the shade pulled down and let go again changes nothing)
        const t = ac.currentTime; verbOut.gain.cancelScheduledValues(t); verbOut.gain.setTargetAtTime(0, t, 0.015);
        setTimeout(() => { if (verbWant && !verbOff) { try { verbIn.disconnect(verb); } catch (_) {} verbOff = true; } }, 90);   // faded out, then no input: it stops processing
      }, 2500);
    }
    const echoIn = ac.createGain();
    const delay = ac.createDelay(4); delay.delayTime.value = 0.375;
    const fb = ac.createGain(); fb.gain.value = 0.42;
    const elp = ac.createBiquadFilter(); elp.type = 'lowpass'; elp.frequency.value = 2800;
    echoIn.connect(delay); delay.connect(elp); elp.connect(fb); fb.connect(delay);
    if (!lazyFX) elp.connect(master);
    const echoToVerb = ac.createGain(); echoToVerb.gain.value = 0.25; elp.connect(echoToVerb); echoToVerb.connect(verbIn);

    out.connect(master);
    // Auto level: every machine is trimmed toward the same loudness, so the
    // collection sounds balanced whatever a machine's own gain staging is.
    const trim = ac.createGain();
    const pre = ac.createAnalyser(); pre.fftSize = 2048;
    // channel strip controlled by the page's mixer: pan + fader after everything else
    const chPan = ac.createStereoPanner();
    const fader = ac.createGain();
    const mix0 = cfg.mix || {};
    const num = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);
    fader.gain.value = FM.clamp(num(mix0.gain, 1), 0, 4);
    chPan.pan.value = FM.clamp(num(mix0.pan, 0), -1, 1);
    // the app's wind-down: darker and quieter as the ending plays. The auto level measures the
    // machine itself (pre, straight from master), so it neither sees the darkening nor undoes the fade; the meters do
    const windLP = ac.createBiquadFilter(); windLP.type = 'lowpass'; windLP.frequency.value = 20000; windLP.Q.value = 0.5;
    const windG = ac.createGain();
    // ── an effect (FM.define({ kind: 'effect', … }), Forever Effects): sound comes in at m.input, the effect sends what it
    // makes of it to m.out, and the kit mixes that (wet) with what came in (dry): its own Mix and Level knobs, made
    // after the effect's own controls. Power off is bypass: all dry. No auto level, no compressor: an effect gives
    // back what it is given. ──
    const FX = !!(SPEC && SPEC.kind === 'effect');
    const fxIn = ac.createGain(), fxDry = ac.createGain(), fxWet = ac.createGain(), fxSum = ac.createGain(), fxLevel = ac.createGain();
    const inAnalyser = ac.createAnalyser(); inAnalyser.fftSize = 512; inAnalyser.smoothingTimeConstant = 0.5;
    let fxMix = FM.clamp(fin0(SPEC && SPEC.mix, 1), 0, 1);
    const fxApply = (tc) => {
      const now = ac.currentTime, on = powered;
      fxWet.gain.setTargetAtTime(on ? fxMix : 0, now, tc || 0.03);
      fxDry.gain.setTargetAtTime(on ? 1 - fxMix : 1, now, tc || 0.03);
    };
    m._fxReapply = () => { if (FX) fxApply(0.02); };   // (the native engine can drop what is scheduled while a layer is still being built: boot says it again)
    if (FX) {
      fxDry.gain.value = 1; fxWet.gain.value = 0;
      if (typeof ac.__fmInput === 'function') ac.__fmInput().connect(fxIn);   // the app and the AUv3: the engine's input
      fxIn.connect(inAnalyser);
      fxIn.connect(fxDry); fxDry.connect(fxSum);
      master.connect(fxWet); fxWet.connect(fxSum);
      fxSum.connect(fxLevel); fxLevel.connect(analyser);
      m.input = fxIn;
      m.inAnalyser = inAnalyser;
    } else {
    master.connect(windLP); windLP.connect(trim); trim.connect(comp); comp.connect(windG); windG.connect(analyser);
    }
    // output protection: a brickwall-ish limiter, then a gentle soft clipper, so no machine
    // ever hits the digital ceiling however hard it is pushed or however many are summed
    const limiter = ac.createDynamicsCompressor();
    limiter.threshold.value = -8; limiter.knee.value = 0; limiter.ratio.value = 20;
    limiter.attack.value = 0.001; limiter.release.value = 0.12;
    const soft = ac.createWaveShaper();
    soft.curve = (() => { const n = 2048, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(1.4 * x) / Math.tanh(1.4) * 0.66; } return c; })();
    soft.oversample = '2x';
    if (FX) {
      analyser.connect(chPan); chPan.connect(fader);
      // the app and the plugin end in the engine's own limiter (FMMaster.hpp); a browser gets one here, just under 0 dBFS
      if (typeof ac.__fmInput === 'function') fader.connect(ac.destination);
      else { const lim = ac.createDynamicsCompressor(); lim.threshold.value = -1.5; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.1; fader.connect(lim); lim.connect(ac.destination); }
    }
    else { analyser.connect(chPan); chPan.connect(fader); fader.connect(limiter); limiter.connect(soft); soft.connect(ac.destination); }
    m._tail = FX ? fader : soft; // for local measurement tools
    if (!FX) master.connect(pre);
    const LEVEL_TARGET = 0.11;  // ≈ -19 dBFS RMS, measured only while sound is present
    const preBuf = new Float32Array(pre.fftSize);
    let loud = 0, trimVal = 1, agcAge = 0;
    const agcOn = cfg.agc !== false && !FX;
    setInterval(() => {
      if (!m.on) return;
      pre.getFloatTimeDomainData(preBuf);
      let ms = 0;
      for (let i = 0; i < preBuf.length; i += 2) ms += preBuf[i] * preBuf[i];
      ms /= preBuf.length / 2;
      if (ms < 2e-6) return;                       // gate: ignore silence between notes
      agcAge++;
      const k = agcAge < 40 ? 0.15 : 0.03;         // settle quickly at first, then drift slowly
      loud = loud ? loud + (ms - loud) * k : ms;
      if (!agcOn) return;
      const want = FM.clamp(LEVEL_TARGET / Math.sqrt(loud), 0.25, 6);
      trimVal += (want - trimVal) * (agcAge < 40 ? 0.12 : 0.02);
      trim.gain.setTargetAtTime(trimVal, ac.currentTime, 0.25);
    }, 50);
    m._level = () => ({ rms: Math.sqrt(loud), trim: trimVal });

    m.ac = ac;
    m.out = out;
    if (lazyFX) {
      let vOn = false, eOn = false;
      Object.defineProperty(m, 'verb', { get() { if (!vOn) { vOn = true; verbOut.connect(master); } return verbIn; }, enumerable: true });
      Object.defineProperty(m, 'echo', { get() { if (!eOn) { eOn = true; elp.connect(master); } return echoIn; }, enumerable: true });
    } else {
    m.verb = verbIn;
    m.echo = echoIn;
    }
    m.analyser = analyser;
    m.now = () => ac.currentTime;
    m.setEcho = (time, feedback) => {
      if (time != null && isFinite(time)) delay.delayTime.setTargetAtTime(FM.clamp(time, 0.01, 3.9), ac.currentTime, 0.05);
      if (feedback != null && isFinite(feedback)) fb.gain.setTargetAtTime(FM.clamp(feedback, 0, 0.95), ac.currentTime, 0.05);
    };

    const T = (t) => (t == null || !isFinite(t) ? ac.currentTime : Math.max(t, ac.currentTime));
    function route(node, o, endTime) {
      let tail = node;
      if (o.pan) {
        const p = ac.createStereoPanner(); p.pan.value = FM.clamp(o.pan, -1, 1);
        tail.connect(p); tail = p;
      }
      tail.connect(o.dest || out);
      const extras = [];
      if (o.send > 0) { const s = ac.createGain(); s.gain.value = o.send; tail.connect(s); s.connect(verbIn); extras.push(s); }
      if (o.echo > 0) { const s = ac.createGain(); s.gain.value = o.echo; tail.connect(s); s.connect(echoIn); extras.push(s); }
      return () => { try { tail.disconnect(); node.disconnect(); extras.forEach((x) => x.disconnect()); } catch (e) {} };
    }
    const fin = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);

    // the voice the machine plays right now (its last melodic tone or pluck, with all its settings), so notes
    // from a keyboard sound like this machine, not like a generic one; drums and pitch drops don't count
    let lastVoice = null, playingNote = false;
    function heard(kind, o) {
      if (playingNote || !o) return;
      const f = fin(o.freq, kind === 'pluck' ? 220 : 440);
      if (f < 45 || o.glide || fin(o.d, 1) < 0.06) return;
      lastVoice = { kind, o: Object.assign({}, o), f };
    }
    // the wind-down (m.wind, 0 → 1): more and more of the machine's notes are left out, so the music thins as it ends.
    // Notes you play yourself never are; a drum is one note (its parts are not thinned apart)
    let windV = 0, inner = 0;
    const thin = () => windV > 0.04 && !playingNote && !inner && Math.random() < 0.92 * Math.pow(windV, 1.3);
    m.tone = (o = {}) => {
      if (!m.on || thin()) return;
      heard('tone', o);
      const t = T(o.t);
      const a = Math.max(0.001, fin(o.a, 0.005)), h = Math.max(0, fin(o.hold, 0)), d = Math.max(0.01, fin(o.d, 0.4));
      const g = FM.clamp(fin(o.gain, 0.2), 0, 1);
      const f = FM.clamp(fin(o.freq, 440), 1, 20000);
      const osc = ac.createOscillator();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(f, t);
      if (o.detune) osc.detune.value = fin(o.detune, 0);
      if (o.glide) osc.frequency.exponentialRampToValueAtTime(FM.clamp(fin(o.glide, f), 1, 20000), t + fin(o.glideTime, a + h + d));
      const env = ac.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(g, t + a);
      if (h) env.gain.setValueAtTime(g, t + a + h);
      env.gain.setTargetAtTime(0, t + a + h, d / 4);
      let node = osc;
      const end = t + a + h + d * 1.3 + 0.03; // the tail below about −45 dB is not heard: the voice ends there, freeing its nodes
      env.gain.setTargetAtTime(0, end - 0.03, 0.006); // (a short fade, never a click)
      let mod;
      if (o.fm) {
        mod = ac.createOscillator();
        mod.frequency.value = f * fin(o.fm.ratio, 2);
        const mg = ac.createGain();
        const idx = f * fin(o.fm.index, 1);
        mg.gain.setValueAtTime(idx, t);
        mg.gain.setTargetAtTime(idx * fin(o.fm.sustain, 0.1), t + a, fin(o.fm.d, d) / 3);
        mod.connect(mg); mg.connect(osc.frequency);
        mod.start(t); mod.stop(end);
      }
      if (o.cutoff) {
        const fl = ac.createBiquadFilter();
        fl.type = o.filter || 'lowpass';
        fl.frequency.value = FM.clamp(fin(o.cutoff, 2000), 20, 20000);
        fl.Q.value = fin(o.q, 0.8);
        osc.connect(fl); node = fl;
      }
      node.connect(env);
      const cleanup = route(env, o);
      osc.start(t); osc.stop(end);
      osc.onended = cleanup;
    };

    // Karplus–Strong plucks rendered into cached buffers
    const ksCache = new Map();
    function ksBuffer(freq, bright) {
      const key = Math.round(freq * 4) + ':' + Math.round(bright * 10);
      if (ksCache.has(key)) return ksCache.get(key);
      const sr = ac.sampleRate;
      const len = Math.floor(sr * 3);
      const N = Math.max(2, Math.round(sr / freq));
      const ring = new Float32Array(N);
      const alpha = 0.08 + 0.9 * FM.clamp(bright, 0, 1);
      let prev = 0, peak = 0;
      for (let i = 0; i < N; i++) { prev += alpha * (Math.random() * 2 - 1 - prev); ring[i] = prev; peak = Math.max(peak, Math.abs(prev)); }
      for (let i = 0; i < N; i++) ring[i] /= peak || 1;
      const buf = ac.createBuffer(1, len, sr);
      const data = buf.getChannelData(0);
      const rho = 0.9985;
      let idx = 0;
      for (let i = 0; i < len; i++) {
        const j = idx, k = idx + 1 === N ? 0 : idx + 1;
        data[i] = ring[j];
        ring[j] = rho * 0.5 * (ring[j] + ring[k]);
        idx = k;
      }
      ksCache.set(key, buf);
      if (ksCache.size > 120) ksCache.delete(ksCache.keys().next().value);
      return buf;
    }
    m.pluck = (o = {}) => {
      if (!m.on || thin()) return;
      heard('pluck', o);
      const t = T(o.t);
      const d = FM.clamp(fin(o.d, 2), 0.05, 3);
      const src = ac.createBufferSource();
      src.buffer = ksBuffer(FM.clamp(fin(o.freq, 220), 20, 8000), fin(o.bright, 0.5));
      const env = ac.createGain();
      const g = FM.clamp(fin(o.gain, 0.35), 0, 1);
      env.gain.setValueAtTime(g, t);
      env.gain.setTargetAtTime(0, t + d * 0.6, d * 0.12);
      src.connect(env);
      const cleanup = route(env, o);
      src.start(t); src.stop(t + d + 0.05);
      src.onended = cleanup;
    };

    const noiseBuf = (() => {
      const len = ac.sampleRate * 2;
      const b = ac.createBuffer(1, len, ac.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return b;
    })();
    m.noiseBuffer = noiseBuf;
    m.noise = (o = {}) => {
      if (!m.on || thin()) return;
      const t = T(o.t);
      const a = Math.max(0.001, fin(o.a, 0.002)), h = Math.max(0, fin(o.hold, 0)), d = Math.max(0.005, fin(o.d, 0.2));
      const g = FM.clamp(fin(o.gain, 0.25), 0, 1);
      const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const fl = ac.createBiquadFilter();
      fl.type = o.filter || 'bandpass';
      const f = FM.clamp(fin(o.freq, 1200), 20, 20000);
      fl.frequency.setValueAtTime(f, t);
      if (o.glide) fl.frequency.exponentialRampToValueAtTime(FM.clamp(fin(o.glide, f), 20, 20000), t + a + h + d);
      fl.Q.value = fin(o.q, 1);
      const env = ac.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(g, t + a);
      if (h) env.gain.setValueAtTime(g, t + a + h);
      env.gain.setTargetAtTime(0, t + a + h, d / 4);
      src.connect(fl); fl.connect(env);
      const cleanup = route(env, o);
      const end = t + a + h + d * 1.3 + 0.03;
      env.gain.setTargetAtTime(0, end - 0.03, 0.006);
      src.start(t, Math.random() * 1.5); src.stop(end);
      src.onended = cleanup;
    };

    // ── computer voices (No. 018 Unclosed Windows): one-shots like m.tone ──
    const deskShot = (kind, o, make) => {
      if (!m.on || thin()) return;
      heard(kind, o);
      const t = T(o.t), f = FM.clamp(fin(o.freq, 440), 20, 8000), g = FM.clamp(fin(o.gain, 0.12), 0, 0.6), d = FM.clamp(fin(o.d, 0.3), 0.02, 4);
      const e = ac.createGain(); e.gain.value = 0;
      const { srcs, end } = make(t, f, g, d, e);
      const cleanup = route(e, o);
      srcs.forEach((x) => { x.start(t); x.stop(end); });
      srcs[0].onended = cleanup;
    };
    m.beep = (o = {}) => deskShot('beep', o, (t, f, g, d, e) => {   // a PC speaker: a square, gated, never faded
      const s = ac.createOscillator(); s.type = 'square'; s.frequency.value = f;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(9000, f * 6);
      const hold = Math.max(0.03, d * 0.55);
      e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(g * 0.6, t + 0.002);
      e.gain.setValueAtTime(g * 0.6, t + hold); e.gain.linearRampToValueAtTime(0, t + hold + 0.012);
      s.connect(lp); lp.connect(e);
      return { srcs: [s], end: t + hold + 0.05 };
    });
    m.modem = (o = {}) => deskShot('modem', o, (t, f, g, d, e) => {   // a chirp up an octave into the note, ring-modulated at 1.5×
      const car = ac.createOscillator(); car.type = 'triangle';
      car.frequency.setValueAtTime(f * 0.5, t); car.frequency.exponentialRampToValueAtTime(f, t + 0.03);
      const mod = ac.createOscillator(); mod.frequency.value = f * fin(o.ratio, 1.5);
      const ring = ac.createGain(); ring.gain.value = 0; mod.connect(ring.gain);
      const dry = ac.createGain(); dry.gain.value = FM.clamp(fin(o.dry, 0.4), 0, 1);
      car.connect(ring); car.connect(dry); ring.connect(e); dry.connect(e);
      e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(g * 1.3 + 0.0002, t + 0.006); e.gain.exponentialRampToValueAtTime(0.0001, t + d);
      return { srcs: [car, mod], end: t + d + 0.05 };
    });
    m.buzz = (o = {}) => deskShot('buzz', o, (t, f, g, d, e) => {   // two saws a few cents apart, squeezed through a bandpass
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = Math.min(8000, f * 2.2); bp.Q.value = fin(o.q, 2.5);
      const c = fin(o.cents, 9);
      const os = [-c, c].map((x) => { const s = ac.createOscillator(); s.type = 'sawtooth'; s.frequency.value = f; s.detune.value = x; s.connect(bp); return s; });
      bp.connect(e);
      e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(g + 0.0002, t + 0.01); e.gain.exponentialRampToValueAtTime(0.0001, t + d * 1.2);
      return { srcs: os, end: t + d * 1.2 + 0.05 };
    });

    // any outline (one period of heights, -1…1) as a timbre: its first harmonics (No. 016 Karaoke Pothos)
    m.shapeWave = (ys, harmonics = 12) => {
      const N = Math.min(4096, (ys && ys.length) | 0), H = FM.clamp(fin(harmonics, 12) | 0, 1, 64);
      const real = new Float32Array(H + 1), imag = new Float32Array(H + 1);
      for (let k = 1; k <= H && N > 1; k++) {
        let a = 0, b = 0;
        for (let n = 0; n < N; n++) { const y = fin(ys[n], 0), ph = (2 * Math.PI * k * n) / N; a += y * Math.cos(ph); b += y * Math.sin(ph); }
        real[k] = (2 * a) / N; imag[k] = (2 * b) / N;
      }
      imag[1] += 0.15;   // never a wave without a fundamental
      return ac.createPeriodicWave(real, imag);
    };

    // a held singing voice whose vowel slides oo → oh → ah → eh → ee (No. 015 Barbershop Tag). Silent until level() > 0.
    const VOWELS = [[300, 870, 2240], [450, 800, 2830], [730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010]];
    const FORM_Q = [8, 10, 13], FORM_G = [1, 0.5, 0.28];
    let foldCurve = null;
    const foldOf = () => foldCurve || (foldCurve = (() => { const n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.sin(x * Math.PI * 1.6) * 0.85; } return c; })());
    const LINEAR = new Float32Array([-1, 1]);
    m.singer = (o = {}) => {
      const osc = ac.createOscillator(); osc.type = o.wave || 'sawtooth'; osc.frequency.value = FM.clamp(fin(o.freq, 110), 30, 4000);
      const lfo = ac.createOscillator(); lfo.frequency.value = 5;
      const vib = ac.createGain(); vib.gain.value = 0; lfo.connect(vib); vib.connect(osc.frequency);
      const shaper = ac.createWaveShaper(); shaper.curve = o.fold ? foldOf() : LINEAR;
      const nz = ac.createBufferSource(); nz.buffer = noiseBuf; nz.loop = true;
      const breath = ac.createGain(); breath.gain.value = 0;
      const pre = ac.createGain();
      osc.connect(shaper); shaper.connect(pre); nz.connect(breath); breath.connect(pre);
      const sum = ac.createGain(); sum.gain.value = 2.6;
      const bands = FORM_Q.map((q, k) => {
        const b = ac.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = VOWELS[2][k]; b.Q.value = q;
        const gn = ac.createGain(); gn.gain.value = FORM_G[k];
        pre.connect(b); b.connect(gn); gn.connect(sum);
        return { b, gn };
      });
      const direct = ac.createGain(); direct.gain.value = 0; pre.connect(direct); direct.connect(sum);
      const amp = ac.createGain(); amp.gain.value = 0;
      const ring = ac.createGain(); ring.gain.value = 1;
      const ringOsc = ac.createOscillator(); ringOsc.frequency.value = 60;
      const ringDepth = ac.createGain(); ringDepth.gain.value = 0; ringOsc.connect(ringDepth); ringDepth.connect(ring.gain);
      const pan = ac.createStereoPanner();
      const send = ac.createGain(); send.gain.value = FM.clamp(fin(o.send, 0.3), 0, 1);
      sum.connect(amp); amp.connect(ring); ring.connect(pan); pan.connect(o.dest || out); pan.connect(send); send.connect(verbIn);
      osc.start(); lfo.start(); nz.start(0, Math.random() * 1.5); ringOsc.start();
      const last = {};
      const set = (key, param, v, tc) => {
        if (!isFinite(v)) return;
        const p = last[key];
        if (p !== undefined && Math.abs(p - v) <= Math.abs(v) * 0.0015 + 1e-5) return;
        last[key] = v; param.setTargetAtTime(v, ac.currentTime, Math.max(0.004, tc));
      };
      let wave = osc.type, folded = !!o.fold, stopped = false;
      const v = {
        pitch(f, glide = 0.05) { set('f', osc.frequency, FM.clamp(f, 30, 4000), fin(glide, 0.05) / 3); return v; },
        // x 0…1 (oo, oh, ah, eh, ee); scale moves every formant (1.3 a child, 0.9 a bass); formant/direct: how much is sung, how much is the bare source
        vowel(x, scale = 1, formant = 1, directGain = 0) {
          const p = FM.clamp(fin(x, 0.5), 0, 1) * 4, i = Math.min(3, Math.floor(p)), t = p - i, sc = fin(scale, 1);
          for (let k = 0; k < 3; k++) {
            set('b' + k, bands[k].b.frequency, FM.clamp((VOWELS[i][k] + (VOWELS[i + 1][k] - VOWELS[i][k]) * t) * sc, 80, 9000), 0.04);
            set('g' + k, bands[k].gn.gain, FORM_G[k] * fin(formant, 1), 0.05);
          }
          set('d', direct.gain, fin(directGain, 0), 0.05); return v;
        },
        level(x, tc = 0.05) { set('a', amp.gain, FM.clamp(fin(x, 0), 0, 0.6), fin(tc, 0.05)); return v; },
        vibrato(depthHz, rate = 5) { set('vd', vib.gain, FM.clamp(fin(depthHz, 0), 0, 60), 0.12); set('vr', lfo.frequency, FM.clamp(fin(rate, 5), 0.5, 9), 0.3); return v; },
        breath(x) { set('br', breath.gain, FM.clamp(fin(x, 0), 0, 0.5), 0.1); return v; },
        ring(depth, hz = 60) { const d = FM.clamp(fin(depth, 0), 0, 1); set('rd', ringDepth.gain, d, 0.05); set('rb', ring.gain, 1 - d, 0.05); set('rf', ringOsc.frequency, FM.clamp(fin(hz, 60), 5, 400), 0.1); return v; },
        wave(type, fold) {
          if (type && type !== wave) { wave = type; osc.type = type; }
          if (fold != null && !!fold !== folded) { folded = !!fold; shaper.curve = folded ? foldOf() : LINEAR; }
          return v;
        },
        pan(p) { set('p', pan.pan, FM.clamp(fin(p, 0), -1, 1), 0.1); return v; },
        send(x) { set('s', send.gain, FM.clamp(fin(x, 0), 0, 1), 0.1); return v; },
        stop() { if (stopped) return; stopped = true; amp.gain.setTargetAtTime(0, ac.currentTime, 0.03); const at = ac.currentTime + 0.2; for (const s of [osc, lfo, nz, ringOsc]) s.stop(at); osc.onended = () => { try { pan.disconnect(); send.disconnect(); } catch (_) {} }; },
      };
      v.vowel(fin(o.vowel, 0.5), fin(o.scale, 1)).vibrato(fin(o.vibrato, 0)).breath(fin(o.breath, 0.04)).pan(fin(o.pan, 0));
      return v;
    };

    // a gliding mono voice: ring-modulated at a ratio of its pitch, wavefolded, filtered (No. 017 Ring Carriage).
    // Every pitch change glides, like a printer carriage travelling.
    m.carriage = (o = {}) => {
      const a = ac.createOscillator(), b = ac.createOscillator(), r = ac.createOscillator();
      const bG = ac.createGain(); bG.gain.value = 0;
      const ring = ac.createGain(); ring.gain.value = 1;
      const rD = ac.createGain(); rD.gain.value = 0;
      const pre = ac.createGain(); pre.gain.value = 0.2;
      const sh = ac.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.sin(x * Math.PI * 2.5) * 0.7; }
      sh.curve = curve;
      const filt = ac.createBiquadFilter();
      const env = ac.createGain(); env.gain.value = 0;
      const pan = ac.createStereoPanner();
      a.connect(ring); b.connect(bG); bG.connect(ring); r.connect(rD); rD.connect(ring.gain);
      ring.connect(pre); pre.connect(sh); sh.connect(filt); filt.connect(env);
      const cleanup = route(env, { pan: 0, dest: pan, send: 0, echo: 0 });
      pan.connect(o.dest || out);
      const vS = ac.createGain(); vS.gain.value = FM.clamp(fin(o.send, 0.2), 0, 1); pan.connect(vS); vS.connect(verbIn);
      const eS = ac.createGain(); eS.gain.value = FM.clamp(fin(o.echo, 0.1), 0, 1); pan.connect(eS); eS.connect(echoIn);
      a.frequency.value = b.frequency.value = 220; r.frequency.value = 110;
      a.start(); b.start(); r.start();
      // wave, ring (its wave), ratio (or ratios to cycle, or hz: a fixed buzz), depth 0…1, drive (the fold) 0…1,
      // twin (a detuned second oscillator 0…1) and detune (cents), filter, q, cut (× pitch), sweep, sustain, decay, gain
      let P = null, nR = 0, stopped = false;
      const c = {
        set(p = {}) {
          P = Object.assign({ wave: 'sawtooth', ring: 'sine', ratio: 1.5, depth: 0.6, drive: 0.25, twin: 0, detune: 7, filter: 'lowpass', q: 1, cut: 6, sweep: false, sustain: 0.5, decay: 0.15, gain: 1 }, P, p);
          const t = ac.currentTime;
          a.type = b.type = P.wave; r.type = P.ring;
          b.detune.setTargetAtTime(fin(P.detune, 0), t, 0.01); bG.gain.setTargetAtTime(FM.clamp(fin(P.twin, 0), 0, 1), t, 0.01);
          rD.gain.setTargetAtTime(FM.clamp(fin(P.depth, 0), 0, 1), t, 0.01); ring.gain.setTargetAtTime(1 - FM.clamp(fin(P.depth, 0), 0, 1), t, 0.01);
          pre.gain.setTargetAtTime(FM.clamp(fin(P.drive, 0.2), 0.01, 1.5), t, 0.01);
          filt.type = P.filter; filt.Q.setTargetAtTime(FM.clamp(fin(P.q, 1), 0.1, 30), t, 0.01);
          return c;
        },
        glide(f, t, tau = 0.04, tone = 1) {
          t = T(t); f = FM.clamp(fin(f, 220), 30, 5000); tau = Math.max(0.002, fin(tau, 0.04));
          a.frequency.setTargetAtTime(f, t, tau); b.frequency.setTargetAtTime(f, t, tau);
          const rf = P.hz || f * (Array.isArray(P.ratios) && P.ratios.length ? P.ratios[nR++ % P.ratios.length] : fin(P.ratio, 1.5));
          r.frequency.setTargetAtTime(FM.clamp(rf, 1, 8000), t, tau);
          const cut = FM.clamp(f * fin(P.cut, 6) * fin(tone, 1), 80, 15000);
          filt.frequency.cancelScheduledValues(t);
          if (P.sweep) { filt.frequency.setTargetAtTime(FM.clamp(cut * 3, 80, 16000), t, 0.002); filt.frequency.setTargetAtTime(cut * 0.7, t + 0.01, 0.12); }
          else filt.frequency.setTargetAtTime(cut, t, 0.01);
          return c;
        },
        note(f, vel = 0.8, t, dur, tau, tone) {
          if (!m.on || thin()) return c;
          t = T(t); c.glide(f, t, tau, tone);
          const peak = 0.15 * fin(P.gain, 1) * (0.45 + 0.55 * FM.clamp(fin(vel, 0.8), 0, 1));
          env.gain.cancelScheduledValues(t);
          env.gain.setTargetAtTime(peak, t, 0.003);
          env.gain.setTargetAtTime(peak * fin(P.sustain, 0.5), t + 0.025, Math.max(0.01, fin(P.decay, 0.15)));
          if (dur != null && isFinite(dur)) env.gain.setTargetAtTime(0, t + Math.max(0.01, dur), 0.04);
          return c;
        },
        hold(f, vel = 0.8, t, tau, tone) {
          t = T(t); c.glide(f, t, tau, tone);
          const peak = 0.15 * fin(P.gain, 1) * (0.45 + 0.55 * FM.clamp(fin(vel, 0.8), 0, 1));
          env.gain.cancelScheduledValues(t);
          env.gain.setTargetAtTime(peak, t, 0.004);
          env.gain.setTargetAtTime(peak * Math.max(0.45, fin(P.sustain, 0.5)), t + 0.03, 0.2);
          return c;
        },
        release(t) { t = T(t); env.gain.cancelScheduledValues(t); env.gain.setTargetAtTime(0, t, 0.06); return c; },
        // a motor that cannot move: ring mod at an ugly ratio, folded hard
        grind(on, f = 220, t) {
          t = T(t);
          if (on) {
            rD.gain.setTargetAtTime(1, t, 0.02); ring.gain.setTargetAtTime(0, t, 0.02);
            r.frequency.setTargetAtTime(FM.clamp(fin(f, 220) * 1.414, 1, 8000), t, 0.02);
            pre.gain.setTargetAtTime(0.9, t, 0.05);
            filt.frequency.setTargetAtTime(FM.clamp(fin(f, 220) * 4, 200, 6000), t, 0.02);
            env.gain.cancelScheduledValues(t); env.gain.setTargetAtTime(0.07, t, 0.03);
          } else { c.set(); env.gain.cancelScheduledValues(t); env.gain.setTargetAtTime(0, t, 0.05); }
          return c;
        },
        pan(p) { pan.pan.setTargetAtTime(FM.clamp(fin(p, 0), -1, 1), ac.currentTime, 0.05); return c; },
        stop() { if (stopped) return; stopped = true; env.gain.setTargetAtTime(0, ac.currentTime, 0.03); const at = ac.currentTime + 0.2; for (const s of [a, b, r]) s.stop(at); a.onended = () => { cleanup(); try { pan.disconnect(); } catch (_) {} }; },
      };
      return c.set(o);
    };

    m.kick = (o = {}) => {
      if (!m.on || thin()) return;
      const t = T(o.t);
      const p = fin(o.pitch, 48), d = fin(o.d, 0.45), g = FM.clamp(fin(o.gain, 0.8), 0, 1);
      const osc = ac.createOscillator();
      osc.frequency.setValueAtTime(p * 3.2, t);
      osc.frequency.exponentialRampToValueAtTime(p, t + 0.06);
      const env = ac.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(g, t + 0.002);
      env.gain.setTargetAtTime(0, t + 0.01, d / 4);
      osc.connect(env);
      const cleanup = route(env, o);
      osc.start(t); osc.stop(t + d * 1.6 + 0.05);
      osc.onended = cleanup;
    };
    m.snare = (o = {}) => {
      if (!m.on || thin()) return;
      const g = fin(o.gain, 0.5);
      inner++;
      try {
        m.noise({ t: o.t, d: fin(o.d, 0.18), gain: g * 0.8, filter: 'highpass', freq: fin(o.tone, 1400), q: 0.7, pan: o.pan, send: o.send, echo: o.echo, dest: o.dest });
        m.tone({ t: o.t, freq: 190, glide: 140, d: 0.09, gain: g * 0.5, type: 'triangle', pan: o.pan, dest: o.dest });
      } finally { inner--; }
    };
    m.hat = (o = {}) => {
      if (!m.on || thin()) return;
      inner++;
      try { m.noise({ t: o.t, d: fin(o.d, 0.05), gain: fin(o.gain, 0.22), filter: 'highpass', freq: fin(o.tone, 7500), q: 0.9, pan: o.pan, send: o.send, echo: o.echo, dest: o.dest }); } finally { inner--; }
    };

    // ── pads (the app and the AUv3: the keyboard's other half, for drumming): the kit's own drums the machine uses
    // (m.kick, m.snare, m.hat: found in its code and as they are called), slices of a sample it was given (m.onSample),
    // or pads the machine names itself: m.pads([{ label: 'Kick', play(vel01) { … } }, …]) ──
    const DRUMS = [['kick', 'Kick'], ['snare', 'Snare'], ['hat', 'Hat']], SLICES = 8;
    const drumUsed = {};
    let padOwn = null, padClip = null, padSent = null;
    function playSlice(i, v) {
      if (!padClip || !m.on) return;
      const t = T(), len = padClip.duration / SLICES, src = ac.createBufferSource(), g = ac.createGain();
      src.buffer = padClip; g.gain.value = FM.clamp(v, 0.05, 1) * 0.9;
      src.connect(g);
      const cleanup = route(g, { send: 0.12 });
      src.start(t, i * len, len * 1.02); src.onended = cleanup;
    }
    function padList() {
      if (padOwn) return padOwn.map((p, k) => ({ id: 'o' + k, label: p.label, hit: p.play }));
      const out = [];
      for (const [k, l] of DRUMS) if (drumUsed[k]) out.push({ id: k, label: l, hit: (v) => m[k]({ gain: [0.8, 0.5, 0.22][DRUMS.findIndex((d) => d[0] === k)] * FM.clamp(v * 1.15, 0.2, 1) }) });
      if (padClip) for (let i = 0; i < SLICES; i++) out.push({ id: 's' + i, label: String(i + 1), hit: (v) => playSlice(i, v) });
      return out;
    }
    function sendPads(force) {
      const list = padList().map(({ id, label }) => ({ id, label })), key = JSON.stringify(list);
      if (!force && key === padSent) return;
      padSent = key;
      try { parent.postMessage({ fm: 'pads', list }, '*'); } catch (_) {}
    }
    m.pads = (list) => {
      padOwn = Array.isArray(list) ? list.filter((p) => p && typeof p.play === 'function').slice(0, 16).map((p) => ({ label: String(p.label || '').slice(0, 10), play: p.play })) : null;
      sendPads();
    };
    for (const [k] of DRUMS) { // a drum helper called for the first time: its pad appears
      const f = m[k];
      m[k] = (o) => { if (!drumUsed[k]) { drumUsed[k] = true; setTimeout(sendPads, 0); } return f(o); };
    }
    m._scanPads = () => {
      const code = String(SPEC && SPEC.build);
      for (const [k] of DRUMS) if (new RegExp('\\bm\\.' + k + '\\s*\\(').test(code)) drumUsed[k] = true;
      sendPads();
    };
    function padHit(id, vel01, at) {
      const p = padList().find((x) => x.id === id);
      if (!p) return;
      const go = () => { try { p.hit(vel01); } catch (er) { report(er); } };
      if (at != null && typeof window.__fmAt === 'function') window.__fmAt(at, go); else go();
    }

    // ── voice governor: at most MAX_VOICES kit one-shots sounding at once; extra notes are
    // skipped rather than letting a runaway machine choke the audio thread ──
    const MAX_VOICES = cfg.lite || cfg.low ? 32 : 64;
    let voices = 0;
    m._voices = () => voices;
    // MIDI notes out: when the page asks, every kit note is also reported as a MIDI note
    let midiNotes = !!cfg.midiNotes, noteHush = 0;
    function reportNote(midi, vel, t, dur) {
      if (!midiNotes || !m.on || noteHush || !isFinite(midi)) return;
      const n = Math.round(midi);
      if (n < 0 || n > 127) return;
      try {
        parent.postMessage({ fm: 'note', n, v: FM.clamp(Math.round(fin(vel, 100)), 1, 127), e: epochOf(T(t)), t: T(t), d: FM.clamp(fin(dur, 0.25), 0.02, 8) }, '*');
      } catch (_) {}
    }
    m.midiNote = (midi, vel, t, dur) => reportNote(midi, vel, t, dur); // for machines with their own synths
    const velOf = (g, ref) => 20 + Math.round(107 * FM.clamp(fin(g, ref) / ref, 0, 1));
    for (const name of ['tone', 'pluck', 'noise', 'kick']) {
      const inner = m[name];
      m[name] = (o = {}) => {
        if (!m.on) return;
        if (voices >= MAX_VOICES) { hotNote('voices'); return; }
        const lead = Math.max(0, fin(o.t, ac.currentTime) - ac.currentTime);
        const life = lead + fin(o.a, 0.005) + fin(o.hold, 0) + Math.max(0.05, fin(o.d, name === 'pluck' ? 2 : 0.4)) * 1.6;
        voices++;
        setTimeout(() => { voices--; }, Math.min(12, life) * 1000 + 50);
        if (name === 'tone') reportNote(FM.ftom(fin(o.freq, 440)), velOf(o.gain, 0.3), o.t, fin(o.a, 0.005) + fin(o.hold, 0) + fin(o.d, 0.4) * 0.6);
        else if (name === 'pluck') reportNote(FM.ftom(fin(o.freq, 220)), velOf(o.gain, 0.4), o.t, fin(o.d, 2) * 0.4);
        else if (name === 'kick') reportNote(36, velOf(o.gain, 0.8), o.t, 0.1);
        inner(o);
      };
    }
    // drums report General MIDI drum notes, not the tones they are made of
    for (const [name, gm] of [['snare', 38], ['hat', 42]]) {
      const inner = m[name];
      m[name] = (o = {}) => {
        if (!m.on) return;
        reportNote(gm, velOf(o.gain, name === 'snare' ? 0.5 : 0.22), o.t, 0.08);
        noteHush++;
        try { inner(o); } finally { noteHush--; }
      };
    }

    // ── time ──
    const clocks = [];
    const AHEAD = (deck || document.documentElement.classList.contains('fm-slowcpu')) ? 0.2 : 0.12;   // how far ahead steps are booked: the Deck's and a phone's slower CPU (and a background app's late timers) get more room
    // an app in the background (Android: another app in front, a screen recording, the screen off): nobody plays it, so steps are
    // booked half a second ahead, and timers that come late (the CPU is shared) are still in time
    let idleBook = !!cfg.idle;
    const ahead = () => (idleBook ? Math.max(AHEAD, 0.5) : AHEAD);
    // Master BPM (set by the page): overrides every clock's tempo and snaps its steps
    // to a grid on wall-clock time, so separate machines (separate AudioContexts) land
    // on the same beats.
    let masterBpm = fin(cfg.masterBpm, 0), masterAnchor = fin(cfg.masterAnchor, 0);
    // the output timestamp only becomes valid once audio is flowing; re-sync when it does, or every
    // step would be off by the output latency
    const tsReady = () => { const ts = ac.getOutputTimestamp ? ac.getOutputTimestamp() : null; return !!(ts && ts.performanceTime); };
    const masterKey = () => masterBpm + '@' + masterAnchor + (tsReady() ? '' : '~');
    const epochOf = (t) => {
      const ts = ac.getOutputTimestamp ? ac.getOutputTimestamp() : null;
      if (ts && ts.performanceTime) return (performance.timeOrigin + ts.performanceTime) / 1000 + (t - ts.contextTime);
      return (performance.timeOrigin + performance.now()) / 1000 + (t - ac.currentTime);
    };
    m.clock = (o = {}) => {
      let own = fin(o.bpm, 120);
      const c = { div: fin(o.div, 4), swing: fin(o.swing, 0), step: 0, running: true };
      Object.defineProperty(c, 'bpm', { get: () => masterBpm || own, set: (val) => { own = fin(val, own); }, enumerable: true });
      let next = 0, synced = 0, lastT = 0;
      c.stepDur = () => 60 / FM.clamp(c.bpm, 1, 1000) / Math.max(1, c.div);
      c.stop = () => { c.running = false; };
      c.start = () => { c.running = true; next = 0; };
      c._pump = () => {
        if (!c.running || !m.on || ac.state !== 'running') { next = 0; return; }
        const now = ac.currentTime;
        if (masterBpm && synced !== masterKey()) {
          // jump onto the shared grid: next step = next multiple of stepDur in wall-clock time
          // steps land on a grid anchored at masterAnchor (a beat in wall-clock time; 0 = the epoch)
          // never before a step that is already queued, or it would play twice
          const sd = c.stepDur(), from = Math.max(now + 0.05, lastT + sd * 0.5);
          const e = epochOf(from), k = Math.ceil((e - masterAnchor) / sd);
          next = from + (masterAnchor + k * sd - e);
          c.step = ((k % 26880) + 26880) % 26880; // same modulus everywhere, so bars line up across machines
          synced = masterKey();
        } else if (!masterBpm) synced = 0;
        // late (the page was busy for longer than the lookahead): on a shared grid, find it again; alone, skip the
        // steps that are gone and stay on the beat (starting over from now stretched the bar: the tempo seemed to sag)
        if (next < now) {
          if (masterBpm) { next = now + 0.04; synced = 0; }
          else { const sd = c.stepDur(), n = Math.ceil((now + 0.01 - next) / sd); next += n * sd; c.step += n; }
        }
        let guard = 0;
        while (next < now + ahead() && guard++ < 64) {
          const s = c.step;
          const sw = s % 2 === 1 ? FM.clamp(c.swing, 0, 1) * c.stepDur() * 0.33 : 0;
          try { o.tick && o.tick(next + sw, s); } catch (e) { report(e); }
          lastT = next;
          c.step++;
          next += c.stepDur();
        }
      };
      clocks.push(c);
      return c;
    };
    setInterval(() => { for (const c of clocks) c._pump(); }, 25);

    m.at = (time, fn) => {
      const ms = (time - ac.currentTime) * 1000;
      setTimeout(() => { try { fn(); } catch (e) { report(e); } }, Math.max(0, ms));
    };
    m.every = (seconds, fn) => setInterval(() => { try { fn(); } catch (e) { report(e); } }, Math.max(16, seconds * 1000));

    // out of sight (a locked machine behind the one on screen, the one under the grid): it keeps stepping, so its sound,
    // physics and timing don't change, but its screens shrink to a few pixels and the meter stops, so drawing costs
    // next to nothing. Back in sight, everything is drawn at full size again.
    let unseen = false, hostSeen = true, idleHide = false;
    // out of sight: the host says so (a closed plugin window, a locked layer), or the app is in the background; then the
    // screen is a canvas of a few pixels and drawing costs next to nothing
    const seenNow = () => { const u = !hostSeen || idleHide; if (unseen === u) return; unseen = u; for (const fn of densityFns) fn(); };
    m._setSeen = (seen) => { hostSeen = !!seen; seenNow(); };
    m._setIdleHide = (on) => { idleHide = !!on; seenNow(); };
    const frames = [];
    m.frame = (fn) => { frames.push({ fn, errs: 0 }); };

    // ── device shell ──
    const dev = el('div', 'device', root);
    const head = el('div', 'head', dev);
    const power = el('button', 'power', head);
    power.title = 'Power';
    power.setAttribute('aria-label', 'Power');
    power.setAttribute('aria-pressed', 'false');
    el('div', 'name', head, cfg.name || (SPEC && SPEC.title) || 'Machine');
    const hint = el('div', 'hint', head, '◂ power on');
    el('div', 'spacer', head);
    el('div', 'kind', head, (SPEC && SPEC.title ? SPEC.title : '') + (cfg.index != null ? ' · No. ' + (cfg.no || String(cfg.index + 1).padStart(3, '0')) : ''));
    const led = el('div', 'led', head);
    let hotUntil = 0;
    function hotNote(why) {
      hotUntil = performance.now() + 3000;
      led.classList.add('hot');
      led.title = why === 'voices' ? 'Running hot: too many notes at once, some are skipped' : 'Running hot: drawing slowed down to keep your device cool';
    }
    setInterval(() => { if (performance.now() > hotUntil && !led.classList.contains('on')) led.classList.remove('hot'); }, 500);
    led.title = 'fault';
    const meter = el('canvas', 'meter', head);
    meter.width = 120; meter.height = 12;
    const mg = meter.getContext('2d');
    const body = el('div', 'body', dev);
    const faultBar = el('div', 'faultbar', dev);

    function report(e) {
      const msg = (e && e.message) || String(e);
      errors.push(msg);
      led.classList.add('on');
      faultBar.textContent = '⚠ fault: ' + msg;
      faultBar.style.display = 'block';
      try { parent.postMessage({ fm: 'error', message: msg }, '*'); } catch (_) {}
      if (window.console) console.error(e);
    }
    m.report = report;

    // m.on means "audible": powered AND the browser has let audio start.
    // Machines boot powered; until the browser allows sound (it may want a
    // click first) m.on stays false, so nothing piles up to burst out later.
    let powered = false;
    Object.defineProperty(m, 'on', { get: () => powered && ac.state === 'running', enumerable: true });
    const powerFns = [];
    m.onPower = (fn) => powerFns.push(fn);
    // the app's wind-down (the ring in its transport): v from 0 (playing as ever) to 1 (the end). The kit already thins the
    // notes, darkens and fades; m.onWind is for a machine that wants an ending of its own (a pendulum slowing to a halt)
    const windFns = [];
    m.onWind = (fn) => { if (typeof fn === 'function') windFns.push(fn); };
    Object.defineProperty(m, 'wind', { get: () => windV, enumerable: true });
    function setWind(v) {
      v = FM.clamp(fin(v, 0), 0, 1);
      if (Math.abs(v - windV) < 0.001) return;
      windV = v;
      const now = ac.currentTime;
      windLP.frequency.setTargetAtTime(20000 * Math.pow(450 / 20000, Math.pow(v, 1.2)), now, 0.6);
      windG.gain.setTargetAtTime(Math.pow(1 - v, 1.6), now, v ? 0.8 : 0.3);
      for (const f of windFns) { try { f(v); } catch (e) { report(e); } }
    }
    function syncHint() {
      if (!powered) { hint.textContent = '◂ power on'; hint.style.display = ''; }
      else if (ac.state !== 'running') { hint.textContent = 'click anywhere to hear it'; hint.style.display = ''; }
      else hint.style.display = 'none';
    }
    ac.addEventListener('statechange', syncHint);
    const sayAudible = () => { try { parent.postMessage({ fm: 'audible', on: powered && ac.state === 'running' }, '*'); } catch (_) {} };
    ac.addEventListener('statechange', sayAudible);
    const wake = () => { if (powered && ac.state !== 'running') ac.resume(); };
    window.addEventListener('pointerdown', wake, true);
    window.addEventListener('keydown', wake, true);
    // a Bluetooth speaker or headphones connecting or dropping, a call, Siri: the browser interrupts or suspends the audio
    // (Safari says 'interrupted') and, once the route has settled, takes it back only if asked. Ask again by ourselves; if the
    // browser wants a touch first, the next one does it (wake above).
    const rewake = () => {
      if (!powered || ac.state === 'running' || document.visibilityState === 'hidden') return;
      try { Promise.resolve(ac.resume()).catch(() => {}); } catch (_) {}
    };
    ac.addEventListener('statechange', () => setTimeout(rewake, 300));
    document.addEventListener('visibilitychange', () => setTimeout(rewake, 200));
    window.addEventListener('pageshow', () => setTimeout(rewake, 200));
    try { if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', () => setTimeout(rewake, 500)); } catch (_) {}
    // the page around it plays computer keys as notes (the app and the AUv3): keys pressed in here go up to it
    if (cfg.typing) for (const type of ['keydown', 'keyup']) {
      window.addEventListener(type, (e) => {
        // ⌘1–⌘3 (Ctrl on other keyboards): the page's views
        if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && /^Digit[1-3]$/.test(e.code)) {
          e.preventDefault();
          parent.postMessage({ fm: 'typing', code: e.code, down: type === 'keydown', mod: true }, '*');
          return;
        }
        if (e.metaKey || e.ctrlKey || e.altKey || (e.target.closest && e.target.closest('input, select, textarea'))) return;
        // ← → change machine, unless a control has the focus (a knob turns with the arrows)
        if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
          if (e.target.closest && e.target.closest('.ctl, button, [tabindex]')) return;
          e.preventDefault();
          parent.postMessage({ fm: 'typing', code: e.code, down: type === 'keydown' }, '*');
          return;
        }
        if (!/^(Key[A-Z]|Semicolon|Quote|Space)$/.test(e.code)) return;
        if (e.code === 'Space') e.preventDefault();
        parent.postMessage({ fm: 'typing', code: e.code, down: type === 'keydown', repeat: e.repeat }, '*');
      });
    }
    function setPower(on) {
      powered = on;
      if (on && cfg.workerTimers) FM._timers.useWorker();
      power.classList.toggle('on', on);
      power.setAttribute('aria-pressed', String(on));
      syncHint();
      if (on) {
        ac.resume();
        master.gain.cancelScheduledValues(ac.currentTime);
        master.gain.setTargetAtTime(FX ? 1 : 0.75, ac.currentTime, 0.06);
      } else {
        master.gain.cancelScheduledValues(ac.currentTime);
        master.gain.setTargetAtTime(0, ac.currentTime, 0.04);
      }
      if (FX) fxApply(0.04);
      for (const f of powerFns) { try { f(on); } catch (e) { report(e); } }
      try { parent.postMessage({ fm: 'power', on }, '*'); } catch (_) {}
      sayAudible();
    }
    power.addEventListener('click', () => setPower(!powered));
    // the app: touching a machine's main screen while it is off turns it on
    if (cfg.autoplay) root.addEventListener('pointerdown', (e) => {
      if (!e.target.closest || !e.target.closest('.screen-sec')) return;
      if (!powered) setPower(true);
      try { parent.postMessage({ fm: 'touch-play' }, '*'); } catch (_) {} // the app's Play follows (it ignores this if already playing)
    }, true);
    m.power = setPower;
    // ── recording: the first screen (as video) + the master output, sent to the page to download ──
    const screens = [];
    let recorder = null;
    const RTYPES = {
      video: ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'],
      audio: ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'],
    };
    function recordStart() {
      if (recorder) return;
      if (!window.MediaRecorder) { parent.postMessage({ fm: 'record-error', message: 'this browser cannot record' }, '*'); return; }
      if (!powered) setPower(true);
      if (ac.state !== 'running') ac.resume();
      const dest = ac.createMediaStreamDestination();
      analyser.connect(dest);
      const tracks = dest.stream.getAudioTracks();
      const cv = screens[0];
      const video = !!(cv && cv.captureStream);
      if (video) tracks.push(...cv.captureStream(30).getVideoTracks());
      const type = RTYPES[video ? 'video' : 'audio'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
      let mr;
      try {
        mr = new MediaRecorder(new MediaStream(tracks), { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 8e6, audioBitsPerSecond: 192000 });
      } catch (e) {
        analyser.disconnect(dest);
        parent.postMessage({ fm: 'record-error', message: e.message }, '*');
        return;
      }
      const chunks = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onstop = () => {
        try { analyser.disconnect(dest); } catch (_) {}
        tracks.forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: mr.mimeType || type || (video ? 'video/webm' : 'audio/webm') });
        parent.postMessage({ fm: 'recording', blob, video }, '*');
        recorder = null;
      };
      mr.start(1000);
      recorder = mr;
      parent.postMessage({ fm: 'record-state', on: true, video }, '*');
    }
    function recordStop() { if (recorder && recorder.state !== 'inactive') recorder.stop(); }

    // ── samples handed over by the page (machines themselves have no network or microphone) ──
    const sampleFns = [];
    let wantSent = false;
    // ── the world outside: weather, daylight and moon for a city near the visitor, from the page ──
    const worldFns = [];
    m.world = (fn) => {
      if (typeof fn !== 'function') return;
      worldFns.push(fn);
      if (worldFns.length === 1) parent.postMessage({ fm: 'want-world' }, '*');
    };
    m.onSample = (fn) => {
      sampleFns.push(fn);
      if (!wantSent) { wantSent = true; parent.postMessage({ fm: 'want-sample', kind: 'speech' }, '*'); }
    };
    m.nextSample = () => parent.postMessage({ fm: 'want-sample', kind: 'speech', next: true }, '*');
    // the mic: a host without one (Ableton Live) says so once, and every button that asks for it is greyed out
    let pressing = null, noMic = !!cfg.noMic;
    const micButtons = new Set();
    const greyMic = (b) => { b.disabled = true; b.classList.add('nomic'); b.title = 'No microphone here'; };
    m.requestMic = (seconds) => {
      if (pressing) { micButtons.add(pressing); if (noMic) greyMic(pressing); }
      parent.postMessage({ fm: 'mic', seconds: FM.clamp(fin(seconds, 4), 1, 12) }, '*');
    };
    // ── the camera: the page (or the app) opens it and hands over small frames; the machine never sees the stream, and
    // nothing leaves the device. m.camera({ w, h, fps }) → cam; cam.start() asks for it (the visitor allows it once). ──
    let cam = null, camFrame = () => {}, camState = () => {}, camText = () => {};
    m.camera = (o = {}) => {
      if (cam) return cam;
      const w = Math.round(FM.clamp(fin(o.w, 64), 8, 160)), h = Math.round(FM.clamp(fin(o.h, 48), 6, 120)), n = w * h;
      const fps = FM.clamp(fin(o.fps, 15), 2, 30), wantText = !!o.text;
      const textFns = [], lensFns = [];
      const luma = new Float32Array(n), last = new Float32Array(n), motion = new Float32Array(n), rgb = new Uint8ClampedArray(n * 3);
      const fns = [];
      let wanted = false, sent = false;
      // its own picture, for cam.draw: drawn once per frame that arrives, scaled up without smoothing
      // one small canvas per way of drawing it (a machine may draw the picture and its motion over it), each painted
      // once per camera frame, not once per screen frame
      const pics = {};
      const picOf = (key) => {
        if (!pics[key]) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const pg = cv.getContext('2d'); pics[key] = { cv, pg, img: pg.createImageData(w, h), frame: -1 }; }
        return pics[key];
      };
      const ask = () => {
        const on = wanted && powered;
        if (on === sent) return;
        sent = on;
        if (!on) c.on = false;
        parent.postMessage({ fm: 'cam', on, w, h, fps, text: wantText, facing: c.facing }, '*');
      };
      const c = cam = {
        w, h, luma, motion, rgb,
        on: false,          // frames are arriving
        error: null,        // why not ('camera permission was declined', 'no camera here' …)
        frames: 0,          // frames received so far
        amount: 0,          // how much moved since the last frame, 0…1 (a wave of a hand is about 0.2)
        center: null,       // where it moved: { x, y } in 0…1 (mirrored like a mirror), or null when still
        bright: 0,          // the picture's mean brightness, 0…1
        color: { r: 0, g: 0, b: 0 }, hue: 0, sat: 0, // its mean colour; hue in degrees, sat 0…1
        mirror: o.mirror !== false,
        // text the camera reads (m.camera({ text: true })): [{ text, digits, x, y, w, h }] in 0…1 of the picture, as it is
        // drawn (mirrored too, if it is); cam.reads says whether this host can read text at all (the app can; some browsers)
        text: [], reads: false,
        // which camera: 'front' (facing you), 'back' (facing away, on a phone or iPad) or 'other' (a Mac's webcam);
        // cam.lenses says how many there are. cam.switchLens() goes to the next one, or switchLens('back') to that one.
        facing: o.facing === 'back' ? 'back' : 'front', lenses: 1,
        switchLens(to) { parent.postMessage({ fm: 'cam-lens', to: to === 'front' || to === 'back' ? to : 'next' }, '*'); },
        onLens(fn) { if (typeof fn === 'function') lensFns.push(fn); },
        onText(fn) { if (typeof fn === 'function') textFns.push(fn); },
        get wanted() { return wanted; },
        start() {
          if (cfg.lite) { c.error = 'no camera in previews'; return; }
          wanted = true; c.error = null;
          // asking to look is playing: a stopped machine (the app opens stopped) powers on, and the app's Play follows
          if (!powered) { setPower(true); try { parent.postMessage({ fm: 'touch-play' }, '*'); } catch (_) {} }
          ask();
        },
        stop() { wanted = false; ask(); },
        toggle(v) { (v == null ? !wanted : !!v) ? c.start() : c.stop(); return wanted; },
        onFrame(fn) { if (typeof fn === 'function') fns.push(fn); },
        at(x, y, what) { const a = what === 'motion' ? motion : luma; return a[Math.min(h - 1, Math.max(0, Math.floor(fin(y, 0) * h))) * w + Math.min(w - 1, Math.max(0, Math.floor(fin(x, 0) * w)))]; },
        // the picture in cells, averaged: cols × rows values in 0…1, row by row (what: 'luma', 'motion', 'r', 'g', 'b')
        grid(cols, rows, what = 'luma') {
          cols = Math.max(1, Math.min(w, cols | 0)); rows = Math.max(1, Math.min(h, rows | 0));
          const out = new Float32Array(cols * rows), k = what === 'r' ? 0 : what === 'g' ? 1 : what === 'b' ? 2 : -1;
          for (let y = 0; y < h; y++) {
            const gy = Math.floor(y * rows / h) * cols;
            for (let x = 0; x < w; x++) { const i = y * w + x; out[gy + Math.floor(x * cols / w)] += k >= 0 ? rgb[i * 3 + k] / 255 : what === 'motion' ? motion[i] : luma[i]; }
          }
          const per = (w / cols) * (h / rows);
          for (let i = 0; i < out.length; i++) out[i] = Math.min(1, out[i] / per);
          return out;
        },
        // one column of the picture (x in 0…1), top to bottom: read it like a piano roll, as a playhead sweeps across
        column(x, what) { const a = what === 'motion' ? motion : luma, cx = Math.min(w - 1, Math.max(0, Math.floor(fin(x, 0) * w))), out = new Float32Array(h); for (let y = 0; y < h; y++) out[y] = a[y * w + cx]; return out; },
        row(y, what) { const a = what === 'motion' ? motion : luma, cy = Math.min(h - 1, Math.max(0, Math.floor(fin(y, 0) * h))); return a.slice(cy * w, cy * w + w); },
        // draw the picture on a screen, pixelated (smooth: true for a soft, video-like mirror): mode 'image' (colour),
        // 'luma', 'motion' (what moved, in tint), 'ghost' (the picture dim, what moved bright); alpha 0…1;
        // bright -0.5…0.5 and contrast 0.25…4 (1 = as it is) change only how the picture is shown, so a machine whose
        // knobs do the same to what it hears can show you what it hears
        draw(g, x, y, dw, dh, opts = {}) {
          if (!c.frames) return;
          const mode = opts.mode || 'image', p = picOf(mode + (opts.tint || ''));
          const br = FM.clamp(fin(opts.bright, 0), -0.5, 0.5), ct = FM.clamp(fin(opts.contrast, 1), 0.25, 4), adj = br + ':' + ct, plain = !br && ct === 1;
          const lv = (v) => (plain ? v : FM.clamp((v - 0.5) * ct + 0.5 + br, 0, 1)); // (0…1 in, 0…1 out)
          if (p.frame !== c.frames || p.adj !== adj) {
            p.frame = c.frames; p.adj = adj;
            const d = p.img.data, t = tintRGB(opts.tint || m.color('accent'));
            for (let i = 0; i < n; i++) {
              let r, gg, b;
              if (mode === 'luma') r = gg = b = lv(luma[i]) * 255;
              else if (mode === 'motion') { const v = Math.min(1, motion[i] * 3); r = t[0] * v; gg = t[1] * v; b = t[2] * v; }
              else if (mode === 'ghost') { const v = Math.min(1, motion[i] * 3), l = lv(luma[i]) * 70; r = l + t[0] * v; gg = l + t[1] * v; b = l + t[2] * v; }
              else if (plain) { r = rgb[i * 3]; gg = rgb[i * 3 + 1]; b = rgb[i * 3 + 2]; }
              else { r = lv(rgb[i * 3] / 255) * 255; gg = lv(rgb[i * 3 + 1] / 255) * 255; b = lv(rgb[i * 3 + 2] / 255) * 255; }
              d[i * 4] = r; d[i * 4 + 1] = gg; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
            }
            p.pg.putImageData(p.img, 0, 0);
          }
          const sm = g.imageSmoothingEnabled, ga = g.globalAlpha;
          g.imageSmoothingEnabled = !!opts.smooth; g.globalAlpha = ga * FM.clamp(fin(opts.alpha, 1), 0, 1);
          g.drawImage(p.cv, x, y, dw, dh);
          g.imageSmoothingEnabled = sm; g.globalAlpha = ga;
        },
      };
      const tints = {};
      function tintRGB(col) {
        if (tints[col]) return tints[col];
        const t = document.createElement('canvas').getContext('2d'); t.fillStyle = col; t.fillRect(0, 0, 1, 1);
        const p = t.getImageData(0, 0, 1, 1).data;
        return (tints[col] = [p[0], p[1], p[2]]);
      }
      camText = (d) => {
        if (!wanted || !Array.isArray(d.items)) return;
        c.text = d.items.slice(0, 40).map((x) => {
          const t = String(x.text || '').slice(0, 80), xx = FM.clamp(fin(x.x, 0), 0, 1), ww = FM.clamp(fin(x.w, 0), 0, 1);
          return { text: t, digits: t.replace(/[^0-9]/g, ''), x: c.mirror ? 1 - xx - ww : xx, y: FM.clamp(fin(x.y, 0), 0, 1), w: ww, h: FM.clamp(fin(x.h, 0), 0, 1) };
        });
        for (const fn of textFns) { try { fn(c.text, c); } catch (e) { report(e); } }
      };
      camState = (d) => {
        if (d.text != null) c.reads = !!d.text;
        if (d.lenses != null) c.lenses = Math.max(1, d.lenses | 0);
        if (d.facing && d.facing !== c.facing) { c.facing = String(d.facing); for (const fn of lensFns) { try { fn(c.facing, c); } catch (e) { report(e); } } }
        c.on = !!d.on;
        c.error = d.error ? String(d.error).slice(0, 80) : null;
        if (!d.on) { sent = false; if (d.error) wanted = false; }
      };
      // a frame: RGBA (or RGB) bytes at the host's size, resampled to ours, mirrored, and read
      camFrame = (d) => {
        if (!wanted || !d.px) return;
        const src = new Uint8Array(d.px), sw = d.w | 0, sh = d.h | 0, ch = d.ch === 3 ? 3 : 4;
        if (sw < 1 || sh < 1 || src.length < sw * sh * ch) return;
        let sum = 0, mx = 0, my = 0, mw = 0, tr = 0, tg = 0, tb = 0;
        const first = !c.frames;
        for (let y = 0; y < h; y++) {
          const sy = Math.floor((y + 0.5) * sh / h);
          for (let x = 0; x < w; x++) {
            const sx = Math.floor(((c.mirror ? w - 1 - x : x) + 0.5) * sw / w), s = (sy * sw + sx) * ch, i = y * w + x;
            const r = src[s], gg = src[s + 1], b = src[s + 2];
            rgb[i * 3] = r; rgb[i * 3 + 1] = gg; rgb[i * 3 + 2] = b;
            tr += r; tg += gg; tb += b;
            const l = (0.299 * r + 0.587 * gg + 0.114 * b) / 255;
            last[i] = luma[i]; luma[i] = l;
            let mv = first ? 0 : Math.abs(l - last[i]);
            mv = mv < 0.06 ? 0 : (mv - 0.06) / 0.94; // below the camera's own flicker it is still
            motion[i] = motion[i] * 0.35 + mv * 0.65;
            if (motion[i] > 0.02) { mx += x * motion[i]; my += y * motion[i]; mw += motion[i]; }
            sum += l;
          }
        }
        c.frames++;
        c.on = true;
        c.bright = sum / n;
        c.amount = Math.min(1, (mw / n) * 6);
        c.center = mw > n * 0.002 ? { x: (mx / mw + 0.5) / w, y: (my / mw + 0.5) / h } : null;
        const R = tr / n / 255, G = tg / n / 255, B = tb / n / 255, hi = Math.max(R, G, B), lo = Math.min(R, G, B);
        c.color = { r: Math.round(R * 255), g: Math.round(G * 255), b: Math.round(B * 255) };
        c.sat = hi > 0 ? (hi - lo) / hi : 0;
        if (hi > lo) { const d6 = hi - lo; c.hue = (60 * (hi === R ? ((G - B) / d6 + 6) % 6 : hi === G ? (B - R) / d6 + 2 : (R - G) / d6 + 4)) % 360; }
        for (const fn of fns) { try { fn(c); } catch (e) { report(e); } }
      };
      m.onPower(() => ask()); // off: the camera rests (its light goes out); on again: it comes back
      return c;
    };

    // ── motion: how the device is held (the iPhone and iPad app measures it; everywhere else mo.error says why not).
    // m.motion({ hz }) → mo; mo.start() asks for it (no permission needed). Readings are turned to the screen as it is
    // held, whichever way up: x to the right, y down. ──
    let mot = null, motState = () => {}, motData = () => {};
    m.motion = (o = {}) => {
      if (mot) return mot;
      const hz = FM.clamp(fin(o.hz, 30), 5, 60);
      const fns = [], shakeFns = [];
      let wanted = false, sent = false, lastShake = 0;
      const ask = () => {
        const on = wanted && powered;
        if (on === sent) return;
        sent = on;
        if (!on) d.on = false;
        parent.postMessage({ fm: 'motion', on, hz }, '*');
      };
      const d = mot = {
        on: false,              // readings are arriving
        error: null,            // why not ('the motion sensor is in the iPhone and iPad app', …)
        samples: 0,             // readings so far
        tilt: { x: 0, y: 0 },   // which way things would roll, -1…1 (x right, y down); ±1 is the device standing on that edge
        flat: 1,                // 1 lying face up, 0 held upright, -1 face down
        twist: 0,               // turning round the screen like a steering wheel, rad/s (+ anticlockwise)
        shake: 0,               // 0…1: jumps with a jolt, then fades
        gravity: { x: 0, y: 0, z: -1 }, push: { x: 0, y: 0, z: 0 }, // the raw readings, in g
        get wanted() { return wanted; },
        start() {
          if (cfg.lite) { d.error = 'no motion in previews'; return; }
          wanted = true; d.error = null;
          if (!powered) { setPower(true); try { parent.postMessage({ fm: 'touch-play' }, '*'); } catch (_) {} } // (asking is playing)
          ask();
        },
        stop() { wanted = false; ask(); },
        toggle(v) { (v == null ? !wanted : !!v) ? d.start() : d.stop(); return wanted; },
        onMotion(fn) { if (typeof fn === 'function') fns.push(fn); },  // every reading
        onShake(fn) { if (typeof fn === 'function') shakeFns.push(fn); }, // a jolt: fn(strength 0…1), at most ~3 a second
      };
      motState = (x) => {
        d.on = !!x.on;
        d.error = x.error ? String(x.error).slice(0, 80) : null;
        if (!x.on) { sent = false; if (x.error) wanted = false; }
      };
      motData = (x) => {
        if (!wanted || !Array.isArray(x.s) || x.s.length < 7) return;
        const v = x.s.map((n) => FM.clamp(fin(n, 0), -8, 8));
        d.gravity = { x: v[0], y: v[1], z: v[2] }; d.push = { x: v[3], y: v[4], z: v[5] };
        const k = d.samples ? 0.35 : 1; // (a little smoothing: the sensor is jittery, a hand more so)
        d.tilt = { x: d.tilt.x + (FM.clamp(v[0], -1, 1) - d.tilt.x) * k, y: d.tilt.y + (FM.clamp(v[1], -1, 1) - d.tilt.y) * k };
        d.flat = FM.clamp(-v[2], -1, 1);
        d.twist = d.twist + (v[6] - d.twist) * 0.5;
        const jolt = FM.clamp((Math.hypot(v[3], v[4], v[5]) - 0.35) / 1.2, 0, 1);
        d.shake = Math.max(d.shake * 0.85, jolt);
        d.samples++; d.on = true;
        const now = performance.now();
        if (jolt > 0.45 && now - lastShake > 300) { lastShake = now; for (const fn of shakeFns) { try { fn(jolt, d); } catch (e) { report(e); } } }
        for (const fn of fns) { try { fn(d); } catch (e) { report(e); } }
      };
      m.onPower(() => ask()); // off: the sensor rests; on again: it comes back
      return d;
    };

    async function receiveSample(d) {
      const meta = Object.assign({}, d.meta || {});
      let buffer = null;
      if (d.data) {
        try { buffer = await ac.decodeAudioData(d.data); } catch (e) { meta.error = 'could not decode that audio'; }
      }
      if (buffer) { padClip = buffer; sendPads(); } // a sample came: its slices are on the pads
      for (const fn of sampleFns) { try { fn(buffer, meta); } catch (e) { report(e); } }
    }

    // A virtual finger on the machine's first screen (x, y in 0…1): the Steam Deck's left and right sticks are one each.
    // It is a real pointer to the machine (the same events a finger sends), so every machine plays with it unchanged;
    // a ring shows where it is. The ids are far from any real pointer's.
    const fingers = [];
    function finger(d) {
      const c = screens[0];
      if (!c || !c.width) return;
      const id = d.id | 0;
      let f = fingers[id];
      if (!f) {
        const col = id ? '#4fd8ff' : '#ffad1f';
        const ring = document.createElement('div');
        ring.style.cssText = 'position:fixed;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;pointer-events:none;z-index:99999;display:none;border:3px solid ' + col + ';box-shadow:0 0 0 1px #000,0 0 14px ' + col + ';transition:transform .08s';
        document.body.appendChild(ring);
        f = fingers[id] = { ring, down: false, pid: 9000 + id };
      }
      const r = c.getBoundingClientRect();
      const x = r.left + FM.clamp(fin(d.x, 0.5), 0, 1) * r.width, y = r.top + FM.clamp(fin(d.y, 0.5), 0, 1) * r.height;
      f.ring.style.left = x + 'px'; f.ring.style.top = y + 'px';
      const send = (type) => {
        const up = type === 'pointerup';
        c.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: f.pid, pointerType: 'touch', isPrimary: id === 0,
          clientX: x, clientY: y, screenX: x, screenY: y, width: 24, height: 24, pressure: up ? 0 : 0.5, buttons: up ? 0 : 1, button: type === 'pointermove' ? -1 : 0 }));
      };
      if (d.phase === 'down' && !f.down) { f.down = true; f.ring.style.display = 'block'; f.ring.style.transform = 'scale(.7)'; send('pointerdown'); }
      else if (d.phase === 'move') { f.ring.style.display = 'block'; if (f.down) send('pointermove'); }
      else if (d.phase === 'up' && f.down) { f.down = false; send('pointerup'); f.ring.style.transform = ''; setTimeout(() => { if (!f.down) f.ring.style.display = 'none'; }, 700); }
      else if (d.phase === 'hide') { if (f.down) { f.down = false; send('pointerup'); } f.ring.style.display = 'none'; }
    }

    window.addEventListener('message', (e) => {
      if (!e.data || e.source !== parent) return;
      if (e.data.fm === 'sample') receiveSample(e.data);
      if (e.data.fm === 'cam-frame') camFrame(e.data);
      if (e.data.fm === 'cam-state') camState(e.data);
      if (e.data.fm === 'motion-data') motData(e.data);
      if (e.data.fm === 'motion-state') motState(e.data);
      if (e.data.fm === 'cam-text') camText(e.data);
      if (e.data.fm === 'world' && e.data.data) for (const fn of worldFns) { try { fn(e.data.data); } catch (er) { report(er); } }
      if (e.data.fm === 'idle') {
        idle = !!e.data.on; idleBook = idle; verbIdle(idle);
        clearTimeout(idleHideT);   // (hidden after 2.5 s, as the reverb: the shade pulled down and let go again changes nothing)
        if (!idle) m._setIdleHide(false); else idleHideT = setTimeout(() => { if (idle) m._setIdleHide(true); }, 2500);
      }
      if (e.data.fm === 'pace') pace = Math.max(1, Math.min(4, Math.round(+e.data.div || 1)));
      if (e.data.fm === 'power') setPower(!!e.data.on);
      if (e.data.fm === 'wind') setWind(e.data.v);
      if (e.data.fm === 'record') (e.data.on ? recordStart : recordStop)();
      if (e.data.fm === 'tempo') { masterAnchor = fin(e.data.anchor, 0); setMaster(e.data.bpm); }
      if (e.data.fm === 'midi-notes') midiNotes = !!e.data.on;
      if (e.data.fm === 'key') setKey(e.data.key);
      if (e.data.fm === 'note-in') { // with 'at' (the AUv3): played at that audio time, sample-accurately
        const d = e.data, go = () => noteIn(d.n, d.v, !!d.on);
        if (d.at != null && typeof window.__fmAt === 'function') window.__fmAt(d.at, go); else go();
      }
      if (e.data.fm === 'pad') padHit(String(e.data.id), FM.clamp(fin(e.data.vel, 100), 1, 127) / 127, e.data.at);
      if (e.data.fm === 'pads-ask') sendPads(true);
      if (e.data.fm === 'finger') finger(e.data); // the Steam Deck's sticks: a finger each on the machine's screen
      if (e.data.fm === 'seen' && m && m._setSeen) m._setSeen(!!e.data.on);
      if (e.data.fm === 'drift' && m && m._setDrift) m._setDrift(!!e.data.on);
      // muted in the mixer: off, and once it has faded, its audio graph stops being rendered at all (no CPU); waking
      // it is a plain power on, which resumes it
      if (e.data.fm === 'sleep') { setPower(false); setTimeout(() => { if (!powered) try { ac.suspend(); } catch (_) {} }, 120); }
      if (e.data.fm === 'snap') { // a picture of its screen, for the app's grid of machines (only the screen: the machine's own picture)
        const c = screens[0];
        if (c && c.width > 0) {
          try {
            const w = Math.min(560, c.width), o = document.createElement('canvas');
            o.width = w; o.height = Math.max(1, Math.round(c.height * (w / c.width)));
            const g2 = o.getContext('2d');
            g2.drawImage(c, 0, 0, o.width, o.height);
            // a screen of one colour (nothing drawn yet) says so, and is asked again later
            const px = g2.getImageData(0, 0, o.width, o.height).data;
            let lo = 765, hi = 0;
            for (let k = 0; k < px.length; k += 4 * 97) { const v = px[k] + px[k + 1] + px[k + 2]; if (v < lo) lo = v; if (v > hi) hi = v; }
            parent.postMessage({ fm: 'snap', data: o.toDataURL('image/jpeg', 0.78), blank: hi - lo < 24 }, '*');
          } catch (_) {}
        }
      }
      if (e.data.fm === 'learn') setLearn(!!e.data.on);
      if (e.data.fm === 'learned') markLearned(e.data.maps || {});
      if (e.data.fm === 'learn-one') learnOne(e.data.key);
      if (e.data.fm === 'flush' && m._flush) m._flush();
      if (e.data.fm === 'scale' && m && m._setScale) m._setScale(e.data.k);
      if (e.data.fm === 'cc' && ctlByKey[e.data.key]) { try { ctlByKey[e.data.key].apply(FM.clamp(fin(e.data.v, 0), 0, 1)); } catch (er) { report(er); } }
      if (e.data.fm === 'mix') {
        fader.gain.setTargetAtTime(FM.clamp(fin(e.data.gain, 1), 0, 4), ac.currentTime, 0.03);
        chPan.pan.setTargetAtTime(FM.clamp(fin(e.data.pan, 0), -1, 1), ac.currentTime, 0.03);
      }
      if (e.data.fm === 'meter') meterOn = !!e.data.on;
      if (e.data.fm === 'ts') { document.documentElement.style.setProperty('--ts', e.data.ts); document.documentElement.style.setProperty('--tsc', e.data.tsc); } // the host's text size (kit.css)
      if (e.data.fm === 'no-mic') { noMic = true; micButtons.forEach(greyMic); }
      // hosts that map their own knobs (the Max for Live device) ask which controls exist
      // a host that draws the controls itself (the Android app) asks for all of them, with what it needs to draw each, and drives them
      if (e.data.fm === 'native-controls') { nat.on = !!e.data.on; hideNative(); }
      if (e.data.fm === 'press' && nat.btn[e.data.key]) { try { nat.btn[e.data.key].click(); } catch (er) { report(er); } }
      if (e.data.fm === 'cell' && stepsByKey[e.data.key]) { try { stepsByKey[e.data.key].api.set(e.data.r | 0, e.data.col | 0, !!e.data.on, true); } catch (er) { report(er); } }
      if (e.data.fm === 'controls' && e.data.native) {
        hideNative();
        try { parent.postMessage({ fm: 'controls', native: describeNative() }, '*'); } catch (_) {}
        return;
      }
      if (e.data.fm === 'controls') {
        const list = Object.keys(ctlByKey).map((key) => { const c = ctlByKey[key]; let v = null; try { v = c.get01 ? c.get01() : null; } catch (_) {} return { key, label: c.label, kind: c.kind, v }; });
        try { parent.postMessage({ fm: 'controls', list }, '*'); } catch (_) {}
      }
    });

    // ── controls ──
    const tempoKnobs = [];
    // ── memory: control values are reported to the page, which stores them per machine and hands
    // them back in cfg.state next time. Keys are creation order + label, stable for a given machine.
    const savedState = cfg.state || {};
    const restored = [];
    const changed = {};
    let ctlN = 0, quiet = false, stateTimer = 0;
    function remember(key, v) {
      if (quiet) return;
      changed[key] = v;
      clearTimeout(stateTimer);
      stateTimer = setTimeout(() => { try { parent.postMessage({ fm: 'state', values: Object.assign({}, changed) }, '*'); } catch (_) {} }, 250);
    }
    m._restore = () => { for (const r of restored) { try { r(); } catch (e) { report(e); } } };
    // ── keep: what you made on the screen (painted cells, popped bubbles, knitted rows…) survives a switch to
    // another machine, a theme change and a relaunch. m.keep(save, load): save() returns small plain data,
    // load(data) puts it back once, after build. The kit looks for changes every few seconds, and the page asks
    // for a last look (flush) before it closes the machine. ──
    const keeps = [];
    let lastKept = typeof savedState.$keep === 'string' ? savedState.$keep : '';
    m.keep = (save, load) => { if (typeof save === 'function') keeps.push({ save, load: typeof load === 'function' ? load : null }); };
    function keepNow() {
      if (!keeps.length) return;
      let s;
      try { s = JSON.stringify(keeps.map((k) => k.save())); } catch (e) { report(e); return; }
      if (s.length > 60000 || s === lastKept) return; // kept small: it travels with the project
      lastKept = s;
      changed.$keep = s;
      return true;
    }
    setInterval(() => { if (keepNow()) remember('$keep', changed.$keep); }, 4000);
    m._keepLoad = () => {
      if (typeof savedState.$keep !== 'string') return;
      let d;
      try { d = JSON.parse(savedState.$keep); } catch (_) { return; }
      keeps.forEach((k, i) => { if (k.load && Array.isArray(d) && d[i] != null) { try { k.load(d[i]); } catch (e) { report(e); } } });
    };
    m._flush = () => { // the page is about to close this machine: everything not yet reported, now
      keepNow();
      clearTimeout(stateTimer);
      try { parent.postMessage({ fm: 'state', values: Object.assign({}, changed) }, '*'); parent.postMessage({ fm: 'flushed' }, '*'); } catch (_) {}
    };
    // MIDI notes in: machines play them their own way with m.onNote; otherwise the kit plays the machine's
    // current voice (m.voiceNote) at the note's pitch, and a pluck only before the machine has made a sound
    const noteFns = [];
    m.onNote = (fn) => { if (typeof fn === 'function') noteFns.push(fn); };
    m.voiceNote = (n, v, o = {}) => {
      const f = FM.mtof(n), vel = FM.clamp(fin(v, 100), 1, 127) / 127;
      playingNote = true;
      try {
        if (lastVoice) {
          const k = f / lastVoice.f, p = Object.assign({}, lastVoice.o, o);
          delete p.t; p.freq = f;
          p.gain = FM.clamp(fin(lastVoice.o.gain, 0.2), 0.04, 0.5) * (0.45 + 0.75 * vel);
          if (p.cutoff) p.cutoff = FM.clamp(p.cutoff * Math.sqrt(k), 60, 18000);
          if (lastVoice.kind === 'tone') { p.d = Math.max(0.25, fin(p.d, 0.4)); m.tone(p); } else if (lastVoice.kind === 'pluck') { p.d = Math.max(0.6, fin(p.d, 2)); m.pluck(p); } else { p.d = Math.max(0.2, fin(p.d, 0.3)); m[lastVoice.kind](p); }
        } else m.pluck(Object.assign({ freq: f, gain: 0.12 + vel * 0.3, d: 1.6, bright: 0.3 + vel * 0.5, send: 0.2 }, o));
      } finally { playingNote = false; }
    };
    function noteIn(n, v, on) {
      n = Math.round(fin(n, 60)); v = FM.clamp(fin(v, 100), 0, 127);
      if (noteFns.length) { for (const fn of noteFns) { try { fn(n, v, on); } catch (e) { report(e); } } return; }
      if (on && v > 0) m.voiceNote(n, v);
    }
    // MIDI learn: in learn mode, clicking a control picks it; the page then binds the next CC to it
    const ctlByKey = {};
    const stepsByKey = {};   // step grids, by key (the app draws them natively)
    let stepN = 0, readN = 0, btnN = 0;
    let learning = false;
    // apply(v01) is how the page moves it (a macro, a learned CC); get01() reads it back, 0…1
    let fromHost = false;
    function registerCtl(key, label, wrap, apply, kind, get01) {
      const ap = (v01) => { fromHost = true; try { apply(v01); } finally { fromHost = false; } };
      ctlByKey[key] = { label, wrap, apply: ap, get01, kind: kind || ({ t: 'toggle', s: 'select' }[key[0]] || 'knob') };
      wrap.dataset.key = key;
    }
    // ── native controls: every control of the machine, in the order and sections it is drawn in ──
    const nat = { on: !!cfg.nativeControls, btn: {} };
    const txt = (e) => (e ? e.textContent.trim() : '');
    function describeNative() {
      const out = [];
      document.querySelectorAll('.sec').forEach((sec) => {
        const secLabel = txt(sec.querySelector(':scope > .sec-label'));
        sec.querySelectorAll('.ctl').forEach((w) => {
          const label = txt(w.querySelector(':scope > .lbl'));
          const key = w.dataset.key;
          const c = key && ctlByKey[key];
          if (c) {
            let v = null; try { v = c.get01 ? c.get01() : null; } catch (_) {}
            const d = { key, kind: c.kind, label: c.label || label, sec: secLabel, v };
            if (sec.dataset.fx) d.fx = sec.dataset.fx;   // a control of an inserted effect (the Mixer's insert): drawn as the effect
            if (c.kind === 'knob') d.text = txt(w.querySelector('.val'));
            else if (c.kind === 'toggle') d.text = txt(w.querySelector('.tog'));
            else if (c.kind === 'select') { const s = w.querySelector('select'); d.options = s ? [...s.options].map((o) => o.text) : []; d.text = s && s.selectedIndex >= 0 ? s.options[s.selectedIndex].text : ''; }
            out.push(d);
          } else if (key && stepsByKey[key]) {
            const g = stepsByKey[key], cells = [];
            for (let r = 0; r < g.rows; r++) for (let k = 0; k < g.cols; k++) cells.push(g.api.get(r, k) ? '1' : '0');
            const ph = w.querySelector('.cell.ph');
            out.push({ key, kind: 'steps', label: g.label || label, sec: secLabel, rows: g.rows, cols: g.cols, cells: cells.join(''), ph: ph ? +ph.dataset.c : -1 });
          } else if (w.querySelector('.btn')) {
            const b = w.querySelector('.btn'); const k = w.dataset.key || (w.dataset.key = 'b' + (btnN++)); nat.btn[k] = b;
            out.push({ key: k, kind: 'button', label, sec: secLabel, text: txt(b) });
          } else if (w.querySelector('.readout')) {
            const k = w.dataset.key || (w.dataset.key = 'r' + (readN++));
            out.push({ key: k, kind: 'readout', label, sec: secLabel, text: txt(w.querySelector('.readout')) });
          }
        });
      });
      return out;
    }
    // the controls the app draws are taken off the machine's own page (the screen stays, and anything the app does not draw: the XY pads)
    let hid = 0;
    function hideNative() {
      if (!nat.on) return;
      let n = 0;
      document.querySelectorAll('.sec .ctl').forEach((w) => {
        if (w.style.display === 'none') return;
        if (w.classList.contains('xy-ctl') || w.querySelector('.xy')) return;
        if (w.dataset.key || w.querySelector('.btn') || w.querySelector('.readout')) { w.style.display = 'none'; n++; }
      });
      document.querySelectorAll('.sec').forEach((sec) => {
        if (sec.classList.contains('screen-sec') || sec.style.display === 'none') return;   // (the screen stays)
        const ctls = [...sec.querySelectorAll('.ctl')];
        if (!ctls.length) return;                                                          // (a section of something else stays too)
        const grid = sec.querySelector('.sec-grid');
        const left = grid ? [...grid.children].some((c) => c.style.display !== 'none') : false;
        if (ctls.every((w) => w.style.display === 'none') && !left) { sec.style.display = 'none'; n++; }
      });
      if (n) { hid += n; try { window.dispatchEvent(new Event('resize')); } catch (_) {} }
    }
    setInterval(hideNative, 600);
    // a control moved by hand: the page passes it on to the host as an automation parameter (Macro 1–8), with
    // touch and release around a drag (g: 'begin' / 'end'; 'tap' for a click), so hosts can record it
    function touched(key, v01, g) {
      if (fromHost || quiet) return;
      try { parent.postMessage({ fm: 'ctl', key, v: FM.clamp(fin(v01, 0), 0, 1), g: g || '' }, '*'); } catch (_) {}
    }
    function setLearn(on) { learning = on; document.body.classList.toggle('learning', on); if (!on) document.querySelectorAll('.ctl.picked').forEach((x) => x.classList.remove('picked')); }
    m._setLearn = (on) => setLearn(on);
    m._markLearned = (maps) => markLearned(maps);
    function markLearned(maps) {
      for (const k in ctlByKey) {
        const w = ctlByKey[k].wrap;
        if (maps[k] != null) w.dataset.cc = 'CC' + maps[k]; else delete w.dataset.cc;
      }
    }
    window.addEventListener('pointerdown', (e) => {
      if (!learning) return;
      const w = e.target.closest && e.target.closest('.ctl[data-key]');
      e.preventDefault(); e.stopPropagation();
      if (!w) return;
      document.querySelectorAll('.ctl.picked').forEach((x) => x.classList.remove('picked'));
      w.classList.add('picked');
      parent.postMessage({ fm: 'learn-pick', key: w.dataset.key, label: ctlByKey[w.dataset.key].label }, '*');
    }, true);
    window.addEventListener('click', (e) => { if (learning) { e.preventDefault(); e.stopPropagation(); } }, true);
    // right-click a control (the app and the AUv3): the page opens its MIDI learn menu there
    if (cfg.ctxLearn) {
      window.addEventListener('contextmenu', (e) => {
        const w = e.target.closest && e.target.closest('.ctl[data-key]');
        if (!w) return;
        e.preventDefault();
        parent.postMessage({ fm: 'learn-ctx', key: w.dataset.key, label: ctlByKey[w.dataset.key].label, x: e.clientX, y: e.clientY }, '*');
      });
    }
    function learnOne(key) {
      document.querySelectorAll('.ctl.solo').forEach((x) => x.classList.remove('solo'));
      if (key && ctlByKey[key]) ctlByKey[key].wrap.classList.add('solo');
    }
    const keySelects = [];
    const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    function setKey(k) {
      if (k && FM.scales[k.scale] && isFinite(k.pc)) {
        if (!keySaved) keySaved = { root: m.root, scale: m.scale, selects: keySelects.map((x) => x.get()) };
        keyLock = null; // let the selects' own handlers through while we move them
        m.root = nearestPc(keySaved.root, k.pc);
        m.scale = k.scale;
        for (const x of keySelects) {
          if (x.role === 'scale') x.set(k.scale);
          else { const name = NOTE[((k.pc % 12) + 12) % 12]; x.set(name); }
        }
        keyLock = { pc: ((k.pc % 12) + 12) % 12, scale: k.scale };
        m.root = nearestPc(keySaved.root, keyLock.pc);
        m.scale = k.scale;
      } else if (keySaved) {
        keyLock = null;
        keySelects.forEach((x, i) => x.set(keySaved.selects[i]));
        m.root = keySaved.root; m.scale = keySaved.scale;
        keySaved = null;
      }
      for (const x of keySelects) x.el && x.el.classList.toggle('mastered', !!keyLock);
    }
    m._setKey = (k) => setKey(k);
    function setMaster(bpm) {
      masterBpm = fin(bpm, 0) > 0 ? FM.clamp(bpm, 20, 400) : 0;
      quiet = true;
      for (const k of tempoKnobs) {
        if (masterBpm) { if (k.saved == null) k.saved = k.api.value; k.api.set(masterBpm, true); }
        else if (k.saved != null) { k.api.set(k.saved, true); k.saved = null; }
        k.api.el.classList.toggle('mastered', !!masterBpm);
      }
      quiet = false;
    }
    m._setMaster = setMaster;
    // drift, for long hands-free sessions: the first smooth knobs (the Macros; Tempo and stepped knobs aside) wander
    // slowly round where you left them, each on its own long, uneven wave of one to four minutes, so a machine left
    // alone keeps changing. Touch one and it wanders round its new place; turned off, every knob goes back home.
    // Never sent on as automation (hosts would record it). Off unless the page turns it on ({ fm: 'drift', on }).
    const DRIFT_DEPTH = 0.13, DRIFT_KNOBS = 6;
    let drift = null;
    function setDrift(on) {
      if (!!drift === !!on) return;
      if (!on) {
        clearInterval(drift.timer);
        for (const d of drift.knobs) { const c = ctlByKey[d.key]; if (c && Math.abs(c.get01() - d.last) < 0.004) c.apply(d.home); }
        drift = null;
        return;
      }
      const r = () => Math.random();
      const knobs = Object.keys(ctlByKey).filter((k) => ctlByKey[k].kind === 'knob' && ctlByKey[k].fine && !/^(tempo|bpm)$/i.test(ctlByKey[k].label))
        .slice(0, DRIFT_KNOBS).map((key) => {
          const v = ctlByKey[key].get01();
          return { key, home: v, last: v, per: [60 + r() * 180, 23 + r() * 40], ph: [r() * 6.28, r() * 6.28], dir: r() < 0.5 ? -1 : 1 };
        });
      drift = { knobs, t0: performance.now() / 1000, timer: setInterval(driftTick, 250) };
    }
    function driftTick() {
      if (!drift || !powered) return;
      const t = performance.now() / 1000 - drift.t0;
      for (const d of drift.knobs) {
        const c = ctlByKey[d.key];
        if (!c) continue;
        const now = c.get01();
        if (Math.abs(now - d.last) > 0.004) d.home = now; // moved by hand, a macro or a controller: its new home
        const fade = Math.min(1, t / 20); // (it sets off gently)
        const w = 0.8 * Math.sin((6.2832 * t) / d.per[0] + d.ph[0]) + 0.2 * Math.sin((6.2832 * t) / d.per[1] + d.ph[1]);
        c.apply(FM.clamp(d.home + d.dir * DRIFT_DEPTH * fade * (w - 0.8 * Math.sin(d.ph[0]) - 0.2 * Math.sin(d.ph[1])), 0, 1));
        d.last = c.get01();
      }
    }
    m._setDrift = setDrift;
    function knob(parent, o) {
      // a Tempo knob reaches down to 40 bpm whatever its machine asked, so the master tempo is followed that low too
      const isTempo = /^(tempo|bpm)$/i.test(o.label || '') && fin(o.min, 0) > 40 && fin(o.max, 1) > 40;
      const min = isTempo ? 40 : fin(o.min, 0), max = fin(o.max, 1), step = fin(o.step, 0);
      const exp = o.curve === 'exp' && min > 0;
      const toN = (v) => (exp ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min || 1));
      const fromN = (n) => {
        n = FM.clamp(n, 0, 1);
        let v = exp ? min * Math.pow(max / min, n) : min + n * (max - min);
        if (step) v = Math.round(v / step) * step;
        return FM.clamp(v, Math.min(min, max), Math.max(min, max));
      };
      let value = fromN(toN(fin(o.value, min)));
      const def = value;
      const key = 'k' + (ctlN++) + ':' + (o.label || '');
      if (key in savedState && isFinite(savedState[key])) {
        value = fromN(toN(savedState[key]));
        if (value !== def && o.onChange) restored.push(() => o.onChange(value));
      }
      const wrap = el('div', 'ctl knob', parent);
      el('div', 'lbl', wrap, o.label || '');
      // (the Steam Deck app shows an arrow each side of the dial, CSS: a tap works on its touch screen where a drag does not)
      const krow = el('div', 'k-row', wrap);
      const kbtn = (txt, dir) => { const b = el('button', 'k-arrow', krow, txt); b.type = 'button'; b.tabIndex = -1; b.setAttribute('aria-label', (o.label || 'knob') + (dir < 0 ? ' down' : ' up')); b.dataset.dir = dir; return b; };
      const kdown = kbtn('\u25C0', -1);
      const svg = svgEl('svg', { viewBox: '0 0 40 40', tabindex: '0', role: 'slider', 'aria-label': o.label || 'knob' }, krow);
      const kup = kbtn('\u25B6', 1);
      svgEl('path', { d: arcPath(20, 20, 15, -135, 135), class: 'k-track' }, svg);
      const valArc = svgEl('path', { d: '', class: 'k-val' }, svg);
      const needle = svgEl('line', { x1: 20, y1: 20, x2: 20, y2: 6, class: 'k-needle' }, svg);
      const readout = el('div', 'val', wrap);
      // the readout keeps the width of its longest value (62 % → 100 %, 9.5 → 10.0): the knob, and the column it stands
      // in, never shift while you turn it. Measured in characters, from the values at both ends and the start
      const fmtV = (v) => { try { return String(o.fmt ? o.fmt(v) : defaultFmt(v, o)); } catch (_) { return ''; } };
      let widest = Math.max(fmtV(min).length, fmtV(max).length, fmtV(value).length, fmtV((min + max) / 2).length);
      readout.style.minWidth = (widest + 1) + 'ch';   // (+1: a % or an m is wider than a digit in most faces)
      const bip = min < 0 && max > 0;
      function draw() {
        const n = toN(value);
        const a = -135 + 270 * n;
        const a0 = bip ? -135 + 270 * toN(0) : -135;
        valArc.setAttribute('d', arcPath(20, 20, 15, Math.min(a0, a), Math.max(a0, a)));
        needle.setAttribute('transform', `rotate(${a.toFixed(1)} 20 20)`);
        const txt = o.fmt ? o.fmt(value) : defaultFmt(value, o);
        readout.textContent = txt;
        if (String(txt).length > widest) { widest = String(txt).length; readout.style.minWidth = (widest + 1) + 'ch'; } // (only ever wider)
        svg.setAttribute('aria-valuenow', String(value));
      }
      function set(v, fire) {
        const nv = fromN(toN(v));
        if (nv === value && !fire) { draw(); return; }
        value = nv; draw();
        if (fire) { remember(key, value); touched(key, toN(value)); }
        if (fire && o.onChange) { try { o.onChange(value); } catch (e) { report(e); } }
      }
      let sy = 0, sn = 0;
      // a drag is followed on the window, not only by pointer capture: a touch screen (the Steam Deck's, in Game Mode)
      // may not keep the capture, and then the knob would turn for the first pixel and stop
      let dragId = null;
      const move = (e) => {
        if (dragId === null || e.pointerId !== dragId) return;
        set(fromN(sn + (sy - e.clientY) / (e.shiftKey ? 700 : 160)), true);
      };
      const end = (e) => {
        if (dragId === null || e.pointerId !== dragId) return;
        dragId = null;
        window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', end, true); window.removeEventListener('pointercancel', end, true);
        touched(key, toN(value), 'end');
      };
      svg.addEventListener('pointerdown', (e) => {
        if (dragId !== null) return;
        dragId = e.pointerId; sy = e.clientY; sn = toN(value); e.preventDefault();
        try { svg.setPointerCapture(e.pointerId); } catch (_) {}
        try { svg.focus({ preventScroll: true }); } catch (_) {}
        window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', end, true); window.addEventListener('pointercancel', end, true);
        touched(key, toN(value), 'begin');
      });
      // an arrow: one tap is a notch you can see (a step of a stepped knob, else a twelfth of the way); held, it
      // repeats in finer steps, so a long press glides across instead of jumping
      const nudge = (dir, fine) => set(fromN(step && (max - min) / step <= 40 ? toN(value + dir * step) : toN(value) + dir * (fine ? 0.025 : 1 / 12)), true);
      for (const b of [kdown, kup]) {
        let t1 = 0, t2 = 0, pid = null;
        const stop = (e) => { if (pid === null || (e && e.pointerId !== pid)) return; pid = null; clearTimeout(t1); clearInterval(t2); touched(key, toN(value), 'end'); };
        b.addEventListener('pointerdown', (e) => {
          if (pid !== null) return;
          pid = e.pointerId; e.preventDefault(); const dir = +b.dataset.dir;
          touched(key, toN(value), 'begin'); nudge(dir);
          t1 = setTimeout(() => { t2 = setInterval(() => nudge(dir, true), 70); }, 400);
        });
        b.addEventListener('pointerup', stop); b.addEventListener('pointercancel', stop); b.addEventListener('lostpointercapture', stop);
        b.addEventListener('contextmenu', (e) => e.preventDefault());
      }
      svg.addEventListener('dblclick', () => set(def, true));
      svg.addEventListener('wheel', (e) => { e.preventDefault(); set(fromN(toN(value) - e.deltaY * 0.0012), true); }, { passive: false });
      svg.addEventListener('keydown', (e) => {
        const k = e.key;
        const inc = step && (max - min) / step <= 40 ? step : (max - min) / 100;
        if (k === 'ArrowUp' || k === 'ArrowRight') { set(step || !exp ? value + inc : fromN(toN(value) + 0.01), true); e.preventDefault(); }
        if (k === 'ArrowDown' || k === 'ArrowLeft') { set(step || !exp ? value - inc : fromN(toN(value) - 0.01), true); e.preventDefault(); }
      });
      draw();
      const api = { get value() { return value; }, set: (v, fire) => set(v, fire), el: wrap };
      registerCtl(key, o.label || '', wrap, (v01) => set(fromN(v01), true), 'knob', () => toN(value));
      ctlByKey[key].fine = !step || (max - min) / step >= 24; // (smooth enough to drift: not semitones or counts)
      if (/^(tempo|bpm)$/i.test(o.label || '')) tempoKnobs.push({ api, saved: null });
      return api;
    }

    function toggle(parent, o) {
      let value = !!o.value;
      const key = 't' + (ctlN++) + ':' + (o.label || o.text || '');
      if (key in savedState && !!savedState[key] !== value) {
        value = !!savedState[key];
        if (o.onChange) restored.push(() => o.onChange(value));
      }
      const wrap = el('div', 'ctl', parent);
      if (o.label) el('div', 'lbl', wrap, o.label);
      const b = el('button', 'tog', wrap);
      function draw() { b.classList.toggle('on', value); b.textContent = o.text || (value ? 'On' : 'Off'); b.setAttribute('aria-pressed', String(value)); }
      b.addEventListener('click', () => { value = !value; draw(); remember(key, value); touched(key, value ? 1 : 0, 'tap'); if (o.onChange) { try { o.onChange(value); } catch (e) { report(e); } } });
      draw();
      registerCtl(key, o.label || o.text || '', wrap, (v01) => {
        const nv = v01 >= 0.5;
        if (nv !== value) { value = nv; draw(); remember(key, value); if (o.onChange) o.onChange(value); }
      }, 'toggle', () => (value ? 1 : 0));
      return { get value() { return value; }, set: (v, fire) => { value = !!v; draw(); if (fire && o.onChange) o.onChange(value); }, el: wrap };
    }

    function select(parent, o) {
      const opts = (o.options || []).map((x) => (typeof x === 'object' ? x : { value: String(x), label: String(x) }));
      let value = o.value != null ? String(o.value) : opts[0] && opts[0].value;
      const key = 's' + (ctlN++) + ':' + (o.label || '');
      const keyRole = /^scale$/i.test(o.label || '') ? 'scale' : /^(root|key)$/i.test(o.label || '') ? 'root' : null;
      if (key in savedState && opts.some((x) => x.value === String(savedState[key])) && String(savedState[key]) !== value) {
        value = String(savedState[key]);
        if (o.onChange) restored.push(() => o.onChange(value));
      }
      const wrap = el('div', 'ctl', parent);
      if (o.label) el('div', 'lbl', wrap, o.label);
      const w = el('div', 'selw', wrap);
      const s = el('select', 'sel', w);
      for (const x of opts) { const op = el('option', null, s, x.label); op.value = x.value; }
      s.value = value;
      const sel01 = () => { const i = opts.findIndex((x) => x.value === value); return opts.length > 1 ? Math.max(0, i) / (opts.length - 1) : 0; };
      s.addEventListener('change', () => { value = s.value; remember(key, value); touched(key, sel01(), 'tap'); if (o.onChange) { try { o.onChange(value); } catch (e) { report(e); } } });
      if (keyRole) keySelects.push({ role: keyRole, el: wrap, opts, get: () => value, set: (v) => { if (opts.some((x) => x.value === v) && v !== value) { value = v; s.value = v; if (o.onChange) { try { o.onChange(v); } catch (e) { report(e); } } } } });
      registerCtl(key, o.label || '', wrap, (v01) => {
        const nv = opts[Math.min(opts.length - 1, Math.round(v01 * (opts.length - 1)))].value;
        if (nv !== value) { value = nv; s.value = value; remember(key, value); if (o.onChange) o.onChange(value); }
      }, 'select', sel01);
      return { get value() { return value; }, set: (v, fire) => { value = String(v); s.value = value; if (fire && o.onChange) o.onChange(value); }, el: wrap };
    }

    function button(parent, o) {
      const wrap = el('div', 'ctl', parent);
      if (o.label) el('div', 'lbl', wrap, o.label);
      const b = el('button', 'btn', wrap, o.text || 'Go');
      b.addEventListener('click', () => {
        b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 120);
        pressing = b;
        if (o.onPress) { try { o.onPress(); } catch (e) { report(e); } }
        pressing = null;
      });
      return { el: wrap };
    }

    function readout(parent, o) {
      const wrap = el('div', 'ctl', parent);
      if (o.label) el('div', 'lbl', wrap, o.label);
      const v = el('div', 'readout', wrap, o.value != null ? String(o.value) : '—');
      return { set: (t) => { v.textContent = String(t); v.title = String(t); }, el: wrap }; // title: the whole text, if it's cut short
    }

    function steps(parent, o) {
      const rows = Math.max(1, fin(o.rows, 1)), cols = Math.max(1, fin(o.cols, 16));
      const cell = fin(o.cell, 14);
      const wrap = el('div', 'ctl steps-ctl', parent);
      if (o.label) el('div', 'lbl', wrap, o.label);
      const grid = el('div', 'steps', wrap);
      const stepKey = 'g' + (stepN++); wrap.dataset.key = stepKey;
      grid.style.gridTemplateColumns = `repeat(${cols}, ${cell}px)`;
      const state = [];
      const cells = [];
      for (let r = 0; r < rows; r++) {
        state.push([]); cells.push([]);
        for (let c = 0; c < cols; c++) {
          const on = typeof o.value === 'function' ? !!o.value(r, c) : !!(o.value && o.value[r] && o.value[r][c]);
          state[r].push(on);
          const d = el('div', 'cell' + (on ? ' on' : '') + (c % 4 === 0 ? ' beat' : ''), grid);
          d.style.width = d.style.height = cell + 'px';
          d.dataset.r = r; d.dataset.c = c;
          cells[r].push(d);
        }
      }
      let paint = null;
      grid.addEventListener('pointerdown', (e) => {
        const t = e.target.closest('.cell'); if (!t) return;
        const r = +t.dataset.r, c = +t.dataset.c;
        paint = !state[r][c];
        api.set(r, c, paint, true);
        grid.setPointerCapture(e.pointerId);
      });
      grid.addEventListener('pointermove', (e) => {
        if (paint == null) return;
        const t = document.elementFromPoint(e.clientX, e.clientY);
        if (t && t.classList.contains('cell') && grid.contains(t)) {
          const r = +t.dataset.r, c = +t.dataset.c;
          if (state[r][c] !== paint) api.set(r, c, paint, true);
        }
      });
      grid.addEventListener('pointerup', () => { paint = null; });
      let ph = -1;
      const api = {
        rows, cols,
        get: (r, c) => !!(state[r] && state[r][c]),
        set: (r, c, on, fire) => {
          if (!state[r] || c < 0 || c >= cols) return;
          state[r][c] = !!on; cells[r][c].classList.toggle('on', !!on);
          if (fire && o.onChange) { try { o.onChange(r, c, !!on); } catch (e) { report(e); } }
        },
        playhead: (c) => {
          if (c === ph) return;
          for (let r = 0; r < rows; r++) { if (ph >= 0 && cells[r][ph]) cells[r][ph].classList.remove('ph'); if (c >= 0 && cells[r][c]) cells[r][c].classList.add('ph'); }
          ph = c;
        },
        el: wrap,
      };
      stepsByKey[stepKey] = { api, rows, cols, label: o.label || '' };
      return api;
    }

    function xy(parent, o) {
      const w = fin(o.w, 110), h = fin(o.h, 80);
      let x = FM.clamp(fin(o.x, 0.5), 0, 1), y = FM.clamp(fin(o.y, 0.5), 0, 1);
      const wrap = el('div', 'ctl', parent);
      if (o.label) el('div', 'lbl', wrap, o.label);
      const pad = el('div', 'xy', wrap);
      pad.style.width = w + 'px'; pad.style.height = h + 'px';
      const dot = el('div', 'xy-dot', pad);
      const hl = el('div', 'xy-h', pad), vl = el('div', 'xy-v', pad);
      function draw() {
        dot.style.left = x * w + 'px'; dot.style.top = (1 - y) * h + 'px';
        hl.style.top = (1 - y) * h + 'px'; vl.style.left = x * w + 'px';
      }
      function from(e) {
        const r = pad.getBoundingClientRect();
        x = FM.clamp((e.clientX - r.left) / r.width, 0, 1);
        y = FM.clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
        draw();
        if (o.onChange) { try { o.onChange(x, y); } catch (er) { report(er); } }
      }
      pad.addEventListener('pointerdown', (e) => { pad.setPointerCapture(e.pointerId); from(e); });
      pad.addEventListener('pointermove', (e) => { if (pad.hasPointerCapture(e.pointerId)) from(e); });
      draw();
      return { get x() { return x; }, get y() { return y; }, set: (nx, ny) => { x = FM.clamp(nx, 0, 1); y = FM.clamp(ny, 0, 1); draw(); }, el: wrap };
    }

    m.section = (label, opts = {}) => {
      const s = el('div', 'sec', body);
      if (label) el('div', 'sec-label', s, label);
      const grid = el('div', 'sec-grid', s);
      grid.style.gridTemplateColumns = `repeat(${opts.cols || 3}, auto)`;
      return {
        el: s,
        knob: (o) => knob(grid, o),
        toggle: (o) => toggle(grid, o),
        select: (o) => select(grid, o),
        button: (o) => button(grid, o),
        readout: (o) => readout(grid, o),
        steps: (o) => steps(grid, o),
        xy: (o) => xy(grid, o),
      };
    };

    // flex screens can take any size the host offers (the Live device's full strip in Screen only);
    // the machine hears about it through scr.onResize(fn(w, h)) and reads scr.w / scr.h, which are live
    const flexScreens = [], fixedScreens = [];
    // a fixed screen as large as the box allows (stage), or back to its own size (null)
    m._zoomScreen = (box) => {
      if (!fixedScreens.length || flexScreens.some((x) => x !== m._insFlex)) return false;   // (an effect's own flex screen doesn't count: the machine's is fixed)
      const f = fixedScreens[0];
      f.zoom(box ? Math.max(1, Math.min(box.w / f.w0, box.h / f.h0, 4)) : 1);
      return true;
    };
    m._fillScreen = (box) => {
      if (!flexScreens.length) return false;
      const ins = m._insFlex || null, own = flexScreens.filter((x) => x !== ins);
      if (!own.length) {
        // a machine with a fixed screen and an effect with a flex one: the two share the box, the machine's screen as large as its
        // part allows (never past its own shape), the effect's the rest; alone (no box) each goes back to its own size
        const f = fixedScreens[0];
        if (box && !box.solo && f) {
          const G = 4, SEP = 17, wide = box.w > box.h * 1.2, sec = m._insSecEl;
          if (sec) { sec.classList.toggle('ins-beside', wide); sec.classList.toggle('ins-below', !wide); }
          const w1 = Math.round(box.w * 0.6), h1 = Math.round(box.h * 0.58);
          f.zoom(Math.max(1, Math.min((wide ? w1 - G : box.w) / f.w0, (wide ? box.h : h1 - G) / f.h0, 4)));
          if (wide) ins.size(box.w - w1 - SEP - G, box.h); else ins.size(box.w, box.h - h1 - SEP - G);
          return true;
        }
        if (m._insSecEl) m._insSecEl.classList.remove('ins-beside', 'ins-below');
        if (f) f.zoom(1);
        ins.reset();
        return !!box && !box.solo ? true : false;
      }
      if (box && ins && !box.solo) {
        // an effect on this machine (the Mixer's insert): the two screens share the box, the effect's beside the machine's
        // when it is wide, under it when it is tall (Screen only, and Android, which shows only the screens)
        // with air and an accent line between them (kit.css: .ins-beside / .ins-below), so the two touch areas never run together
        const G = 4, SEP = 17, wide = box.w > box.h * 1.2, sec = m._insSecEl;
        if (sec) { sec.classList.toggle('ins-beside', wide); sec.classList.toggle('ins-below', !wide); }
        if (wide) { const w1 = Math.round(box.w * 0.6); own[0].size(w1 - G, box.h); ins.size(box.w - w1 - SEP - G, box.h); }
        else { const h1 = Math.round(box.h * 0.58); own[0].size(box.w, h1 - G); ins.size(box.w, box.h - h1 - SEP - G); }
      } else {
        if (m._insSecEl) m._insSecEl.classList.remove('ins-beside', 'ins-below');
        if (box) { own[0].size(box.w, box.h); if (ins) ins.reset(); } else flexScreens.forEach((s) => s.reset());
      }
      return true;
    };
    // Live's strip: the screen takes the box it is given, smaller than its own size if need be (a fixed one is shrunk by CSS)
    m._liveScreen = (box) => {
      if (!box) { fixedScreens.forEach((f) => f.zoom(1)); flexScreens.forEach((f) => f.reset()); return; }
      const f = fixedScreens[0], x = flexScreens.filter((s) => s !== m._insFlex)[0];
      if (x) x.size(box.w, box.h);
      else if (f) f.zoom(FM.clamp(Math.min(box.w / f.w0, box.h / f.h0), 0.3, 1.6));
    };
    m._hasFlex = () => flexScreens.length > 0;
    // the tempo everything follows (the host's, the app's, the page's master), for effects that keep time without a clock
    Object.defineProperty(m, 'bpm', { get: () => masterBpm || 120, enumerable: true });
    // ── effects: the kit's own Mix and Level, made after the effect's controls (so its knobs are Macro 1…), how loud
    // it is going in and coming out (m.inLevel, m.outLevel: 0…1, smoothed, for the screen), and m.wave(array) /
    // m.outWave(array): the waveform going in / coming out, to draw ──
    m.inLevel = 0; m.outLevel = 0; m.kind = FX ? 'effect' : 'machine';
    if (FX) {
      const lb = new Float32Array(256), ob = new Float32Array(256);
      let lvN = 0;
      const rms = (an, buf) => { an.getFloatTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; s = Math.sqrt(s / buf.length); return s === s ? Math.min(1, s * 2.5) : 0; };
      setInterval(() => {
        if (unseen && ++lvN % 4) return;   // the plugin's window is closed: nothing is drawn, and the levels are read a quarter as often (an effect may still act on them)
        const a = rms(inAnalyser, lb), b = rms(analyser, ob);
        m.inLevel += (a - m.inLevel) * (a > m.inLevel ? 0.6 : 0.18);
        m.outLevel += (b - m.outLevel) * (b > m.outLevel ? 0.6 : 0.18);
      }, 33);
      const copy = (an, arr) => { if (arr && arr.length) { try { an.getFloatTimeDomainData(arr); } catch (_) {} } return arr; };
      m.wave = (arr) => copy(inAnalyser, arr);
      m.outWave = (arr) => copy(analyser, arr);
      m._fxFinish = () => {
        const s = m.section('Output', { cols: 2 });
        s.knob({ label: 'Mix', min: 0, max: 1, value: fxMix, fmt: FM.fmt.pct, onChange: (v) => { fxMix = FM.clamp(fin(v, 1), 0, 1); fxApply(); } });
        s.knob({ label: 'Level', min: -24, max: 12, value: 0, fmt: FM.fmt.db, onChange: (v) => fxLevel.gain.setTargetAtTime(Math.pow(10, FM.clamp(fin(v, 0), -24, 12) / 20), ac.currentTime, 0.03) });
      };
      // nothing to feed it (the web, the Workbench): sources of its own, in its own audio context, on the tempo and in the key.
      // cfg.demo / a 'fxsrc' message from the page picks one: 'beat', 'bass', 'chords', 'clip' (a decoded file the page
      // sends: a voice, your own sound, a recording of the mic; it loops), or 'off'
      if (typeof ac.__fmInput !== 'function') {
        const srcBus = ac.createGain(); srcBus.gain.value = 0.9; srcBus.connect(fxIn);
        let kind = cfg.demo === false ? 'off' : typeof cfg.demo === 'string' ? cfg.demo : 'beat';
        let step = 0, next = 0, clip = null, clipNode = null;
        const play = (node, t, g, d, a) => {
          const e = ac.createGain(); e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(g, t + (a || 0.003)); e.gain.setTargetAtTime(0, t + (a || 0.003) + 0.004, d / 4);
          node.connect(e); e.connect(srcBus); node.start(t); node.stop(t + (a || 0) + d * 1.6 + 0.05);
          node.onended = () => { try { node.disconnect(); e.disconnect(); } catch (_) {} };
        };
        const kick = (t, g) => { const o = ac.createOscillator(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.06); play(o, t, g, 0.4); };
        const hat = (t, g) => { const n = ac.createBufferSource(); n.buffer = noiseBuf; const h = ac.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = 7000; n.connect(h); const e = ac.createGain(); e.gain.setValueAtTime(g, t); e.gain.setTargetAtTime(0, t + 0.004, 0.012); h.connect(e); e.connect(srcBus); n.start(t, Math.random()); n.stop(t + 0.12); n.onended = () => { try { n.disconnect(); h.disconnect(); e.disconnect(); } catch (_) {} }; };
        const snare = (t, g) => { const n = ac.createBufferSource(); n.buffer = noiseBuf; const b = ac.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = 1900; b.Q.value = 0.8; n.connect(b); const e = ac.createGain(); e.gain.setValueAtTime(g, t); e.gain.setTargetAtTime(0, t + 0.004, 0.05); b.connect(e); e.connect(srcBus); n.start(t, Math.random()); n.stop(t + 0.3); n.onended = () => { try { n.disconnect(); b.disconnect(); e.disconnect(); } catch (_) {} }; };
        const synth = (t, f, g, d, type, cut, a) => {
          const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
          const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2; lp.frequency.setValueAtTime(cut * 3, t); lp.frequency.setTargetAtTime(cut, t, d * 0.25);
          o.connect(lp);
          const e = ac.createGain(); e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(g, t + (a || 0.005)); e.gain.setTargetAtTime(0, t + (a || 0.005), d / 3);
          lp.connect(e); e.connect(srcBus); o.start(t); o.stop(t + (a || 0) + d * 1.8 + 0.05);
          o.onended = () => { try { o.disconnect(); lp.disconnect(); e.disconnect(); } catch (_) {} };
        };
        const BASS = [0, -1, 0, 0, -1, 7, 0, -1, 0, -1, 3, 0, -1, 4, -1, 2];   // scale degrees per 16th, -1 = rest
        const CHORDS = [[0, 2, 4, 6], [-2, 0, 2, 4], [3, 5, 7, 9], [4, 6, 8, 11]];
        function tick() {
          if (ac.state !== 'running' || kind === 'off' || kind === 'clip') { next = 0; return; }
          const now = ac.currentTime, sd = 60 / m.bpm / 4;
          if (next < now) next = now + 0.05;
          while (next < now + 0.15) {
            const k = step % 16, bar = Math.floor(step / 16) % 4;
            if (kind === 'beat') {
              if (k % 8 === 0 || k === 10) kick(next, 0.7);
              if (k === 4 || k === 12) snare(next, 0.32);
              if (k % 2 === 0) hat(next, k % 4 === 2 ? 0.16 : 0.08);
              if ([0, 3, 6, 8, 11, 14].includes(k)) { const b = ac.createBufferSource(); b.buffer = ksBuffer(m.freq([0, 2, 4, 7, 4, 2][[0, 3, 6, 8, 11, 14].indexOf(k)] + (bar === 3 ? 1 : 0), 1), 0.6); play(b, next, 0.26, 1.2); }
            } else if (kind === 'bass') {
              const d = BASS[k];
              if (d >= 0) synth(next, m.freq(d + (bar === 2 ? 3 : 0), -1), 0.42, 0.22, 'sawtooth', 380 + (k % 4 === 0 ? 500 : 0));
              if (k % 4 === 0) kick(next, 0.45);
            } else if (kind === 'chords') {
              if (k === 0) for (const d of CHORDS[bar]) synth(next, m.freq(d, 0), 0.11, 1.6, 'sawtooth', 1400, 0.04);
              if (k === 10) for (const d of CHORDS[bar].slice(0, 3)) synth(next, m.freq(d, 0), 0.07, 0.5, 'triangle', 2200);
              if (k % 8 === 0) synth(next, m.freq(CHORDS[bar][0], -1), 0.3, 0.8, 'triangle', 600);
            }
            step++; next += sd;
          }
        }
        setInterval(tick, 25);
        const stopClip = () => { if (clipNode) { try { clipNode.stop(); clipNode.disconnect(); } catch (_) {} clipNode = null; } };
        const startClip = () => {
          stopClip();
          if (!clip || kind !== 'clip') return;
          clipNode = ac.createBufferSource(); clipNode.buffer = clip; clipNode.loop = true; clipNode.connect(srcBus); clipNode.start();
        };
        m._fxSource = (k, data) => {
          kind = ['beat', 'bass', 'chords', 'clip', 'off'].includes(k) ? k : 'off';
          if (kind !== 'clip') { stopClip(); return; }
          if (!data) { startClip(); return; }
          ac.decodeAudioData(data).then((b) => {
            // normalised to a healthy level, so a quiet recording still drives the effect
            let pk = 0; for (let c = 0; c < b.numberOfChannels; c++) { const x = b.getChannelData(c); for (let i = 0; i < x.length; i += 4) pk = Math.max(pk, Math.abs(x[i])); }
            if (pk > 0 && pk < 0.7) for (let c = 0; c < b.numberOfChannels; c++) { const x = b.getChannelData(c), g = 0.7 / pk; for (let i = 0; i < x.length; i++) x[i] *= g; }
            clip = b; startClip();
            try { parent.postMessage({ fm: 'fxsrc-ok', seconds: b.duration }, '*'); } catch (_) {}
          }, () => { try { parent.postMessage({ fm: 'fxsrc-err' }, '*'); } catch (_) {} });
        };
        window.addEventListener('message', (e) => { if (e.source === parent && e.data && e.data.fm === 'fxsrc') m._fxSource(e.data.kind, e.data.data); });
      }
    }
    // ── an effect inserted on this machine (the site's Mixer: a channel's insert). It runs in this machine's own audio context,
    // between the machine's output and its fader: m.input is the machine's sound, what the effect sends to m.out is mixed
    // back with it (Mix, Level), and its controls and screen join the machine's panel. ──
    m._insertEffect = (spec, opt) => {
      if (FX || !spec || spec.kind !== 'effect' || typeof spec.build !== 'function') return;
      const inN = ac.createGain(), dry = ac.createGain(), wet = ac.createGain(), sum = ac.createGain(), lvl = ac.createGain(), eOut = ac.createGain();
      const inA = ac.createAnalyser(); inA.fftSize = 512; inA.smoothingTimeConstant = 0.5;
      const outA = ac.createAnalyser(); outA.fftSize = 512; outA.smoothingTimeConstant = 0.5;
      try { windG.disconnect(analyser); } catch (_) {}
      windG.connect(inN); inN.connect(inA); inN.connect(dry); dry.connect(sum);
      eOut.connect(wet); eOut.connect(outA); wet.connect(sum); sum.connect(lvl); lvl.connect(analyser);
      // the amount: the Mixer's slider for this channel (opt.mix) leads, else the effect's own starting mix
      let mix = FM.clamp(fin(opt && opt.mix, fin(spec.mix, 1)), 0, 1), mixKnob = null;
      const apply = () => { const t = ac.currentTime; wet.gain.setTargetAtTime(mix, t, 0.03); dry.gain.setTargetAtTime(1 - mix, t, 0.03); };
      apply();
      m._insertSync = () => { if (mixKnob) mixKnob.set(mix); };   // (after the saved knobs come back, the slider's amount stands)
      window.addEventListener('message', (e) => {
        if (e.source !== parent || !e.data || e.data.fm !== 'insert-mix') return;
        mix = FM.clamp(fin(e.data.v, mix), 0, 1); apply(); if (mixKnob) mixKnob.set(mix);
      });
      const fm = Object.create(m);
      const lb = new Float32Array(256);
      const rms = (an) => { an.getFloatTimeDomainData(lb); let x = 0; for (let i = 0; i < lb.length; i++) x += lb[i] * lb[i]; x = Math.sqrt(x / lb.length); return x === x ? Math.min(1, x * 2.5) : 0; };
      const copy = (an, arr) => { if (arr && arr.length) { try { an.getFloatTimeDomainData(arr); } catch (_) {} } return arr; };
      Object.assign(fm, {
        input: inN, out: eOut, inAnalyser: inA, inLevel: 0, outLevel: 0, kind: 'effect',
        wave: (arr) => copy(inA, arr), outWave: (arr) => copy(outA, arr),
        keep() {}, onNote() {}, onWind() {}, pads() {}, onSample() {}, nextSample() {}, requestMic() {},
      });
      let lvN = 0;
      setInterval(() => {
        if (unseen && ++lvN % 4) return;
        const a = rms(inA), b = rms(outA);
        fm.inLevel += (a - fm.inLevel) * (a > fm.inLevel ? 0.6 : 0.18);
        fm.outLevel += (b - fm.outLevel) * (b > fm.outLevel ? 0.6 : 0.18);
      }, 33);
      const before = new Set(body.children), flex0 = flexScreens.length;
      try { spec.build(fm); } catch (e) { report(e); }
      const fxName = (opt && opt.title) || spec.title || 'Effect';
      const sec = m.section('Effect · ' + fxName, { cols: 2 });
      mixKnob = sec.knob({ label: 'Mix', min: 0, max: 1, value: mix, fmt: FM.fmt.pct, onChange: (v) => { mix = FM.clamp(fin(v, 1), 0, 1); apply(); try { parent.postMessage({ fm: 'insmix', v: mix }, '*'); } catch (_) {} } });
      sec.knob({ label: 'Level', min: -24, max: 12, value: 0, fmt: FM.fmt.db, onChange: (v) => lvl.gain.setTargetAtTime(Math.pow(10, FM.clamp(fin(v, 0), -24, 12) / 20), ac.currentTime, 0.03) });
      // seen as added: the effect's sections are marked (kit.css), and its screen sits right after the machine's, so it shows
      // beside it (wide) or under it (stacked) rather than at the end of the panel; its controls follow the machine's
      const added = [...body.children].filter((c) => !before.has(c));
      added.forEach((c) => c.classList.add('ins-sec'));
      const insScr = added.find((c) => c.classList.contains('screen-sec')), mainScr = body.querySelector('.screen-sec:not(.ins-sec)');
      if (insScr && mainScr) mainScr.after(insScr);
      m._insSecEl = insScr || null;
      // the effect as one block of controls, after the machine's: its Mix and Level first, then every control of its own, each
      // section named after the effect ("Tunnel Vision · Train"), so it reads as the effect everywhere (Android and the
      // Apple apps draw these sections natively, by their labels)
      const own = added.filter((c) => c !== sec.el && !c.classList.contains('screen-sec'));
      for (const c of own) { const l = c.querySelector(':scope > .sec-label'); if (l) l.textContent = fxName + ' · ' + l.textContent; else { const nl = el('div', 'sec-label', null, fxName); c.prepend(nl); } }
      if (own.length) own[0].before(sec.el);
      sec.el.classList.add('ins-head');
      for (const c of added) c.dataset.fx = fxName;   // (the native controls, Android's, draw these as the effect: describeNative)
      m._insFlex = flexScreens.length > flex0 ? flexScreens[flex0] : null;
    };
    // a narrow stack (stackFit): the first flex screen takes the width, at its own height
    m._stackScreen = (w) => { if (flexScreens.length) flexScreens[0].size(w, flexScreens[0].h0); };
    // Screens draw at the density they are seen at: the display's pixel ratio times how much the page around
    // the machine enlarges it (the app and the Live device scale the whole machine to fill their window), so an
    // enlarged machine stays sharp, on a 1x external display most of all. Capped at 3x for speed.
    let viewK = FM.clamp(fin(cfg.scale, 1), 1, 3);
    const PIXEL = FM.clamp(fin(cfg.pixel, 1), 0.25, 1);   // a board with no graphics help (a Pi Zero): the screen draws at a fraction of its pixels, the page scales it up
    const density = () => { const d = cfg.lite ? 1 : Math.min(fin(cfg.maxDpr, 3), Math.max(1, Math.round((window.devicePixelRatio || 1) * viewK * 4) / 4)); return PIXEL < 1 ? Math.max(0.25, d * PIXEL) : d; };
    const densityFns = [];
    m._setScale = (k) => { viewK = FM.clamp(fin(k, 1), 1, 3); for (const fn of densityFns) fn(); };
    m.screen = (o = {}) => {
      let w = Math.round(fin(o.w, 320)), h = Math.round(fin(o.h, 200));
      const w0 = w, h0 = h;
      const s = el('div', 'sec screen-sec', body);
      let zoom = 1; // a fixed screen shown larger (stage): CSS enlarges it, it draws at the matching density
      if (o.label) el('div', 'sec-label', s, o.label);
      const box = el('div', 'screen', s);
      const canvas = el('canvas', null, box);
      screens.push(canvas);
      const dens = () => (unseen ? 0.04 : Math.min(3, Math.round(density() * zoom * 4) / 4)); // unseen: a canvas of a few pixels, so drawing costs next to nothing
      let dpr = dens(); // lite previews draw at 1x
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.touchAction = 'none';
      { // (a virtual finger, ids 9000+, is not a real pointer: capturing it would throw; it is always "captured")
        const cap = canvas.setPointerCapture.bind(canvas), has = canvas.hasPointerCapture.bind(canvas), rel = canvas.releasePointerCapture.bind(canvas);
        canvas.setPointerCapture = (id) => { if (id >= 9000) return; cap(id); };
        canvas.hasPointerCapture = (id) => (id >= 9000 ? true : has(id));
        canvas.releasePointerCapture = (id) => { if (id >= 9000) return; try { rel(id); } catch (_) {} };
      }
      const g = canvas.getContext('2d');
      g.scale(dpr, dpr);
      g.fillStyle = m.color('screen'); g.fillRect(0, 0, w, h);
      const pointer = (e) => {
        const r = canvas.getBoundingClientRect();
        return { x: ((e.clientX - r.left) * w) / r.width, y: ((e.clientY - r.top) * h) / r.height };
      };
      const resizeFns = [];
      function size(nw, nh) {
        nw = Math.max(60, Math.min(2400, Math.round(fin(nw, w0)))); nh = Math.max(40, Math.min(1200, Math.round(fin(nh, h0))));
        if (nw === w && nh === h) return;
        w = nw; h = nh;
        canvas.width = w * dpr; canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.fillStyle = m.color('screen'); g.fillRect(0, 0, w, h);
        for (const fn of resizeFns) { try { fn(w, h); } catch (e) { report(e); } }
      }
      const redraw = () => { // sharper or lighter when the enlargement changes; the machine redraws as on a resize
        const nd = dens();
        if (nd === dpr) return;
        dpr = nd;
        canvas.width = w * dpr; canvas.height = h * dpr;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.fillStyle = m.color('screen'); g.fillRect(0, 0, w, h);
        for (const fn of resizeFns) { try { fn(w, h); } catch (e) { report(e); } }
      };
      densityFns.push(redraw);
      if (o.flex) flexScreens.push({ size, h0, reset: () => size(w0, h0) });
      else fixedScreens.push({ w0, h0, zoom: (k) => { zoom = k; canvas.style.width = Math.round(w * k) + 'px'; redraw(); } });
      return {
        canvas, g, pointer, el: s, flex: !!o.flex,
        get w() { return w; }, get h() { return h; },
        onResize(fn) { if (typeof fn === 'function') resizeFns.push(fn); },
      };
    };

    // ── frame loop & meter ──
    const meterBuf = new Float32Array(analyser.fftSize);
    let level = 0, lastT = performance.now() / 1000;
    // the page's mixer meters: post-fader peak level, a few times a second while it is open
    let meterOn = !!cfg.meter;
    setInterval(() => {
      if (meterOn) { try { parent.postMessage({ fm: 'level', p: m.on ? level * fader.gain.value : 0, c: +cost.toFixed(2) }, '*'); } catch (_) {} }
    }, 70);
    // One step of everything that moves. Normally driven by requestAnimationFrame, but browsers
    // pause that for frames out of sight (a locked machine scrolled away, a background tab), and
    // some machines make their sound from here. So a timer keeps stepping whenever rAF goes quiet;
    // timers keep running in tabs that are playing audio.
    let lastRaf = 0;
    // frame governor: if a machine's frames cost more than BUDGET ms, it is stepped less often
    // (every 2nd, 3rd … 6th frame) so the device stays responsive; it recovers when it calms down
    const BUDGET = cfg.lite ? 4 : 7;
    let cost = 0, skip = 1, frameNo = 0;
    m._perf = () => ({ cost: +cost.toFixed(2), skip });
    function step() {
      const c0 = performance.now();
      const t = c0 / 1000;
      const dt = Math.min(0.05, Math.max(0.001, t - lastT));
      lastT = t;
      for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        if (f.errs > 20) continue;
        try { f.fn(t, dt); } catch (e) { f.errs++; if (f.errs === 1 || f.errs === 21) report(e); }
      }
      const c = performance.now() - c0;
      cost = cost ? cost * 0.92 + c * 0.08 : c;
      if (++frameNo % 30 === 0) {
        const want = FM.clamp(Math.ceil(cost / BUDGET), 1, 6);
        skip = want > skip ? want : cost < BUDGET * 0.4 ? Math.max(1, skip - 1) : skip;
        if (skip > 1) hotNote('frames');
      }
      analyser.getFloatTimeDomainData(meterBuf);
      let pk = 0;
      for (let i = 0; i < meterBuf.length; i += 4) pk = Math.max(pk, Math.abs(meterBuf[i]));
      level = Math.max(pk, level * 0.9);
    }
    function drawMeter() {
      mg.clearRect(0, 0, 120, 12);
      const segs = 20;
      for (let i = 0; i < segs; i++) {
        const lit = i / segs < level;
        mg.fillStyle = lit ? (i > segs * 0.85 ? m.color('accent') : m.color('accent2')) : m.color('track');
        mg.fillRect(i * 6, 0, 5, 12);
      }
    }
    // lite (silent previews on phones/tablets): ~20 fps while unpowered, and no off-screen stepping
    let lastStep = 0, loopN = 0, half = false, halfN = 0;
    // pace: a host that asks for fewer pictures (the Steam Deck's Performance setting) gets a step and a picture in every
    // pace-th frame; what sounds keeps its time (the clock is not the picture)
    let pace = Math.max(1, Math.min(4, Math.round(fin(cfg.pace, 1)))), paceN = 0;
    const FPSDIV = Math.max(2, Math.round(fin(cfg.fpsDiv, 1)));   // (a frame in 2 normally; a Pi Zero: a frame in 3 or more)
    // idle: the host says this window is not the one in front (Android gives such an app half the CPU): at most ~20 steps a second, and
    // the drawing with them, like a silent preview. What sounds is not touched (dt stays under 50 ms).
    let idle = !!cfg.idle, idleHideT = 0; if (idle) { verbIdle(true); m._setIdleHide(true); }
    // very large screens (Screen only or Stage on a big display, in the app): drawn 30 times a second, not 60. Their
    // dt is still small (stepping stays smooth, nothing that sounds changes), the drawing work halves.
    setInterval(() => {
      let px = 0;
      for (const c of screens) px += c.width * c.height;
      half = !!cfg.low || (!!cfg.maxDpr && px > 2.4e6);   // (low memory mode: always 30 a second)
    }, 1000);
    function loop() {
      lastRaf = performance.now();
      if (FX && unseen) { requestAnimationFrame(loop); return; }   // an effect out of sight (its plugin window closed) draws and steps nothing: its sound is all in the engine
      if (pace > 1 && paceN++ % pace) { requestAnimationFrame(loop); return; }
      if (half && halfN++ % FPSDIV) { requestAnimationFrame(loop); return; }
      if (!(((cfg.lite && !powered) || idle) && lastRaf - lastStep < 48) && (skip === 1 || loopN++ % skip === 0)) {
        lastStep = lastRaf;
        step();
        if (!unseen) drawMeter();
      }
      requestAnimationFrame(loop);
    }
    setInterval(() => {
      if ((cfg.lite && !powered) || (FX && unseen)) return;
      if (performance.now() - lastRaf > 120) step();
    }, 30);
    m._start = () => requestAnimationFrame(loop);
    m._errors = errors;
    FM._m = m; // handle for local measurement tools

    window.addEventListener('pagehide', () => { try { ac.close(); } catch (e) {} });
    return m;
  }

  function fault(root, msg) {
    const d = el('div', 'device broken', root);
    const h = el('div', 'head', d);
    el('div', 'led on', h);
    el('div', 'name', h, 'MALFUNCTION');
    el('div', 'faultbar', d, msg).style.display = 'block';
    try { parent.postMessage({ fm: 'error', message: msg }, '*'); } catch (_) {}
  }

  // Fit a host's box (the Max for Live device is a wide strip, ~500×169): try letting each section's
  // controls run in 1–3 rows instead of its designed columns, at several widths, and keep the layout
  // that can be shown biggest. Screens keep their size; only the control panels reflow.
  function fitStrip(root, box) {
    const dev = root.firstElementChild;
    if (!dev || !(box.w > 0 && box.h > 0)) return;
    const grids = sectionGrids(dev);
    root.style.maxWidth = 'none';
    root.style.flex = 'none'; // the trial widths may be wider than the frame
    const apply = (rows, width) => {
      for (const x of grids) x.g.style.gridTemplateColumns = rows ? `repeat(${Math.max(x.cols, Math.ceil(x.n / rows))}, auto)` : x.css;
      root.style.width = width + 'px';
    };
    let best = null;
    for (const rows of [0, 3, 2, 1]) {
      for (let width = 240; width <= 2400; width += 40) { // fine steps: the narrowest layout that fits shows biggest
        apply(rows, width);
        const r = dev.getBoundingClientRect();
        // a section squeezed narrower than its controls clips them: that layout doesn't count
        const clipped = [...dev.querySelectorAll('.sec')].some((x) => x.scrollWidth > x.clientWidth + 2);
        const s = Math.min(box.w / r.width, box.h / r.height) * (clipped ? 0.01 : 1);
        if (!best || s > best.s * 1.01) best = { s, rows, width };
      }
    }
    apply(best.rows, best.width + 32); // a little slack, so nothing that grows later can wrap a section
  }
  // Live's strip (the Max device is a fixed 169 px tall): the controls at their own size in as few rows as the height
  // allows (two), no header, and the screen gets the width that is left, shrunk to fit. Nothing is scaled as a whole,
  // so the dials stay as big as the effects' are
  function liveFit(root, box, m) {
    const dev = root.firstElementChild;
    if (!dev || !(box.w > 0 && box.h > 0)) return;
    document.body.classList.add('live-strip');
    root.style.maxWidth = 'none'; root.style.flex = 'none'; root.style.width = '2400px'; // (room to measure the controls)
    if (m && m._liveScreen) m._liveScreen(null);
    const grids = sectionGrids(dev);
    const secs = [...dev.querySelectorAll('.sec:not(.screen-sec)')];
    const apply = (rows) => { for (const x of grids) x.g.style.gridTemplateColumns = `repeat(${Math.max(1, Math.ceil(x.n / rows))}, auto)`; };
    let rows = 1;
    for (const r of [3, 2, 1]) { // the most rows the height allows: the narrowest controls, the biggest screen
      apply(r);
      if (Math.max(0, ...secs.map((x) => x.getBoundingClientRect().height)) <= box.h + 1) { rows = r; break; }
    }
    apply(rows);
    const sc = dev.querySelector('.screen-sec');
    for (const x of secs) x.style.zoom = '';
    let ctlW = secs.reduce((a, x) => a + x.getBoundingClientRect().width, 0);
    // the screen is what you play: keep it a usable width, the controls give up a little size for it (never below 70 %)
    const MIN_SCREEN = 210, spare = box.w - MIN_SCREEN - 2 * 8 - 4;
    if (sc && ctlW > spare) {
      const kz = FM.clamp(spare / ctlW, 0.7, 1);
      for (const x of secs) x.style.zoom = kz.toFixed(3);
      ctlW = secs.reduce((a, x) => a + x.getBoundingClientRect().width, 0);
    }
    if (sc && m && m._liveScreen) {
      const pad = 2 * 8 + 2, label = 0; // (the section labels are hidden in the strip)
      m._liveScreen({ w: Math.max(80, box.w - ctlW - pad - 2), h: Math.max(60, box.h - 2 * 4 - label - 2) });
    }
    const all = [...dev.querySelectorAll('.sec')].reduce((a, x) => a + x.getBoundingClientRect().width, 0);
    root.style.width = Math.ceil(Math.max(box.w - 24, all + 2)) + 'px'; // (the frame adds 12 px each side)
  }
  // each section's control grid with its designed columns, remembered the first time (a fit rewrites them)
  function sectionGrids(dev) {
    return [...dev.querySelectorAll('.sec-grid')].map((g) => {
      if (g.dataset.cols0 == null) g.dataset.cols0 = g.style.gridTemplateColumns;
      const m = /repeat\((\d+)/.exec(g.dataset.cols0);
      return { g, css: g.dataset.cols0, cols: m ? +m[1] : 3, n: g.children.length };
    });
  }

  // Stack for a narrow, tall host (the app on a phone held upright): as on the site's phone layout, the
  // sections go one under another at the host's width and the page scrolls; each section's controls take as
  // many columns as fit, in balanced rows. A flex screen widens to the width; other screens shrink to it.
  function stackFit(root, box, m) {
    const dev = root.firstElementChild;
    if (!dev || !(box.w > 0)) return;
    root.style.width = Math.round(box.w) + 'px';
    if (m && m._stackScreen) m._stackScreen(box.w - 20);
    for (const x of sectionGrids(dev)) {
      const sec = x.g.closest('.sec');
      const set = (c) => { x.g.style.gridTemplateColumns = `repeat(${c}, auto)`; };
      let cols = Math.max(1, x.n);
      set(cols);
      while (cols > 1 && sec && sec.scrollWidth > sec.clientWidth + 2) set(--cols);
      set(Math.ceil(x.n / Math.ceil(x.n / cols))); // 8 controls that fit 5 a row: two rows of 4, not 5 and 3
    }
  }

  // Stage: the controls scroll in a box of their own beside (or under) the screen, so the screen stays perfectly
  // still, also when the end of the scroll bounces (a screen recording stays steady)
  function stageWrap(on) {
    const bd = document.querySelector('#root .body');
    if (!bd) return;
    const w = bd.querySelector(':scope > .stage-ctl');
    if (on && !w) {
      const secs = [...bd.children].filter((x) => !x.classList.contains('screen-sec') || x.classList.contains('ins-sec'));   // (an insert's screen goes with the controls)
      if (!secs.length) return;
      bd._order = [...bd.children];
      const box = document.createElement('div');
      box.className = 'stage-ctl';
      bd.insertBefore(box, secs[0]);
      for (const s of secs) box.appendChild(s);
    } else if (!on && w) {
      w.remove();
      for (const n of bd._order || []) bd.appendChild(n); // (back in the order they were made)
      bd._order = null;
    }
  }
  function setFocus(mode) {
    document.body.classList.toggle('focus-screen', mode === 'screen');
    document.body.classList.toggle('focus-controls', mode === 'controls');
    document.body.classList.toggle('focus-stage', mode === 'stage');
    stageWrap(mode === 'stage');
    if (mode !== 'stage') {
      document.body.classList.remove('stage-tall');
      const bd = document.querySelector('#root .body'); if (bd) bd.style.height = '';
    }
  }

  // a drag on a knob, a step grid, an XY pad or a machine's screen turns or plays it: the page must not scroll instead.
  // touch-action (kit.css) says so, but a phone's browser (WebKit, in a frame of a scrolling page) may still scroll the
  // page around the frame; stopping the touch's first move does it everywhere. Taps still click
  document.addEventListener('touchmove', (e) => {
    const t = e.target;
    if (e.cancelable && t && t.closest && t.closest('.knob svg, .steps, .xy, .screen canvas')) e.preventDefault();
  }, { passive: false });

  FM.boot = function (cfg) {
    if (cfg.workerTimers) FM._timers.install();
    const root = document.getElementById('root');
    let m = null; // the machine (null if it did not assemble)
    if (cfg.flush) document.body.classList.add('flush');
    if (cfg.theme && cfg.theme.vars) {
      for (const k in cfg.theme.vars) document.documentElement.style.setProperty('--' + k, cfg.theme.vars[k]);
    }
    if (!SPEC || typeof SPEC.build !== 'function') {
      fault(root, 'This machine did not assemble. ' + (lastError || 'No FM.define() call found.'));
    } else {
      try {
        m = createMachine(cfg, root);
        SPEC.build(m);
        if (cfg.insert && FM._fxSpec) m._insertEffect(FM._fxSpec, cfg.insert);   // (an effect on this channel: the site's Mixer)
        if (m._fxFinish) m._fxFinish(); // an effect: the kit's Mix and Level, after its own controls
        m._scanPads(); // the drums it uses, from its code, are on the pads
        m._restore(); // re-apply remembered settings now that the machine is fully built
        m._keepLoad(); // and what was made on its screen
        if (m._insertSync) m._insertSync();
        if (cfg.maps) m._markLearned(cfg.maps);
        if (cfg.learn) m._setLearn(true);
        if (cfg.masterKey) m._setKey(cfg.masterKey);
        m._start();
        if (cfg.masterBpm) m._setMaster(cfg.masterBpm);
        if (cfg.drift) m._setDrift(true);
        // fit after this turn: hosts may restyle controls first (the Live device turns menus into arrows)
        setFocus(cfg.focus);
        if (cfg.fit) setTimeout(() => { layoutFor(cfg.focus, cfg.fill); post(); }, 0); // and say the new size
        try { parent.postMessage({ fm: 'caps', flex: m._hasFlex() }, '*'); } catch (_) {}
        if (cfg.power === false) m.ac.suspend(); // e.g. grid previews: silent until their power dot is pressed
        else m.power(true); // machines are on when you arrive
        if (m._fxFinish) for (const t of [150, 600, 1800]) setTimeout(() => { try { m._fxReapply(); } catch (_) {} }, t); // an effect's Mix and power, again once the native layer has settled: switching effects in a host left it dry until Mix was moved
      } catch (e) {
        if (m) m.report(e); else fault(root, String(e && e.message || e));
      }
    }
    // report the content's own size (not the viewport's, which would never let a frame shrink)
    function post() {
      const r = document.body.getBoundingClientRect();
      const dev = root.firstElementChild ? root.firstElementChild.getBoundingClientRect() : r;
      try { parent.postMessage({ fm: 'size', h: Math.ceil(r.height), w: Math.ceil(dev.width + (cfg.flush ? 0 : 24)) }, '*'); } catch (_) {}
    };
    new ResizeObserver(post).observe(root);
    // focus (hosts like the Live device): show only the screen, only the controls, or both; re-fit without a reboot
    addEventListener('message', (e) => {
      if (e.source !== parent || !e.data || e.data.fm !== 'focus') return;
      setFocus(e.data.mode);
      if (e.data.fit) cfg.fit = e.data.fit;
      layoutFor(e.data.mode, e.data.fill);
      post();
    });
    // Screen only with a flex screen and a box to fill: the screen becomes exactly that box. Otherwise the
    // screen goes back to its own size and the usual strip fit picks the layout.
    function layoutFor(mode, fill) {
      const live = !!(cfg.fit && cfg.fit.live) && (!mode || mode === 'both');
      if (live) return liveFit(root, cfg.fit, m);
      if (document.body.classList.contains('live-strip')) {
        document.body.classList.remove('live-strip');
        for (const x of sectionGrids(root.firstElementChild || root)) { x.g.style.gridTemplateColumns = x.css; const sec = x.g.closest('.sec'); if (sec) sec.style.zoom = ''; }
        if (m && m._liveScreen) m._liveScreen(null);
      }
      if (mode === 'stage' && fill) return stageFit(fill);
      const filled = mode === 'screen' && fill && m && m._fillScreen && m._fillScreen(fill);
      if (!filled && m && m._fillScreen) m._fillScreen(null);
      root.style.maxWidth = 'none'; root.style.flex = 'none';
      const stack = !!(cfg.fit && cfg.fit.stack) && !filled;
      document.body.classList.toggle('stack', stack);
      const cv = mode === 'screen' && !filled && !stack ? root.querySelector('.screen-sec canvas') : null;
      if (filled) root.style.width = Math.round(fill.w) + 'px';
      else if (cv) root.style.width = cv.offsetWidth + 'px'; // Screen only: exactly the screen (the host may stretch it)
      else if (stack) stackFit(root, cfg.fit, m);
      else if (cfg.fit) fitStrip(root, cfg.fit);
    }
    // stage: the box is the whole space; the controls take their natural width on the left, the screen (a flex
    // one) fills what is left, any other screen sits centred in it
    function stageFit(fill) {
      root.style.maxWidth = 'none'; root.style.flex = 'none'; root.style.width = Math.round(fill.w) + 'px';
      const tall = fill.h > fill.w; // upright: screen on top, controls below
      document.body.classList.toggle('stage-tall', tall);
      if (m && m._fillScreen) m._fillScreen(null);
      if (m && m._zoomScreen) m._zoomScreen(null);
      const bd = root.querySelector('.body');
      if (bd) bd.style.height = Math.floor(fill.h) + 'px'; // exactly the space: the controls scroll, the screen stays (upright: pinned on top)
      if (tall) root.style.removeProperty('--stage-h'); else root.style.setProperty('--stage-h', Math.floor(fill.h) + 'px');
      const sec = root.querySelector('.screen-sec');
      if (!sec || !m || !m._fillScreen) return;
      let ctrlH = 0, lines = 1; // upright: the screen sits on top, at most about half the height; the controls below share the rest as air
      root.style.removeProperty('--stage-air');
      if (tall) {
        const rs = [...root.querySelectorAll('.sec:not(.screen-sec)')].map((x) => x.getBoundingClientRect());
        if (rs.length) { ctrlH = Math.max(...rs.map((r) => r.bottom)) - Math.min(...rs.map((r) => r.top)); lines = new Set(rs.map((r) => Math.round(r.top))).size; }
      }
      sec.style.marginBottom = tall && fill.split > 60 && fill.gap > 0 ? fill.gap + 'px' : ''; // (a fold: room kept clear for what sits on it)
      const w = Math.floor(sec.getBoundingClientRect().width) - 2, h = Math.floor(tall ? (fill.split > 60 ? fill.split - 6 : Math.max(fill.h * 0.34, Math.min(fill.h * 0.52, fill.h - ctrlH - 10))) : fill.h) - 2; // (split: the screen ends exactly at a fold)
      if (w > 60 && h > 40 && !m._fillScreen({ w, h, solo: true }) && m._zoomScreen) m._zoomScreen({ w: w - 32, h: h - 32 }); // a fixed screen: as large as fits, with air
      if (tall) { const spare = fill.h - (sec.getBoundingClientRect().height + 6) - (fill.split > 60 ? fill.gap || 0 : 0) - ctrlH - 4; if (spare > 0) root.style.setProperty('--stage-air', Math.floor(spare / lines / 2) + 'px'); }
    }
    post();
  };
})();
