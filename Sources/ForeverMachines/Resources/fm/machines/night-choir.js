// Copyright (c) 2026 Juan Maguid, Temperamento. Forever Machines SDK License: free to try and for non-commercial use,
// commercial use needs a license. See LICENSE (https://forevermachines.net/sdk/LICENSE.txt).
FM.define({
  title: 'Night Choir',
  blurb: 'Five soft voices hold one chord for most of a minute, then slide to the next so slowly you only notice afterwards. A star now and then falls into the dark, a long way off. Tap the sky for a star of your own; the higher you tap, the higher it sings. Leave it on all night.',
  thoughts: [
    'A chord is a room. This one changes its furniture while you sleep.',
    'The slowest music is the kind you only hear by comparing now with then.',
    'Stars do not play for anyone. That is why they are restful.',
    'Quiet is not the absence of sound but a decision about how much.',
  ],
  build(m) {
    const ac = m.ac, pct = FM.fmt.pct, secs = (v) => v.toFixed(0) + ' s';
    const scr = m.screen({ w: 560, h: 230, label: 'Night sky', flex: true });
    const { g } = scr;
    let W = scr.w, H = scr.h;
    scr.onResize((w, h) => { W = w; H = h; });

    const choir = m.section('Choir', { cols: 3 });
    const warmth = choir.knob({ label: 'Warmth', min: 200, max: 2400, curve: 'exp', value: m.range(450, 800), fmt: FM.fmt.hz, onChange: () => refilter() });
    const space = choir.knob({ label: 'Space', min: 0, max: 1, value: m.range(0.6, 0.85), fmt: pct, onChange: () => resend() });
    const stars = choir.knob({ label: 'Stars', min: 0, max: 1, value: m.range(0.35, 0.55), fmt: pct });
    const time = m.section('Time', { cols: 4 });
    const change = time.knob({ label: 'Change', min: 15, max: 120, value: m.range(40, 70), fmt: secs });
    const glide = time.knob({ label: 'Glide', min: 2, max: 25, value: m.range(9, 14), fmt: secs });
    const breath = time.knob({ label: 'Breath', min: 0.01, max: 0.12, curve: 'exp', value: m.range(0.025, 0.05), fmt: FM.fmt.hz, onChange: () => rebreathe() });
    time.select({ label: 'Scale', options: m.scaleNames, value: m.scale, onChange: (v) => { m.setScale(v); retune(false); } });

    const bus = ac.createGain(); bus.gain.value = 0.55;
    const send = ac.createGain(); send.gain.value = 0.7;
    bus.connect(m.out); bus.connect(send); send.connect(m.verb);

    // five voices, each a sine and a triangle a few cents apart, through its own soft filter, breathing
    const N = 5, vr = m.rng('choir');
    const voices = [];
    for (let i = 0; i < N; i++) {
      const o1 = ac.createOscillator(), o2 = ac.createOscillator();
      o1.type = 'sine'; o2.type = 'triangle';
      o1.detune.value = -(3 + vr() * 6); o2.detune.value = 3 + vr() * 6;
      const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.4;
      const vca = ac.createGain(); vca.gain.value = 0.05;
      const pan = ac.createStereoPanner(); pan.pan.value = (i / (N - 1)) * 1.4 - 0.7;
      const lfo = ac.createOscillator(); lfo.type = 'sine';
      const lAmp = ac.createGain(); lAmp.gain.value = 0.03;
      o1.connect(f); o2.connect(f); f.connect(vca); vca.connect(pan); pan.connect(bus);
      lfo.connect(lAmp); lAmp.connect(vca.gain);
      const v = { o1, o2, f, vca, lfo, lAmp, rate: 0.6 + vr() * 0.9, ph: vr() * 6.283, hz: 110, y: 0.5 };
      [o1, o2, lfo].forEach((o) => o.start());
      voices.push(v);
    }

    const ROOTS = [0, -2, 3, -4, 2, -1, 4];
    const OCT = [-1, 0, 0, 1, 1];
    let rootDeg = 0, next = change.value;
    function degreesFor(r) { return [r, r + 2, r + 4, r + 7, r + 9]; }
    function retune(slow) {
      const ds = degreesFor(rootDeg), now = ac.currentTime, tc = slow ? glide.value / 3 : 0.2;
      voices.forEach((v, i) => {
        v.hz = m.freq(ds[i], OCT[i]);
        v.o1.frequency.setTargetAtTime(v.hz, now, tc);
        v.o2.frequency.setTargetAtTime(v.hz, now, tc);
      });
    }
    function refilter() {
      const now = ac.currentTime;
      voices.forEach((v, i) => v.f.frequency.setTargetAtTime(Math.min(9000, warmth.value * (0.8 + i * 0.12)), now, 0.4));
    }
    function resend() { send.gain.setTargetAtTime(space.value, ac.currentTime, 0.5); }
    function rebreathe() {
      const now = ac.currentTime;
      voices.forEach((v) => v.lfo.frequency.setTargetAtTime(breath.value * v.rate, now, 0.5));
    }
    voices.forEach((v, i) => { const ds = degreesFor(rootDeg); v.hz = m.freq(ds[i], OCT[i]); v.o1.frequency.value = v.hz; v.o2.frequency.value = v.hz; });
    refilter(); resend(); rebreathe();

    // the chord changes on its own, by small steps round the key
    m.every(1, () => {
      next -= 1;
      if (next > 0) return;
      let r; do { r = ROOTS[Math.floor(Math.random() * ROOTS.length)]; } while (r === rootDeg);
      rootDeg = r; retune(true);
      next = change.value * (0.7 + Math.random() * 0.6);
    });

    // stars: a high sine, a long way off, with a little room round it
    const sparks = [];
    function star(deg, oct, gain, x) {
      const freq = m.freq(deg, oct);
      m.tone({ freq, type: 'sine', a: 0.06, hold: 0.15, d: 5.5, gain, send: 1, pan: FM.clamp((x == null ? Math.random() : x) * 1.6 - 0.8, -0.9, 0.9) });
      m.tone({ freq: freq * 2.0, type: 'sine', a: 0.08, hold: 0.05, d: 2.5, gain: gain * 0.2, send: 1 });
      sparks.push({ x: x == null ? Math.random() : x, y: FM.clamp(1 - (Math.log2(freq / 100) / 5), 0.06, 0.8), t: 0 });
      if (sparks.length > 24) sparks.shift();
    }
    m.every(1, () => {
      const s = stars.value;
      if (s < 0.02 || !m.on) return;
      if (Math.random() < 1 / (24 - 17 * s)) star([0, 2, 4, 7, 9, 11][Math.floor(Math.random() * 6)], 2 + (Math.random() < 0.35 ? 1 : 0), 0.035 * (0.4 + s));
    });

    // touch: a star where you tap, higher up the sky sings higher; drag and it keeps falling
    let pressing = false, lastStar = 0, hint = 12, phase = 0;
    const field = Array.from({ length: 50 }, () => ({ x: Math.random(), y: Math.random(), p: Math.random() * 6.3, s: 0.3 + Math.random() }));
    function tapStar(p) {
      const deg = Math.round(FM.clamp(1 - p.y / H, 0, 1) * 12);
      star(deg, 1 + (deg > 7 ? 1 : 0), 0.06, p.x / W);
      lastStar = performance.now();
    }
    scr.canvas.addEventListener('pointerdown', (e) => {
      pressing = true; scr.canvas.setPointerCapture(e.pointerId);
      tapStar(scr.pointer(e)); hint = 0;
    });
    scr.canvas.addEventListener('pointermove', (e) => {
      if (pressing && performance.now() - lastStar > 450) tapStar(scr.pointer(e));
    });
    const up = () => { pressing = false; };
    scr.canvas.addEventListener('pointerup', up);
    scr.canvas.addEventListener('pointercancel', up);

    m.onNote((note, velocity, on) => {
      if (!on) return;
      const v = velocity > 1 ? velocity / 127 : velocity;
      m.tone({ freq: FM.mtof(note), type: 'sine', a: 0.1, hold: 0.3, d: 6, gain: 0.05 * (0.3 + v), send: 1 });
      sparks.push({ x: FM.clamp((note - 36) / 60, 0.05, 0.95), y: FM.clamp(1 - (note - 36) / 70, 0.06, 0.8), t: 0 });
    });

    m.frame((t, dt) => {
      phase += dt;
      if (!pressing && hint > 0) hint -= dt;
      g.fillStyle = m.color('screen'); g.fillRect(0, 0, W, H);
      g.fillStyle = m.color('screen-ink');
      for (const s of field) {
        g.globalAlpha = Math.max(0.04, 0.12 + 0.18 * Math.sin(phase * 0.3 * s.s + s.p));
        g.fillRect(s.x * W, s.y * H, 1.4, 1.4);
      }
      // the voices: soft orbs, each as high as its pitch, glowing with its own breath
      const mn = Math.min(...voices.map((v) => v.hz)), mx = Math.max(...voices.map((v) => v.hz));
      const R = Math.max(12, Math.min(W, H) * 0.11);
      voices.forEach((v, i) => {
        const target = mx > mn ? 1 - (Math.log(v.hz / mn) / Math.log(mx / mn)) : 0.5;
        v.y += (target - v.y) * Math.min(1, dt * 0.6);
        const b = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2 * breath.value * v.rate + v.ph);
        const x = W * (0.14 + 0.72 * (i / (N - 1))) + Math.sin(phase * 0.15 + v.ph) * W * 0.02;
        const y = H * (0.2 + 0.6 * v.y);
        const col = i % 2 ? m.color('screen-alt') : m.color('screen-ink');
        g.fillStyle = col;
        for (let k = 3; k >= 1; k--) {
          g.globalAlpha = (0.05 + 0.05 * b) * (4 - k);
          g.beginPath(); g.arc(x, y, R * (0.5 + k * 0.55) * (0.85 + 0.25 * b), 0, 6.283); g.fill();
        }
        g.globalAlpha = 0.5 + 0.4 * b;
        g.beginPath(); g.arc(x, y, R * 0.28, 0, 6.283); g.fill();
      });
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]; s.t += dt;
        if (s.t > 6) { sparks.splice(i, 1); continue; }
        const a = Math.pow(1 - s.t / 6, 1.5), x = s.x * W, y = s.y * H, L = 4 + 10 * a;
        g.globalAlpha = a * 0.9; g.strokeStyle = m.color('screen-ink'); g.lineWidth = 1;
        g.beginPath(); g.moveTo(x - L, y); g.lineTo(x + L, y); g.moveTo(x, y - L); g.lineTo(x, y + L); g.stroke();
        g.globalAlpha = a * 0.25; g.beginPath(); g.arc(x, y, 6 + s.t * 10, 0, 6.283); g.stroke();
      }
      g.globalAlpha = 1;
      if (hint > 0) {
        g.globalAlpha = Math.min(1, hint / 3) * 0.7; g.fillStyle = m.color('screen-ink');
        g.font = Math.round(Math.max(11, Math.min(W, H) * 0.06)) + 'px system-ui, sans-serif'; g.textAlign = 'center';
        g.fillText('tap the sky for a star', W / 2, H - 10); g.globalAlpha = 1; g.textAlign = 'left';
      }
    });
  },
});
