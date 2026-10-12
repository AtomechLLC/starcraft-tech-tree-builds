// Common build orders. Each step is [supply, nodeId, count?, note?], where nodeId refers to
// a node in data.js / data-bw.js. Supply is the "at N supply" trigger players use.
// These are widely used community versions; exact supply timings vary by player and patch.

window.SC_BUILDS = {
  sc2: {
    terran: [
      {
        id: 'reaper-expand', name: 'Reaper Expand', matchup: 'Any',
        desc: 'The standard safe opener: Reaper scout, fast Orbital, then expand and add Factory and Starport.',
        steps: [[14, 'depot'], [16, 'barracks'], [16, 'refinery'], [19, 'reaper'], [19, 'orbital'], [20, 'cc'], [20, 'depot'],
          [21, 'factory'], [22, 'refinery'], [23, 'raxre'], [24, 'starport'], [26, 'hellion', 2], [30, 'medivac']],
      },
      {
        id: 'cc-first', name: 'Command Center First', matchup: 'TvP / TvZ',
        desc: 'Greedy economic opener that expands before the Barracks.',
        steps: [[14, 'depot'], [16, 'cc'], [16, 'barracks'], [16, 'refinery'], [19, 'orbital'], [19, 'marine'], [20, 'depot'],
          [21, 'refinery'], [22, 'factory'], [23, 'raxre'], [24, 'starport']],
      },
      {
        id: '1-1-1-banshee', name: '1-1-1 Cloak Banshee', matchup: 'TvT / TvP',
        desc: 'One of each production building into cloaked Banshee harass.',
        steps: [[14, 'depot'], [16, 'barracks'], [16, 'refinery'], [17, 'refinery'], [19, 'orbital'], [19, 'marine'],
          [20, 'factory'], [20, 'depot'], [22, 'starport'], [23, 'sptl'], [24, 'banshee'], [26, 'cloak'], [27, 'banshee']],
      },
      {
        id: '3-rax-stim', name: '3-Rax Stim Timing', matchup: 'TvZ / TvP',
        desc: 'Expand, then three Barracks with Stimpack and Combat Shield for an early bio push.',
        steps: [[14, 'depot'], [16, 'barracks'], [16, 'refinery'], [19, 'reaper'], [19, 'orbital'], [20, 'cc'], [20, 'depot'],
          [22, 'barracks', 2], [24, 'raxtl'], [25, 'raxre'], [26, 'stim'], [27, 'depot'], [28, 'shield'], [30, 'marine', 6]],
      },
    ],
    protoss: [
      {
        id: 'gate-expand', name: 'Gateway Expand', matchup: 'Any',
        desc: 'Standard Gateway, Cybernetics Core, fast Nexus and Warp Gate.',
        steps: [[14, 'pylon'], [16, 'gateway'], [17, 'assim'], [20, 'nexus'], [20, 'cyber'], [21, 'assim'], [22, 'pylon'],
          [23, 'adept'], [23, 'warpgate'], [25, 'stalker'], [27, 'pylon'], [28, 'twilight']],
      },
      {
        id: 'stargate-oracle', name: 'Stargate Oracle Opener', matchup: 'PvZ / PvT',
        desc: 'Gateway expand into an early Stargate for Oracle harass and scouting.',
        steps: [[14, 'pylon'], [16, 'gateway'], [17, 'assim'], [19, 'assim'], [20, 'nexus'], [20, 'cyber'], [22, 'pylon'],
          [23, 'adept'], [23, 'warpgate'], [24, 'stargate'], [27, 'oracle'], [30, 'pylon'], [31, 'oracle']],
      },
      {
        id: '4-gate', name: '4 Gate', matchup: 'PvP / PvZ',
        desc: 'One-base all-in: Warp Gate with four Gateways warping in Stalkers.',
        steps: [[14, 'pylon'], [15, 'gateway'], [16, 'assim'], [19, 'cyber'], [20, 'assim'], [21, 'pylon'], [22, 'stalker'],
          [23, 'warpgate'], [25, 'gateway', 3], [26, 'pylon'], [28, 'stalker', 4]],
      },
    ],
    zerg: [
      {
        id: 'hatch-gas-pool', name: 'Hatch, Gas, Pool (16-18-17)', matchup: 'Any',
        desc: 'The standard Zerg opener: fast natural, gas, then Spawning Pool, two Queens and Metabolic Boost.',
        steps: [[13, 'overlord'], [16, 'hatch'], [18, 'extractor'], [17, 'pool'], [19, 'overlord'], [19, 'queen', 2],
          [23, 'ling', 2], [25, 'metabolic'], [27, 'overlord'], [30, 'queen']],
      },
      {
        id: 'pool-first', name: '17 Pool, Hatch, Gas', matchup: 'ZvZ / ZvP',
        desc: 'Safer Pool-first version for when early aggression is likely.',
        steps: [[13, 'overlord'], [17, 'pool'], [17, 'hatch'], [17, 'extractor'], [19, 'overlord'], [19, 'queen', 2],
          [23, 'ling', 2], [25, 'metabolic']],
      },
      {
        id: '12-pool', name: '12 Pool', matchup: 'ZvZ / cheese',
        desc: 'Early Pool for fast Zerglings, then expand behind it.',
        steps: [[12, 'pool'], [13, 'overlord'], [13, 'ling', 3], [16, 'extractor'], [17, 'queen'], [18, 'hatch'], [19, 'metabolic']],
      },
      {
        id: 'roach-ravager', name: 'Roach-Ravager Timing', matchup: 'ZvZ / ZvT',
        desc: 'Two-base Roach Warren with early Ravagers.',
        steps: [[13, 'overlord'], [16, 'hatch'], [18, 'extractor'], [17, 'pool'], [19, 'overlord'], [19, 'queen', 2],
          [23, 'roachwarren'], [24, 'extractor'], [26, 'overlord'], [27, 'roach', 4], [33, 'lair'], [35, 'ravager', 2]],
      },
    ],
  },

  bw: {
    terran: [
      {
        id: '1-rax-fe', name: '1 Rax Fast Expand', matchup: 'TvZ / TvP',
        desc: 'One Barracks for safety, then an early Command Center.',
        steps: [[9, 'depot'], [11, 'barracks'], [13, 'marine'], [15, 'cc'], [16, 'depot'], [16, 'refinery'], [18, 'marine', 2],
          [20, 'bunker'], [22, 'factory']],
      },
      {
        id: '2-fact-vulture', name: '2 Factory Vultures', matchup: 'TvP',
        desc: 'Two Factories with a Machine Shop for Vulture and Spider Mine pressure.',
        steps: [[9, 'depot'], [11, 'barracks'], [12, 'refinery'], [15, 'marine'], [16, 'factory'], [17, 'depot'], [20, 'factory'],
          [21, 'shop'], [22, 'vulture', 2], [24, 'mines'], [25, 'depot'], [26, 'vulture', 2], [28, 'ion']],
      },
      {
        id: 'bbs', name: 'BBS (2 Rax Rush)', matchup: 'Cheese',
        desc: 'Two very early Barracks before a Supply Depot for a Marine rush.',
        steps: [[8, 'barracks'], [9, 'barracks'], [10, 'depot'], [10, 'marine', 4], [14, 'depot'], [14, 'marine', 4]],
      },
    ],
    protoss: [
      {
        id: '1-gate-core', name: '1 Gate Core', matchup: 'PvT / PvP',
        desc: 'Standard Gateway into Cybernetics Core, Dragoons and Singularity Charge.',
        steps: [[8, 'pylon'], [10, 'gateway'], [12, 'assim'], [13, 'zealot'], [14, 'cyber'], [16, 'pylon'], [18, 'dragoon'],
          [20, 'singularity'], [21, 'dragoon']],
      },
      {
        id: 'forge-fe', name: 'Forge Fast Expand', matchup: 'PvZ',
        desc: 'Forge and Photon Cannons protect an early Nexus against Zerglings.',
        steps: [[8, 'pylon'], [11, 'forge'], [13, 'nexus'], [14, 'gateway'], [15, 'cannon', 2], [17, 'pylon'], [18, 'assim'],
          [19, 'cyber'], [21, 'zealot']],
      },
      {
        id: '2-gate-zealot', name: '2 Gate Zealot', matchup: 'PvZ / PvP',
        desc: 'Two early Gateways for Zealot pressure.',
        steps: [[8, 'pylon'], [9, 'gateway'], [10, 'gateway'], [12, 'zealot', 2], [14, 'pylon'], [16, 'zealot', 2]],
      },
    ],
    zerg: [
      {
        id: '12-hatch', name: '12 Hatch', matchup: 'ZvP / ZvT',
        desc: 'Overlord at 9, Hatchery at 12, then Pool and gas: the standard macro opener.',
        steps: [[9, 'overlord'], [12, 'hatch'], [11, 'pool'], [10, 'extractor'], [13, 'ling', 2], [16, 'overlord'], [18, 'lair']],
      },
      {
        id: '9-pool', name: '9 Pool Speed', matchup: 'ZvZ',
        desc: 'Early Pool and gas for fast Zerglings with Metabolic Boost.',
        steps: [[9, 'pool'], [8, 'extractor'], [9, 'overlord'], [9, 'ling', 3], [12, 'metabolic'], [12, 'hatch']],
      },
      {
        id: '4-pool', name: '4 Pool', matchup: 'Cheese',
        desc: 'Pool with the starting Drones for the fastest possible Zerglings.',
        steps: [[4, 'pool'], [3, 'ling', 3], [6, 'overlord']],
      },
    ],
  },
};
