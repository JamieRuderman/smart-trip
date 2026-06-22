# smart-trip-web — parallel Cloudflare deployment

Runs the SMART trip web app on **Cloudflare Workers (Static Assets)** _alongside_
the existing Vercel deploy, so we can validate Cloudflare hosting before
migrating any backend code. It does **not** touch production (Vercel +
`smarttraintrip.com` are untouched).

Live (parallel): <https://smart-trip-web.smart-trip.workers.dev>

## What it does

- **Static SPA** — serves the built Vite app (repo-root `dist/`) via the `ASSETS`
  binding. Client-routed paths fall back to `index.html`
  (`not_found_handling = "single-page-application"`), mirroring the Vercel
  rewrite in `vercel.json`.
- **`/api/*` → Vercel** — `src/index.ts` proxies API calls to the live Vercel
  backend (`API_ORIGIN`), so the app is fully functional with **no backend
  rewrite**. `run_worker_first = ["/api/*"]` ensures the proxy runs before the
  SPA fallback. **This proxy is the migration seam:** as each route is
  reimplemented natively on Workers (starting with the Live Activity push /
  Durable Object timers), drop it from the proxy; remove `API_ORIGIN` once the
  backend is fully migrated.

## Deploy

The wrangler config lives at the **repo root** (`/wrangler.toml`) so Cloudflare
Workers Builds (CI) finds it by default. Deploy from the repo root:

```sh
npm run build        # builds ./dist (relative API base → same-Worker calls)
npx wrangler deploy  # bundles workers/web/src + uploads ./dist
```

**Cloudflare Workers Builds (CI / per-PR previews):**
- Build command: `npm run build` (falls back to `npx vite build` if the SEO
  prerender step needs a browser the CI lacks)
- Deploy command: `npx wrangler deploy` (production) / `npx wrangler versions
  upload` (preview branches)
- Root directory: repo root (default)

## Build env (for parity with Vercel)

The SPA reads `VITE_*` at **build time**. For a faithful parallel build set at
least:

- `VITE_MAPBOX_TOKEN` — without it the Map route renders without a map.

The web build uses a **relative** API base, so `/api/*` is handled by this
Worker's proxy (no `VITE_API_BASE_URL` needed here).

## Status

| Layer | Where it runs |
| --- | --- |
| Frontend (SPA) | ✅ native on Cloudflare |
| `/api/*` backend | ⏳ still proxied to Vercel (not yet migrated) |
