# Cosmic Explorer · implementation and validation

## What the module does

`/cosmic-explorer` is a separate client-side Three.js experience inside the existing ASCENTRA site shell. The established research pages, FastAPI routes, data cache, and PostGIS schema were not rebuilt or replaced.

- A bounded procedural star field, selectable nebula/cluster/galaxy/planetary models, target markers, assisted destination flight, free keyboard movement, mouse-look, wheel/button zoom, touch step controls, pause/resume, reset, fullscreen, and a reduced-graphics option.
- Optional browser Gamepad API input: left stick moves, right stick looks, and A boosts when a standard controller is present.
- Five environment views and destination selections. A few destinations unlock through exploration milestones; mission completion uses local movement/scans/research handoffs, not scientific detection claims.
- Mission and scan progress persists in `localStorage` under `ascentra.cosmic-explorer.progress.v1`.
- An arrival event opens the selected destination briefing in the navigation console. Every displayed NASA reference value has an adjacent source link. The briefings include the source pages' class, constellation, position, distance, apparent magnitude, cluster count, and published approximate diameter where the cited page reports them.
- Object Investigator, Explore, Spectral Explorer, Motion Analytics, and the ED138 observation ledger pass coordinates into the game. The game never treats a positional handoff as a confirmed identity.

## Data and representation policy

The curated destination facts are reference values from these NASA pages:

- [NASA Science · Messier 31](https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-31/), [NASA Hubble · M31 position](https://science.nasa.gov/asset/hubble/compass-and-scale-image-of-m31/), and [NASA Hubble · Andromeda overview](https://science.nasa.gov/missions/hubble/hubble-zooms-into-the-rosy-tendrils-of-andromeda/).
- [NASA Science · Messier 42](https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-42/) and [NASA Hubble · Orion Nebula position](https://science.nasa.gov/asset/hubble/location-of-the-orion-nebula-details/).
- [NASA Science · Messier 45](https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-45/) and [NASA Hubble · Pleiades position](https://science.nasa.gov/asset/hubble/annotated-image-of-the-pleiades-and-hst-field-of-view/).

The linked references are static public reference pages, not a live NASA query. Rounded distances and approximate diameters are labeled as such. When a reference page does not report a per-value uncertainty, temperature, or other parameter, ASCENTRA does not infer it. Coordinate epoch is identified as unspecified where the source asset omits it.

All game geometry and the placement of objects in its navigable 3D scene are procedural and schematic. Scene coordinates and flight units do not encode light-years, measured 3D positions, current ephemerides, or image pixels. Generic stellar classes and the planetary atlas are educational illustrations without object-specific NASA facts. A research target with coordinates but no supported catalogue identification is shown as an unclassified target.

## Validation status

On 15 November 2026, the following checks passed after the destination handoff changes:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm build` (including static generation of `/cosmic-explorer`)
- `pnpm test:smoke` (all 10 application routes returned HTTP 200 with their page markers, shared navigation, and attribution)
- `.venv\Scripts\python.exe -m compileall backend`
- `.venv\Scripts\python.exe -m unittest backend.test_motion backend.test_main backend.test_science -v` (51 passed)

The smoke test checks server-rendered route availability, not WebGL behavior. Arrival switches the console to the navigation tab and scrolls the NASA fact briefing into view; this path has been code-reviewed but not driven in a real browser session. These checks do not prove GPU performance on every device. WebGL creation failure is reported visibly while the destination console remains available.

Still to verify manually in a browser: begin a course and confirm arrival; confirm the NASA briefing appears for M42, M45, and M31; scan M42 and verify M31 unlocks; travel 500 simulation units and verify M45 unlocks; test mouse drag, WASD/QE, zoom, pause/resume, touch controls, fullscreen, low graphics, route handoffs, and mission persistence after a page reload. No manual mobile-browser or controller hardware test is claimed unless it is performed on that device.
