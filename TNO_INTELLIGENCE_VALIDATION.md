# ASCENTRA TNO Intelligence Lab — Validation Report

**Benchmark:** 2026 ED138  
**Checked:** 2026-11-13 (UTC)  
**Status:** Public-data investigation module integrated; image-based moving-object and companion pipelines remain unavailable.

## Scope and data provenance

The module is integrated at `/tno-lab` and uses the existing Next.js/FastAPI application structure. It does not replace existing pages or the SPHEREx archive workflow.

| Data | Source | Classification in ASCENTRA |
|---|---|---|
| Orbital elements, formal element uncertainties, covariance, fit metadata, absolute magnitude | [NASA/JPL Small-Body Database API](https://ssd-api.jpl.nasa.gov/doc/sbdb.html) | Published catalogue measurement |
| Observer-specific apparent positions | [JPL Horizons API](https://ssd.jpl.nasa.gov/doc/horizons.html) | Ephemeris prediction |
| Rubin and DECam positions, per-coordinate uncertainties, optical magnitudes | [Published ED138 analysis, Table 11](https://arxiv.org/abs/2610.38693) | Published catalogue measurement |
| TESS sector magnitudes, uncertainties, detection significances | [Published TESS precovery analysis](https://arxiv.org/abs/2610.40106) | Published catalogue measurement |
| SPHEREx regional image coverage | Existing IRSA SIA2 backend, queried at a selected published position and epoch | Archive metadata; not moving-target photometry |

Each retrieved orbit, observation, and TESS sector record includes its source and retrieval time. JPL Horizons results include the service source and query retrieval time. The service cache is process-local and retains responses for up to one hour; no database persistence is configured.

## Live benchmark checks

Live public requests succeeded during this validation:

- JPL SBDB returned designation **2026 ED138**, SPKID **54667839**, orbit solution **2** dated **2026-10-29 11:09:54 UTC**, with orbit epoch **2026-Jun-09.0**.
- The returned osculating elements included *a* = **42.948695 AU** (1σ 0.000529 AU), *e* = **0.1417448** (1σ 0.00000235), *q* = **36.860940 AU**, *i* = **24.47104°** (1σ 0.0000255°), and *P* = **102,807.166 days** (1σ 1.899 days). Values and uncertainties are retained from the API; displayed rounding is for readability.
- The literature table parser returned **74** published astrometric rows dated **2016-02-25 through 2026-07-11**. Origin codes are mapped to DECam/CTIO (`W84`) or Rubin (`X05`) before the Horizons request.
- JPL Horizons returned a position for all **74/74** rows at the appropriate observer site and published UTC midpoint. Great-circle residuals were: median **0.024257 arcsec**, RMS **0.035445 arcsec**, maximum **0.107967 arcsec**.
- These residuals are a **consistency check, not independent validation**: the current JPL solution may include overlapping observations, and ASCENTRA does not refit or hold out the literature measurements.
- Adjacent published detections produced **39** apparent-rate samples with 0.5–60 minute separation. The median was **0.040506 arcsec/min**; the sample nearest the provided **0.043 arcsec/min** benchmark was **0.042949 arcsec/min**. The benchmark is displayed as a reference, not as a fixed property of ED138.
- The TESS paper parser returned sectors **12, 39, 66, 93, and 104**, preserving each published magnitude, 1σ uncertainty, detection significance, source, and retrieval timestamp. Sector identifiers are shown instead of invented exposure dates.
- A live IRSA DR1 SIA2 query at the final published position (2026-07-11 07:21:14.5 UTC; radius 0.05°) returned HTTP 200 and zero matching image products for that single date. This is not an exhaustive search of all ED138 epochs, releases, or moving-target products.
- A JPL Horizons ephemeris request for 2026-11-13 through 2026-11-16 returned four daily predictions. On 2026-11-13 it reported RA **273.105595°**, Dec **−42.143622°**, geocentric distance **47.9171 AU**, and apparent angular rate **2.86968 arcsec/hour**.

## What the interface supports

- Live JPL orbit and covariance retrieval, with a draggable projected orbit scene and clearly labeled two-body model.
- Live Horizons ephemeris queries over selectable date windows, with apparent-coordinate path, range, and rate table.
- Published-position ledger, source links, measurement uncertainty fields, great-circle displacement and residual plots.
- Short-baseline apparent angular-rate calculations, with the supplied rate shown only as a benchmark.
- Rubin/DECam optical magnitude measurements with filter labels and 1σ bars, plus separately plotted TESS sector photometry with its published uncertainty and signal-to-noise values.
- Fixed-coordinate/date SPHEREx/IRSA SIA2 coverage checks and original FITS links when products are returned. A coverage match does not mean ED138 was measured in that product.
- Companion-search status that remains **Not assessed**, without synthetic candidates or satellite claims.

## Limitations and scientific cautions

1. **No image-based moving-object pipeline.** The published coordinates are analyzed, but ASCENTRA does not download or register Rubin/DECam pixels, run background-star astrometry, detect sources, or construct difference images. Rubin's [ED138 image release](https://prompt-products.lsst.io/products/2026-ED138/index.html) is restricted to Rubin data-rights holders; public DECam precovery access has not been located or integrated in this module.
2. **No satellite assessment.** Without accessible calibrated multi-epoch pixels, PSF/crowding analysis, and repeated relative astrometry, a nearby-source search cannot be performed. The module therefore reports “Not assessed.”
3. **No ED138 infrared spectrum or forced photometry.** IRSA coverage results are image-product metadata at a fixed coordinate and epoch. The 102-channel instrument capability does not establish that usable fluxes exist for ED138. No composition or thermal size is inferred.
4. **Optical magnitude series are heterogeneous.** Rubin/DECam filters are distinguished; TESS is plotted separately in its broad T band and by sector. The plots are not a unified calibrated light curve. The papers do not provide precise weighted TESS mid-times through the parsed summary, so none are fabricated.
5. **Orbit scene is not a numerical integration.** The scene propagates JPL osculating elements with a two-body Kepler model. It is not REBOUND/SPICE integration and omits planetary perturbations. Neptune/Pluto reference paths are schematic semimajor-axis circles, not current ephemerides. Use the Horizons view for observer-specific sky predictions.
6. **Uncertainties are not a propagated sky confidence region.** JPL element uncertainties/covariance and table coordinate uncertainties are exposed, but ASCENTRA does not propagate the covariance into a sky-plane confidence ellipse or derive formal angular-rate uncertainties.
7. **Diameter is assumption-dependent.** The published **612–1530 km** estimate depends on assumed albedo; it is not a direct measurement. The SPHEREx pixel scale is too coarse for close-companion inference at ED138's distance, and pixel scale is not the instrument PSF resolution.
8. **No permanent provenance store.** Provenance accompanies API results, while response caching and retrieval history remain in process memory. A durable research deployment would need a database/migration and reproducible query snapshots.

## Automated checks

The application regression suite covers SIA2 parsing and errors, FITS preview behavior and limits, archive redirect validation, cache bounds, comparison-readiness gates, ED138 table parsing, TESS parsing/provenance, spherical separation, Horizons CSV parsing, and API response structure. The frontend smoke check covers all public routes, shared navigation, and the footer attribution.

**Run results:** 22 Python tests passed; frontend lint and TypeScript checks passed; production build completed; all 8 public routes passed the production HTTP smoke check; Python backend compilation passed. The smoke test validates server-rendered content and routes, not browser interaction or mobile screenshots. A visual browser/device pass could not be run because local browser access was unavailable in this session.

Run from the project root:

```powershell
pnpm lint
pnpm typecheck
pnpm build
pnpm test:smoke
.venv\Scripts\python.exe -m unittest backend.test_main -v
```

The smoke check expects a production frontend at `http://127.0.0.1:3000` by default; override with `ASCENTRA_WEB_URL` if needed.

## Recommended next work

1. Obtain authorized calibrated Rubin/DECam pixels and implement astrometric registration, PSF-aware detection, photometry, and uncertainty propagation.
2. Build a Horizons/SBDB residual report that explicitly separates fit observations from independent validation epochs.
3. Query IRSA MOST and relevant SPHEREx products along the moving ephemeris; only proceed to flux extraction if suitable calibrated products are actually available.
4. Propagate JPL covariance to predicted sky-plane uncertainties and add formal rate uncertainties from per-epoch astrometry.
5. Persist data provenance and cached retrieval metadata in the deployment database; add shared caching and operational rate limits for multi-worker hosting.
