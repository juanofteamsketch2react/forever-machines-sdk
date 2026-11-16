// Copyright (c) 2026 Juan Maguid, Temperamento. Forever Machines SDK License: free to try and for non-commercial use,
// commercial use needs a license. See LICENSE (https://forevermachines.net/sdk/LICENSE.txt).
FM.define({
  title: 'Slow Tide',
  blurb: 'A shore at night, breathing. Waves swell and withdraw every dozen seconds or so, never twice alike, over a low hum and the rare far-off bell. Touch the water and hold: a bigger swell rolls in, and let go and it drains away again. Leave it running; it asks for nothing.',
  thoughts: [
    'The sea does not hurry, and has never once been late.',
    'A wave is a promise kept a little differently each time.',
    'Close your eyes. The picture is only there for company.',
    'Nothing here wants anything from you.',
  ],
  build(m) {
    const ac = m.ac, pct = FM.fmt.pct;
    const scr = m.screen({ w: 560, h: 230, label: 'Shore', flex: true });
    const { g } = scr;
    let W = scr.w, H = scr.h;
    scr.onResize((w, h) => { W = w; H = h; });

    const sea = m.section('Sea', { cols: 3 });
    const swell = sea.knob({ label: 'Swell', min: 5, max: 30, value: m.range(11, 16), fmt: (v) => v.toFixed(0) + ' s', onChange: () => retime() });
    const depth = sea.knob({ label: 'Depth', min: 0, max: 1, value: m.range(0.55, 0.8), fmt: pct, onChange: () => relevel() });
    const shore = sea.knob({ label: 'Shore', min: 150, max: 1200, curve: 'exp', value: m.range(350, 700), fmt: FM.fmt.hz, onChange: () => refilter() });
    const night = m.section('Night', { cols: 4 });
    const hush = night.knob({ label: 'Hush', min: 0.1, max: 1, value: m.range(0.5, 0.7), fmt: pct, onChange: () => relevel() });
    const hum = night.knob({ label: 'Hum', min: 0, max: 1, value: m.range(0.3, 0.5), fmt: pct, onChange: () => relevel() });
    const bells = night.knob({ label: 'Bells', min: 0, max: 1, value: m.range(0.3, 0.5), fmt: pct });
    night.select({ label: 'Scale', options: m.scaleNames, value: m.scale, onChange: (v) => m.setScale(v) });

    // two copies of the same noise at different speeds never line up: the sea does not loop
    // soft noise: white noise with the top rolled off, so it rustles instead of hissing
    const soft = (() => {
      const sr = ac.sampleRate, n = sr * 4, fade = Math.floor(sr * 0.15), b = ac.createBuffer(1, n + fade, sr), d = b.getChannelData(0);
      let l = 0; for (let i = 0; i < n + fade; i++) { l = 0.9 * l + 0.1 * (Math.random() * 2 - 1); d[i] = l * 2.5; }
      for (let i = 0; i < fade; i++) { const w = i / fade; d[i] = d[i] * w + d[n + i] * (1 - w); }   // the loop point does not click
      const o = ac.createBuffer(1, n, sr); o.getChannelData(0).set(d.subarray(0, n)); return o;
    })();
    const mk = (rate) => { const s = ac.createBufferSource(); s.buffer = soft; s.loop = true; s.playbackRate.value = rate; return s; };
    const nA = mk(0.87), nB = mk(1.09);
    const sum = ac.createGain(); sum.gain.value = 0.5;
    nA.connect(sum); nB.connect(sum);

    const bus = ac.createGain(); bus.gain.value = 0.9;
    const send = ac.createGain(); send.gain.value = 0.3;
    bus.connect(m.out); bus.connect(send); send.connect(m.verb);

    // the body of the wave: low and soft
    const body = ac.createBiquadFilter(); body.type = 'lowpass'; body.Q.value = 0.3;
    const surf = ac.createGain(); surf.gain.value = 0;
    sum.connect(body); body.connect(surf); surf.connect(bus);

    // the swell: two slow sines that never meet again, one also opens the filter on the way in
    const lfoA = ac.createOscillator(), lfoB = ac.createOscillator();
    lfoA.type = lfoB.type = 'sine';
    const aAmp = ac.createGain(), bAmp = ac.createGain(), fMod = ac.createGain();
    lfoA.connect(aAmp); aAmp.connect(surf.gain);
    lfoB.connect(bAmp); bAmp.connect(surf.gain);
    lfoA.connect(fMod); fMod.connect(body.detune);
    // a hand on the water: a constant that rises while held and falls when let go
    const bumpSrc = ac.createConstantSource(); bumpSrc.offset.value = 0;
    const bumpSurf = ac.createGain();
    bumpSrc.connect(bumpSurf); bumpSurf.connect(surf.gain);

    // the hum of the night: two soft sines a fifth apart, breathing
    const hA = ac.createOscillator(), hB = ac.createOscillator();
    hA.type = 'sine'; hB.type = 'triangle';
    const humG = ac.createGain(); humG.gain.value = 0;
    const hLp = ac.createBiquadFilter(); hLp.type = 'lowpass'; hLp.frequency.value = 260;
    hA.connect(hLp); hB.connect(hLp); hLp.connect(humG); humG.connect(bus);
    const hLfo = ac.createOscillator(); hLfo.frequency.value = 0.045;
    const hAmp = ac.createGain(); hLfo.connect(hAmp); hAmp.connect(humG.gain);

    // what the screen hears: the real level of the surf
    const an = ac.createAnalyser(); an.fftSize = 256; surf.connect(an);
    const buf = new Uint8Array(an.fftSize);

    function relevel() {
      const now = ac.currentTime, L = hush.value * 0.9, d = depth.value;
      surf.gain.setTargetAtTime(L * 0.6, now, 0.5);
      aAmp.gain.setTargetAtTime(L * 0.35 * d, now, 0.5);
      bAmp.gain.setTargetAtTime(L * 0.2 * d, now, 0.5);
      bumpSurf.gain.setTargetAtTime(L * 0.5, now, 0.5);
      fMod.gain.setTargetAtTime(900 * d, now, 0.5);
      humG.gain.setTargetAtTime(0.035 * hum.value, now, 1.5);
      hAmp.gain.setTargetAtTime(0.012 * hum.value, now, 1.5);
    }
    function retime() {
      const now = ac.currentTime, f = 1 / swell.value;
      lfoA.frequency.setTargetAtTime(f, now, 1.5);
      lfoB.frequency.setTargetAtTime(f / 1.37, now, 1.5);
    }
    function refilter() { body.frequency.setTargetAtTime(shore.value, ac.currentTime, 0.6); }
    function retune() {
      const now = ac.currentTime;
      hA.frequency.setTargetAtTime(m.freq(0, -1), now, 1.5);
      hB.frequency.setTargetAtTime(m.freq(4, -1), now, 1.5);
    }
    body.frequency.value = shore.value; lfoA.frequency.value = 1 / swell.value; lfoB.frequency.value = 1 / swell.value / 1.37;
    hA.frequency.value = m.freq(0, -1); hB.frequency.value = m.freq(4, -1);
    relevel();
    [nA, nB, lfoA, lfoB, bumpSrc, hA, hB, hLfo].forEach((o) => o.start());
    m.every(4, retune);

    const ripples = [];
    // bells: rare, far, soft, and a long way in
    function bell(freq, gain) {
      m.tone({ freq, type: 'sine', a: 1.8, hold: 0.6, d: 8, gain, send: 1, pan: Math.random() * 1.2 - 0.6 });
      m.tone({ freq: freq * 2.01, type: 'sine', a: 2.4, hold: 0.2, d: 5, gain: gain * 0.25, send: 1, pan: Math.random() * 1.2 - 0.6 });
    }
    m.every(1, () => {
      const b = bells.value;
      if (b < 0.02 || !m.on) return;
      if (Math.random() < 1 / (45 - 32 * b)) {
        const deg = [0, 2, 4, 7, 9][Math.floor(Math.random() * 5)];
        bell(m.freq(deg, 1 + Math.floor(Math.random() * 2)), 0.04 * (0.4 + b));
        ripples.push({ x: 0.1 + Math.random() * 0.8, t: 0, soft: true });
      }
    });

    // touch: hold to bring a bigger swell in (higher on the screen, bigger), let go to let it drain
    let pressing = false, py = 0.5, push = 0, hint = 12, lvl = 0, lvlMax = 0.001, phase = 0;
    const star = Array.from({ length: 36 }, () => ({ x: Math.random(), y: Math.random() * 0.5, p: Math.random() * 6.3, s: 0.5 + Math.random() }));
    scr.canvas.addEventListener('pointerdown', (e) => {
      const p = scr.pointer(e);
      pressing = true; py = FM.clamp(1 - p.y / H, 0.15, 1);
      scr.canvas.setPointerCapture(e.pointerId);
      bumpSrc.offset.setTargetAtTime(py, ac.currentTime, 0.7);
      bell(m.freq(Math.round((p.x / W) * 6) * 1, 1), 0.05);
      ripples.push({ x: p.x / W, t: 0 });
      hint = 0;
    });
    scr.canvas.addEventListener('pointermove', (e) => {
      if (!pressing) return;
      py = FM.clamp(1 - scr.pointer(e).y / H, 0.15, 1);
      bumpSrc.offset.setTargetAtTime(py, ac.currentTime, 0.7);
    });
    const release = () => { if (!pressing) return; pressing = false; bumpSrc.offset.setTargetAtTime(0, ac.currentTime, 3.5); };
    scr.canvas.addEventListener('pointerup', release);
    scr.canvas.addEventListener('pointercancel', release);

    m.onNote((note, velocity, on) => {
      if (!on) return;
      const v = velocity > 1 ? velocity / 127 : velocity;
      bell(FM.mtof(note), 0.05 * (0.3 + v));
      ripples.push({ x: FM.clamp((note - 36) / 60, 0.05, 0.95), t: 0 });
    });

    m.frame((t, dt) => {
      phase += dt;
      // the level of the surf, as heard, scaled against its own loudest
      an.getByteTimeDomainData(buf);
      let s = 0; for (let i = 0; i < buf.length; i++) { const x = (buf[i] - 128) / 128; s += x * x; }
      const r = Math.sqrt(s / buf.length);
      lvlMax = Math.max(lvlMax * 0.9997, r, 0.001);
      lvl += (FM.clamp(r / lvlMax, 0, 1) - lvl) * Math.min(1, dt * 2);
      push += ((pressing ? py : 0) - push) * Math.min(1, dt * (pressing ? 1.2 : 0.4));
      if (!pressing && hint > 0) hint -= dt;
      const h = Math.min(1, 0.18 + 0.7 * lvl + 0.35 * push);

      g.fillStyle = m.color('screen'); g.fillRect(0, 0, W, H);
      // stars, and a moon
      for (const st of star) {
        const a = 0.25 + 0.35 * Math.sin(phase * 0.4 * st.s + st.p);
        g.globalAlpha = Math.max(0.05, a) * 0.8; g.fillStyle = m.color('screen-ink');
        g.fillRect(st.x * W, st.y * H * 0.9, 1.5, 1.5);
      }
      g.globalAlpha = 0.5; g.fillStyle = m.color('screen-alt');
      g.beginPath(); g.arc(W * 0.8, H * 0.2, Math.max(8, Math.min(W, H) * 0.06), 0, 6.283); g.fill();
      g.globalAlpha = 1;
      // four swells, back to front; the sea comes up the screen with the level
      const base = H * (0.78 - 0.28 * h);
      for (let i = 0; i < 4; i++) {
        const amp = (3 + 14 * h) * (0.5 + i * 0.28);
        const y0 = base + i * H * 0.07;
        g.beginPath(); g.moveTo(0, H);
        for (let x = 0; x <= W; x += 4) {
          const y = y0 + Math.sin(x * 0.012 * (1 + i * 0.3) + phase * (0.35 + i * 0.12) + i * 1.7) * amp
            + Math.sin(x * 0.027 + phase * 0.5 + i) * amp * 0.35;
          g.lineTo(x, y);
        }
        g.lineTo(W, H); g.closePath();
        g.globalAlpha = 0.12 + i * 0.07; g.fillStyle = i % 2 ? m.color('screen-alt') : m.color('screen-ink'); g.fill();
        g.globalAlpha = 0.5 + i * 0.1; g.strokeStyle = m.color('screen-ink'); g.lineWidth = 1 + i * 0.4; g.stroke();
      }
      g.globalAlpha = 1;
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i]; rp.t += dt;
        if (rp.t > 5) { ripples.splice(i, 1); continue; }
        g.globalAlpha = (1 - rp.t / 5) * (rp.soft ? 0.25 : 0.5); g.strokeStyle = m.color('screen-ink'); g.lineWidth = 1;
        g.beginPath(); g.ellipse(rp.x * W, base + H * 0.12, 8 + rp.t * W * 0.07, 3 + rp.t * W * 0.016, 0, 0, 6.283); g.stroke();
      }
      g.globalAlpha = 1;
      if (hint > 0) {
        g.globalAlpha = Math.min(1, hint / 3) * 0.7; g.fillStyle = m.color('screen-ink');
        g.font = Math.round(Math.max(11, Math.min(W, H) * 0.06)) + 'px system-ui, sans-serif'; g.textAlign = 'center';
        g.fillText('touch the water, and hold', W / 2, H * 0.1 + 6); g.globalAlpha = 1; g.textAlign = 'left';
      }
    });
  },
});
