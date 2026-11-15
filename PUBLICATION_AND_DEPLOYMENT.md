# ASCENTRA publication and deployment

This guide prepares ASCENTRA for a public launch while keeping the Next.js website and FastAPI science service as separate deployable parts.

## Current publication status

- The application has not been published. This workspace has no Git repository or hosting account connected, and no production domain has been provided.
- The recommended layout is the Next.js website on Vercel and the Python API on Render. Vercel serves frontend content through its global CDN; the scientific API is a regional service in Oregon, so live-query latency will still depend on visitor distance and upstream archive response time.
- Render's `render.yaml` defines the API service, Python version, health check, and runtime configuration. It deliberately does not define a website or database.
- The API blueprint selects Render's `1c-2g` paid compute plan because FITS previews and astronomy processing need more headroom than a sleeping free service. Confirm current account pricing before creating the service. Render says free web services are for testing and should not be used for production.
- No API credentials are needed for the existing public IRSA queries. The Render `CORS_ORIGINS` setting is intentionally supplied during deployment so the API can be limited to the actual website origin.

## Before launch

1. Create or choose a private/public Git provider repository and place this project there. Do not include `.env`, `.env.local`, `.venv`, `node_modules`, `.next`, FITS files, or generated local data. The existing `.gitignore` excludes these.
2. Choose a Vercel project name. Its generated `*.vercel.app` URL can be used for the first public launch; a custom domain can be connected later.
3. Sign in to Vercel and Render using accounts authorized to publish this project. Review the selected Render compute plan and expected charge before creating it.

## Deploy the API on Render

1. In Render, create a **Blueprint** from the repository containing `render.yaml`.
2. When asked for `CORS_ORIGINS`, enter the exact website origin, for example `https://ascentra.vercel.app` (no trailing slash). If the final Vercel URL is not known yet, deploy the API first and update this value in the Render service's environment settings as soon as the website URL is assigned.
3. Create the service and wait for its `/api/health` check to pass. Copy the service's HTTPS address, for example `https://ascentra-api.onrender.com`.
4. If you deployed before knowing the website URL, set `CORS_ORIGINS` to the exact Vercel production origin and redeploy the API.

## Deploy the website on Vercel

1. Import the repository into Vercel as a Next.js project. Use the repository root as the project root; no monorepo subdirectory is needed.
2. Add these **Production** environment variables before deployment:

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_API_URL` | The Render API's HTTPS origin, such as `https://ascentra-api.onrender.com` |
   | `NEXT_PUBLIC_SITE_URL` | The website's canonical HTTPS origin, such as `https://ascentra.vercel.app` |

3. Keep the build command and output settings at their Next.js defaults, then deploy.
4. Test the live home page, `/research`, `/spectral`, `/cosmic-explorer`, `/api/health` on the API host, and the browser's observation search. If you change either public environment variable, redeploy the website so the new build receives it.

`NEXT_PUBLIC_API_URL` is public browser configuration, not a secret. Do not place credentials in variables beginning with `NEXT_PUBLIC_`.

## Custom domain and search indexing

1. In Vercel, add the custom domain and apply the DNS records Vercel provides at the domain registrar. Wait until Vercel reports the domain and HTTPS certificate as ready.
2. Set `NEXT_PUBLIC_SITE_URL` to the preferred canonical HTTPS domain, set `CORS_ORIGINS` on Render to that same origin, and redeploy both services. Use one canonical host (for example, `https://ascentra.example`) and configure any alternate `www` host to redirect to it.
3. Confirm `https://<canonical-domain>/robots.txt`, `/sitemap.xml`, and `/opengraph-image` load. Sitemap and canonical URLs are generated from `NEXT_PUBLIC_SITE_URL`; preview deployments are marked no-index and excluded from the sitemap.
4. Verify domain ownership in Google Search Console and Bing Webmaster Tools, then submit the sitemap URL. Search engines decide when and whether to index pages; submission is not a guarantee of indexing.
5. Inspect indexed URLs and metadata after launch. Keep the production URL stable once external indexing begins. Sitemap submission helps crawlers discover pages but does not guarantee indexing.

## Local publication checks

From the repository root, run:

```powershell
$env:NEXT_PUBLIC_SITE_URL = "http://localhost:3000"
pnpm lint
pnpm typecheck
pnpm build
pnpm test:smoke
.venv\Scripts\python.exe -m compileall backend
.venv\Scripts\python.exe -m unittest backend.test_motion backend.test_main backend.test_science -v
```

Start the production website with `pnpm start` and the API with `python -m uvicorn backend.main:app --port 8000` when exercising the deployed-style local journey. See the project README for the optional live IRSA smoke check; external archive availability can vary.

## Launch steps requiring account access

The source tree and deployment configuration can be prepared locally, but a public launch still requires an authorized Git repository, Vercel and Render account access, confirmation of Render's paid compute cost, and (for a branded domain) domain registrar/DNS access. Search Console and Bing ownership verification also require an account controlled by the site owner. Do not share passwords or private tokens in this repository.

## Official provider references

- [Vercel Next.js deployment](https://vercel.com/docs/frameworks/full-stack/nextjs) and [Vercel global CDN](https://vercel.com/docs/how-vercel-cdn-works)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [Render Blueprint reference](https://render.com/docs/blueprint-spec), [Python version selection](https://render.com/docs/python-version), and [free-service limitations](https://render.com/docs/free)
- [Google Search Console sitemap submission](https://support.google.com/webmasters/answer/7451001) and [Bing sitemap submission](https://www2.bing.com/webmasters/help/sitemaps-3b5cf6ed)
