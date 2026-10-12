(function () {
  'use strict';

  const App = window.SCApp, SIM = window.SC_SIM, BUILDS = window.SC_BUILDS;
  const root = document.getElementById('buildView');
  const opts = { workerTarget: null, gasPerGeyser: 3, economy: {}, showWorkers: false };
  let ecoGame = null;

  const fmt = (s) => {
    if (s == null) return '—';
    const r = Math.round(s);
    return Math.floor(r / 60) + ':' + String(r % 60).padStart(2, '0');
  };
  const h = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    kids.flat().forEach((c) => c != null && e.append(c.nodeType ? c : String(c)));
    return e;
  };
  const res = (m, g) => h('span', { class: 'res' }, h('b', { class: 'm' }, m), ' / ', h('b', { class: 'g' }, g));

  function builds() { return (BUILDS[App.state.game] || {})[App.state.race] || []; }
  function current() {
    const list = builds();
    return list.find((b) => b.id === App.state.build) || list[0];
  }
  function economy() {
    return Object.assign({}, SIM.ECONOMY[App.state.game], opts.economy);
  }
  function capChoices(game) {
    return game === 'bw' ? [9, 12, 16, 20, 30, 50] : [16, 20, 24, 30, 40, 60];
  }

  function render() {
    if (App.state.page !== 'builds') return;
    const game = App.state.game, race = App.state.race;
    if (ecoGame !== game) { ecoGame = game; opts.economy = {}; opts.workerTarget = game === 'bw' ? 30 : 44; }
    const nodes = App.nodes();
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const build = current();
    root.replaceChildren();

    // Build list.
    const list = h('nav', { class: 'bo-list', 'aria-label': 'Build orders' });
    list.append(h('h3', {}, 'Common builds'));
    builds().forEach((b) => {
      list.append(h('button', {
        type: 'button', class: 'bo-card' + (b === build ? ' active' : ''),
        onclick: () => { App.setBuild(b.id); render(); },
      }, h('strong', {}, b.name), h('span', { class: 'muted' }, b.matchup)));
    });
    root.append(list);
    if (!build) { root.append(h('section', { class: 'bo-main' }, h('p', {}, 'No builds yet for this race.'))); return; }
    if (App.state.build !== build.id) App.setBuild(build.id);

    const eco = economy();
    const run = (target) => SIM.simulate(nodes, game, race, build, { workerTarget: target, gasPerGeyser: opts.gasPerGeyser, economy: opts.economy });
    const sim = run(opts.workerTarget);

    const main = h('section', { class: 'bo-main' });
    main.append(h('header', { class: 'bo-head' },
      h('div', {}, h('h2', {}, build.name), h('p', { class: 'muted' }, build.desc)),
      h('p', { class: 'bo-matchup' }, h('span', { class: 'muted' }, 'Matchup'), h('strong', {}, build.matchup))));

    // Controls.
    const workerName = byId.get(SIM.RACE[race].worker).name;
    const slider = h('input', { type: 'range', min: eco.startWorkers, max: 80, value: opts.workerTarget, id: 'boWorkers' });
    const out = h('output', { for: 'boWorkers' }, opts.workerTarget);
    slider.addEventListener('input', () => { out.textContent = slider.value; });
    slider.addEventListener('change', () => { opts.workerTarget = +slider.value; render(); });
    const gasSel = h('select', { id: 'boGas', onchange: (e) => { opts.gasPerGeyser = +e.target.value; render(); } },
      [0, 1, 2, 3].map((v) => { const o = h('option', { value: v }, v); if (v === opts.gasPerGeyser) o.selected = true; return o; }));
    main.append(h('div', { class: 'bo-controls' },
      h('label', {}, `${workerName}s to build (cap) `, slider, out),
      h('label', {}, `${workerName}s per gas `, gasSel),
      h('label', { class: 'check' }, (() => {
        const c = h('input', { type: 'checkbox', onchange: (e) => { opts.showWorkers = e.target.checked; render(); } });
        c.checked = opts.showWorkers; return c;
      })(), `Show ${workerName} timings`),
      h('span', { class: 'muted small' }, `Starts with ${eco.startWorkers} ${workerName}s. ${workerName}s are made non-stop until the cap; each step is placed at its supply count.`)));

    // Totals.
    let tm = 0, tg = 0;
    sim.rows.forEach((r) => { if (r.node && !r.skipped) { tm += r.node.m || 0; tg += r.node.g || 0; } });
    const workersMade = Math.round(sim.spentWorkersM / byId.get(SIM.RACE[race].worker).m);
    main.append(h('div', { class: 'bo-stats' },
      stat(fmt(sim.finish), 'Build complete', 'lead'),
      stat(res(tm, tg), 'Build cost (minerals / gas)'),
      stat(res(tm + sim.spentWorkersM, tg), `Incl. ${workersMade} ${workerName}s`),
      stat(sim.workers, `${workerName}s at the end`),
      stat(res(Math.round(sim.incomePerMin.m), Math.round(sim.incomePerMin.g)), 'Income per minute at the end')));

    main.append(h('h3', { class: 'bo-sub' }, 'Timeline'), timeline(sim.rows, sim.finish));
    main.append(h('h3', { class: 'bo-sub' }, 'Steps'));

    // Steps, optionally interleaved with every worker in start-time order.
    let cm = 0, cg = 0;
    const tbody = h('tbody');
    const wNode = byId.get(SIM.RACE[race].worker), wIcon = App.icon(wNode.id);
    const lines = sim.rows.map((r, i) => ({ kind: 'step', r, i, at: r.start ?? Infinity }));
    if (opts.showWorkers) sim.workerLog.forEach((w, k) => lines.push({ kind: 'worker', w, k, at: w.start }));
    lines.sort((a, b) => a.at - b.at || (a.kind === 'step' ? -1 : 1));
    lines.forEach((line) => {
      if (line.kind === 'worker') {
        cm += wNode.m;
        tbody.append(h('tr', { class: 'worker-row' },
          h('td', { class: 'num col-num' }, ''),
          h('td', {}, h('span', { class: 'bo-item' }, wIcon ? h('img', { src: wIcon, alt: '' }) : null, `${wNode.name} #${line.k + 1 + sim.startWorkers}`)),
          h('td', { class: 'time' }, fmt(line.w.start)),
          h('td', { class: 'time muted' }, fmt(line.w.end)),
          h('td', { class: 'num' }, line.w.sup),
          h('td', {}, res(wNode.m, 0)),
          h('td', { class: 'col-total' }, res(cm, cg))));
        return;
      }
      const { r, i } = line;
      const n = r.node;
      if (n && !r.skipped) { cm += n.m || 0; cg += n.g || 0; }
      const icon = n && App.icon(n.id);
      tbody.append(h('tr', { class: r.skipped ? 'skipped' : '' },
        h('td', { class: 'num col-num' }, i + 1),
        h('td', {}, h('button', { type: 'button', class: 'bo-item', title: 'Show in tech tree', onclick: () => App.openInTree(r.id) },
          icon ? h('img', { src: icon, alt: '' }) : null,
          h('span', {}, (n ? n.name : r.id) + (r.of > 1 ? ` (${r.idx + 1}/${r.of})` : '')),
          h('span', { class: 'to-tree', 'aria-hidden': 'true' }, '↗')),
          r.skipped ? h('span', { class: 'warn' }, ' ' + r.skipped) : null),
        h('td', { class: 'time' }, fmt(r.start)),
        h('td', { class: 'time muted' }, fmt(r.end)),
        h('td', { class: 'num' }, r.sup),
        h('td', {}, n ? res(n.m || 0, n.g || 0) : '—'),
        h('td', { class: 'col-total' }, res(cm, cg))));
    });
    main.append(h('div', { class: 'bo-table-wrap' }, h('table', { class: 'bo-table bo-steps' },
      h('thead', {}, h('tr', {},
        h('th', { class: 'col-num' }, '#'), h('th', {}, 'Step'), h('th', {}, 'Starts'), h('th', {}, 'Done'),
        h('th', {}, 'Supply'), h('th', {}, h('span', { class: 'res-head' }, 'Cost ', h('i', { class: 'm' }, 'min'), ' / ', h('i', { class: 'g' }, 'gas'))),
        h('th', { class: 'col-total' }, 'Running total'))),
      tbody)));

    // How the timing moves with worker count.
    const caps = [...new Set([...capChoices(game).filter((c) => c > eco.startWorkers), opts.workerTarget])].sort((a, b) => a - b);
    const sims = caps.map((c) => ({ cap: c, sim: c === opts.workerTarget ? sim : run(c) }));
    const seen = new Set();
    const keyRows = sim.rows.map((r, i) => ({ r, i })).filter(({ r }) => !r.skipped && !seen.has(r.id) && seen.add(r.id));
    const cmp = h('table', { class: 'bo-table bo-compare' },
      h('thead', {}, h('tr', {}, h('th', {}, `Step \\ ${workerName} cap`),
        sims.map((s) => h('th', { class: s.cap === opts.workerTarget ? 'cur' : '' }, s.cap)))),
      h('tbody', {},
        keyRows.map(({ r, i }) => h('tr', {}, h('td', {}, r.node.name),
          sims.map((s) => h('td', { class: 'time' + (s.cap === opts.workerTarget ? ' cur' : '') }, fmt(s.sim.rows[i].start))))),
        h('tr', { class: 'total' }, h('td', {}, 'Build complete'),
          sims.map((s) => h('td', { class: 'time' + (s.cap === opts.workerTarget ? ' cur' : '') }, fmt(s.sim.finish)))),
        h('tr', { class: 'total' }, h('td', {}, 'Income per minute at the end'),
          sims.map((s) => h('td', { class: s.cap === opts.workerTarget ? 'cur' : '' }, Math.round(s.sim.incomePerMin.m) + ' / ' + Math.round(s.sim.incomePerMin.g))))));
    const cmpWrap = h('div', { class: 'bo-table-wrap' }, cmp);
    main.append(h('h3', { class: 'bo-sub' }, `How the timings change with the number of ${workerName}s`),
      h('p', { class: 'muted small' }, `Start time of each step if you stop making ${workerName}s at the given count. Fewer ${workerName}s means steps come earlier but income stays lower.`),
      cmpWrap);

    // Assumptions.
    const field = (label, get, set, step = 0.01) => h('label', {}, label + ' ',
      h('input', { type: 'number', step, min: 0, value: get(), onchange: (e) => { set(+e.target.value); render(); } }));
    const tiers = eco.tiers.map((t) => t.slice());
    const setTier = (i, v) => { tiers[i][1] = v; opts.economy.tiers = tiers; };
    main.append(h('details', { class: 'bo-assume' },
      h('summary', {}, 'Economy assumptions'),
      h('p', { class: 'muted small' }, 'Average mining per worker per second of game time. Travel time, supply blocks, Chrono Boost, MULEs and Queen injects are not modelled, so real games differ by a few seconds.'),
      h('div', { class: 'bo-fields' },
        tiers.map((t, i) => field(`Minerals/s, workers ${tiers.slice(0, i).reduce((a, x) => a + x[0], 0) + 1}-${tiers.slice(0, i + 1).reduce((a, x) => a + x[0], 0)} per base`, () => t[1], (v) => setTier(i, v))),
        field('Gas/s per worker', () => eco.gasRate, (v) => { opts.economy.gasRate = v; })),
      h('button', { type: 'button', onclick: () => { opts.economy = {}; render(); } }, 'Reset to defaults')));

    root.append(main);
    // On narrow screens, bring the column for the current worker count into view.
    const cur = cmp.querySelector('th.cur');
    if (cur && cmpWrap.scrollWidth > cmpWrap.clientWidth) {
      const first = cmp.querySelector('th').offsetWidth;
      cmpWrap.scrollLeft = Math.max(0, cur.offsetLeft - first - (cmpWrap.clientWidth - first - cur.offsetWidth) / 2);
    }
  }

  function stat(val, label, cls) {
    return h('div', { class: 'stat' + (cls ? ' ' + cls : '') }, h('b', {}, val), h('small', {}, label));
  }

  // One bar per step from start to finish on a shared clock, coloured by type like the tree.
  function timeline(rows, finish) {
    const TYPE = { b: 'building', u: 'unit', g: 'upgrade' };
    const steps = rows.filter((r) => r.node && !r.skipped && r.start != null && r.end != null);
    const end = Math.max(finish || 0, ...steps.map((r) => r.end));
    const step = end > 420 ? 120 : end > 210 ? 60 : 30;
    const span = Math.ceil(end / step) * step || 60;
    const pct = (t) => (t / span * 100).toFixed(2) + '%';
    const ticks = [];
    for (let t = 0; t <= span; t += step) ticks.push(t);
    const axis = h('div', { class: 'tl-axis', 'aria-hidden': 'true' },
      ticks.map((t) => h('span', { style: `left:${pct(t)}` }, fmt(t))));
    const grid = ticks.map((t) => h('i', { class: 'tl-grid', style: `left:${pct(t)}` }));
    const list = h('ol', { class: 'tl-rows' }, steps.map((r) => {
      const icon = App.icon(r.node.id);
      const name = r.node.name + (r.of > 1 ? ` (${r.idx + 1}/${r.of})` : '');
      return h('li', { class: 'tl-row' },
        h('button', { type: 'button', class: 'tl-name', title: 'Show in tech tree', onclick: () => App.openInTree(r.id) },
          icon ? h('img', { src: icon, alt: '' }) : null, h('span', {}, name)),
        h('div', { class: 'tl-track' }, grid.map((g) => g.cloneNode()),
          h('span', {
            class: 'tl-bar ' + TYPE[r.node.t], style: `left:${pct(r.start)};width:${pct(Math.max(1, r.end - r.start))}`,
            title: `${name}: ${fmt(r.start)} to ${fmt(r.end)}`,
          })));
    }));
    return h('div', { class: 'tl', role: 'img', 'aria-label': `Timeline of ${steps.length} steps, finishing at ${fmt(end)}` },
      h('div', { class: 'tl-head' }, h('span', {}), axis), list,
      h('div', { class: 'tl-key' },
        h('span', {}, h('i', { class: 'tl-sw building' }), 'Building'),
        h('span', {}, h('i', { class: 'tl-sw unit' }), 'Unit'),
        h('span', {}, h('i', { class: 'tl-sw upgrade' }), 'Upgrade'),
        h('span', { class: 'muted' }, 'Bars run from when a step starts to when it finishes.')));
  }

  App.onChange(render);
  render();
})();
