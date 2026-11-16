// Copyright (c) 2026 Juan Maguid, Temperamento. Forever Machines SDK License: free to try and for non-commercial use,
// commercial use needs a license. See LICENSE (https://forevermachines.net/sdk/LICENSE.txt).
FM.define({
  title: 'Lotus Pond',
  blurb: 'A pond after dark: drops fall in key, crickets keep time badly, a frog has opinions, and somewhere a stream goes on. Tap the water for a drop (higher up sings higher), drag to let it rain, tap a lily pad to wake its frog, or drag the pad somewhere else. The pond remembers where you left them.',
  thoughts: [
    'A pond is a room with one very quiet wall.',
    'Crickets invented the metronome and then ignored it.',
    'Every drop is a small bell that the water agrees to ring.',
    'The frog is not part of the music. Nobody has told the frog.',
  ],
  build(m) {
    const ac = m.ac, pct = FM.fmt.pct;
    const scr = m.screen({ w: 560, h: 230, label: 'Pond', flex: true });
    const { g } = scr;
    let W = scr.w, H = scr.h;
    scr.onResize((w, h) => { W = w; H = h; });

    const pond = m.section('Pond', { cols: 4 });
    const drops = pond.knob({ label: 'Drops', min: 0, max: 1, value: m.range(0.35, 0.55), fmt: pct });
    const glow = pond.knob({ label: 'Glow', min: 0.4, max: 6, curve: 'exp', value: m.range(1.6, 2.8), fmt: (v) => v.toFixed(1) + ' s' });
    const depth = pond.knob({ label: 'Depth', min: 0, max: 1, value: m.range(0.55, 0.8), fmt: pct });
    const stream = pond.knob({ label: 'Stream', min: 0, max: 1, value: m.range(0.3, 0.5), fmt: pct, onChange: () => relevel() });
    const night = m.section('Night', { cols: 3 });
    const crickets = night.knob({ label: 'Crickets', min: 0, max: 1, value: m.range(0.3, 0.5), fmt: pct });
    const frogs = night.knob({ label: 'Frogs', min: 0, max: 1, value: m.range(0.25, 0.45), fmt: pct });
    night.select({ label: 'Scale', options: m.scaleNames, value: m.scale, onChange: (v) => m.setScale(v) });

    // soft noise: white noise with the top rolled off, so it rustles instead of hissing
    const soft = (() => {
      const sr = ac.sampleRate, n = sr * 4, fade = Math.floor(sr * 0.15), b = ac.createBuffer(1, n + fade, sr), d = b.getChannelData(0);
      let l = 0; for (let i = 0; i < n + fade; i++) { l = 0.9 * l + 0.1 * (Math.random() * 2 - 1); d[i] = l * 2.5; }
      for (let i = 0; i < fade; i++) { const w = i / fade; d[i] = d[i] * w + d[n + i] * (1 - w); }   // the loop point does not click
      const o = ac.createBuffer(1, n, sr); o.getChannelData(0).set(d.subarray(0, n)); return o;
    })();
    const mk = (rate) => { const s = ac.createBufferSource(); s.buffer = soft; s.loop = true; s.playbackRate.value = rate; return s; };
    const nA = mk(0.83), nB = mk(1.21);
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 330; bp.Q.value = 0.5;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.3;
    const sG = ac.createGain(); sG.gain.value = 0;
    const sLfo = ac.createOscillator(); sLfo.frequency.value = 0.07;
    const sAmp = ac.createGain(); sAmp.gain.value = 0;
    const sMod = ac.createGain(); sMod.gain.value = 250;
    nA.connect(bp); nB.connect(bp); bp.connect(lp); lp.connect(sG); sG.connect(m.out);
    sLfo.connect(sAmp); sAmp.connect(sG.gain); sLfo.connect(sMod); sMod.connect(bp.detune);
    [nA, nB, sLfo].forEach((o) => o.start());
    function relevel() {
      const now = ac.currentTime, v = stream.value;
      sG.gain.setTargetAtTime(0.03 * v, now, 0.5); sAmp.gain.setTargetAtTime(0.012 * v, now, 0.5);
    }
    relevel();

    const pr = m.rng('pads');
    const NP = 6;
    const pads = Array.from({ length: NP }, (_, i) => ({
      x: 0.12 + 0.76 * ((i + 0.5) / NP) + (pr() - 0.5) * 0.06, y: 0.25 + pr() * 0.5, r: 0.7 + pr() * 0.6,
      rot: pr() * 6.28, bob: 0, lotus: i % 2 === 0, ph: pr() * 6.28, pitch: 130 + pr() * 90,
    }));
    const ripples = [], flies = Array.from({ length: 14 }, () => ({ x: Math.random(), y: Math.random(), p: Math.random() * 6.28, s: 0.4 + Math.random() }));
    const cr = Array.from({ length: 3 }, (_, i) => ({ f: 3700 + pr() * 1500, per: 0.5 + pr() * 0.45, next: pr(), pan: i - 1, rest: 0, n: 3 + Math.floor(pr() * 2) }));

    function ripple(x, y, v, alt) { ripples.push({ x, y, t: 0, v, alt }); if (ripples.length > 60) ripples.shift(); }
    function drop(x, y, vel, fOver) {
      const deg = Math.round(FM.clamp(1 - y, 0, 1) * 11);
      const f = fOver || m.freq(deg, 1), pan = FM.clamp(x * 1.6 - 0.8, -0.9, 0.9), dp = depth.value;
      m.tone({ freq: f * 0.82, glide: f, glideTime: 0.035, type: 'sine', a: 0.002, hold: 0.01, d: glow.value, gain: 0.085 * vel, pan, send: dp * 0.9, echo: dp * 0.25 });
      m.tone({ freq: f * 2.0, type: 'sine', a: 0.002, hold: 0.005, d: glow.value * 0.3, gain: 0.02 * vel, pan, send: dp });
      ripple(x, y, vel, false);
    }
    function croak(p) {
      const now = ac.currentTime, n = 2 + Math.floor(Math.random() * 2), pan = FM.clamp(p.x * 1.6 - 0.8, -0.9, 0.9);
      for (let k = 0; k < n; k++) {
        m.tone({ t: now + k * 0.19, freq: p.pitch * 1.25, glide: p.pitch, glideTime: 0.09, type: 'sawtooth', cutoff: 520, q: 3, a: 0.012, hold: 0.05, d: 0.09, gain: 0.05, pan, send: 0.25 });
      }
      p.bob = 1; ripple(p.x, p.y, 0.6, true);
    }

    m.every(0.05, () => {
      if (!m.on) return;
      const now = ac.currentTime, lv = crickets.value;
      for (const c of cr) {
        c.next -= 0.05;
        if (c.next > 0) continue;
        c.next = c.per * (0.92 + Math.random() * 0.16);
        if (c.rest > 0) { c.rest -= 1; continue; }
        if (Math.random() < 0.035) { c.rest = 4 + Math.floor(Math.random() * 14); continue; }
        if (lv < 0.02) continue;
        for (let k = 0; k < c.n; k++) m.tone({ t: now + k * 0.034, freq: c.f, type: 'sine', a: 0.004, hold: 0.012, d: 0.02, gain: 0.011 * lv, pan: c.pan * 0.7, send: 0.2 });
      }
    });
    let first = true;
    m.every(0.2, () => {
      if (!m.on) return;
      const d = drops.value;
      if (first || Math.random() < 0.2 * (0.04 + d * 0.5)) {
        first = false;
        drop(0.08 + Math.random() * 0.84, 0.1 + Math.random() * 0.8, 0.35 + Math.random() * 0.6);
      }
      if (Math.random() < 0.2 * frogs.value * 0.16) croak(pads[Math.floor(Math.random() * NP)]);
    });

    function padR(p) { return Math.min(W, H) * 0.085 * p.r; }
    function padAt(pt) {
      for (let i = NP - 1; i >= 0; i--) { const p = pads[i]; if (Math.hypot(pt.x - p.x * W, pt.y - p.y * H) < padR(p) * 1.25 + 6) return p; }
      return null;
    }
    let grab = null, moved = 0, pressing = false, lastDrop = 0, hint = 12, phase = 0, sx = 0, sy = 0;
    scr.canvas.addEventListener('pointerdown', (e) => {
      scr.canvas.setPointerCapture(e.pointerId);
      const p = scr.pointer(e); pressing = true; hint = 0; moved = 0; sx = p.x; sy = p.y;
      grab = padAt(p);
      if (grab) croak(grab); else { drop(p.x / W, p.y / H, 0.9); lastDrop = performance.now(); }
    });
    scr.canvas.addEventListener('pointermove', (e) => {
      if (!pressing) return;
      const p = scr.pointer(e);
      if (grab) {
        moved += Math.hypot(p.x - sx, p.y - sy); sx = p.x; sy = p.y;
        grab.x = FM.clamp(p.x / W, 0.05, 0.95); grab.y = FM.clamp(p.y / H, 0.1, 0.9);
        if (moved > 30) { moved = 0; ripple(grab.x, grab.y, 0.3, true); m.noise({ freq: 700, q: 0.6, filter: 'bandpass', a: 0.02, hold: 0.02, d: 0.12, gain: 0.02 }); }
      } else if (performance.now() - lastDrop > 220) { drop(p.x / W, p.y / H, 0.6); lastDrop = performance.now(); }
    });
    const up = () => { pressing = false; grab = null; };
    scr.canvas.addEventListener('pointerup', up);
    scr.canvas.addEventListener('pointercancel', up);

    m.onNote((note, velocity, on) => {
      if (!on) return;
      const v = velocity > 1 ? velocity / 127 : velocity;
      drop(FM.clamp((note - 36) / 60, 0.05, 0.95), FM.clamp(1 - (note - 40) / 50, 0.08, 0.92), 0.3 + 0.7 * v, FM.mtof(note));
    });

    m.keep(() => ({ p: pads.map((p) => [Math.round(p.x * 1000), Math.round(p.y * 1000)]) }),
      (d) => { if (d && Array.isArray(d.p)) d.p.forEach((q, i) => { if (pads[i] && q && isFinite(q[0]) && isFinite(q[1])) { pads[i].x = FM.clamp(q[0] / 1000, 0.05, 0.95); pads[i].y = FM.clamp(q[1] / 1000, 0.1, 0.9); } }); });

    m.frame((t, dt) => {
      phase += dt;
      if (hint > 0 && !pressing) hint -= dt;
      const ink = m.color('screen-ink'), alt = m.color('screen-alt'), dim = m.color('screen-dim');
      g.fillStyle = m.color('screen'); g.fillRect(0, 0, W, H);
      g.strokeStyle = dim; g.lineWidth = 1;
      for (let k = 0; k < 7; k++) {
        const y = H * (0.1 + k * 0.13);
        g.globalAlpha = 0.5; g.beginPath();
        for (let x = 0; x <= W; x += 24) { const yy = y + Math.sin(x * 0.02 + phase * 0.4 + k * 1.3) * 2.5; if (x) g.lineTo(x, yy); else g.moveTo(x, yy); }
        g.stroke();
      }
      for (let k = ripples.length - 1; k >= 0; k--) {
        const r = ripples[k]; r.t += dt;
        if (r.t > 4) { ripples.splice(k, 1); continue; }
        const a = Math.pow(1 - r.t / 4, 2) * r.v, x = r.x * W, y = r.y * H;
        g.strokeStyle = r.alt ? alt : ink; g.lineWidth = 1.2;
        for (let j = 0; j < 3; j++) {
          const rr = (r.t - j * 0.35) * Math.min(W, H) * 0.16;
          if (rr <= 0) continue;
          g.globalAlpha = a * (0.8 - j * 0.22);
          g.beginPath(); g.ellipse(x, y, rr * 1.5, rr * 0.75, 0, 0, 6.283); g.stroke();
        }
      }
      for (const p of pads) {
        p.bob *= Math.exp(-dt * 2.2);
        const R = padR(p) * (1 + 0.12 * p.bob), x = p.x * W + Math.sin(phase * 0.3 + p.ph) * 3, y = p.y * H + Math.cos(phase * 0.23 + p.ph) * 2;
        g.globalAlpha = 0.9; g.fillStyle = dim;
        g.beginPath(); g.moveTo(x, y); g.ellipse(x, y, R * 1.25, R * 0.7, 0, p.rot + 0.35, p.rot + 6.283 - 0.0); g.closePath(); g.fill();
        g.globalAlpha = 0.5 + 0.5 * p.bob; g.strokeStyle = ink; g.lineWidth = 1;
        g.beginPath(); g.ellipse(x, y, R * 1.25, R * 0.7, 0, p.rot + 0.35, p.rot + 6.283); g.stroke();
        if (p.lotus) {
          g.fillStyle = alt;
          for (let k = 0; k < 7; k++) {
            const an = k / 7 * 6.283 + p.rot;
            g.globalAlpha = 0.55 + 0.4 * p.bob;
            g.beginPath(); g.ellipse(x + Math.cos(an) * R * 0.3, y - R * 0.12 + Math.sin(an) * R * 0.17, R * 0.3, R * 0.13, an, 0, 6.283); g.fill();
          }
        } else {
          g.globalAlpha = 0.6 + 0.4 * p.bob; g.fillStyle = ink;
          g.beginPath(); g.arc(x - R * 0.2, y - R * 0.1 - p.bob * R * 0.5, R * 0.1, 0, 6.283); g.arc(x + R * 0.2, y - R * 0.1 - p.bob * R * 0.5, R * 0.1, 0, 6.283); g.fill();
        }
      }
      g.fillStyle = m.color('accent');
      for (const f of flies) {
        f.x += Math.sin(phase * 0.21 * f.s + f.p) * dt * 0.02; f.y += Math.cos(phase * 0.17 * f.s + f.p * 2) * dt * 0.02;
        if (f.x < 0) f.x += 1; if (f.x > 1) f.x -= 1; if (f.y < 0) f.y += 1; if (f.y > 1) f.y -= 1;
        g.globalAlpha = Math.max(0, Math.sin(phase * 0.9 * f.s + f.p)) * 0.8;
        g.beginPath(); g.arc(f.x * W, f.y * H, 1.6, 0, 6.283); g.fill();
      }
      g.globalAlpha = 1;
      if (hint > 0) {
        g.globalAlpha = Math.min(1, hint / 3) * 0.75; g.fillStyle = ink;
        g.font = Math.round(Math.max(11, Math.min(W, H) * 0.06)) + 'px system-ui, sans-serif'; g.textAlign = 'center';
        g.fillText('tap the water · drag a lily pad', W / 2, H - 10); g.globalAlpha = 1; g.textAlign = 'left';
      }
    });
  },
});
