/* Zúzó – PWA zúzós játék (Matter.js). Új tárgy: add hozzá a CATS-hoz. Új zóna: lásd build(), stepTools(), hurt(). */
'use strict';

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// ---------- TÁRGYKATALÓGUS: lásd items.js (CATS) ----------
// Zóna szorzók a kifizetéshez
const MULT = { press: 1, grind: 1, melt: 2.5, impact: 0.5 };
// 3x5 pixeles számjegyek (érmék felirata)
const DIG = { 0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001111' };

function start() {
  const { Engine, Composite, Bodies, Body, Constraint, Events, Query, Vector } = Matter;
  const $ = id => document.getElementById(id);
  const cv = $('cv'), ctx = cv.getContext('2d'), wrap = $('wrap');
  const rnd = (a, b) => a + Math.random() * (b - a);
  const fmt = n => Math.floor(n).toLocaleString('hu-HU') + ' Ft';

  // ---------- MENTÉS ----------
  const SAVE = 'zuzo_save_v1';
  let st = { money: 0, press: 1, grind: 1, melt: 1, sfx: true, names: true };
  try { Object.assign(st, JSON.parse(localStorage.getItem(SAVE) || '{}')); } catch (e) {}
  let saveT = 0;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(SAVE, JSON.stringify(st)); } catch (e) {} }, 400); };

  // ---------- GAZDASÁG ----------
  const LV = { press: { base: 200, name: 'PRÉS' }, grind: { base: 260, name: 'DARÁLÓ' }, melt: { base: 320, name: 'OLVASZTÓ' } };
  const pressDps = () => 45 * Math.pow(1.3, st.press - 1);          // prés: sebzés/s
  const bladeDps = () => 380 * Math.pow(1.28, st.grind - 1);         // daráló: sebzés/s
  const bladeSpeed = () => Math.min(.24, .11 + .006 * (st.grind - 1)); // daráló: fordulatszám
  const meltRate = () => .12 * Math.pow(1.25, st.melt - 1);          // olvasztó: életerő-hányad/s
  const meltMult = () => 2.5 + .1 * (st.melt - 1);                   // olvasztó: kifizetési szorzó
  const multOf = k => k === 'melt' ? meltMult() : MULT[k];
  const costOf = k => Math.round(LV[k].base * Math.pow(1.6, st[k] - 1));
  const tier = k => Math.min(3, Math.floor((st[k] - 1) / 5));        // vizuális fejlődési fokozat
  let lvKey = '';
  function ui() {
    $('money').textContent = fmt(st.money);
    for (const k of ['press', 'grind', 'melt']) {
      const b = $('up_' + k), c = costOf(k);
      b.innerHTML = `<b>${LV[k].name}</b> Sz.${st[k]}<br>⬆ ${fmt(c)}`;
      b.classList.toggle('off', st.money < c);
    }
    const key = [st.press, st.grind, st.melt].join();
    if (key !== lvKey) { lvKey = key; if (lw && plate) paintBg(); } // a tábla szintjei újrarajzolódnak
  }
  for (const k of ['press', 'grind', 'melt']) $('up_' + k).onclick = () => {
    const c = costOf(k);
    if (st.money < c) return toast('Nincs elég pénz');
    st.money -= c; st[k]++; save(); ui(); audioInit();
    beep(520, .1, 'triangle'); setTimeout(() => beep(780, .14, 'triangle'), 90); noiseBurst(3200, .25, .05, 'highpass');
  };

  // ---------- FIZIKA ----------
  const engine = Engine.create({ positionIterations: 8, velocityIterations: 6 });
  const world = engine.world;
  let W = 0, H = 0, S = 1, dpr = 1;
  let L = {}, statics = [], plate = null, rotors = [], belts = [];
  const items = [], dead = [], sparks = [], pops = [];
  let shake = 0, hover = null;
  const snd = { press: 0, dir: 1, hit: 0, meltN: 0, load: 0 }; // hanghoz: a gépek pillanatnyi terhelése
  let gP = 0; // nyomásmérő tű (simított)
  const antiGrav = b => { b.force.y -= b.mass * engine.gravity.y * engine.gravity.scale; };

  function build() {
    statics.forEach(b => Composite.remove(world, b)); statics = []; rotors = []; belts = [];
    const fh = Math.max(14, 18 * S);
    L = { fh, floorTop: H - fh, zw: W / 3, shelfY: H * .30, bh: Math.max(8, 5 * U) };
    const add = (b, col, hide) => { b.col = col; b.hide = hide; statics.push(b); Composite.add(world, b); return b; };
    add(Bodies.rectangle(W / 2, H - fh / 2, W + 400, fh, { isStatic: true }), '#3a3f4a');
    add(Bodies.rectangle(-100, H / 2, 200, H * 3, { isStatic: true }), '', true);
    add(Bodies.rectangle(W + 100, H / 2, 200, H * 3, { isStatic: true }), '', true);
    for (let i = 1; i <= 2; i++) add(Bodies.rectangle(L.zw * i, L.floorTop - H * .08, 8, H * .16, { isStatic: true }), '#59606e');
    add(Bodies.rectangle(W / 2, L.shelfY, W * .3, 10, { isStatic: true }), '#8a6d3b'); // kezdőpolc

    // Futószalagok: mindhárom gépnél a közép felé szállítják a tárgyakat (a hatás a pairs()-ben, a rajz a drawBelts()-ben)
    for (let z = 0; z < 3; z++) {
      const x0 = L.zw * z + 10, x1 = L.zw * (z + 1) - 10, xm = (x0 + x1) / 2;
      [[x0, xm, 1], [xm, x1, -1]].forEach(([a, c, dir]) => {
        const bt = Bodies.rectangle((a + c) / 2, L.floorTop - L.bh / 2, c - a, L.bh, { isStatic: true, friction: 1 });
        bt.zk = 'belt'; bt.dir = dir; bt.x0 = a; bt.x1 = c; add(bt, '', true); belts.push(bt);
      });
    }

    // 1) Hidraulikus prés: nehéz, függőlegesen mozgó lemez
    const ph = Math.max(16, 22 * S);
    plate = Bodies.rectangle(L.zw / 2, H * .2, L.zw - 26, ph, { density: 5, friction: .9, frictionAir: 0 });
    Body.setInertia(plate, Infinity);
    plate.zk = 'press'; plate.restY = H * .2; plate.botY = L.floorTop - L.bh - ph / 2 - 8 * S; plate.pp = { ph: 'wait', t: .4, v: 0 };
    statics.push(plate); Composite.add(world, plate);

    // 2) Daráló: két ellentétesen forgó, háromkarú rotor
    const r = L.zw * .23;
    [[.27, 1], [.73, -1]].forEach(([fx, dir]) => {
      const cx = L.zw + L.zw * fx, cy = L.floorTop - L.bh - r - 4;
      const bars = [0, 1, 2].map(i => Bodies.rectangle(cx, cy, 2 * r, Math.max(8, 9 * S), { angle: i * Math.PI / 3, density: 3 }));
      const rot = Body.create({ parts: bars, friction: .8, frictionAir: 0 });
      rot.zk = 'blade'; rot.dir = dir; rot.home = { x: cx, y: cy }; rot.r = r;
      statics.push(rot); rotors.push(rot); Composite.add(world, rot);
    });
  }

  // Mozgó szerkezetek léptetése (fizikai lépés előtt). Az előző állapotot az interpolált rajzoláshoz mentjük.
  function stepTools() {
    const p = plate, s = p.pp, vmax = Math.min(16 * S, (3 + .45 * st.press) * S), y = p.position.y;
    for (const b of items) { b.px = b.position.x; b.py = b.position.y; b.pa = b.angle; }
    p.py = y; rotors.forEach(r => { r.pa = r.angle; });
    let vy = 0;
    if (s.ph === 'wait') { s.t -= 1 / 60; if (s.t <= 0) { s.ph = 'down'; s.v = 0; } }
    else if (s.ph === 'down') { // gyorsulva zuhan
      s.v = Math.min(vmax, s.v + vmax * .09 + .15); vy = s.v;
      if (y + vy >= p.botY) { vy = p.botY - y; s.ph = 'hold'; s.t = .35; slam(vmax); }
    }
    else if (s.ph === 'hold') { s.t -= 1 / 60; if (s.t <= 0) { s.ph = 'up'; s.v = 0; } }
    else { // lassan, egyenletesen emelkedik
      s.v = Math.min(vmax * .7, s.v + vmax * .05 + .1); vy = -s.v;
      if (y + vy <= p.restY) { vy = p.restY - y; s.ph = 'wait'; s.t = .5; }
    }
    snd.press = s.ph === 'down' || s.ph === 'up' ? s.v / vmax : s.ph === 'hold' ? .3 : 0; snd.dir = s.ph === 'up' ? -1 : 1;
    Body.setVelocity(p, { x: 0, y: vy }); Body.setAngle(p, 0); Body.setAngularVelocity(p, 0);
    Body.setPosition(p, { x: L.zw / 2, y: p.position.y }); antiGrav(p);
    rotors.forEach(r => { Body.setPosition(r, r.home); Body.setVelocity(r, { x: 0, y: 0 }); Body.setAngularVelocity(r, r.dir * bladeSpeed()); antiGrav(r); });
  }
  function slam(vmax) { // prés becsapódás: képrázkódás, por, gőz, dobbanás
    shake = Math.max(shake, Math.min(6, 1.5 + vmax * .35));
    puff(L.zw * .12, L.floorTop - 2, 4, '#8a8aa0'); puff(L.zw * .88, L.floorTop - 2, 4, '#8a8aa0');
    puff(16, plate.position.y, 3, '#e8ecf5', 1.6); puff(L.zw - 16, plate.position.y, 3, '#e8ecf5', 1.6);
    beep(62, .22, 'sine', .12); noiseBurst(3000, .45, .07, 'highpass'); noiseBurst(220, .28, .12, 'lowpass'); // hidraulikus csapódás + gőz
  }

  // ---------- SPRITE-OK: az emojikból pixelart ikon készül (kontúr, szűkített színpaletta) ----------
  const sprCache = new Map();
  function shade(h, f) { // hex szín világosítása (f>0) / sötétítése (f<0)
    const n = parseInt(h.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255; const t = f < 0 ? 0 : 255, p = Math.abs(f);
    r = Math.round(r + (t - r) * p); g = Math.round(g + (t - g) * p); b = Math.round(b + (t - b) * p); return `rgb(${r},${g},${b})`;
  }
  function finishSprite(g) { // átlátszóság küszöbölése, színek kvantálása, sötét körvonal, maszk
    const x = g.getContext('2d'), w = g.width, h = g.height, im = x.getImageData(0, 0, w, h), d = im.data, m = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) { const o = i * 4; if (d[o + 3] > 110) { m[i] = 1; d[o + 3] = 255; for (let k = 0; k < 3; k++) d[o + k] = Math.min(255, Math.round(d[o + k] / 48) * 48); } else d[o + 3] = 0; }
    const m2 = m.slice();
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const i = yy * w + xx; if (m[i]) continue;
      if ((xx > 0 && m[i - 1]) || (xx < w - 1 && m[i + 1]) || (yy > 0 && m[i - w]) || (yy < h - 1 && m[i + w])) { const o = i * 4; d[o] = 10; d[o + 1] = 8; d[o + 2] = 16; d[o + 3] = 255; m2[i] = 1; }
    }
    x.putImageData(im, 0, 0); g.mask = m2; return g;
  }
  function emojiSprite(def, aw, ah) {
    const key = def.e + '|' + aw + 'x' + ah; if (sprCache.has(key)) return sprCache.get(key);
    const T = 128, t = document.createElement('canvas'); t.width = t.height = T; const tx = t.getContext('2d');
    tx.font = `${T * .8}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",system-ui,sans-serif`; tx.textAlign = 'center'; tx.textBaseline = 'middle'; tx.fillText(def.e, T / 2, T / 2);
    const d0 = tx.getImageData(0, 0, T, T).data; let x0 = T, y0 = T, x1 = 0, y1 = 0;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (d0[(y * T + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 <= x0 || y1 <= y0) { x0 = 0; y0 = 0; x1 = T - 1; y1 = T - 1; }
    const g = document.createElement('canvas'); g.width = aw + 2; g.height = ah + 2;
    const x = g.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(t, x0, y0, x1 - x0 + 1, y1 - y0 + 1, 1, 1, aw, ah); // szoros vágás: a kép kitölti a testet
    finishSprite(g); sprCache.set(key, g); return g;
  }
  function coinSprite(def, n) { // procedurális érme számmal
    const key = 'coin|' + def.n + '|' + n; if (sprCache.has(key)) return sprCache.get(key);
    const g = document.createElement('canvas'); g.width = g.height = n + 2; const x = g.getContext('2d'), r = n / 2;
    for (let yy = 0; yy < n; yy++) for (let xx = 0; xx < n; xx++) {
      const dx = xx + .5 - r, dy = yy + .5 - r, dd = Math.hypot(dx, dy); if (dd > r) continue;
      x.fillStyle = dd > r - 1.6 ? shade(def.c, -.35) : (dx + dy < -r * .6 ? shade(def.c, .3) : def.c); x.fillRect(xx + 1, yy + 1, 1, 1);
    }
    const txt = def.n.match(/^\d+/)[0], tw = txt.length * 4 - 1, ox = Math.round((n - tw) / 2) + 1, oy = Math.round((n - 5) / 2) + 1;
    x.fillStyle = shade(def.c, -.55);
    [...txt].forEach((ch, i) => { const bits = DIG[ch]; for (let k = 0; k < 15; k++) if (bits[k] === '1') x.fillRect(ox + i * 4 + (k % 3), oy + (k / 3 | 0), 1, 1); });
    finishSprite(g); sprCache.set(key, g); return g;
  }
  function tinted(spr, col, key) { // egyszínű sziluett (villanás / hevülés)
    if (spr[key]) return spr[key];
    const g = document.createElement('canvas'); g.width = spr.width; g.height = spr.height; const x = g.getContext('2d');
    x.drawImage(spr, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = col; x.fillRect(0, 0, g.width, g.height); spr[key] = g; return g;
  }

  // ---------- TÁRGYAK ----------
  function tag(b, o) {
    Object.assign(b, { item: true, alive: true, hp: o.hp, maxHp: o.hp, value: o.v, gen: o.gen || 0, col: o.c, name: o.n || 'Töredék', spr: o.spr, crop: o.crop || null,
      solid: !!o.solid, dw: o.dw, dh: o.dh, area: o.area, sy: 1, dens: o.d, born: performance.now(), flash: 0, heat: 0, melting: false,
      px: b.position.x, py: b.position.y, pa: b.angle });
    items.push(b); Composite.add(world, b);
    return b;
  }
  function spawn(def) {
    const circ = def.shape === 'c';
    const a = circ ? 1 : Math.max(.7, Math.min(1.35, def.w / def.h)), area0 = circ ? Math.PI * def.r * def.r : def.w * def.h;
    const w0 = circ ? def.r * 2 : Math.sqrt(area0 * a), h0 = circ ? def.r * 2 : Math.sqrt(area0 / a);
    let k = Math.max(S, 13 * U / Math.min(w0, h0)); // a legkisebb tárgy is jól látszódjon
    k = Math.min(k, W * .3 / Math.max(w0, h0), H * .22 / h0);
    const dw = w0 * k, dh = h0 * k, x = W / 2 + rnd(-W * .03, W * .03), y = L.shelfY - 12 - dh / 2;
    const opts = { density: def.d, friction: .5, restitution: .15, collisionFilter: { category: 2 } };
    const body = circ ? Bodies.circle(x, y, dw / 2, opts, 24) : Bodies.rectangle(x, y, dw, dh, Object.assign(opts, { chamfer: { radius: Math.min(dw, dh) * .1 } }));
    const aw = Math.max(6, Math.round(dw / U)), ah = Math.max(6, Math.round(dh / U));
    const spr = circ && /^\d+ Ft$/.test(def.n) ? coinSprite(def, aw) : emojiSprite(def, aw, ah);
    tag(body, { hp: def.hp, v: def.v, c: def.c, n: def.n, spr, d: def.d, dw, dh, area: circ ? Math.PI * (dw / 2) ** 2 : dw * dh });
    body.labelT = performance.now() + 2500;
    trimBodies();
  }
  function trimBodies() { // túl sok darab esetén a legrégebbi töredék eltűnik (kifizetéssel)
    while (items.length > 140) { const f = items.find(i => i.gen > 0) || items[0]; kill(f, 'melt', true); }
  }
  function fragments(it) { // a töredékek az eredeti sprite egy-egy darabját viselik
    if (it.gen >= 2) return;
    const size = Math.sqrt(it.area);
    if (size < 14 * S) return;
    const n = it.gen === 0 ? Math.max(3, Math.min(7, Math.round(size / (22 * S)))) : 3;
    const fs = Math.sqrt(it.area / n) * .85, sp = it.spr, pc = it.crop || { x: 0, y: 0, w: sp.width, h: sp.height };
    for (let i = 0; i < n; i++) {
      const w = fs * rnd(.7, 1.3), h = fs * rnd(.7, 1.3), cw = Math.max(3, Math.min(pc.w, Math.round(w / U))), ch = Math.max(3, Math.min(pc.h, Math.round(h / U)));
      let best = null, bf = -1;
      for (let t = 0; t < 6; t++) { // a legtömörebb (legkevésbé átlátszó) kivágást választjuk
        const cx = pc.x + Math.floor(rnd(0, pc.w - cw + 1)), cy = pc.y + Math.floor(rnd(0, pc.h - ch + 1)); let o = 0;
        for (let yy = 0; yy < ch; yy++) for (let xx = 0; xx < cw; xx++) o += sp.mask[(cy + yy) * sp.width + cx + xx];
        if (o > bf) { bf = o; best = { x: cx, y: cy, w: cw, h: ch }; }
      }
      const cr = () => rnd(0, Math.min(w, h) * .3);
      const b = Bodies.rectangle(it.position.x + rnd(-.25, .25) * size, it.position.y + rnd(-.25, .25) * size, w, h,
        { angle: rnd(0, 6.28), density: it.dens, friction: .6, restitution: .2, chamfer: { radius: [cr(), cr(), cr(), cr()] }, collisionFilter: { category: 2 } });
      tag(b, { hp: Math.max(8, it.maxHp / n * .4), v: it.value * .3 / n, c: it.col, gen: it.gen + 1, d: it.dens, dw: w, dh: h, area: w * h, spr: sp, crop: best, solid: bf / (cw * ch) < .3 });
      Body.setVelocity(b, { x: rnd(-6, 6), y: -rnd(0, 6) });
    }
  }
  function kill(it, kind, silent) {
    if (!it.alive) return;
    it.alive = false;
    Composite.remove(world, it); items.splice(items.indexOf(it), 1);
    if (drag && drag.b === it) endDrag();
    const pay = it.value * multOf(kind);
    if (pay >= 1) { st.money += pay; save(); ui(); if (!silent) pops.push({ x: it.position.x, y: it.position.y, t: 1, txt: '+' + Math.floor(pay).toLocaleString('hu-HU'), c: kind === 'melt' ? '#ffb347' : '#ffe27a' }); }
    if (silent) return;
    burst(it.position.x, it.position.y, Math.min(24, 8 + Math.sqrt(it.area) / 6 | 0), kind === 'melt' ? '#ff7a2a' : '#ffd24d');
    if (kind !== 'melt') { chunks(it.position.x, it.position.y, Math.min(14, 4 + Math.sqrt(it.area) / 10 | 0), it.col); puff(it.position.x, it.position.y, 3, '#8a8aa0'); }
    else puff(it.position.x, it.position.y, 4, '#d8d8e8', 1.5);
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
    if (d > .3 && kind !== 'melt') it.flash = .09; // találati villanás
    if (kind === 'grind' && Math.random() < .5) burst(it.position.x, it.position.y, 3, '#fff3b0');
    else if (kind === 'press' && Math.random() < .2) puff(it.position.x, it.bounds.max.y, 1, '#8a8aa0');
    if (it.hp <= 0) dead.push([it, kind]);
  }

  // ---------- ÜTKÖZÉSEK ----------
  function carry(it, belt) { // futószalag: a ráfekvő tárgy felveszi a szalag sebességét (a körök gurulnak is)
    const sp = 1.1 * S * belt.dir;
    Body.setVelocity(it, { x: it.velocity.x + (sp - it.velocity.x) * .15, y: it.velocity.y });
    if (it.circleRadius) Body.setAngularVelocity(it, it.velocity.x / it.circleRadius);
  }
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
      else if (tool.zk === 'blade') { hurt(it, bladeDps() / 60, 'grind'); snd.hit++; }
      else {
        if (tool.zk === 'belt' && Math.abs(pr.collision.normal.y) > .6) carry(it, tool);
        if (start && it.speed > 9) hurt(it, (it.speed - 9) * it.mass * 1.5, 'impact'); // esési sebzés
      }
    }
  }
  Events.on(engine, 'beforeUpdate', stepTools);
  Events.on(engine, 'collisionStart', e => pairs(e.pairs, true));
  Events.on(engine, 'collisionActive', e => pairs(e.pairs, false));
  Events.on(engine, 'afterUpdate', () => {
    snd.meltN = 0;
    for (const it of items) { // olvasztó: jobb oldali zóna alsó része
      it.melting = it.position.x > 2 * L.zw && it.position.y > H * .35;
      if (it.melting) {
        snd.meltN++; hurt(it, it.maxHp * meltRate() / 60 + .05, 'melt'); it.heat = 1 - Math.max(0, it.hp) / it.maxHp;
        if (Math.random() < .03) burst(it.position.x, it.position.y, 1, '#ff7a2a');
        if (Math.random() < .05) puff(it.position.x, it.bounds.min.y, 1, '#6a6a80', 1.2);
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
    Composite.add(world, c); drag = { c, b, id: e.pointerId }; hover = b; b.labelT = performance.now() + 2000;
  });
  cv.addEventListener('pointermove', e => {
    if (drag && e.pointerId === drag.id) drag.c.pointA = pt(e);
    else if (!drag) { const h = Query.point(items, pt(e)); hover = h.length ? h[h.length - 1] : null; }
  });
  cv.addEventListener('pointerleave', () => { if (!drag) hover = null; });
  function endDrag() { if (!drag) return; Composite.remove(world, drag.c); drag = null; }
  ['pointerup', 'pointercancel'].forEach(t => cv.addEventListener(t, e => { if (drag && e.pointerId === drag.id) endDrag(); }));
  cv.addEventListener('contextmenu', e => e.preventDefault());

  // ---------- HANG (WebAudio szintézis: hidraulika, daráló-motor, olvasztó-zúgás) ----------
  let AC = null, A = {}, lastBeep = 0;
  function audioInit() {
    if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      const nb = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate), d = nb.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      A.nb = nb; A.master = AC.createGain(); A.master.gain.value = .7; A.master.connect(AC.destination);
      const noise = (type, f, q) => { const sr = AC.createBufferSource(); sr.buffer = nb; sr.loop = true; const fl = AC.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q || 1;
        const g = AC.createGain(); g.gain.value = 0; sr.connect(fl); fl.connect(g); g.connect(A.master); sr.start(); return { fl, g }; };
      const osc = (type, f, lp) => { const o = AC.createOscillator(); o.type = type; o.frequency.value = f; const fl = AC.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp;
        const g = AC.createGain(); g.gain.value = 0; o.connect(fl); fl.connect(g); g.connect(A.master); o.start(); return { o, fl, g }; };
      A.hyd = osc('sawtooth', 70, 500); A.whine = osc('triangle', 300, 1800); A.hiss = noise('highpass', 3500);
      A.motor = osc('square', 45, 220); A.grn = noise('bandpass', 1100, 1.4); A.melt = noise('lowpass', 280);
    } catch (e) { AC = null; }
  }
  function audioTick(dt) { // folyamatos hangok: a gépek terheléséhez igazítva
    if (!AC) return;
    const on = st.sfx && !paused, t = AC.currentTime, set = (g, v) => g.gain.setTargetAtTime(on ? v : 0, t, .06), pr = snd.press;
    set(A.hyd.g, .07 * pr); A.hyd.o.frequency.setTargetAtTime(55 + 90 * pr, t, .08);          // hidraulika-búgás
    set(A.whine.g, .012 * pr); A.whine.o.frequency.setTargetAtTime(220 + 520 * pr * (snd.dir > 0 ? 1 : .6), t, .08); // szivattyú-sivítás
    set(A.hiss.g, snd.dir > 0 ? .02 * pr : 0);                                                  // sziszegés lefelé menet
    snd.load += ((snd.hit > 0 ? 1 : 0) - snd.load) * Math.min(1, dt * 6); snd.hit = 0;
    set(A.motor.g, .035 + .03 * snd.load); A.motor.o.frequency.setTargetAtTime(38 + (bladeSpeed() - .11) * 200 + 14 * snd.load, t, .1);
    set(A.grn.g, .07 * snd.load);                                                               // őrlés
    set(A.melt.g, .02 + .035 * Math.min(1, snd.meltN / 3));                                      // kemence-zúgás
    if (on && snd.meltN && Math.random() < .08) noiseBurst(2000 + Math.random() * 3000, .04, .03, 'bandpass'); // pattogás
  }
  function noiseBurst(f, d, v, type) {
    if (!AC || !st.sfx || paused) return;
    const sr = AC.createBufferSource(); sr.buffer = A.nb; const fl = AC.createBiquadFilter(); fl.type = type; fl.frequency.value = f;
    const g = AC.createGain(); g.gain.value = v; sr.connect(fl); fl.connect(g); g.connect(A.master);
    sr.start(); g.gain.exponentialRampToValueAtTime(.0001, AC.currentTime + d); sr.stop(AC.currentTime + d);
  }
  function beep(f, d, type = 'square', v = .04) {
    if (!AC || !st.sfx || performance.now() - lastBeep < 60) return; lastBeep = performance.now();
    try {
      const o = AC.createOscillator(), g = AC.createGain(); o.type = type; o.frequency.value = f; g.gain.value = v;
      o.connect(g); g.connect(A.master); o.start(); g.gain.exponentialRampToValueAtTime(.0001, AC.currentTime + d); o.stop(AC.currentTime + d);
    } catch (e) {}
  }
  window.addEventListener('pointerdown', audioInit);

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
    // --- további alkatrészek ---
    const rodL = 13 + 3 * U, rodR = zw - 13 - 5 * U; // oldalsó munkahengerek házai + tömlők
    [rodL, rodR].forEach(x => { R(x - 2 * U, 3 * U, 6 * U, 8 * U, '#4a3f66'); R(x - 2 * U, 3 * U, U, 8 * U, '#7b6aa8'); R(x + 3 * U, 3 * U, U, 8 * U, '#2c2540'); R(x - 2 * U, 10 * U, 6 * U, U, '#25252f'); });
    R(cw, hy + 8 * U, hx - cw, 2 * U, '#2b2538'); R(cw, hy + 8 * U, hx - cw, U, '#3d3550'); R(hx + hw, hy + 8 * U, zw - 4 - cw - hx - hw, 2 * U, '#2b2538'); R(hx + hw, hy + 8 * U, zw - 4 - cw - hx - hw, U, '#3d3550');
    R(cw, 11 * U, U * 2, hy - 6 * U, '#2b2538'); R(zw - 4 - cw - 2 * U, 11 * U, 2 * U, hy - 6 * U, '#2b2538');
    for (let x = gx + 5 * U; x < gx + gw - 8 * U; x += 5 * U) { R(x, y0, 3 * U, 2 * U, '#d8dcee'); R(x + U, y0 + 2 * U, U, 2 * U, '#d8dcee'); } // daráló „fogsor”
    for (let x = mx + 6 * U; x < mx + mw - 8 * U; x += 5 * U) { R(x, my + 3 * U, 3 * U, 2 * U, '#3a1a1a'); R(x + U, my + 5 * U, U, 2 * U, '#ff6a2a'); }   // kemence „fogsor”
    R(mx + mw, my + 6 * U, 2 * U, ft - my - 20 * U, '#2b2538'); R(mx + mw, my + 6 * U, U, ft - my - 20 * U, '#3d3550');
    const mm = meltMult().toFixed(1).replace('.', ',');
    plaque(0, 'PRÉS', 'Sz.' + st.press, '#7fb2ff'); plaque(1, 'DARÁLÓ', 'Sz.' + st.grind, '#ffb15c'); plaque(2, 'OLVASZTÓ', 'x' + mm, '#ff6b5c');
    L.y0 = y0; L.hx = hx; L.hw = hw; L.hy = hy; L.rodL = rodL; L.rodR = rodR; L.my = my; L.gcx = zw * 1.5;
  }

  // ---------- RÉSZECSKÉK ----------
  const P = (x, y, vx, vy, t, c, o) => { if (sparks.length < 360) sparks.push(Object.assign({ x, y, vx, vy, t, t0: t, c, sz: 1, g: 600, k: 's', grow: 0 }, o)); };
  function burst(x, y, n, c) { for (let i = 0; i < n; i++) P(x, y, rnd(-190, 190), rnd(-240, 40), rnd(.3, .8), c || '#ffd24d'); }
  function chunks(x, y, n, col) { for (let i = 0; i < n; i++) P(x, y, rnd(-150, 150), rnd(-260, -40), rnd(.5, 1), shade(col, rnd(-.4, .2)), { sz: 2, k: 'c' }); }
  function puff(x, y, n, col, up) { for (let i = 0; i < n; i++) P(x + rnd(-8, 8), y, rnd(-40, 40), -rnd(10, 60) * (up || 1), rnd(.5, 1), col || '#8a8aa0', { sz: 2, grow: 6, g: -20, k: 'd' }); }

  const PCOL = ['#6a6f88', '#8a6a6a', '#a04a4a', '#c03030'], RCOL = ['#8a90a8', '#a89080', '#c07050', '#e05030'];
  function drawBelts(now) { // futószalagok: mozgó láncszemek, görgők
    const ft = L.floorTop, bh = L.bh;
    for (const b of belts) {
      const w = b.x1 - b.x0, y = ft - bh, step = 6 * U, off = (((now / 1000) * 66 * S * b.dir) % step + step) % step;
      R(b.x0, y, w, bh, '#1c1a24'); R(b.x0, y + bh - U, w, U, '#0e0b14');
      for (let x = b.x0 - step + off; x < b.x1; x += step) { const xx = Math.max(x, b.x0), ww = Math.min(x + 5 * U, b.x1) - xx; if (ww > 0) { R(xx, y, ww, 2 * U, '#5a5a70'); R(xx, y, ww, U, '#8a8aa4'); } }
      for (const rx of [b.x0 + bh / 2, b.x1 - bh / 2]) {
        ctx.save(); ctx.translate(rx, y + bh / 2); ctx.rotate(now / 160 * b.dir);
        ctx.beginPath(); ctx.arc(0, 0, bh / 2, 0, 7); ctx.fillStyle = '#8a8aa4'; ctx.fill(); ctx.lineWidth = U; ctx.strokeStyle = '#0a0810'; ctx.stroke();
        ctx.fillStyle = '#0a0810'; ctx.fillRect(-bh / 2 + U, -U / 2, bh - 2 * U, U); ctx.restore();
      }
    }
  }
  function drawFlames(now) { // olvasztó lángszórók: időnként kilövellnek a falból
    const jets = [[L.mx0, 1, L.floorTop - H * .30, 0], [L.mx1, -1, L.floorTop - H * .22, 1.4], [L.mx0, 1, L.floorTop - H * .17, 2.6], [L.mx1, -1, L.floorTop - H * .34, 3.3]];
    const maxLen = (L.mx1 - L.mx0) * (.28 + .02 * Math.min(10, st.melt));
    for (const [x, dir, y, ph0] of jets) {
      const ph = ((now / 1000) + ph0) % 4.5; if (ph > 1.3) continue;
      const len = maxLen * Math.sin(ph / 1.3 * Math.PI);
      for (let i = 0; i < len; i += U) {
        const f = i / maxLen, hgt = (4 * (1 - f * .7) + Math.random() * 2) * U;
        R(x + dir * i, y - hgt / 2, U, hgt, f < .25 ? '#ffe27a' : f < .55 ? '#ff9a1f' : '#e03a14');
      }
      if (Math.random() < .3) P(x + dir * len, y, dir * rnd(20, 60), -rnd(20, 60), rnd(.3, .6), '#ffb347', { g: 40 });
    }
  }
  function beacon(x, y, on, col, now) { // forgó/villogó jelzőlámpa
    const f = on ? Math.sin(now / 70) > 0 : Math.sin(now / 350) > .75;
    R(x - 2 * U, y - 2 * U, 4 * U, 4 * U, f ? col : '#3a1010'); R(x - 2 * U, y - 2 * U, 4 * U, U, f ? '#fff' : '#5a2020');
    if (f) { ctx.fillStyle = col + '44'; ctx.beginPath(); ctx.arc(x, y, 8 * U, 0, 7); ctx.fill(); }
  }
  function drawRotor(r, ang, alpha) {
    const bt = Math.max(8, 9 * S);
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(r.home.x, r.home.y); ctx.rotate(ang);
    for (let i = 0; i < 3; i++) {
      ctx.save(); ctx.rotate(i * Math.PI / 3);
      ctx.fillStyle = '#0a0810'; ctx.fillRect(-r.r - U, -bt / 2 - 2 * U, 2 * r.r + 2 * U, bt + 4 * U);
      ctx.fillStyle = RCOL[tier('grind')]; ctx.fillRect(-r.r, -bt / 2, 2 * r.r, bt);
      ctx.fillStyle = '#c4c9de'; ctx.fillRect(-r.r, -bt / 2, 2 * r.r, U);
      ctx.fillStyle = '#d8dcee';
      for (const s of [-1, 1]) for (const k of [.4, .7, 1]) { const tx = s * r.r * k - 1.5 * U; ctx.fillRect(tx, -bt / 2 - 2 * U, 3 * U, 2 * U); ctx.fillRect(tx, bt / 2, 3 * U, 2 * U); }
      ctx.restore();
    }
    if (alpha === 1) {
      ctx.beginPath(); ctx.arc(0, 0, r.r * .3, 0, 7); ctx.fillStyle = '#3a3d52'; ctx.fill(); ctx.lineWidth = U; ctx.strokeStyle = '#0a0810'; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r.r * .12, 0, 7); ctx.fillStyle = '#ff9f1c'; ctx.fill();
    }
    ctx.restore();
  }

  function drawItem(b, x, y, a, now) {
    const age = (now - b.born) / 1000, pop = age < .3 ? 1 + .2 * Math.sin(age / .3 * Math.PI) * (1 - age / .3) : 1; // „pattanó” megjelenés
    const sp = b.spr, cr = b.crop, sx = cr ? cr.x : 0, sy = cr ? cr.y : 0, sw = cr ? cr.w : sp.width, sh = cr ? cr.h : sp.height;
    const dw = cr ? b.dw : b.dw + 2 * U, dh = cr ? b.dh : b.dh + 2 * U; // a teljes sprite 1 px kontúrt is tartalmaz
    ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(pop, Math.max(.4, b.sy) * pop);
    if (b.solid) { ctx.fillStyle = shade(b.col, -.3); ctx.fillRect(-b.dw / 2, -b.dh / 2, b.dw, b.dh); }
    ctx.drawImage(sp, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
    if (b.flash > 0) { ctx.globalAlpha = Math.min(.75, b.flash / .09 * .75); ctx.drawImage(tinted(sp, '#ffffff', 'w'), sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh); ctx.globalAlpha = 1; }
    if (b.melting && b.heat > .02) { ctx.globalAlpha = Math.min(.85, b.heat * .9 + .15); ctx.drawImage(tinted(sp, '#ff7a1a', 'o'), sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh); ctx.globalAlpha = 1; }
    ctx.restore();
  }
  function textBox(txt, cx, cy, col) {
    ctx.font = `bold ${6 * U}px "Courier New",monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = q(ctx.measureText(txt).width + 4 * U), h = 9 * U, x = Math.min(W - w - U, Math.max(U, cx - w / 2)), y = Math.max(U, cy - h / 2);
    R(x, y, w, h, '#0e0b14'); R(x, y, w, U, col); R(x, y + h - U, w, U, col); R(x, y, U, h, col); R(x + w - U, y, U, h, col);
    ctx.fillStyle = '#fff'; ctx.fillText(txt, x + w / 2, y + h / 2 + U * .5);
  }

  function render(dt, al) {
    if (!lw || !plate) return;
    cc = ctx; shake *= Math.exp(-dt * 9); if (shake < .05) shake = 0;
    const ox = Math.round(rnd(-1, 1) * shake), oy = Math.round(rnd(-1, 1) * shake);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#14111c'; ctx.fillRect(0, 0, lw, lh); ctx.drawImage(bgc, ox, oy);
    ctx.setTransform(lw / W, 0, 0, lh / H, ox, oy); ctx.imageSmoothingEnabled = false;
    const now = performance.now(), zw = L.zw, ft = L.floorTop, lerp = (a, b) => a + (b - a) * al;

    // láva (animált) – a tárgyak mögött, felette áttetsző réteg
    for (let x = L.mx0; x < L.mx1; x += 2 * U) {
      const t = L.lavaTop + Math.sin(now / 400 + x * .08) * U * 1.4, h = ft - t;
      R(x, t, 2 * U, h, '#ff4a1a'); R(x, t + h * .55, 2 * U, h, '#c02a10'); R(x, t, 2 * U, 1.2 * U, '#ffd23f'); R(x, t + 1.2 * U, 2 * U, U, '#ff9a1f');
    }
    if (Math.random() < .25) P(rnd(L.mx0, L.mx1), L.lavaTop, rnd(-10, 10), -rnd(30, 90), rnd(.6, 1.2), '#ffb347', { g: 40 });

    drawBelts(now); drawFlames(now);

    // hidraulikus dugattyú + jelzőlámpák (interpolált helyzet)
    const p = plate, rx = zw / 2, rw = q(zw * .12), phh = p.bounds.max.y - p.bounds.min.y;
    const py = lerp(p.py == null ? p.position.y : p.py, p.position.y) - phh / 2;
    R(rx - rw / 2, L.cylB, rw, py - L.cylB + U, '#9aa0b8'); R(rx - rw / 2, L.cylB, U, py - L.cylB, '#d6dbef'); R(rx + rw / 2 - U, L.cylB, U, py - L.cylB, '#5a5f78');
    R(rx - rw / 2 - U, L.cylB, rw + 2 * U, 2 * U, '#2c2540');
    const phs = p.pp.ph, vmx = Math.min(16 * S, (3 + .45 * st.press) * S);
    R(L.hx + 3 * U, L.hy + 4 * U, 10 * U, 4 * U, '#0e0b14');
    R(L.hx + 4 * U, L.hy + 5 * U, 2 * U, 2 * U, phs === 'wait' ? '#3cff3c' : '#1d4a1d');
    R(L.hx + 7 * U, L.hy + 5 * U, 2 * U, 2 * U, phs === 'up' ? '#ffe03c' : '#4a4a1d');
    R(L.hx + 10 * U, L.hy + 5 * U, 2 * U, 2 * U, (phs === 'down' || phs === 'hold') ? '#ff3c3c' : '#4a1d1d');
    const gT = phs === 'hold' ? 1 : phs === 'down' ? p.pp.v / vmx * .8 : phs === 'up' ? .3 : 0; gP += (gT - gP) * Math.min(1, dt * 8);
    const gcx = L.hx + L.hw - 7 * U, gcy = L.hy + 9 * U, gr = 4 * U, na = -2.4 + gP * 3.6 + (phs === 'hold' ? Math.sin(now / 40) * .06 : 0);
    ctx.beginPath(); ctx.arc(gcx, gcy, gr, 0, 7); ctx.fillStyle = '#e8e0f5'; ctx.fill(); ctx.lineWidth = U; ctx.strokeStyle = '#0a0810'; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(gcx, gcy); ctx.lineTo(gcx + Math.cos(na) * gr * .8, gcy + Math.sin(na) * gr * .8); ctx.strokeStyle = '#d02020'; ctx.lineWidth = U * .8; ctx.stroke();
    const pw = zw - 26, px = p.position.x - pw / 2;
    for (const rx of [L.rodL, L.rodR]) { R(rx, 11 * U, 2 * U, py - 11 * U + U, '#9aa0b8'); R(rx, 11 * U, U, py - 11 * U, '#d6dbef'); } // oldalsó dugattyúk
    R(px, py, pw, phh, PCOL[tier('press')]); R(px, py, pw, U, '#a8aec8'); R(px, py + phh - U, pw, U, '#2a2c3c');
    for (let x = px + 2 * U; x < px + pw - 3 * U; x += 5 * U) { R(x, py + phh, 3 * U, U, '#d8dcee'); R(x + U, py + phh + U, U, 2 * U, '#d8dcee'); } // acélfogak a lemez alatt
    hazard(px + 4 * U, py + phh - 4 * U, pw - 8 * U, 2 * U);
    for (let x = px + 2 * U; x < px + pw - 2 * U; x += 12 * U) R(x, py + 2 * U, U, U, '#c8cce0');

    // daráló: hátsó lendkerék és világító szemek
    { const cx = L.gcx, cy = L.y0 + (L.floorTop - L.y0) * .42, rr = L.zw * .17, load = snd.load;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(now / 1000 * bladeSpeed() * 20 * .3);
      ctx.fillStyle = '#2e2e42'; ctx.strokeStyle = '#0a0810'; ctx.lineWidth = U;
      for (let k = 0; k < 12; k++) { ctx.save(); ctx.rotate(k * Math.PI / 6); ctx.fillRect(rr - U, -1.5 * U, 3 * U, 3 * U); ctx.restore(); }
      ctx.beginPath(); ctx.arc(0, 0, rr, 0, 7); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#1a1826'; ctx.beginPath(); ctx.arc(0, 0, rr * .55, 0, 7); ctx.fill();
      ctx.fillStyle = '#4a4a62'; for (let k = 0; k < 3; k++) { ctx.save(); ctx.rotate(k * 2.094); ctx.fillRect(-U, -rr * .55, 2 * U, rr * .55); ctx.restore(); } ctx.restore();
      const ey = L.y0 + 7 * U, glow = .5 + .5 * Math.sin(now / 300) + load;
      for (const ex of [cx - L.zw * .2, cx + L.zw * .2]) { ctx.fillStyle = `rgba(255,40,40,${Math.min(.5, .12 + .15 * glow)})`; ctx.fillRect(q(ex - 5 * U), q(ey - 3 * U), 10 * U, 7 * U); R(ex - 3 * U, ey - U, 6 * U, 2 * U, '#ff2a2a'); R(ex - U, ey - U, 2 * U, 2 * U, '#ffd0c0'); }
    }

    // daráló rotorok mozgás-elmosással
    rotors.forEach(r => { const ang = lerp(r.pa == null ? r.angle : r.pa, r.angle); drawRotor(r, ang - r.dir * .16, .25); drawRotor(r, ang - r.dir * .08, .35); drawRotor(r, ang, 1); });

    // tárgyak
    for (const b of items) {
      b.flash = Math.max(0, b.flash - dt);
      const x = lerp(b.px, b.position.x), y = lerp(b.py, b.position.y), a = lerp(b.pa, b.angle);
      drawItem(b, x, y, a, now);
      if (b.hp < b.maxHp) { // életerő-csík
        const w = Math.max(8 * U, b.dw * .8), bx = x - w / 2, by = b.bounds.min.y + (y - b.position.y) - 5 * U, k = Math.max(0, b.hp / b.maxHp);
        R(bx - U, by - U, w + 2 * U, 3 * U, '#0a0810'); R(bx, by, w * k, U, k > .5 ? '#6fe06f' : k > .25 ? '#ffd23f' : '#ff4a3a');
      }
    }
    // olvasztó: áttetsző láva a tárgyak előtt (elmerülés)
    ctx.fillStyle = 'rgba(255,80,20,.35)'; ctx.fillRect(q(L.mx0), q(L.lavaTop + 2 * U), q(L.mx1 - L.mx0), ft - L.lavaTop - 2 * U);

    // részecskék
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i]; s.t -= dt; if (s.t <= 0) { sparks.splice(i, 1); continue; }
      s.vy += s.g * dt; s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.k === 'd') { const sz = U * (s.sz + (1 - s.t / s.t0) * s.grow); ctx.globalAlpha = Math.min(.6, s.t / s.t0 * .9); R(s.x - sz / 2, s.y - sz / 2, sz, sz, s.c); ctx.globalAlpha = 1; }
      else R(s.x, s.y, U * s.sz, U * s.sz, s.c);
    }

    beacon(L.zw - 4 - 2.5 * U, 6.5 * U, plate.pp.ph === 'down' || plate.pp.ph === 'hold', '#ff3030', now);
    beacon(2 * L.zw - 12 * U, L.y0 - 6 * U, snd.load > .3, '#ffa020', now);
    beacon(L.mx1 - 6 * U, L.my - 6 * U, snd.meltN > 0, '#ff5020', now);

    // nevek: egérrel/ujjal érintett, húzott, újonnan létrehozott (vagy mindig, ha be van kapcsolva és kevés a tárgy)
    for (const b of items) {
      if (b.gen > 0) continue;
      const show = (drag && drag.b === b) || hover === b || now < b.labelT || (st.names && items.length <= 30);
      if (show) textBox(b.name, b.position.x, b.bounds.min.y - 13 * U, (drag && drag.b === b) || hover === b ? '#ffb11a' : '#6b4fa0');
    }
    const sel = drag ? drag.b : hover; // infósor: név · érték · életerő
    if (sel && sel.alive) textBox(`${sel.name} · ${fmt(sel.value)} · ${Math.max(0, Math.ceil(sel.hp))}/${Math.ceil(sel.maxHp)} HP`, W / 2, 24 * U, '#ffb11a');

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
    render(dt / 1000, paused ? 1 : Math.min(1, acc / (1000 / 60))); audioTick(dt / 1000); requestAnimationFrame(frame);
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
  const fillItems = () => { selItem.innerHTML = ''; CATS[selCat.value].forEach((d, i) => selItem.add(new Option(`${d.e} ${d.n} (${fmt(d.v)})`, i))); };
  selCat.onchange = fillItems; fillItems();
  $('btnMake').onclick = () => { spawn(CATS[selCat.value][selItem.value]); beep(440, .06, 'triangle'); };
  const menu = $('menu');
  $('btnMenu').onclick = () => { menu.classList.remove('hide'); paused = true; };
  $('btnPlay').onclick = () => { menu.classList.add('hide'); paused = false; audioInit(); };
  $('chkNames').checked = st.names; $('chkNames').onchange = e => { st.names = e.target.checked; save(); };
  $('chkSfx').checked = st.sfx; $('chkSfx').onchange = e => { st.sfx = e.target.checked; save(); };
  $('btnReset').onclick = () => { if (confirm('Biztosan törlöd a pénzt és a fejlesztéseket?')) { st.money = 0; st.press = st.grind = st.melt = 1; save(); ui(); } };
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

