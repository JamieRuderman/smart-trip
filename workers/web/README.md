# smart-trip-web — Cloudflare Worker (production)

Runs the SMART trip web app on **Cloudflare Workers (Static Assets)**. As of the
2026-06-22 apex cutover this is **production**: `smarttraintrip.com` is served by
this Worker — the SPA, the GTFS-Realtime API, and the Live Activity push backend
(Durable Objects) all run here.

Also reachable at <https://smart-trip-web.smart-trip.workers.dev>.

## What it does

- **Static SPA** — serves the built Vite app (repo-root `dist/`) via the `ASSETS`
  binding. Client-routed paths fall back to `index.html`
  (`not_found_handling = "single-page-application"`).
- **GTFS-Realtime API (native)** — `/api/gtfsrt/{tripupdates,vehiclepositions,alerts}`
  are served directly by the Worker (511 fetch + protobuf decode + normalize,
  cached in Cloudflare KV). See `src/lib/gtfsrt.ts`.
- **Live Activity push (native)** — `/api/liveactivity/{register,token,deregister}`
  drive a per-activity Durable Object (`src/do/tripActivity.ts`) that fires
  exact-time APNs pushes via the Alarms API.
- **Fallback proxy → Vercel** — `run_worker_first = ["/api/*"]` runs the Worker
  before the SPA fallback; any `/api/*` not handled natively proxies to
  `API_ORIGIN` (the legacy Vercel deployment). This is the last remaining Vercel
  seam and goes away when the cutover bakes — see #91.

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

## Build env

The SPA reads `VITE_*` at **build time**. Set at least:

- `VITE_MAPBOX_TOKEN` — without it the Map route renders without a map.

The web build uses a **relative** API base, so `/api/*` is handled by this
Worker (no `VITE_API_BASE_URL` needed here).

## Status

| Layer | Where it runs |
| --- | --- |
| Frontend (SPA) | ✅ native on Cloudflare |
| GTFS-Realtime API | ✅ native on Cloudflare (KV-cached) |
| Live Activity push | ✅ native on Cloudflare (Durable Object + APNs) |
| Fallback `/api/*` proxy | ⏳ → Vercel until the cutover bakes (#91) |
