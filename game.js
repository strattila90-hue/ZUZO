/* Zúzó – három külön gép-kártya: PRÉS, DARÁLÓ, OLVASZTÓ (mindegyik saját fizikai világ). Tárgykatalógus: items.js */
'use strict';
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

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
  const KINDS = ['press', 'grind', 'melt'];

  // ---------- MENTÉS ----------
  const SAVE = 'zuzo_save_v1';
  let st = { money: 0, press: 1, grind: 1, melt: 1, sfx: true, names: true, card: 'press' };
  try { Object.assign(st, JSON.parse(localStorage.getItem(SAVE) || '{}')); } catch (e) {}
  if (!KINDS.includes(st.card)) st.card = 'press';
  let saveT = 0;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(SAVE, JSON.stringify(st)); } catch (e) {} }, 400); };

  // ---------- GAZDASÁG: gépenként külön fejleszthető ----------
  const LV = { press: { base: 200, name: 'PRÉS', icon: '🔨' }, grind: { base: 260, name: 'DARÁLÓ', icon: '⚙️' }, melt: { base: 320, name: 'OLVASZTÓ', icon: '🔥' } };
  const pressDps = () => 45 * Math.pow(1.3, st.press - 1);
  const bladeDps = () => 380 * Math.pow(1.28, st.grind - 1);
  const bladeSpeed = () => Math.min(.24, .11 + .006 * (st.grind - 1));
  const meltRate = () => .12 * Math.pow(1.25, st.melt - 1);
  const meltMult = () => 2.5 + .1 * (st.melt - 1);
  const multOf = k => k === 'melt' ? meltMult() : MULT[k];
  const costOf = k => Math.round(LV[k].base * Math.pow(1.6, st[k] - 1));
  const tier = k => Math.min(3, Math.floor((st[k] - 1) / 5)); // vizuális fokozat 5 szintenként
  const effText = k => k === 'press' ? `${Math.round(pressDps())} → ${Math.round(pressDps() * 1.3)} sebzés/mp`
    : k === 'grind' ? `${Math.round(bladeDps())} → ${Math.round(bladeDps() * 1.28)} sebzés/mp · gyorsabb forgás`
    : `×${meltMult().toFixed(1)} → ×${(meltMult() + .1).toFixed(1)} szorzó · gyorsabb olvadás`;

  // ---------- NÉZET ÉS KÁRTYÁK ----------
  let W = 0, H = 0, S = 1, U = 2, lw = 0, lh = 0, cc = ctx, paused = true;
  const scenes = {};
  let cur = st.card;
  function ui() {
    $('money').textContent = fmt(st.money);
    KINDS.forEach(k => { const t = $('tab_' + k); t.innerHTML = `${LV[k].icon} ${LV[k].name}<small>Sz.${st[k]}</small>`; t.classList.toggle('on', k === cur); });
    const c = costOf(cur), b = $('btnUp');
    b.innerHTML = `<b>⬆ ${LV[cur].name} fejlesztése</b> · Sz.${st[cur]} → ${st[cur] + 1} · ${fmt(c)}<br><small>${effText(cur)}</small>`;
    b.classList.toggle('off', st.money < c);
    KINDS.forEach(k => { const sc = scenes[k]; if (sc && lw && sc.lv !== st[k] && sc.L.ft) { sc.lv = st[k]; paintBg(sc); } }); // a tábla szintje újrarajzolódik
  }
  function setCard(k) {
    if (k === cur) return;
    scenes[cur].endDrag(); cur = k; st.card = k; save(); ui(); audioInit();
  }
  KINDS.forEach(k => { $('tab_' + k).onclick = () => setCard(k); });
  $('btnUp').onclick = () => {
    const c = costOf(cur);
    if (st.money < c) return toast('Nincs elég pénz');
    st.money -= c; st[cur]++; save(); ui(); audioInit();
    beep(520, .1, 'triangle'); setTimeout(() => beep(780, .14, 'triangle'), 90); noiseBurst(3200, .25, .05, 'highpass');
  };

  // ---------- SPRITE-OK: az emojikból pixelart ikon készül ----------
  const sprCache = new Map();
  function shade(h, f) {
    const n = parseInt(h.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255; const t = f < 0 ? 0 : 255, p = Math.abs(f);
    r = Math.round(r + (t - r) * p); g = Math.round(g + (t - g) * p); b = Math.round(b + (t - b) * p); return `rgb(${r},${g},${b})`;
  }
  function finishSprite(g) {
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
    x.drawImage(t, x0, y0, x1 - x0 + 1, y1 - y0 + 1, 1, 1, aw, ah);
    finishSprite(g); sprCache.set(key, g); return g;
  }
  function coinSprite(def, n) {
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
  function tinted(spr, col, key) {
    if (spr[key]) return spr[key];
    const g = document.createElement('canvas'); g.width = spr.width; g.height = spr.height; const x = g.getContext('2d');
    x.drawImage(spr, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = col; x.fillRect(0, 0, g.width, g.height); spr[key] = g; return g;
  }

  // ---------- PIXELART RAJZ-ESZKÖZÖK (minden világ-koordinátában, U-ra igazítva) ----------
  const q = v => Math.round(v / U) * U;
  const hs = (a, b) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };
  function R(x, y, w, h, col) { cc.fillStyle = col; const X = q(x), Y = q(y); cc.fillRect(X, Y, Math.max(U, q(x + w) - X), Math.max(U, q(y + h) - Y)); }
  function hazard(x, y, w, h) {
    const n = Math.round(w / U), rows = Math.round(h / U);
    for (let r = 0; r < rows; r++) for (let col = 0; col < n;) {
      const seg = Math.min(n - col, 4 - ((col + r) % 4)), on = ((col + r) >> 2) & 1;
      R(x + col * U, y + r * U, seg * U, U, on ? '#ffc21a' : '#1a1620'); col += seg;
    }
  }
  function steel(x, y, w, h) {
    R(x, y, w, h, '#3d3d4f'); R(x, y, U, h, '#6a6a80'); R(x + w - U, y, U, h, '#25252f'); R(x, y, w, U, '#6a6a80');
    for (let yy = y + 4 * U; yy < y + h - 2 * U; yy += 10 * U) { R(x + U, yy, U, U, '#a4a4bc'); R(x + w - 2 * U, yy, U, U, '#a4a4bc'); }
  }
  function label(txt, x, y, size, col) {
    cc.font = `bold ${size}px "Courier New",monospace`; cc.textAlign = 'center'; cc.textBaseline = 'middle';
    cc.fillStyle = '#000'; cc.fillText(txt, x + U, y + U); cc.fillStyle = col; cc.fillText(txt, x, y);
  }
  function gear(x, y, r, n, ang, col, hole) { // fogaskerék (a ctx-re rajzol)
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.fillStyle = col; ctx.strokeStyle = '#0a0810'; ctx.lineWidth = U;
    const tw = Math.max(2 * U, r * .26);
    for (let k = 0; k < n; k++) { ctx.save(); ctx.rotate(k * Math.PI * 2 / n); ctx.fillRect(r - U, -tw / 2, Math.max(2 * U, r * .3), tw); ctx.restore(); }
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#14111c'; ctx.beginPath(); ctx.arc(0, 0, r * (hole || .3), 0, 7); ctx.fill(); ctx.restore();
  }
  function sign(x, y) { // figyelmeztető háromszög
    for (let r = 0; r < 9; r++) R(x - r * U, y + r * U, (2 * r + 1) * U, U, '#ffc21a');
    R(x, y + 3 * U, U, 3 * U, '#14111c'); R(x, y + 7 * U, U, U, '#14111c');
  }
  const SKULL = ['01111110', '11111111', '11011011', '11011011', '11111111', '01111110', '00111100', '00101000'];
  function skull(x, y, bg, fg) { R(x - U, y - U, 10 * U, 10 * U, bg); SKULL.forEach((row, j) => { for (let i = 0; i < 8; i++) if (row[i] === '1') R(x + i * U, y + j * U, U, U, fg); }); }
  function pipeH(x0, x1, y, t) { if (x1 <= x0) return; R(x0, y, x1 - x0, t * U, '#2b2538'); R(x0, y, x1 - x0, U, '#4a4260'); }
  function pipeV(x, y0, y1, t) { if (y1 <= y0) return; R(x, y0, t * U, y1 - y0, '#2b2538'); R(x, y0, U, y1 - y0, '#4a4260'); }

  function drawItem(b, x, y, a, now) {
    const age = (now - b.born) / 1000, pop = age < .3 ? 1 + .2 * Math.sin(age / .3 * Math.PI) * (1 - age / .3) : 1;
    const sp = b.spr, cr = b.crop, sx = cr ? cr.x : 0, sy = cr ? cr.y : 0, sw = cr ? cr.w : sp.width, sh = cr ? cr.h : sp.height;
    const dw = cr ? b.dw : b.dw + 2 * U, dh = cr ? b.dh : b.dh + 2 * U;
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

  // ---------- EGY GÉP-KÁRTYA = EGY KÜLÖN FIZIKAI VILÁG ----------
  function makeScene(kind) {
    const engine = Engine.create({ positionIterations: 8, velocityIterations: 6 }), world = engine.world;
    const sc = { kind, engine, world, items: [], dead: [], sparks: [], pops: [], statics: [], belts: [], rotors: [], plate: null, L: {}, shake: 0, hover: null, drag: null,
      bg: document.createElement('canvas'), snd: { press: 0, dir: 1, hit: 0, meltN: 0, load: 0 }, gP: 0, lv: 0 };
    const { items, dead, sparks, pops, statics, belts, rotors, L, snd } = sc;
    const isCur = () => cur === kind;
    const antiGrav = b => { b.force.y -= b.mass * engine.gravity.y * engine.gravity.scale; };

    // részecskék (csak az aktív kártyán keletkeznek)
    const P = (x, y, vx, vy, t, c, o) => { if (!isCur() || sparks.length > 360) return; sparks.push(Object.assign({ x, y, vx, vy, t, t0: t, c, sz: 1, g: 600, k: 's', grow: 0 }, o)); };
    const burst = (x, y, n, c) => { for (let i = 0; i < n; i++) P(x, y, rnd(-190, 190), rnd(-240, 40), rnd(.3, .8), c || '#ffd24d'); };
    const chunks = (x, y, n, col) => { for (let i = 0; i < n; i++) P(x, y, rnd(-150, 150), rnd(-260, -40), rnd(.5, 1), shade(col, rnd(-.4, .2)), { sz: 2, k: 'c' }); };
    const puff = (x, y, n, col, up) => { for (let i = 0; i < n; i++) P(x + rnd(-8, 8), y, rnd(-40, 40), -rnd(10, 60) * (up || 1), rnd(.5, 1), col || '#8a8aa0', { sz: 2, grow: 6, g: -20, k: 'd' }); };
    sc.P = P; sc.burst = burst; sc.puff = puff;

    const add = (b, col, hide) => { b.col = col; b.hide = hide; statics.push(b); Composite.add(world, b); return b; };
    const mkBelt = (x0, x1, dir, top) => {
      const t = top == null ? L.ft - L.bh : top, b = Bodies.rectangle((x0 + x1) / 2, t + L.bh / 2, x1 - x0, L.bh, { isStatic: true, friction: 1 });
      b.zk = 'belt'; b.dir = dir; b.x0 = x0; b.x1 = x1; b.topY = t; add(b, '', true); belts.push(b);
    };
    const wall = (x1, y1, x2, y2, t) => {
      const len = Math.hypot(x2 - x1, y2 - y1), b = Bodies.rectangle((x1 + x2) / 2, (y1 + y2) / 2, len, t, { isStatic: true, friction: .1, angle: Math.atan2(y2 - y1, x2 - x1) });
      add(b, '', true);
    };

    // ----- a gép felépítése a kártya méretéhez -----
    sc.build = function () {
      statics.forEach(b => Composite.remove(world, b)); statics.length = 0; belts.length = 0; rotors.length = 0; sc.plate = null;
      const fh = Math.max(14, 18 * S), bh = Math.max(8, 5 * U), cw = 9 * U;
      for (const k in L) delete L[k];
      Object.assign(L, { fh, ft: H - fh, bh, cw, spawnTop: 15 * U });
      add(Bodies.rectangle(W / 2, H - fh / 2, W + 400, fh, { isStatic: true }), '#3a3f4a');
      add(Bodies.rectangle(cw - 100, H / 2, 200, H * 3, { isStatic: true }), '', true);
      add(Bodies.rectangle(W - cw + 100, H / 2, 200, H * 3, { isStatic: true }), '', true);
      if (kind === 'press') {
        L.rightWall = W * .75;
        add(Bodies.rectangle(L.rightWall + 100, H / 2, 200, H * 3, { isStatic: true }), '', true);
        const pw = W * .4, ph = Math.max(20, 28 * S);
        const plate = Bodies.rectangle(W / 2, H * .3, pw, ph, { density: 5, friction: .9, frictionAir: 0 });
        Body.setInertia(plate, Infinity);
        plate.zk = 'press'; plate.restY = H * .3; plate.botY = L.ft - bh - ph / 2 - 8 * S; plate.pp = { ph: 'wait', t: .4, v: 0 };
        statics.push(plate); Composite.add(world, plate); sc.plate = plate;
        Object.assign(L, { pw, ph, plL: W / 2 - pw / 2, plR: W / 2 + pw / 2, cylW: W * .26 });
        L.cylB = Math.min(plate.restY - ph / 2 - 4 * U, 13 * U + H * .17);
        L.rodL = L.plL + 5 * U; L.rodR = L.plR - 7 * U;
        mkBelt(cw + 4, W / 2, 1); mkBelt(W / 2, L.rightWall - 4, -1);
        L.maxW = Math.min(W * .3, (L.plL - cw) * .85); L.maxH = H * .3; L.spawnX = (cw + L.plL) / 2;
      } else if (kind === 'grind') {
        const r = Math.min(W * .15, H * .14), cy = L.ft - bh - r - 4;
        [[.32, 1], [.68, -1]].forEach(([fx, dir]) => {
          const cx = W * fx, bars = [0, 1, 2].map(i => Bodies.rectangle(cx, cy, 2 * r, Math.max(8, 9 * S), { angle: i * Math.PI / 3, density: 3 }));
          const rot = Body.create({ parts: bars, friction: .8, frictionAir: 0 });
          rot.zk = 'blade'; rot.dir = dir; rot.home = { x: cx, y: cy }; rot.r = r;
          statics.push(rot); rotors.push(rot); Composite.add(world, rot);
        });
        Object.assign(L, { r, cy, topY: H * .16, botY: cy - r - H * .06, xTL: cw + 4 * U, xTR: W - cw - 4 * U, xBL: W * .27, xBR: W * .73 });
        wall(L.xTL, L.topY, L.xBL, L.botY, 8); wall(L.xTR, L.topY, L.xBR, L.botY, 8);
        mkBelt(cw + 4, W / 2, 1); mkBelt(W / 2, W - cw - 4, -1);
        L.maxW = W * .28; L.maxH = H * .2; L.spawnX = W / 2;
      } else {
        Object.assign(L, { lavaTop: L.ft - H * .2, beltY: H * .28, beltEnd: W * .4 });
        mkBelt(cw + 2, L.beltEnd, 1, L.beltY);
        L.maxW = (L.beltEnd - cw) * .85; L.maxH = Math.min(H * .18, L.beltY - 17 * U); L.spawnX = (cw + L.beltEnd) / 2 - 4 * U;
      }
      sc.lv = st[kind]; paintBg(sc);
    };

    // ----- tárgyak -----
    function tag(b, o) {
      Object.assign(b, { item: true, alive: true, hp: o.hp, maxHp: o.hp, value: o.v, gen: o.gen || 0, col: o.c, name: o.n || 'Töredék', spr: o.spr, crop: o.crop || null,
        solid: !!o.solid, dw: o.dw, dh: o.dh, area: o.area, sy: 1, dens: o.d, born: performance.now(), flash: 0, heat: 0, melting: false,
        px: b.position.x, py: b.position.y, pa: b.angle });
      items.push(b); Composite.add(world, b);
      return b;
    }
    sc.spawn = function (def) {
      const circ = def.shape === 'c';
      const a = circ ? 1 : Math.max(.7, Math.min(1.35, def.w / def.h)), area0 = circ ? Math.PI * def.r * def.r : def.w * def.h;
      const w0 = circ ? def.r * 2 : Math.sqrt(area0 * a), h0 = circ ? def.r * 2 : Math.sqrt(area0 / a);
      let k = Math.max(S, 13 * U / Math.min(w0, h0));
      k = Math.min(k, L.maxW / Math.max(w0, h0), L.maxH / h0);
      const dw = w0 * k, dh = h0 * k, x = L.spawnX + rnd(-4, 4), y = L.spawnTop + dh / 2;
      const opts = { density: def.d, friction: .5, restitution: .15, collisionFilter: { category: 2 } };
      const body = circ ? Bodies.circle(x, y, dw / 2, opts, 24) : Bodies.rectangle(x, y, dw, dh, Object.assign(opts, { chamfer: { radius: Math.min(dw, dh) * .1 } }));
      const aw = Math.max(6, Math.round(dw / U)), ah = Math.max(6, Math.round(dh / U));
      const spr = circ && /^\d+ Ft$/.test(def.n) ? coinSprite(def, aw) : emojiSprite(def, aw, ah);
      tag(body, { hp: def.hp, v: def.v, c: def.c, n: def.n, spr, d: def.d, dw, dh, area: circ ? Math.PI * (dw / 2) ** 2 : dw * dh });
      body.labelT = performance.now() + 2500;
      while (items.length > 110) { const f = items.find(i => i.gen > 0) || items[0]; kill(f, 'melt', true); }
    };
    function fragments(it) {
      if (it.gen >= 2) return;
      const size = Math.sqrt(it.area);
      if (size < 14 * S) return;
      const n = it.gen === 0 ? Math.max(3, Math.min(7, Math.round(size / (22 * S)))) : 3;
      const fs = Math.sqrt(it.area / n) * .85, sp = it.spr, pc = it.crop || { x: 0, y: 0, w: sp.width, h: sp.height };
      for (let i = 0; i < n; i++) {
        const w = fs * rnd(.7, 1.3), h = fs * rnd(.7, 1.3), cw = Math.max(3, Math.min(pc.w, Math.round(w / U))), ch = Math.max(3, Math.min(pc.h, Math.round(h / U)));
        let best = null, bf = -1;
        for (let t = 0; t < 6; t++) {
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
    function kill(it, how, silent) {
      if (!it.alive) return;
      it.alive = false; Composite.remove(world, it); items.splice(items.indexOf(it), 1);
      if (sc.drag && sc.drag.b === it) sc.endDrag();
      const pay = it.value * multOf(how);
      if (pay >= 1) { st.money += pay; save(); ui(); if (!silent && isCur()) pops.push({ x: it.position.x, y: it.position.y, t: 1, txt: '+' + Math.floor(pay).toLocaleString('hu-HU'), c: how === 'melt' ? '#ffb347' : '#ffe27a' }); }
      if (silent) return;
      burst(it.position.x, it.position.y, Math.min(24, 8 + Math.sqrt(it.area) / 6 | 0), how === 'melt' ? '#ff7a2a' : '#ffd24d');
      if (how !== 'melt') { chunks(it.position.x, it.position.y, Math.min(14, 4 + Math.sqrt(it.area) / 10 | 0), it.col); puff(it.position.x, it.position.y, 3, '#8a8aa0'); fragments(it); }
      else puff(it.position.x, it.position.y, 4, '#d8d8e8', 1.5);
      if (isCur()) beep(how === 'melt' ? 300 : 180 + Math.random() * 80, .12, how === 'melt' ? 'sine' : 'sawtooth');
    }
    function hurt(it, d, how) {
      if (!it.alive || it.hp <= 0) return;
      it.hp -= d;
      if (how === 'press') {
        const t = Math.max(.45, .5 + .5 * Math.max(0, it.hp) / it.maxHp);
        if (it.sy - t > .03) { Body.scale(it, 1, t / it.sy); it.sy = t; }
      }
      if (d > .3 && how !== 'melt') it.flash = .09;
      if (how === 'grind' && Math.random() < .5) burst(it.position.x, it.position.y, 3, '#fff3b0');
      else if (how === 'press' && Math.random() < .2) puff(it.position.x, it.bounds.max.y, 1, '#8a8aa0');
      if (it.hp <= 0) dead.push([it, how]);
    }

    // ----- gépek léptetése -----
    function stepTools() {
      for (const b of items) { b.px = b.position.x; b.py = b.position.y; b.pa = b.angle; }
      if (kind === 'press' && sc.plate) {
        const p = sc.plate, s = p.pp, vmax = Math.min(16 * S, (3 + .45 * st.press) * S), y = p.position.y;
        p.py = y; let vy = 0;
        if (s.ph === 'wait') { s.t -= 1 / 60; if (s.t <= 0) { s.ph = 'down'; s.v = 0; } }
        else if (s.ph === 'down') {
          s.v = Math.min(vmax, s.v + vmax * .09 + .15); vy = s.v;
          if (y + vy >= p.botY) { vy = p.botY - y; s.ph = 'hold'; s.t = .35; slam(vmax); }
        }
        else if (s.ph === 'hold') { s.t -= 1 / 60; if (s.t <= 0) { s.ph = 'up'; s.v = 0; } }
        else { s.v = Math.min(vmax * .7, s.v + vmax * .05 + .1); vy = -s.v; if (y + vy <= p.restY) { vy = p.restY - y; s.ph = 'wait'; s.t = .5; } }
        snd.press = s.ph === 'down' || s.ph === 'up' ? s.v / vmax : s.ph === 'hold' ? .3 : 0; snd.dir = s.ph === 'up' ? -1 : 1;
        Body.setVelocity(p, { x: 0, y: vy }); Body.setAngle(p, 0); Body.setAngularVelocity(p, 0);
        Body.setPosition(p, { x: W / 2, y: p.position.y }); antiGrav(p);
      }
      rotors.forEach(r => { r.pa = r.angle; Body.setPosition(r, r.home); Body.setVelocity(r, { x: 0, y: 0 }); Body.setAngularVelocity(r, r.dir * bladeSpeed()); antiGrav(r); });
    }
    function slam(vmax) {
      sc.shake = Math.max(sc.shake, Math.min(7, 2 + vmax * .35));
      puff(L.plL + 6, L.ft - L.bh, 5, '#8a8aa0'); puff(L.plR - 6, L.ft - L.bh, 5, '#8a8aa0');
      puff(L.plL + 8, sc.plate.position.y, 3, '#e8ecf5', 1.6); puff(L.plR - 8, sc.plate.position.y, 3, '#e8ecf5', 1.6);
      if (isCur()) { beep(62, .22, 'sine', .12); noiseBurst(3000, .45, .07, 'highpass'); noiseBurst(220, .28, .12, 'lowpass'); }
    }
    function carry(it, belt) {
      const sp = 1.1 * S * belt.dir;
      Body.setVelocity(it, { x: it.velocity.x + (sp - it.velocity.x) * .15, y: it.velocity.y });
      if (it.circleRadius) Body.setAngularVelocity(it, it.velocity.x / it.circleRadius);
    }
    function pairs(list, start) {
      for (const pr of list) {
        const A = pr.bodyA.parent, B = pr.bodyB.parent;
        if (A.item && B.item) {
          if (start) { const rel = Vector.magnitude(Vector.sub(A.velocity, B.velocity)); if (rel > 10) { const d = (rel - 10) * Math.min(A.mass, B.mass) * 1.2; hurt(A, d, 'impact'); hurt(B, d, 'impact'); } }
          continue;
        }
        const it = A.item ? A : B.item ? B : null, tool = it === A ? B : A;
        if (!it) continue;
        if (tool.zk === 'press') { const ph = sc.plate.pp.ph; if (ph === 'down' || ph === 'hold') hurt(it, pressDps() / 60 * (start ? 3 : 1), 'press'); }
        else if (tool.zk === 'blade') { hurt(it, bladeDps() / 60, 'grind'); snd.hit++; }
        else {
          if (tool.zk === 'belt' && Math.abs(pr.collision.normal.y) > .6) carry(it, tool);
          if (start && it.speed > 9) hurt(it, (it.speed - 9) * it.mass * 1.5, 'impact');
        }
      }
    }
    Events.on(engine, 'beforeUpdate', stepTools);
    Events.on(engine, 'collisionStart', e => pairs(e.pairs, true));
    Events.on(engine, 'collisionActive', e => pairs(e.pairs, false));
    Events.on(engine, 'afterUpdate', () => {
      if (kind === 'melt') {
        snd.meltN = 0;
        for (const it of items) {
          it.melting = it.position.y > L.lavaTop;
          if (it.melting) {
            snd.meltN++; hurt(it, it.maxHp * meltRate() / 60 + .05, 'melt'); it.heat = 1 - Math.max(0, it.hp) / it.maxHp;
            if (Math.random() < .03) burst(it.position.x, it.position.y, 1, '#ff7a2a');
            if (Math.random() < .05) puff(it.position.x, it.bounds.min.y, 1, '#6a6a80', 1.2);
          }
        }
      }
      while (dead.length) { const [it, how] = dead.pop(); kill(it, how); }
    });

    // ----- húzás / érintés -----
    sc.down = (p, id) => {
      if (sc.drag) return false;
      const hit = Query.point(items, p); if (!hit.length) return false;
      const b = hit[hit.length - 1];
      const c = Constraint.create({ pointA: p, bodyB: b, pointB: Vector.rotate(Vector.sub(p, b.position), -b.angle), stiffness: Math.max(.04, .16 / (1 + b.mass / 25)), damping: .12, length: 0 });
      Composite.add(world, c); sc.drag = { c, b, id }; sc.hover = b; b.labelT = performance.now() + 2000; return true;
    };
    sc.move = (p, id) => {
      if (sc.drag) { if (id === sc.drag.id) sc.drag.c.pointA = p; }
      else { const h = Query.point(items, p); sc.hover = h.length ? h[h.length - 1] : null; }
    };
    sc.endDrag = () => { if (!sc.drag) return; Composite.remove(world, sc.drag.c); sc.drag = null; };
    sc.up = id => { if (sc.drag && id === sc.drag.id) sc.endDrag(); };
    sc.kill = kill;
    sc.step = () => Engine.update(engine, 1000 / 60);
    return sc;
  }

  // =====================================================================================
  //  STATIKUS HÁTTEREK (kártyánként egyszer rajzoljuk, átméretezéskor / szintlépéskor újra)
  // =====================================================================================
  const PAL = { press: ['#14111c', '#1c1827', '#221d30', '#181421'], grind: ['#17150f', '#221f18', '#2a261c', '#1b1912'], melt: ['#1c0b0b', '#2b1414', '#351a1a', '#210f0f'] };
  const TITLE = { press: ['HIDRAULIKUS PRÉS', '#7fb2ff'], grind: ['UNIVERZÁLIS DARÁLÓ', '#ffb15c'], melt: ['OLVASZTÓKEMENCE', '#ff6b5c'] };

  function paintBg(sc) {
    const g = sc.bg; g.width = lw; g.height = lh; cc = g.getContext('2d'); cc.setTransform(lw / W, 0, 0, lh / H, 0, 0);
    paintBase(sc); ({ press: paintPress, grind: paintGrind, melt: paintMelt })[sc.kind](sc);
    const t = TITLE[sc.kind], txt = `${t[0]}  Sz.${st[sc.kind]}` + (sc.kind === 'melt' ? `  ×${meltMult().toFixed(1).replace('.', ',')}` : '');
    const w = Math.min(W * .66, txt.length * 6 * U * .75 + 8 * U), x = W / 2 - w / 2, y = 2 * U, h = 9 * U;
    R(x, y, w, h, '#0e0b14'); R(x, y, w, U, t[1]); R(x, y + h - U, w, U, t[1]); R(x, y, U, h, t[1]); R(x + w - U, y, U, h, t[1]);
    label(txt, W / 2, y + h / 2 + U * .5, Math.min(7 * U, w / (txt.length * .65)), t[1]);
    cc = ctx;
  }
  function paintBase(sc) {
    const L = sc.L, ft = L.ft, pal = PAL[sc.kind];
    cc.fillStyle = pal[0]; cc.fillRect(0, 0, W + U, H + U);
    const bw = 10 * U, bh = 5 * U; // téglafal
    for (let y = 0, row = 0; y < ft; y += bh, row++) for (let x = -(row % 2) * bw / 2; x < W; x += bw) {
      const h = hs(x, y); R(x + U, y + U, bw - U, bh - U, h < .33 ? pal[1] : h < .66 ? pal[2] : pal[3]);
    }
    [.17, .5, .83].forEach(f => { R(W * f, 0, 3 * U, ft, '#2b2538'); R(W * f, 0, U, ft, '#3d3550'); });
    R(0, ft, W + U, L.fh + U, '#2e2b3a'); R(0, ft, W + U, U, '#6a6580'); // padló
    for (let x = 0; x < W; x += 14 * U) R(x, ft + 2 * U, U, L.fh, '#221f2c');
    hazard(0, H - 3 * U, W + U, 3 * U);
    [W * .22, W * .78].forEach(x => { // lógó lámpák fénykúppal
      R(x, 13 * U, U, 4 * U, '#6a6a80'); R(x - 5 * U, 17 * U, 10 * U, 3 * U, '#25252f'); R(x - 3 * U, 20 * U, 6 * U, 2 * U, '#ffe9a8');
      cc.fillStyle = 'rgba(255,230,160,.05)'; cc.beginPath(); cc.moveTo(x - 3 * U, 22 * U); cc.lineTo(x + 3 * U, 22 * U); cc.lineTo(x + 26 * U, 22 * U + H * .45); cc.lineTo(x - 26 * U, 22 * U + H * .45); cc.fill();
    });
  }
  function beamRivets() { for (let x = 8 * U; x < W - 8 * U; x += 14 * U) { R(x, 2 * U, U, U, '#a4a4bc'); R(x, 10 * U, U, U, '#a4a4bc'); } }

  function paintPress(sc) {
    const L = sc.L, ft = L.ft, cw = L.cw, hy = 13 * U;
    steel(0, 0, cw, ft); steel(W - cw, 0, cw, ft);
    R(cw, hy, U, ft - hy, '#3d3d4f'); R(W - cw - U, hy, U, ft - hy, '#3d3d4f');
    // jobb oldali gépterem: szivattyú, tartály, vezérlőpult
    const bx = L.rightWall + 2 * U, bw = W - cw - bx; Object.assign(L, { bx, bw, hy });
    R(bx, hy, bw, ft - hy, '#16131f'); R(bx, hy, U, ft - hy, '#3d3550');
    steel(0, 0, W, hy); beamRivets();
    // fő munkahenger
    const hx = W / 2 - L.cylW / 2, hb = L.cylB, cwd = L.cylW; Object.assign(L, { hx });
    R(hx, hy, cwd, hb - hy, '#4a3f66'); R(hx, hy, U, hb - hy, '#7b6aa8'); R(hx + cwd - U, hy, U, hb - hy, '#2c2540');
    for (let y = hy + 5 * U; y < hb - 3 * U; y += 6 * U) R(hx, y, cwd, U, '#352c4b');
    R(hx - 3 * U, hy, cwd + 6 * U, 4 * U, '#6a6a80'); R(hx - 3 * U, hy + 3 * U, cwd + 6 * U, U, '#25252f');
    for (let x = hx - U; x < hx + cwd + 2 * U; x += 6 * U) R(x, hy + U, U, U, '#c8cce0');
    R(hx - U, hb - 3 * U, cwd + 2 * U, 3 * U, '#25252f'); R(hx - U, hb - 3 * U, cwd + 2 * U, U, '#6a6a80');
    R(hx + cwd * .66, hy + 9 * U, 3 * U, 12 * U, '#0e0b14'); R(hx + cwd * .66 + U, hy + 13 * U, U, 7 * U, '#e0a020'); // olajszint-ablak
    // oldalsó munkahengerek, tömlők
    [L.rodL, L.rodR].forEach(x => { R(x - 3 * U, hy, 8 * U, 10 * U, '#4a3f66'); R(x - 3 * U, hy, U, 10 * U, '#7b6aa8'); R(x + 4 * U, hy, U, 10 * U, '#2c2540'); R(x - 3 * U, hy + 9 * U, 8 * U, U, '#25252f'); });
    pipeH(L.rodL + 5 * U, hx, hy + 5 * U, 2); pipeH(hx + cwd, L.rodR - 3 * U, hy + 5 * U, 2);
    pipeH(hx + cwd, bx + bw - 6 * U, hy + 16 * U, 2); pipeV(bx + bw - 6 * U, hy + 16 * U, ft - 30 * U, 2);
    // tartály + motor
    R(bx + 3 * U, ft - 30 * U, bw - 6 * U, 26 * U, '#3d3d4f'); R(bx + 3 * U, ft - 30 * U, U, 26 * U, '#6a6a80'); R(bx + bw - 4 * U, ft - 30 * U, U, 26 * U, '#25252f');
    R(bx + 6 * U, ft - 26 * U, 4 * U, 14 * U, '#0e0b14'); R(bx + 7 * U, ft - 20 * U, 2 * U, 7 * U, '#e0a020');
    R(bx + 3 * U, ft - 44 * U, bw - 6 * U, 13 * U, '#4a3f66'); R(bx + 3 * U, ft - 44 * U, bw - 6 * U, U, '#7b6aa8');
    Object.assign(L, { fanX: bx + bw / 2, fanY: ft - 38 * U });
    // vezérlőpult
    R(bx + 3 * U, hy + 6 * U, bw - 6 * U, 26 * U, '#262633'); R(bx + 3 * U, hy + 6 * U, bw - 6 * U, U, '#6a6a80');
    R(bx + 5 * U, hy + 8 * U, bw - 10 * U, 11 * U, '#0b1a0b'); Object.assign(L, { scrX: bx + bw / 2, scrY: hy + 13.5 * U });
    ['#ff3030', '#ffe03c', '#3cff3c'].forEach((c, i) => R(bx + 6 * U + i * 6 * U, hy + 23 * U, 4 * U, 4 * U, c));
    sign(bx + bw * .5, hy + 38 * U);
    // adagoló kapu (itt érkeznek a tárgyak)
    const gx0 = L.spawnX - (L.maxW / 2 + 3 * U), gx1 = L.spawnX + (L.maxW / 2 + 3 * U);
    R(gx0, hy, 2 * U, 7 * U, '#4a4a5e'); R(gx1 - 2 * U, hy, 2 * U, 7 * U, '#4a4a5e'); hazard(gx0, hy + 7 * U, gx1 - gx0, 2 * U);
  }

  function paintGrind(sc) {
    const L = sc.L, ft = L.ft, cw = L.cw, hy = 13 * U;
    steel(0, 0, cw, ft); steel(W - cw, 0, cw, ft); steel(0, 0, W, hy); beamRivets();
    R(cw, hy, W - 2 * cw, ft - hy, '#15121d'); for (let x = cw + 6 * U; x < W - cw - 6 * U; x += 6 * U) R(x, hy + U, U, ft - hy - U, '#1e1a29');
    for (let y = L.topY; y < L.botY; y += U) { // tölcsér oldalai + a mögötte lévő acéllemezek
      const t = (y - L.topY) / (L.botY - L.topY), xl = L.xTL + (L.xBL - L.xTL) * t, xr = L.xTR + (L.xBR - L.xTR) * t, row = ((y - L.topY) / U) | 0;
      R(cw, y, xl - cw - 2 * U, U, '#2a2a38'); R(xr + 2 * U, y, W - cw - xr - 2 * U, U, '#2a2a38');
      R(xl - 2 * U, y, 4 * U, U, '#4a4a5e'); R(xl - 2 * U, y, U, U, '#25252f'); R(xl + U, y, U, U, '#8a8aa4');
      R(xr - 2 * U, y, 4 * U, U, '#4a4a5e'); R(xr + U, y, U, U, '#25252f'); R(xr - 2 * U, y, U, U, '#8a8aa4');
      if (row % 8 === 0) { R(xl + 2 * U, y, 3 * U, U, '#e8e8f0'); R(xl + 2 * U, y + U, 2 * U, U, '#e8e8f0'); R(xr - 4 * U, y, 3 * U, U, '#e8e8f0'); R(xr - 3 * U, y + U, 2 * U, U, '#e8e8f0'); }
    }
    hazard(cw, L.topY - 3 * U, W - 2 * cw, 3 * U);
    for (let x = L.xTL + 10 * U; x < L.xTR - 10 * U; x += 8 * U) { R(x, L.topY, 3 * U, 2 * U, '#e8e8f0'); R(x + U, L.topY + 2 * U, U, 3 * U, '#e8e8f0'); } // fogsor
    skull(cw + 6 * U, L.botY - 22 * U, '#3a0a0a', '#e8e0d0'); sign(W - cw - 14 * U, L.botY - 26 * U);
    // oldalsó gépek a rotorok mellett: motor (bal), hajtómű (jobb)
    const lAv = W * .32 - L.r - cw, rAv = W - cw - (W * .68 + L.r); L.motor = null; L.gb = null;
    if (lAv > 14 * U) { const mx0 = cw + 2 * U, mw = lAv - 4 * U, my0 = L.cy - 9 * U; R(mx0, my0, mw, 18 * U, '#3a3a4e'); R(mx0, my0, mw, U, '#6a6a80');
      for (let x = mx0 + 3 * U; x < mx0 + mw - 6 * U; x += 3 * U) R(x, my0 + U, U, 16 * U, '#25252f');
      R(mx0 + mw - 3 * U, my0 + 2 * U, 3 * U, 14 * U, '#6a6a80'); L.motor = { x: mx0 + mw - 6 * U, y: L.cy, r: 6 * U }; }
    if (rAv > 14 * U) { const gx0 = W - cw - rAv + 2 * U, gw = rAv - 4 * U, gy0 = L.cy - 22 * U; R(gx0, gy0, gw, 44 * U, '#3d3d4f'); R(gx0, gy0, gw, U, '#6a6a80'); R(gx0 + 2 * U, gy0 + 2 * U, gw - 4 * U, 40 * U, '#14111c');
      L.gb = { x: gx0 + gw / 2, y: gy0 + 12 * U, y2: gy0 + 28 * U, r1: Math.min(10 * U, gw / 2 - 3 * U), r2: Math.min(7 * U, gw / 2 - 4 * U) }; }
  }

  function paintMelt(sc) {
    const L = sc.L, ft = L.ft, cw = L.cw, hy = 13 * U;
    steel(0, 0, cw, ft); steel(W - cw, 0, cw, ft); steel(0, 0, W, hy); beamRivets();
    // kemence-száj: boltíves, sötét nyílás
    const ax = W * .64, ar = Math.min(W * .22, L.lavaTop - hy - 10 * U), ay = L.lavaTop; Object.assign(L, { ax, ar, ay });
    for (let y = ay - ar * 1.2; y < ay; y += U) {
      const dy = y - (ay - ar), hw = dy < 0 ? Math.sqrt(Math.max(0, ar * ar - dy * dy)) : ar;
      R(ax - hw - 2 * U, y, 2 * U, U, '#6a6a80'); R(ax + hw, y, 2 * U, U, '#6a6a80'); R(ax - hw, y, 2 * hw, U, '#120707');
    }
    R(cw, hy, W - 2 * cw, 4 * U, '#4a4a5e'); hazard(cw, hy + 4 * U, W - 2 * cw, 2 * U); // elszívó-búra
    R(cw, hy + 8 * U, W - 2 * cw, 2 * U, '#6a6a80'); R(cw, hy + 8 * U, W - 2 * cw, U, '#a4a4bc'); // daru-sín
    steel(cw + 6 * U, L.beltY + L.bh, 4 * U, ft - L.beltY - L.bh); steel(L.beltEnd - 8 * U, L.beltY + L.bh, 4 * U, ft - L.beltY - L.bh);
    skull(cw + 12 * U, L.beltY + L.bh + 14 * U, '#3a0a0a', '#e8e0d0'); sign(W - cw - 12 * U, hy + 20 * U);
    pipeV(W - cw - 6 * U, hy + 6 * U, L.lavaTop - 14 * U, 2); pipeH(W - cw - 24 * U, W - cw - 4 * U, L.lavaTop - 14 * U, 2);
    R(W - cw - 26 * U, hy + 40 * U, 10 * U, 10 * U, '#e8e0f5'); R(W - cw - 26 * U, hy + 40 * U, 10 * U, U, '#0a0810'); R(W - cw - 26 * U, hy + 49 * U, 10 * U, U, '#0a0810'); R(W - cw - 22 * U, hy + 42 * U, 2 * U, 4 * U, '#d02020'); // mérő
  }

  // =====================================================================================
  //  DINAMIKUS RAJZ (kártyánként: háttérrész, előtér)
  // =====================================================================================
  const PCOL = ['#6a6f88', '#8a6a6a', '#a04a4a', '#c03030'], RCOL = ['#8a90a8', '#a89080', '#c07050', '#e05030'];
  function drawBelts(sc, now) {
    const bh = sc.L.bh;
    for (const b of sc.belts) {
      const w = b.x1 - b.x0, y = b.topY, step = 6 * U, off = (((now / 1000) * 66 * S * b.dir) % step + step) % step;
      R(b.x0, y, w, bh, '#1c1a24'); R(b.x0, y + bh - U, w, U, '#0e0b14');
      for (let x = b.x0 - step + off; x < b.x1; x += step) { const xx = Math.max(x, b.x0), ww = Math.min(x + 5 * U, b.x1) - xx; if (ww > 0) { R(xx, y, ww, 2 * U, '#5a5a70'); R(xx, y, ww, U, '#8a8aa4'); } }
      for (const rx of [b.x0 + bh / 2, b.x1 - bh / 2]) {
        ctx.save(); ctx.translate(rx, y + bh / 2); ctx.rotate(now / 160 * b.dir);
        ctx.beginPath(); ctx.arc(0, 0, bh / 2, 0, 7); ctx.fillStyle = '#8a8aa4'; ctx.fill(); ctx.lineWidth = U; ctx.strokeStyle = '#0a0810'; ctx.stroke();
        ctx.fillStyle = '#0a0810'; ctx.fillRect(-bh / 2 + U, -U / 2, bh - 2 * U, U); ctx.restore();
      }
    }
  }
  function drawRotor(r, ang, alpha) {
    const bt = Math.max(8, 9 * S);
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(r.home.x, r.home.y); ctx.rotate(ang);
    for (let i = 0; i < 3; i++) {
      ctx.save(); ctx.rotate(i * Math.PI / 3);
      ctx.fillStyle = '#0a0810'; ctx.fillRect(-r.r - U, -bt / 2 - 2 * U, 2 * r.r + 2 * U, bt + 4 * U);
      ctx.fillStyle = RCOL[tier('grind')]; ctx.fillRect(-r.r, -bt / 2, 2 * r.r, bt);
      ctx.fillStyle = '#c4c9de'; ctx.fillRect(-r.r, -bt / 2, 2 * r.r, U);
      ctx.fillStyle = '#e8ecf5';
      for (const s of [-1, 1]) for (const k of [.35, .6, .85, 1]) { const tx = s * r.r * k - 1.5 * U; ctx.fillRect(tx, -bt / 2 - 2.5 * U, 3 * U, 2.5 * U); ctx.fillRect(tx, bt / 2, 3 * U, 2.5 * U); }
      ctx.restore();
    }
    if (alpha === 1) { gear(0, 0, r.r * .32, 8, 0, '#3a3d52', .35); ctx.fillStyle = '#ff9f1c'; ctx.beginPath(); ctx.arc(0, 0, r.r * .1, 0, 7); ctx.fill(); }
    ctx.restore();
  }
  function beacon(x, y, on, col, now) {
    const f = on ? Math.sin(now / 70) > 0 : Math.sin(now / 350) > .75;
    R(x - 2 * U, y - 2 * U, 4 * U, 4 * U, f ? col : '#3a1010'); R(x - 2 * U, y - 2 * U, 4 * U, U, f ? '#fff' : '#5a2020');
    if (f) { ctx.fillStyle = col + '44'; ctx.beginPath(); ctx.arc(x, y, 8 * U, 0, 7); ctx.fill(); }
  }

  const DRAW = {
    press: {
      back(sc, dt, al, now, lerp) {
        const L = sc.L, p = sc.plate, s = sc.snd; drawBelts(sc, now);
        const py = lerp(p.py == null ? p.position.y : p.py, p.position.y) - L.ph / 2, rw = q(W * .07), rx = W / 2, hy = L.hy;
        R(rx - rw / 2, L.cylB, rw, py - L.cylB + U, '#9aa0b8'); R(rx - rw / 2, L.cylB, U, py - L.cylB, '#d6dbef'); R(rx + rw / 2 - U, L.cylB, U, py - L.cylB, '#5a5f78');
        for (const x of [L.rodL, L.rodR]) { R(x, hy + 10 * U, 2 * U, py - hy - 10 * U + U, '#9aa0b8'); R(x, hy + 10 * U, U, py - hy - 10 * U, '#d6dbef'); }
        R(rx - rw / 2 - U, L.cylB, rw + 2 * U, 2 * U, '#2c2540');
        // olajimpulzusok a nyomócsőben
        const y = hy + 16 * U, x0 = L.hx + L.cylW, x1 = L.bx + L.bw - 6 * U, ph = (now / 1000) * 40 * (.3 + s.press * 2) * (s.dir > 0 ? -1 : 1);
        for (let x = x0 + ((ph % (12 * U)) + 12 * U) % (12 * U); x < x1; x += 12 * U) R(x, y, 2 * U, 2 * U, '#e0a020');
        // lámpák + nyomásmérő a henger előlapján
        const phs = p.pp.ph, vmx = Math.min(16 * S, (3 + .45 * st.press) * S), lx = L.hx + 4 * U, ly = hy + 8 * U;
        R(lx - U, ly - U, 12 * U, 4 * U, '#0e0b14');
        R(lx, ly, 2 * U, 2 * U, phs === 'wait' ? '#3cff3c' : '#1d4a1d'); R(lx + 4 * U, ly, 2 * U, 2 * U, phs === 'up' ? '#ffe03c' : '#4a4a1d'); R(lx + 8 * U, ly, 2 * U, 2 * U, (phs === 'down' || phs === 'hold') ? '#ff3c3c' : '#4a1d1d');
        const gT = phs === 'hold' ? 1 : phs === 'down' ? p.pp.v / vmx * .8 : phs === 'up' ? .3 : 0; sc.gP += (gT - sc.gP) * Math.min(1, dt * 8);
        const gx = L.hx + L.cylW / 2, gy = hy + 27 * U, gr = 6 * U, na = -2.4 + sc.gP * 3.6 + (phs === 'hold' ? Math.sin(now / 40) * .06 : 0);
        ctx.beginPath(); ctx.arc(gx, gy, gr, 0, 7); ctx.fillStyle = '#e8e0f5'; ctx.fill(); ctx.lineWidth = U; ctx.strokeStyle = '#0a0810'; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + Math.cos(na) * gr * .8, gy + Math.sin(na) * gr * .8); ctx.strokeStyle = '#d02020'; ctx.lineWidth = U * .8; ctx.stroke();
        // gépterem: kijelző + ventilátor
        label(`${Math.round(sc.gP * 250)} BAR`, L.scrX, L.scrY, Math.min(5 * U, (L.bw - 12 * U) / 6), '#3cff3c');
        ctx.save(); ctx.translate(L.fanX, L.fanY); ctx.rotate(now / 60 * (.3 + s.press * 2));
        ctx.fillStyle = '#c8cce0'; for (let k = 0; k < 4; k++) { ctx.rotate(Math.PI / 2); ctx.fillRect(0, -U, 5 * U, 2 * U); } ctx.restore();
      },
      front(sc, dt, al, now, lerp) {
        const L = sc.L, p = sc.plate, py = lerp(p.py == null ? p.position.y : p.py, p.position.y) - L.ph / 2, px = L.plL, pw = L.pw;
        R(W / 2 - 8 * U, py - 4 * U, 16 * U, 4 * U, '#4a4a5e'); R(L.rodL - U, py - 3 * U, 4 * U, 3 * U, '#4a4a5e'); R(L.rodR - U, py - 3 * U, 4 * U, 3 * U, '#4a4a5e');
        R(px, py, pw, L.ph, PCOL[tier('press')]); R(px, py, pw, U, '#a8aec8'); R(px, py + L.ph - U, pw, U, '#2a2c3c');
        hazard(px + 4 * U, py + L.ph - 4 * U, pw - 8 * U, 2 * U);
        for (let x = px + 2 * U; x < px + pw - 2 * U; x += 10 * U) { R(x, py + 2 * U, U, U, '#c8cce0'); R(x, py + L.ph - 6 * U, U, U, '#c8cce0'); }
        for (let x = px + 2 * U; x < px + pw - 3 * U; x += 5 * U) { R(x, py + L.ph, 3 * U, U, '#d8dcee'); R(x + U, py + L.ph + U, U, 2 * U, '#d8dcee'); } // acélfogak
        R(px - 2 * U, py, 2 * U, L.ph, '#6a6a80'); R(px + pw, py, 2 * U, L.ph, '#6a6a80'); // vezetősaruk
      }
    },
    grind: {
      back(sc, dt, al, now) {
        const L = sc.L, s = sc.snd; drawBelts(sc, now);
        const cx = W / 2, ey = L.topY + (L.botY - L.topY) * .45, glow = .5 + .5 * Math.sin(now / 300) + s.load;
        for (const ex of [cx - W * .12, cx + W * .12]) { // világító szemek
          ctx.fillStyle = `rgba(255,40,40,${Math.min(.5, .12 + .15 * glow)})`; ctx.fillRect(q(ex - 6 * U), q(ey - 4 * U), 12 * U, 8 * U);
          R(ex - 4 * U, ey - U, 8 * U, 2 * U, '#ff2a2a'); R(ex - U, ey - U, 2 * U, 2 * U, '#ffd0c0'); R(ex - 4 * U, ey - 2 * U, 3 * U, U, '#ff2a2a');
        }
        const sp = (.3 + s.load * 1.5) * bladeSpeed() * 20;
        if (L.motor) { ctx.save(); ctx.translate(L.motor.x, L.motor.y); ctx.rotate(now / 1000 * sp * 3); ctx.fillStyle = '#c8cce0'; for (let k = 0; k < 4; k++) { ctx.rotate(Math.PI / 2); ctx.fillRect(0, -U, L.motor.r, 2 * U); } ctx.restore(); }
        if (L.gb) { gear(L.gb.x, L.gb.y, L.gb.r1, 10, now / 1000 * sp, '#8a90a8', .3); gear(L.gb.x, L.gb.y2, L.gb.r2, 8, -now / 1000 * sp * L.gb.r1 / L.gb.r2, '#a89080', .3); }
      },
      front(sc, dt, al, now, lerp) {
        sc.rotors.forEach(r => { const ang = lerp(r.pa == null ? r.angle : r.pa, r.angle); drawRotor(r, ang - r.dir * .16, .25); drawRotor(r, ang - r.dir * .08, .35); drawRotor(r, ang, 1); });
      }
    },
    melt: {
      back(sc, dt, al, now) {
        const L = sc.L, ft = L.ft; drawBelts(sc, now);
        // kemence-száj izzása
        const g = ctx.createLinearGradient(0, L.ay, 0, L.ay - L.ar * 1.2); g.addColorStop(0, 'rgba(255,100,20,.55)'); g.addColorStop(1, 'rgba(255,60,10,0)');
        ctx.fillStyle = g; ctx.fillRect(q(L.ax - L.ar), q(L.ay - L.ar * 1.2), q(L.ar * 2), q(L.ar * 1.2));
        // daru: csille, lánc, merítőkanál
        const tx = W * .5 + Math.sin(now / 3200) * W * .28, rail = 13 * U + 10 * U, len = H * .1 + Math.sin(now / 1500) * H * .03;
        R(tx - 6 * U, rail - 2 * U, 12 * U, 4 * U, '#4a4a5e'); R(tx - 6 * U, rail - 2 * U, 12 * U, U, '#a4a4bc');
        for (let y = rail + 2 * U; y < rail + len; y += 2 * U) R(tx, y, U, U, (y / U) % 4 ? '#8a8aa0' : '#4a4a5e');
        R(tx - 6 * U, rail + len, 12 * U, 6 * U, '#4a4a5e'); R(tx - 6 * U, rail + len, 12 * U, U, '#8a8aa4'); R(tx - 5 * U, rail + len + U, 10 * U, U, '#ff7a1a');
        // láva
        for (let x = L.cw; x < W - L.cw; x += 2 * U) {
          const t = L.lavaTop + Math.sin(now / 400 + x * .08) * U * 1.4, h = ft - t;
          R(x, t, 2 * U, h, '#ff4a1a'); R(x, t + h * .55, 2 * U, h, '#c02a10'); R(x, t, 2 * U, 1.2 * U, '#ffd23f'); R(x, t + 1.2 * U, 2 * U, U, '#ff9a1f');
        }
        if (Math.random() < .35) sc.P(rnd(L.cw, W - L.cw), L.lavaTop, rnd(-10, 10), -rnd(30, 90), rnd(.6, 1.2), '#ffb347', { g: 40 });
        if (Math.random() < .12) sc.puff(rnd(L.cw, W - L.cw), L.lavaTop - 4, 1, '#7a7a90', 1.8);
      },
      front(sc, dt, al, now) {
        const L = sc.L, ft = L.ft;
        ctx.fillStyle = 'rgba(255,80,20,.35)'; ctx.fillRect(q(L.cw), q(L.lavaTop + 2 * U), q(W - 2 * L.cw), ft - L.lavaTop - 2 * U);
        // lángszórók a falakból
        const jets = [[L.cw, 1, ft - H * .30, 0], [W - L.cw, -1, ft - H * .22, 1.4], [L.cw, 1, ft - H * .16, 2.6], [W - L.cw, -1, ft - H * .36, 3.3]];
        const maxLen = W * (.2 + .015 * Math.min(10, st.melt));
        for (const [x, dir, y, ph0] of jets) {
          const ph = ((now / 1000) + ph0) % 4.5; if (ph > 1.3 || y < L.beltY + 20 * U && x < L.beltEnd) continue;
          const len = maxLen * Math.sin(ph / 1.3 * Math.PI);
          for (let i = 0; i < len; i += U) { const f = i / maxLen, hgt = (4 * (1 - f * .7) + Math.random() * 2) * U; R(x + dir * i, y - hgt / 2, U, hgt, f < .25 ? '#ffe27a' : f < .55 ? '#ff9a1f' : '#e03a14'); }
          if (Math.random() < .3) sc.P(x + dir * len, y, dir * rnd(20, 60), -rnd(20, 60), rnd(.3, .6), '#ffb347', { g: 40 });
        }
        // izzás (additív)
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createLinearGradient(0, L.lavaTop, 0, L.lavaTop - H * .3); g.addColorStop(0, 'rgba(255,90,20,.28)'); g.addColorStop(1, 'rgba(255,90,20,0)');
        ctx.fillStyle = g; ctx.fillRect(0, q(L.lavaTop - H * .3), W, q(H * .3)); ctx.globalCompositeOperation = 'source-over';
      }
    }
  };

  function renderScene(sc, dt, al) {
    const L = sc.L; if (!lw || !L.ft) return;
    cc = ctx; sc.shake *= Math.exp(-dt * 9); if (sc.shake < .05) sc.shake = 0;
    const sh = sc.shake + (sc.kind === 'grind' ? sc.snd.load * .7 : 0), ox = Math.round(rnd(-1, 1) * sh), oy = Math.round(rnd(-1, 1) * sh);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#14111c'; ctx.fillRect(0, 0, lw, lh); ctx.drawImage(sc.bg, ox, oy);
    ctx.setTransform(lw / W, 0, 0, lh / H, ox, oy); ctx.imageSmoothingEnabled = false;
    const now = performance.now(), lerp = (a, b) => a + (b - a) * al, D = DRAW[sc.kind], { items, sparks, pops } = sc;

    D.back(sc, dt, al, now, lerp);
    for (const b of items) {
      b.flash = Math.max(0, b.flash - dt);
      const x = lerp(b.px, b.position.x), y = lerp(b.py, b.position.y), a = lerp(b.pa, b.angle);
      drawItem(b, x, y, a, now);
      if (b.hp < b.maxHp) {
        const w = Math.max(8 * U, b.dw * .8), bx = x - w / 2, by = b.bounds.min.y + (y - b.position.y) - 5 * U, k = Math.max(0, b.hp / b.maxHp);
        R(bx - U, by - U, w + 2 * U, 3 * U, '#0a0810'); R(bx, by, w * k, U, k > .5 ? '#6fe06f' : k > .25 ? '#ffd23f' : '#ff4a3a');
      }
    }
    D.front(sc, dt, al, now, lerp);

    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i]; s.t -= dt; if (s.t <= 0) { sparks.splice(i, 1); continue; }
      s.vy += s.g * dt; s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.k === 'd') { const sz = U * (s.sz + (1 - s.t / s.t0) * s.grow); ctx.globalAlpha = Math.min(.6, s.t / s.t0 * .9); R(s.x - sz / 2, s.y - sz / 2, sz, sz, s.c); ctx.globalAlpha = 1; }
      else R(s.x, s.y, U * s.sz, U * s.sz, s.c);
    }
    const act = sc.kind === 'press' ? sc.plate.pp.ph === 'down' || sc.plate.pp.ph === 'hold' : sc.kind === 'grind' ? sc.snd.load > .3 : sc.snd.meltN > 0;
    beacon(W - L.cw - 8 * U, 6.5 * U, act, '#ff3030', now);

    for (const b of items) { // nevek
      if (b.gen > 0) continue;
      const sel = (sc.drag && sc.drag.b === b) || sc.hover === b;
      if (sel || now < b.labelT || (st.names && items.length <= 30)) textBox(b.name, b.position.x, b.bounds.min.y - 13 * U, sel ? '#ffb11a' : '#6b4fa0');
    }
    const sel = sc.drag ? sc.drag.b : sc.hover;
    if (sel && sel.alive) textBox(`${sel.name} · ${fmt(sel.value)} · ${Math.max(0, Math.ceil(sel.hp))}/${Math.ceil(sel.maxHp)} HP`, W / 2, 24 * U, '#ffb11a');
    ctx.font = `bold ${Math.max(6 * U, 16 * S)}px "Courier New",monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = pops.length - 1; i >= 0; i--) {
      const pp = pops[i]; pp.t -= dt; if (pp.t <= 0) { pops.splice(i, 1); continue; }
      const yy = pp.y - (1 - pp.t) * 40; ctx.fillStyle = '#000'; ctx.fillText(pp.txt, pp.x + U, yy + U); ctx.fillStyle = pp.c; ctx.fillText(pp.txt, pp.x, yy);
    }
  }

  // =====================================================================================
  //  HANG (WebAudio szintézis: hidraulika, daráló-motor, olvasztó-zúgás) – csak az aktív kártya szól
  // =====================================================================================
  let AC = null, A = {}, lastBeep = 0;
  function audioInit() {
    if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      const nb = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate), d = nb.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      A.nb = nb; A.master = AC.createGain(); A.master.gain.value = .7; A.master.connect(AC.destination);
      const noise = (type, f, qq) => { const sr = AC.createBufferSource(); sr.buffer = nb; sr.loop = true; const fl = AC.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = qq || 1;
        const g = AC.createGain(); g.gain.value = 0; sr.connect(fl); fl.connect(g); g.connect(A.master); sr.start(); return { fl, g }; };
      const osc = (type, f, lp) => { const o = AC.createOscillator(); o.type = type; o.frequency.value = f; const fl = AC.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp;
        const g = AC.createGain(); g.gain.value = 0; o.connect(fl); fl.connect(g); g.connect(A.master); o.start(); return { o, fl, g }; };
      A.hyd = osc('sawtooth', 70, 500); A.whine = osc('triangle', 300, 1800); A.hiss = noise('highpass', 3500);
      A.motor = osc('square', 45, 220); A.grn = noise('bandpass', 1100, 1.4); A.melt = noise('lowpass', 280);
    } catch (e) { AC = null; }
  }
  function audioTick(dt) {
    if (!AC) return;
    const sc = scenes[cur], s = sc.snd, on = st.sfx && !paused && !!AC, t = AC.currentTime, set = (g, v) => g.gain.setTargetAtTime(on ? v : 0, t, .06);
    const pk = cur === 'press', gk = cur === 'grind', mk = cur === 'melt', pr = pk ? s.press : 0;
    set(A.hyd.g, .07 * pr); A.hyd.o.frequency.setTargetAtTime(55 + 90 * pr, t, .08);
    set(A.whine.g, .012 * pr); A.whine.o.frequency.setTargetAtTime(220 + 520 * pr * (s.dir > 0 ? 1 : .6), t, .08);
    set(A.hiss.g, pk && s.dir > 0 ? .02 * pr : 0);
    s.load += ((s.hit > 0 ? 1 : 0) - s.load) * Math.min(1, dt * 6);
    KINDS.forEach(k => { if (k !== cur) scenes[k].snd.load += ((scenes[k].snd.hit > 0 ? 1 : 0) - scenes[k].snd.load) * Math.min(1, dt * 6); scenes[k].snd.hit = 0; });
    set(A.motor.g, gk ? .035 + .03 * s.load : 0); A.motor.o.frequency.setTargetAtTime(38 + (bladeSpeed() - .11) * 200 + 14 * s.load, t, .1);
    set(A.grn.g, gk ? .07 * s.load : 0);
    set(A.melt.g, mk ? .02 + .035 * Math.min(1, s.meltN / 3) : 0);
    if (on && mk && s.meltN && Math.random() < .08) noiseBurst(2000 + Math.random() * 3000, .04, .03, 'bandpass');
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

  // =====================================================================================
  //  FELÜLET, FŐ CIKLUS
  // =====================================================================================
  const pt = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  cv.addEventListener('pointerdown', e => { e.preventDefault(); if (scenes[cur].down(pt(e), e.pointerId)) cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => scenes[cur].move(pt(e), e.pointerId));
  cv.addEventListener('pointerleave', () => { if (!scenes[cur].drag) scenes[cur].hover = null; });
  ['pointerup', 'pointercancel'].forEach(t => cv.addEventListener(t, e => scenes[cur].up(e.pointerId)));
  cv.addEventListener('contextmenu', e => e.preventDefault());

  let last = performance.now(), acc = 0;
  function frame(t) {
    const dt = Math.min(100, t - last); last = t;
    if (!paused) { acc += dt; let n = 0; while (acc >= 1000 / 60 && n < 4) { KINDS.forEach(k => scenes[k].step()); acc -= 1000 / 60; n++; } if (n === 4) acc = 0; }
    renderScene(scenes[cur], dt / 1000, paused ? 1 : Math.min(1, acc / (1000 / 60)));
    audioTick(dt / 1000); requestAnimationFrame(frame);
  }
  function resize() {
    W = wrap.clientWidth; H = wrap.clientHeight; if (!W || !H) return;
    U = Math.max(2, Math.round(Math.min(W, H) / 200)); lw = Math.ceil(W / U); lh = Math.ceil(H / U); cv.width = lw; cv.height = lh;
    S = Math.max(.45, Math.min(1.2, W / 800, H / 520));
    KINDS.forEach(k => {
      const sc = scenes[k]; sc.endDrag(); sc.build();
      sc.items.slice().forEach(b => { if (b.position.x > W || b.position.y > H || b.position.x < 0) sc.kill(b, 'melt', true); });
    });
  }
  new ResizeObserver(resize).observe(wrap);

  const selCat = $('selCat'), selItem = $('selItem');
  Object.keys(CATS).forEach(c => selCat.add(new Option(c, c)));
  const fillItems = () => { selItem.innerHTML = ''; CATS[selCat.value].forEach((d, i) => selItem.add(new Option(`${d.e} ${d.n} (${fmt(d.v)})`, i))); };
  selCat.onchange = fillItems; fillItems();
  $('btnMake').onclick = () => { audioInit(); scenes[cur].spawn(CATS[selCat.value][selItem.value]); beep(440, .06, 'triangle'); };
  const menu = $('menu');
  $('btnMenu').onclick = () => { menu.classList.remove('hide'); paused = true; };
  $('btnPlay').onclick = () => { menu.classList.add('hide'); paused = false; audioInit(); };
  $('chkNames').checked = st.names; $('chkNames').onchange = e => { st.names = e.target.checked; save(); };
  $('chkSfx').checked = st.sfx; $('chkSfx').onchange = e => { st.sfx = e.target.checked; save(); };
  $('btnReset').onclick = () => { if (confirm('Biztosan törlöd a pénzt és a fejlesztéseket?')) { st.money = 0; st.press = st.grind = st.melt = 1; save(); ui(); } };
  let toastT; function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1800); }
  $('btnRefresh').onclick = async () => {
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

  KINDS.forEach(k => { scenes[k] = makeScene(k); });
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
