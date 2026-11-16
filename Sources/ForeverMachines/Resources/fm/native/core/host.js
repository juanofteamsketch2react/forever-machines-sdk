// FM Core's page: just enough of a browser for kit.js, wa-shim.js and a machine to run without one.
// The native side (fmcore.cpp) gives `__fm` (clock, files, canvases, audio) and drives __fmTick / __fmDeliver /
// __fmPointer. Elements are plain objects (no layout: every box sits at 0,0 and is as large as its style says);
// a <canvas> draws through __fm.c(), immediately, into a native bitmap (plutovg).
(function () {
  'use strict';
  const G = globalThis;
  G.window = G; G.self = G;
  G.console = { log: (...a) => __fm.log(a.map(String).join(' ')), info: (...a) => __fm.log(a.map(String).join(' ')),
    warn: (...a) => __fm.log('warn: ' + a.map(String).join(' ')), error: (...a) => __fm.log('error: ' + a.map(String).join(' ')), debug() {} };

  // ── time: timers and frames, run by __fmTick ──
  // timeOrigin is the wall clock at start, as in a browser: every machine (each its own page) shares one epoch grid,
  // so Lock, tempo sync and the Conductor line them up
  G.performance = { now: () => __fm.now(), timeOrigin: Date.now() - __fm.now() };
  let tid = 1;
  const timers = new Map(), frames = new Map();
  G.setTimeout = (fn, ms, ...args) => { const id = tid++; timers.set(id, { fn, at: __fm.now() + (+ms || 0), args }); return id; };
  G.setInterval = (fn, ms, ...args) => { const id = tid++; timers.set(id, { fn, at: __fm.now() + Math.max(4, +ms || 0), every: Math.max(4, +ms || 0), args }); return id; };
  G.clearTimeout = G.clearInterval = (id) => { timers.delete(id); };
  G.requestAnimationFrame = (fn) => { const id = tid++; frames.set(id, fn); return id; };
  G.cancelAnimationFrame = (id) => { frames.delete(id); };
  G.queueMicrotask ??= (fn) => { Promise.resolve().then(fn); };
  const guard = (fn, ...a) => { try { fn(...a); } catch (e) { console.error(e && e.stack || e); } };
  G.__fmTick = () => {
    const now = __fm.now();
    for (const [id, t] of [...timers]) {
      if (t.at > now || !timers.has(id)) continue;
      if (t.every) t.at = Math.max(t.at + t.every, now); else timers.delete(id);
      guard(t.fn, ...t.args);
    }
    if (frames.size) { const fs = [...frames.values()]; frames.clear(); for (const f of fs) guard(f, now); }
  };

  // ── events ──
  class Event {
    constructor(type, o = {}) { Object.assign(this, o); this.type = type; this.defaultPrevented = false; this._stop = false; }
    preventDefault() { this.defaultPrevented = true; } stopPropagation() { this._stop = true; } stopImmediatePropagation() { this._stop = true; }
  }
  G.Event = Event; G.CustomEvent = class extends Event { constructor(t, o = {}) { super(t, o); this.detail = o.detail; } };
  G.MessageEvent = Event; G.KeyboardEvent = Event; G.PointerEvent = Event; G.MouseEvent = Event;
  const Target = (base) => class extends base {
    addEventListener(type, fn, o) { if (!fn) return; ((this._ls ??= {})[type] ??= []).push({ fn, once: !!(o && o.once) }); }
    removeEventListener(type, fn) { const l = this._ls && this._ls[type]; if (l) this._ls[type] = l.filter((x) => x.fn !== fn); }
    dispatchEvent(e) {
      e.target ??= this;
      for (let n = this; n && !e._stop; n = n.parentNode || (n === G.document ? G : null)) {
        e.currentTarget = n;
        const on = n['on' + e.type]; if (typeof on === 'function') guard(on.bind(n), e);
        const l = n._ls && n._ls[e.type]; if (!l) continue;
        for (const x of [...l]) { if (x.once) n.removeEventListener(e.type, x.fn); guard(typeof x.fn === 'function' ? x.fn.bind(n) : x.fn.handleEvent.bind(x.fn), e); }
        if (e.bubbles === false) break;
      }
      return !e.defaultPrevented;
    }
  };
  { const T = Target(Object); for (const k of ['addEventListener', 'removeEventListener', 'dispatchEvent']) G[k] = T.prototype[k].bind(G); }

  // ── elements ──
  const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const makeStyle = () => {
    const vars = {};
    return new Proxy({ setProperty(k, v) { vars[k] = String(v); this[camel(k)] = String(v); }, removeProperty(k) { delete vars[k]; delete this[camel(k)]; },
      getPropertyValue(k) { return vars[k] ?? this[camel(k)] ?? ''; } }, { set(t, k, v) { t[k] = v; return true; } });
  };
  const px = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
  class ClassList {
    constructor(el) { this.el = el; }
    get _s() { return new Set(String(this.el._cls || '').split(/\s+/).filter(Boolean)); }
    _w(s) { this.el._cls = [...s].join(' '); }
    add(...c) { const s = this._s; c.forEach((x) => s.add(x)); this._w(s); }
    remove(...c) { const s = this._s; c.forEach((x) => s.delete(x)); this._w(s); }
    toggle(c, f) { const s = this._s; const on = f === undefined ? !s.has(c) : !!f; on ? s.add(c) : s.delete(c); this._w(s); return on; }
    contains(c) { return this._s.has(c); }
    get length() { return this._s.size; }
  }
  // selectors: tag, #id, .class, [attr], :not(simple), descendant (space) and child (>) combinators, commas
  function matchSimple(el, s) {
    const not = []; s = s.replace(/:not\(([^)]*)\)/g, (_, x) => { not.push(x); return ''; }).replace(/:[a-z-]+(\([^)]*\))?/g, '');
    const tag = (s.match(/^[a-z0-9*]+/i) || [])[0];
    if (tag && tag !== '*' && el.tagName !== tag.toUpperCase()) return false;
    for (const id of s.match(/#[\w-]+/g) || []) if (el.id !== id.slice(1)) return false;
    for (const c of s.match(/\.[\w-]+/g) || []) if (!el.classList.contains(c.slice(1))) return false;
    for (const a of s.match(/\[[^\]]+\]/g) || []) { const [k, v] = a.slice(1, -1).split('='); if (!el.hasAttribute(k) || (v != null && el.getAttribute(k) !== v.replace(/["']/g, ''))) return false; }
    return !not.some((x) => matchSimple(el, x));
  }
  function matches(el, sel) {
    return sel.split(',').some((one) => {
      const parts = one.trim().split(/\s*(>)\s*|\s+/).filter((x) => x !== undefined && x !== '');
      let i = parts.length - 1, n = el;
      if (!matchSimple(n, parts[i])) return false;
      for (i--; i >= 0; i--) {
        if (parts[i] === '>') { i--; n = n.parentNode; if (!n || !n.tagName || !matchSimple(n, parts[i])) return false; continue; }
        do n = n.parentNode; while (n && n.tagName && !matchSimple(n, parts[i]));
        if (!n || !n.tagName) return false;
      }
      return true;
    });
  }
  const walk = function* (n) { for (const c of n.children) { yield c; yield* walk(c); } };
  class Node0 {}
  class Element extends Target(Node0) {
    constructor(tag) { super(); this.tagName = tag.toUpperCase(); this.nodeName = this.tagName; this.nodeType = 1; this.children = []; this.parentNode = null;
      this.style = makeStyle(); this.dataset = {}; this._attrs = {}; this._cls = ''; this.classList = new ClassList(this); this._text = ''; this.hidden = false; }
    get className() { return this._cls; } set className(v) { this._cls = String(v); }
    get id() { return this._attrs.id || ''; } set id(v) { this._attrs.id = String(v); }
    get childNodes() { return this.children; } get firstChild() { return this.children[0] || null; } get lastChild() { return this.children[this.children.length - 1] || null; }
    get firstElementChild() { return this.children[0] || null; } get lastElementChild() { return this.children[this.children.length - 1] || null; }
    get childElementCount() { return this.children.length; } get parentElement() { return this.parentNode && this.parentNode.tagName ? this.parentNode : null; }
    get nextElementSibling() { const p = this.parentNode; return p ? p.children[p.children.indexOf(this) + 1] || null : null; }
    get previousElementSibling() { const p = this.parentNode; return p ? p.children[p.children.indexOf(this) - 1] || null : null; }
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); } set textContent(v) { this.children.forEach((c) => (c.parentNode = null)); this.children = []; this._text = String(v ?? ''); }
    get innerText() { return this.textContent; } set innerText(v) { this.textContent = v; }
    get text() { return this.textContent; } set text(v) { this.textContent = v; }
    get innerHTML() { return this._text; } set innerHTML(v) { this.textContent = String(v).replace(/<[^>]*>/g, ''); }
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === G.document; }
    setAttribute(k, v) { if (k === 'class') this._cls = String(v); else this._attrs[k] = String(v); if (k.startsWith('data-')) this.dataset[camel(k.slice(5))] = String(v); }
    getAttribute(k) { return k === 'class' ? this._cls : this._attrs[k] ?? null; } hasAttribute(k) { return k === 'class' ? !!this._cls : k in this._attrs; }
    removeAttribute(k) { delete this._attrs[k]; } toggleAttribute(k, f) { const on = f ?? !this.hasAttribute(k); on ? this.setAttribute(k, '') : this.removeAttribute(k); return on; }
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
    append(...cs) { for (const c of cs) this.appendChild(typeof c === 'string' ? G.document.createTextNode(c) : c); }
    prepend(...cs) { for (const c of cs.reverse()) this.insertBefore(typeof c === 'string' ? G.document.createTextNode(c) : c, this.children[0] || null); }
    insertBefore(c, ref) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; const i = ref ? this.children.indexOf(ref) : -1; i < 0 ? this.children.push(c) : this.children.splice(i, 0, c); return c; }
    insertAdjacentElement(where, c) { if (where === 'beforeend') return this.appendChild(c); if (where === 'afterbegin') return this.insertBefore(c, this.children[0] || null); const p = this.parentNode; if (!p) return c; return where === 'beforebegin' ? p.insertBefore(c, this) : p.insertBefore(c, this.nextElementSibling); }
    insertAdjacentHTML() {} after(...cs) { const p = this.parentNode; if (p) for (const c of cs.reverse()) p.insertBefore(c, this.nextElementSibling); }
    before(...cs) { const p = this.parentNode; if (p) for (const c of cs) p.insertBefore(c, this); }
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
    replaceChild(n, o) { this.insertBefore(n, o); return this.removeChild(o); } replaceWith(n) { if (this.parentNode) this.parentNode.replaceChild(n, this); }
    replaceChildren(...cs) { this.textContent = ''; this.append(...cs); }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    contains(n) { for (; n; n = n.parentNode) if (n === this) return true; return false; }
    cloneNode(deep) { const c = G.document.createElement(this.tagName); c._cls = this._cls; c._attrs = { ...this._attrs }; c._text = this._text; if (deep) for (const k of this.children) c.appendChild(k.cloneNode(true)); return c; }
    matches(s) { return matches(this, s); } closest(s) { for (let n = this; n && n.tagName; n = n.parentNode) if (matches(n, s)) return n; return null; }
    querySelectorAll(s) { const out = []; for (const n of walk(this)) if (n.tagName && matches(n, s)) out.push(n); return out; }
    querySelector(s) { for (const n of walk(this)) if (n.tagName && matches(n, s)) return n; return null; }
    getElementsByClassName(c) { return this.querySelectorAll('.' + c); } getElementsByTagName(t) { return this.querySelectorAll(t); }
    getBoundingClientRect() { const w = this.offsetWidth, h = this.offsetHeight; return { x: 0, y: 0, left: 0, top: 0, width: w, height: h, right: w, bottom: h }; }
    getClientRects() { return [this.getBoundingClientRect()]; }
    get offsetWidth() { return px(this.style.width) || (this.width ? this.width / (this._dpr || 1) : 0) || 300; }
    get offsetHeight() { return px(this.style.height) || (this.height ? this.height / (this._dpr || 1) : 0) || 150; }
    get clientWidth() { return this.offsetWidth; } get clientHeight() { return this.offsetHeight; } get scrollWidth() { return this.offsetWidth; } get scrollHeight() { return this.offsetHeight; }
    get offsetLeft() { return 0; } get offsetTop() { return 0; } get offsetParent() { return this.parentElement; }
    focus() { G.document.activeElement = this; } blur() {} click() { this.dispatchEvent(new Event('click', { bubbles: true })); }
    scrollIntoView() {} scrollTo() {} animate() { return { finished: Promise.resolve(), cancel() {}, finish() {}, onfinish: null }; }
    setPointerCapture() {} releasePointerCapture() {} hasPointerCapture() { return false; }
    attachShadow() { return this; } getAnimations() { return []; }
  }
  // ── canvas: a native bitmap; the 2D context forwards every call (and state change) to __fm.c ──
  const OP = { save: 1, restore: 2, scale: 3, rotate: 4, translate: 5, transform: 6, setTransform: 7, resetTransform: 8,
    beginPath: 10, closePath: 11, moveTo: 12, lineTo: 13, bezierCurveTo: 14, quadraticCurveTo: 15, arc: 16, arcTo: 17, ellipse: 18, rect: 19, roundRect: 20,
    fill: 21, stroke: 22, clip: 23, withPath: 30, fillRect: 24, strokeRect: 25, clearRect: 26, fillText: 27, strokeText: 28, drawImage: 29,
    fillStyle: 40, strokeStyle: 41, lineWidth: 42, lineCap: 43, lineJoin: 44, miterLimit: 45, globalAlpha: 46, globalCompositeOperation: 47,
    font: 48, textAlign: 49, textBaseline: 50, lineDashOffset: 51, setLineDash: 52, imageSmoothingEnabled: 53 };
  const unsupported = new Set();
  const note = (what) => { if (!unsupported.has(what)) { unsupported.add(what); __fm.log('canvas: ' + what + ' is not drawn in FM Core yet'); } };
  class Gradient { constructor(kind, c) { this.kind = kind; this.c = c; this.stops = []; } addColorStop(o, col) { this.stops.push(+o, String(col)); } }
  // a pattern: another canvas, repeated (or not) under the fill
  class Pattern { constructor(cv, rep) { this.kind = 3; this.c = [cv._cid, rep === 'no-repeat' ? 0 : 1]; this.stops = []; } setTransform() {} }
  // Path2D: its path calls are kept and replayed natively for fill(path), stroke(path) and clip(path)
  class Path2D {
    constructor(p) { this.ops = p instanceof Path2D ? p.ops.slice() : []; if (typeof p === 'string') note('Path2D from SVG data'); }
    addPath(p) { if (p instanceof Path2D) this.ops.push(...p.ops); }
  }
  for (const k of ['closePath', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'arc', 'arcTo', 'ellipse', 'rect', 'roundRect'])
    Path2D.prototype[k] = function (...a) {
      if (k === 'arc') a[5] = a[5] ? 1 : 0;
      if (k === 'ellipse') a[7] = a[7] ? 1 : 0;
      if (k === 'roundRect') a = [a[0], a[1], a[2], a[3], Array.isArray(a[4]) ? +a[4][0] || 0 : +a[4] || 0];
      this.ops.push(OP[k], a.length, ...a.map(Number));
    };
  G.Path2D = Path2D;
  class Ctx2D {
    constructor(cv) { this.canvas = cv; this._s = { fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, globalAlpha: 1,
      globalCompositeOperation: 'source-over', font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', lineDashOffset: 0, imageSmoothingEnabled: true,
      shadowBlur: 0, shadowColor: 'rgba(0,0,0,0)', shadowOffsetX: 0, shadowOffsetY: 0, filter: 'none', direction: 'ltr', letterSpacing: '0px' }; this._stack = []; this._dash = []; }
    get _id() { return this.canvas._cid; }
    save() { this._stack.push({ ...this._s, dash: this._dash }); __fm.c(this._id, OP.save); }
    restore() { const s = this._stack.pop(); if (!s) return; this._dash = s.dash; delete s.dash; this._s = s; __fm.c(this._id, OP.restore); }
    getLineDash() { return this._dash.slice(); }
    setLineDash(a) { this._dash = (a || []).map(Number).filter((x) => isFinite(x) && x >= 0); __fm.c(this._id, OP.setLineDash, this._dash.length % 2 ? this._dash.concat(this._dash) : this._dash); }
    createLinearGradient(x0, y0, x1, y1) { return new Gradient(0, [x0, y0, x1, y1]); }
    createRadialGradient(x0, y0, r0, x1, y1, r1) { return new Gradient(1, [x0, y0, r0, x1, y1, r1]); }
    createConicGradient(a, x, y) { note('conic gradients'); return new Gradient(2, [a, x, y]); }
    createPattern(img, rep) { if (!img || img._cid == null) { note('patterns of anything but a canvas'); return null; } return new Pattern(img, rep); }
    measureText(t) { const w = __fm.measure(this._id, String(t)); return { width: w, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0, actualBoundingBoxLeft: 0, actualBoundingBoxRight: w }; }
    isPointInPath() { return false; } isPointInStroke() { return false; }
    createImageData(w, h) { if (typeof w === 'object') { h = w.height; w = w.width; } w = Math.max(1, w | 0); h = Math.max(1, h | 0); return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: 'srgb' }; }
    getImageData(x, y, w, h) { const d = this.createImageData(w, h); __fm.getImageData(this._id, x | 0, y | 0, d.width, d.height, d.data.buffer); return d; }
    putImageData(d, x, y) { __fm.putImageData(this._id, d.data.buffer, d.width, d.height, x | 0, y | 0); }
    drawImage(img, ...a) {
      if (!img || img._cid == null) { note('drawImage of anything but a canvas'); return; }
      const W = img.width, H = img.height;
      if (a.length === 2) a = [0, 0, W, H, a[0], a[1], W, H];
      else if (a.length === 4) a = [0, 0, W, H, a[0], a[1], a[2], a[3]];
      __fm.c(this._id, OP.drawImage, img._cid, ...a);
    }
  }
  for (const k of ['scale', 'rotate', 'translate', 'transform', 'setTransform', 'resetTransform', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'bezierCurveTo',
    'quadraticCurveTo', 'arcTo', 'rect', 'fillRect', 'strokeRect', 'clearRect']) {
    const op = OP[k];
    Ctx2D.prototype[k] = function (...a) { if (k === 'setTransform' && a.length === 1 && a[0]) { const m = a[0]; a = [m.a, m.b, m.c, m.d, m.e, m.f]; } __fm.c(this._id, op, ...a); };
  }
  Ctx2D.prototype.arc = function (x, y, r, a0, a1, ccw) { __fm.c(this._id, OP.arc, x, y, Math.max(0, r), a0, a1, ccw ? 1 : 0); };
  Ctx2D.prototype.ellipse = function (x, y, rx, ry, rot, a0, a1, ccw) { __fm.c(this._id, OP.ellipse, x, y, Math.max(0, rx), Math.max(0, ry), rot, a0, a1, ccw ? 1 : 0); };
  Ctx2D.prototype.roundRect = function (x, y, w, h, r) { const rr = Array.isArray(r) ? +r[0] || 0 : typeof r === 'object' && r ? +r.x || 0 : +r || 0; __fm.c(this._id, OP.roundRect, x, y, w, h, rr); };
  Ctx2D.prototype.fill = function (a, b) {
    if (a instanceof Path2D) { __fm.c(this._id, OP.withPath, 0, b === 'evenodd' ? 1 : 0, a.ops); return; }
    __fm.c(this._id, OP.fill, a === 'evenodd' ? 1 : 0);
  };
  Ctx2D.prototype.stroke = function (p) { if (p instanceof Path2D) __fm.c(this._id, OP.withPath, 1, 0, p.ops); else __fm.c(this._id, OP.stroke); };
  Ctx2D.prototype.clip = function (a, b) {
    if (a instanceof Path2D) { __fm.c(this._id, OP.withPath, 2, b === 'evenodd' ? 1 : 0, a.ops); return; }
    __fm.c(this._id, OP.clip, a === 'evenodd' ? 1 : 0);
  };
  Ctx2D.prototype.fillText = function (t, x, y) { __fm.c(this._id, OP.fillText, String(t), x, y); };
  Ctx2D.prototype.strokeText = function (t, x, y) { __fm.c(this._id, OP.strokeText, String(t), x, y); };
  Ctx2D.prototype.getTransform = function () { const m = __fm.getTransform(this._id); return { a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] }; };
  for (const k of Object.keys(new Ctx2D({})._s)) {
    Object.defineProperty(Ctx2D.prototype, k, {
      get() { return this._s[k]; },
      set(v) {
        if (v === this._s[k] && typeof v !== 'object') return;
        if ((k === 'fillStyle' || k === 'strokeStyle') && (v instanceof Gradient || v instanceof Pattern)) { this._s[k] = v; __fm.c(this._id, OP[k], v.kind, v.c, v.stops); return; }
        if ((k === 'fillStyle' || k === 'strokeStyle') && (v == null || typeof v === 'object')) return; // (a pattern: keep the last style)
        if (k === 'shadowBlur' && v > 0) note('shadows');
        if (k === 'filter' && v !== 'none') note('filter');
        if (k === 'globalCompositeOperation' && !/^(source-over|copy|destination-in|destination-out|source-atop|source-in|destination-over|xor)$/.test(v)) note('blend mode ' + v);
        this._s[k] = typeof this._s[k] === 'number' ? +v : typeof this._s[k] === 'boolean' ? !!v : String(v);
        if (OP[k]) __fm.c(this._id, OP[k], this._s[k]);
      },
    });
  }
  class Canvas extends Element {
    constructor() { super('canvas'); this._w = 300; this._h = 150; this._cid = __fm.canvas(300, 150); this._ctx = null; }
    get width() { return this._w; } set width(v) { this._w = Math.max(1, v | 0); this._resize(); }
    get height() { return this._h; } set height(v) { this._h = Math.max(1, v | 0); this._resize(); }
    _resize() { __fm.resize(this._cid, this._w, this._h); if (this._ctx) { this._ctx._stack = []; this._ctx._dash = []; const s = this._ctx._s; this._ctx._s = new Ctx2D({})._s; Object.assign(this._ctx._s, { font: s.font }); } }
    get offsetWidth() { return px(this.style.width) || this._w; } get offsetHeight() { return px(this.style.height) || (px(this.style.width) ? (px(this.style.width) * this._h) / this._w : this._h); }
    getContext(kind) { if (kind !== '2d') return null; return (this._ctx ??= new Ctx2D(this)); }
    toDataURL() { return 'data:,'; } toBlob(cb) { cb && cb(null); } captureStream() { return null; }
  }
  // a <select>: its options are its <option> children; value and selectedIndex follow each other
  class Select extends Element {
    constructor() { super('select'); this._value = ''; }
    get options() { return this.children.filter((c) => c.tagName === 'OPTION'); }
    get value() { return this._value; } set value(v) { this._value = String(v); }
    get selectedIndex() { return this.options.findIndex((o) => String(o.value) === this._value); }
    set selectedIndex(i) { const o = this.options[i]; if (o) this._value = String(o.value); }
    get selectedOptions() { const i = this.selectedIndex; return i >= 0 ? [this.options[i]] : []; }
  }
  class Text0 { constructor(t) { this.nodeType = 3; this._t = String(t); this.parentNode = null; this.children = []; } get textContent() { return this._t; } set textContent(v) { this._t = String(v); } remove() { if (this.parentNode) this.parentNode.removeChild(this); } cloneNode() { return new Text0(this._t); } }
  const create = (tag) => { const t = String(tag).toLowerCase(); return t === 'canvas' ? new Canvas() : t === 'select' ? new Select() : new Element(t); };
  const html = new Element('html'), head = new Element('head'), body = new Element('body'), root = new Element('div');
  root.id = 'root'; html.appendChild(head); html.appendChild(body); body.appendChild(root);
  const doc = new (Target(Object))();
  Object.assign(doc, { nodeType: 9, documentElement: html, head, body, readyState: 'complete', visibilityState: 'visible', hidden: false, activeElement: null, cookie: '',
    createElement: create, createElementNS: (ns, tag) => create(tag), createTextNode: (t) => new Text0(t), createDocumentFragment: () => new Element('fragment'),
    getElementById: (id) => html.querySelector('#' + id), querySelector: (s) => html.querySelector(s), querySelectorAll: (s) => html.querySelectorAll(s),
    getElementsByClassName: (c) => html.querySelectorAll('.' + c), elementFromPoint: () => null, hasFocus: () => true, fonts: { ready: Promise.resolve(), load: () => Promise.resolve([]) } });
  html.parentNode = doc; doc.children = [html];
  G.document = doc;
  G.HTMLElement = Element; G.Element = Element; G.HTMLCanvasElement = Canvas; G.Node = Node0; G.SVGElement = Element;
  G.devicePixelRatio = __fm.dpr || 1;
  G.location = { search: '', hash: '', href: 'fmcore://machine', pathname: '/', origin: 'fmcore://', protocol: 'fmcore:', host: '', hostname: '' };
  G.navigator = { userAgent: 'FMCore', platform: 'FMCore', language: 'en', languages: ['en'], maxTouchPoints: 0, hardwareConcurrency: 4 };
  G.URLSearchParams ??= class {
    constructor(q = '') { this.m = new Map(String(q).replace(/^\?/, '').split('&').filter(Boolean).map((kv) => { const [k, v = ''] = kv.split('='); return [decodeURIComponent(k), decodeURIComponent(v.replace(/\+/g, ' '))]; })); }
    get(k) { return this.m.has(k) ? this.m.get(k) : null; } has(k) { return this.m.has(k); } set(k, v) { this.m.set(k, String(v)); }
    toString() { return [...this.m].map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&'); }
  };
  G.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  G.getComputedStyle = (el) => el.style;
  G.ResizeObserver = class { constructor(fn) { this.fn = fn; } observe() {} unobserve() {} disconnect() {} };
  G.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  // everything is on screen: an observed element is reported visible once, right away
  G.IntersectionObserver = class { constructor(fn) { this.fn = fn; } observe(el) { const fn = this.fn; queueMicrotask(() => guard(fn, [{ target: el, isIntersecting: true, intersectionRatio: 1 }], this)); } unobserve() {} disconnect() {} };
  G.Image = class extends Element { constructor() { super('img'); } };
  G.btoa ??= (s) => __fm.btoa(String(s)); G.atob ??= (s) => __fm.atob(String(s));
  G.TextEncoder ??= class { encode(s) { return new Uint8Array(__fm.utf8(String(s))); } };
  // storage kept for the page's life only (the host keeps what matters: state, seat id)
  { const mem = new Map(); G.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), clear: () => mem.clear() }; }
  // ── asking the host (Godot) for what a page cannot do here: a fetch, the mic, a socket. JSON out, answers come back
  // through __fmReply(id, value) or, with bytes, __fmBytes(id, meta, buffer) ──
  let ask = 1;
  const asks = new Map();
  G.__fmAsk = (msg) => new Promise((ok, no) => { const id = ask++; asks.set(id, { ok, no }); __fm.app(JSON.stringify({ ...msg, id })); });
  G.__fmReply = (id, v) => { const p = asks.get(id); if (!p) return; asks.delete(id); if (v && v.error) p.no(new Error(v.error)); else p.ok(v); };
  G.fetch = (url, o = {}) => G.__fmAsk({ type: 'fetch', url: String(url && url.url || url), method: String(o.method || 'GET').toUpperCase(),
    ...(o.body != null ? { body: String(o.body) } : {}) }).then((r) => ({
    ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => JSON.parse(r.body), text: async () => r.body }));
  // a WebSocket over the host's sockets (the Conductor's client)
  const sockets = new Map();
  let sock = 1;
  G.WebSocket = class {
    constructor(url) { this.url = String(url); this.readyState = 0; this._id = sock++; sockets.set(this._id, this); __fm.app(JSON.stringify({ type: 'ws-open', ws: this._id, url: this.url })); }
    send(t) { if (this.readyState === 1) __fm.app(JSON.stringify({ type: 'ws-send', ws: this._id, data: String(t) })); }
    close() { if (this.readyState > 1) return; this.readyState = 2; __fm.app(JSON.stringify({ type: 'ws-close', ws: this._id })); }
  };
  G.WebSocket.OPEN = 1;
  G.__fmWs = (id, what, data) => {
    const w = sockets.get(id); if (!w) return;
    if (what === 'open') { w.readyState = 1; guard(() => w.onopen && w.onopen({})); }
    else if (what === 'message') guard(() => w.onmessage && w.onmessage({ data }));
    else { w.readyState = 3; sockets.delete(id); guard(() => w.onclose && w.onclose({})); }
  };
  // WebRTC over the host's (Godot's WebRTCPeerConnection, the webrtc-native plugin): enough of RTCPeerConnection for the
  // Conductor's client to join a web Conductor by its room code. One data channel, created before the offer; no trickle:
  // the host gathers every candidate, writes them into the description, and then says the gathering is complete.
  const peers = new Map();
  let peer = 1;
  G.RTCPeerConnection = class {
    constructor(cfg = {}) {
      this._id = peer++; peers.set(this._id, this);
      this.connectionState = 'new'; this.iceGatheringState = 'new'; this.localDescription = null; this.remoteDescription = null; this._dc = null;
      __fm.app(JSON.stringify({ type: 'rtc-new', pc: this._id, ice: (cfg.iceServers || []).map((s) => ({ urls: [].concat(s.urls || []) })) }));
    }
    createDataChannel(label) {
      const pc = this._id;
      const dc = (this._dc = { label: String(label), readyState: 'connecting', onopen: null, onmessage: null, onclose: null,
        send: (t) => { if (dc.readyState === 'open') __fm.app(JSON.stringify({ type: 'rtc-send', pc, data: String(t) })); },
        close: () => this.close() });
      __fm.app(JSON.stringify({ type: 'rtc-dc', pc, label: dc.label }));
      return dc;
    }
    createOffer() { return G.__fmAsk({ type: 'rtc-offer', pc: this._id }); }
    setLocalDescription(d) {
      this.localDescription = { type: d.type, sdp: d.sdp }; this.iceGatheringState = 'gathering';
      return G.__fmAsk({ type: 'rtc-local', pc: this._id, kind: d.type, sdp: d.sdp }).then(() => undefined);
    }
    setRemoteDescription(d) {
      this.remoteDescription = { type: d.type, sdp: d.sdp };
      return G.__fmAsk({ type: 'rtc-remote', pc: this._id, kind: d.type, sdp: d.sdp }).then(() => undefined);
    }
    close() {
      if (this.connectionState === 'closed') return;
      __fm.app(JSON.stringify({ type: 'rtc-close', pc: this._id }));
      G.__fmRtc(this._id, 'state', 'closed');
    }
  };
  G.__fmRtc = (id, what, data) => {
    const p = peers.get(id); if (!p) return;
    const dc = p._dc;
    if (what === 'gathered') { p.localDescription = { type: p.localDescription ? p.localDescription.type : 'offer', sdp: data }; p.iceGatheringState = 'complete'; guard(() => p.onicegatheringstatechange && p.onicegatheringstatechange({})); }
    else if (what === 'state') {
      if (p.connectionState === data) return;
      p.connectionState = data;
      guard(() => p.onconnectionstatechange && p.onconnectionstatechange({}));
      if (data === 'closed' || data === 'failed') { peers.delete(id); if (dc && dc.readyState !== 'closed') { dc.readyState = 'closed'; guard(() => dc.onclose && dc.onclose({})); } }
    }
    else if (what === 'open' && dc) { dc.readyState = 'open'; guard(() => dc.onopen && dc.onopen({})); }
    else if (what === 'message' && dc) guard(() => dc.onmessage && dc.onmessage({ data }));
    else if (what === 'close' && dc && dc.readyState !== 'closed') { dc.readyState = 'closed'; guard(() => dc.onclose && dc.onclose({})); }
  };
  // QuickJS has no Intl. The catalog only asks for wall-clock parts in the birth time zone (Europe/Stockholm):
  // central European time, with summer time from the last Sunday of March to the last Sunday of October (01:00 UTC).
  G.Intl ??= {
    DateTimeFormat: class {
      constructor(_, o = {}) { this.tz = o.timeZone || 'UTC'; }
      formatToParts(d) {
        const ms = +d, y = new Date(ms).getUTCFullYear();
        const lastSun = (m) => { const t = Date.UTC(y, m + 1, 0, 1); return t - new Date(t).getUTCDay() * 864e5; };
        const off = /^Europe\/(Stockholm|Berlin|Paris|Madrid|Rome|Oslo|Copenhagen|Amsterdam|Vienna|Brussels)$/.test(this.tz)
          ? (ms >= lastSun(2) && ms < lastSun(9) ? 2 : 1) * 36e5 : 0;
        const w = new Date(ms + off);
        return [['year', w.getUTCFullYear()], ['month', w.getUTCMonth() + 1], ['day', w.getUTCDate()], ['hour', w.getUTCHours()], ['minute', w.getUTCMinutes()], ['second', w.getUTCSeconds()]]
          .map(([type, value]) => ({ type, value: String(value) }));
      }
      format(d) { return new Date(+d).toISOString(); }
      resolvedOptions() { return { timeZone: this.tz, locale: 'en-US' }; }
    },
    NumberFormat: class { format(n) { return String(n); } },
  };

  // ── the frame's parent: what the kit and wa-shim post up goes to the host ──
  G.parent = G.top = {
    postMessage(msg) {
      if (msg && msg.fmwa) { __fm.audio(msg.fmwa); return; }
      if (msg && msg.fm === 'controls' && Array.isArray(msg.native)) { G.__fmControls = msg.native; return; }
      if (msg && msg.fm === 'state' && msg.values) { Object.assign(G.__fmState, msg.values); return; }
      // a voice to sample: the newest public-domain clip, or the next one (as the site's capture stage chooses)
      if (msg && msg.fm === 'want-sample') { setTimeout(() => sendClip(!!msg.next), 0); return; }
      // compressed audio for wa-shim.js: decoded here, natively
      if (msg && msg.fmDecode) { const r = __fm.decode(msg.data); setTimeout(() => G.__fmDeliver({ fmDecoded: r ? { id: msg.fmDecode, ...r } : { id: msg.fmDecode } }), 0); return; }
      // the world outside (sun, moon, the weather where the player is): world.js, through the host's fetch
      if (msg && msg.fm === 'want-world' && G.FMWorld) { FMWorld.get().then((data) => G.__fmDeliver({ fm: 'world', data })).catch(() => {}); return; }
      // the mic: the host records, and its recording arrives as a sample (__fmMic)
      if (msg && msg.fm === 'mic') { __fm.app(JSON.stringify({ type: 'mic', seconds: msg.seconds })); return; }
      // the machine's drum pads (or its sample's slices): the host's keyboard panel shows them
      if (msg && msg.fm === 'pads' && Array.isArray(msg.list)) { __fm.app(JSON.stringify({ type: 'pads', list: msg.list })); return; }
      if (msg && msg.fm === 'error') console.error('machine: ' + (msg.message || msg.msg || JSON.stringify(msg)));
    },
  };
  // the host's messages come back as window 'message' events from the parent (wa-shim's fmwaIn: the engine's clock)
  G.__fmDeliver = (data) => { G.dispatchEvent(new Event('message', { data, source: G.parent, origin: 'fmcore://', bubbles: false })); };
  // a pointer on a screen, in its own CSS pixels: screen 0 is the machine's own, 1 an inserted effect's own (the Mixer)
  G.__fmPointer = (type, x, y, buttons, screen) => {
    const cv = screen ? G.__fmScreenEl2() : G.__fmScreenEl(); if (!cv) return;
    cv.dispatchEvent(new Event(type, { bubbles: true, clientX: x, clientY: y, offsetX: x, offsetY: y, pageX: x, pageY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true,
      button: 0, buttons, pressure: buttons ? 0.5 : 0, target: cv }));
    if (type === 'pointerup') cv.dispatchEvent(new Event('click', { bubbles: true, clientX: x, clientY: y, offsetX: x, offsetY: y, button: 0, target: cv }));
  };
  G.__fmControls = []; G.__fmState = {};
  let clip = -1;
  function sendClip(next) {
    let clips = [];
    try { clips = JSON.parse(__fm.read('public/samples/speech/index.json')).clips || []; } catch (_) {}
    if (!clips.length) { G.__fmDeliver({ fm: 'sample', meta: { kind: 'archive', error: 'no voices here' } }); return; }
    clip = next && clip >= 0 ? (clip + clips.length - 1) % clips.length : clips.length - 1;
    const c = clips[clip], data = __fm.readBytes('public/samples/speech/' + c.file);
    G.__fmDeliver(data ? { fm: 'sample', data, meta: { ...c, kind: 'archive' } } : { fm: 'sample', meta: { kind: 'archive', error: 'no voice' } });
  }
  G.__fmMic = (id, meta, data) => { G.__fmDeliver(data && data.byteLength ? { fm: 'sample', data, meta } : { fm: 'sample', meta: { kind: 'mic', error: (meta && meta.error) || 'no mic here' } }); };
  G.__fmScreenEl = () => html.querySelector('.screen canvas') || html.querySelector('canvas');
  // an inserted effect's own screen (kit.js's _insertEffect puts it right after the machine's own, in DOM order)
  G.__fmScreenEl2 = () => html.querySelectorAll('.screen canvas')[1] || null;
  G.__fmScreen = () => { const cv = G.__fmScreenEl(); return cv ? [cv._cid, cv.offsetWidth, cv.offsetHeight] : null; };
  G.__fmScreen2 = () => { const cv = G.__fmScreenEl2(); return cv ? [cv._cid, cv.offsetWidth, cv.offsetHeight] : null; };
})();
