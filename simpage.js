// Simulator page: write a build by clicking the race's tech, run it through the economy simulator (sim.js),
// and watch it play out on a map against another build: workers mine, buildings and units appear when the
// simulation makes them, and one side attacks at a chosen time.
// Fights are a rough model, not the game's combat: army strength is the resources spent on fighting units,
// static defence adds a fixed amount, the defender gets a 20% home advantage, and the bigger side wins by the
// square law (sqrt(a² − d²) survives). Everything on the map is a pure function of game time, so it can be scrubbed.
(function () {
  'use strict';

  const App = window.SCApp, SIM = window.SC_SIM, BUILDS = window.SC_BUILDS;
  const DATA = { sc2: window.SC2_DATA, bw: window.BW_DATA };
  const ICONS = window.SC_ICONS || {};
  const root = document.getElementById('simView');
  const HORIZON = 600;                 // game seconds simulated (10:00)
  const HOME = 1.2, WALK = 40, FD = 12, RAID = 30;
  const COL = { me: '#4ea1ff', opp: '#ff5c5c' };
  const NONCOMBAT = new Set(['overlord', 'overseer', 'observer', 'shuttle', 'dropship', 'medivac', 'prism', 'mule', 'nuke', 'scv', 'probe', 'drone']);
  const STATIC = { bunker: 4, cannon: 3, sunken: 4, spine: 4, pf: 6, battery: 1 };
  const SMALL = new Set(['depot', 'pylon', 'creep', 'sunken', 'spore', 'spine', 'cannon', 'turret', 'bunker', 'battery']);
  const DEFENCE = new Set(['bunker', 'cannon', 'creep', 'sunken', 'spore', 'spine', 'turret', 'battery']);
  const SUPPLY = new Set(['depot', 'pylon']);

  const fmt = (s) => { const r = Math.max(0, Math.round(s)); return Math.floor(r / 60) + ':' + String(r % 60).padStart(2, '0'); };
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const spread = (i, r = 13) => { const a = i * 2.4, d = r * Math.sqrt(i + 0.5); return { x: Math.cos(a) * d, y: Math.sin(a) * d }; };
  const add = (p, q, k = 1) => ({ x: p.x + q.x * k, y: p.y + q.y * k });
  const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  const h = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const k in attrs) {
      if (attrs[k] == null || attrs[k] === false) continue;
      if (k === 'class') e.className = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    kids.flat().forEach((c) => c != null && e.append(c.nodeType ? c : String(c)));
    return e;
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  const iconSrc = (game, race, id) => ICONS[game + '/' + race + '/' + id] || null;
  const IMG = new Map();
  const img = (src) => {
    if (!src) return null;
    if (!IMG.has(src)) { const im = new Image(); im.src = src; im.onload = () => paintSoon(); IMG.set(src, im); }
    const im = IMG.get(src);
    return im.complete && im.naturalWidth ? im : null;
  };

  /* ---------- the map, in one player's own frame (their base on the left of a 1600 × 480 map) ---------- */
  const MW = 1600, MH = 480;
  const SITE = [
    { x: 150, y: 240, ang: [130, 230], gey: [[118, 112], [118, 368]] },
    { x: 520, y: 118, ang: [200, 340], gey: [[404, 132], [636, 132]] },
    { x: 520, y: 362, ang: [20, 160], gey: [[404, 348], [636, 348]] },
    { x: 700, y: 175, ang: [200, 340], gey: [[610, 196], [790, 196]] },
    { x: 700, y: 305, ang: [20, 160], gey: [[610, 284], [790, 284]] },
  ];
  const patchesOf = (site, n) => Array.from({ length: n }, (_, i) => {
    const a = (site.ang[0] + (site.ang[1] - site.ang[0]) * i / (n - 1)) * Math.PI / 180;
    return { x: site.x + 92 * Math.cos(a), y: site.y + 92 * Math.sin(a) };
  });
  const PROD = [[236, 118], [236, 362], [296, 118], [296, 362], [236, 178], [236, 302], [296, 178], [296, 302], [180, 150], [180, 330], [60, 70], [60, 410]];
  const SUP = [];
  for (let x = 320; x >= 170; x -= 30) SUP.push([x, 66], [x, 414]);
  for (const x of [26, 52]) for (const y of [96, 124, 152, 328, 356, 384]) SUP.push([x, y]);
  const DEF = { ramp: [[300, 200], [300, 280], [270, 240], [266, 184], [266, 296], [236, 240]], nat: [[618, 196], [584, 230], [648, 160], [556, 256], [612, 250]] };
  const RALLY = { main: { x: 262, y: 240 }, nat: { x: 452, y: 196 } };
  const FIGHT = { ramp: { x: 440, y: 240 }, nat: { x: 640, y: 212 } };
  const mir = (p) => ({ x: MW - p.x, y: p.y });

  function route(g, p) {
    const kf = [{ g, x: p.x, y: p.y }];
    const R = {
      kf,
      get end() { return kf[kf.length - 1].g; },
      to(q, speed = WALK) { const L = kf[kf.length - 1], d = Math.hypot(q.x - L.x, q.y - L.y); kf.push({ g: L.g + d / speed, x: q.x, y: q.y }); return R; },
      wait(until, atk) { const L = kf[kf.length - 1]; if (atk) L.atk = atk; if (until > L.g) kf.push({ g: until, x: L.x, y: L.y, atk }); return R; },
    };
    return R;
  }
  function posAt(kf, g) {
    if (g <= kf[0].g) return { x: kf[0].x, y: kf[0].y, atk: null, dx: 1, dy: 0 };
    for (let i = 0; i < kf.length - 1; i++) {
      const A = kf[i], B = kf[i + 1];
      if (g <= B.g) { const k = (g - A.g) / ((B.g - A.g) || 1); return { x: lerp(A.x, B.x, k), y: lerp(A.y, B.y, k), atk: A.atk || null, dx: B.x - A.x, dy: B.y - A.y }; }
    }
    const L = kf[kf.length - 1];
    return { x: L.x, y: L.y, atk: L.atk || null, dx: 0, dy: 0 };
  }

  /* ---------- builds ---------- */
  const presets = (game, race) => (BUILDS[game] || {})[race] || [];
  const expand = (steps) => steps.flatMap(([sup, id, count = 1]) => Array.from({ length: count }, () => [sup, id]));
  const myKey = (game, race) => `sctt-sim/${game}/${race}`;
  function myBuild(game, race) {
    const saved = store.get(myKey(game, race), null);
    if (saved && Array.isArray(saved.steps)) return saved;
    const p = presets(game, race)[0];
    return { steps: p ? expand(p.steps) : [], from: p ? p.id : null };
  }
  const saveMine = (game, race, b) => store.set(myKey(game, race), b);
  const defaultCap = (game) => (game === 'bw' ? 30 : 44);
  function simulate(game, race, steps, cap, keep) {
    const nodes = DATA[game][race].nodes;
    return SIM.simulate(nodes, game, race, { steps }, { workerTarget: cap, gasPerGeyser: 3, economy: {}, until: HORIZON, keep });
  }

  /* ---------- one build, laid out on the map ---------- */
  function model(game, race, sim) {
    const nodes = DATA[game][race].nodes, byId = new Map(nodes.map((n) => [n.id, n]));
    const R = SIM.RACE[race], nPatch = game === 'bw' ? 9 : 8, nGey = game === 'bw' ? 1 : 2;
    const P = { game, race, sim, R, byId, nPatch, nGey, blds: [], bases: [], gases: [], units: [], workers: [], zerg: race === 'zerg' };
    const icon = (id) => iconSrc(game, race, id);
    let prod = 0, sup = 0;
    const defN = { ramp: 0, nat: 0 };
    const addB = (b) => { b.k = P.blds.length; b.morphs = []; P.blds.push(b); return b; };
    const main = addB({ id: R.base, begun: -1, done: 0, site: 0, x: SITE[0].x, y: SITE[0].y, base: true });
    P.bases.push(main);
    // workers: the ones you start with, then every one the simulation trains
    for (let i = 0; i < sim.startWorkers; i++) P.workers.push({ born: 0, k: i, jobs: [] });
    sim.workerLog.forEach((w) => P.workers.push({ born: w.end, k: P.workers.length, jobs: [] }));
    const nowId = (b, t) => { let id = b.id; for (const m of b.morphs) if (t >= m.t1) id = m.id; return id; };
    const finalId = (b) => (b.morphs.length ? b.morphs[b.morphs.length - 1].id : b.id);
    P.nowId = nowId;
    // a worker for a building: Terran SCVs stay until it's done, Probes just place it, Drones become it
    function builder(t, b, dur) {
      const cands = P.workers.filter((w) => w.born <= t && !(w.gone <= t) && !w.jobs.some((j) => j.s <= t + 3 && j.e >= t));
      const w = cands[cands.length - 1];
      if (!w) return;
      if (race === 'zerg') { w.jobs.push({ s: t, e: t + 4, x: b.x, y: b.y }); w.gone = t + 4; }
      else w.jobs.push({ s: t, e: race === 'terran' ? t + dur : t + 4, x: b.x + 20, y: b.y + 20 });
    }
    sim.rows.forEach((r) => {
      if (r.start == null || !r.node) return;
      const n = r.node;
      if (n.t === 'b') {
        if (n.via === 'Add-on') {
          const host = P.blds.find((b) => b.id === n.from && !b.addon && b.done <= r.start + 1) || P.blds.find((b) => b.id === n.from);
          if (!host) return;
          host.addon = addB({ id: n.id, begun: r.start, done: r.end, x: host.x + 32, y: host.y + 12, small: true, icon: icon(n.id) });
          return;
        }
        if (n.from && /Morph|Upgrade/.test(n.via || '')) {
          const host = P.blds.find((b) => finalId(b) === n.from && b.done <= r.start + 1);
          if (host) host.morphs.push({ t0: r.start, t1: r.end, id: n.id });
          return;
        }
        let b;
        if (n.id === R.base) {
          const s = Math.min(P.bases.length, SITE.length - 1);
          b = addB({ id: n.id, begun: r.start, done: r.end, site: P.bases.length, x: SITE[s].x, y: SITE[s].y, base: true });
          P.bases.push(b);
        } else if (n.id === R.gas) {
          const per = {};
          P.gases.forEach((g) => (per[g.site] = (per[g.site] || 0) + 1));
          const base = P.bases.find((x) => (per[x.site] || 0) < nGey && x.begun <= r.start + 1) || P.bases[0];
          const slot = per[base.site] || 0, s = SITE[Math.min(base.site, SITE.length - 1)];
          const [x, y] = s.gey[nGey === 1 ? 0 : slot] || s.gey[0];
          b = addB({ id: n.id, begun: r.start, done: r.end, x, y, site: base.site, gas: P.gases.length });
          P.gases.push(b);
        } else if (DEFENCE.has(n.id)) {
          const nat = P.bases[1] && P.bases[1].begun < r.start, mode = nat ? 'nat' : 'ramp';
          const [x, y] = DEF[mode][defN[mode]++ % DEF[mode].length];
          b = addB({ id: n.id, begun: r.start, done: r.end, x, y, mode, small: true });
        } else if (SUPPLY.has(n.id)) {
          const [x, y] = SUP[sup++ % SUP.length];
          b = addB({ id: n.id, begun: r.start, done: r.end, x, y, small: true });
        } else {
          const [x, y] = PROD[prod] || [380 + (prod % 3) * 44, 40 + Math.floor(prod / 3) * 44]; prod++;
          b = addB({ id: n.id, begun: r.start, done: r.end, x, y });
        }
        if (!n.from) builder(r.start, b, r.end - r.start);
      } else if (n.t === 'u' && n.id !== R.worker) {
        addUnit(n, r.start, r.end);
      }
    });
    (sim.extra || []).forEach((e) => addUnit(e.node, e.start, e.end));
    function addUnit(n, start, end) {
      const fromNode = byId.get(n.from);
      if (fromNode && fromNode.t === 'u') {                       // morphs and merges use up units
        const need = /Merge 2/.test(n.via || '') ? 2 : 1;
        P.units.filter((u) => u.id === n.from && u.born <= start && !(u.gone <= start)).slice(0, need).forEach((u) => (u.gone = start));
      }
      const pair = /pair/.test(n.via || '') ? 2 : 1;
      const at = (fromNode && fromNode.t === 'b' && P.blds.find((b) => finalId(b) === n.from || b.id === n.from)) || main;
      const val = NONCOMBAT.has(n.id) ? 0 : ((n.m || 0) + 1.5 * (n.g || 0)) / 50 / pair;
      for (let i = 0; i < pair; i++) P.units.push({ id: n.id, born: end, k: P.units.length, at, val, air: n.id === 'overlord' || n.id === 'overseer', icon: icon(n.id) });
    }
    P.blds.forEach((b) => { b.icon = icon(b.id); });
    plan(P);
    return P;
  }

  // who mines where, second by second: two per patch at full rate (three allowed), three per refinery,
  // the same number on gas as the simulation; workers on a building job are off the minerals
  function plan(P) {
    const cap = P.nPatch * 2, over = P.nPatch * 3;
    P.workers.forEach((w) => { w.hist = []; w.cur = null; });
    for (let s = 0; s <= HORIZON; s++) {
      const snap = P.sim.secs[Math.min(s, P.sim.secs.length - 1)] || { gasWorkers: 0 };
      const bases = P.bases.filter((b) => b.done <= s).map((b) => 'b' + b.site), refs = P.gases.filter((g) => g.done <= s).map((g) => 'r' + g.gas);
      const alive = P.workers.filter((w) => w.born <= s && !(w.gone <= s) && !w.jobs.some((j) => j.s <= s && s < j.e));
      P.workers.forEach((w) => { if (!alive.includes(w)) w.cur = null; });
      const load = {}; [...bases, ...refs].forEach((k) => (load[k] = 0));
      alive.forEach((w) => { if (w.cur && w.cur in load) load[w.cur]++; else w.cur = null; });
      const want = Math.min(snap.gasWorkers || 0, refs.length * 3);
      let onGas = refs.reduce((a, k) => a + load[k], 0);
      const freeRef = () => refs.find((k) => load[k] < 3);
      for (const w of alive) {
        if (w.cur) continue;
        if (onGas < want && freeRef()) { w.cur = freeRef(); load[w.cur]++; onGas++; continue; }
        if (!bases.length) continue;
        const b = bases.find((x) => load[x] < cap) || bases.reduce((a, x) => (load[x] < load[a] ? x : a), bases[0]);
        w.cur = b; load[b]++;
      }
      while (onGas < want && freeRef()) {
        const b = bases.reduce((a, x) => (load[x] > load[a] ? x : a), bases[0]);
        const w = [...alive].reverse().find((x) => x.cur === b); if (!w) break;
        load[b]--; w.cur = freeRef(); load[w.cur]++; onGas++;
      }
      while (onGas > want) {
        const r = refs.find((k) => load[k] > 0); if (!r) break;
        const w = alive.find((x) => x.cur === r); load[r]--; onGas--;
        const b = bases.find((x) => load[x] < over) || bases[0]; w.cur = b; if (b) load[b]++;
      }
      for (let g = 0; g < 60; g++) {
        const o = bases.find((b) => load[b] > cap), u = bases.find((b) => load[b] < cap);
        if (!o || !u) break;
        const w = [...alive].reverse().find((x) => x.cur === o); if (!w) break;
        load[o]--; w.cur = u; load[u]++;
      }
      alive.forEach((w) => { const L = w.hist[w.hist.length - 1]; if (!L || L.site !== w.cur) w.hist.push({ s, site: w.cur, from: L ? L.site : null }); });
    }
  }
  const siteOf = (P, key) => {
    if (!key) return SITE[0];
    if (key[0] === 'b') return SITE[Math.min(+key.slice(1), SITE.length - 1)];
    return SITE[Math.min(P.gases[+key.slice(1)].site, SITE.length - 1)];
  };
  function workerAt(P, w, g) {
    const job = w.jobs.find((j) => j.s <= g && g < j.e + 3);
    let h = null;
    for (const x of w.hist) { if (x.s <= g) h = x; else break; }
    const home = h && h.site ? siteOf(P, h.site) : SITE[0];
    if (job) {
      const k = clamp((g - job.s) / 3), back = clamp((g - job.e) / 3);
      if (g < job.e) return { x: lerp(home.x + 30, job.x, k), y: lerp(home.y, job.y, k), carry: false };
      return { x: lerp(job.x, home.x + 30, back), y: lerp(job.y, home.y, back), carry: false };
    }
    if (!h || !h.site) return { x: SITE[0].x + 34, y: SITE[0].y + 14, carry: false };
    const to = home;
    if (h.from && h.from !== h.site) {
      const fr = siteOf(P, h.from), k = (g - h.s) / (dist(fr, to) / 34);
      if (k < 1) return { x: lerp(fr.x, to.x, k), y: lerp(fr.y + 18, to.y + 18, k), carry: false };
    }
    let res;
    if (h.site[0] === 'r') { const r = P.gases[+h.site.slice(1)]; res = { x: r.x, y: r.y }; }
    else res = patchesOf(to, P.nPatch)[(w.k * 4) % P.nPatch];
    const Tm = 7, ph = ((g - w.born) + hash(w.k) * Tm) % Tm;
    const ax = to.x + (res.x - to.x) * 0.34, ay = to.y + (res.y - to.y) * 0.34, bx = res.x + (to.x - res.x) * 0.14, by = res.y + (to.y - res.y) * 0.14;
    const jit = (hash(w.k + 7) - 0.5) * 8;
    if (ph < 2.6) { const k = ph / 2.6; return { x: lerp(ax, bx, k) + jit * 0.3, y: lerp(ay, by, k) + jit * 0.3, carry: false }; }
    if (ph < 4) return { x: bx + Math.sin(ph * 9) * 1.2, y: by, carry: false };
    const k = (ph - 4) / 3;
    return { x: lerp(bx, ax, k) + jit * 0.3, y: lerp(by, ay, k) + jit * 0.3, carry: true };
  }
  const rallyAt = (P, g) => (P.bases[1] && P.bases[1].done <= g ? RALLY.nat : RALLY.main);

  /* ---------- strength at a moment ---------- */
  const aliveU = (u, t) => u.born <= t && !(u.gone <= t);
  const armyAt = (P, t) => P.units.reduce((a, u) => a + (aliveU(u, t) ? u.val : 0), 0);
  const staticAt = (P, t) => P.blds.reduce((a, b) => a + (b.done <= t ? (STATIC[P.nowId(b, t)] || 0) : 0), 0);
  function fight(a, d) {
    if (a < 0.05 && d < 0.05) return { w: 'none', a, d, left: 0 };
    if (a > d) return { w: 'atk', a, d, left: Math.sqrt(a * a - d * d) };
    return { w: 'def', a, d, left: Math.sqrt(d * d - a * a) };
  }
  function geometry(A, D, tA) {
    const nat = !!(D.bases[1] && D.bases[1].begun <= tA + 20);
    const fpD = nat ? FIGHT.nat : FIGHT.ramp, fpA = mir(fpD), slot = { x: fpA.x + 46, y: fpA.y };
    return { nat, fpD, fpA, slot, travel: dist(rallyAt(A, tA), slot) / WALK };
  }
  function outcome(A, D, tA) {
    const G = geometry(A, D, tA), tF = tA + G.travel;
    return { G, tF, f: fight(armyAt(A, tA), (armyAt(D, tF) + staticAt(D, tF)) * HOME) };
  }
  // The first decisive moment: at least 3 army and 1.4× the defence it meets. Failing that, the moment in the
  // first winning window that keeps the most army alive; failing that, the closest try.
  function bestTiming(A, D) {
    let best = null, ratio = 0, win = null, left = -1, w0 = null;
    for (let t = 30; t <= HORIZON - 70; t += 2) {
      const o = outcome(A, D, t);
      if (o.f.w === 'atk' && o.f.a >= 3 && o.f.a >= 1.4 * o.f.d) return { t, win: true };
      if (o.f.a < 0.5) continue;
      if (o.f.w === 'atk') {
        if (w0 == null) w0 = t;
        if (t - w0 <= 90 && o.f.left > left + 1e-6) { left = o.f.left; win = t; }
        continue;
      }
      const r = o.f.a / (o.f.d || 1);
      if (r > ratio) { ratio = r; best = t; }
    }
    return win != null ? { t: win, win: true } : { t: best ?? 240, win: false };
  }

  /* ---------- an attack, worked out ahead of time ---------- */
  function scene(A, D, tA, names) {
    const sc = { A, D, tA, u: new Map(), wDie: new Map(), b: new Map(), names };
    const o = outcome(A, D, tA), { G, f } = o, tF = o.tF, tR = tF + FD;
    Object.assign(sc, { G, f, tF, tR, none: f.a < 0.05 });
    const atkWins = !sc.none && f.w === 'atk';
    sc.atkWins = atkWins;
    const pa = sc.none ? [] : A.units.filter((u) => u.val > 0 && aliveU(u, tA));
    const pd = sc.none ? [] : D.units.filter((u) => u.val > 0 && aliveU(u, tF));
    const stat = sc.none ? [] : D.blds.filter((b) => b.done <= tF && STATIC[D.nowId(b, tF)]);
    const die = new Map();
    const kill = (list, keep, t0, t1) => {
      const sorted = [...list].sort((x, y) => x.val - y.val || x.k - y.k);
      let left = sorted.reduce((a, u) => a + u.val, 0);
      const dead = [];
      for (const u of sorted) { if (left - keep <= u.val / 2) break; dead.push(u); left -= u.val; }
      dead.sort((x, y) => hash(x.k + 3) - hash(y.k + 3)).forEach((u, i) => die.set(u, lerp(t0, t1, (i + 0.5) / dead.length)));
      return dead.length;
    };
    if (!sc.none) {
      if (atkWins) {
        sc.lostA = kill(pa, f.left, tF + 1, tF + FD * 0.8);
        pd.forEach((u, i) => die.set(u, lerp(tF + 1, tF + FD, (i + 0.5) / pd.length)));
        sc.lostD = pd.length;
        stat.forEach((b, i) => sc.b.set(b, { dies: tF + FD * (0.6 + 0.3 * i / Math.max(1, stat.length)), hp: [[tF + 1, 1], [tF + FD * 0.6, 0.3]] }));
      } else {
        pa.forEach((u, i) => die.set(u, lerp(tF + 1, tF + FD, (i + 0.5) / pa.length)));
        sc.lostA = pa.length;
        const statV = stat.reduce((a, b) => a + STATIC[D.nowId(b, tF)], 0);
        sc.lostD = kill(pd, Math.max(0, f.left / HOME - statV), tF + 1, tF + FD * 0.8);
        stat.forEach((b) => sc.b.set(b, { hp: [[tF + 1, 1], [tF + FD, clamp(1 - f.a / (f.d || 1) * 0.7, 0.2, 1)]] }));
      }
    }
    sc.unitsA = pa.length; sc.unitsD = pd.length;
    // the raid
    const s0 = Math.floor(tR + 6);
    const workersAt = (b) => D.workers.filter((w) => {
      if (w.born > s0 || w.gone <= s0) return false;
      let hh = null; for (const x of w.hist) { if (x.s <= s0) hh = x; else break; }
      return hh && hh.site && (hh.site === 'b' + b.site || (hh.site[0] === 'r' && D.gases[+hh.site.slice(1)].site === b.site));
    }).length;
    const nat = G.nat ? D.bases[1] : null;
    const raidBase = D.bases.filter((b) => b.done <= tR && b.site <= 1).reduce((a, b) => (workersAt(b) > workersAt(a) ? b : a), D.bases[0]);
    const natBuilding = null;   // raiders go straight for the workers
    const raidSite = SITE[Math.min(raidBase.site, SITE.length - 1)];
    sc.raidMain = raidBase === D.bases[0];
    let arrive = raidBase === nat ? 4 : 10;
    if (atkWins && natBuilding) {
      const down = tR + 4 + clamp(60 / f.left, 2, 12);
      sc.b.set(natBuilding, { dies: down, hp: [[tR + 4, 1], [down, 0.05]] }); sc.natDown = true;
      arrive = down - tR + 12; sc.natStop = down;
    }
    sc.killedW = 0;
    if (atkWins) {
      const P = f.left, rate = clamp(P * 0.09, 0.3, 1.5), s = Math.floor(tR + arrive), key = 'b' + raidBase.site;
      const here = D.workers.filter((w) => {
        if (w.born > s || w.gone <= s) return false;
        let hh = null; for (const x of w.hist) { if (x.s <= s) hh = x; else break; }
        return hh && hh.site && (hh.site === key || (hh.site[0] === 'r' && 'b' + D.gases[+hh.site.slice(1)].site === key));
      });
      const n = Math.min(here.length, Math.floor(rate * (RAID - arrive)));
      here.slice(0, n).forEach((w, j) => sc.wDie.set(w, tR + arrive + j / rate));
      sc.killedW = n;
      const fall = tR + arrive + clamp(220 / P, 5, 80);
      if (fall < tR + RAID) { sc.b.set(raidBase, { dies: fall, hp: [[tR + arrive, 1], [fall, 0.05]] }); sc.baseDead = true; }
      else sc.b.set(raidBase, { hp: [[tR + arrive, 1], [tR + RAID, clamp(1 - RAID / (fall - tR), 0.1, 1)]] });
    }
    sc.end = sc.none ? tA + 16 : atkWins ? tR + RAID : tR + 14;
    sc.H = Math.ceil(sc.end + 4);
    sc.verdictAt = sc.none ? tA + 2 : atkWins ? tR + 12 : tR + 2;

    const homeSpot = (P, u) => (u.air ? { x: 70 + (u.k % 5) * 40, y: 36 + (u.k % 2) * 400 } : add(rallyAt(P, u.born), spread(u.k), 0.8));
    A.units.forEach((u) => {
      const out = { x: u.at.x + 28, y: u.at.y + (u.at.y < 240 ? 18 : -18) };
      const r = route(u.born, out).to(homeSpot(A, u));
      let dies = u.gone ?? Infinity;
      if (pa.includes(u)) {
        const i = pa.indexOf(u);
        r.wait(tA + hash(u.k) * 1.5).to(add(G.slot, spread(i, 12)));
        const tgt = { x: G.fpA.x - 40, y: G.fpA.y };
        if (die.has(u)) { dies = Math.max(die.get(u), r.end + 0.5); r.wait(dies + 1, tgt); }
        else {
          r.wait(tR, tgt);
          if (atkWins) {
            if (natBuilding) r.to(add(mir({ x: SITE[1].x + 50, y: SITE[1].y + 40 }), spread(i, 10))).wait(sc.natStop, mir(SITE[1]));
            if (sc.raidMain) r.to(add(mir({ x: 366, y: 240 }), spread(i, 6))).to(add(mir({ x: 230, y: 240 }), spread(i, 13)));
            else r.to(add(mir({ x: raidSite.x + 70, y: raidSite.y }), spread(i, 13)));
            r.wait(sc.H + 5, mir(raidSite));
          } else r.to(add(rallyAt(A, tR), spread(u.k), 0.8));
        }
      }
      sc.u.set(u, { r, dies });
    });
    D.units.forEach((u) => {
      const out = { x: u.at.x + 28, y: u.at.y + (u.at.y < 240 ? 18 : -18) };
      const r = route(u.born, out).to(homeSpot(D, u));
      let dies = u.gone ?? Infinity;
      if (pd.includes(u)) {
        const i = pd.indexOf(u), tgt = { x: G.fpD.x + 40, y: G.fpD.y };
        r.wait(Math.max(r.end, tA + G.travel * 0.35)).to(add({ x: G.fpD.x - 34, y: G.fpD.y }, spread(i, 12)));
        if (die.has(u)) { dies = Math.max(die.get(u), r.end + 0.5); r.wait(dies + 1, tgt); }
        else r.wait(tR + 2, tgt).to(add(rallyAt(D, tR), spread(u.k), 0.8));
      } else if (atkWins && u.val > 0 && u.born < sc.end && u.born > tF) {
        r.to(add({ x: raidSite.x + 60, y: raidSite.y }, spread(u.k % 7, 8)));
        dies = Math.max(r.end, tR) + 1; r.wait(dies + 1, raidSite);
      }
      sc.u.set(u, { r, dies });
    });

    const [nA, nD] = names;
    const vb = (who, one, you) => (who === 'You' ? you : one);
    const v1 = (x) => x.toFixed(x < 10 ? 1 : 0);
    if (sc.none) sc.verdict = { head: `${nA} ${vb(nA, 'has', 'have')} nothing to attack with`, cls: 'def', body: `At ${fmt(tA)} ${nA} ${vb(nA, 'has', 'have')} no fighting units yet. Try a later time, or Best.` };
    else if (atkWins) sc.verdict = {
      head: `${nA} ${vb(nA, 'breaks', 'break')} ${nD}`, cls: 'atk',
      body: `Moved out at ${fmt(tA)}, arrived ${fmt(tF)}: army ${v1(f.a)} into defence ${v1(f.d)}. Lost ${sc.lostA} of ${sc.unitsA} units${sc.natDown ? ', knocked down the expansion' : ''}, then killed ${sc.killedW} workers${sc.baseDead ? ` and the ${sc.raidMain ? 'main' : 'expansion'}` : ''}.`,
    };
    else sc.verdict = {
      head: `${nD} ${vb(nD, 'holds', 'hold')}`, cls: 'def',
      body: `${nA} moved out at ${fmt(tA)} with army ${v1(f.a)} into defence ${v1(f.d)} (units${stat.length ? ' + static defence' : ''} × ${HOME} at home), and lost all ${sc.unitsA} units. ${nD} lost ${sc.lostD}.`,
    };
    return sc;
  }

  /* ---------- drawing ---------- */
  function painter(cv) {
    const g = cv.getContext('2d');
    let ground = null, groundKey = '';
    const S = () => cv.width / MW;
    const X = (p, flip) => ({ x: flip ? MW - p.x : p.x, y: p.y });
    function terrain(nL, nR) {
      const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height;
      const q = c.getContext('2d'), s = S();
      q.setTransform(s, 0, 0, s, 0, 0);
      q.fillStyle = '#10161f'; q.fillRect(0, 0, MW, MH);
      for (let i = 0; i < 110; i++) { q.fillStyle = 'rgba(255,255,255,.022)'; q.beginPath(); q.arc(hash(i) * MW, hash(i + 99) * MH, 6 + hash(i + 3) * 34, 0, 7); q.fill(); }
      q.strokeStyle = 'rgba(255,255,255,.05)'; q.setLineDash([6, 10]); q.beginPath(); q.moveTo(MW / 2, 10); q.lineTo(MW / 2, MH - 10); q.stroke(); q.setLineDash([]);
      [[false, nL], [true, nR]].forEach(([flip, P]) => {
        const T = (p) => X(p, flip);
        const a = T({ x: 8, y: 50 }), b = T({ x: 340, y: 430 });
        q.beginPath(); q.roundRect(Math.min(a.x, b.x), a.y, Math.abs(b.x - a.x), b.y - a.y, 26); q.fillStyle = '#1c2636'; q.fill(); q.strokeStyle = '#34445e'; q.lineWidth = 3; q.stroke();
        const r = [{ x: 330, y: 212 }, { x: 394, y: 202 }, { x: 394, y: 278 }, { x: 330, y: 268 }].map(T);
        q.beginPath(); r.forEach((p, i) => (i ? q.lineTo(p.x, p.y) : q.moveTo(p.x, p.y))); q.closePath(); q.fillStyle = '#18202e'; q.fill();
        for (let i = 1; i < 4; i++) { const p = T({ x: 330 + i * 16, y: 208 }), p2 = T({ x: 330 + i * 16, y: 272 }); q.strokeStyle = 'rgba(255,255,255,.07)'; q.lineWidth = 2; q.beginPath(); q.moveTo(p.x, p.y); q.lineTo(p2.x, p2.y); q.stroke(); }
        SITE.slice(0, 3).forEach((s) => {
          patchesOf(s, P.nPatch).forEach((p) => crystal(q, T(p)));
          s.gey.slice(0, P.nGey === 1 ? 1 : 2).forEach(([x, y]) => { const p = T({ x, y }); q.fillStyle = 'rgba(61,220,132,.2)'; q.beginPath(); q.ellipse(p.x, p.y, 17, 11, 0, 0, 7); q.fill(); q.strokeStyle = 'rgba(61,220,132,.5)'; q.lineWidth = 1.5; q.stroke(); });
        });
        q.font = '600 15px system-ui, sans-serif'; q.fillStyle = 'rgba(139,151,171,.65)'; q.textAlign = 'center';
        const m = T({ x: 174, y: 458 }); q.fillText('main base (high ground)', m.x, m.y);
        const rp = T({ x: 366, y: 312 }); q.fillText('ramp', rp.x, rp.y);
      });
      return c;
    }
    function crystal(q, p) {
      q.save(); q.translate(p.x, p.y); const s = 7;
      q.fillStyle = '#5fb7ff'; q.strokeStyle = '#cfeaff'; q.lineWidth = 1;
      for (const [dx, hh] of [[-s * 0.7, 1.1], [0, 1.6], [s * 0.7, 1]]) { q.beginPath(); q.moveTo(dx, -s * hh); q.lineTo(dx + s * 0.45, 0); q.lineTo(dx, s * 0.5); q.lineTo(dx - s * 0.45, 0); q.closePath(); q.fill(); q.stroke(); }
      q.restore();
    }
    const hpAt = (hp, t) => {
      if (!hp) return 1;
      if (t <= hp[0][0]) return hp[0][1];
      for (let i = 0; i < hp.length - 1; i++) if (t <= hp[i + 1][0]) return lerp(hp[i][1], hp[i + 1][1], (t - hp[i][0]) / (hp[i + 1][0] - hp[i][0]));
      return hp[hp.length - 1][1];
    };
    function iconBox(src, x, y, s, col, alpha = 1) {
      g.save(); g.globalAlpha = alpha;
      g.beginPath(); g.roundRect(x - s / 2, y - s / 2, s, s, s * 0.18); g.fillStyle = '#0b0f17'; g.fill();
      const im = img(src);
      if (im) { g.save(); g.clip(); g.drawImage(im, x - s / 2, y - s / 2, s, s); g.restore(); }
      g.lineWidth = Math.max(2, s * 0.07); g.strokeStyle = col; g.beginPath(); g.roundRect(x - s / 2, y - s / 2, s, s, s * 0.18); g.stroke();
      g.restore();
    }
    function building(P, b, flip, t, col, ov) {
      if (t < b.begun) return;
      const p = X(b, flip), dead = ov && ov.dies != null && t >= ov.dies;
      if (dead) {
        g.save(); g.globalAlpha = clamp(1 - (t - ov.dies) / 30, 0.35, 1); g.fillStyle = '#3b4255';
        for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(p.x + (hash(i + b.x) - 0.5) * 30, p.y + (hash(i + b.y) - 0.5) * 24, 4 + hash(i) * 5, 0, 7); g.fill(); }
        if (t - ov.dies < 4) { g.strokeStyle = `rgba(255,200,120,${1 - (t - ov.dies) / 4})`; g.lineWidth = 4; g.beginPath(); g.arc(p.x, p.y, 20 + (t - ov.dies) * 14, 0, 7); g.stroke(); }
        g.restore(); return;
      }
      const id = P.nowId(b, t), size = b.base ? 62 : b.small ? 30 : 42;
      const prog = b.done <= b.begun ? 1 : clamp((t - b.begun) / (b.done - b.begun));
      const morphing = b.morphs.find((m) => m.t0 <= t && t < m.t1);
      iconBox(iconSrc(P.game, P.race, id) || b.icon, p.x, p.y, size, col, prog < 1 ? 0.5 : 1);
      const ring = (k) => { g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.arc(p.x, p.y, size * 0.7, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); g.stroke(); };
      if (prog < 1) ring(prog);
      else if (morphing) ring((t - morphing.t0) / (morphing.t1 - morphing.t0));
      const f = hpAt(ov && ov.hp, t);
      if (prog >= 1 && f < 0.999) {
        const w = size, y = p.y + size / 2 + 4;
        g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(p.x - w / 2, y, w, 6); g.fillStyle = f > 0.5 ? col : '#ff6b6b'; g.fillRect(p.x - w / 2, y, w * f, 6);
      }
    }
    function puff(p, age, k = 1) {
      if (age > 4 || age < 0) return;
      const a = 1 - age / 4; g.strokeStyle = `rgba(230,236,255,${a})`; g.lineWidth = 2;
      g.beginPath(); g.arc(p.x, p.y, (6 + age * 6) * k, 0, 7); g.stroke();
      const s = 5 * k; g.beginPath(); g.moveTo(p.x - s, p.y - s); g.lineTo(p.x + s, p.y + s); g.moveTo(p.x + s, p.y - s); g.lineTo(p.x - s, p.y + s); g.stroke();
    }
    function side(P, flip, t, col, sc, list) {
      if (P.zerg) {   // creep under every Zerg building
        P.blds.forEach((b) => {
          if (t < b.begun || P.gases.includes(b) || (sc.b.get(b)?.dies <= t)) return;
          const p = X(b, flip), r = (b.base ? 120 : 60) * clamp((t - b.begun) / 20, 0.2, 1);
          const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r); gr.addColorStop(0, 'rgba(120,60,150,.45)'); gr.addColorStop(1, 'rgba(120,60,150,0)');
          g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, r, 0, 7); g.fill();
        });
      }
      P.blds.forEach((b) => building(P, b, flip, t, col, sc.b.get(b)));
      P.workers.forEach((w) => {
        if (t < w.born) return;
        const d = sc.wDie.get(w);
        if (w.gone != null && t >= w.gone) return;
        const st = workerAt(P, w, d != null ? Math.min(t, d) : t), p = X(st, flip);
        if (d != null && t >= d) { puff(p, t - d, 0.7); return; }
        g.fillStyle = col; g.strokeStyle = '#0b0f17'; g.lineWidth = 1.2;
        g.beginPath(); g.arc(p.x, p.y, 4.2, 0, 7); g.fill(); g.stroke();
        if (st.carry) { g.fillStyle = '#9fd6ff'; g.beginPath(); g.arc(p.x, p.y - 6.5, 2.3, 0, 7); g.fill(); }
      });
      P.units.forEach((u) => {
        if (t < u.born) return;
        const R = sc.u.get(u); if (!R) return;
        const st = posAt(R.r.kf, Math.min(t, R.dies)), p = X(st, flip);
        if (t >= R.dies) { if (!(u.gone <= t)) puff(p, t - R.dies); return; }
        const wob = st.atk ? Math.sin(t * 9 + u.k * 2) * 2.5 : 0;
        const r = u.air ? 13 : 10.5;
        const x = p.x + wob, y = p.y + (u.air ? Math.sin(t * 1.5 + u.k) * 2 : 0);
        g.beginPath(); g.arc(x, y, r, 0, 7); g.fillStyle = '#0b0f17'; g.fill();
        const im = img(u.icon);
        if (im) { g.save(); g.beginPath(); g.arc(x, y, r - 1.5, 0, 7); g.clip(); g.drawImage(im, x - r, y - r, r * 2, r * 2); g.restore(); }
        g.strokeStyle = col; g.lineWidth = 2.5; g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke();
        if (st.atk && ((t * 3 + u.k * 0.37) % 1) < 0.35) list.push({ p: { x, y }, k: u.k });
        list.all.push({ x, y });
      });
    }
    function shots(from, to, col) {
      from.forEach(({ p, k }) => {
        let best = null, bd = 220;
        to.all.forEach((q) => { const d = dist(p, q); if (d < bd) { bd = d; best = q; } });
        if (!best) return;
        g.strokeStyle = col; g.globalAlpha = 0.85; g.lineWidth = 1.6; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(best.x + (hash(k) - 0.5) * 8, best.y + (hash(k + 1) - 0.5) * 8); g.stroke(); g.globalAlpha = 1;
      });
    }
    function pill(text, x, y, size, col, bg = 'rgba(6,10,18,.88)') {
      g.font = `700 ${size}px system-ui, sans-serif`; const w = g.measureText(text).width + size * 1.4;
      g.fillStyle = bg; g.beginPath(); g.roundRect(x - w / 2, y - size * 0.95, w, size * 1.9, size * 0.95); g.fill();
      g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x, y + 1); g.textBaseline = 'alphabetic';
    }
    return function draw(sc, t, flipMe) {
      // the attacker plays on the left
      const key = sc.A.game + sc.A.nPatch + sc.A.nGey + '/' + sc.D.nPatch + sc.D.nGey + cv.width;
      if (!ground || key !== groundKey) { ground = terrain(sc.A, sc.D); groundKey = key; }
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); g.drawImage(ground, 0, 0);
      const s = S(); g.setTransform(s, 0, 0, s, 0, 0);
      const cA = sc.colA, cD = sc.colD;
      const la = []; la.all = []; const ld = []; ld.all = [];
      side(sc.A, false, t, cA, sc, la);
      side(sc.D, true, t, cD, sc, ld);
      shots(la, ld, cA); shots(ld, la, cD);
      if (!sc.none && t >= sc.tA - 8 && t < sc.tR) {
        const a = rallyAt(sc.A, sc.tA), b = sc.G.slot;
        g.globalAlpha = t < sc.tA ? clamp((t - sc.tA + 8) / 8) * 0.6 : 0.9;
        g.strokeStyle = cA; g.lineWidth = 4; g.setLineDash([14, 10]); g.lineDashOffset = -t * 20;
        g.beginPath(); g.moveTo(a.x + 20, a.y); g.lineTo(b.x - 10, b.y); g.stroke(); g.setLineDash([]);
        const ang = Math.atan2(b.y - a.y, b.x - a.x); g.fillStyle = cA; g.beginPath();
        g.moveTo(b.x, b.y); g.lineTo(b.x - 20 * Math.cos(ang - 0.5), b.y - 20 * Math.sin(ang - 0.5)); g.lineTo(b.x - 20 * Math.cos(ang + 0.5), b.y - 20 * Math.sin(ang + 0.5)); g.closePath(); g.fill();
        g.globalAlpha = 1;
      }
      g.font = '800 20px system-ui, sans-serif'; g.textAlign = 'left'; g.fillStyle = cA; g.fillText(`${sc.names[0]} · attacks`, 20, 30);
      g.textAlign = 'right'; g.fillStyle = cD; g.fillText(`defends · ${sc.names[1]}`, MW - 20, 30);
      pill(`game clock ${fmt(t)}`, MW / 2, 28, 21, '#ffd479');
      if (!sc.none) {
        const fp = mir(sc.G.fpD);
        if (t >= sc.tA - 8 && t < sc.tA) pill(`attack moves out at ${fmt(sc.tA)}`, MW / 2, MH - 30, 21, '#fff');
        else if (t >= sc.tA && t < sc.tF) pill(`moving out · lands at ${fmt(sc.tF)}`, MW / 2, MH - 30, 21, cA);
        else if (t >= sc.tF && t < sc.tR) {
          pill(`army ${sc.f.a.toFixed(1)}  vs  defence ${sc.f.d.toFixed(1)}`, fp.x, fp.y - 96, 19, '#fff');
          pill('FIGHT', fp.x, fp.y - 134, 17, '#0b0f17', '#ffd479');
        } else if (t >= sc.tR && sc.atkWins) pill(`workers killed: ${[...sc.wDie.values()].filter((d) => d <= t).length}`, MW / 2, MH - 30, 21, '#ff9a9a');
      }
      if (t >= sc.verdictAt) {
        const V = sc.verdict, col = V.cls === 'atk' ? cA : cD, cx = 410;
        g.globalAlpha = clamp((t - sc.verdictAt) / 2);
        g.fillStyle = 'rgba(6,10,18,.93)'; g.beginPath(); g.roundRect(cx - 370, 120, 740, 196, 16); g.fill(); g.strokeStyle = col; g.lineWidth = 3; g.stroke();
        g.fillStyle = col; g.font = '800 32px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText(V.head, cx, 168);
        g.font = '500 20px system-ui, sans-serif'; g.fillStyle = '#e6ecf5';
        const words = V.body.split(' '); let line = '', yy = 206;
        for (const wd of words) { const tt = line ? line + ' ' + wd : wd; if (g.measureText(tt).width > 680 && line) { g.fillText(line, cx, yy); line = wd; yy += 27; } else line = tt; }
        g.fillText(line, cx, yy);
        g.globalAlpha = 1;
      }
    };
  }

  /* ---------- the page ---------- */
  const ui = { sel: null, oppRace: null, oppBuild: null, who: 'me', when: 'best', t: 0, playing: false, speed: 8, keep: true, cap: null, game: null, race: null };
  let mine, simMe, simOpp, MOD = {}, sc = null, draw = null, canvas = null, els = {};
  let raf = 0, last = 0, pending = false;
  function paintSoon() { if (!pending && sc) { pending = true; requestAnimationFrame(() => { pending = false; paint(); }); } }

  function races(game) { return Object.keys(DATA[game]); }
  function oppOptions(game) {
    const out = [];
    races(game).forEach((r) => {
      presets(game, r).forEach((p) => out.push({ race: r, id: p.id, name: p.name, steps: expand(p.steps) }));
      const saved = store.get(myKey(game, r), null);
      if (saved && saved.steps && saved.steps.length) out.push({ race: r, id: 'mine', name: 'My saved build', steps: saved.steps, cap: saved.cap, keep: saved.keep });
    });
    return out;
  }

  function locks(game, race, steps, upto) {
    const nodes = DATA[game][race].nodes, have = new Set([SIM.RACE[race].base]);
    steps.slice(0, upto).forEach(([, id]) => have.add(id));
    const out = {};
    nodes.forEach((n) => {
      const miss = [...(n.req || []), ...(n.from ? [n.from] : [])].filter((id) => !have.has(id));
      if (miss.length) out[n.id] = miss.map((id) => DATA[game][race].nodes.find((x) => x.id === id)?.name || id);
    });
    return out;
  }

  function rerun() {
    const game = App.state.game, race = App.state.race;
    saveMine(game, race, mine);
    simMe = simulate(game, race, mine.steps, mine.cap ?? defaultCap(game), mine.keep ?? true);
    const opts = oppOptions(game), o = opts.find((x) => x.race === ui.oppRace && x.id === ui.oppBuild) || opts.find((x) => x.race === ui.oppRace) || opts[0];
    ui.oppRace = o.race; ui.oppBuild = o.id;
    simOpp = simulate(game, o.race, o.steps, o.cap ?? defaultCap(game), o.keep ?? true);
    MOD = { me: model(game, race, simMe), opp: model(game, o.race, simOpp), oppName: o.name, oppRace: o.race };
    restage(true);
  }
  function restage(reset) {
    const me = MOD.me, op = MOD.opp, game = App.state.game;
    const A = ui.who === 'me' ? me : op, D = ui.who === 'me' ? op : me;
    const meName = 'You (' + DATA[game][App.state.race].name + ')', opName = DATA[game][MOD.oppRace].name + ': ' + MOD.oppName;
    const names = ui.who === 'me' ? ['You', DATA[game][MOD.oppRace].name] : [DATA[game][MOD.oppRace].name, 'You'];
    if (App.state.race === MOD.oppRace) names[ui.who === 'me' ? 1 : 0] = 'Opponent';
    const best = bestTiming(A, D);
    const finishA = Math.max(30, Math.min(HORIZON - 70, Math.ceil((ui.who === 'me' ? simMe : simOpp).finish)));
    const tA = ui.when === 'best' ? best.t : ui.when === 'done' ? finishA : +ui.when;
    sc = scene(A, D, tA, names);
    sc.colA = ui.who === 'me' ? COL.me : COL.opp; sc.colD = ui.who === 'me' ? COL.opp : COL.me;
    els.when.replaceChildren(h('span', { class: 'sim-lbl' }, 'Attack at'),
      ...[['best', `${best.win ? 'Best' : 'Closest'} ${fmt(best.t)}`, best.win ? 'Inside the first winning window, the moment the attack keeps the most army alive (counting the walk across)' : 'This attack never wins in the first 10 minutes; this is its closest try'],
        ['done', `Build done ${fmt(finishA)}`, 'When the attacker’s last step finishes'], ...[180, 240, 300, 360, 420].map((v) => [String(v), fmt(v), ''])]
        .map(([v, l, tip]) => h('button', { type: 'button', class: String(ui.when) === v ? 'on' : '', title: tip || null, onclick: () => { ui.when = v; restage(true); } }, l)));
    els.scrub.max = sc.H;
    if (reset) { ui.t = 0; ui.playing = true; }
    ui.t = Math.min(ui.t, sc.H);
    renderTickers(meName, opName);
    paint();
    loop();
  }

  function chipRow(game, race, sim, label, col) {
    const box = h('div', { class: 'sim-ticker' });
    const head = h('div', { class: 'sim-ticker-h' }, h('b', { style: `color:${col}` }, label), h('span', { class: 'muted sim-now' }));
    const chips = sim.rows.map((r) => {
      const src = r.node && iconSrc(game, race, r.id);
      return h('span', { class: 'sim-chip' + (r.skipped ? ' bad' : ''), title: (r.node ? r.node.name : r.id) + (r.skipped ? ': ' + r.skipped : r.start != null ? ' at ' + fmt(r.start) : '') },
        h('b', {}, r.skipped ? '✕' : r.sup), src ? h('img', { src, alt: '' }) : h('i', {}, (r.node?.name || r.id).slice(0, 2)));
    });
    box.append(head, h('div', { class: 'sim-chips' }, chips));
    box._chips = chips; box._sim = sim; box._now = head.querySelector('.sim-now');
    return box;
  }
  function renderTickers(meName, opName) {
    const game = App.state.game;
    els.tickers.replaceChildren(
      chipRow(game, App.state.race, simMe, meName, COL.me),
      chipRow(game, MOD.oppRace, simOpp, opName, COL.opp));
  }

  function paint() {
    if (!sc || !draw) return;
    const t = ui.t;
    draw(sc, t);
    els.scrub.value = t;
    els.play.textContent = ui.playing ? '❚❚' : '▶';
    els.play.setAttribute('aria-label', ui.playing ? 'Pause' : 'Play');
    els.tickers.querySelectorAll('.sim-ticker').forEach((box) => {
      let cur = -1;
      box._sim.rows.forEach((r, i) => { const d = r.start != null && r.start <= t; box._chips[i].classList.toggle('done', d); if (d) cur = i; });
      box._chips.forEach((c, i) => c.classList.toggle('cur', i === cur));
      const r = box._sim.rows[cur];
      box._now.textContent = r ? `${fmt(r.start)} · ${r.sup} ${r.node.name}` : 'workers only so far';
    });
    const stat = (P, colr, who) => {
      const s = P.sim.secs[Math.min(Math.floor(t), P.sim.secs.length - 1)] || {};
      const ws = P.workers.filter((w) => w.born <= t && !(w.gone <= t) && !(sc.wDie.get(w) <= t)).length;
      const army = P.units.reduce((a, u) => a + (u.val > 0 && u.born <= t && !(sc.u.get(u)?.dies <= t) ? u.val : 0), 0);
      const st = P.blds.reduce((a, b) => a + (b.done <= t && !(sc.b.get(b)?.dies <= t) ? (STATIC[P.nowId(b, t)] || 0) : 0), 0);
      return h('div', { class: 'sim-side' }, h('i', { style: `background:${colr}` }), h('b', {}, who),
        h('span', {}, h('em', {}, Math.floor(s.min || 0)), ' minerals'), h('span', {}, h('em', {}, Math.floor(s.gas || 0)), ' gas'),
        h('span', {}, h('em', {}, ws), ' workers'), h('span', {}, h('em', {}, army.toFixed(army < 10 ? 1 : 0)), ' army' + (st ? ` + ${st} static` : '')));
    };
    els.hud.replaceChildren(h('div', { class: 'sim-clock' }, fmt(t)), stat(MOD.me, COL.me, 'You'), stat(MOD.opp, COL.opp, 'Opponent'));
  }
  function loop() {
    if (raf) return;
    last = performance.now();
    const step = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (App.state.page !== 'sim' || !ui.playing) { raf = 0; paint(); return; }
      ui.t = Math.min(sc.H, ui.t + dt * ui.speed);
      if (ui.t >= sc.H) ui.playing = false;
      paint();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  function renderEditor() {
    const game = App.state.game, race = App.state.race, nodes = DATA[game][race].nodes;
    const rows = simMe ? simMe.rows : [];
    const list = h('ol', { class: 'sim-steps' });
    mine.steps.forEach(([sup, id], i) => {
      const n = nodes.find((x) => x.id === id), r = rows[i], src = iconSrc(game, race, id);
      const supIn = h('input', { type: 'number', min: 1, max: 200, value: sup, 'aria-label': 'Supply trigger', class: 'sim-sup' });
      supIn.addEventListener('change', () => { mine.steps[i][0] = Math.max(1, +supIn.value || 1); refresh(); });
      supIn.addEventListener('click', (e) => e.stopPropagation());
      list.append(h('li', { class: (ui.sel === i ? 'sel ' : '') + (r && r.skipped ? 'skipped' : ''), onclick: () => { ui.sel = ui.sel === i ? null : i; renderEditor(); } },
        supIn, src ? h('img', { src, alt: '' }) : h('span', { class: 'sim-noicon' }),
        h('span', { class: 'sim-name' }, n ? n.name : id, r && r.skipped ? h('small', { class: 'warn' }, r.skipped) : null),
        h('span', { class: 'sim-time' }, r && r.start != null ? fmt(r.start) : '—'),
        h('span', { class: 'sim-btns' },
          h('button', { type: 'button', title: 'Move up', 'aria-label': 'Move up', disabled: i === 0 ? '' : null, onclick: (e) => { e.stopPropagation(); [mine.steps[i - 1], mine.steps[i]] = [mine.steps[i], mine.steps[i - 1]]; ui.sel = i - 1; refresh(); } }, '↑'),
          h('button', { type: 'button', title: 'Move down', 'aria-label': 'Move down', disabled: i === mine.steps.length - 1 ? '' : null, onclick: (e) => { e.stopPropagation(); [mine.steps[i + 1], mine.steps[i]] = [mine.steps[i], mine.steps[i + 1]]; ui.sel = i + 1; refresh(); } }, '↓'),
          h('button', { type: 'button', title: 'Remove', 'aria-label': 'Remove', onclick: (e) => { e.stopPropagation(); mine.steps.splice(i, 1); ui.sel = null; refresh(); } }, '×'))));
    });
    if (!mine.steps.length) list.append(h('li', { class: 'muted sim-empty' }, 'Empty. Click items below to add steps.'));

    const at = ui.sel == null ? mine.steps.length : ui.sel + 1;
    const lk = locks(game, race, mine.steps, at);
    const groups = [['b', 'Buildings'], ['u', 'Units'], ['g', 'Upgrades']].map(([t, label]) => {
      const items = nodes.filter((n) => n.t === t && n.id !== 'nuke');
      return h('div', { class: 'sim-group' }, h('h4', {}, label), h('div', { class: 'sim-pal' }, items.map((n) => {
        const src = iconSrc(game, race, n.id), miss = lk[n.id];
        return h('button', {
          type: 'button', class: 'sim-item' + (miss ? ' locked' : ''), title: n.name + (miss ? ' (needs ' + miss.join(', ') + ' first)' : ` · ${n.m || 0}/${n.g || 0}`),
          'aria-label': 'Add ' + n.name, onclick: () => (miss ? null : addStep(n.id)),
        }, src ? h('img', { src, alt: '' }) : h('span', {}, n.name.slice(0, 3)));
      })));
    });
    const pre = h('select', { 'aria-label': 'Start from a common build', onchange: (e) => {
      const v = e.target.value; if (!v) return;
      const p = presets(game, race).find((x) => x.id === v);
      mine = { steps: v === '__empty' ? [] : expand(p.steps), from: v, cap: mine.cap, keep: mine.keep }; ui.sel = null; refresh();
    } }, h('option', { value: '' }, 'Start from…'), presets(game, race).map((p) => h('option', { value: p.id }, p.name)), h('option', { value: '__empty' }, 'Empty build'));
    const cap = mine.cap ?? defaultCap(game);
    const workerName = nodes.find((n) => n.id === SIM.RACE[race].worker).name;
    const capIn = h('input', { type: 'range', min: SIM.ECONOMY[game].startWorkers, max: 80, value: cap });
    const capOut = h('output', {}, cap);
    capIn.addEventListener('input', () => { capOut.textContent = capIn.value; });
    capIn.addEventListener('change', () => { mine.cap = +capIn.value; refresh(); });
    const keep = h('input', { type: 'checkbox' }); keep.checked = mine.keep ?? true;
    keep.addEventListener('change', () => { mine.keep = keep.checked; refresh(); });
    els.editor.replaceChildren(
      h('div', { class: 'sim-ed-head' }, h('h3', {}, 'Your build'), pre),
      h('p', { class: 'muted small' }, ui.sel == null ? 'New steps go at the end. Click a step to insert after it.' : `New steps go after step ${ui.sel + 1}.`),
      list,
      h('div', { class: 'sim-opts' },
        h('label', {}, `${workerName}s (cap) `, capIn, capOut),
        h('label', { class: 'check' }, keep, 'Keep producing after the last step')),
      h('p', { class: 'muted small' }, 'The number is the supply count each step waits for. Greyed items need something earlier in the build first.'),
      ...groups);
  }
  function addStep(id) {
    const at = ui.sel == null ? mine.steps.length : ui.sel + 1;
    const prev = mine.steps[at - 1];
    const sup = prev ? prev[0] : SIM.ECONOMY[App.state.game].startWorkers;
    mine.steps.splice(at, 0, [sup, id]);
    ui.sel = at;
    refresh();
  }
  function refresh() { rerun(); renderEditor(); }

  function renderOpp() {
    const game = App.state.game, opts = oppOptions(game);
    const sel = h('select', { 'aria-label': 'Opponent build', onchange: (e) => { const [r, id] = e.target.value.split('|'); ui.oppRace = r; ui.oppBuild = id; rerun(); } },
      races(game).map((r) => h('optgroup', { label: DATA[game][r].name }, opts.filter((o) => o.race === r).map((o) => {
        const op = h('option', { value: r + '|' + o.id }, o.name + (o.id === 'mine' ? '' : ''));
        if (r === ui.oppRace && o.id === ui.oppBuild) op.selected = true;
        return op;
      }))));
    els.opp.replaceChildren(h('span', { class: 'sim-lbl' }, 'Opponent'), sel,
      h('span', { class: 'sim-lbl' }, 'Who attacks'),
      h('div', { class: 'seg' }, [['me', 'You'], ['opp', 'Opponent']].map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(ui.who === v), onclick: () => { ui.who = v; renderOpp(); restage(true); } }, l))));
  }

  function render() {
    if (App.state.page !== 'sim') { ui.playing = false; return; }
    const game = App.state.game, race = App.state.race;
    if (ui.game !== game || ui.race !== race || !root.firstChild) {
      ui.game = game; ui.race = race; ui.sel = null;
      mine = myBuild(game, race);
      const rs = races(game);
      if (!ui.oppRace || !DATA[game][ui.oppRace] || ui.oppGame !== game) { ui.oppRace = rs[(rs.indexOf(race) + 2) % rs.length]; ui.oppBuild = presets(game, ui.oppRace)[0]?.id; ui.oppGame = game; }
      build();
    }
    rerun(); renderEditor(); renderOpp();
  }
  function build() {
    root.replaceChildren();
    els.editor = h('section', { class: 'sim-editor', 'aria-label': 'Your build' });
    els.opp = h('div', { class: 'sim-opp' });
    els.when = h('div', { class: 'sim-when' });
    canvas = h('canvas', { class: 'sim-map', width: 1600 * 1.5, height: 480 * 1.5, role: 'img', 'aria-label': 'Both builds played out on a map' });
    canvas.addEventListener('click', () => { ui.playing = !ui.playing; if (ui.playing && ui.t >= sc.H) ui.t = 0; loop(); paint(); });
    draw = painter(canvas);
    els.play = h('button', { type: 'button', class: 'sim-play', onclick: () => { ui.playing = !ui.playing; if (ui.playing && ui.t >= sc.H) ui.t = 0; loop(); paint(); } }, '▶');
    els.scrub = h('input', { type: 'range', min: 0, max: 100, step: 0.5, value: 0, 'aria-label': 'Game clock', class: 'sim-scrub' });
    els.scrub.addEventListener('input', () => { ui.playing = false; ui.t = +els.scrub.value; paint(); });
    const speeds = h('div', { class: 'seg sim-speed' }, [4, 8, 16, 32].map((v) => h('button', { type: 'button', 'aria-pressed': String(ui.speed === v), title: `${v} game seconds per second`, onclick: (e) => { ui.speed = v; speeds.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); } }, '×' + v)));
    els.hud = h('div', { class: 'sim-hud' });
    els.tickers = h('div', { class: 'sim-tickers' });
    root.append(els.editor, h('section', { class: 'sim-stage' },
      h('header', { class: 'sim-top' }, els.opp, els.when),
      els.hud,
      h('div', { class: 'sim-map-wrap' }, canvas),
      h('div', { class: 'sim-transport' }, els.play, els.scrub, speeds),
      els.tickers,
      h('p', { class: 'muted small sim-note' }, 'Timings come from the same economy model as the Build Orders page. Fights are a rough model, not StarCraft’s combat: army strength is the minerals and gas spent on fighting units (gas counts 1.5×), static defence adds a fixed amount, the defender gets 20% for fighting at home, and the bigger side wins by the square law. Click the map to pause.')));
  }

  // From the tech tree and the Build Orders page.
  window.SCSim = {
    scene: () => sc,
    add(id) {
      const game = App.state.game, race = App.state.race, b = myBuild(game, race);
      const prev = b.steps[b.steps.length - 1];
      b.steps.push([prev ? prev[0] : SIM.ECONOMY[game].startWorkers, id]);
      saveMine(game, race, b);
      if (ui.game === game && ui.race === race) mine = b;
      return b.steps.length;
    },
    load(buildId) {
      const game = App.state.game, race = App.state.race, p = presets(game, race).find((x) => x.id === buildId);
      if (!p) return;
      const b = { steps: expand(p.steps), from: p.id };
      saveMine(game, race, b);
      ui.game = null;   // rebuild from the saved build when the page opens
    },
  };

  App.onChange(render);
  render();
})();
