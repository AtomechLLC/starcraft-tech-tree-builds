// Build order economy simulator. Pure functions, no DOM.
// Model: workers are produced continuously (up to a cap) and each build step starts once its
// supply trigger is reached, its prerequisites are finished and it can be afforded.
// Mining rates are averages per worker per game second; see ECONOMY for the defaults.

(function () {
  'use strict';

  const ECONOMY = {
    sc2: {
      timeScale: 1,                 // data times are already Faster-speed seconds
      startWorkers: 12, startMinerals: 50,
      tiers: [[16, 0.9], [8, 0.4]], // per base: first 16 workers (2 per patch), next 8 (3rd per patch)
      gasRate: 0.89,                // per worker on gas (3 per geyser ~ 160/min)
      larva: { every: 11, max: 3 },
    },
    bw: {
      timeScale: 1 / 1.6,           // data times are Normal-speed seconds; Fastest is ~1.6x faster
      startWorkers: 4, startMinerals: 50,
      tiers: [[9, 1.0], [9, 0.75], [9, 0.1]], // per base: 1st, 2nd and 3rd worker per patch (9 patches)
      gasRate: 0.9,
      larva: { every: 14, max: 3 },
    },
  };
  const RACE = {
    terran: { worker: 'scv', base: 'cc', gas: 'refinery', builder: 'busy' },
    protoss: { worker: 'probe', base: 'nexus', gas: 'assim', builder: 'brief' },
    zerg: { worker: 'drone', base: 'hatch', gas: 'extractor', builder: 'consumed' },
  };

  function simulate(nodes, game, race, build, opts) {
    const eco = Object.assign({}, ECONOMY[game], opts.economy || {});
    const R = RACE[race];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const T = (n) => Math.max(0.5, (n.time || 0) * eco.timeScale);
    const workerNode = byId.get(R.worker);
    const target = opts.workerTarget;
    const gasPer = opts.gasPerGeyser ?? 3;

    // Expand counts: [sup, id, count] -> repeated steps.
    const steps = [];
    build.steps.forEach(([sup, id, count = 1, note]) => {
      for (let k = 0; k < count; k++) steps.push({ sup, id, note, idx: k, of: count, node: byId.get(id) });
    });

    let t = 0, min = eco.startMinerals, gas = 0, minedM = 0, minedG = 0, spentWorkersM = 0;
    let workers = eco.startWorkers, workersInProd = 0, gasWorkers = 0, busy = 0, armySupply = 0;
    let bases = 1, geysers = 0;
    const done = new Map([[R.base, 1]]);   // completed counts (units: alive counts)
    const pending = new Map();             // in-progress counts
    const producers = new Map([[R.base, [0]]]);
    const larva = race === 'zerg' ? [{ n: 3, next: eco.larva.every }] : [];
    const events = [];                     // {at, fn}
    const rows = steps.map((s) => ({ ...s, start: null, end: null, skipped: null }));
    const workerLog = [];                  // {start, end, sup} for every worker made
    let next = 0;

    const inc = (m, id, d) => m.set(id, (m.get(id) || 0) + d);
    const later = (at, fn) => events.push({ at, fn });
    const has = (id) => (done.get(id) || 0) > 0;
    const freeProducer = (id) => {
      const list = producers.get(id) || [];
      let best = -1;
      list.forEach((f, i) => { if (f <= t && (best < 0 || f < list[best])) best = i; });
      return best;
    };
    const larvaSource = () => larva.findIndex((l) => l.n > 0);

    function complete(node) {
      inc(pending, node.id, -1);
      inc(done, node.id, 1);
      if (node.t === 'b') {
        if (!producers.has(node.id)) producers.set(node.id, []);
        producers.get(node.id).push(t);
        if (node.id === R.base) { bases++; if (race === 'zerg') larva.push({ n: 1, next: t + eco.larva.every }); }
        if (node.id === R.gas) geysers++;
      }
    }

    // Can this step ever be satisfied? (prerequisite missing from the whole build)
    function impossible(i) {
      const n = rows[i].node;
      if (!n) return 'Unknown item';
      const needs = [...(n.req || [])];
      if (n.from && n.from !== R.base) needs.push(n.from);
      for (const id of needs) {
        if (has(id) || (pending.get(id) || 0) > 0) continue;
        if (rows.slice(i + 1).some((r) => r.id === id)) continue;
        return 'Needs ' + (byId.get(id)?.name || id);
      }
      return null;
    }

    // Try to start step i now. Returns 'started' | 'prereq' | 'money'.
    function tryStep(i) {
      const row = rows[i], n = row.node;
      const needs = (n.req || []).filter((id) => !has(id));
      if (needs.length) return 'prereq';
      const isMorphUnit = n.from && byId.get(n.from)?.t === 'u';
      const viaLarva = /^Larva/.test(n.via || '');
      let prodIdx = -1, larvaIdx = -1;
      if (isMorphUnit) {
        if (!has(n.from)) return 'prereq';
      } else if (viaLarva) {
        if (!has(n.from)) return 'prereq';
        larvaIdx = larvaSource();
        if (larvaIdx < 0) return 'prereq';
      } else if (n.from) {
        if (!has(n.from)) return 'prereq';
        prodIdx = freeProducer(n.from);
        if (prodIdx < 0) return 'prereq';
      } else if (n.t === 'b' && workers - busy - gasWorkers < 1) {
        return 'prereq';
      }
      if (min < (n.m || 0) || gas < (n.g || 0)) return 'money';

      min -= n.m || 0; gas -= n.g || 0;
      const dur = T(n);
      row.start = t; row.end = t + dur;
      inc(pending, n.id, 1);
      if (isMorphUnit) {
        const from = byId.get(n.from);
        inc(done, n.from, -1);
        armySupply += (n.sup || 0) - (from.sup || 0);
      } else if (viaLarva) {
        larva[larvaIdx].n--;
        armySupply += n.sup || 0;
      } else if (n.from) {
        producers.get(n.from)[prodIdx] = t + dur;
        if (n.t === 'u') armySupply += n.sup || 0;
      } else if (n.t === 'b') {
        if (R.builder === 'consumed') { workers--; }
        else { const hold = R.builder === 'busy' ? dur : 2; busy++; later(t + hold, () => { busy--; }); }
      }
      later(t + dur, () => complete(n));
      return 'started';
    }

    function tryWorker() {
      if (workers + workersInProd >= target) return;
      if (min < workerNode.m) return;
      const dur = T(workerNode);
      if (race === 'zerg') {
        const li = larvaSource();
        if (li < 0) return;
        larva[li].n--;
      } else {
        const pi = freeProducer(R.base);
        if (pi < 0) return;
        producers.get(R.base)[pi] = t + dur;
      }
      min -= workerNode.m; spentWorkersM += workerNode.m;
      workerLog.push({ start: t, end: t + dur, sup: workers + workersInProd + armySupply });
      workersInProd++;
      later(t + dur, () => { workersInProd--; workers++; });
    }

    const dt = 0.25, LIMIT = 20 * 60;
    while (t <= LIMIT) {
      // Finish anything due.
      events.sort((a, b) => a.at - b.at);
      while (events.length && events[0].at <= t + 1e-9) events.shift().fn();

      // Gas assignment: fill geysers up to gasPer workers each, taking from minerals.
      const wantGas = Math.min(geysers * gasPer, Math.max(0, workers - busy - 1));
      gasWorkers = wantGas;

      // Larva regeneration.
      larva.forEach((l) => { if (l.n >= eco.larva.max) l.next = t + eco.larva.every; else if (t >= l.next) { l.n++; l.next = t + eco.larva.every; } });

      // Income.
      let miners = Math.max(0, workers - busy - gasWorkers), rate = 0;
      for (const [cap, r] of eco.tiers) { const k = Math.min(miners, cap * bases); rate += k * r; miners -= k; }
      const dm = rate * dt, dg = gasWorkers * eco.gasRate * dt;
      min += dm; gas += dg; minedM += dm; minedG += dg;

      // Steps (in order), then workers.
      let allowWorkers = true;
      while (next < rows.length) {
        const why = impossible(next);
        if (why) { rows[next].skipped = why; next++; continue; }
        const supply = workers + workersInProd + armySupply;
        const triggered = supply >= rows[next].sup || workers + workersInProd >= target;
        if (!triggered) break;
        const res = tryStep(next);
        if (res === 'started') { next++; continue; }
        if (res === 'money') allowWorkers = false;
        break;
      }
      if (allowWorkers) tryWorker();

      if (next >= rows.length && rows.every((r) => r.skipped || (r.end != null && r.end <= t))) break;
      t += dt;
    }

    const started = rows.filter((r) => r.start != null);
    return {
      rows, workerLog, startWorkers: eco.startWorkers,
      finish: started.length ? Math.max(...started.map((r) => r.end)) : 0,
      lastStart: started.length ? Math.max(...started.map((r) => r.start)) : 0,
      workers: workers + workersInProd,
      minedM, minedG, spentWorkersM,
      incomePerMin: (() => {
        let miners = Math.max(0, workers - gasWorkers), rate = 0;
        for (const [cap, r] of eco.tiers) { const k = Math.min(miners, cap * bases); rate += k * r; miners -= k; }
        return { m: rate * 60, g: gasWorkers * eco.gasRate * 60 };
      })(),
      timedOut: rows.some((r) => !r.skipped && r.start == null),
    };
  }

  window.SC_SIM = { simulate, ECONOMY, RACE };
})();
