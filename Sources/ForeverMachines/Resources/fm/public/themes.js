/* Device skins. Every machine is born wearing one of these (or a mutant). */
window.FM_THEMES = (function () {
  const T = (name, label, v) => ({ name, label, vars: v });
  const curated = [
    T('live', 'Live', {
      page: '#cdb8f0', 'page-ink': '#2a1f3d', dev: '#b4b4b4', head: '#bebebe', line: '#9a9a9a', ink: '#111', dim: '#4a4a4a',
      accent: '#ffad1f', accent2: '#12dcef', 'accent-ink': '#111', track: '#3b3b3b', field: '#d6d6d6', 'field-ink': '#111',
      screen: '#1c1c1c', 'screen-ink': '#12dcef', 'screen-alt': '#ffad1f', 'screen-dim': '#3a3a3a',
    }),
    T('phosphor', 'Phosphor', {
      page: '#07110a', 'page-ink': '#7dffa8', dev: '#111a13', head: '#16221a', line: '#243427', ink: '#b9ffcf', dim: '#5e8a6a',
      accent: '#ffb000', accent2: '#39ff7a', 'accent-ink': '#031007', track: '#24342a', field: '#0b130d', 'field-ink': '#b9ffcf',
      screen: '#020805', 'screen-ink': '#39ff7a', 'screen-alt': '#ffb000', 'screen-dim': '#12301c',
    }),
    T('bakelite', 'Bakelite', {
      page: '#2b1d15', 'page-ink': '#efe2c4', dev: '#e9dfc8', head: '#ddd0b3', line: '#c2b292', ink: '#2b1a10', dim: '#7a634c',
      accent: '#c8401c', accent2: '#2f6b5e', 'accent-ink': '#fff8ea', track: '#b8a689', field: '#f6efdd', 'field-ink': '#2b1a10',
      screen: '#24170f', 'screen-ink': '#ffbf5a', 'screen-alt': '#ff6a3d', 'screen-dim': '#4a3424',
    }),
    T('riso', 'Riso', {
      page: '#f1ece1', 'page-ink': '#1d3fbb', dev: '#fffdf7', head: '#f6f1e4', line: '#d9d2c2', ink: '#1d3fbb', dim: '#6b7bb8',
      accent: '#ff4f9a', accent2: '#1d3fbb', 'accent-ink': '#ffffff', track: '#e2dccd', field: '#ffffff', 'field-ink': '#1d3fbb',
      screen: '#1d3fbb', 'screen-ink': '#fffdf7', 'screen-alt': '#ff4f9a', 'screen-dim': '#3553c8',
    }),
    T('midnight', 'Midnight', {
      page: '#070a1c', 'page-ink': '#c9d0ff', dev: '#151b3d', head: '#1b2249', line: '#28326a', ink: '#dfe4ff', dim: '#7d87c4',
      accent: '#ff3d9a', accent2: '#3df5e0', 'accent-ink': '#fff', track: '#2a3470', field: '#0d1230', 'field-ink': '#dfe4ff',
      screen: '#05071a', 'screen-ink': '#3df5e0', 'screen-alt': '#ff3d9a', 'screen-dim': '#1c2350',
    }),
    T('sulfur', 'Sulfur', {
      page: '#1a1a12', 'page-ink': '#f2d633', dev: '#f2d633', head: '#e8cb22', line: '#c9ae12', ink: '#141414', dim: '#5b5110',
      accent: '#141414', accent2: '#e0301e', 'accent-ink': '#f2d633', track: '#b99f12', field: '#fff5b0', 'field-ink': '#141414',
      screen: '#141414', 'screen-ink': '#f2d633', 'screen-alt': '#e0301e', 'screen-dim': '#3a3510',
    }),
    T('lab', 'Laboratory', {
      page: '#dde2e6', 'page-ink': '#1b1f23', dev: '#f7f8f9', head: '#eef0f2', line: '#d5d9dd', ink: '#1b1f23', dim: '#8a9299',
      accent: '#ff3b30', accent2: '#0a84ff', 'accent-ink': '#fff', track: '#d5d9dd', field: '#ffffff', 'field-ink': '#1b1f23',
      screen: '#e9edf0', 'screen-ink': '#1b1f23', 'screen-alt': '#ff3b30', 'screen-dim': '#c7cdd2',
    }),
    T('moss', 'Moss', {
      page: '#0f160e', 'page-ink': '#e9e4cf', dev: '#2d3a2a', head: '#344331', line: '#445640', ink: '#e9e4cf', dim: '#9aa58b',
      accent: '#ff9d6b', accent2: '#c6e86b', 'accent-ink': '#1b1b1b', track: '#1d261b', field: '#1d261b', 'field-ink': '#e9e4cf',
      screen: '#121a11', 'screen-ink': '#c6e86b', 'screen-alt': '#ff9d6b', 'screen-dim': '#263224',
    }),
    T('ivory', 'Ivory Tower', {
      page: '#4a4038', 'page-ink': '#f4ecdc', dev: '#f4ecdc', head: '#eae0cc', line: '#d4c7ad', ink: '#2c2620', dim: '#8c7f6c',
      accent: '#3a6ea5', accent2: '#c9772e', 'accent-ink': '#fff', track: '#d9ccb2', field: '#fffaf0', 'field-ink': '#2c2620',
      screen: '#2c2620', 'screen-ink': '#f4ecdc', 'screen-alt': '#c9772e', 'screen-dim': '#4d433a',
    }),
    T('ultraviolet', 'Ultraviolet', {
      page: '#12001f', 'page-ink': '#e2c6ff', dev: '#24073b', head: '#2d0b49', line: '#45176b', ink: '#efdcff', dim: '#a07cc2',
      accent: '#d4ff3a', accent2: '#b26bff', 'accent-ink': '#12001f', track: '#3a1460', field: '#1a042c', 'field-ink': '#efdcff',
      screen: '#0b0014', 'screen-ink': '#d4ff3a', 'screen-alt': '#ff5ed8', 'screen-dim': '#2b0e47',
    }),
    // a beige 70s case around a DOS-blue text-mode screen, with the orange, yellow and cyan of 70s stripes
    T('textmode', 'Text Mode', {
      page: '#1b1f4a', 'page-ink': '#efe6cf', dev: '#e3d9c3', head: '#d8ccb1', line: '#b8ab90', ink: '#1b1f4a', dim: '#6c6a8a',
      accent: '#f2542d', accent2: '#1f9bdc', 'accent-ink': '#fffaf0', track: '#c2b597', field: '#f5efe0', 'field-ink': '#1b1f4a',
      screen: '#0a1fa8', 'screen-ink': '#e8e8e8', 'screen-alt': '#ffd23f', 'screen-dim': '#2236c0',
    }),
  ];

  // colours are emitted as hex so the kit colour helpers can parse them
  function hex(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
  }

  // A mutant skin generated from a seed: a base hue, a light or dark body, two loud accents.
  function mutant(rand) {
    const h = Math.floor(rand() * 360);
    const dark = rand() < 0.55;
    const a1 = h + 140 + Math.floor(rand() * 80), a2 = h + 200 + Math.floor(rand() * 60);
    const ds = 8 + Math.floor(rand() * 22);
    const v = dark
      ? { page: hex(h, ds, 5), 'page-ink': hex(h, 40, 82), dev: hex(h, ds, 15), head: hex(h, ds, 19), line: hex(h, ds, 26), ink: hex(h, 25, 90), dim: hex(h, 15, 60),
          track: hex(h, ds, 28), field: hex(h, ds, 10), 'field-ink': hex(h, 25, 90), screen: hex(h, ds, 6), 'screen-dim': hex(h, ds + 10, 20) }
      : { page: hex(h + 30, 30, 30), 'page-ink': hex(h, 30, 92), dev: hex(h, ds, 80), head: hex(h, ds, 85), line: hex(h, ds, 66), ink: hex(h, 30, 10), dim: hex(h, 15, 35),
          track: hex(h, ds, 58), field: hex(h, ds, 92), 'field-ink': hex(h, 30, 10), screen: hex(h, 30, 10), 'screen-dim': hex(h, 25, 22) };
    v.accent = hex(a1, 95, 58);
    v.accent2 = hex(a2, 90, 60);
    v['accent-ink'] = hex(h, 30, 8);
    v['screen-ink'] = hex(a2, 95, 66);
    v['screen-alt'] = hex(a1, 100, 62);
    return { name: 'mutant-' + h, label: 'Mutant ' + h + '°', vars: v };
  }

  // skins a visitor can pick but no machine is dealt at random (so seeded mutations keep their looks)
  const extra = [
    // a tower block: a poured-concrete case, a screen in the dark gloss green of council stairwell paint, lit by a sodium lamp, with hi-vis yellow
    T('council', 'Council', {
      page: '#24251f', 'page-ink': '#e4dfcf', dev: '#a8a59b', head: '#b4b1a6', line: '#8b887e', ink: '#1c1d1a', dim: '#55544c',
      accent: '#ff8a1c', accent2: '#2f5d4a', 'accent-ink': '#1c1d1a', track: '#7d7a70', field: '#cbc8bc', 'field-ink': '#1c1d1a',
      screen: '#12231c', 'screen-ink': '#ffb35c', 'screen-alt': '#f2df4a', 'screen-dim': '#2c4a3d',
    }),
    // a pond at night: deep teal water, a pink lotus, fireflies (the sleep retreat's own skin)
    T('lagoon', 'Lagoon', {
      page: '#04141a', 'page-ink': '#cdeee6', dev: '#0b2a31', head: '#0e343c', line: '#1a4c56', ink: '#d9f5ee', dim: '#6fa7a4',
      accent: '#ff8fc0', accent2: '#5cf2c8', 'accent-ink': '#04141a', track: '#12404a', field: '#06191e', 'field-ink': '#d9f5ee',
      screen: '#031014', 'screen-ink': '#5cf2c8', 'screen-alt': '#ff8fc0', 'screen-dim': '#0f3138',
    }),
  ];
  const all = curated.concat(extra);

  return { curated, extra, all, mutant, byName: Object.fromEntries(all.map((t) => [t.name, t])) };
})();
