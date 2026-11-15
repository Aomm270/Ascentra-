# ASCENTRA · SPHEREx Sky Chronicles

ASCENTRA is a public, account-free astronomy explorer for SPHEREx DR1, DR1 All-Sky Cube, and QR3 products in the NASA/IPAC Infrared Science Archive. It pairs a Next.js interface with a FastAPI service that searches IRSA SIA2, requests small FITS cutouts, and returns archive metadata and a display-only preview.

The home page now introduces the platform as a seven-chapter journey, with direct chapter links and a new archive-observation bridge between the observatory and scientific analysis. Use **Scientific Research** or **SPHEREx Observatory** to reach the live archive viewer, and **Cosmic Intelligence** to enter the connected spectral, object, motion, and TNO tools. The Cosmic Explorer remains a separate 3D simulation.

> ASCENTRA is an independent public-facing exploration interface. It is not an official NASA product and is not affiliated with NASA, JPL, or Caltech.

## Features

- Search by ICRS right ascension and declination, or resolve an object name through CDS Sesame's active IDIA mirror.
- Query IRSA SIA2 for DR1, DR1 Deep, DR1 All-Sky Cube, QR3, or QR3 Deep products with a sky radius, time range, and wavelength interval. The API reports SIA overflow when the requested result limit truncates the returned products.
- Inspect returned product identifiers, image reference coordinates, reported observation time, exposure, calibration level, and wavelength bounds.
- Request an IRSA cutout and render a FITS image preview with selectable percentile-based stretches, contrast and WCS readout. Open the original IRSA file for raw pixels and FITS extensions.
- Pan/zoom the preview, step through returned products, and compare product previews with a divider or side-by-side.
- Check matching collection, wavelength bounds, calibration level, and distinct observation times before calling a pair metadata-compatible.
- Run the Motion Analytics pipeline on 2–6 SPHEREx spectral-image epochs that pass release/calibration/product-band checks: FITS cutouts, Photutils source detections, WCS coordinates, conservative pixel-quality masking, mutual-source translation registration, source matching, and measured-epoch plots/exports. The fit is withheld per source unless its approximate WCS-WAVE local passbands overlap by at least 95%.
- Keep the discoveries feed empty until a verified catalogue-level discovery pipeline exists. Motion tracks are local image detections, not catalogue identifications or confirmed moving objects.
- Explore real DR1 All-Sky Cube samples across all 102 channels; the backend reads wavelengths, surface-brightness values, NHITS and FLAGS with bounded HTTP byte ranges instead of transferring the full tile.
- Cross-match measured motion-track coordinates with IRSA 2MASS PSC, AllWISE and Gaia DR3 records. Results are provisional and ranked by angular separation, not an identity probability.
- Explore `/cosmic-explorer` as a separate Three.js flight experience with keyboard, mouse, touch and gamepad controls, environment selection, local missions, and browser-saved progress. NASA reference facts appear automatically at arrival for the curated M31, M42, and M45 destinations, with a source link beside every displayed value.
- Transfer measured sky coordinates from the observation viewer, spectral sampler, motion tracks, TNO observation ledger, and object investigator into Cosmic Explorer. The game labels generated scenery and flight distances as simulation; it does not present them as NASA images or ephemerides.
- Use the seven-chapter storytelling home page and the Cosmic Intelligence module index to move between science workflows without replacing their data pipelines.
- Provide links to IRSA's official Mosaic, Spectrophotometry, Source Discovery, and MOST workflows.
- Keep a PostGIS schema for optional durable metadata, candidates, comparisons, and processing jobs in `backend/schema.sql`. The current API uses process-local TTL caches and does not require a database.

## Project layout

```text
.
├── backend/
│   ├── main.py              # FastAPI service and IRSA integration
│   ├── spectral.py          # Selective FITS byte-range sampling and real cube channel profiles
│   ├── motion.py            # SPHEREx cutout source detection and epoch matching
│   ├── catalog.py           # Conservative IRSA Gator positional cross-matches
│   ├── requirements.txt
│   ├── schema.sql           # Optional PostGIS persistence schema
│   ├── test_motion.py       # Motion pipeline and scientific regression tests
│   ├── test_science.py      # FITS range, WCS, channel and catalogue tests
│   └── Dockerfile
├── src/
│   ├── app/                 # Next.js pages and global design system
│   ├── components/          # Explorer, comparison, discovery and mission UI
│   │   ├── CosmicExplorer.tsx # Procedural 3D flight experience and destination facts
│   └── lib/api.ts           # Browser API types and utilities
├── .env.example
├── docker-compose.yml
└── Dockerfile
```

