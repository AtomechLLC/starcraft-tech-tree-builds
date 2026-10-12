# StarCraft Tech Trees & Build Orders

A static fan reference site for **StarCraft II** (Legacy of the Void) and **StarCraft: Brood War**.

- **Tech Trees:** interactive prerequisite diagrams for Terran, Protoss and Zerg. Click any building, unit or upgrade to trace what it needs and what it unlocks. Each tier separates what is unlocked directly, what needs an add-on, and what needs research.
- **Build Orders:** common openers per race with total costs, estimated step timings, and how those timings shift with the number of workers you make.

No build step: open `index.html` or serve the folder as static files. The included GitHub Actions workflow deploys `main` to GitHub Pages.

## Files

| File | Purpose |
| --- | --- |
| `data.js`, `data-bw.js` | Tech data (costs, times, prerequisites) for SC2 and Brood War |
| `buildorders.js` | Build order definitions |
| `sim.js` | Economy simulator used for build order timings |
| `app.js`, `bo.js` | Tech tree and Build Orders pages |
| `icons/`, `icons.js` | Unit, building and upgrade icons |

## Notes

Costs and times reflect late-LotV ladder balance and Brood War game data; build order timings come from a simplified economy model (editable on the page) and are estimates.

Icons are from [Liquipedia](https://liquipedia.net); see `icons/CREDITS.txt` for each source page. StarCraft artwork and trademarks belong to Blizzard Entertainment. This is an unofficial fan project.
