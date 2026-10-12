(function () {
  'use strict';

  const GAMES = {
    sc2: {
      name: 'StarCraft II', sub: 'Legacy of the Void multiplayer', races: window.SC2_DATA,
      foot: 'Costs and times use Faster game speed and late-LotV ladder balance; exact numbers shift between patches.',
    },
    bw: {
      name: 'Brood War', sub: 'StarCraft: Brood War / Remastered', races: window.BW_DATA,
      foot: 'Times are Blizzard game seconds at Normal speed (about 1.6x faster on Fastest). Some research times are omitted.',
    },
  };
  let DATA = GAMES.sc2.races;
  const NS = 'http://www.w3.org/2000/svg';
  const NODE_W = 214, NODE_H = 44, COL_GAP = 90, ROW_GAP = 12, PAD = 40, HEADER = 34;
  const TYPE = { b: 'building', u: 'unit', g: 'upgrade' };
  const SECTION = [
    { cls: 'direct', label: '✔ Unlocked directly', badge: '✔ Unlocked directly' },
    { cls: 'addon', label: '🔧 Requires add-on', badge: '🔧 Requires add-on' },
    { cls: 'research', label: '⚗ Requires research', badge: '⚗ Unlocked by research' },
  ];

  const $ = (id) => document.getElementById(id);
  const svg = $('tree'), viewport = $('viewport');
  const gCols = $('columns'), gEdges = $('edges'), gNodes = $('nodes');

  const initial = readHash();
  const state = {
    game: initial.game,
    race: initial.race,
    showUnits: true,
    showUpgrades: true,
    selected: initial.node || null,
    page: initial.page,
    build: initial.build,
    view: { x: 0, y: 0, k: 1 },
  };
  DATA = GAMES[state.game].races;
  let graph = null;

  // Hash format: #game/race/node for the trees, #game/race/builds/buildId for build orders.
  // A bare #race/node (older links) means StarCraft II.
  function readHash() {
    let parts = location.hash.replace('#', '').split('/');
    if (!GAMES[parts[0]]) parts = ['sc2', ...parts];
    const [game, race, node, build] = parts;
    const g = GAMES[game] || GAMES.sc2;
    const okRace = !!g.races[race];
    const base = { game: GAMES[game] ? game : 'sc2', race: okRace ? race : 'terran' };
    if (node === 'builds') return { ...base, page: 'builds', build: build || null };
    return { ...base, node: okRace ? node : null, page: 'trees' };
  }
  function writeHash() {
    const h = '#' + state.game + '/' + state.race + (state.page === 'builds'
      ? '/builds' + (state.build ? '/' + state.build : '')
      : (state.selected ? '/' + state.selected : ''));
    if (location.hash !== h) history.replaceState(null, '', h);
  }

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  // ---------- Graph model ----------
  function buildGraph(raceKey) {
    const all = DATA[raceKey].nodes;
    const byId = new Map(all.map((n) => [n.id, n]));
    const visible = all.filter((n) =>
      (n.t !== 'u' || state.showUnits) && (n.t !== 'g' || state.showUpgrades));
    const vis = new Set(visible.map((n) => n.id));

    const edges = [];
    const parents = new Map(), children = new Map();
    visible.forEach((n) => { parents.set(n.id, []); children.set(n.id, []); });
    const link = (s, t, kind) => {
      if (!vis.has(s)) return;
      edges.push({ s, t, kind });
      parents.get(t).push(s);
      children.get(s).push(t);
    };
    visible.forEach((n) => {
      if (n.from) link(n.from, n.id, 'from');
      (n.req || []).forEach((r) => link(r, n.id, byId.get(r).t === 'g' && n.t !== 'g' ? 'req research' : byId.get(r).via === 'Add-on' ? 'req addon' : 'req'));
    });

    // Section 0: unlocked directly by buildings. Section 1: needs a specific add-on.
    // Section 2: needs research (the research items themselves, plus anything gated behind one).
    const isAddon = (id) => byId.get(id).via === 'Add-on';
    const gates = new Map(all.map((n) => [n.id, (n.req || []).filter((r) => byId.get(r).t === 'g' && n.t !== 'g')]));
    const addonGates = new Map(all.map((n) => [n.id, n.t === 'g' ? [] :
      [n.from, ...(n.req || [])].filter((r) => r && isAddon(r))]));
    const sec = (id) => (byId.get(id).t === 'g' || gates.get(id).length ? 2 : addonGates.get(id).length ? 1 : 0);

    // Depth = longest prerequisite chain.
    const depth = new Map();
    const getDepth = (id) => {
      if (depth.has(id)) return depth.get(id);
      depth.set(id, 0);
      const d = parents.get(id).reduce((m, p) => Math.max(m, getDepth(p) + 1), 0);
      depth.set(id, d);
      return d;
    };
    visible.forEach((n) => getDepth(n.id));

    // Columns, then barycentric ordering sweeps to reduce crossings.
    const cols = [];
    visible.forEach((n) => { (cols[depth.get(n.id)] ||= []).push(n.id); });
    const typeRank = { b: 0, u: 1, g: 2 };
    const pos = new Map();
    const index = () => cols.forEach((c) => c.forEach((id, i) => pos.set(id, i / Math.max(1, c.length - 1))));
    cols.forEach((c) => c.sort((a, b) => sec(a) - sec(b) || typeRank[byId.get(a).t] - typeRank[byId.get(b).t]));
    index();
    const bary = (id, rel) => {
      const ns = rel.get(id);
      return ns.length ? ns.reduce((s, p) => s + pos.get(p), 0) / ns.length : pos.get(id);
    };
    for (let pass = 0; pass < 6; pass++) {
      const forward = pass % 2 === 0;
      const order = forward ? cols.slice(1) : cols.slice(0, -1).reverse();
      order.forEach((c) => {
        const key = new Map(c.map((id) => [id, bary(id, forward ? parents : children)]));
        c.sort((a, b) => sec(a) - sec(b) || key.get(a) - key.get(b) || typeRank[byId.get(a).t] - typeRank[byId.get(b).t]);
        c.forEach((id, i) => pos.set(id, i / Math.max(1, c.length - 1)));
      });
    }

    // Stack each column's sections, each under its own label, centred vertically.
    const LABEL_H = 24, SEC_GAP = 18;
    const parts = cols.map((c) => [0, 1, 2].map((k) => c.filter((id) => sec(id) === k)).filter((s) => s.length));
    const colHeight = (ss) => ss.reduce((h, s) => h + LABEL_H + s.length * (NODE_H + ROW_GAP), 0) + (ss.length - 1) * (SEC_GAP - ROW_GAP) - ROW_GAP;
    const totalH = Math.max(...parts.map(colHeight));
    const layout = new Map(), sections = [];
    parts.forEach((ss, d) => {
      const x = PAD + d * (NODE_W + COL_GAP);
      let y = PAD + HEADER + (totalH - colHeight(ss)) / 2;
      ss.forEach((s) => {
        sections.push({ x, y, kind: SECTION[sec(s[0])], top: y, bottom: y + LABEL_H + s.length * (NODE_H + ROW_GAP) - ROW_GAP });
        y += LABEL_H;
        s.forEach((id) => { layout.set(id, { x, y }); y += NODE_H + ROW_GAP; });
        y += SEC_GAP - ROW_GAP;
      });
    });

    return {
      byId, visible, vis, edges, parents, children, depth, cols, layout, sections, gates, addonGates, sec,
      width: PAD * 2 + cols.length * (NODE_W + COL_GAP) - COL_GAP,
      height: PAD * 2 + HEADER + totalH,
    };
  }

  // ---------- Rendering ----------
  function costText(n) {
    if (n.t === 'u' && n.via && /Calldown/.test(n.via)) return n.via;
    const parts = [];
    if (n.m || n.g) parts.push(n.m + ' / ' + n.g);
    if (n.time) parts.push(n.time + 's');
    if (n.sup) parts.push(n.sup + ' sup');
    return parts.join(' · ') || 'free';
  }

  function render() {
    graph = buildGraph(state.race);
    gCols.replaceChildren(); gEdges.replaceChildren(); gNodes.replaceChildren();

    graph.cols.forEach((c, d) => {
      const x = PAD + d * (NODE_W + COL_GAP) - COL_GAP / 2 + 10;
      el('rect', { class: 'col-band', x, y: PAD - 10, width: NODE_W + COL_GAP - 20, height: graph.height - PAD, rx: 10 }, gCols);
      const label = el('text', { class: 'col-label', x: x + (NODE_W + COL_GAP - 20) / 2, y: PAD + 10, 'text-anchor': 'middle' }, gCols);
      label.textContent = d === 0 ? 'Start' : 'Tier ' + d;
    });

    graph.sections.forEach((s) => {
      el('rect', {
        class: 'sec-band ' + s.kind.cls,
        x: s.x - 8, y: s.top - 4, width: NODE_W + 16, height: s.bottom - s.top + 12, rx: 8,
      }, gCols);
      const t = el('text', { class: 'sec-label ' + s.kind.cls, x: s.x, y: s.top + 13 }, gCols);
      t.textContent = s.kind.label;
    });

    graph.edges.forEach((e) => {
      const a = graph.layout.get(e.s), b = graph.layout.get(e.t);
      const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x - 2, y2 = b.y + NODE_H / 2;
      const dx = Math.max(40, (x2 - x1) * 0.5);
      e.el = el('path', {
        class: 'edge ' + e.kind,
        d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`,
        'marker-end': 'url(#arrow)',
      }, gEdges);
    });

    graph.nodeEls = new Map();
    graph.visible.forEach((n) => {
      const p = graph.layout.get(n.id);
      const gated = graph.gates.get(n.id).length > 0;
      const addonGated = !gated && graph.addonGates.get(n.id).length > 0;
      const g = el('g', { class: 'node ' + TYPE[n.t] + (gated ? ' gated' : '') + (addonGated ? ' addon-gated' : ''), transform: `translate(${p.x},${p.y})`, tabindex: 0, role: 'button', 'aria-label': n.name }, gNodes);
      el('rect', { class: 'box', width: NODE_W, height: NODE_H, rx: 7 }, g);
      el('rect', { class: 'tag', width: 4, height: NODE_H - 10, x: 5, y: 5, rx: 2 }, g);
      const icon = iconFor(n.id);
      if (icon) el('image', { class: 'icon', href: icon, x: 13, y: 5, width: 34, height: 34, preserveAspectRatio: 'xMidYMid slice', 'clip-path': 'url(#iconClip)' }, g);
      const TX = icon ? 54 : 18;
      const name = el('text', { class: 'name', x: TX, y: 19 }, g);
      name.textContent = n.name;
      const meta = el('text', { class: 'meta', x: TX, y: 34 }, g);
      meta.textContent = costText(n) + (n.via && !/Calldown/.test(n.via) ? '  ·  ' + n.via : '');
      if (gated) {
        const badge = el('text', { class: 'lock', x: NODE_W - 8, y: 17, 'text-anchor': 'end' }, g);
        badge.textContent = '⚗';
        el('title', {}, g).textContent = 'Needs research: ' + graph.gates.get(n.id).map((r) => graph.byId.get(r).name).join(', ');
      } else if (addonGated) {
        const badge = el('text', { class: 'addon-mark', x: NODE_W - 8, y: 17, 'text-anchor': 'end' }, g);
        badge.textContent = '🔧';
        el('title', {}, g).textContent = 'Needs add-on: ' + graph.addonGates.get(n.id).map((r) => graph.byId.get(r).name).join(', ');
      }
      g.addEventListener('click', (ev) => { ev.stopPropagation(); select(n.id); });
      g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(n.id); } });
      graph.nodeEls.set(n.id, g);
    });

    $('names').replaceChildren(...DATA[state.race].nodes.map((n) => { const o = document.createElement('option'); o.value = n.name; return o; }));
    if (state.selected && !graph.vis.has(state.selected)) state.selected = null;
    applySelection();
  }

  function iconFor(id) {
    const icons = window.SC_ICONS || {};
    return icons[state.game + '/' + state.race + '/' + id] || null;
  }

  function walk(start, rel) {
    const seen = new Set(), stack = [...rel.get(start)];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...rel.get(id));
    }
    return seen;
  }

  function applySelection() {
    const id = state.selected;
    const svgRoot = svg;
    graph.nodeEls.forEach((g) => g.classList.remove('sel', 'anc', 'desc'));
    graph.edges.forEach((e) => e.el.classList.remove('hl'));
    writeHash();
    if (!id) {
      svgRoot.classList.remove('dim');
      $('panelEmpty').hidden = false; $('panelBody').hidden = true;
      return;
    }
    const anc = walk(id, graph.parents), desc = walk(id, graph.children);
    svgRoot.classList.add('dim');
    graph.nodeEls.get(id).classList.add('sel');
    anc.forEach((a) => graph.nodeEls.get(a).classList.add('anc'));
    desc.forEach((d) => graph.nodeEls.get(d).classList.add('desc'));
    graph.edges.forEach((e) => {
      const up = (e.t === id || anc.has(e.t)) && (anc.has(e.s));
      const down = (e.s === id || desc.has(e.s)) && desc.has(e.t);
      if (up || down) e.el.classList.add('hl');
    });
    renderPanel(id, anc, desc);
  }

  function chip(id, via) {
    const n = graph.byId.get(id);
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip';
    b.textContent = n.name;
    if (via) { const s = document.createElement('span'); s.className = 'via'; s.textContent = '(' + via + ')'; b.appendChild(s); }
    b.addEventListener('click', () => select(id, true));
    return b;
  }

  function section(parent, title, nodes) {
    if (!nodes.length) return;
    const h = document.createElement('h3'); h.textContent = title; parent.appendChild(h);
    const wrap = document.createElement('div'); wrap.className = 'chips';
    nodes.forEach((x) => wrap.appendChild(x));
    parent.appendChild(wrap);
  }

  function renderPanel(id, anc, desc) {
    const n = graph.byId.get(id);
    const body = $('panelBody');
    body.replaceChildren();
    $('panelEmpty').hidden = true; body.hidden = false;

    const kind = document.createElement('span'); kind.className = 'kind ' + TYPE[n.t]; kind.textContent = TYPE[n.t];
    const h = document.createElement('h2'); h.textContent = n.name;
    const icon = iconFor(id);
    if (icon) {
      const img = document.createElement('img');
      img.className = 'panel-icon'; img.src = icon; img.alt = '';
      body.append(img);
    }
    body.append(kind, h);
    const unlock = document.createElement('span');
    const kindInfo = SECTION[graph.sec(id)];
    unlock.className = 'unlock ' + kindInfo.cls;
    unlock.textContent = n.t === 'g' ? '⚗ Research' : n.via === 'Add-on' ? '🔧 Add-on building' : kindInfo.badge;
    kind.after(unlock);
    if (n.note) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = n.note; body.appendChild(p); }

    const stats = document.createElement('div'); stats.className = 'stats';
    const stat = (cls, val, label) => {
      const s = document.createElement('div'); s.className = 'stat ' + cls;
      s.innerHTML = '<b></b><small></small>';
      s.querySelector('b').textContent = val; s.querySelector('small').textContent = label;
      stats.appendChild(s);
    };
    stat('min', n.m ?? 0, 'Minerals');
    stat('gas', n.g ?? 0, 'Vespene gas');
    stat('', n.time ? n.time + 's' : '—', n.t === 'g' ? 'Research time' : 'Build time');
    if (n.t === 'u') stat('', n.sup ?? 0, 'Supply');
    body.appendChild(stats);

    const fromLabel = n.t === 'g' ? 'Researched at' : n.via === 'Add-on' ? 'Add-on for' :(n.via && /Morph|Merge|Upgrade/.test(n.via)) ? 'Morphs from' : 'Built / trained at';
    if (n.from) section(body, fromLabel, [chip(n.from, n.via)]);
    const gate = graph.gates.get(id);
    const addons = graph.addonGates.get(id);
    section(body, 'Requires add-on', addons.filter((r) => r !== n.from).map((r) => chip(r)));
    section(body, 'Also requires', (n.req || []).filter((r) => !gate.includes(r) && !addons.includes(r)).map((r) => chip(r)));
    section(body, 'Requires research', gate.map((r) => chip(r)));

    // Everything needed, in tier order: a minimal path to this item.
    if (anc.size) {
      const h3 = document.createElement('h3'); h3.textContent = 'Full path (' + anc.size + ' steps)'; body.appendChild(h3);
      const ol = document.createElement('ol'); ol.className = 'path';
      [...anc].sort((a, b) => graph.depth.get(a) - graph.depth.get(b)).forEach((a) => {
        const li = document.createElement('li'); const link = document.createElement('a');
        link.textContent = graph.byId.get(a).name; link.addEventListener('click', () => select(a, true));
        li.appendChild(link); ol.appendChild(li);
      });
      body.appendChild(ol);
    }

    const kids = graph.children.get(id);
    const by = (t) => kids.filter((k) => graph.byId.get(k).t === t).map((k) => chip(k));
    section(body, 'Unlocks buildings', by('b'));
    section(body, 'Unlocks units', by('u'));
    section(body, 'Unlocks upgrades', by('g'));
    if (desc.size > kids.length) {
      const p = document.createElement('p'); p.className = 'muted';
      p.textContent = desc.size + ' items downstream in total.';
      body.appendChild(p);
    }
  }

  function select(id, focus) {
    state.selected = id;
    applySelection();
    if (focus && id) centerOn(id);
  }

  // ---------- Pan / zoom ----------
  function applyView() {
    const v = state.view;
    viewport.setAttribute('transform', `translate(${v.x},${v.y}) scale(${v.k})`);
  }
  function fit() {
    if (state.page !== 'trees') return;
    const r = svg.getBoundingClientRect();
    const k = Math.min(r.width / graph.width, r.height / graph.height, 1.2);
    state.view = { k, x: (r.width - graph.width * k) / 2, y: (r.height - graph.height * k) / 2 };
    applyView();
  }
  function centerOn(id) {
    const p = graph.layout.get(id); if (!p) return;
    const r = svg.getBoundingClientRect();
    const k = Math.max(state.view.k, 0.8);
    state.view = { k, x: r.width / 2 - (p.x + NODE_W / 2) * k, y: r.height / 2 - (p.y + NODE_H / 2) * k };
    applyView();
    const g = graph.nodeEls.get(id);
    g.classList.remove('flash'); void g.getBBox(); g.classList.add('flash');
  }
  function zoomAt(cx, cy, factor) {
    const v = state.view;
    const k = Math.min(3, Math.max(0.2, v.k * factor));
    v.x = cx - (cx - v.x) * (k / v.k);
    v.y = cy - (cy - v.y) * (k / v.k);
    v.k = k;
    applyView();
  }

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  const pointers = new Map();
  let drag = null, pinch = null, moved = false;
  svg.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = false;
    if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, vx: state.view.x, vy: state.view.y };
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
      drag = null;
    }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!moved && Math.hypot(dx, dy) > 4) { moved = true; svg.setPointerCapture(e.pointerId); svg.classList.add('dragging'); }
      if (moved) { state.view.x = drag.vx + dx; state.view.y = drag.vy + dy; applyView(); }
    } else if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const r = svg.getBoundingClientRect();
      zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, d / pinch.d);
      pinch.d = d; moved = true;
    }
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) { drag = null; pinch = null; svg.classList.remove('dragging'); }
  };
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);
  svg.addEventListener('click', (e) => {
    if (moved) { moved = false; e.stopPropagation(); return; }
    if (e.target === svg || !e.target.closest('.node')) select(null);
  }, true);

  // ---------- Controls ----------
  function renderGameTabs() {
    const nav = $('games');
    nav.replaceChildren();
    Object.keys(GAMES).forEach((key) => {
      const b = document.createElement('button');
      b.type = 'button'; b.role = 'tab'; b.textContent = GAMES[key].name;
      b.setAttribute('aria-selected', key === state.game);
      b.addEventListener('click', () => setGame(key));
      nav.appendChild(b);
    });
    const g = GAMES[state.game];
    const what = state.page === 'builds' ? ' Build Orders' : ' Tech Trees';
    $('title').textContent = g.name + what;
    $('subtitle').textContent = g.sub;
    $('footNote').textContent = g.foot;
    document.title = g.name + what;
  }
  function renderPageTabs() {
    document.querySelectorAll('#pages button').forEach((b) => b.setAttribute('aria-selected', b.dataset.page === state.page));
    document.body.dataset.page = state.page;
  }
  function setPage(page) {
    if (page === state.page) return;
    state.page = page;
    renderPageTabs(); renderGameTabs(); writeHash();
    if (page === 'trees') fit();
    notify();
  }
  const listeners = [];
  function notify() { listeners.forEach((fn) => fn(state)); }
  function setGame(key) {
    if (key === state.game) return;
    state.game = key; DATA = GAMES[key].races;
    if (!DATA[state.race]) state.race = 'terran';
    state.selected = null;
    renderGameTabs(); renderRaceTabs(); render(); fit(); notify();
  }
  function renderRaceTabs() {
    const nav = $('races');
    nav.replaceChildren();
    Object.keys(DATA).forEach((key) => {
      const b = document.createElement('button');
      b.type = 'button'; b.role = 'tab'; b.textContent = DATA[key].name;
      b.setAttribute('aria-selected', key === state.race);
      b.addEventListener('click', () => setRace(key));
      nav.appendChild(b);
    });
    document.body.dataset.race = state.race;
  }
  function setRace(key) {
    state.race = key; state.selected = null;
    renderRaceTabs(); render(); fit(); notify();
  }

  $('showUnits').addEventListener('change', (e) => { state.showUnits = e.target.checked; render(); fit(); });
  $('showUpgrades').addEventListener('change', (e) => { state.showUpgrades = e.target.checked; render(); fit(); });
  $('fit').addEventListener('click', fit);
  $('search').addEventListener('change', (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) return;
    let hit = DATA[state.race].nodes.find((n) => n.name.toLowerCase() === q)
      || DATA[state.race].nodes.find((n) => n.name.toLowerCase().includes(q));
    if (!hit) {
      // Search other races too.
      for (const key of Object.keys(DATA)) {
        const n = DATA[key].nodes.find((x) => x.name.toLowerCase().includes(q));
        if (n) { setRace(key); hit = n; break; }
      }
    }
    if (!hit) return;
    if (hit.t === 'u' && !state.showUnits) { $('showUnits').checked = true; state.showUnits = true; render(); }
    if (hit.t === 'g' && !state.showUpgrades) { $('showUpgrades').checked = true; state.showUpgrades = true; render(); }
    select(hit.id, true);
    e.target.value = '';
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.page === 'trees') select(null);
  });
  window.addEventListener('resize', () => fit());
  document.querySelectorAll('#pages button').forEach((b) => b.addEventListener('click', () => setPage(b.dataset.page)));

  // Shared with the Build Orders page (bo.js).
  window.SCApp = {
    state, GAMES,
    nodes: () => DATA[state.race].nodes,
    icon: iconFor,
    onChange: (fn) => listeners.push(fn),
    setBuild: (id) => { state.build = id; writeHash(); },
    openInTree: (id) => { setPage('trees'); select(id, true); },
  };

  renderPageTabs();
  renderGameTabs();
  renderRaceTabs();
  render();
  fit();
  if (state.selected) centerOn(state.selected);
})();