## Local setup

### Requirements

- Node.js 20.9 or newer
- pnpm 9 or newer (or enable it with `corepack enable`)
- Python 3.12 recommended

### Start the backend

In PowerShell:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
Copy-Item .env.example .env
python -m uvicorn backend.main:app --reload --port 8000
```

FastAPI's interactive API reference is at [http://localhost:8000/docs](http://localhost:8000/docs). The service needs outbound HTTPS access to IRSA and CDS Sesame; there are no credentials to configure for public SIA queries.

### Start the frontend

In a second terminal:

```powershell
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The browser talks to `NEXT_PUBLIC_API_URL`, defaulting to `http://localhost:8000`.

In this workspace, `.env.local` points the frontend to `http://localhost:8001`; start FastAPI on port 8001 when using the existing local configuration. Fresh setups without that override can use port 8000 as shown above.

## Configuration

Copy `.env.example` and set values for the deployment environment:

| Variable | Purpose | Default |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Browser-visible FastAPI base URL | `http://localhost:8000` |
| `NEXT_PUBLIC_SITE_URL` | Canonical public site origin for page metadata, sitemap, robots, and social links | `http://localhost:3000` |
| `IRSA_SIA_URL` | IRSA SIA2 endpoint | `https://irsa.ipac.caltech.edu/SIA` |
| `IRSA_TIMEOUT_SECONDS` | Upstream request timeout | `30` |
| `IRSA_MAX_RECORDS` | SIA result cap per query | `100` |
| `PREVIEW_MAX_BYTES` | Maximum bytes fetched for a FITS preview | `35000000` |
| `RATE_LIMIT_PER_MINUTE` | Per-process API request limit by client address | `40` |
| `CORS_ORIGINS` | Comma-separated allowed web origins | `http://localhost:3000` |

## API routes

- `GET /api/health` — backend and archive service identity.
- `GET /api/observations` — SIA2 position/radius/release/band/time query; results include metadata and original product URLs.
- `GET /api/spectral/profile/{product_id}?ra=…&dec=…` — read the selected position from a returned DR1 All-Sky Cube product, including the 102-channel wavelength table, surface brightness, NHITS and FLAGS using selective FITS ranges.
- `GET /api/catalog/matches?ra=…&dec=…&radius_arcsec=…` — retrieve nearby 2MASS PSC, AllWISE and Gaia DR3 catalogue rows from IRSA Gator, ranked by spherical separation.
- `GET /api/preview/{product_id}` — fetch a small IRSA SPHEREx cutout and render a selectable linear/log/sqrt/asinh PNG display with FITS/WCS preview metadata (`stretch`, `contrast`, `low_percentile`, `high_percentile`, `plane`, `ra`, `dec`, `size`).
- `GET /api/preview-world/{preview_id}?x=…&y=…` — convert displayed preview pixels to sky coordinates using the cached FITS WCS.
- `GET /api/preview-grid/{preview_id}` — generate a celestial coordinate-grid overlay from the cached FITS WCS.
- `POST /api/comparison-readiness` — metadata compatibility checks. It always reports `scientific_difference_ready: false` until registered, variance-aware, PSF-matched comparison processing is implemented.
- `GET /api/resolve?name=...` — CDS Sesame name-to-coordinate lookup.
- `POST /api/motion/analyze` — retrieve compatible IRSA FITS cutouts, detect and match image sources, register epochs, calculate displacements and (with ≥3 epochs over ≥1 day) fit apparent angular motion only when each matched source also passes the ≥95% local WCS-WAVE passband overlap rule. Accepts 2–6 products in one collection, calibration level, and ≥95% overlapping reported product wavelength ranges.
- `GET /api/tno/ed138` — live JPL SBDB orbital solution, physical parameters, uncertainties, and covariance for 2026 ED138.
- `GET /api/tno/ed138/observations` — published Rubin/DECam astrometry and optical photometry; optionally validates listed positions against JPL Horizons and returns published TESS sector photometry.
- `GET /api/tno/ed138/ephemeris` — observer ephemerides from JPL Horizons (`start_date`, `days`, `step_days`).
- `GET /docs` — generated OpenAPI documentation.

