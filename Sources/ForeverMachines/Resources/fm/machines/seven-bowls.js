// Copyright (c) 2026 Juan Maguid, Temperamento. Forever Machines SDK License: free to try and for non-commercial use,
// commercial use needs a license. See LICENSE (https://forevermachines.net/sdk/LICENSE.txt).
FM.define({
  title: 'Seven Bowls',
  blurb: 'Seven metal bowls on a low table, struck one at a time by a patient hand. Each rings long after, with a slow beat inside it. Tap a bowl to strike it, hold one and it sings for as long as you stay; tap the table and the nearest bowl answers.',
  thoughts: [
    'A bowl is a bell that has decided to sit down.',
    'The beat inside the ring is two notes failing to agree, peacefully.',
    'Nothing here is in a hurry, least of all the hand.',
    'You do not listen to the strike. You listen to what is left.',
  ],
  build(m) {
    const ac = m.ac, pct = FM.fmt.pct, secs = (v) => v.toFixed(0) + ' s';
    const scr = m.screen({ w: 560, h: 230, label: 'Table', flex: true });
    const { g } = scr;
    let W = scr.w, H = scr.h;
    scr.onResize((w, h) => { W = w; H = h; });

    const hand = m.section('Hand', { cols: 3 });
    const pace = hand.knob({ label: 'Pace', min: 2, max: 30, curve: 'exp', value: m.range(5, 9), fmt: secs });
    const ring = hand.knob({ label: 'Ring', min: 3, max: 24, value: m.range(10, 16), fmt: secs });
    const touch = hand.knob({ label: 'Touch', min: 0.1, max: 1, value: m.range(0.45, 0.7), fmt: pct });
    const metal = m.section('Metal', { cols: 4 });
    const beat = metal.knob({ label: 'Beat', min: 0.1, max: 5, curve: 'exp', value: m.range(0.5, 1.4), fmt: FM.fmt.hz });
    const shine = metal.knob({ label: 'Shine', min: 0, max: 1, value: m.range(0.35, 0.6), fmt: pct });
    const space = metal.knob({ label: 'Space', min: 0, max: 1, value: m.range(0.55, 0.8), fmt: pct });
    const hum = metal.knob({ label: 'Hum', min: 0, max: 1, value: m.range(0.25, 0.45), fmt: pct, onChange: () => rehum() });
    metal.select({ label: 'Scale', options: m.scaleNames, value: m.scale, onChange: (v) => { m.setScale(v); rehum(); } });

    const N = 7, DEG = [0, 2, 4, 7, 9, 11, 14];
    const br = m.rng('bowls');
    const bowls = DEG.map((d, i) => ({ d, e: 0, sing: 0, wob: br() * 6.28, off: (br() - 0.5) }));
    const ripples = [];

    const hA = ac.createOscillator(), hB = ac.createOscillator();
    hA.type = 'sine'; hB.type = 'sine';
    const hLp = ac.createBiquadFilter(); hLp.type = 'lowpass'; hLp.frequency.value = 320; hLp.Q.value = 0.3;
    const humG = ac.createGain(); humG.gain.value = 0;
    const lfo = ac.createOscillator(); lfo.frequency.value = 0.05 + br() * 0.03;
    const lAmp = ac.createGain(); lAmp.gain.value = 0;
    hA.connect(hLp); hB.connect(hLp); hLp.connect(humG); humG.connect(m.out); humG.connect(m.verb);
    lfo.connect(lAmp); lAmp.connect(humG.gain);
    [hA, hB, lfo].forEach((o) => o.start());
    function rehum() {
      const now = ac.currentTime, v = hum.value;
      hA.frequency.setTargetAtTime(m.freq(0, -1), now, 0.8);
      hB.frequency.setTargetAtTime(m.freq(4, -1) + 0.4, now, 0.8);
      humG.gain.setTargetAtTime(0.045 * v, now, 0.6);
      lAmp.gain.setTargetAtTime(0.02 * v, now, 0.6);
    }
    rehum();
    m.every(3, rehum);

    function strike(i, vel, t, fOver) {
      const b = bowls[i], f = fOver || m.freq(b.d, 0);
      const when = t || ac.currentTime;
      const d = ring.value * (1.15 - i * 0.07), gn = 0.08 * vel, tc = touch.value, sh = shine.value, bt = beat.value;
      const pan = (i / (N - 1)) * 1.2 - 0.6, send = space.value * 0.85;
      m.tone({ t: when, freq: f, type: 'sine', a: 0.004 + (1 - tc) * 0.03, hold: 0.05, d, gain: gn, pan, send });
      m.tone({ t: when, freq: f + bt, type: 'sine', a: 0.004 + (1 - tc) * 0.03, hold: 0.05, d: d * 0.95, gain: gn * 0.8, pan: -pan * 0.5, send });
      m.tone({ t: when, freq: f * 2.71, type: 'sine', a: 0.003, hold: 0.02, d: d * 0.45, gain: gn * 0.36 * sh * (0.4 + tc), pan, send });
      m.tone({ t: when, freq: f * 2.71 + bt * 1.7, type: 'sine', a: 0.003, hold: 0.02, d: d * 0.4, gain: gn * 0.25 * sh * (0.4 + tc), pan: -pan, send });
      m.tone({ t: when, freq: Math.min(9000, f * 5.15), type: 'sine', a: 0.002, hold: 0.01, d: d * 0.18, gain: gn * 0.16 * sh * tc, pan, send });
      const show = () => { b.e = Math.min(1.2, b.e + 0.5 + 0.5 * vel); ripples.push({ i, t: 0, v: vel }); if (ripples.length > 40) ripples.shift(); };
      if (t) m.at(when, show); else show();
    }
    function sing(i) {
      const b = bowls[i], f = m.freq(b.d, 0), pan = (i / (N - 1)) * 1.2 - 0.6, send = space.value * 0.85;
      m.tone({ freq: f, type: 'sine', a: 0.9, hold: 0.4, d: 2.6, gain: 0.05, pan, send });
      m.tone({ freq: f + beat.value, type: 'sine', a: 1.0, hold: 0.3, d: 2.4, gain: 0.035, pan: -pan, send });
      m.tone({ freq: f * 2.71, type: 'sine', a: 1.1, hold: 0.2, d: 1.6, gain: 0.012 * shine.value, pan, send });
      b.sing = 1;
    }

    let next = 0.6, last = -1;
    m.every(0.25, () => {
      if (!m.on) return;
      if (held >= 0) { holdT += 0.25; if (holdT >= 0.5 && (singT -= 0.25) <= 0) { sing(held); singT = 1.0; } }
      next -= 0.25;
      if (next > 0) return;
      let i; do { i = Math.floor(Math.random() * N); } while (i === last);
      last = i;
      strike(i, 0.4 + Math.random() * 0.5);
      if (Math.random() < 0.3) {
        const j = (i + (Math.random() < 0.5 ? 2 : 4)) % N;
        strike(j, 0.3 + Math.random() * 0.3, ac.currentTime + 0.5 + Math.random() * 1.2);
      }
      next = pace.value * (0.6 + Math.random() * 0.8);
    });

    function pos(i) {
      const r = Math.min(W / N * 0.44, H * 0.3) * (1.18 - i * 0.075);
      return { x: W * (0.09 + 0.82 * (i / (N - 1))), y: H * (0.5 + 0.13 * (i % 2 ? 1 : -1) + bowls[i].off * 0.05), r };
    }
    function nearest(p) {
      let bi = 0, bd = 1e9;
      for (let i = 0; i < N; i++) { const q = pos(i), d = Math.hypot(p.x - q.x, p.y - q.y) - q.r; if (d < bd) { bd = d; bi = i; } }
      return bi;
    }
    let held = -1, holdT = 0, singT = 0, hint = 12, phase = 0;
    scr.canvas.addEventListener('pointerdown', (e) => {
      scr.canvas.setPointerCapture(e.pointerId);
      const p = scr.pointer(e); held = nearest(p); holdT = 0; singT = 0; hint = 0;
      const q = pos(held);
      strike(held, FM.clamp(1.1 - Math.hypot(p.x - q.x, p.y - q.y) / (q.r * 2.5), 0.35, 1));
    });
    scr.canvas.addEventListener('pointermove', (e) => {
      if (held < 0) return;
      const i = nearest(scr.pointer(e));
      if (i !== held) { held = i; holdT = 0; singT = 0; strike(i, 0.5); }
    });
    const up = () => { held = -1; };
    scr.canvas.addEventListener('pointerup', up);
    scr.canvas.addEventListener('pointercancel', up);

    m.onNote((note, velocity, on) => {
      if (!on) return;
      const v = velocity > 1 ? velocity / 127 : velocity, f = FM.mtof(note);
      let bi = 0, bd = 1e9;
      for (let i = 0; i < N; i++) { const d = Math.abs(Math.log(m.freq(bowls[i].d, 0) / f)); if (d < bd) { bd = d; bi = i; } }
      strike(bi, 0.3 + 0.7 * v, 0, f);
    });

    m.frame((t, dt) => {
      phase += dt;
      if (hint > 0 && held < 0) hint -= dt;
      const ink = m.color('screen-ink'), alt = m.color('screen-alt'), dim = m.color('screen-dim');
      g.fillStyle = m.color('screen'); g.fillRect(0, 0, W, H);
      g.strokeStyle = dim; g.lineWidth = 1; g.globalAlpha = 0.6;
      for (let k = 1; k < 6; k++) { const y = H * k / 6 + Math.sin(k * 1.7) * 3; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y + Math.sin(k) * 4); g.stroke(); }
      g.globalAlpha = 1;
      for (let k = ripples.length - 1; k >= 0; k--) {
        const r = ripples[k]; r.t += dt;
        const life = 5; if (r.t > life) { ripples.splice(k, 1); continue; }
        const q = pos(r.i), a = Math.pow(1 - r.t / life, 2) * 0.5 * r.v;
        g.globalAlpha = a; g.strokeStyle = r.i % 2 ? alt : ink; g.lineWidth = 1.2;
        g.beginPath(); g.arc(q.x, q.y, q.r * (1 + r.t * 0.55), 0, 6.283); g.stroke();
      }
      const bt = beat.value;
      for (let i = 0; i < N; i++) {
        const b = bowls[i], q = pos(i), col = i % 2 ? alt : ink;
        b.e *= Math.exp(-dt / (ring.value * 0.3)); b.sing *= Math.exp(-dt / 1.5);
        const e = Math.min(1, b.e + b.sing), sw = 0.5 + 0.5 * Math.sin(phase * 6.283 * bt + b.wob);
        g.globalAlpha = 0.06 + 0.3 * e * (0.5 + 0.5 * sw); g.fillStyle = col;
        g.beginPath(); g.arc(q.x, q.y, q.r, 0, 6.283); g.fill();
        g.globalAlpha = 0.35 + 0.65 * e; g.strokeStyle = col; g.lineWidth = Math.max(1.5, q.r * 0.09);
        g.beginPath(); g.arc(q.x, q.y, q.r, 0, 6.283); g.stroke();
        g.globalAlpha = 0.2 + 0.5 * e; g.lineWidth = 1;
        g.beginPath(); g.arc(q.x, q.y, q.r * (0.62 + 0.06 * e * sw), 0, 6.283); g.stroke();
        g.globalAlpha = 0.15 + 0.5 * e;
        g.beginPath(); g.arc(q.x, q.y, q.r * 0.16, 0, 6.283); g.fill();
        if (held === i) { g.globalAlpha = 0.8; g.lineWidth = 1; g.beginPath(); g.arc(q.x, q.y, q.r * 1.14, phase * 2, phase * 2 + 4.2); g.stroke(); }
      }
      g.globalAlpha = 1;
      if (hint > 0) {
        g.globalAlpha = Math.min(1, hint / 3) * 0.75; g.fillStyle = ink;
        g.font = Math.round(Math.max(11, Math.min(W, H) * 0.06)) + 'px system-ui, sans-serif'; g.textAlign = 'center';
        g.fillText('tap a bowl · hold it and it sings', W / 2, H - 10); g.globalAlpha = 1; g.textAlign = 'left';
      }
    });
  },
});
