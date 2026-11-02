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
  const ALL = ['yard', 'press', 'grind', 'melt']; // szeméttelep + három gép (mind külön fizikai világ)

  // ---------- MENTÉS ----------
  const SAVE = 'zuzo_save_v1';
  let st = { money: 50, press: 1, grind: 1, melt: 1, sfx: true, names: true, card: 'yard', xp: 0, chapter: 0, paid: 0, won: false, orders: [], stats: { kills: 0, earned: 0 }, sel: null, tset: 0, auto: false, pad: false };
  try { Object.assign(st, JSON.parse(localStorage.getItem(SAVE) || '{}')); } catch (e) {}
  if (!ALL.includes(st.card)) st.card = 'yard';
  if (!st.stats) st.stats = { kills: 0, earned: 0 };
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
  // olvasztó: kézi hőfokszabályzás – a hőmérséklet adja az olvadás sebességét és a fém minőségét, a fűtés pénzbe kerül
  const c01 = v => Math.max(0, Math.min(1, v));
  const pressV = () => Math.min(10 * S, (2.4 + .3 * st.press) * S); // a prés lemezének max. sebessége (lassú, nehézkes mozgás)
  const tempFactor = T => Math.max(0, Math.min(1.6, (T - 600) / 900));                 // 600 °C alatt nem olvad, 1500 °C = alapsebesség
  const fuelPerSec = T => Math.pow(T / 1000, 2) * .8 * Math.pow(1.22, st.melt - 1);    // tüzelőanyag Ft/mp
  function mixHex(a, b, t) { const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16), ch = sh => Math.round(((pa >> sh) & 255) + (((pb >> sh) & 255) - ((pa >> sh) & 255)) * t); return `rgb(${ch(16)},${ch(8)},${ch(0)})`; }
  const LAVA = [['#3a2a28', '#2a1a18', '#1c1010', '#140a0a'], ['#ff7a1a', '#d83a12', '#a02210', '#701208'], ['#fff2a0', '#ffd23f', '#ff8c1a', '#e03a14']];
  const lavaCols = tf => { const [a, b, t] = tf < .5 ? [LAVA[0], LAVA[1], tf * 2] : [LAVA[1], LAVA[2], (tf - .5) * 2]; return a.map((c, i) => mixHex(c, b[i], t)); };
  const effText = k => k === 'press' ? `${Math.round(pressDps())} → ${Math.round(pressDps() * 1.3)} sebzés/mp`
    : k === 'grind' ? `${Math.round(bladeDps())} → ${Math.round(bladeDps() * 1.28)} sebzés/mp · gyorsabb forgás`
    : `×${meltMult().toFixed(1)} → ×${(meltMult() + .1).toFixed(1)} szorzó · gyorsabb olvadás`;

  // ---------- NÉZET ÉS KÁRTYÁK ----------
  let W = 0, H = 0, S = 1, U = 2, lw = 0, lh = 0, cc = ctx, paused = true;
  const scenes = {};
  let cur = st.card, view = cur;   // cur = utoljára használt gép-kártya, view = ami látszik (gép vagy 'orders')
  const TABS = ['yard', 'press', 'grind', 'melt', 'orders'];

  // =====================================================================================
  //  JÁTÉKMENET – „Zúzó Kft.”: megbízások → XP/szint → új tárgyak + fejlesztési plafon → adósság törlesztése
  //  Beszerzés (35%-os áron) → gép feldolgozza (prés ×1, daráló ×1, olvasztó ×2,5+) → haszon → fejlesztés / törlesztés
  // =====================================================================================
  const LOC = { press: 'a présben', grind: 'a darálóban', melt: 'az olvasztóban' }, VERB = { press: 'Zúzz be', grind: 'Daráld le', melt: 'Olvassz meg' };
  const need = l => Math.round(50 * Math.pow(l, 1.55));
  function lvlInfo() { let l = 1, rem = st.xp; while (rem >= need(l)) { rem -= need(l); l++; } return { l, rem, need: need(l) }; }
  const level = () => lvlInfo().l;
  const capOf = () => 3 + 2 * level();                      // a gépek legmagasabb szintje a cég szintjétől függ
  const UNL = [[100, 1], [800, 2], [2000, 3], [6000, 4], [25000, 5], [80000, 7], [300000, 9], [1e6, 12], [5e6, 15], [3e7, 18]];
  function unlockLvl(d) { for (const [v, l] of UNL) if (d.v <= v) return l; return 22; }
  const buyCost = d => d.v < 10 ? 0 : Math.round(d.v * .35);
  const CHAPTERS = [
    { name: 'Az örökség', debt: 8000, story: 'Nagybátyád ócskatelepét örökölted – és a hitelező bank 8 000 Ft-ot követel. Vállalj megbízásokat, zúzd a hulladékot!' },
    { name: 'Üzemi gépek', debt: 150000, story: 'A prés rozsdás, a daráló nyikorog. Fejleszd a gépeket, hogy nagyobb megrendelőket szolgálhass ki.' },
    { name: 'Elektronikai boom', debt: 2000000, story: 'Tele a város régi telefonokkal és tévékkel. Daráld le, olvaszd be – a nemesfém a nyereség!' },
    { name: 'Filmstúdió-megrendelések', debt: 30000000, story: 'A stúdiók selejtezik a kellékeiket: kiborgokat, szuperhős-figurákat, filmszörnyeket. Ez már nagy üzlet!' },
    { name: 'Nagyüzem', debt: 400000000, story: 'Járművek, hajók, épületek. A bank már tiszteli a nevedet – még egy nagy lépés hátra van.' },
    { name: 'A zúzó-király', debt: 5000000000, story: 'Az utolsó részlet: kifizeted a bankot, és az egész üzem a tiéd. Zúzz, ahogy még senki!' }
  ];
  const chapterDef = i => CHAPTERS[i] || { name: `Zúzó-birodalom ${i - CHAPTERS.length + 1}.`, debt: 5e9 * Math.pow(10, i - CHAPTERS.length + 1), story: 'A birodalom egyre nő – a bank egy újabb, nagyobb hitelt kínál. Végtelen játék!' };
  let bannerT; function banner(html, ms) { const b = $('banner'); b.innerHTML = html; b.classList.add('show'); clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.remove('show'), ms || 3200); }
  function addXp(n) {
    if (n <= 0) return;
    const before = level(); st.xp += n; const after = level(); save();
    if (after > before) {
      const fresh = []; for (const cat in CATS) for (const d of CATS[cat]) { const u = unlockLvl(d); if (u > before && u <= after) fresh.push(d); }
      banner(`⭐ SZINT ${after}!<br><small>Gép-plafon: Sz.${capOf()}${fresh.length ? ' · Új tárgyak: ' + fresh.slice(0, 8).map(d => d.e).join(' ') + (fresh.length > 8 ? ' +' + (fresh.length - 8) : '') : ''}</small>`, 4200);
      beep(660, .12, 'triangle'); setTimeout(() => beep(880, .12, 'triangle'), 110); setTimeout(() => beep(1100, .22, 'triangle'), 220);
    }
  }
  let oid = 1;
  function genOrder() {
    const lv = level(), k = KINDS[(Math.random() * 3) | 0], r = Math.random(), id = Date.now() + oid++;
    const pool = Object.keys(CATS).map(cat => ({ cat, items: CATS[cat].filter(d => unlockLvl(d) <= lv) })).filter(x => x.items.length >= 2);
    if (r < .5 || lv < 2) { // darabszám egy kategóriából
      const g = pool[(Math.random() * pool.length) | 0], n = 3 + ((Math.random() * 3) | 0) + ((lv / 5) | 0), avg = g.items.reduce((s, d) => s + d.v, 0) / g.items.length;
      return { id, type: 'count', k, cat: g.cat, need: n, have: 0, money: Math.max(30, Math.round(n * avg * (k === 'melt' ? .9 : .6) / 10) * 10), xp: 8 + n * 3 + lv * 2, text: `${VERB[k]} ${n} db tárgyat a „${g.cat}” kategóriából (${LOC[k]})` };
    }
    if (r < .8) { // bevételi cél
      const amt = Math.round(300 * Math.pow(1.55, lv - 1) * (k === 'melt' ? 1.5 : 1) / 10) * 10;
      return { id, type: 'earn', k, need: amt, have: 0, money: Math.round(amt * .4 / 10) * 10, xp: 12 + lv * 3, text: `Keress ${fmt(amt)}-ot ${LOC[k]}` };
    }
    const all = []; pool.forEach(x => x.items.forEach(d => all.push(d))); all.sort((a, b) => b.v - a.v);
    const d = all[(Math.random() * Math.min(6, all.length)) | 0]; // a legértékesebb kinyitott tárgyak egyike
    return { id, type: 'item', k, name: d.n, need: 1, have: 0, money: Math.round(d.v * .8 / 10) * 10, xp: 20 + lv * 3, text: `${VERB[k]} egy „${d.n}” ${d.e} tárgyat (${LOC[k]})` };
  }
  const orderWants = it => st.orders.some(o => (o.type === 'count' && o.cat === it.cat) || (o.type === 'item' && o.name === it.name)); // ★ a telepen
  function ensureOrders() { if (!Array.isArray(st.orders)) st.orders = []; while (st.orders.length < 3) st.orders.push(genOrder()); }
  function track(k, it, pay) { // minden zúzás: statisztika + XP + megbízás-haladás
    st.stats.earned += pay;
    if (it.gen === 0) { st.stats.kills++; addXp(Math.round(Math.log10(it.value + 1) * 1.2)); }
    st.orders.forEach(o => {
      if (o.k !== k) return;
      if (o.type === 'count' && it.gen === 0 && it.cat === o.cat) o.have++;
      else if (o.type === 'item' && it.gen === 0 && it.name === o.name) o.have++;
      else if (o.type === 'earn') o.have += pay;
    });
    st.orders.filter(o => o.have >= o.need).forEach(completeOrder);
  }
  function completeOrder(o) {
    const i = st.orders.indexOf(o); if (i < 0) return;
    st.money += o.money; st.orders[i] = genOrder(); save();
    banner(`✅ Megbízás teljesítve!<br><small>+${fmt(o.money)} · +${o.xp} XP</small>`);
    beep(740, .1, 'triangle'); setTimeout(() => beep(990, .16, 'triangle'), 100);
    addXp(o.xp); ui();
  }
  function rerollOrder(i) {
    const o = st.orders[i]; if (!o) return; const cost = Math.round(o.money * .1 / 10) * 10;
    if (st.money < cost) return toast('Nincs elég pénz a cseréhez');
    st.money -= cost; st.orders[i] = genOrder(); save(); ui();
  }
  function payDebt(frac) {
    const ch = chapterDef(st.chapter), rem = Math.max(0, ch.debt - st.paid), amt = Math.min(rem, frac >= 1 ? Math.floor(st.money) : Math.floor(st.money * frac));
    if (amt < 1) return toast(st.money < 1 ? 'Nincs mit befizetni' : 'Ez túl kevés a befizetéshez');
    st.money -= amt; st.paid += amt; save();
    if (st.paid >= ch.debt - .5) {
      const xp = 80 * Math.pow(st.chapter + 1, 2), won = st.chapter === CHAPTERS.length - 1 && !st.won;
      st.chapter++; st.paid = 0; if (won) st.won = true;
      banner(won ? `🏆 GRATULÁLOK! Kifizetted a tartozást – az üzem a tiéd!<br><small>A játék folytatódik: újabb fejezetek, nagyobb adósság, nagyobb zúzás!</small>`
        : `📖 Fejezet kész: ${ch.name}!<br><small>+${xp} XP · következő: ${chapterDef(st.chapter).name}</small>`, won ? 7000 : 4200);
      beep(523, .12, 'triangle'); setTimeout(() => beep(659, .12, 'triangle'), 120); setTimeout(() => beep(784, .12, 'triangle'), 240); setTimeout(() => beep(1047, .3, 'triangle'), 360);
      addXp(xp);
    } else toast(`Befizetve: ${fmt(amt)}`);
    ui();
  }
  function renderOrders() {
    const li = lvlInfo(), ch = chapterDef(st.chapter), lv = li.l, nxt = [];
    for (const cat in CATS) for (const d of CATS[cat]) if (unlockLvl(d) === lv + 1) nxt.push(d);
    const cards = st.orders.map((o, i) => {
      const p = Math.min(100, o.have / o.need * 100), prog = o.type === 'earn' ? `${fmt(o.have)} / ${fmt(o.need)}` : `${o.have} / ${o.need}`, cost = Math.round(o.money * .1 / 10) * 10;
      return `<div class="oc"><div class="ot"><span class="oi">${LV[o.k].icon}</span><span>${o.text}</span></div><div class="bar"><i style="width:${p}%"></i></div>` +
        `<div class="of"><span>${prog}</span><b>+${fmt(o.money)} · +${o.xp} XP</b><button class="mini" data-r="${i}">Csere${cost ? ' −' + fmt(cost) : ''}</button></div></div>`;
    }).join('');
    $('orders').innerHTML =
      (st.stats.kills < 12 ? `<div class="card2 tip"><b>💡 Hogyan működik?</b><br>1) A <b>🏗️ Telepen</b> fogd meg a daruval a kívánt tárgyat (érintsd meg, hova menjen a markoló), és engedd a gép <b>torkába</b> – a ★ jelzi, mire van megbízásod (beszerzési ár: az érték ~35%-a).<br>2) A <b>prést</b> te működteted a kapcsolóval, a <b>daráló</b> magától zúz, az <b>olvasztót</b> a hőfokgombbal kell befűtened (a fűtés pénzbe kerül) – cserébe ×2,5 pénzt ad.<br>3) A haszonból <b>fejleszd a gépet</b>, a megbízások XP-t adnak: új szint = új tárgyak és magasabb gép-plafon.<br>4) Végső cél: <b>fizesd ki a bank tartozását</b>!</div>` : '') +
      `<div class="card2"><div class="h">🏭 Zúzó Kft. · Szint ${lv}</div><div class="bar big"><i style="width:${li.rem / li.need * 100}%"></i></div>` +
      `<div class="sm">${li.rem} / ${li.need} XP · gépek max. szintje: ${capOf()}<br>Következő szint: ${nxt.length ? '🔓 ' + nxt.slice(0, 6).map(d => d.e).join(' ') + (nxt.length > 6 ? ' +' + (nxt.length - 6) : '') + ' új tárgy' : 'magasabb gép-plafon'}</div></div>` +
      `<div class="card2"><div class="h">📖 ${st.chapter + 1}. fejezet: ${ch.name}</div><div class="sm">${ch.story}</div><div class="bar big debt"><i style="width:${Math.min(100, st.paid / ch.debt * 100)}%"></i></div>` +
      `<div class="sm">Törlesztve: ${fmt(st.paid)} / ${fmt(ch.debt)} (alul fizethetsz be)</div></div>` +
      `<div class="h2">📋 Aktív megbízások</div>${cards}` +
      `<div class="card2 sm">Összes zúzott tárgy: <b>${st.stats.kills}</b> · Összes bevétel: <b>${fmt(st.stats.earned)}</b></div>`;
  }
  function updateGoal() { // a legfontosabb cél mindig látszik a képernyő tetején
    const g = $('goal'), o = st.orders.find(x => x.k === cur) || st.orders[0];
    if (!o) { g.textContent = ''; return; }
    const prog = o.type === 'earn' ? `${fmt(o.have)}/${fmt(o.need)}` : `${o.have}/${o.need}`;
    g.textContent = `🎯 ${prog} · ${o.text}`; g.style.setProperty('--p', Math.min(100, o.have / o.need * 100) + '%');
  }
  function ui() {
    $('money').textContent = fmt(st.money);
    const li = lvlInfo(); $('lvlTxt').textContent = 'SZ.' + li.l; $('xpBar').style.width = (li.rem / li.need * 100) + '%';
    const TI = { yard: ['🏗️', 'TELEP'], press: ['🔨', 'PRÉS'], grind: ['⚙️', 'DARÁLÓ'], melt: ['🔥', 'OLVASZTÓ'], orders: ['📋', 'MEGBÍZÁS'] };
    TABS.forEach(k => {
      const t = $('tab_' + k), sub = KINDS.includes(k) ? `Sz.${st[k]}${k === 'melt' && scenes.melt ? ' · ' + Math.round(scenes.melt.temp) + '°' : ''}` : k === 'orders' ? `${st.orders.length} aktív` : 'daru';
      t.innerHTML = `<span class="ti">${TI[k][0]}</span>${TI[k][1]}<small>${sub}</small>`; t.classList.toggle('on', view === k);
    });
    const om = view === 'orders', yv = view === 'yard', mv = KINDS.includes(view);
    $('orders').hidden = !om; $('ctlOrders').hidden = !om; $('ctlYard').hidden = !yv; $('ctlMachine').hidden = !mv;
    if (om) renderOrders();
    if (mv) {
      const c = costOf(view), cap = capOf(), b = $('btnUp'), capped = st[view] >= cap;
      b.innerHTML = capped ? `<b>🔒 ${LV[view].name} Sz.${st[view]}</b> · plafon!<br><small>Lépj szintet a megbízásokkal (új plafon: +2)</small>`
        : `<b>⬆ ${LV[view].name} Sz.${st[view]} → ${st[view] + 1}</b> · ${fmt(c)}<br><small>${effText(view)}</small>`;
      b.classList.toggle('off', capped || st.money < c);
      $('ctlPress').hidden = view !== 'press'; $('ctlMelt').hidden = view !== 'melt';
      $('btnAuto').hidden = st.press < 5; $('btnAuto').innerHTML = st.auto ? '⚙ AUTO<small>BE</small>' : '⚙ AUTO<small>KI</small>';
    }
    updateGoal();
    KINDS.forEach(k => { const sc = scenes[k]; if (sc && lw && sc.lv !== st[k] && sc.L.ft) { sc.lv = st[k]; paintBg(sc); } }); // a tábla szintje újrarajzolódik
  }
  function setView(v) {
    if (v === view) return;
    if (view !== 'orders') scenes[cur].endDrag();
    scenes.press.cmd = false; $('btnPress').classList.remove('on');
    view = v; if (v !== 'orders') { cur = v; st.card = v; } save(); ui(); audioInit();
  }
  TABS.forEach(k => { $('tab_' + k).onclick = () => setView(k); });
  $('goal').onclick = () => setView('orders');
  $('orders').addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-r]'); if (b) rerollOrder(+b.dataset.r); });
  $('btnUp').onclick = () => {
    if (!KINDS.includes(view)) return;
    const c = costOf(view);
    if (st[view] >= capOf()) return toast(`Plafon: Sz.${capOf()} – szintet kell lépned (megbízások)!`);
    if (st.money < c) return toast('Nincs elég pénz');
    st.money -= c; st[view]++; save(); ui(); audioInit();
    beep(520, .1, 'triangle'); setTimeout(() => beep(780, .14, 'triangle'), 90); noiseBurst(3200, .25, .05, 'highpass');
  };
  $('pay25').onclick = () => payDebt(.25); $('pay50').onclick = () => payDebt(.5); $('payMax').onclick = () => payDebt(1);


  $('btnGrab').onclick = () => { audioInit(); scenes.yard.act(); };
  $('btnShuffle').onclick = () => { scenes.yard.shuffle(); toast('Új halom érkezett'); };
  // Prés-kapcsoló: nyomd = egy ütés, tartsd = folyamatos; (Sz.5-től AUTO mód is van)
  const pb = $('btnPress');
  pb.addEventListener('pointerdown', e => { e.preventDefault(); try { pb.setPointerCapture(e.pointerId); } catch (x) {} audioInit(); const sc = scenes.press; sc.cmd = true; sc.queued = true; pb.classList.add('on'); beep(150, .08, 'square', .06); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => pb.addEventListener(t, () => { scenes.press.cmd = false; pb.classList.remove('on'); }));
  pb.addEventListener('contextmenu', e => e.preventDefault());
  $('btnAuto').onclick = () => { st.auto = !st.auto; save(); ui(); };
  // Olvasztó-hőfok: csúszka (forgatógomb) + KI gomb
  const ts = $('tempSet'); ts.value = st.tset;
  ts.addEventListener('input', () => { st.tset = +ts.value; save(); });
  $('tempOff').onclick = () => { st.tset = 0; ts.value = 0; save(); };

  // Teljes képernyő (Android/asztali böngésző; iPhone-on a rendszer nem engedi, ott a telepített alkalmazás tölti ki a kijelzőt)
  function goFull() {
    try {
      const el = document.documentElement, f = el.requestFullscreen || el.webkitRequestFullscreen;
      if (f && !document.fullscreenElement && !document.webkitFullscreenElement) { const p = f.call(el, { navigationUI: 'hide' }); if (p && p.catch) p.catch(() => {}); }
    } catch (e) {}
  }
  const liftBottom = ms => { document.body.classList.add('lift'); setTimeout(() => document.body.classList.remove('lift'), ms); };
  ['fullscreenchange', 'webkitfullscreenchange'].forEach(t => document.addEventListener(t, () => { if (document.fullscreenElement || document.webkitFullscreenElement) liftBottom(7000); }));
  try { if (window.matchMedia && matchMedia('(display-mode: fullscreen)').matches) liftBottom(7000); } catch (e) {}
  document.body.classList.toggle('pad', !!st.pad); $('chkPad').checked = !!st.pad;
  $('chkPad').onchange = e => { st.pad = e.target.checked; document.body.classList.toggle('pad', st.pad); save(); };
  $('btnFull').onclick = () => { if (document.fullscreenElement || document.webkitFullscreenElement) { try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) {} } else goFull(); };

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

  // A markoló karmai: váll (hw) → könyök → hegy. Az 'a' szög a nyitás (nagy = tágra nyitva), a hegy befelé hajlik.
  function jawGeom(a, cl, hw) {
    const a2 = a * .35 - .5, jx = hw + .55 * cl * Math.sin(a), jy = .55 * cl * Math.cos(a);
    return { jx, jy, tx: jx + .6 * cl * Math.sin(a2), ty: jy + .6 * cl * Math.cos(a2) };
  }

  // ---------- EGY GÉP-KÁRTYA = EGY KÜLÖN FIZIKAI VILÁG ----------
  function makeScene(kind) {
    const engine = Engine.create({ positionIterations: 8, velocityIterations: 6 }), world = engine.world;
    const sc = { kind, engine, world, items: [], dead: [], sparks: [], pops: [], statics: [], belts: [], rotors: [], plate: null, L: {}, shake: 0, hover: null, drag: null,
      bg: document.createElement('canvas'), snd: { press: 0, dir: 1, hit: 0, meltN: 0, load: 0 }, gP: 0, lv: 0, temp: 0, cmd: false, queued: false, gAng: 0 };
    const { items, dead, sparks, pops, statics, belts, rotors, L, snd } = sc;
    const isCur = () => cur === kind;
    const antiGrav = b => { b.force.y -= b.mass * engine.gravity.y * engine.gravity.scale; };
    sc.feedFree = () => { if (items.length >= 100) return false; const x0 = L.spawnX - 20 * U, x1 = L.spawnX + 20 * U, y1 = L.spawnTop + 60 * U; return !items.some(b => b.bounds.max.x > x0 && b.bounds.min.x < x1 && b.bounds.min.y < y1); };
    sc.quality = () => sc.temp < 600 ? .7 : Math.min(1.15, .7 + .3 * (sc.temp - 600) / 900); // hidegen rosszabb minőségű fém
    function heat() { // az olvasztó hőmérséklete lassan követi a beállított értéket; a fűtés tüzelőanyagot fogyaszt
      const dt = 1 / 60, noFuel = st.money <= 0, want = noFuel ? 0 : st.tset, rate = want > sc.temp ? 60 + 12 * st.melt : 45;
      sc.temp += Math.max(-rate * dt, Math.min(rate * dt, want - sc.temp));
      if (sc.temp > 150 && want > 0) st.money = Math.max(0, st.money - fuelPerSec(sc.temp) * dt);
      if (noFuel && st.tset > 0 && !sc.noFuel) { sc.noFuel = true; toast('⛽ Elfogyott a tüzelőanyag – a kemence kihűl!'); } else if (!noFuel) sc.noFuel = false;
      sc.uiT = (sc.uiT || 0) + dt; if (sc.uiT > .3) { sc.uiT = 0; save(); ui(); }
    }

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
        const pw = W * .4, ph = Math.max(24, 36 * S);
        const plate = Bodies.rectangle(W / 2, H * .34, pw, ph, { density: 5, friction: .9, frictionAir: 0 });
        Body.setInertia(plate, Infinity);
        plate.zk = 'press'; plate.restY = H * .34; plate.botY = L.ft - bh - ph / 2 - 8 * S; plate.pp = { ph: 'wait', t: .4, v: 0 };
        statics.push(plate); Composite.add(world, plate); sc.plate = plate;
        Object.assign(L, { pw, ph, plL: W / 2 - pw / 2, plR: W / 2 + pw / 2, cylW: W * .26 });
        L.cylB = Math.min(plate.restY - ph / 2 - 4 * U, 13 * U + H * .17);
        L.rodL = L.plL + 5 * U; L.rodR = L.plR - 7 * U;
        mkBelt(cw + 4, W / 2, 1); mkBelt(W / 2, L.rightWall - 4, -1);
        L.maxW = Math.min(W * .3, (L.plL - cw) * .85); L.maxH = H * .3; L.spawnX = (cw + L.plL) / 2;
      } else if (kind === 'grind') {
        const r = Math.min(W * .15, H * .14), cy = L.ft - bh - r - 4;
        [[.32, 1], [.68, -1]].forEach(([fx, dir]) => {
          const cx = W * fx, bars = [0, 1].map(i => Bodies.rectangle(cx, cy, 2 * r, Math.max(12, 13 * S), { angle: i * Math.PI / 2, density: 3 }));
          const rot = Body.create({ parts: bars, friction: .8, frictionAir: 0 });
          rot.zk = 'blade'; rot.dir = dir; rot.home = { x: cx, y: cy }; rot.r = r;
          statics.push(rot); rotors.push(rot); Composite.add(world, rot);
        });
        Object.assign(L, { r, cy, topY: H * .16, botY: cy - r - H * .06, xTL: cw + 4 * U, xTR: W - cw - 4 * U, xBL: W * .27, xBR: W * .73 });
        wall(L.xTL, L.topY, L.xBL, L.botY, 8); wall(L.xTR, L.topY, L.xBR, L.botY, 8);
        L.cx0 = W * .16; L.cx1 = W * .84; // a vágókamra oldalfalai
        add(Bodies.rectangle(L.cx0 - 100, (L.botY + L.ft) / 2, 200, L.ft - L.botY, { isStatic: true }), '', true);
        add(Bodies.rectangle(L.cx1 + 100, (L.botY + L.ft) / 2, 200, L.ft - L.botY, { isStatic: true }), '', true);
        mkBelt(L.cx0 + 4, W / 2, 1); mkBelt(W / 2, L.cx1 - 4, -1);
        L.maxW = W * .28; L.maxH = H * .2; L.spawnX = W / 2;
      } else if (kind === 'yard') {
        const rWall = W * .58;
        add(Bodies.rectangle(rWall + 100, H / 2, 200, H * 3, { isStatic: true }), '', true); // a hulladékhalom jobb oldali támfala
        const gap = 4 * U, xs0 = rWall + 8 * U, hw = (W - cw - 4 * U - xs0 - 2 * gap) / 3, mouth = H * .36;
        Object.assign(L, { rWall, pl0: cw, pl1: rWall, railY: 17 * U, carryY: Math.max(45 * U, H * .17), thr: {} });
        KINDS.forEach((k, i) => { L.thr[k] = { x: xs0 + hw / 2 + i * (hw + gap), hw, mouth }; });
        if (!sc.filled) { sc.filled = true; cr.x = W * .3; cr.aimX = cr.x; cr.aimY = H * .2; cr.len = H * .2 - L.railY; cr.gx = cr.x; cr.gy = H * .2; fillPile(44); }
        else cr.aimX = Math.min(cr.aimX, W - cw);
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
        solid: !!o.solid, cat: o.cat, dw: o.dw, dh: o.dh, area: o.area, sy: 1, dens: o.d, born: performance.now(), flash: 0, heat: 0, melting: false,
        px: b.position.x, py: b.position.y, pa: b.angle });
      items.push(b); Composite.add(world, b);
      return b;
    }
    sc.spawn = function (def, cat) {
      const circ = def.shape === 'c';
      const a = circ ? 1 : Math.max(.7, Math.min(1.35, def.w / def.h)), area0 = circ ? Math.PI * def.r * def.r : def.w * def.h;
      const w0 = circ ? def.r * 2 : Math.sqrt(area0 * a), h0 = circ ? def.r * 2 : Math.sqrt(area0 / a);
      let k = Math.max(S, 13 * U / Math.min(w0, h0));
      k = Math.min(k, L.maxW / Math.max(w0, h0), L.maxH / h0);
      const dw = w0 * k, dh = h0 * k, x = L.spawnX + rnd(-4, 4), y = L.spawnTop + dh / 2;
      if (items.length >= 100) return 'full';
      if (items.some(b => b.bounds.max.x > x - dw / 2 && b.bounds.min.x < x + dw / 2 && b.bounds.max.y > y - dh / 2 && b.bounds.min.y < y + dh / 2)) return 'busy'; // az adagoló még foglalt
      const opts = { density: def.d, friction: .5, restitution: .15, collisionFilter: { category: 2 } };
      const body = circ ? Bodies.circle(x, y, dw / 2, opts, 24) : Bodies.rectangle(x, y, dw, dh, Object.assign(opts, { chamfer: { radius: Math.min(dw, dh) * .1 } }));
      const aw = Math.max(6, Math.round(dw / U)), ah = Math.max(6, Math.round(dh / U));
      const spr = circ && /^\d+ Ft$/.test(def.n) ? coinSprite(def, aw) : emojiSprite(def, aw, ah);
      tag(body, { hp: def.hp, v: def.v, c: def.c, n: def.n, cat, spr, d: def.d, dw, dh, area: circ ? Math.PI * (dw / 2) ** 2 : dw * dh });
      body.labelT = performance.now() + 2500;
      while (items.length > 130) { const f = items.find(i => i.gen > 0) || items[0]; kill(f, 'melt', true); }
      return true;
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
      const pay = silent ? 0 : it.value * multOf(how) * (kind === 'melt' && how === 'melt' ? sc.quality() : 1);
      if (pay >= 1) { st.money += pay; save(); ui(); if (!silent && isCur()) pops.push({ x: it.position.x, y: it.position.y, t: 1, txt: '+' + Math.floor(pay).toLocaleString('hu-HU'), c: how === 'melt' ? '#ffb347' : '#ffe27a' }); }
      if (!silent) track(kind, it, pay);
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
        const t = Math.max(.3, .3 + .7 * Math.max(0, it.hp) / it.maxHp);
        if (it.sy - t > .03) { Body.scale(it, 1, t / it.sy); it.sy = t; }
      }
      if (d > .3 && how !== 'melt') it.flash = .09;
      if (how === 'grind' && Math.random() < .5) burst(it.position.x, it.position.y, 3, '#fff3b0');
      else if (how === 'press') { if (Math.random() < .2) puff(it.position.x, it.bounds.max.y, 1, '#8a8aa0'); if (Math.random() < .35) burst(it.position.x, it.position.y, 2, '#ffe27a'); }
      if (it.hp <= 0) dead.push([it, how]);
    }

    // ----- gépek léptetése -----
    function stepTools() {
      for (const b of items) { b.px = b.position.x; b.py = b.position.y; b.pa = b.angle; }
      if (kind === 'yard') { yardStep(); return; }
      if (kind === 'press' && sc.plate) {
        const p = sc.plate, s = p.pp, vmax = pressV(), y = p.position.y;
        p.py = y; let vy = 0;
        if (s.ph === 'wait') { s.t -= 1 / 60; if (s.t <= 0 && (sc.cmd || sc.queued || (st.auto && st.press >= 5))) { s.ph = 'down'; s.v = 0; sc.queued = false; } } // csak kapcsolóra (vagy AUTO módban) indul
        else if (s.ph === 'down') {
          s.v = Math.min(vmax, s.v + vmax * .035 + .06); vy = s.v;
          if (y + vy >= p.botY) { vy = p.botY - y; s.ph = 'hold'; s.t = .7; slam(vmax); }
        }
        else if (s.ph === 'hold') { s.t -= 1 / 60; if (s.t <= 0) { s.ph = 'up'; s.v = 0; } }
        else { s.v = Math.min(vmax * .8, s.v + vmax * .03 + .05); vy = -s.v; if (y + vy <= p.restY) { vy = p.restY - y; s.ph = 'wait'; s.t = .15; } }
        snd.press = s.ph === 'down' || s.ph === 'up' ? s.v / vmax : s.ph === 'hold' ? .3 : 0; snd.dir = s.ph === 'up' ? -1 : 1;
        Body.setVelocity(p, { x: 0, y: vy }); Body.setAngle(p, 0); Body.setAngularVelocity(p, 0);
        Body.setPosition(p, { x: W / 2, y: p.position.y }); antiGrav(p);
      }
      rotors.forEach(r => { r.pa = r.angle; Body.setPosition(r, r.home); Body.setVelocity(r, { x: 0, y: 0 }); Body.setAngularVelocity(r, r.dir * bladeSpeed()); antiGrav(r); });
      if (kind === 'melt') heat();
    }
    function slam(vmax) { // becsapódás: rázkódás, villanás, lökéshullám-gyűrűk, szikra- és törmelékeső, por, gőz
      sc.shake = Math.max(sc.shake, Math.min(9, 3 + st.press * .25)); sc.flash = .28;
      puff(L.plL + 6, L.ft - L.bh, 6, '#8a8aa0'); puff(L.plR - 6, L.ft - L.bh, 6, '#8a8aa0');
      puff(L.plL + 8, sc.plate.position.y, 4, '#e8ecf5', 1.8); puff(L.plR - 8, sc.plate.position.y, 4, '#e8ecf5', 1.8);
      for (let i = 0; i < 16; i++) P(rnd(L.plL, L.plR), L.ft - L.bh - 2, rnd(-260, 260), -rnd(60, 320), rnd(.3, .8), i % 2 ? '#ffd24d' : '#fff3b0');
      chunks(W / 2, L.ft - L.bh, 6, '#6a6a80');
      P(W / 2, L.ft - L.bh, 0, 0, .55, '#e8ecf5', { k: 'r', sz: L.pw * .75, g: 0 }); P(W / 2, L.ft - L.bh, 0, 0, .85, '#ffd24d', { k: 'r', sz: L.pw * 1.15, g: 0 });
      if (isCur()) { beep(55, .3, 'sine', .14); noiseBurst(3000, .5, .08, 'highpass'); noiseBurst(200, .35, .14, 'lowpass'); }
    }
    function carry(it, belt) {
      const sp = 1.1 * S * belt.dir;
      Body.setVelocity(it, { x: it.velocity.x + (sp - it.velocity.x) * .15, y: it.velocity.y });
      if (it.circleRadius) Body.setAngularVelocity(it, it.velocity.x / it.circleRadius);
    }
    function pairs(list, start) {
      if (kind === 'yard') return; // a telepen nincs ütközési sebzés
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
          const f = tempFactor(sc.temp); it.melting = it.position.y > L.lavaTop && f > 0;
          if (it.melting) {
            snd.meltN++; hurt(it, it.maxHp * meltRate() * f / 60 + .05, 'melt'); it.heat = 1 - Math.max(0, it.hp) / it.maxHp;
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
    // ----- SZEMÉTTELEP: óriási hulladékhalom + egy ujjal irányítható daru (a markoló a gépek torkába rakja a tárgyakat) -----
    const cr = sc.cr = { x: 0, vx: 0, len: 0, ang: 0, angv: 0, gx: 0, gy: 0, aimX: 0, aimY: 0, hold: null, close: 0, a: 1, touch: false, pending: false, pt: 0, miss: 0 };
    const clawLen = () => Math.max(32, 56 * S), clampv = (v, a, b) => Math.max(a, Math.min(b, v));
    function junkDefs() { const lv = level(), out = []; for (const cat in CATS) for (const d of CATS[cat]) if (unlockLvl(d) <= lv) out.push({ d, cat }); return out; }
    function pickJunk() { // a halomban inkább az olcsóbb tárgyak vannak, de minden kinyitott fajta előfordul
      const defs = junkDefs(), w = defs.map(o => 1 / (1 + Math.log10(o.d.v + 10))); let r = Math.random() * w.reduce((a, b) => a + b, 0);
      for (let i = 0; i < defs.length; i++) { r -= w[i]; if (r <= 0) return defs[i]; } return defs[0];
    }
    function addJunk(o, x, y) {
      const d = o.d, circ = d.shape === 'c', a = circ ? 1 : Math.max(.7, Math.min(1.35, d.w / d.h)), area0 = circ ? Math.PI * d.r * d.r : d.w * d.h;
      const w0 = circ ? d.r * 2 : Math.sqrt(area0 * a), h0 = circ ? d.r * 2 : Math.sqrt(area0 / a);
      const k = Math.min(62 / Math.max(w0, h0), Math.max(24 / Math.min(w0, h0), S * .6)), dw = w0 * k, dh = h0 * k;
      const opts = { density: d.d, friction: .6, restitution: .1, collisionFilter: { category: 2 } };
      const body = circ ? Bodies.circle(x, y, dw / 2, opts, 24) : Bodies.rectangle(x, y, dw, dh, Object.assign(opts, { chamfer: { radius: Math.min(dw, dh) * .1 } }));
      const aw = Math.max(6, Math.round(dw / U)), ah = Math.max(6, Math.round(dh / U));
      const spr = circ && /^\d+ Ft$/.test(d.n) ? coinSprite(d, aw) : emojiSprite(d, aw, ah);
      tag(body, { hp: d.hp, v: d.v, c: d.c, n: d.n, cat: o.cat, spr, d: d.d, dw, dh, area: circ ? Math.PI * (dw / 2) ** 2 : dw * dh }); body.def = d;
      return body;
    }
    function topUp(n) { while (items.length < n) addJunk(pickJunk(), rnd(L.pl0 + 20, L.pl1 - 20), L.railY + 20 * U - rnd(0, 60)); }
    function fillPile(n) { for (let i = 0; i < n; i++) addJunk(pickJunk(), rnd(L.pl0 + 20, L.pl1 - 20), L.ft - 30 - i * 52 - rnd(0, 20)); for (let t = 0; t < 700; t++) Engine.update(engine, 1000 / 60); }
    const throatAt = (gx, gy) => { for (const k of KINDS) { const t = L.thr[k]; if (Math.abs(gx - t.x) <= t.hw * .8 + clawLen() * .3 && gy <= t.mouth + 4 * U) return k; } return null; };
    function drop(it) { it.carried = false; it.collisionFilter.mask = it.mask0 == null ? 0xFFFFFFFF : it.mask0; Body.setVelocity(it, { x: 0, y: 0 }); cr.hold = null; }
    function relocate(it) { Body.setPosition(it, { x: rnd(L.pl0 + 30, L.pl1 - 30), y: L.railY + 20 * U }); drop(it); }
    function release() { // elenged: a torokba (ha ott van) vagy vissza a halomra
      const it = cr.hold, k = throatAt(cr.gx, cr.gy);
      if (k) {
        const cost = buyCost(it.def), r = scenes[k].spawn(it.def, it.cat);
        if (r === true) {
          st.money -= cost; save(); Composite.remove(world, it); items.splice(items.indexOf(it), 1); it.alive = false; cr.hold = null;
          const t = L.thr[k]; if (isCur()) { pops.push({ x: t.x, y: t.mouth - 6 * U, t: 1.1, txt: '→ ' + LV[k].name, c: '#9aff9a' }); chunks(t.x, t.mouth, 5, it.col); beep(520, .08, 'triangle'); noiseBurst(900, .2, .06, 'lowpass'); }
          ui(); return;
        }
        toast(r === 'full' ? `A(z) ${LV[k].name} tele van – várd meg a feldolgozást` : `A(z) ${LV[k].name} adagolója foglalt, próbáld újra`); relocate(it); return;
      }
      if (cr.gx > L.pl0 && cr.gx < L.pl1) drop(it); else relocate(it);
    }
    function act() { // megfog / elenged
      if (cr.hold) return release();
      const it = sc.hover;
      if (!it || !it.alive) { cr.miss = 24; cr.close = .6; if (isCur()) beep(180, .06, 'square', .03); return; }
      const cost = buyCost(it.def);
      if (st.money < cost) { toast(`Nincs elég pénz: ${fmt(cost)}`); cr.miss = 24; return; }
      it.mask0 = it.collisionFilter.mask; it.collisionFilter.mask = 0; it.carried = true; cr.hold = it; cr.aimY = L.carryY;
      addJunk(pickJunk(), rnd(L.pl0 + 20, L.pl1 - 20), L.railY + 22 * U); // a halom újratöltődik
      if (isCur()) { beep(330, .08, 'square', .05); noiseBurst(1800, .12, .05, 'bandpass'); }
    }
    function yardStep() { // daru: futómacska + inga-kötél + markoló
      const railY = L.railY, c = cr, vmaxX = Math.max(4, 8 * S), lenV = Math.max(3, 6 * S);
      const tx = clampv(c.aimX, L.cw + 6 * U, W - L.cw - 6 * U), ty = clampv(c.aimY, railY + 14 * U, L.ft - L.bh - 4 * U), wantLen = ty - railY;
      c.len += clampv(wantLen - c.len, -lenV, lenV);
      const ax = (tx - c.x) * .012 - c.vx * .16;
      c.vx = clampv(c.vx + ax, -vmaxX, vmaxX); c.x += c.vx;
      const Lc = Math.max(c.len, 30);
      c.angv += -(.8 / Lc) * Math.sin(c.ang) - c.angv * .02 - (ax / Lc) * Math.cos(c.ang); c.ang = clampv(c.ang + c.angv, -.9, .9);
      c.gx = c.x + c.len * Math.sin(c.ang); c.gy = railY + c.len * Math.cos(c.ang);
      c.close += ((c.hold ? 1 : 0) - c.close) * .2; if (c.miss > 0) c.miss--;
      snd.press = Math.min(1, (Math.abs(c.vx) + Math.abs(wantLen - c.len) * .3) / vmaxX); snd.dir = 1;
      if (c.hold) {
        const it = c.hold; Body.setPosition(it, { x: c.gx, y: c.gy + clawLen() * .8 }); Body.setVelocity(it, { x: 0, y: 0 }); Body.setAngle(it, c.ang * .6); Body.setAngularVelocity(it, 0); sc.hover = it;
      } else {
        let best = null, bd = 1e9; const reach = clawLen() * 1.2;
        for (const it of items) { if (it.carried) continue; const d = Math.hypot(it.position.x - c.gx, it.position.y - (c.gy + clawLen() * .8)); if (d < Math.max(reach, it.dw * .5 + 6) && d < bd) { bd = d; best = it; } }
        sc.hover = best;
      }
      const gripA = w => { const cl = clawLen(), hw = 7 * U; let best = .0, bd = 1e9; for (let a = 0; a <= 1.2; a += .02) { const d = Math.abs(jawGeom(a, cl, hw).tx - w / 2 + U); if (d < bd) { bd = d; best = a; } } return best; };
      const aT = c.hold ? gripA(c.hold.dw) : ((sc.hover || c.touch || c.pending) ? 1.1 : .55);
      c.a += (aT - c.a) * (c.hold ? .22 : .16);
      if (c.pending && !c.touch) { c.pt++; const d = Math.hypot(c.gx - tx, c.gy - ty); if ((d < 6 * U && Math.abs(c.vx) < .5) || c.pt > 300) { c.pending = false; act(); } } // oda megy, ahová érintettél, és ott cselekszik
    }
    sc.act = act; sc.topUp = topUp; sc.throatAt = throatAt;
    sc.shuffle = () => { items.slice().forEach(b => { if (b !== cr.hold) kill(b, 'melt', true); }); fillPile(44); };
    if (kind === 'yard') { // egy ujj: érintés/húzás = a markoló célpontja; felengedés = oda megy, és megfog vagy elenged
      sc.down = (p) => { cr.touch = true; cr.pending = false; cr.aimX = p.x; cr.aimY = p.y; return true; };
      sc.move = (p) => { if (cr.touch) { cr.aimX = p.x; cr.aimY = p.y; } };
      sc.up = () => { if (cr.touch) { cr.touch = false; cr.pending = true; cr.pt = 0; } };
      sc.endDrag = () => { cr.touch = false; cr.pending = false; if (cr.hold) drop(cr.hold); };
    }
    sc.kill = kill;
    sc.step = () => Engine.update(engine, 1000 / 60);
    return sc;
  }

  // =====================================================================================
  //  STATIKUS HÁTTEREK (kártyánként egyszer rajzoljuk, átméretezéskor / szintlépéskor újra)
  // =====================================================================================
  const PAL = { press: ['#14111c', '#1c1827', '#221d30', '#181421'], grind: ['#17150f', '#221f18', '#2a261c', '#1b1912'], melt: ['#1c0b0b', '#2b1414', '#351a1a', '#210f0f'] };
  const TITLE = { yard: ['SZEMÉTTELEP · DARU', '#8de08d'], press: ['HIDRAULIKUS PRÉS', '#7fb2ff'], grind: ['UNIVERZÁLIS DARÁLÓ', '#ffb15c'], melt: ['OLVASZTÓKEMENCE', '#ff6b5c'] };

  function paintBg(sc) {
    const g = sc.bg; g.width = lw; g.height = lh; cc = g.getContext('2d'); cc.setTransform(lw / W, 0, 0, lh / H, 0, 0);
    cc.imageSmoothingEnabled = false;
    if (sc.kind !== 'yard') paintBase(sc);
    ({ yard: paintYard, press: paintPress, grind: paintGrind, melt: paintMelt })[sc.kind](sc);
    const t = TITLE[sc.kind], txt = (sc.kind === 'yard' ? t[0] : `${t[0]}  Sz.${st[sc.kind]}`) + (sc.kind === 'melt' ? `  ×${meltMult().toFixed(1).replace('.', ',')}` : '');
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
    sign(bx + bw * .5, hy + 38 * U);
    // adagoló kapu (itt érkeznek a tárgyak)
    const gx0 = L.spawnX - (L.maxW / 2 + 3 * U), gx1 = L.spawnX + (L.maxW / 2 + 3 * U);
    R(gx0, hy, 2 * U, 7 * U, '#4a4a5e'); R(gx1 - 2 * U, hy, 2 * U, 7 * U, '#4a4a5e'); hazard(gx0, hy + 7 * U, gx1 - gx0, 2 * U);
  }

  function paintGrind(sc) { // kétnyelű aprítógép (shredder) keresztmetszete
    const L = sc.L, ft = L.ft, cw = L.cw, hy = 13 * U, bh = L.bh, r = L.r, cy = L.cy, cx0 = L.cx0, cx1 = L.cx1;
    const HB = ['#cfe6fb', '#7db2e8', '#4f8cd0', '#2f5f9a'], BL = ['#4f8cf0', '#1c58d0', '#0e3590'];
    steel(0, 0, cw, ft); steel(W - cw, 0, cw, ft); steel(0, 0, W, hy); beamRivets();
    R(cw, hy, W - 2 * cw, ft - hy, '#1a1b22'); // sötét vágókamra
    const xlAt = y => L.xTL + (L.xBL - L.xTL) * (y - L.topY) / (L.botY - L.topY), xrAt = y => L.xTR + (L.xBR - L.xTR) * (y - L.topY) / (L.botY - L.topY);
    for (let y = L.topY; y < L.botY; y += U) { // tölcsér: csavarozott világoskék lemezek, merevítőbordákkal
      const xl = xlAt(y), xr = xrAt(y), row = ((y - L.topY) / U) | 0;
      R(cw, y, xl - cw - 2 * U, U, row % 12 === 0 ? HB[3] : HB[2]); R(xr + 2 * U, y, W - cw - xr - 2 * U, U, row % 12 === 0 ? HB[3] : HB[2]);
      R(xl - 2 * U, y, 4 * U, U, HB[1]); R(xl + U, y, U, U, HB[0]); R(xl - 2 * U, y, U, U, HB[3]);
      R(xr - 2 * U, y, 4 * U, U, HB[1]); R(xr - 2 * U, y, U, U, HB[0]); R(xr + U, y, U, U, HB[3]);
      if (row % 7 === 3) { R(xl - U, y, U, U, '#e8f2ff'); R(xr, y, U, U, '#e8f2ff'); }
    }
    R(cw, L.topY - 5 * U, W - 2 * cw, 5 * U, HB[1]); R(cw, L.topY - 5 * U, W - 2 * cw, U, HB[0]); R(cw, L.topY - U, W - 2 * cw, U, HB[3]); // felső perem
    R(L.xTL + 4 * U, L.topY - 4 * U, L.xTR - L.xTL - 8 * U, 2 * U, '#7a4a3a');                                                      // kopásálló lemez
    for (let x = cw + 3 * U; x < W - cw - 3 * U; x += 6 * U) R(x, L.topY - 4 * U, U, U, '#e8f2ff');
    for (const [x0, x1] of [[cw, cx0], [cx1, W - cw]]) { // vágókamra oldalfalai + bordák
      R(x0, L.botY, x1 - x0, ft - L.botY, HB[2]);
      for (let y = L.botY + 8 * U; y < ft - 6 * U; y += 12 * U) R(x0, y, x1 - x0, U, HB[3]);
    }
    R(cx0 - 5 * U, L.botY, 5 * U, ft - L.botY, HB[1]); R(cx0 - 5 * U, L.botY, U, ft - L.botY, HB[0]); R(cx1, L.botY, 5 * U, ft - L.botY, HB[1]); R(cx1 + 4 * U, L.botY, U, ft - L.botY, HB[3]);
    for (let y = L.botY + 4 * U; y < ft - 4 * U; y += 8 * U) { R(cx0 - 3 * U, y, U, U, '#e8f2ff'); R(cx1 + 2 * U, y, U, U, '#e8f2ff'); }
    const podH = r * 1.15;
    for (const side of [-1, 1]) { // kék hidraulikus hajtásfejek (hajtómű) a tengelyek végén
      const x0 = side < 0 ? cw + 3 * U : cx1 + 7 * U, x1 = side < 0 ? cx0 - 7 * U : W - cw - 3 * U, w = x1 - x0, top = cy - podH / 2;
      if (w < 6 * U) continue;
      R(x0, top, w, podH, BL[1]); R(x0, top, w, 2 * U, BL[0]); R(x0, top + podH - 2 * U, w, 2 * U, BL[2]);
      for (let k = 1; k < 3; k++) R(x0 + k * w / 3, top, U, podH, BL[2]);
      const fx = side < 0 ? x1 - 3 * U : x0, ex = side < 0 ? x0 - U : x1 - U;   // karima a ház felől, véglap kívül
      R(fx, top - 2 * U, 3 * U, podH + 4 * U, HB[1]); R(fx, top - 2 * U, 3 * U, U, HB[0]);
      for (let yy = top; yy < top + podH; yy += 5 * U) R(fx + U, yy, U, U, '#e8f2ff');
      R(ex, top + podH * .2, U, podH * .6, BL[2]);
      const px = x0 + w * .35; // könyökcső + piros szelep + tömlő a peremig
      R(px, top - 9 * U, 3 * U, 9 * U, BL[1]); R(px - U, top - 11 * U, 5 * U, 3 * U, '#e03030'); R(px, top - 12 * U, 3 * U, U, '#ffd0d0'); pipeV(px + U, L.topY, top - 11 * U, 2);
      const yx = (x0 + x1) / 2 - 2 * U, y0 = cy + podH / 2 + 4 * U, y1 = ft - bh - 3 * U; // sárga munkahenger
      if (y1 - y0 > 8 * U) { R(yx - U, y1, 6 * U, 3 * U, '#3a3a4e'); R(yx, y0, 4 * U, y1 - y0, '#ffc21a'); R(yx, y0, U, y1 - y0, '#ffe27a'); R(yx, y0, 4 * U, U, '#1a1620'); R(yx + 3 * U, y0, U, y1 - y0, '#b88a10'); }
    }
    const roomy = (L.botY - L.topY) > 70 * U; // koponya- és figyelmeztető tábla, fogaskerék-ablakok az oldallemezeken
    if (roomy) { skull(cw + 6 * U, L.botY - 52 * U, '#3a0a0a', '#e8e0d0'); sign(W - cw - 14 * U, L.botY - 56 * U); }
    L.gw = [];
    for (const side of [-1, 1]) {
      const y = L.botY - 20 * U, xl = xlAt(y), xr = xrAt(y), avail = side < 0 ? xl - 2 * U - cw : W - cw - (xr + 2 * U);
      if (roomy && avail > 22 * U) {
        const w = Math.min(36 * U, avail - 6 * U), cxm = side < 0 ? cw + avail / 2 : xr + 2 * U + avail / 2;
        R(cxm - w / 2 - U, y - 11 * U, w + 2 * U, 22 * U, '#0a0810'); R(cxm - w / 2, y - 10 * U, w, 20 * U, '#101218'); L.gw.push({ x: cxm, y, w });
      }
    }
  }

  const JUNK_E = ['🚗', '🛞', '🛢️', '🪑', '🚚', '🧰', '📺', '🛋️', '✈️', '🚲', '🧱', '🗄️', '🚌', '📦', '🚽', '🛁'];
  function paintYard(sc) { // óriási szemétdomb, gyárak a horizonton, daru-pálya, a gépek tölcsérei
    const L = sc.L, ft = L.ft, cw = L.cw, hy = 13 * U, bh = L.bh, COLS = { press: '#7fb2ff', grind: '#ffb15c', melt: '#ff6b5c' };
    const sg = cc.createLinearGradient(0, 0, 0, ft); sg.addColorStop(0, '#0b0814'); sg.addColorStop(.7, '#241a30'); sg.addColorStop(1, '#3a2438');
    cc.fillStyle = sg; cc.fillRect(0, 0, W + U, H + U);
    cc.fillStyle = '#d8d0ee'; cc.beginPath(); cc.arc(W * .84, H * .2, 9 * U, 0, 7); cc.fill(); R(W * .84 - 4 * U, H * .2 - 2 * U, 3 * U, 3 * U, '#b8b0d0'); R(W * .84 + U, H * .2 + 2 * U, 2 * U, 2 * U, '#b8b0d0');
    for (let x = 0; x < W; x += 6 * U) { const h = 10 * U + hs(x, 3) * 22 * U; R(x, ft - h - H * .08, 6 * U, h + H * .08, '#150f1e'); if (hs(x, 9) > .8) R(x + 2 * U, ft - h - H * .08 - 10 * U, 2 * U, 10 * U, '#150f1e'); } // gyár-sziluettek
    const mt = (amp, base, col, seed) => { const end = L.rWall + 20 * U; for (let x = 0; x < end; x += 2 * U) { const t = x / end, env = Math.sin(Math.PI * Math.min(1, t * 1.05)), h = base + amp * (hs(Math.floor(x / (6 * U)), seed) * .6 + .4) * env; R(x, ft - h, 2 * U, h, col); } };
    mt(H * .22, H * .12, '#1c1626', 5); mt(H * .16, H * .09, '#161120', 11); // a hulladékhegy két rétege
    for (let i = 0; i < 26; i++) { // sötét szemét-sziluettek a hegyen
      const sz = 22 + hs(i, 3) * 36, x = L.pl0 + hs(i, 1) * (L.pl1 - L.pl0), y = ft - H * .1 - hs(i, 2) * H * .2, sp = emojiSprite({ e: JUNK_E[i % JUNK_E.length] }, Math.round(sz / U), Math.round(sz / U)), tn = tinted(sp, '#241c30', 'sil');
      cc.drawImage(tn, x - sz / 2, y - sz / 2, tn.width * U, tn.height * U);
    }
    R(0, ft, W + U, L.fh + U, '#3a2a22'); R(0, ft, W + U, U, '#6a5040'); for (let x = 0; x < W; x += 7 * U) if (hs(x, 4) > .5) R(x, ft + 2 * U + hs(x, 6) * 6 * U, 2 * U, U, '#5a4034');
    hazard(0, H - 3 * U, W + U, 3 * U);
    steel(L.rWall, H * .30, 5 * U, ft - H * .30); hazard(L.rWall, H * .30 - 2 * U, 5 * U, 2 * U); // támfal
    steel(0, 0, cw, ft); steel(W - cw, 0, cw, ft); steel(0, 0, W, hy); beamRivets();
    R(cw, hy + U, W - 2 * cw, 3 * U, '#6a6a80'); R(cw, hy + U, W - 2 * cw, U, '#a4a4bc'); R(cw, hy + 4 * U, W - 2 * cw, U, '#25252f'); // daru-sín
    for (const k of KINDS) { // a gépek torkai
      const t = L.thr[k], col = COLS[k], x0 = t.x - t.hw / 2, pw = Math.max(6 * U, t.hw * .34), fh = 12 * U, py = t.mouth - 22 * U;
      for (let y = 0; y < fh; y += U) { const f = y / fh, w = t.hw - (t.hw - pw) * f; R(t.x - w / 2, t.mouth + y, w, U, '#3d3d4f'); R(t.x - w / 2, t.mouth + y, U, U, '#8a8aa4'); R(t.x + w / 2 - U, t.mouth + y, U, U, '#25252f'); }
      R(x0 - U, t.mouth - U, t.hw + 2 * U, 2 * U, col); hazard(x0, t.mouth - 3 * U, t.hw, 2 * U);
      pipeV(t.x - pw / 2, t.mouth + fh, ft - 8 * U, pw / U); R(t.x - pw / 2 - U, ft - 8 * U, pw + 2 * U, 8 * U, '#14111c');
      R(x0, py, t.hw, 16 * U, '#0e0b14'); R(x0, py, t.hw, U, col); R(x0, py + 15 * U, t.hw, U, col); R(x0, py, U, 16 * U, col); R(x0 + t.hw - U, py, U, 16 * U, col);
      label(LV[k].icon, t.x, py + 6 * U, 7 * U, '#fff'); label(LV[k].name, t.x, py + 12.5 * U, Math.min(4 * U, t.hw / (LV[k].name.length * .62)), col);
    }
    sign(L.pl0 + 14 * U, hy + 24 * U);
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
    skull(cw + 12 * U, L.beltY + L.bh + 14 * U, '#3a0a0a', '#e8e0d0'); sign(W - cw - 20 * U, hy + 38 * U);
    pipeV(W - cw - 6 * U, hy + 6 * U, L.lavaTop - 14 * U, 2); pipeH(W - cw - 24 * U, W - cw - 4 * U, L.lavaTop - 14 * U, 2);
    L.disp = { x: W - cw - 34 * U, y: hy + 14 * U, w: 28 * U, h: 16 * U };
    R(L.disp.x - U, L.disp.y - U, L.disp.w + 2 * U, L.disp.h + 2 * U, '#6a6a80'); R(L.disp.x, L.disp.y, L.disp.w, L.disp.h, '#0b1a0b');
  }

  // =====================================================================================
  //  DINAMIKUS RAJZ (kártyánként: háttérrész, előtér)
  // =====================================================================================
  function drawGrindParts(sc, dt) { // az oldalablakokban néhány fogaskerék forog
    const L = sc.L; sc.gAng += dt * bladeSpeed() * 60 * (.25 + .75 * sc.snd.load);
    for (const w of L.gw || []) {
      const r1 = Math.min(w.w * .27, 9 * U), r2 = r1 * .7, a = sc.gAng, hs2 = (r1 + r2) / 2;
      ctx.save(); ctx.beginPath(); ctx.rect(w.x - w.w / 2, w.y - 10 * U, w.w, 20 * U); ctx.clip();
      gear(w.x - hs2, w.y, r1, 10, a, '#8a90a8', .3); gear(w.x + hs2, w.y, r2, 8, -a * r1 / r2 + Math.PI / 8, '#a89080', .3);
      ctx.restore();
    }
  }
  const clampXY = (v, a, b) => Math.max(a, Math.min(b, v));
  const PCOL = ['#6a6f88', '#8a6a6a', '#a04a4a', '#c03030'], RCOL = ['#8a8070', '#a89078', '#c07a50', '#e05030'];
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
  function drawRotor(r, ang, alpha) { // négykarú, kampós vágótárcsa (a kampók a forgás irányába hajlanak)
    const bt = Math.max(12, 13 * S), R0 = r.r, sy = r.dir, y = v => v * sy;
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(r.home.x, r.home.y); ctx.rotate(ang);
    for (let i = 0; i < 4; i++) {
      ctx.save(); ctx.rotate(i * Math.PI / 2); ctx.beginPath(); // tompa, vaskos fog: kerekített hegy, rövid váll
      ctx.moveTo(R0 * .1, y(-bt * .65)); ctx.lineTo(R0 * .74, y(-bt * .65));
      ctx.quadraticCurveTo(R0 * 1.02, y(-bt * .65), R0 * 1.03, y(-bt * .05));
      ctx.quadraticCurveTo(R0 * 1.03, y(bt * .8), R0 * .88, y(bt * .95));
      ctx.lineTo(R0 * .62, y(bt * .95)); ctx.lineTo(R0 * .52, y(bt * .65)); ctx.lineTo(R0 * .1, y(bt * .65)); ctx.closePath();
      ctx.fillStyle = RCOL[tier('grind')]; ctx.fill(); ctx.lineWidth = U; ctx.strokeStyle = '#0a0810'; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fillRect(R0 * .14, y(-bt * .5), R0 * .46, U);
      ctx.restore();
    }
    if (alpha === 1) {
      ctx.beginPath(); ctx.arc(0, 0, R0 * .34, 0, 7); ctx.fillStyle = '#3a3d52'; ctx.fill(); ctx.lineWidth = U; ctx.strokeStyle = '#0a0810'; ctx.stroke();
      ctx.fillStyle = '#c8cce0'; for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; ctx.fillRect(Math.cos(a) * R0 * .24 - U / 2, Math.sin(a) * R0 * .24 - U / 2, U, U); }
      ctx.fillStyle = '#ff9f1c'; ctx.beginPath(); ctx.arc(0, 0, R0 * .1, 0, 7); ctx.fill();
    }
    ctx.restore();
  }
  function beacon(x, y, on, col, now) {
    const f = on ? Math.sin(now / 70) > 0 : Math.sin(now / 350) > .75;
    R(x - 2 * U, y - 2 * U, 4 * U, 4 * U, f ? col : '#3a1010'); R(x - 2 * U, y - 2 * U, 4 * U, U, f ? '#fff' : '#5a2020');
    if (f) { ctx.fillStyle = col + '44'; ctx.beginPath(); ctx.arc(x, y, 8 * U, 0, 7); ctx.fill(); }
  }

  const DRAW = {
    yard: {
      back(sc, dt, al, now) {
        const L = sc.L, c = sc.cr;
        for (const k of KINDS) { // állapotlámpák + kiemelés, ha a markoló fölötte van
          const t = L.thr[k], free = scenes[k].feedFree(), py = t.mouth - 22 * U, over = c.hold && sc.throatAt(c.gx, c.gy) === k;
          R(t.x - U, py - 4 * U, 2 * U, 2 * U, free ? '#3cff3c' : '#ff3030');
          if (over) { ctx.fillStyle = 'rgba(150,255,150,.22)'; ctx.fillRect(q(t.x - t.hw / 2), q(t.mouth - 18 * U), q(t.hw), 30 * U); const bob = Math.sin(now / 120) * 2 * U; R(t.x - U, t.mouth - 9 * U + bob, 2 * U, 3 * U, '#9aff9a'); R(t.x - 2 * U, t.mouth - 7 * U + bob, 4 * U, U, '#9aff9a'); }
        }
        if (c.pending || c.touch) { const x = clampXY(c.aimX, L.cw, W - L.cw), y = clampXY(c.aimY, L.railY, L.ft); R(x - 4 * U, y, 3 * U, U, '#ffe03c'); R(x + U, y, 3 * U, U, '#ffe03c'); R(x, y - 4 * U, U, 3 * U, '#ffe03c'); R(x, y + U, U, 3 * U, '#ffe03c'); } // célkereszt
      },
      front(sc, dt, al, now) {
        const L = sc.L, c = sc.cr, cl = Math.max(32, 56 * S);
        for (const it of sc.items) { if (it.carried || !orderWants(it)) continue; if (Math.sin(now / 250 + it.position.x) > -.3) label('★', it.position.x, it.bounds.min.y - 3 * U, 6 * U, '#ffe03c'); } // ★ = megbízáshoz kell
        if (sc.hover && !c.hold) { const b = sc.hover.bounds, a = Math.sin(now / 150) > 0 ? 2 * U : 3 * U, x0 = b.min.x - a, x1 = b.max.x + a, y0 = b.min.y - a, y1 = b.max.y + a, k = 4 * U, col = '#ffe03c'; // célkeret
          R(x0, y0, k, U, col); R(x0, y0, U, k, col); R(x1 - k, y0, k, U, col); R(x1 - U, y0, U, k, col); R(x0, y1 - U, k, U, col); R(x0, y1 - k, U, k, col); R(x1 - k, y1 - U, k, U, col); R(x1 - U, y1 - k, U, k, col); }
        const ty = L.railY, x = c.x; // futómacska + kötél
        R(x - 7 * U, ty - 3 * U, 14 * U, 7 * U, '#4a4a5e'); R(x - 7 * U, ty - 3 * U, 14 * U, U, '#a4a4bc'); R(x - 5 * U, ty + 4 * U, 3 * U, 2 * U, '#25252f'); R(x + 2 * U, ty + 4 * U, 3 * U, 2 * U, '#25252f'); R(x - U, ty - 5 * U, 2 * U, 2 * U, (Math.abs(c.vx) > .5 && Math.sin(now / 90) > 0) ? '#ffa020' : '#4a2a10');
        const dx = c.gx - x, dy = c.gy - (ty + 4 * U), n = Math.max(2, Math.ceil(Math.hypot(dx, dy) / (3 * U)));
        for (let i = 0; i <= n; i++) R(x + dx * i / n, ty + 4 * U + dy * i / n, U * 1.5, 2 * U, i % 2 ? '#8a8aa0' : '#4a4a5e');
        ctx.save(); ctx.translate(c.gx, c.gy); ctx.rotate(-c.ang); // markoló: hidraulikus rudak nyitják-zárják a karmokat
        const hw = 7 * U, a = c.a + (c.miss > 0 ? Math.sin(now / 40) * .06 : 0), lw = Math.max(3 * U, cl * .17), g = jawGeom(a, cl, hw);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (const s of [-1, 1]) {
          const px = s * hw, jx = s * g.jx, tx = s * g.tx;
          ctx.strokeStyle = '#0a0810'; ctx.lineWidth = 3 * U; ctx.beginPath(); ctx.moveTo(s * 2 * U, -3 * U); ctx.lineTo(jx, g.jy * .85); ctx.stroke(); // hidraulikus rúd
          ctx.strokeStyle = '#c8cce0'; ctx.lineWidth = 1.6 * U; ctx.stroke();
          ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(jx, g.jy); ctx.lineTo(tx, g.ty); // karom: váll → könyök → hegy
          ctx.strokeStyle = '#0a0810'; ctx.lineWidth = lw + 2 * U; ctx.stroke(); ctx.strokeStyle = '#ff9f1c'; ctx.lineWidth = lw; ctx.stroke();
          ctx.strokeStyle = '#ffd88a'; ctx.lineWidth = U; ctx.beginPath(); ctx.moveTo(px, -U); ctx.lineTo(jx, g.jy - U); ctx.stroke();
          ctx.fillStyle = '#e8e0f5'; ctx.fillRect(tx - U, g.ty - U, 2 * U, 2 * U);                                                          // karomhegy
          ctx.fillStyle = '#3a3d52'; ctx.fillRect(px - U, -U, 2 * U, 2 * U); ctx.fillRect(jx - U, g.jy - U, 2 * U, 2 * U);                  // csuklócsapok
        }
        ctx.lineCap = 'butt';
        ctx.fillStyle = '#0a0810'; ctx.fillRect(-hw - U, -6 * U, 2 * hw + 2 * U, 9 * U); ctx.fillStyle = '#c0701a'; ctx.fillRect(-hw, -5 * U, 2 * hw, 7 * U); // agy (henger-ház)
        ctx.fillStyle = '#ffb347'; ctx.fillRect(-hw, -5 * U, 2 * hw, U); ctx.fillStyle = '#3a3d52'; ctx.fillRect(-2 * U, -4 * U, 4 * U, 5 * U);
        ctx.restore();
      }
    },
    press: {
      back(sc, dt, al, now, lerp) {
        const L = sc.L, p = sc.plate, s = sc.snd; drawBelts(sc, now);
        const fr = c01((p.position.y - p.restY) / (p.botY - p.restY)); // a lemez mélysége
        if (fr > 0) { ctx.fillStyle = `rgba(0,0,0,${(.5 * fr).toFixed(2)})`; ctx.fillRect(q(L.plL), q(L.ft - L.bh - 3 * U), q(L.pw), 3 * U + L.bh); } // egyre sötétebb árnyék
        for (let y = L.hy + 6 * U; y < L.ft - 4 * U; y += 5 * U) { // LED-létra az oszlopokon: a lemez helyzetét mutatja
          const col = y < p.position.y ? (y > L.ft * .7 ? '#ff4040' : y > L.ft * .45 ? '#ffe03c' : '#3cff3c') : '#1d1d28';
          R(L.cw / 2 - U, y, 2 * U, 2 * U, col); R(W - L.cw / 2 - U, y, 2 * U, 2 * U, col);
        }
        if ((p.pp.ph === 'down' || p.pp.ph === 'hold') && Math.random() < .25) sc.puff(W / 2 + (Math.random() < .5 ? -1 : 1) * W * .035, L.cylB, 1, '#e8ecf5', 1.4); // gőz a hengerből
        if (p.pp.ph === 'hold' && Math.random() < .3) sc.P(W / 2 + rnd(-W * .03, W * .03), L.cylB + 2 * U, rnd(-8, 8), 20, .8, '#e0a020', { g: 500 });                // olajcseppek
        const py = lerp(p.py == null ? p.position.y : p.py, p.position.y) - L.ph / 2, rw = q(W * .07), rx = W / 2, hy = L.hy;
        R(rx - rw / 2, L.cylB, rw, py - L.cylB + U, '#9aa0b8'); R(rx - rw / 2, L.cylB, U, py - L.cylB, '#d6dbef'); R(rx + rw / 2 - U, L.cylB, U, py - L.cylB, '#5a5f78');
        for (const x of [L.rodL, L.rodR]) { R(x, hy + 10 * U, 2 * U, py - hy - 10 * U + U, '#9aa0b8'); R(x, hy + 10 * U, U, py - hy - 10 * U, '#d6dbef'); }
        R(rx - rw / 2 - U, L.cylB, rw + 2 * U, 2 * U, '#2c2540');
        // olajimpulzusok a nyomócsőben
        const y = hy + 16 * U, x0 = L.hx + L.cylW, x1 = L.bx + L.bw - 6 * U, ph = (now / 1000) * 40 * (.3 + s.press * 2) * (s.dir > 0 ? -1 : 1);
        for (let x = x0 + ((ph % (12 * U)) + 12 * U) % (12 * U); x < x1; x += 12 * U) R(x, y, 2 * U, 2 * U, '#e0a020');
        // lámpák + nyomásmérő a henger előlapján
        const phs = p.pp.ph, vmx = pressV(), lx = L.hx + 4 * U, ly = hy + 8 * U;
        R(lx - U, ly - U, 12 * U, 4 * U, '#0e0b14');
        R(lx, ly, 2 * U, 2 * U, phs === 'wait' ? '#3cff3c' : '#1d4a1d'); R(lx + 4 * U, ly, 2 * U, 2 * U, phs === 'up' ? '#ffe03c' : '#4a4a1d'); R(lx + 8 * U, ly, 2 * U, 2 * U, (phs === 'down' || phs === 'hold') ? '#ff3c3c' : '#4a1d1d');
        const gT = phs === 'hold' ? 1 : phs === 'down' ? p.pp.v / vmx * .8 : phs === 'up' ? .3 : 0; sc.gP += (gT - sc.gP) * Math.min(1, dt * 8);
        const gx = L.hx + L.cylW / 2, gy = hy + 27 * U, gr = 6 * U, na = -2.4 + sc.gP * 3.6 + (phs === 'hold' ? Math.sin(now / 40) * .06 : 0);
        ctx.beginPath(); ctx.arc(gx, gy, gr, 0, 7); ctx.fillStyle = '#e8e0f5'; ctx.fill(); ctx.lineWidth = U; ctx.strokeStyle = '#0a0810'; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + Math.cos(na) * gr * .8, gy + Math.sin(na) * gr * .8); ctx.strokeStyle = '#d02020'; ctx.lineWidth = U * .8; ctx.stroke();
        // gépterem: kijelző + ventilátor
        label(`${Math.round(sc.gP * 250)} BAR`, L.scrX, L.scrY, Math.min(5 * U, (L.bw - 12 * U) / 6), '#3cff3c');
        { const on = sc.cmd || sc.queued || p.pp.ph !== 'wait' || (st.auto && st.press >= 5), bxx = L.bx + L.bw / 2, byy = L.hy + 26 * U;
          R(bxx - 6 * U, byy - 5 * U, 12 * U, 10 * U, '#0e0b14'); ctx.beginPath(); ctx.arc(bxx, byy, 4 * U, 0, 7); ctx.fillStyle = on ? '#ff5050' : '#7a1a1a'; ctx.fill(); ctx.lineWidth = U; ctx.strokeStyle = '#0a0810'; ctx.stroke();
          if (on) { ctx.fillStyle = '#ff303044'; ctx.beginPath(); ctx.arc(bxx, byy, 7 * U, 0, 7); ctx.fill(); } }
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
        const mv = p.pp.ph === 'down' || p.pp.ph === 'up', fl = Math.sin(now / 90) > 0; // villogó jelzőlámpák a lemezen
        R(px + 2 * U, py - 3 * U, 3 * U, 3 * U, mv && fl ? '#ffa020' : '#4a2a10'); R(px + pw - 5 * U, py - 3 * U, 3 * U, 3 * U, mv && !fl ? '#ffa020' : '#4a2a10');
        if (p.pp.ph === 'hold') { ctx.fillStyle = `rgba(255,140,40,${(.3 + .15 * Math.sin(now / 80)).toFixed(2)})`; ctx.fillRect(q(px), q(py + L.ph), q(pw), 3 * U); } // izzó nyomás-felület
      }
    },
    grind: {
      back(sc, dt, al, now) { drawBelts(sc, now); drawGrindParts(sc, dt); },
      front(sc, dt, al, now, lerp) {
        sc.rotors.forEach(r => { const ang = lerp(r.pa == null ? r.angle : r.pa, r.angle); drawRotor(r, ang - r.dir * .16, .25); drawRotor(r, ang - r.dir * .08, .35); drawRotor(r, ang, 1); });
      }
    },
    melt: {
      back(sc, dt, al, now) {
        const L = sc.L, ft = L.ft, T = sc.temp, tf = c01((T - 300) / 1700); drawBelts(sc, now);
        const g = ctx.createLinearGradient(0, L.ay, 0, L.ay - L.ar * 1.2); g.addColorStop(0, `rgba(255,100,20,${(.55 * tf).toFixed(2)})`); g.addColorStop(1, 'rgba(255,60,10,0)');
        ctx.fillStyle = g; ctx.fillRect(q(L.ax - L.ar), q(L.ay - L.ar * 1.2), q(L.ar * 2), q(L.ar * 1.2));
        const cl = lavaCols(tf);
        const tx = W * .5 + Math.sin(now / 3200) * W * .28, rail = 13 * U + 10 * U, len = H * .1 + Math.sin(now / 1500) * H * .03; // daru
        R(tx - 6 * U, rail - 2 * U, 12 * U, 4 * U, '#4a4a5e'); R(tx - 6 * U, rail - 2 * U, 12 * U, U, '#a4a4bc');
        for (let y = rail + 2 * U; y < rail + len; y += 2 * U) R(tx, y, U, U, (y / U) % 4 ? '#8a8aa0' : '#4a4a5e');
        R(tx - 6 * U, rail + len, 12 * U, 6 * U, '#4a4a5e'); R(tx - 6 * U, rail + len, 12 * U, U, '#8a8aa4'); R(tx - 5 * U, rail + len + U, 10 * U, U, cl[0]);
        for (let x = L.cw; x < W - L.cw; x += 2 * U) { // láva: színe a hőmérséklettől függ, hidegen kihűlt kéreg
          const t = L.lavaTop + Math.sin(now / 400 + x * .08) * U * 1.4 * (.3 + tf), h = ft - t;
          R(x, t, 2 * U, h, cl[2]); R(x, t + h * .55, 2 * U, h, cl[3]); R(x, t, 2 * U, 1.2 * U, cl[0]); R(x, t + 1.2 * U, 2 * U, U, cl[1]);
          if (T < 700 && hs(x, 7) < .6) R(x, t, 2 * U, 2 * U, '#241818');
        }
        if (Math.random() < .35 * tf) sc.P(rnd(L.cw, W - L.cw), L.lavaTop, rnd(-10, 10), -rnd(30, 90), rnd(.6, 1.2), '#ffb347', { g: 40 });
        if (Math.random() < .12 * tf) sc.puff(rnd(L.cw, W - L.cw), L.lavaTop - 4, 1, '#7a7a90', 1.8);
        const d = L.disp; // digitális hőmérséklet-kijelző
        label(`${Math.round(T)}°C`, d.x + d.w / 2, d.y + 5.5 * U, Math.min(7 * U, d.w / 5), T > 1800 ? '#ff5050' : '#3cff3c');
        label(st.tset ? '→' + st.tset + '°' : 'KI!', d.x + d.w / 2, d.y + 12 * U, Math.min(5 * U, d.w / 7), st.tset && T < st.tset - 30 ? '#ffe03c' : '#9aff9a');
      },
      front(sc, dt, al, now) {
        const L = sc.L, ft = L.ft, T = sc.temp, tf = c01((T - 300) / 1700);
        ctx.fillStyle = `rgba(255,80,20,${(.1 + .3 * tf).toFixed(2)})`; ctx.fillRect(q(L.cw), q(L.lavaTop + 2 * U), q(W - 2 * L.cw), ft - L.lavaTop - 2 * U);
        if (tf > .3) { // lángszórók a falakból – a hőfokkal erősödnek
          const jets = [[L.cw, 1, ft - H * .30, 0], [W - L.cw, -1, ft - H * .22, 1.4], [L.cw, 1, ft - H * .16, 2.6], [W - L.cw, -1, ft - H * .36, 3.3]];
          const maxLen = W * (.2 + .015 * Math.min(10, st.melt)) * tf;
          for (const [x, dir, y, ph0] of jets) {
            const ph = ((now / 1000) + ph0) % 4.5; if (ph > 1.3 || (y < L.beltY + 20 * U && x < L.beltEnd)) continue;
            const len = maxLen * Math.sin(ph / 1.3 * Math.PI);
            for (let i = 0; i < len; i += U) { const f = i / maxLen, hgt = (4 * (1 - f * .7) + Math.random() * 2) * U; R(x + dir * i, y - hgt / 2, U, hgt, f < .25 ? '#ffe27a' : f < .55 ? '#ff9a1f' : '#e03a14'); }
            if (Math.random() < .3) sc.P(x + dir * len, y, dir * rnd(20, 60), -rnd(20, 60), rnd(.3, .6), '#ffb347', { g: 40 });
          }
        }
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createLinearGradient(0, L.lavaTop, 0, L.lavaTop - H * .3); g.addColorStop(0, `rgba(255,90,20,${(.28 * tf).toFixed(2)})`); g.addColorStop(1, 'rgba(255,90,20,0)');
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
    if (sc.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${sc.flash.toFixed(2)})`; ctx.fillRect(0, 0, W, H); sc.flash = Math.max(0, sc.flash - dt * 1.8); } // becsapódási villanás

    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i]; s.t -= dt; if (s.t <= 0) { sparks.splice(i, 1); continue; }
      s.vy += s.g * dt; s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.k === 'r') { const f = 1 - s.t / s.t0; ctx.globalAlpha = .7 * (1 - f); ctx.strokeStyle = s.c; ctx.lineWidth = U * 1.5; ctx.beginPath(); ctx.ellipse(s.x, s.y, s.sz * f, s.sz * f * .16, 0, 0, 7); ctx.stroke(); ctx.globalAlpha = 1; }
      else if (s.k === 'd') { const sz = U * (s.sz + (1 - s.t / s.t0) * s.grow); ctx.globalAlpha = Math.min(.6, s.t / s.t0 * .9); R(s.x - sz / 2, s.y - sz / 2, sz, sz, s.c); ctx.globalAlpha = 1; }
      else R(s.x, s.y, U * s.sz, U * s.sz, s.c);
    }
    const act = sc.kind === 'press' ? sc.plate.pp.ph === 'down' || sc.plate.pp.ph === 'hold' : sc.kind === 'grind' ? sc.snd.load > .3 : sc.temp > 800;
    beacon(W - L.cw - 8 * U, 6.5 * U, act, '#ff3030', now);

    for (const b of items) { // nevek
      if (b.gen > 0 || sc.kind === 'yard') continue;
      const sel = (sc.drag && sc.drag.b === b) || sc.hover === b;
      if (sel || now < b.labelT || (st.names && items.length <= 30)) textBox(b.name, b.position.x, b.bounds.min.y - 13 * U, sel ? '#ffb11a' : '#6b4fa0');
    }
    const sel = sc.drag ? sc.drag.b : sc.hover;
    if (sel && sel.alive) textBox(sc.kind === 'yard' ? `${sel.name} · ár: ${buyCost(sel.def) ? fmt(buyCost(sel.def)) : 'ingyen'} → érték: ${fmt(sel.value)}` : `${sel.name} · ${fmt(sel.value)} · ${Math.max(0, Math.ceil(sel.hp))}/${Math.ceil(sel.maxHp)} HP`, W / 2, 24 * U, '#ffb11a');
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
    const sc = scenes[cur], s = sc.snd, on = st.sfx && !paused && !!AC && view !== 'orders', t = AC.currentTime, set = (g, v) => g.gain.setTargetAtTime(on ? v : 0, t, .06);
    const pk = cur === 'press', gk = cur === 'grind', mk = cur === 'melt', pr = (pk || cur === 'yard') ? s.press : 0;
    set(A.hyd.g, .07 * pr); A.hyd.o.frequency.setTargetAtTime(55 + 90 * pr, t, .08);
    set(A.whine.g, .012 * pr); A.whine.o.frequency.setTargetAtTime(220 + 520 * pr * (s.dir > 0 ? 1 : .6), t, .08);
    set(A.hiss.g, pk && s.dir > 0 ? .02 * pr : 0);
    s.load += ((s.hit > 0 ? 1 : 0) - s.load) * Math.min(1, dt * 6);
    KINDS.forEach(k => { if (k !== cur) scenes[k].snd.load += ((scenes[k].snd.hit > 0 ? 1 : 0) - scenes[k].snd.load) * Math.min(1, dt * 6); scenes[k].snd.hit = 0; });
    set(A.motor.g, gk ? .035 + .03 * s.load : 0); A.motor.o.frequency.setTargetAtTime(38 + (bladeSpeed() - .11) * 200 + 14 * s.load, t, .1);
    set(A.grn.g, gk ? .07 * s.load : 0);
    set(A.melt.g, mk ? (.01 + .05 * c01((sc.temp - 200) / 1500)) * (.6 + .4 * Math.min(1, s.meltN / 3)) : 0);
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

  let last = performance.now(), acc = 0, hudTxt = '';
  function frame(t) {
    const dt = Math.min(100, t - last); last = t;
    if (!paused) { acc += dt; let n = 0; while (acc >= 1000 / 60 && n < 4) { ALL.forEach(k => scenes[k].step()); acc -= 1000 / 60; n++; } if (n === 4) acc = 0; }
    if (view === 'melt') { // hőmérséklet-kijelző a lábléc-vezérlőn
      const T = scenes.melt.temp, txt = `🌡 ${Math.round(T)} °C → ${st.tset ? st.tset + ' °C' : 'KI'} · 🔥 ${fuelPerSec(T).toFixed(1).replace('.', ',')} Ft/mp`;
      if (txt !== hudTxt) { hudTxt = txt; $('tempRead').textContent = txt; }
    }
    if (view === 'yard') { // a daru állapota a láblécben
      const yc = scenes.yard.cr, h = yc.hold || scenes.yard.hover;
      const txt = yc.hold ? `🤏 ${yc.hold.name} · ${buyCost(yc.hold.def) ? fmt(buyCost(yc.hold.def)) : 'ingyen'} → vidd egy torok fölé, majd engedd el` : h ? `🎯 ${h.name} · ár ${buyCost(h.def) ? fmt(buyCost(h.def)) : 'ingyen'} → érték ${fmt(h.value)}` : '👆 Érintsd meg, hová menjen a markoló – ott megfogja a tárgyat. Utána érintsd meg a kívánt gép torkát.';
      if (txt !== hudTxt) { hudTxt = txt; $('yardInfo').textContent = txt; }
    }
    renderScene(scenes[cur], dt / 1000, paused ? 1 : Math.min(1, acc / (1000 / 60)));
    audioTick(dt / 1000); requestAnimationFrame(frame);
  }
  function resize() {
    W = wrap.clientWidth; H = wrap.clientHeight; if (!W || !H) return;
    U = Math.max(2, Math.round(Math.min(W, H) / 200)); lw = Math.ceil(W / U); lh = Math.ceil(H / U); cv.width = lw; cv.height = lh;
    S = Math.max(.45, Math.min(1.2, W / 800, H / 520));
    ALL.forEach(k => {
      const sc = scenes[k]; sc.endDrag(); sc.build();
      sc.items.slice().forEach(b => { if (b.position.x > W || b.position.y > H || b.position.x < 0) sc.kill(b, 'melt', true); });
      if (k === 'yard') sc.topUp(44);
    });
  }
  new ResizeObserver(resize).observe(wrap);

  const menu = $('menu');
  $('btnMenu').onclick = () => { menu.classList.remove('hide'); paused = true; };
  $('btnPlay').onclick = () => { menu.classList.add('hide'); paused = false; audioInit(); };
  $('chkNames').checked = st.names; $('chkNames').onchange = e => { st.names = e.target.checked; save(); };
  $('chkSfx').checked = st.sfx; $('chkSfx').onchange = e => { st.sfx = e.target.checked; save(); };
  $('btnReset').onclick = () => { if (confirm('Biztosan törlöd az egész mentést (pénz, szint, megbízások, adósság)?')) { try { localStorage.removeItem(SAVE); } catch (e) {} location.reload(); } };
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

  ALL.forEach(k => { scenes[k] = makeScene(k); });
  ensureOrders(); ui(); resize(); requestAnimationFrame(frame);
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
