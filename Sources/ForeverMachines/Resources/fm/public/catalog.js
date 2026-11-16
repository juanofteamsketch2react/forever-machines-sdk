/*
 * The catalog: which machine is No. N, with its name, skin and thought. Fully determined by the
 * registry and the date, so the collection, the Workbench and the Max for Live device all agree.
 */
window.FMCatalog = (function () {
  'use strict';
  const WEEK = 7 * 864e5;
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

  // ── names ──
  const ADJ = ['Velvet', 'Ferric', 'Hollow', 'Lunar', 'Rubber', 'Cobalt', 'Feral', 'Dusty', 'Glass', 'Paper', 'Sour', 'Quiet', 'Brass', 'Tidal', 'Moth-eaten',
    'Patient', 'Nervous', 'Sunken', 'Borrowed', 'Electric', 'Woolen', 'Molten', 'Tiny', 'Enormous', 'Sleepy', 'Ancient', 'Orbital', 'Damp', 'Gilded', 'Static',
    'Wandering', 'Crooked', 'Polite', 'Feverish', 'Bioluminescent', 'Analog', 'Salted', 'Second-hand', 'Midnight', 'Clockwork'];
  const NOUN = ['Choir', 'Ratchet', 'Engine', 'Loom', 'Garden', 'Clock', 'Swarm', 'Organ', 'Kettle', 'Siphon', 'Harp', 'Furnace', 'Lantern', 'Tide', 'Wheel',
    'Bellows', 'Aviary', 'Observatory', 'Lighthouse', 'Mill', 'Hive', 'Carousel', 'Barometer', 'Reliquary', 'Telegraph', 'Greenhouse', 'Metronome', 'Chapel',
    'Abacus', 'Weathervane', 'Aquarium', 'Pantograph', 'Gramophone', 'Kaleidoscope', 'Orrery', 'Foghorn', 'Seismograph', 'Music Box'];
  const FOR = ['Absent Birds', 'Slow Rivers', 'the Night Shift', 'Empty Rooms', 'Small Weather', 'Lost Satellites', 'Late Trains', 'Insomniacs', 'Moths',
    'Unsent Letters', 'the Year 3000', 'Retired Robots', 'Lighthouse Keepers', 'Snails', 'People Who Hum', 'Sunday Afternoons', 'Deep-Sea Fish', 'Ghosts',
    'Abandoned Malls', 'the Last Bus', 'Cats Asleep', 'Distant Thunder', 'Forgotten Passwords', 'Old Radios', 'Houseplants'];
  const ROMAN = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'IX', 'XII'];

  function genName(rand) {
    const p = (a) => a[Math.floor(rand() * a.length)];
    const k = rand();
    if (k < 0.32) return `${p(ADJ)} ${p(NOUN)}`;
    if (k < 0.52) return `${p(NOUN)} for ${p(FOR)}`;
    if (k < 0.68) return `${p(ADJ)} ${p(NOUN)} Mk ${p(ROMAN)}`;
    if (k < 0.82) return `The ${p(ADJ)} ${p(NOUN)}`;
    return `${p(NOUN)} No. ${1 + Math.floor(rand() * 99)}`;
  }

  // ── the birth clock: a machine is born every Monday at a local time in one time zone (registry "birth",
  // e.g. { "tz": "Europe/Stockholm", "time": "06:00" }; without it, 00:00 UTC). Counting on the local wall clock
  // keeps the hour through daylight saving changes. weeksAt(ms): births since genesis; bornAt(k): when birth k happens.
  const fmts = {};
  function offset(ms, tz) { // the zone's wall clock minus UTC at instant ms, in ms
    if (tz === 'UTC') return 0;
    const f = fmts[tz] || (fmts[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }));
    const p = {};
    for (const x of f.formatToParts(new Date(ms))) p[x.type] = +x.value;
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
  }
  function clock(reg) {
    const b = reg.birth || {}, tz = b.tz || 'UTC';
    const [hh, mm] = String(b.time || '00:00').split(':').map(Number);
    const wallEpoch = Date.parse(reg.epoch + 'T00:00:00Z') + ((hh || 0) * 60 + (mm || 0)) * 6e4; // Monday at the birth time, on the wall clock
    const toInstant = (wall) => { let t = wall - offset(wall, tz); t = wall - offset(t, tz); return t; };
    return {
      tz, time: b.time || '00:00',
      epoch: toInstant(wallEpoch),
      weeksAt: (ms) => Math.max(0, Math.floor((ms + offset(ms, tz) - wallEpoch) / WEEK)),
      bornAt: (k) => toInstant(wallEpoch + k * WEEK),
    };
  }

  // ── catalog: deterministic, computed in order ──
  function build(reg, nowMs) {
    const clk = clock(reg);
    const epoch = clk.epoch;
    const weeks = clk.weeksAt(nowMs);
    const count = reg.genesis + weeks;
    const archetypes = reg.archetypes.slice().sort((a, b) => a.debut - b.debut || a.id.localeCompare(b.id));
    const out = [];
    const recent = [];
    let prevTheme = null;
    for (let i = 0; i < count; i++) {
      const seed = hash32('forever:' + i);
      const rand = mulberry32(seed);
      let arch = archetypes.find((a) => a.debut === i);
      const original = !!arch;
      if (!arch) {
        const older = archetypes.filter((a) => a.debut < i);
        let pool = older.filter((a) => !recent.includes(a.id));
        if (!pool.length) pool = older;
        arch = pool[Math.floor(rand() * pool.length)];
      }
      recent.push(arch.id);
      if (recent.length > Math.min(4, archetypes.length - 1)) recent.shift();

      const name = original ? arch.title : genName(rand);
      let theme;
      if (original && arch.theme && FM_THEMES.byName[arch.theme]) theme = FM_THEMES.byName[arch.theme];
      else if (rand() < 0.3) theme = FM_THEMES.mutant(rand);
      else {
        const opts = FM_THEMES.curated.filter((t) => t.name !== prevTheme);
        theme = opts[Math.floor(rand() * opts.length)];
      }
      prevTheme = theme.name;
      const thoughts = arch.thoughts && arch.thoughts.length ? arch.thoughts : [''];
      const thought = original ? thoughts[0] : thoughts[Math.floor(rand() * thoughts.length)];
      // liveFrom lets a debut go live early (it then counts as part of genesis)
      const born = original && arch.liveFrom ? Date.parse(arch.liveFrom + 'T00:00:00Z') : i < reg.genesis ? epoch : clk.bornAt(i - reg.genesis + 1);
      out.push({ i, seed, arch, original, name, theme, thought, born });
    }
    return { catalog: out, count, epoch, weeks, archetypes, bonus: bonuses(reg, nowMs, clk) };
  }

  // ── bonus machines: a surprise outside the weekly births (registry "bonus", each with the moment it drops). A bonus
  // takes no number from the line: one that drops after No. 015 is No. 015½ and sits between No. 015 and No. 016
  // (a second in the same week is 015¾). In the code it is index 500 + k, and its address is /501 + k. ──
  const BONUS_BASE = 500;
  const HALVES = ['½', '¾', '⅞'];
  function bonuses(reg, nowMs, clk) {
    const out = [], per = {};
    for (const [k, b] of (reg.bonus || []).entries()) {
      const at = Date.parse(b.dropped);
      if (!(at <= nowMs) || !b.file) continue;
      const after = reg.genesis + clk.weeksAt(at); // machines born when it dropped
      const m = per[after] = (per[after] || 0) + 1;
      const seed = hash32('bonus:' + b.id);
      const theme = (b.theme && FM_THEMES.byName[b.theme]) || FM_THEMES.curated[seed % FM_THEMES.curated.length];
      out.push({ i: BONUS_BASE + k, seed, arch: b, original: true, bonus: true, name: b.title, theme,
        thought: (b.thoughts || [''])[0], born: at, after, pos: after - 1 + m / (HALVES.length + 2),
        no: String(after).padStart(3, '0') + (HALVES[m - 1] || '+' + m) });
    }
    return out;
  }
  return { build, clock, mulberry32, hash32, WEEK, BONUS_BASE };
})();
