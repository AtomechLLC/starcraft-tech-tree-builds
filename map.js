// The selected build order played out on a map. Pure drawing on top of sim.js's output: workers mine,
// buildings go up in their slots, add-ons attach, units gather at the ramp, research ticks on its building.
// Everything is a function of game time, so the clock can be scrubbed. window.__seekMap(t) shows second t.

(function () {
  'use strict';

  const MW = 1100, MH = 480;   // the visible part of the map, in map units: your half and the middle
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const fmt = (s) => { const r = Math.max(0, Math.floor(s)); return Math.floor(r / 60) + ':' + String(r % 60).padStart(2, '0'); };

  const SITES = [
    { x: 150, y: 240, ang: [130, 230] },   // main, on the high ground
    { x: 540, y: 112, ang: [200, 340] },   // natural
    { x: 540, y: 368, ang: [20, 160] },    // third
    { x: 860, y: 112, ang: [200, 340] },
  ];
  const GEYSERS = [[{ x: 112, y: 120 }, { x: 112, y: 360 }], [{ x: 430, y: 112 }, { x: 650, y: 112 }], [{ x: 430, y: 368 }, { x: 650, y: 368 }], [{ x: 750, y: 112 }, { x: 970, y: 112 }]];
  const grid = (xs, ys) => ys.flatMap((y) => xs.map((x) => ({ x, y })));
  const SLOTS = {
    prod: [...grid([236, 296], [102, 160, 320, 378]), ...grid([680, 740], [180, 300]), ...grid([420, 480], [190, 290]), ...grid([760, 820, 880], [400, 60])],
    small: [...grid([186, 218, 250, 282, 314], [64]), ...grid([186, 218, 250, 282, 314], [416]), ...Array.from({ length: 11 }, (_, i) => ({ x: 26, y: 90 + i * 30 })), ...grid([380, 410, 440, 640, 670, 700], [30, 450])],
    defence: [{ x: 322, y: 196 }, { x: 322, y: 284 }, { x: 440, y: 176 }, { x: 640, y: 176 }, { x: 440, y: 304 }, { x: 640, y: 304 }],
  };
  const SMALL = new Set(['depot', 'pylon', 'overlord', 'turret', 'spore', 'spine', 'sunken', 'cannon', 'battery', 'creep', 'evo', 'ebay', 'forge']);
  const DEFENCE = new Set(['bunker', 'cannon', 'turret', 'spine', 'spore', 'sunken', 'creep', 'battery', 'pf']);
  const SIZE = { base: 34, prod: 22, small: 15, defence: 16, addon: 12 };

  const imgs = {};
  function img(src) {
    if (!src) return null;
    if (!imgs[src]) { const i = new Image(); i.src = src; imgs[src] = i; }
    return imgs[src].complete && imgs[src].naturalWidth ? imgs[src] : null;
  }

  // Turn a simulated build into things that appear, change and finish on the map.
  function plan(sim, nodes, game, race, R) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const things = [], units = [], research = [];
    const bases = [{ id: R.base, site: 0, start: -1, end: 0, morphs: [], x: SITES[0].x, y: SITES[0].y }];
    const hosts = [];   // buildings that can take an add-on or a morph, by id
    let prod = 0, small = 0, def = 0, gasN = 0;
    bases[0].kind = 'base'; bases[0].node = byId.get(R.base); things.push(bases[0]);
    const unitPool = [];  // live units, for unit morphs
    sim.rows.forEach((r, i) => {
      const n = r.node;
      if (!n || r.skipped || r.start == null) return;
      const from = n.from && byId.get(n.from);
      if (n.t === 'g') { research.push({ node: n, start: r.start, end: r.end, at: n.from }); return; }
      if (n.t === 'u') {
        if (from && from.t === 'u') {   // a unit morph: the old unit becomes the new one
          const old = unitPool.find((u) => u.node.id === from.id && u.gone == null && u.end <= r.start);
          if (old) old.gone = r.start;
          const pair = /Merge 2/.test(n.via || '');
          if (pair) { const o2 = unitPool.find((u) => u.node.id === from.id && u.gone == null && u.end <= r.start); if (o2) o2.gone = r.start; }
        }
        const k = /pair/.test(n.via || '') ? 2 : 1;
        for (let j = 0; j < k; j++) { const u = { node: n, start: r.start, end: r.end, i: units.length }; units.push(u); unitPool.push(u); }
        return;
      }
      // buildings
      if (n.id === R.base) {
        const site = bases.length;
        const b = { kind: 'base', id: n.id, site, start: r.start, end: r.end, morphs: [], x: SITES[site % SITES.length].x, y: SITES[site % SITES.length].y, node: n };
        bases.push(b); things.push(b); return;
      }
      if (from && from.t === 'b' && (n.via === 'Add-on')) {
        const host = hosts.find((h) => h.node.id === from.id && !h.addon && h.end <= r.start) || hosts.find((h) => h.node.id === from.id && !h.addon)
          || (from.id === R.base ? things.find((t) => t.kind === 'base' && !t.addon) : null);
        const a = { kind: 'addon', node: n, start: r.start, end: r.end, host };
        if (host) host.addon = a;
        things.push(a); return;
      }
      if (from && from.t === 'b' && (n.via === 'Morph' || n.via === 'Upgrade')) {
        const host = things.find((t) => (t.node.id === from.id || (t.morphs.length && t.morphs[t.morphs.length - 1].node.id === from.id)) && t.morphs && !t.morphs.some((m) => m.node.id === n.id));
        if (host) { host.morphs.push({ node: n, start: r.start, end: r.end }); return; }
      }
      if (n.id === R.gas) {
        const bi = Math.min(Math.floor(gasN / (game === 'bw' ? 1 : 2)), GEYSERS.length - 1);
        const g = GEYSERS[bi][game === 'bw' ? 0 : gasN % 2];
        gasN++;
        things.push({ kind: 'gas', node: n, start: r.start, end: r.end, x: g.x, y: g.y, morphs: [] }); return;
      }
      const slotKind = DEFENCE.has(n.id) ? 'defence' : SMALL.has(n.id) ? 'small' : 'prod';
      const list = SLOTS[slotKind], idx = slotKind === 'prod' ? prod++ : slotKind === 'small' ? small++ : def++;
      const p = list[idx] || { x: 380 + (idx % 8) * 40, y: 450 - Math.floor(idx / 8) * 40 };
      const b = { kind: slotKind, node: n, start: r.start, end: r.end, x: p.x, y: p.y, morphs: [] };
      things.push(b); hosts.push(b);
    });
    // captions: each step as it starts
    const notes = sim.rows.filter((r) => r.node && !r.skipped && r.start != null)
      .map((r) => ({ t: r.start, text: `${r.node.name}${r.of > 1 ? ` (${r.idx + 1}/${r.of})` : ''} started at ${r.sup} supply` }));
    const end = Math.max(sim.finish || 0, 30) + 25;
    return { things, units, research, bases, notes, end, byId };
  }

  function create(o) {
    const { sim, nodes, game, race, R, icon, startWorkers, gasPer, workerId } = o;
    const P = plan(sim, nodes, game, race, R);
    const wrap = document.createElement('div'); wrap.className = 'map-wrap';
    const cv = document.createElement('canvas'); cv.className = 'map-cv';
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', 'The build order played out on a map: workers mine, buildings go up, units gather at the ramp');
    const bar = document.createElement('div'); bar.className = 'map-bar';
    bar.innerHTML = `<button type="button" class="map-play" aria-label="Play">▶</button>
      <input type="range" class="map-scrub" min="0" max="${P.end}" step="0.1" value="0" aria-label="Game clock">
      <span class="map-clock">0:00</span>
      <span class="map-speeds" role="group" aria-label="Speed">${[4, 8, 16].map((v) => `<button type="button" data-sp="${v}">×${v}</button>`).join('')}</span>`;
    wrap.append(cv, bar);
    const ctx = cv.getContext('2d');
    const playB = bar.querySelector('.map-play'), scrub = bar.querySelector('.map-scrub'), clock = bar.querySelector('.map-clock');
    const st = { t: o.t ?? 0, playing: false, speed: o.speed || 8 };
    const acc = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#4ea1ff';
    const sync = () => {
      scrub.value = st.t; clock.textContent = fmt(st.t) + ' / ' + fmt(P.end);
      playB.textContent = st.playing ? '❚❚' : '▶'; playB.setAttribute('aria-label', st.playing ? 'Pause' : 'Play');
      bar.querySelectorAll('[data-sp]').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.sp === st.speed));
      o.onTime?.(st.t);
    };
    playB.onclick = () => { if (!st.playing && st.t >= P.end - 0.1) st.t = 0; st.playing = !st.playing; sync(); };
    cv.onclick = () => playB.onclick();
    scrub.oninput = () => { st.t = +scrub.value; st.playing = false; sync(); draw(); };
    bar.querySelectorAll('[data-sp]').forEach((b) => (b.onclick = () => { st.speed = +b.dataset.sp; o.onSpeed?.(st.speed); sync(); }));

    let W = 0, H = 0, sc = 1;
    function size() {
      const w = Math.max(280, wrap.clientWidth || 800), dpr = Math.min(2, window.devicePixelRatio || 1);
      W = w; H = Math.round(w * MH / MW); sc = W / MW;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + 'px';
      ctx.setTransform(dpr * sc, 0, 0, dpr * sc, 0, 0);
      draw();
    }
    const ro = new ResizeObserver(size);
    ro.observe(wrap);

    /* ---------- drawing, all in map units ---------- */
    const g = ctx;
    function txt(s, x, y, size, col, align = 'left', weight = 600, font = 'system-ui, sans-serif') {
      g.font = `${weight} ${size}px ${font}`; g.fillStyle = col; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, x, y);
    }
    function rr(x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
    function terrain(nBases) {
      g.fillStyle = '#0f1726'; g.fillRect(0, 0, MW, MH);
      for (let i = 0; i < 60; i++) { g.fillStyle = 'rgba(255,255,255,.025)'; g.beginPath(); g.arc(hash(i) * MW, hash(i + 99) * MH, 6 + hash(i + 3) * 26, 0, 7); g.fill(); }
      // the way to the enemy
      g.strokeStyle = 'rgba(255,255,255,.035)'; g.lineWidth = 70; g.lineCap = 'round';
      g.beginPath(); g.moveTo(392, 240); g.lineTo(MW + 40, 240); g.stroke();
      // high-ground main and its ramp
      rr(8, 40, 330, 400, 26); g.fillStyle = '#1b2740'; g.fill(); g.strokeStyle = '#33476f'; g.lineWidth = 3; g.stroke();
      g.beginPath(); g.moveTo(330, 214); g.lineTo(392, 204); g.lineTo(392, 276); g.lineTo(330, 266); g.closePath(); g.fillStyle = '#18233a'; g.fill();
      for (let i = 1; i < 4; i++) { g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 2; g.beginPath(); g.moveTo(330 + i * 15, 210); g.lineTo(330 + i * 15, 270); g.stroke(); }
      const np = game === 'bw' ? 9 : 8;
      SITES.slice(0, 3).forEach((s, si) => {
        patches(s, np).forEach((p) => crystal(p.x, p.y));
        GEYSERS[si].slice(0, game === 'bw' ? 1 : 2).forEach((q) => { g.fillStyle = 'rgba(61,220,132,.2)'; g.strokeStyle = 'rgba(61,220,132,.55)'; g.lineWidth = 1.5; g.beginPath(); g.ellipse(q.x, q.y, 17, 11, 0, 0, 7); g.fill(); g.stroke(); });
        if (si > 0 && si >= nBases) txt('expansion', s.x, s.y + (s.y < 240 ? 56 : -56), 13, 'rgba(160,175,205,.55)', 'center', 500);
      });
      txt('main base', 170, 456, 13, 'rgba(160,175,205,.6)', 'center', 500);
      txt('enemy base →', MW - 14, 240, 14, 'rgba(255,150,150,.7)', 'right', 600);
    }
    const patchCache = {};
    function patches(s, n) {
      const k = s.x + ',' + s.y + ',' + n;
      return patchCache[k] || (patchCache[k] = Array.from({ length: n }, (_, i) => {
        const a = (s.ang[0] + (s.ang[1] - s.ang[0]) * i / (n - 1)) * Math.PI / 180;
        return { x: s.x + 92 * Math.cos(a), y: s.y + 92 * Math.sin(a) };
      }));
    }
    function crystal(x, y) {
      const s = 6.5;
      g.fillStyle = '#4fb8ff'; g.strokeStyle = '#bfe6ff'; g.lineWidth = 1;
      for (const [dx, h] of [[-s * .7, 1.1], [0, 1.6], [s * .7, 1]]) {
        g.beginPath(); g.moveTo(x + dx, y - s * h); g.lineTo(x + dx + s * .45, y); g.lineTo(x + dx, y + s * .5); g.lineTo(x + dx - s * .45, y); g.closePath(); g.fill(); g.stroke();
      }
    }
    function iconBox(node, x, y, r, alpha, shape) {
      g.save(); g.globalAlpha = alpha;
      g.fillStyle = '#0b1220'; g.strokeStyle = acc; g.lineWidth = 2.5;
      g.beginPath();
      if (shape === 'hex') for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + Math.PI / 6; g.lineTo(x + Math.cos(a) * r * 1.2, y + Math.sin(a) * r * 1.2); }
      else if (shape === 'circle') g.arc(x, y, r, 0, 7);
      else g.roundRect(x - r, y - r, r * 2, r * 2, r * .25);
      g.closePath(); g.fill();
      const im = img(icon(node.id));
      g.save(); g.clip();
      if (im) g.drawImage(im, x - r, y - r, r * 2, r * 2);
      else txt(node.name.slice(0, 2), x, y, r * .8, '#fff', 'center', 700);
      g.restore();
      g.stroke();
      g.restore();
    }
    function ring(x, y, r, p, col = '#fff') {
      g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 4; g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke();
      g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + clamp(p) * Math.PI * 2); g.stroke();
    }
    function worker(x, y, carry) {
      const s = 4.2;
      g.fillStyle = acc; g.strokeStyle = '#05080f'; g.lineWidth = 1.1;
      g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s, y); g.lineTo(x, y + s); g.lineTo(x - s, y); g.closePath(); g.fill(); g.stroke();
      if (carry) { g.fillStyle = carry === 'gas' ? '#3ddc84' : '#7fd0ff'; g.beginPath(); g.arc(x, y - s - 2.4, 2.3, 0, 7); g.fill(); }
    }
    const radius = (t) => t.kind === 'base' ? SIZE.base : t.kind === 'gas' ? 16 : SIZE[t.kind] || 18;

    function draw() {
      if (!W) return;
      const t = st.t;
      g.clearRect(0, 0, MW, MH);
      const basesUp = P.bases.filter((b) => b.end <= t);
      terrain(P.bases.filter((b) => b.start <= t).length);
      // buildings
      for (const b of P.things) {
        if (b.kind === 'addon' || t < b.start) continue;
        const r = radius(b), prog = clamp((t - b.start) / ((b.end - b.start) || 1));
        const shown = [...b.morphs].reverse().find((m) => t >= m.end)?.node || b.node;
        if (b.kind === 'base') {
          iconBox(shown, b.x, b.y, r, prog < 1 ? .45 : 1, 'hex');
        } else iconBox(shown, b.x, b.y, r, prog < 1 ? .45 : 1, b.node.id === 'overlord' ? 'circle' : 'box');
        if (prog < 1) ring(b.x, b.y, r + 7, prog);
        const morph = b.morphs.find((m) => t >= m.start && t < m.end);
        if (morph) { ring(b.x, b.y, r + 7, (t - morph.start) / (morph.end - morph.start), '#f59e0b'); txt('→ ' + morph.node.name, b.x, b.y + r + 18, 12, '#f59e0b', 'center', 700); }
        // the worker putting it up
        if (prog < 1 && race !== 'zerg') {
          const wx = b.x - r - 8, wy = b.y + r * .5 + Math.sin(t * 6) * 2;
          if (race === 'terran' || t - b.start < 2) { worker(wx, wy, false); if ((t * 4) % 1 < .4) { g.fillStyle = '#ffe6a0'; g.beginPath(); g.arc(wx + 6, wy - 3, 1.8, 0, 7); g.fill(); } }
        }
      }
      // add-ons beside their building
      for (const a of P.things) {
        if (a.kind !== 'addon' || t < a.start) continue;
        const h = a.host || { x: 300, y: 240, kind: 'prod' }, hr = radius(h);
        const x = h.x + hr + SIZE.addon + 2, y = h.y + hr - SIZE.addon;
        const prog = clamp((t - a.start) / ((a.end - a.start) || 1));
        iconBox(a.node, x, y, SIZE.addon, prog < 1 ? .45 : 1, 'box');
        if (prog < 1) ring(x, y, SIZE.addon + 5, prog);
      }
      // research on its building
      for (const rs of P.research) {
        if (t < rs.start) continue;
        const host = P.things.find((b) => b.node.id === rs.at || b.morphs.some((m) => m.node.id === rs.at)) || P.things[0];
        const hx = host.kind === 'addon' && host.host ? host.host.x + radius(host.host) + SIZE.addon + 2 : host.x;
        const hy = host.kind === 'addon' && host.host ? host.host.y + radius(host.host) - SIZE.addon : host.y;
        if (t < rs.end) {
          const r = 10, x = hx, y = hy - radius(host) - 16;
          iconBox(rs.node, x, y, r, 1, 'circle'); ring(x, y, r + 4, (t - rs.start) / (rs.end - rs.start), '#f59e0b');
        }
      }
      // workers: who mines where, who is on gas
      const made = sim.workerLog.filter((w) => w.end <= t).length;
      const eaten = race === 'zerg' ? sim.rows.filter((r) => r.node && !r.skipped && r.start != null && r.start <= t && r.node.t === 'b' && !r.node.from).length : 0;
      const busy = race === 'terran' ? sim.rows.filter((r) => r.node && r.node.t === 'b' && !r.node.from && r.start != null && r.start <= t && t < r.end).length
        : race === 'protoss' ? sim.rows.filter((r) => r.node && r.node.t === 'b' && !r.node.from && r.start != null && r.start <= t && t < r.start + 2).length : 0;
      const workers = startWorkers + made - eaten;
      const gasUp = P.things.filter((b) => b.kind === 'gas' && b.end <= t);
      let gas = Math.min(gasUp.length * gasPer, Math.max(0, workers - busy - 1));
      let miners = Math.max(0, workers - busy - gas);
      const np = game === 'bw' ? 9 : 8;
      const per = basesUp.map(() => 0);
      for (const cap of [np * 2, np * 3]) basesUp.forEach((_, j) => { const k = Math.min(cap - per[j], miners); per[j] += k; miners -= k; });
      basesUp.forEach((b, j) => {
        const s = SITES[b.site % SITES.length], pa = patches(s, np);
        for (let w = 0; w < per[j]; w++) {
          const patch = pa[(w * 4) % np], T = 7, ph = (t + hash(w + b.site * 50) * T) % T;
          const ax = s.x + (patch.x - s.x) * .38, ay = s.y + (patch.y - s.y) * .38, bx = patch.x + (s.x - patch.x) * .14, by = patch.y + (s.y - patch.y) * .14;
          const jit = (hash(w + 7 + b.site) - .5) * 8;
          if (ph < 2.6) { const k = ph / 2.6; worker(lerp(ax, bx, k) + jit, lerp(ay, by, k) + jit * .5, false); }
          else if (ph < 4) worker(bx + Math.sin(ph * 9) * 1.2, by, false);
          else { const k = (ph - 4) / 3; worker(lerp(bx, ax, k) + jit, lerp(by, ay, k) + jit * .5, 'min'); }
        }
      });
      gasUp.forEach((gb, j) => {
        const si = GEYSERS.findIndex((L) => L.some((q) => q.x === gb.x && q.y === gb.y)), s = SITES[Math.max(0, si)];
        for (let w = 0; w < gasPer && gas > 0; w++, gas--) {
          const ph = (t * .2 + w / gasPer + hash(j)) % 1, k = ph < .5 ? ph * 2 : (1 - ph) * 2;
          worker(lerp(s.x, gb.x, .3 + .55 * k), lerp(s.y, gb.y, .3 + .55 * k) + (w - 1) * 5, ph > .5 ? 'gas' : false);
        }
      });
      // army: gathers inside the ramp, or in front of the natural once it's up
      const rally = basesUp.length > 1 ? { x: 470, y: 228 } : { x: 268, y: 240 };
      const army = P.units.filter((u) => u.end <= t && (u.gone == null || u.gone > t) && u.node.id !== workerId);
      const ground = army.filter((u) => u.node.id !== 'overlord');
      ground.forEach((u, j) => {
        const a = j * 2.4, d = 13 * Math.sqrt(j + .5);
        const age = t - u.end, walk = clamp(age / 4), from = P.bases[0];
        const x = lerp(from.x + 40, rally.x + Math.cos(a) * d, walk), y = lerp(from.y, rally.y + Math.sin(a) * d * .85, walk);
        iconBox(u.node, x, y, 10, 1, 'circle');
      });
      army.filter((u) => u.node.id === 'overlord').forEach((u, j) => {
        const x = 60 + (j * 67) % 250, y = 70 + Math.floor(j * 67 / 250) * 60 + Math.sin(t * .8 + j) * 4;
        iconBox(u.node, x, y, 12, .9, 'circle');
      });
      // units in production: a small icon with a ring at the building that makes them
      P.units.forEach((u) => {
        if (t < u.start || t >= u.end || u.node.id === workerId) return;
        const src = P.things.find((b) => b.node.id === u.node.from || b.morphs.some((m) => m.node.id === u.node.from)) || P.things[0];
        const x = src.x + (u.i % 2 ? 12 : -12), y = src.y - radius(src) - 14;
        iconBox(u.node, x, y, 9, .8, 'circle'); ring(x, y, 12, (t - u.start) / (u.end - u.start), '#22c55e');
      });
      // HUD: clock, counts, what just happened
      const hx = MW - 250;
      rr(hx, 12, 236, 84, 10); g.fillStyle = 'rgba(5,9,18,.82)'; g.fill();
      txt(fmt(t), hx + 14, 44, 30, '#fff', 'left', 700, '"Barlow Condensed", system-ui');
      txt(`${workers} workers`, hx + 92, 33, 14, '#cfd8ea', 'left', 600);
      txt(`${ground.length} army units`, hx + 92, 55, 14, '#cfd8ea', 'left', 600);
      const done = P.notes.filter((n) => n.t <= t);
      const last = done[done.length - 1];
      if (last) {
        g.font = '600 17px system-ui, sans-serif';
        const tw = g.measureText(last.text).width + 70;
        g.globalAlpha = clamp((t - last.t) / 1.5 + .35);
        rr(MW / 2 - tw / 2 + 120, MH - 52, tw, 36, 10); g.fillStyle = 'rgba(5,9,18,.86)'; g.fill();
        txt(fmt(last.t), MW / 2 - tw / 2 + 134, MH - 34, 16, acc, 'left', 800);
        txt(last.text, MW / 2 - tw / 2 + 182, MH - 34, 17, '#fff', 'left', 600);
        g.globalAlpha = 1;
      }
      const stepN = done.length, total = P.notes.length;
      txt(stepN >= total && t >= sim.finish ? 'build complete' : `step ${Math.min(stepN + 1, total)} of ${total} next`, hx + 14, 80, 13, stepN >= total && t >= sim.finish ? '#3ddc84' : '#8b97ab', 'left', 600);
    }

    let raf = 0, last = 0;
    const loop = (now) => {
      const dt = last ? Math.min(.1, (now - last) / 1000) : 0; last = now;
      if (st.playing) { st.t = Math.min(P.end, st.t + dt * st.speed); if (st.t >= P.end) st.playing = false; sync(); }
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    window.__seekMap = (tt) => { st.t = clamp(tt, 0, P.end); st.playing = false; sync(); draw(); };
    sync();
    return {
      el: wrap,
      get t() { return st.t; }, get playing() { return st.playing; }, get speed() { return st.speed; },
      play() { st.playing = true; sync(); },
      seek(tt) { st.t = clamp(tt, 0, P.end); sync(); draw(); },
      destroy() { cancelAnimationFrame(raf); ro.disconnect(); },
      end: P.end,
    };
  }

  window.SC_MAP = { create };
})();
