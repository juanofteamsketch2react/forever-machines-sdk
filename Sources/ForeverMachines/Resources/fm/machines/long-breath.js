// Copyright (c) 2026 Juan Maguid, Temperamento. Forever Machines SDK License: free to try and for non-commercial use,
// commercial use needs a license. See LICENSE (https://forevermachines.net/sdk/LICENSE.txt).
FM.define({
  title: 'Long Breath',
  blurb: 'A machine that breathes so you can follow it: air comes in, a chord opens with it, a small bell marks the top, and everything goes out again, slower. Hold the screen to hold your breath (the chord waits with you), let go to breathe out; a tap rings the bell. Set In and Out to your own lungs.',
  thoughts: [
    'The oldest rhythm section has two members and they take turns.',
    'Breathing out is the only thing everyone agrees should take longer.',
    'A chord that opens when you inhale is just a lung you can hear.',
    'You were going to breathe anyway. This only keeps count.',
  ],
  build(m) {
    const ac = m.ac, pct = FM.fmt.pct, secs = (v) => v.toFixed(1) + ' s';
    const scr = m.screen({ w: 560, h: 230, label: 'Breath', flex: true });
    const { g } = scr;
    let W = scr.w, H = scr.h;
    scr.onResize((w, h) => { W = w; H = h; });

    const br = m.section('Breath', { cols: 4 });
    const tin = br.knob({ label: 'In', min: 2, max: 9, value: m.range(3.8, 4.6), fmt: secs });
    const tout = br.knob({ label: 'Out', min: 3, max: 14, value: m.range(6, 7.5), fmt: secs });
    const thold = br.knob({ label: 'Hold', min: 0, max: 7, value: m.range(0.8, 2), fmt: secs });
    const air = br.knob({ label: 'Air', min: 0, max: 1, value: m.range(0.45, 0.65), fmt: pct });
    const body = m.section('Body', { cols: 4 });
    const tone = body.knob({ label: 'Tone', min: 0, max: 1, value: m.range(0.5, 0.7), fmt: pct });
    const warmth = body.knob({ label: 'Warmth', min: 200, max: 2200, curve: 'exp', value: m.range(500, 900), fmt: FM.fmt.hz });
    const bell = body.knob({ label: 'Bell', min: 0, max: 1, value: m.range(0.4, 0.6), fmt: pct });
    body.select({ label: 'Scale', options: m.scaleNames, value: m.scale, onChange: (v) => { m.setScale(v); retune(1); } });

    // soft noise: white noise with the top rolled off, so it rustles instead of hissing
    const soft = (() => {
      const sr = ac.sampleRate, n = sr * 4, fade = Math.floor(sr * 0.15), b = ac.createBuffer(1, n + fade, sr), d = b.getChannelData(0);
      let l = 0; for (let i = 0; i < n + fade; i++) { l = 0.9 * l + 0.1 * (Math.random() * 2 - 1); d[i] = l * 2.5; }
      for (let i = 0; i < fade; i++) { const w = i / fade; d[i] = d[i] * w + d[n + i] * (1 - w); }   // the loop point does not click
      const o = ac.createBuffer(1, n, sr); o.getChannelData(0).set(d.subarray(0, n)); return o;
    })();
    const mk = (rate) => { const s = ac.createBufferSource(); s.buffer = soft; s.loop = true; s.playbackRate.value = rate; return s; };
    const nA = mk(0.9), nB = mk(1.13);
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 600; bp.Q.value = 0.7;
    const airLp = ac.createBiquadFilter(); airLp.type = 'lowpass'; airLp.frequency.value = 650; airLp.Q.value = 0.3;
    const airG = ac.createGain(); airG.gain.value = 0;
    const airSend = ac.createGain(); airSend.gain.value = 0.35;
    nA.connect(bp); nB.connect(bp); bp.connect(airLp); airLp.connect(airG); airG.connect(m.out); airG.connect(airSend); airSend.connect(m.verb);

    const DEGS = [0, 4, 7, 9], OCT = [-1, -1, 0, 0];
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; lp.Q.value = 0.4;
    const droneG = ac.createGain(); droneG.gain.value = 0;
    const dSend = ac.createGain(); dSend.gain.value = 0.6;
    lp.connect(droneG); droneG.connect(m.out); droneG.connect(dSend); dSend.connect(m.verb);
    const vr = m.rng('drone');
    const osc = DEGS.map((d, i) => {
      const o = ac.createOscillator(); o.type = i < 2 ? 'sine' : 'triangle'; o.detune.value = (vr() - 0.5) * 10;
      const og = ac.createGain(); og.gain.value = [0.5, 0.32, 0.22, 0.14][i];
      const pan = ac.createStereoPanner(); pan.pan.value = [0, -0.4, 0.4, 0][i];
      o.connect(og); og.connect(pan); pan.connect(lp); o.start();
      return o;
    });
    [nA, nB].forEach((o) => o.start());
    const ROOTS = [0, 3, -2, 4, 2];
    let rootDeg = 0;
    function retune(tc) {
      const now = ac.currentTime;
      osc.forEach((o, i) => o.frequency.setTargetAtTime(m.freq(rootDeg + DEGS[i], OCT[i]), now, tc));
    }
    osc.forEach((o, i) => { o.frequency.value = m.freq(DEGS[i], OCT[i]); });

    const rings = [];
    function ding(deg, oct, vel, fOver, x) {
      const f = fOver || m.freq(rootDeg + deg, oct);
      m.tone({ freq: f, type: 'sine', a: 0.005, hold: 0.04, d: 5, gain: 0.07 * vel, fm: { ratio: 3.5, index: 1.1, d: 1.2 }, send: 0.85, pan: x == null ? 0 : FM.clamp(x * 1.4 - 0.7, -0.8, 0.8) });
      m.tone({ freq: f * 2, type: 'sine', a: 0.01, hold: 0.02, d: 2.2, gain: 0.014 * vel, send: 0.9 });
      rings.push({ t: 0, v: vel, alt: true }); if (rings.length > 24) rings.shift();
    }

    const ease = (p) => 0.5 - 0.5 * Math.cos(Math.PI * FM.clamp(p, 0, 1));
    let ph = 'in', p = 0, level = 0, count = 0, held = false, lastT = performance.now(), started = false;
    function dur() { return ph === 'in' ? tin.value : ph === 'hold' ? thold.value : ph === 'out' ? tout.value : Math.max(0.3, thold.value * 0.5); }
    function step(to) {
      ph = to; p = 0;
      if (to === 'in') {
        count++;
        if (count % 4 === 1 && count > 1) { let r; do { r = ROOTS[Math.floor(Math.random() * ROOTS.length)]; } while (r === rootDeg); rootDeg = r; retune(1.6); }
        if (m.on && bell.value > 0.02) ding(0, 0, 0.35 * bell.value);
      }
      if (to === 'hold' || (to === 'out' && thold.value < 0.05)) {
        if (m.on && bell.value > 0.02) ding([4, 7, 9, 11][Math.floor(Math.random() * 4)], 1, 0.9 * bell.value);
      }
      if (to === 'out') { rings.push({ t: 0, v: 0.8, alt: false }); if (rings.length > 24) rings.shift(); }
    }
    m.every(0.05, () => {
      const nowP = performance.now(), dt = Math.min(0.2, (nowP - lastT) / 1000); lastT = nowP;
      if (!started && m.on) { started = true; ding(0, 0, 0.5 * bell.value + 0.1); }
      if (!(held && (ph === 'in' || ph === 'hold'))) p += dt / Math.max(0.2, dur());
      if (p >= 1) step(ph === 'in' ? (thold.value >= 0.05 ? 'hold' : 'out') : ph === 'hold' ? 'out' : ph === 'out' ? 'rest' : 'in');
      level = ph === 'in' ? ease(p) : ph === 'hold' ? 1 : ph === 'out' ? 1 - ease(p) : 0;
      const now = ac.currentTime, moving = ph === 'in' ? Math.sin(Math.PI * FM.clamp(p, 0, 1)) : ph === 'out' ? Math.sin(Math.PI * FM.clamp(p, 0, 1)) * 0.8 : 0;
      airG.gain.setTargetAtTime(air.value * (0.003 + 0.045 * moving), now, 0.12);
      bp.frequency.setTargetAtTime(ph === 'out' ? 220 + 200 * level : 300 + 250 * level, now, 0.15);
      droneG.gain.setTargetAtTime(tone.value * (0.03 + 0.085 * level), now, 0.25);
      lp.frequency.setTargetAtTime(Math.min(8000, warmth.value * (0.55 + 0.9 * level)), now, 0.25);
    });

    let hint = 12, phase = 0, downAt = 0;
    scr.canvas.addEventListener('pointerdown', (e) => {
      scr.canvas.setPointerCapture(e.pointerId);
      const pt = scr.pointer(e); held = true; hint = 0; downAt = performance.now();
      ding(Math.round(FM.clamp(1 - pt.y / H, 0, 1) * 9), 1, 0.8, 0, pt.x / W);
      if (ph === 'out' || ph === 'rest') step('in');
    });
    scr.canvas.addEventListener('pointermove', (e) => {
      if (!held) return;
      const pt = scr.pointer(e);
      lp.frequency.setTargetAtTime(Math.min(8000, warmth.value * (0.6 + 1.6 * FM.clamp(1 - pt.y / H, 0, 1))), ac.currentTime, 0.1);
    });
    const up = () => { if (held && performance.now() - downAt > 500 && (ph === 'in' || ph === 'hold')) step('out'); held = false; };
    scr.canvas.addEventListener('pointerup', up);
    scr.canvas.addEventListener('pointercancel', up);

    m.onNote((note, velocity, on) => {
      if (!on) return;
      const v = velocity > 1 ? velocity / 127 : velocity;
      ding(0, 0, 0.3 + 0.7 * v, FM.mtof(note), FM.clamp((note - 36) / 60, 0, 1));
    });

    const WORD = { in: 'in', hold: 'hold', out: 'out', rest: '' };
    m.frame((t, dt) => {
      phase += dt;
      if (hint > 0 && !held) hint -= dt;
      const ink = m.color('screen-ink'), alt = m.color('screen-alt'), dim = m.color('screen-dim');
      g.fillStyle = m.color('screen'); g.fillRect(0, 0, W, H);
      const cx = W / 2, cy = H * 0.48, mn = Math.min(W, H), far = Math.hypot(W, H) * 0.55;
      const R = mn * (0.13 + 0.25 * level);
      g.strokeStyle = dim; g.lineWidth = 1; g.globalAlpha = 0.7;
      for (let k = 1; k <= 5; k++) { g.beginPath(); g.arc(cx, cy, mn * 0.38 + (far - mn * 0.38) * (k / 5), 0, 6.283); g.stroke(); }
      for (let k = rings.length - 1; k >= 0; k--) {
        const r = rings[k]; r.t += dt;
        const life = r.alt ? 5 : 9; if (r.t > life) { rings.splice(k, 1); continue; }
        const u = r.t / life;
        g.globalAlpha = Math.pow(1 - u, 1.6) * 0.6 * r.v; g.strokeStyle = r.alt ? alt : ink; g.lineWidth = r.alt ? 1 : 1.5;
        g.beginPath(); g.arc(cx, cy, mn * 0.38 + (far - mn * 0.38) * u, 0, 6.283); g.stroke();
      }
      g.fillStyle = ink;
      for (let k = 4; k >= 1; k--) {
        g.globalAlpha = 0.05 + 0.035 * (5 - k) * (0.4 + 0.6 * level);
        g.beginPath(); g.arc(cx, cy, R * (1 + k * 0.16) + Math.sin(phase * 0.7 + k) * 1.5, 0, 6.283); g.fill();
      }
      g.globalAlpha = 0.28 + 0.4 * level; g.beginPath(); g.arc(cx, cy, R, 0, 6.283); g.fill();
      g.globalAlpha = 0.9; g.strokeStyle = held ? alt : ink; g.lineWidth = Math.max(1.5, mn * 0.012);
      g.beginPath(); g.arc(cx, cy, R, 0, 6.283); g.stroke();
      g.globalAlpha = 0.9; g.strokeStyle = alt; g.lineWidth = Math.max(2, mn * 0.014);
      g.beginPath(); g.arc(cx, cy, mn * 0.415, -1.5708, -1.5708 + 6.283 * FM.clamp(p, 0, 1) * (ph === 'out' || ph === 'rest' ? -1 : 1), ph === 'out' || ph === 'rest'); g.stroke();
      g.globalAlpha = 0.85; g.fillStyle = m.color('screen');
      g.font = '600 ' + Math.round(Math.max(11, R * 0.42)) + 'px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(held && (ph === 'in' || ph === 'hold') ? 'hold' : WORD[ph], cx, cy);
      g.fillStyle = ink; g.globalAlpha = 0.55; g.font = Math.round(Math.max(10, mn * 0.05)) + 'px system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      g.fillText('breath ' + count, 10, Math.max(16, mn * 0.08));
      g.globalAlpha = 1;
      if (hint > 0) {
        g.globalAlpha = Math.min(1, hint / 3) * 0.75; g.fillStyle = ink;
        g.font = Math.round(Math.max(11, mn * 0.06)) + 'px system-ui, sans-serif'; g.textAlign = 'center';
        g.fillText('hold the screen to hold your breath', W / 2, H - 10); g.globalAlpha = 1; g.textAlign = 'left';
      }
    });
  },
});