## TNO Intelligence Lab

Open `/motion` for SPHEREx motion analysis, or `/tno-lab` to investigate 2026 ED138. The module retrieves live JPL orbital data and Horizons ephemerides, parses the published Rubin/DECam observation table and TESS sector measurements, and retains a source URL and retrieval timestamp with each record. It compares published positions with the current JPL solution as a consistency check; it does not refit the orbit or represent this as an independent holdout validation. The orbital scene is a two-body visualization, while sky positions are supplied by Horizons. The supplied 0.043 arcsec/min rate is shown only as an illustrative arithmetic benchmark.

The module does not claim a satellite, a SPHEREx spectrum, or detections from inaccessible image pixels. Rubin calibrated image products described in the ED138 release are restricted to Rubin data-rights holders. See [TNO Intelligence validation report](TNO_INTELLIGENCE_VALIDATION.md) for live checks, residuals, and scientific limits. See [Motion Analytics validation report](MOTION_ANALYTICS_VALIDATION.md) for the real IRSA multi-epoch run, unit coverage, and method limits.

See [Spectral Intelligence and Catalogue Cross-Match validation](SPECTRAL_INTELLIGENCE_VALIDATION.md) for the real DR1 cube byte-range profile check, IRSA Gator catalogue query, test results, and current SIA2 availability limits.

## Cosmic Explorer

