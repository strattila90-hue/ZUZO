/* Zúzó – PWA zúzós játék (Matter.js). Új tárgy: add hozzá a CATS-hoz. Új zóna: lásd build(), stepTools(), hurt(). */
'use strict';

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// ---------- TÁRGYKATALÓGUS (méretek 800 px széles referencia-képernyőre) ----------
// shape 'c' = kör (r), egyébként téglalap (w,h); d = sűrűség; hp = erősség; v = érték (Ft)
const CATS = {
  'Pénzérmék': [
    { n: '1 Ft', e: '🪙', shape: 'c', r: 7, d: .008, hp: 15, v: 1, c: '#b8b8b8' },
    { n: '100 Ft', e: '🪙', shape: 'c', r: 10, d: .008, hp: 25, v: 100, c: '#c9a227' },
    { n: 'Aranyérme', e: '🏅', shape: 'c', r: 13, d: .02, hp: 90, v: 5000, c: '#ffd700' }],
  'Elektronika': [
    { n: 'Telefon', e: '📱', w: 18, h: 34, d: .003, hp: 60, v: 600, c: '#4a5568' },
    { n: 'Laptop', e: '💻', w: 52, h: 32, d: .003, hp: 140, v: 1500, c: '#718096' },
    { n: 'TV', e: '📺', w: 90, h: 58, d: .002, hp: 200, v: 3000, c: '#2d3748' }],
  'Élelmiszer': [
    { n: 'Alma', e: '🍎', shape: 'c', r: 12, d: .001, hp: 20, v: 10, c: '#c53030' },
    { n: 'Dinnye', e: '🍉', shape: 'c', r: 26, d: .001, hp: 60, v: 40, c: '#2f855a' },
    { n: 'Kenyér', e: '🍞', w: 46, h: 22, d: .001, hp: 15, v: 25, c: '#b7791f' }],
  'Bútorok': [
    { n: 'Szék', e: '🪑', w: 34, h: 50, d: .0015, hp: 100, v: 300, c: '#8b5a2b' },
    { n: 'Asztal', e: '🪵', w: 100, h: 50, d: .0015, hp: 220, v: 600, c: '#a0713a' },
    { n: 'Kanapé', e: '🛋️', w: 120, h: 50, d: .002, hp: 300, v: 1500, c: '#6b46c1' }],
  'Járművek': [
    { n: 'Bicikli', e: '🚲', w: 80, h: 44, d: .0008, hp: 250, v: 800, c: '#2b6cb0' },
    { n: 'Autó', e: '🚗', w: 150, h: 50, d: .006, hp: 2500, v: 20000, c: '#e53e3e' },
    { n: 'Teherautó', e: '🚚', w: 210, h: 72, d: .006, hp: 6000, v: 60000, c: '#dd6b20' }],
  'Egyéb': [
    { n: 'Tégla', e: '🧱', w: 40, h: 20, d: .004, hp: 150, v: 15, c: '#c05621' },
    { n: 'Üveg', e: '🍾', w: 14, h: 40, d: .002, hp: 10, v: 8, c: '#38a169' },
    { n: 'Szikla', e: '🪨', shape: 'c', r: 30, d: .004, hp: 800, v: 50, c: '#718096' },
    { n: 'Repülőgép', e: '✈️', w: 280, h: 60, d: .003, hp: 15000, v: 500000, c: '#a0aec0' }]
};
// Zóna szorzók a kifizetéshez
const MULT = { press: 1, grind: 1, melt: 2.5, impact: 0.5 };

