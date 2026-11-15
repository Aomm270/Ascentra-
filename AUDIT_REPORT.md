# ASCENTRA Codebase Audit & Stabilization Report

**Audit date:** 2026-11-13  
**Scope:** Existing ASCENTRA workspace (`D:\Ascentra final code`); stabilization only, no rebuild.

## Follow-up implementation update — 2026-11-14

This file records the Phase 1 audit snapshot from 2026-11-13. Since then, the application has added `backend/motion.py` for FITS source detection and multi-epoch track measurements, `backend/tno.py` for the ED138 orbital and ephemeris module, and the Phase 5–7 spectral and catalogue integrations in `backend/spectral.py` and `backend/catalog.py`. The current routes also include `/motion` and `/tno-lab`. Current feature limits and validation results are documented in [Motion Analytics Validation](MOTION_ANALYTICS_VALIDATION.md), [TNO Intelligence Validation](TNO_INTELLIGENCE_VALIDATION.md), and [Spectral Intelligence Validation](SPECTRAL_INTELLIGENCE_VALIDATION.md).

## Executive summary

ASCENTRA is a functioning Next.js and FastAPI application for searching current SPHEREx image products in NASA/IPAC IRSA, opening small FITS cutouts as display previews, and inspecting product metadata. The existing dark observatory design and page structure were preserved.

The most consequential defect was that the application defaulted to QR2 SIA collections. IRSA's November 2026 release guidance says QR2 is no longer returned by SIA/VO searches; DR1 reprocesses QR2 images and is the current searchable release to use with QR3. The UI and API now use DR1/DR1 Deep and QR3/QR3 Deep. The preview and cache paths, result-limit reporting, input handling, frontend lint workflow, and dependency security were also stabilized.

**Health: Good for archive search and visual inspection; not a WCS-aware scientific viewer or validated change-detection system.** No quantitative difference map, source photometry, motion candidate, or measured spectrum is currently produced. These are clearly reported as limitations in the UI.

## Existing architecture

- **Frontend:** Next.js 15 App Router, React 19, TypeScript, a shared navigation/footer, and one custom responsive CSS design system. Routes are `/`, `/compare`, `/discoveries`, `/investigate`, `/spectral`, `/about`, and `/sources`.
- **Frontend/backend connection:** Browser components call the FastAPI service at `NEXT_PUBLIC_API_URL`; CORS is configured through `CORS_ORIGINS`.
- **Backend:** FastAPI in `backend/main.py`, with `/api/health`, `/api/observations`, `/api/preview/{product_id}`, `/api/comparison-readiness`, and `/api/resolve`.
- **Archive integration:** SIA2 queries at `https://irsa.ipac.caltech.edu/SIA`, current DR1/QR3 collections, SIA `access_url` products, and the IRSA cutout service. Object names use the IDIA Sesame mirror.
- **Image display:** Astropy reads FITS planes; NumPy performs finite-pixel and percentile/asinh display scaling; Pillow emits a thumbnail PNG. The original FITS URL remains available.
- **Persistence:** An optional PostGIS schema exists in `backend/schema.sql`, but the running service does not connect to a database. Query and preview caches and preview URL lookup are process-local.
- **Deployment/configuration:** Dockerfiles and a local Compose file exist. `.env.example` covers API URL, CORS, timeouts, record limits, preview limits, and request rate.
- **Workspace note:** The directory is not a Git repository, so no commit history or clean working-tree baseline was available for this audit.

## Findings and fixes

### Critical findings — fixed

1. **The default QR2 archive query had gone stale.** Live IRSA SIA returned zero QR2 rows for the previously used field; the same region returned DR1 and QR3 products. Updated selectors, API release mapping, health metadata, documentation, acknowledgement, and live smoke coverage to use DR1 and QR3. The API now explains when a caller requests retired QR2 SIA collections.

### Moderate findings — fixed

1. **SIA overflow was silently treated as a complete result set.** The VOTable parser now preserves `QUERY_STATUS`; overflow responses carry `truncated: true` and a visible instruction to narrow the search.
2. **FITS preview selection could fail on valid multi-extension or compressed products.** The renderer now prefers `SCI`/`SCIENCE`/`IMAGE`, supports compressed image HDUs, ignores non-finite pixels for display scaling, checks the pixel budget before decoding, and retains aspect ratio in the generated preview.
3. **A failed cutout at the requested coordinate could fall back to a different image center.** Explicit coordinates are now strict; partial RA/Dec pairs are rejected. This keeps failed comparisons from silently showing another sky position.
4. **Preview redirects were followed before the destination was checked.** Each redirect is now validated against the HTTPS IRSA host and SPHEREx data path before following it. Product URLs reject nonstandard ports and embedded credentials.
5. **The in-memory cache was bounded only by entry count.** It now uses LRU eviction with both a 256-entry cap and a 128 MiB byte cap.
6. **Blank or partial coordinate fields could be interpreted as zero in frontend searches.** Explore and Object Investigator now require both coordinates or a valid object name/coordinate pair.
7. **Preview errors in Object Investigator and Spectral Explorer lacked a recovery state.** These pages now show an explicit unavailable message and link back to the original FITS product.
8. **The navigation indicator described local API health as live IRSA connectivity.** It now reports API status and explains that archive reachability is checked during an archive query.
9. **The configured lint command opened an interactive setup prompt.** Added an ESLint configuration and working `lint`, `typecheck`, and route smoke-test scripts.
10. **Dependency review found vulnerable installed versions.** Updated PostCSS resolution, FastAPI, Starlette, and Pillow; removed unused `python-multipart`. Current frontend and backend dependency audits report no known vulnerabilities.