Open [http://localhost:3000/cosmic-explorer](http://localhost:3000/cosmic-explorer) for the separate starship experience. Use WASD to move, Q/E for altitude, drag to look, the wheel or zoom buttons to zoom, and click a visible waypoint or select one from the navigation console to set an assisted course. Space or Shift boosts. Touch users have step controls; standard gamepads can use the sticks and A button.

At arrival, the mission console opens a NASA-sourced fact briefing for M31, M42, or M45. Each displayed fact links to its NASA Science or NASA Hubble reference. The pages do not provide uncertainties for some summary values; ASCENTRA labels that omission and leaves unreported properties such as temperature unavailable. Destinations reached from scientific modules use their coordinates but remain unclassified when there is no supported object match. Mission progress is saved to this browser only.

The 3D stars, nebulae, galaxies, planetary scenes, and ship navigation distances are generated for exploration. They are not telescope images, measured three-dimensional positions, a scale model, or current ephemerides. Lower-performance devices can switch to Low graphics. Scene rendering and mission progress do not depend on the backend; science handoffs open the existing research pages and their real data services.

## Run checks

```powershell
pnpm lint
pnpm typecheck
pnpm build
pnpm test:smoke
.venv\Scripts\python.exe -m compileall backend
.venv\Scripts\python.exe -m unittest backend.test_motion backend.test_main backend.test_science -v
.venv\Scripts\python.exe -m uvicorn backend.main:app --port 8000
```

With the API running, use the Explore page's example coordinates `210.80225, 54.34894` or try the COSMOS position `150.7817877, 3.3502204`. Query DR1 or QR3 and confirm a returned result links to its original product. A preview fetch may take longer because IRSA has to create and return a FITS cutout.

For an online integration check against the public IRSA service, run `.venv\Scripts\python.exe -m backend.smoke_check` in a second terminal while the backend is running. It checks DR1 and QR3 SIA retrieval, a real FITS cutout preview, Sesame name resolution, and the conservative comparison gate. This test requires outbound internet access. If the backend is running on a non-default port, set `$env:ASCENTRA_API_URL = "http://127.0.0.1:8001"` before running the script.

## Docker

```powershell
docker compose up --build
```

The web app runs on port 3000 and FastAPI on port 8000. Update `NEXT_PUBLIC_API_URL` and `CORS_ORIGINS` for a public deployment, and terminate TLS at the hosting layer. The sample Compose file is for local evaluation, not production secret or ingress management.

## Public deployment and search indexing

See [PUBLICATION_AND_DEPLOYMENT.md](PUBLICATION_AND_DEPLOYMENT.md) for the prepared Render API configuration, Vercel frontend setup, production environment variables, custom-domain steps, and search indexing instructions. A live deployment still needs an authorized Git repository and hosting accounts.

## Scientific scope and limits

- SIA2 returns archive image products; product wavelength bounds are not a per-source spectrum. SPHEREx uses a linear variable filter, so wavelength varies with position within an image.
- The preview is a percentile-clipped false-colour PNG with selectable linear, log, square-root, or asinh stretch, contrast, and FITS image plane. It is for visual inspection, not quantitative measurement. FITS dimensions, units, invalid-pixel counts, available extensions, display cuts, background median/MAD and celestial WCS are returned as metadata; WCS conversion and the optional grid use Astropy. Spectral-image MEFs use IRSA regional cutouts. DR1 All-Sky Cube tiles are large and do not use that cutout service; ASCENTRA reads only selected byte ranges for its 102-channel profile and does not send a full cube to the browser.
- The slider and side-by-side views compare product previews only. Metadata compatibility does not prove a variable source. ASCENTRA currently does not calculate image registration, background corrections, uncertainty propagation, PSF matching, or a difference map.
- The motion module uses Photutils DAOStarFinder and one-to-one epoch matching after a robust translation estimated from mutual WCS source matches. It does not run IRSA's full Source Discovery package, fit moving-object orbits, use an external astrometric catalogue, perform PSF-model photometry, or confirm source identities. Tracks are candidates only; incompatible data, insufficient registration, and short baselines remain unavailable.
- For each detected source, motion analysis samples SPHEREx's approximate alternate WCS-WAVE central wavelength and bandwidth through Astropy. The apparent-motion fit is withheld if a track's local passbands are unavailable or overlap by less than 95%, even when broad SIA product wavelength ranges match. IRSA documents WCS-WAVE as visualization-level; science-grade spectral work needs the CWAVE/CBAND calibration product, which ASCENTRA does not yet retrieve.
- Motion fluxes are uncorrected aperture sums from a local background-subtracted image. They are displayed as exploratory measurements and are not evidence of calibrated brightness variability. The viewer has no variance-propagated difference image or PSF-matched subtraction.
- The spectral page reads the actual DR1 All-Sky Cube SPECTRAL_CHANNELS table and one nearest-pixel IMAGE value per channel, returning NHITS, FLAGS and blank channels 51–52. The values are surface brightness in MJy/sr, not source-integrated flux or calibrated source spectra; this cube has no per-pixel variance, and ASCENTRA does not subtract background or fit the PSF. Use IRSA Spectrophotometry for science-quality source photometry.
- Catalogue candidates are positional cross-matches from IRSA Gator. Angular separation orders returned records; survey brightnesses, astrometry, epoch differences, proper motion, blending and SPHEREx resolution are not combined into an identification score. Review the source records before assigning an identity.
- API result and PNG caches are in-process and will clear on restart. For multi-worker or public deployment, connect a shared Redis cache, persist provenance in PostGIS if needed, and configure a reverse proxy and rate limits.
- TNO responses are also cached in-process for up to one hour. Public retrieval depends on JPL and arXiv availability; unavailable optional TESS data is reported separately from the core astrometry response.

See [Image Rendering Validation](IMAGE_RENDERING_VALIDATION.md) for the live IRSA preview check, renderer coverage, and remaining scientific limitations.

## Data acknowledgement

If you publish work that uses SPHEREx data, use IRSA's requested acknowledgement and the DOI for the data release used. DR1 spectral images use DOI `10.26131/IRSA678`; QR3 uses DOI `10.26131/IRSA662`. QR2 is no longer returned in IRSA or VO searches after the November 2026 DR1 release; use DR1 for a reprocessed QR2 image set.

> This publication makes use of data products from the Spectro-Photometer for the History of the Universe, Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet Propulsion Laboratory and the California Institute of Technology, and is funded by the National Aeronautics and Space Administration.
