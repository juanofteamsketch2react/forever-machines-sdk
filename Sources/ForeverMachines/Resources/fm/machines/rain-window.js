// Copyright (c) 2026 Juan Maguid, Temperamento. Forever Machines SDK License: free to try and for non-commercial use,
// commercial use needs a license. See LICENSE (https://forevermachines.net/sdk/LICENSE.txt).
FM.define({
  title: 'Rain Window',
  blurb: 'Rain on a window in a warm room, the city lights blurred behind it. A steady hush, drops that land where they please, and now and then one that rings like a spoon on a glass. Touch the glass and a drop will run down from your finger; drag across it and it leaves a trail. It will rain as long as you like.',
  thoughts: [
    'The best weather is the kind you are indoors for.',
    'Every drop falls once. Nothing here is a loop.',
    'The room is dry and the rain is far, and both are true.',
    'Rain does not need an audience, only a window.',
  ],
  build(m) {
    const ac = m.ac, pct = FM.fmt.pct;
    const scr = m.screen({ w: 560, h: 230, label: 'Window', flex: true });
    const { g } = scr;
    let W = scr.w, H = scr.h;
    scr.onResize((w, h) => { W = w; H = h; });

    const sky = m.section('Rain', { cols: 4 });
    const rain = sky.knob({ label: 'Rain', min: 0, max: 1, value: m.range(0.5, 0.7), fmt: pct, onChange: () => relevel() });
    const soften = sky.knob({ label: 'Soften', min: 200, max: 1400, curve: 'exp', value: m.range(380, 560), fmt: FM.fmt.hz, onChange: () => refilter() });
    const drops = sky.knob({ label: 'Drops', min: 0, max: 1, value: m.range(0.3, 0.5), fmt: pct });
    const plinks = sky.knob({ label: 'Plinks', min: 0, max: 1, value: m.range(0.2, 0.4), fmt: pct });
    const room = m.section('Room', { cols: 4 });
    const hum = room.knob({ label: 'Hum', min: 0, max: 1, value: m.range(0.3, 0.5), fmt: pct, onChange: () => relevel() });
    const gust = room.knob({ label: 'Gust', min: 0.02, max: 0.3, curve: 'exp', value: m.range(0.04, 0.08), fmt: FM.fmt.hz, onChange: () => relevel() });
    const space = room.knob({ label: 'Space', min: 0, max: 1, value: m.range(0.4, 0.6), fmt: pct, onChange: () => relevel() });
    room.select({ label: 'Scale', options: m.scaleNames, value: m.scale, onChange: (v) => m.setScale(v) });

    // soft noise: white noise with the top rolled off, so it rustles instead of hissing
    const soft = (() => {
      const sr = ac.sampleRate, n = sr * 4, fade = Math.floor(sr * 0.15), b = ac.createBuffer(1, n + fade, sr), d = b.getChannelData(0);
      let l = 0; for (let i = 0; i < n + fade; i++) { l = 0.9 * l + 0.1 * (Math.random() * 2 - 1); d[i] = l * 2.5; }
      for (let i = 0; i < fade; i++) { const w = i / fade; d[i] = d[i] * w + d[n + i] * (1 - w); }   // the loop point does not click
      const o = ac.createBuffer(1, n, sr); o.getChannelData(0).set(d.subarray(0, n)); return o;
    })();
    const mk = (rate) => { const s = ac.createBufferSource(); s.buffer = soft; s.loop = true; s.playbackRate.value = rate; return s; };
    const nA = mk(0.81), nB = mk(1.17);
    const sum = ac.createGain(); sum.gain.value = 0.5;
    nA.connect(sum); nB.connect(sum);
    const bus = ac.createGain(); bus.gain.value = 0.9;
    const send = ac.createGain(); send.gain.value = 0.4;
    bus.connect(m.out); bus.connect(send); send.connect(m.verb);

    // the hush: a low, soft wash with a body of rustle under it, swelling and thinning in slow gusts
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.3;
    const hiss = ac.createGain(); hiss.gain.value = 0;
    sum.connect(hp); hp.connect(lp); lp.connect(hiss); hiss.connect(bus);
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.5;
    const roof = ac.createGain(); roof.gain.value = 0;
    sum.connect(bp); bp.connect(roof); roof.connect(bus);
    const gl = ac.createOscillator(); gl.type = 'sine';
    const gAmp = ac.createGain(), gAmp2 = ac.createGain();
    gl.connect(gAmp); gAmp.connect(hiss.gain);
    gl.connect(gAmp2); gAmp2.connect(roof.gain);

    // a low warm hum, a fifth apart, breathing
    const hA = ac.createOscillator(), hB = ac.createOscillator();
    hA.type = 'sine'; hB.type = 'triangle';
    const hLp = ac.createBiquadFilter(); hLp.type = 'lowpass'; hLp.frequency.value = 300;
    const humG = ac.createGain(); humG.gain.value = 0;
    hA.connect(hLp); hB.connect(hLp); hLp.connect(humG); humG.connect(bus);
    const hLfo = ac.createOscillator(); hLfo.frequency.value = 0.04;
    const hAmp = ac.createGain(); hLfo.connect(hAmp); hAmp.connect(humG.gain);

    function relevel() {
      const now = ac.currentTime, r = rain.value;
      hiss.gain.setTargetAtTime(0.17 * r * 0.75, now, 0.6);
      roof.gain.setTargetAtTime(0.16 * r * 0.75, now, 0.6);
      gAmp.gain.setTargetAtTime(0.22 * r * 0.25, now, 0.6);
      gAmp2.gain.setTargetAtTime(0.22 * r * 0.25, now, 0.6);
      gl.frequency.setTargetAtTime(gust.value, now, 1);
      humG.gain.setTargetAtTime(0.035 * hum.value, now, 1.5);
      hAmp.gain.setTargetAtTime(0.012 * hum.value, now, 1.5);
      send.gain.setTargetAtTime(0.1 + 0.6 * space.value, now, 0.6);
    }
    function refilter() { lp.frequency.setTargetAtTime(soften.value, ac.currentTime, 0.5); }
    function retune() {
      const now = ac.currentTime;
      hA.frequency.setTargetAtTime(m.freq(0, -1), now, 1.5);
      hB.frequency.setTargetAtTime(m.freq(4, -1), now, 1.5);
    }
    lp.frequency.value = soften.value; gl.frequency.value = gust.value;
    hA.frequency.value = m.freq(0, -1); hB.frequency.value = m.freq(4, -1);
    relevel();
    [nA, nB, gl, hA, hB, hLfo].forEach((o) => o.start());
    m.every(4, retune);

    // the glass: drops that sit, then run, then sit again; bokeh behind it
    const glass = [];
    const bokeh = Array.from({ length: 14 }, () => ({
      x: Math.random(), y: 0.15 + Math.random() * 0.7, r: 0.04 + Math.random() * 0.06,
      a: 0.06 + Math.random() * 0.12, c: Math.floor(Math.random() * 3), p: Math.random() * 6.3, s: 0.05 + Math.random() * 0.1,
    }));
    function addDrop(x, y, r) {
      glass.push({ x, y, y0: y, r, vy: 0, wait: 0.5 + Math.random() * 5, run: 0, wob: Math.random() * 6.3 });
      if (glass.length > 46) glass.shift();
    }
    // a drop on the pane: a tick of sound, now and then a ring like a spoon on glass
    function drop(t, x, ring) {
      m.tone({ freq: 420 + Math.random() * 420, type: 'sine', a: 0.002, hold: 0, d: 0.07, gain: 0.012 + Math.random() * 0.02, pan: FM.clamp(x * 1.6 - 0.8, -0.8, 0.8), send: 0.3, t });
      if (ring) {
        const deg = [0, 2, 4, 7, 9][Math.floor(Math.random() * 5)];
        m.tone({ freq: m.freq(deg, 2 + (Math.random() < 0.4 ? 1 : 0)), type: 'sine', a: 0.004, hold: 0, d: 1.6, gain: 0.03 * (0.4 + plinks.value), send: 0.9, pan: FM.clamp(x * 1.6 - 0.8, -0.8, 0.8), t });
      }
    }
    m.every(0.25, () => {
      if (!m.on) return;
      const lam = drops.value * 9 * 0.25;
      let n = 0; for (let L = Math.exp(-lam), p = 1; (p *= Math.random()) > L && n < 6;) n++;
      for (let i = 0; i < n; i++) {
        const x = Math.random(), t = ac.currentTime + Math.random() * 0.25;
        drop(t, x, Math.random() < plinks.value * 0.5);
        addDrop(x * W, Math.random() * H * 0.6, 2 + Math.random() * 2.5);
      }
    });

    let pressing = false, lastX = 0, lastY = 0, hint = 12, phase = 0;
    scr.canvas.addEventListener('pointerdown', (e) => {
      const p = scr.pointer(e);
      pressing = true; lastX = p.x; lastY = p.y; hint = 0;
      scr.canvas.setPointerCapture(e.pointerId);
      drop(ac.currentTime, p.x / W, false);
      m.tone({ freq: m.freq(Math.round((p.x / W) * 7), 2), type: 'sine', a: 0.004, hold: 0, d: 2.2, gain: 0.06, send: 0.9, pan: FM.clamp(p.x / W * 1.6 - 0.8, -0.8, 0.8) });
      addDrop(p.x, p.y, 6 + Math.random() * 2); glass[glass.length - 1].wait = 0.2;
    });
    scr.canvas.addEventListener('pointermove', (e) => {
      if (!pressing) return;
      const p = scr.pointer(e);
      if (Math.hypot(p.x - lastX, p.y - lastY) < 26) return;
      lastX = p.x; lastY = p.y;
      drop(ac.currentTime, p.x / W, Math.random() < 0.5);
      addDrop(p.x, p.y, 3 + Math.random() * 3); glass[glass.length - 1].wait = 0.4 + Math.random();
    });
    const up = () => { pressing = false; };
    scr.canvas.addEventListener('pointerup', up);
    scr.canvas.addEventListener('pointercancel', up);

    m.onNote((note, velocity, on) => {
      if (!on) return;
      const v = velocity > 1 ? velocity / 127 : velocity;
      m.tone({ freq: FM.mtof(note), type: 'sine', a: 0.004, hold: 0, d: 2.4, gain: 0.05 * (0.3 + v), send: 0.9 });
      addDrop(FM.clamp((note - 36) / 60, 0.05, 0.95) * W, H * 0.1, 6);
    });

    m.frame((t, dt) => {
      phase += dt;
      if (!pressing && hint > 0) hint -= dt;
      g.fillStyle = m.color('screen'); g.fillRect(0, 0, W, H);
      // the city behind the glass, out of focus
      const cols = [m.color('accent'), m.color('screen-alt'), m.color('screen-ink')];
      for (const b of bokeh) {
        const x = (b.x + Math.sin(phase * b.s + b.p) * 0.01) * W, y = b.y * H, r = b.r * Math.min(W, H) * 1.6;
        g.globalAlpha = b.a * (0.8 + 0.2 * Math.sin(phase * 0.2 + b.p)); g.fillStyle = cols[b.c];
        g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
      }
      g.globalAlpha = 1;
      const sc = Math.max(0.7, Math.min(W, H) / 200);
      for (let i = glass.length - 1; i >= 0; i--) {
        const d = glass[i];
        if (d.wait > 0) { d.wait -= dt; if (d.wait <= 0) { d.run = 0.6 + Math.random() * 2.5; d.vy = 14 + Math.random() * 40; } }
        else if (d.run > 0) { d.run -= dt; d.y += d.vy * dt * sc; d.x += Math.sin(phase * 1.5 + d.wob) * dt * 3; if (d.run <= 0) { d.vy = 0; d.wait = 0.8 + Math.random() * 6; } }
        if (d.y > H + 12) { glass.splice(i, 1); continue; }
        const r = d.r * sc;
        if (d.y - d.y0 > 1) { g.globalAlpha = 0.18; g.strokeStyle = m.color('screen-ink'); g.lineWidth = Math.max(1, r * 0.5); g.beginPath(); g.moveTo(d.x, d.y0); g.lineTo(d.x, d.y); g.stroke(); }
        g.globalAlpha = 0.22; g.fillStyle = m.color('screen-ink');
        g.beginPath(); g.ellipse(d.x, d.y, r, r * 1.25, 0, 0, 6.283); g.fill();
        g.globalAlpha = 0.6; g.fillStyle = m.color('screen');
        g.beginPath(); g.arc(d.x - r * 0.25, d.y - r * 0.35, r * 0.3, 0, 6.283); g.fill();
      }
      g.globalAlpha = 1;
      if (hint > 0) {
        g.globalAlpha = Math.min(1, hint / 3) * 0.75; g.fillStyle = m.color('screen-ink');
        g.font = Math.round(Math.max(11, Math.min(W, H) * 0.06)) + 'px system-ui, sans-serif'; g.textAlign = 'center';
        g.fillText('touch the glass', W / 2, H - 10); g.globalAlpha = 1; g.textAlign = 'left';
      }
    });
  },
});