### Minor findings — fixed

- Comparison labels and object metadata displayed only the calendar date, although products can have distinct same-day timestamps. Comparison stamps and observation start now show UTC timestamps.
- Removed unused imports and an unused navigation helper; lint now completes without warnings.
- The mobile navigation button now exposes `aria-expanded` and controls its navigation element.
- Added visible image-load fallback links for preview failures.

## Test and verification results

| Check | Result |
|---|---|
| `pnpm lint` | Passed; no warnings |
| `pnpm typecheck` | Passed |
| `pnpm build` | Passed; all seven application routes prerendered |
| `pnpm test:smoke` | Passed; all seven frontend routes returned HTTP 200 with shared navigation and IRSA attribution |
| Python compile check | Passed |
| `python -m unittest backend.test_main -v` | Passed: 15 regression tests |
| Frontend dependency audit | No known vulnerabilities |
| Python dependency audit | No known vulnerabilities |
| Local API docs/OpenAPI | `/docs` and `/openapi.json` returned HTTP 200 |
| Responsive manual check | At 390 px wide, the dashboard reflowed and the menu opened; navigation to Discoveries and Compare worked |
| Live IRSA integration | An earlier live run passed DR1 SIA retrieval, FITS cutout preview, M31 name resolution, and the conservative comparison gate. The final repeat attempt returned a controlled HTTP 504 because the IRSA SIA request timed out; a direct 60-second retry also timed out. Local API health/docs remained available. QR3 is included in the repeatable smoke script. |

The regression suite covers live API response shapes with mocked SIA VOTable rows, input bounds, retired QR2 behavior, overflow disclosure, FITS science-extension and compressed-HDU rendering, non-finite pixel handling, preview pixel limits, cache byte bounds, cutout coordinate strictness, redirect allowlisting, and the no-difference-map comparison gate.

Run the live external check with the API running:

```powershell
.venv\Scripts\python.exe -m backend.smoke_check
```

## Remaining limitations and scientific accuracy

1. **No pixel-to-sky WCS interaction.** The viewer renders a PNG and reports archive image-center coordinates; it does not transform cursor positions, pan offsets, or clicked sources to ICRS coordinates. Do not interpret the viewer as a WCS coordinate measurement tool.
2. **No scientific image registration or change map.** The app does not reproject images, match PSFs, estimate backgrounds, combine variance/quality planes, or propagate uncertainties. A visually compatible pair is metadata-compatible only. Difference maps remain unavailable by design.
3. **No source detection, source photometry, motion fit, or discovery ranking.** Discovery cards remain empty; products do not become confirmed moving or variable objects. IRSA's source discovery, MOST, and spectrophotometry tools are linked as the supported external workflows.
4. **No measured 102-plane spectrum in the app.** The channel slider is a nominal channel index. Exact wavelengths and flux measurements require calibrated IRSA mosaic/spectrophotometry products and are not inferred from an image's wavelength bounds.
5. **No database or shared cache is wired in.** A process restart clears result and preview caches, and multiple workers do not share preview IDs. This is acceptable for local evaluation but needs Redis or another shared cache for a multi-worker deployment.
6. **Preview resource use is bounded but still nontrivial.** FITS input is byte-limited, planes are pixel-limited, and output thumbnails are small; processing large valid cutouts can still use significant memory per concurrent request.
7. **Rate limiting is per process and client address.** A public deployment should enforce rate limits at a reverse proxy/API gateway and configure trusted proxy handling.
8. **Automated browser interaction tests are not installed.** Frontend verification consists of production build/typecheck, a route rendering smoke check, and a manual 390 px mobile navigation check; search and data-path integration are also covered by live API smoke tests.

## Prioritized remaining work

1. **P1 — Add a WCS-aware image viewer** with WCS preserved alongside rendered pixels and tested cursor/coordinate transformations.
2. **P1 — Build a scientifically validated comparison pipeline** using matched coverage, registration/reprojection, quality and variance planes, background treatment, and PSF matching before offering quantitative residuals.
3. **P1 — Add source-level photometry and candidate validation** or continue linking to the official IRSA workflows; keep candidate labels provisional until independently checked.
4. **P2 — Add shared caching and job execution** for concurrent production workers; retain IRSA provenance and cache invalidation metadata.
5. **P2 — Add browser automation tests** for search and error states at desktop/mobile viewports, using mocked archive responses for deterministic UI checks.
6. **P3 — Split the single FastAPI module into routing, archive, cache, and rendering modules** once the stabilized behavior is covered by tests.

## References

- [IRSA SPHEREx DR1 overview](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_dr1.html) — current DR1 contents and citation; notes DR1 reprocesses QR2 data and is used with QR3.
- [IRSA SPHEREx Quick Release overview](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_qr.html) — QR2 retirement and QR3 context.
- [IRSA SPHEREx mission/archive page](https://irsa.ipac.caltech.edu/Missions/spherex.html) — available archive releases, tools, and acknowledgement.
- [IRSA SPHEREx cutout documentation](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/cutout_tool.html) — regional cutout behavior.