function start() {
  const { Engine, Composite, Bodies, Body, Constraint, Events, Query, Vector } = Matter;
  const $ = id => document.getElementById(id);
  const cv = $('cv'), ctx = cv.getContext('2d'), wrap = $('wrap');
  const rnd = (a, b) => a + Math.random() * (b - a);
  const fmt = n => Math.floor(n).toLocaleString('hu-HU') + ' Ft';

  // ---------- MENTÉS ----------
  const SAVE = 'zuzo_save_v1';
  let st = { money: 0, press: 1, sfx: true };
  try { Object.assign(st, JSON.parse(localStorage.getItem(SAVE) || '{}')); } catch (e) {}
  let saveT = 0;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(SAVE, JSON.stringify(st)); } catch (e) {} }, 400); };

  // ---------- GAZDASÁG ----------
  const pressDps = () => 45 * Math.pow(1.3, st.press - 1);
  const pressCost = () => Math.round(200 * Math.pow(1.6, st.press - 1));
  function ui() {
    $('money').textContent = fmt(st.money);
    const b = $('btnUp'), c = pressCost();
    b.textContent = `⬆ Prés fejlesztése · Szint ${st.press} → ${st.press + 1} · ${fmt(c)}`;
    b.classList.toggle('off', st.money < c);
  }
  $('btnUp').onclick = () => {
    const c = pressCost();
    if (st.money < c) return toast('Nincs elég pénz');
    st.money -= c; st.press++; save(); ui(); beep(660, .12, 'triangle');
  };

  // ---------- FIZIKA ----------
  const engine = Engine.create({ positionIterations: 8, velocityIterations: 6 });
  const world = engine.world;
  let W = 0, H = 0, S = 1, dpr = 1;
  let L = {}, statics = [], plate = null, rotors = [];
  const items = [], dead = [], sparks = [], pops = [];
  const antiGrav = b => { b.force.y -= b.mass * engine.gravity.y * engine.gravity.scale; };

  function build() {
    statics.forEach(b => Composite.remove(world, b)); statics = []; rotors = [];
    const fh = Math.max(14, 18 * S);
    L = { fh, floorTop: H - fh, zw: W / 3, shelfY: H * .30 };
    const add = (b, col, hide) => { b.col = col; b.hide = hide; statics.push(b); Composite.add(world, b); return b; };
    add(Bodies.rectangle(W / 2, H - fh / 2, W + 400, fh, { isStatic: true }), '#3a3f4a');
    add(Bodies.rectangle(-100, H / 2, 200, H * 3, { isStatic: true }), '', true);
    add(Bodies.rectangle(W + 100, H / 2, 200, H * 3, { isStatic: true }), '', true);
    for (let i = 1; i <= 2; i++) add(Bodies.rectangle(L.zw * i, L.floorTop - H * .08, 8, H * .16, { isStatic: true }), '#59606e');
    add(Bodies.rectangle(W / 2, L.shelfY, W * .3, 10, { isStatic: true }), '#8a6d3b'); // kezdőpolc

    // 1) Hidraulikus prés: nehéz, függőlegesen mozgó lemez
    const ph = Math.max(16, 22 * S);
    plate = Bodies.rectangle(L.zw / 2, H * .2, L.zw - 26, ph, { density: 5, friction: .9, frictionAir: 0 });
    Body.setInertia(plate, Infinity);
    plate.zk = 'press'; plate.restY = H * .2; plate.botY = L.floorTop - ph / 2 - 8 * S; plate.pp = { ph: 'wait', t: .4 };
    statics.push(plate); Composite.add(world, plate);

    // 2) Daráló: két ellentétesen forgó, háromkarú rotor
    const r = L.zw * .23;
    [[.27, 1], [.73, -1]].forEach(([fx, dir]) => {
      const cx = L.zw + L.zw * fx, cy = L.floorTop - r - 6;
      const bars = [0, 1, 2].map(i => Bodies.rectangle(cx, cy, 2 * r, Math.max(8, 9 * S), { angle: i * Math.PI / 3, density: 3 }));
      const rot = Body.create({ parts: bars, friction: .8, frictionAir: 0 });
      rot.zk = 'blade'; rot.dir = dir; rot.home = { x: cx, y: cy }; rot.r = r;
      statics.push(rot); rotors.push(rot); Composite.add(world, rot);
    });
  }

  // Mozgó szerkezetek léptetése (fizikai lépés előtt)
  function stepTools() {
    const p = plate, s = p.pp, v = Math.min(16 * S, (3 + .45 * st.press) * S), y = p.position.y;
    let vy = 0;
    if (s.ph === 'wait') { s.t -= 1 / 60; if (s.t <= 0) s.ph = 'down'; }
    else if (s.ph === 'down') { vy = v; if (y + vy >= p.botY) { vy = p.botY - y; s.ph = 'hold'; s.t = .35; } }
    else if (s.ph === 'hold') { s.t -= 1 / 60; if (s.t <= 0) s.ph = 'up'; }
    else { vy = -v * .7; if (y + vy <= p.restY) { vy = p.restY - y; s.ph = 'wait'; s.t = .5; } }
    Body.setVelocity(p, { x: 0, y: vy }); Body.setAngle(p, 0); Body.setAngularVelocity(p, 0);
    Body.setPosition(p, { x: L.zw / 2, y: p.position.y }); antiGrav(p);
    rotors.forEach(r => { Body.setPosition(r, r.home); Body.setVelocity(r, { x: 0, y: 0 }); Body.setAngularVelocity(r, r.dir * .11); antiGrav(r); });
  }

  // ---------- TÁRGYAK ----------
  function tag(b, o) {
    Object.assign(b, { item: true, alive: true, hp: o.hp, maxHp: o.hp, value: o.v, gen: o.gen || 0, col: o.c, emoji: o.e || '', dw: o.dw, dh: o.dh, area: o.area, sy: 1, dens: o.d });
    items.push(b); Composite.add(world, b);
    return b;
  }
  function spawn(def) {
    const dim = def.shape === 'c' ? def.r * 2 : Math.max(def.w, def.h);
    const hh = def.shape === 'c' ? def.r * 2 : def.h;
    const k = Math.min(S, W * .3 / dim, H * .22 / hh);
    const x = W / 2 + rnd(-W * .03, W * .03);
    const opts = { density: def.d, friction: .5, restitution: .15, collisionFilter: { category: 2 } };
    let b, dw, dh;
    if (def.shape === 'c') { dw = dh = def.r * 2 * k; b = Bodies.circle(x, L.shelfY - 8 - dh, def.r * k, opts, 24); }
    else { dw = def.w * k; dh = def.h * k; b = Bodies.rectangle(x, L.shelfY - 8 - dh / 2 - 4, dw, dh, Object.assign(opts, { chamfer: { radius: Math.min(dw, dh) * .12 } })); }
    tag(b, { hp: def.hp, v: def.v, c: def.c, e: def.e, d: def.d, dw, dh, area: def.shape === 'c' ? Math.PI * (dw / 2) ** 2 : dw * dh });
    trimBodies();
  }
  function trimBodies() { // túl sok darab esetén a legrégebbi töredék eltűnik (kifizetéssel)
    while (items.length > 140) { const f = items.find(i => i.gen > 0) || items[0]; kill(f, 'melt', true); }
  }
  function fragments(it) {
    if (it.gen >= 2) return;
    const size = Math.sqrt(it.area);
    if (size < 14 * S) return;
    const n = it.gen === 0 ? Math.max(3, Math.min(7, Math.round(size / (22 * S)))) : 3;
    const fs = Math.sqrt(it.area / n) * .85;
    for (let i = 0; i < n; i++) {
      const w = fs * rnd(.7, 1.3), h = fs * rnd(.7, 1.3);
      const b = Bodies.rectangle(it.position.x + rnd(-.25, .25) * size, it.position.y + rnd(-.25, .25) * size, w, h,
        { angle: rnd(0, 6.28), density: it.dens, friction: .6, restitution: .2, collisionFilter: { category: 2 } });
      tag(b, { hp: Math.max(8, it.maxHp / n * .4), v: it.value * .3 / n, c: it.col, gen: it.gen + 1, d: it.dens, dw: w, dh: h, area: w * h });
      Body.setVelocity(b, { x: rnd(-6, 6), y: -rnd(0, 6) });
    }
  }
  function kill(it, kind, silent) {
    if (!it.alive) return;
    it.alive = false;
    Composite.remove(world, it); items.splice(items.indexOf(it), 1);
    if (drag && drag.b === it) endDrag();
    const pay = it.value * MULT[kind];
    if (pay >= 1) { st.money += pay; save(); ui(); if (!silent) pops.push({ x: it.position.x, y: it.position.y, t: 1, txt: '+' + Math.floor(pay).toLocaleString('hu-HU'), c: kind === 'melt' ? '#ffb347' : '#ffe27a' }); }
    if (silent) return;
    burst(it.position.x, it.position.y, Math.min(24, 8 + Math.sqrt(it.area) / 6 | 0), kind === 'melt' ? '#ff7a2a' : '#ffd24d');
    if (kind !== 'melt') fragments(it);
    beep(kind === 'melt' ? 300 : 180 + Math.random() * 80, .12, kind === 'melt' ? 'sine' : 'sawtooth');
  }
  function hurt(it, d, kind) {
    if (!it.alive || it.hp <= 0) return;
    it.hp -= d;
    if (kind === 'press') { // összenyomódás (vizuális + fizikai)
      const t = Math.max(.45, .5 + .5 * Math.max(0, it.hp) / it.maxHp);
      if (it.sy - t > .03) { Body.scale(it, 1, t / it.sy); it.sy = t; }
    }
    if ((kind === 'press' || kind === 'grind') && Math.random() < .25) burst(it.position.x, it.position.y, 2, '#ffd24d');
    if (it.hp <= 0) dead.push([it, kind]);
  }

  // ---------- ÜTKÖZÉSEK ----------
  function pairs(list, start) {
    for (const pr of list) {
      const A = pr.bodyA.parent, B = pr.bodyB.parent;
      if (A.item && B.item) { // tárgy–tárgy ütközés
        if (start) { const rel = Vector.magnitude(Vector.sub(A.velocity, B.velocity)); if (rel > 10) { const d = (rel - 10) * Math.min(A.mass, B.mass) * 1.2; hurt(A, d, 'impact'); hurt(B, d, 'impact'); } }
        continue;
      }
      const it = A.item ? A : B.item ? B : null, tool = it === A ? B : A;
      if (!it) continue;
      if (tool.zk === 'press') { const ph = plate.pp.ph; if (ph === 'down' || ph === 'hold') hurt(it, pressDps() / 60 * (start ? 3 : 1), 'press'); }
      else if (tool.zk === 'blade') hurt(it, 380 / 60, 'grind');
      else if (start && it.speed > 9) hurt(it, (it.speed - 9) * it.mass * 1.5, 'impact'); // esési sebzés
    }
  }
  Events.on(engine, 'beforeUpdate', stepTools);
  Events.on(engine, 'collisionStart', e => pairs(e.pairs, true));
  Events.on(engine, 'collisionActive', e => pairs(e.pairs, false));
  Events.on(engine, 'afterUpdate', () => {
    for (const it of items) { // olvasztó: jobb oldali zóna alsó része
      if (it.position.x > 2 * L.zw && it.position.y > H * .35) {
        hurt(it, it.maxHp * .12 / 60 + .05, 'melt');
        if (Math.random() < .03) burst(it.position.x, it.position.y, 1, '#ff7a2a');
      }
    }
    while (dead.length) { const [it, kind] = dead.pop(); kill(it, kind); }
  });

  // ---------- HÚZÁS (pointer events: egér + érintés) ----------
  let drag = null;
  const pt = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  cv.addEventListener('pointerdown', e => {
    e.preventDefault();
    const p = pt(e), hit = Query.point(items, p);
    if (!hit.length || drag) return;
    const b = hit[hit.length - 1];
    cv.setPointerCapture(e.pointerId);
    const c = Constraint.create({ pointA: p, bodyB: b, pointB: Vector.rotate(Vector.sub(p, b.position), -b.angle),
      stiffness: Math.max(.04, .16 / (1 + b.mass / 25)), damping: .12, length: 0 });
    Composite.add(world, c); drag = { c, b, id: e.pointerId };
  });
  cv.addEventListener('pointermove', e => { if (drag && e.pointerId === drag.id) drag.c.pointA = pt(e); });
  function endDrag() { if (!drag) return; Composite.remove(world, drag.c); drag = null; }
  ['pointerup', 'pointercancel'].forEach(t => cv.addEventListener(t, e => { if (drag && e.pointerId === drag.id) endDrag(); }));
  cv.addEventListener('contextmenu', e => e.preventDefault());

  // ---------- HANG ----------
  let ac = null, lastBeep = 0;
  function beep(f, d, type = 'square', v = .04) {
    if (!st.sfx || performance.now() - lastBeep < 60) return; lastBeep = performance.now();
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume();
      const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.value = f; g.gain.value = v;
      o.connect(g); g.connect(ac.destination); o.start(); g.gain.exponentialRampToValueAtTime(.0001, ac.currentTime + d); o.stop(ac.currentTime + d);
    } catch (e) {}
  }

  // ---------- RAJZOLÁS (pixel art) ----------
  // Minden egy kis felbontású vászonra készül (1 "pixel" = U világ-px); a CSS (image-rendering: pixelated) élesen nagyítja.
  let U = 2, lw = 0, lh = 0, cc = ctx;
  const bgc = document.createElement('canvas'), bctx = bgc.getContext('2d');
  const q = v => Math.round(v / U) * U;
  const hs = (a, b) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };
  function R(x, y, w, h, col) { cc.fillStyle = col; const X = q(x), Y = q(y); cc.fillRect(X, Y, Math.max(U, q(x + w) - X), Math.max(U, q(y + h) - Y)); }
  function hazard(x, y, w, h) { // sárga-fekete figyelmeztető csík
    const n = Math.round(w / U), rows = Math.round(h / U);
    for (let r = 0; r < rows; r++) for (let col = 0; col < n;) {
      const seg = Math.min(n - col, 4 - ((col + r) % 4)), on = ((col + r) >> 2) & 1;
      R(x + col * U, y + r * U, seg * U, U, on ? '#ffc21a' : '#1a1620'); col += seg;
    }
  }
  function steel(x, y, w, h) { // szegecselt acéloszlop
    R(x, y, w, h, '#3d3d4f'); R(x, y, U, h, '#6a6a80'); R(x + w - U, y, U, h, '#25252f'); R(x, y, w, U, '#6a6a80');
    for (let yy = y + 4 * U; yy < y + h - 2 * U; yy += 10 * U) { R(x + U, yy, U, U, '#a4a4bc'); R(x + w - 2 * U, yy, U, U, '#a4a4bc'); }
  }
  function label(txt, x, y, size, col) {
    cc.font = `bold ${size}px "Courier New",monospace`; cc.textAlign = 'center'; cc.textBaseline = 'middle';
    cc.fillStyle = '#000'; cc.fillText(txt, x + U, y + U); cc.fillStyle = col; cc.fillText(txt, x, y);
  }
  function plaque(i, txt, mult, col) {
    const x = i * L.zw + 8, w = L.zw - 16, y = 4 * U, h = 11 * U;
    R(x, y, w, h, '#0e0b14'); R(x, y, w, U, col); R(x, y + h - U, w, U, col); R(x, y, U, h, col); R(x + w - U, y, U, h, col);
    label(txt + ' ' + mult, x + w / 2, y + h / 2, Math.min(7 * U, w / ((txt.length + mult.length + 1) * .62)), col);
  }

  // Statikus háttér: egyszer rajzoljuk, átméretezéskor újra
  function paintBg() {
    bgc.width = lw; bgc.height = lh; cc = bctx; cc.setTransform(lw / W, 0, 0, lh / H, 0, 0);
    const zw = L.zw, ft = L.floorTop;
    cc.fillStyle = '#14111c'; cc.fillRect(0, 0, W + U, H + U);
    const bw = 10 * U, bh = 5 * U; // téglafal
    for (let y = 0, row = 0; y < ft; y += bh, row++) for (let x = -(row % 2) * bw / 2; x < W; x += bw) {
      const h = hs(x, y); R(x + U, y + U, bw - U, bh - U, h < .33 ? '#1c1827' : h < .66 ? '#221d30' : '#181421');
    }
    [.17, .5, .83].forEach(f => { R(W * f, 0, 3 * U, ft, '#2b2538'); R(W * f, 0, U, ft, '#3d3550'); }); // csövek
    ['rgba(90,110,220,.10)', 'rgba(255,150,60,.08)', 'rgba(255,70,50,.12)'].forEach((c, i) => { cc.fillStyle = c; cc.fillRect(i * zw, 0, zw, ft); });
    R(0, ft, W + U, L.fh + U, '#2e2b3a'); R(0, ft, W + U, U, '#6a6580'); // padló
    for (let x = 0; x < W; x += 14 * U) R(x, ft + 2 * U, U, L.fh, '#221f2c');
    hazard(0, H - 3 * U, W + U, 3 * U);

    // függő kezdőpolc (láncokon)
    const sw = W * .3, sx = W / 2 - sw / 2, sy = L.shelfY;
    for (const cx of [sx + 6 * U, sx + sw - 6 * U]) for (let y = 0; y < sy - 6; y += 4 * U) R(cx, y, U, 3 * U, '#8a8aa0');
    R(sx, sy - 5, sw, 10, '#6e5430'); R(sx, sy - 5, sw, U, '#a88a52'); R(sx, sy + 3, sw, U, '#3d2e18');
    for (let x = sx + 10 * U; x < sx + sw; x += 10 * U) R(x, sy - 5 + U, U, 8, '#4d3a20');

    // 1) PRÉS: váz, hengerház, ágy
    const cw = 5 * U, ph = plate.bounds.max.y - plate.bounds.min.y;
    steel(0, 0, cw, ft); steel(zw - 4 - cw, 0, cw, ft); steel(0, 0, zw - 4, 3 * U);
    const hx = zw * .28, hw = zw * .44, hy = 16 * U;
    L.cylB = Math.min(plate.restY - ph / 2 - 3 * U, hy + H * .08);
    R(hx, hy, hw, L.cylB - hy, '#4a3f66'); R(hx, hy, U, L.cylB - hy, '#7b6aa8'); R(hx + hw - U, hy, U, L.cylB - hy, '#2c2540');
    for (let y = hy + 4 * U; y < L.cylB - 2 * U; y += 6 * U) R(hx, y, hw, U, '#352c4b');
    R(hx - 2 * U, hy, hw + 4 * U, 3 * U, '#6a6a80'); R(hx - 2 * U, hy + 2 * U, hw + 4 * U, U, '#25252f');
    R(12, ft - 2 * U, zw - 24, 2 * U, '#4a4a5e'); hazard(10, ft - 2 * U, 10 * U, 2 * U); hazard(zw - 10 - 10 * U, ft - 2 * U, 10 * U, 2 * U);

    // 2) DARÁLÓ: acélház, szellőzőrács
    const r = zw * .23, y0 = ft - r * 2.9, gx = zw + 6, gw = zw - 12;
    R(gx, y0, gw, ft - y0, '#262633'); R(gx + 4 * U, y0 + 4 * U, gw - 8 * U, ft - y0 - 4 * U, '#15121d');
    for (let x = gx + 6 * U; x < gx + gw - 6 * U; x += 6 * U) R(x, y0 + 5 * U, U, ft - y0 - 5 * U, '#201c2c');
    steel(gx, y0, 4 * U, ft - y0); steel(gx + gw - 4 * U, y0, 4 * U, ft - y0); hazard(gx, y0 - 3 * U, gw, 3 * U);

    // 3) OLVASZTÓ: téglakemence, kémény
    const mx = 2 * zw + 6, mw = zw - 12, my = H * .33;
    for (let y = my, row = 0; y < ft; y += 4 * U, row++) for (let x = mx - (row % 2) * 3 * U; x < mx + mw; x += 6 * U) {
      if (x < mx) continue; const h = hs(x, y); R(x, y + U, 5 * U, 3 * U, h < .5 ? '#4a1f1f' : '#5c2727');
    }
    R(mx + 3 * U, my + 3 * U, mw - 6 * U, ft - my - 3 * U, '#1e0c0c');
    const gr = cc.createLinearGradient(0, ft, 0, my); gr.addColorStop(0, 'rgba(255,90,20,.5)'); gr.addColorStop(1, 'rgba(255,90,20,0)');
    cc.fillStyle = gr; cc.fillRect(mx + 3 * U, my + 3 * U, mw - 6 * U, ft - my - 3 * U);
    steel(mx, my, 4 * U, ft - my); steel(mx + mw - 4 * U, my, 4 * U, ft - my); steel(mx, my - 3 * U, mw, 3 * U);
    steel(2 * zw + zw * .45, 0, 6 * U, my - 3 * U);
    L.lavaTop = ft - H * .12; L.mx0 = mx + 4 * U; L.mx1 = mx + mw - 4 * U;

    // elválasztók
    for (let i = 1; i <= 2; i++) { const h = H * .16; steel(zw * i - 4, ft - h, 8, h); hazard(zw * i - 4, ft - h, 8, 3 * U); }
    plaque(0, 'PRÉS', 'x1', '#7fb2ff'); plaque(1, 'DARÁLÓ', 'x1', '#ffb15c'); plaque(2, 'OLVASZTÓ', 'x2,5', '#ff6b5c');
  }

  function burst(x, y, n, c) { for (let i = 0; i < n && sparks.length < 300; i++) sparks.push({ x, y, vx: rnd(-180, 180), vy: rnd(-220, 40), t: rnd(.3, .7), c: c || '#ffd24d' }); }
  function poly(b, fill, stroke) {
    const v = b.vertices; ctx.beginPath(); ctx.moveTo(v[0].x, v[0].y);
    for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = U; ctx.stroke(); }
  }
  function render(dt) {
    if (!lw || !plate) return;
    cc = ctx; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(bgc, 0, 0);
    ctx.setTransform(lw / W, 0, 0, lh / H, 0, 0);
    const now = performance.now(), zw = L.zw, ft = L.floorTop;

    // láva (animált) – a tárgyak mögött, felette áttetsző réteg
    for (let x = L.mx0; x < L.mx1; x += 2 * U) {
      const t = L.lavaTop + Math.sin(now / 400 + x * .08) * U * 1.4, h = ft - t;
      R(x, t, 2 * U, h, '#ff4a1a'); R(x, t + h * .55, 2 * U, h, '#c02a10'); R(x, t, 2 * U, 1.2 * U, '#ffd23f'); R(x, t + 1.2 * U, 2 * U, U, '#ff9a1f');
    }
    if (Math.random() < .25) sparks.push({ x: rnd(L.mx0, L.mx1), y: L.lavaTop, vx: rnd(-10, 10), vy: -rnd(30, 90), g: 40, t: rnd(.6, 1.2), c: '#ffb347' });

    // hidraulikus dugattyú + jelzőlámpák
    const p = plate, rx = zw / 2, rw = q(zw * .12), py = p.position.y - (p.bounds.max.y - p.bounds.min.y) / 2;
    R(rx - rw / 2, L.cylB, rw, py - L.cylB + U, '#9aa0b8'); R(rx - rw / 2, L.cylB, U, py - L.cylB, '#d6dbef'); R(rx + rw / 2 - U, L.cylB, U, py - L.cylB, '#5a5f78');
    R(rx - rw / 2 - U, L.cylB, rw + 2 * U, 2 * U, '#2c2540');
    const phs = p.pp.ph, ly = 18 * U;
    R(13, ly, 6 * U, 14 * U, '#0e0b14');
    R(13 + 2 * U, ly + 2 * U, 2 * U, 2 * U, phs === 'wait' ? '#3cff3c' : '#1d4a1d');
    R(13 + 2 * U, ly + 6 * U, 2 * U, 2 * U, phs === 'up' ? '#ffe03c' : '#4a4a1d');
    R(13 + 2 * U, ly + 10 * U, 2 * U, 2 * U, (phs === 'down' || phs === 'hold') ? '#ff3c3c' : '#4a1d1d');

    // prés lemez
    const pw = zw - 26, px = p.position.x - pw / 2, phh = p.bounds.max.y - p.bounds.min.y;
    R(px, py, pw, phh, '#6a6f88'); R(px, py, pw, U, '#a8aec8'); R(px, py + phh - U, pw, U, '#2a2c3c');
    hazard(px + 4 * U, py + phh - 4 * U, pw - 8 * U, 2 * U);
    for (let x = px + 2 * U; x < px + pw - 2 * U; x += 12 * U) R(x, py + 2 * U, U, U, '#c8cce0');

    // tárgyak
    for (const b of items) {
      poly(b, b.col + (b.emoji ? '88' : 'dd'), '#0a0810');
      if (b.emoji) {
        ctx.save(); ctx.translate(b.position.x, b.position.y); ctx.rotate(b.angle); ctx.scale(1, Math.max(.4, b.sy));
        ctx.font = `${Math.max(8, Math.min(110, Math.min(b.dw, b.dh * 1.1) * .95))}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(b.emoji, 0, 0); ctx.restore();
      }
      if (b.hp < b.maxHp) { // életerő-csík
        const w = Math.max(8 * U, b.dw * .8), x = b.position.x - w / 2, y = b.bounds.min.y - 5 * U, k = Math.max(0, b.hp / b.maxHp);
        R(x - U, y - U, w + 2 * U, 3 * U, '#0a0810'); R(x, y, w * k, U, k > .5 ? '#6fe06f' : k > .25 ? '#ffd23f' : '#ff4a3a');
      }
    }

    // fogazott darálórotorok
    rotors.forEach(r => {
      const bt = Math.max(8, 9 * S);
      ctx.save(); ctx.translate(r.home.x, r.home.y); ctx.rotate(r.angle);
      for (let i = 0; i < 3; i++) {
        ctx.save(); ctx.rotate(i * Math.PI / 3);
        ctx.fillStyle = '#0a0810'; ctx.fillRect(-r.r - U, -bt / 2 - 2 * U, 2 * r.r + 2 * U, bt + 4 * U);
        ctx.fillStyle = '#8a90a8'; ctx.fillRect(-r.r, -bt / 2, 2 * r.r, bt);
        ctx.fillStyle = '#c4c9de'; ctx.fillRect(-r.r, -bt / 2, 2 * r.r, U);
        ctx.fillStyle = '#d8dcee';
        for (const s of [-1, 1]) for (const k of [.4, .7, 1]) { const tx = s * r.r * k - 1.5 * U; ctx.fillRect(tx, -bt / 2 - 2 * U, 3 * U, 2 * U); ctx.fillRect(tx, bt / 2, 3 * U, 2 * U); }
        ctx.restore();
      }
      ctx.beginPath(); ctx.arc(0, 0, r.r * .3, 0, 7); ctx.fillStyle = '#3a3d52'; ctx.fill(); ctx.lineWidth = U; ctx.strokeStyle = '#0a0810'; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r.r * .12, 0, 7); ctx.fillStyle = '#ff9f1c'; ctx.fill();
      ctx.restore();
    });

    // olvasztó: áttetsző láva a tárgyak előtt (elmerülés hatása)
    ctx.fillStyle = 'rgba(255,80,20,.35)'; ctx.fillRect(q(L.mx0), q(L.lavaTop + 2 * U), q(L.mx1 - L.mx0), ft - L.lavaTop - 2 * U);

    // szikrák, törmelék
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i]; s.t -= dt; if (s.t <= 0) { sparks.splice(i, 1); continue; }
      s.vy += (s.g == null ? 600 : s.g) * dt; s.x += s.vx * dt; s.y += s.vy * dt; R(s.x, s.y, U, U, s.c);
    }
    // pénz felirat
    ctx.font = `bold ${Math.max(6 * U, 16 * S)}px "Courier New",monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = pops.length - 1; i >= 0; i--) {
      const pp = pops[i]; pp.t -= dt; if (pp.t <= 0) { pops.splice(i, 1); continue; }
      const yy = pp.y - (1 - pp.t) * 40; ctx.fillStyle = '#000'; ctx.fillText(pp.txt, pp.x + U, yy + U); ctx.fillStyle = pp.c; ctx.fillText(pp.txt, pp.x, yy);
    }
  }

  // ---------- FŐ CIKLUS ----------
  let paused = true, last = performance.now(), acc = 0;
  function frame(t) {
    const dt = Math.min(100, t - last); last = t;
    if (!paused) { acc += dt; let n = 0; while (acc >= 1000 / 60 && n < 4) { Engine.update(engine, 1000 / 60); acc -= 1000 / 60; n++; } if (n === 4) acc = 0; }
    render(dt / 1000); requestAnimationFrame(frame);
  }
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = wrap.clientWidth; H = wrap.clientHeight; if (!W || !H) return;
    U = Math.max(2, Math.round(Math.min(W, H) / 200)); lw = Math.ceil(W / U); lh = Math.ceil(H / U); cv.width = lw; cv.height = lh;
    S = Math.max(.45, Math.min(1.2, W / 800, H / 520));
    endDrag(); build(); paintBg();
    items.slice().forEach(b => { if (b.position.x > W || b.position.y > H || b.position.x < 0) kill(b, 'melt', true); });
  }
  new ResizeObserver(resize).observe(wrap);

  // ---------- FELÜLET ----------
  const selCat = $('selCat'), selItem = $('selItem');
  Object.keys(CATS).forEach(c => selCat.add(new Option(c, c)));
  const fillItems = () => { selItem.innerHTML = ''; CATS[selCat.value].forEach((d, i) => selItem.add(new Option(`${d.n} (${fmt(d.v)})`, i))); };
  selCat.onchange = fillItems; fillItems();
  $('btnMake').onclick = () => { spawn(CATS[selCat.value][selItem.value]); beep(440, .06, 'triangle'); };
  const menu = $('menu');
  $('btnMenu').onclick = () => { menu.classList.remove('hide'); paused = true; };
  $('btnPlay').onclick = () => { menu.classList.add('hide'); paused = false; };
  $('chkSfx').checked = st.sfx; $('chkSfx').onchange = e => { st.sfx = e.target.checked; save(); };
  $('btnReset').onclick = () => { if (confirm('Biztosan törlöd a pénzt és a fejlesztéseket?')) { st.money = 0; st.press = 1; save(); ui(); } };
  let toastT; function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1800); }
  $('btnRefresh').onclick = async () => { // gyorsítótár törlése + újratöltés (csak online)
    if (!navigator.onLine) return toast('Offline vagy – nem lehet frissíteni');
    try {
      if ('serviceWorker' in navigator) (await navigator.serviceWorker.getRegistrations()).forEach(r => r.unregister());
      if (window.caches) (await caches.keys()).forEach(k => caches.delete(k));
    } catch (e) {}
    location.reload();
  };
  let deferred = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('btnInstall').hidden = false; });
  $('btnInstall').onclick = async () => { if (deferred) { deferred.prompt(); deferred = null; $('btnInstall').hidden = true; } };

  ui(); resize(); requestAnimationFrame(frame);
}

// Matter.js: elsődlegesen a helyi matter.min.js; ha hiányzik, egyszeri CDN-letöltés (a service worker cache-eli).
(function loadMatter() {
  if (window.Matter) return start();
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/matter-js@0.19.0/build/matter.min.js';
  s.onload = () => (window.Matter ? start() : fail());
  s.onerror = fail;
  document.head.appendChild(s);
  function fail() { document.getElementById('err').hidden = false; document.getElementById('menu').classList.remove('hide'); }
})();

