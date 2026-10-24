# plumberpuzzle-site

Public marketing site for **Plumber Puzzle: Pipe Flow** (App Store id 6789703995).

- Preferred host: `https://plumberpuzzle.remnantsecurity.com/`
- GitHub Pages + CNAME `plumberpuzzle` → Pages host
- PostHog on marketing pages only (not privacy.html; never in the iOS app)
- Seller/copyright: Ian Trimble (© 2026 Ian Trimble); Remnant portfolio hosts the site
- Legacy support-only: https://itrimble.github.io/plumber-puzzle-support/

Publisher host: Remnant Security Group LLC portfolio.

## Playable demo (`#play`, `play/`)

Three boards from the game, playable in the browser with the game's own pipe art,
rules and CC0 sound. Follows `~/projects/site-templates/docs/PLAYABLE-DEMO.md`.

- `play/rules.js` ports the game's model (openings, flow walk, win, dead ends);
  `play/play.js` the pressure clock, leaks, surge and scoring from `godot/scripts/game.gd`.
- `python3 -B tools/build_demo_assets.py` rebuilds `play/levels.js`, the tile atlas,
  audio and props from `~/projects/Pipe Flow/PlumberPuzzle`. Do not edit those by hand.
- `node tools/test_rules.mjs` checks `rules.js` against the game's Python reference
  model (1,206 board states). `node tools/test_play.mjs <url> [out] [--phone]` drives
  the page in headless Chrome (`npm i --no-save puppeteer-core@23.11.1` first).
- Boards 1 and 2 (First Drop, Pressure) are the redesigned early levels; the 1.0.1
  release still ships the older small versions of those two levels.
