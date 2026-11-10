# SEO Static Library

Build-time prerendered HTML pages that exist alongside (not part of) the SPA.
Crawlers see real content; visitors land on a static page that funnels them
to the iOS app or the live webapp via a JS-detected CTA.

## How it works

```
src/data/generated/*.ts  ──┐
src/lib/translations/*.json ┤
src/seo/<Template>.tsx     ─┼─► scripts/seo/prerender.ts ─► dist/<path>/index.html
src/seo/shell.ts           ─┤                              ► dist/sitemap.xml
src/seo/jsonld.ts          ─┘                              ► dist/robots.txt (Sitemap line)
```

Runs at the end of `npm run build`. **Not** run by `npm run build-native` —
Capacitor iOS/Android bundles ship without any of this.

## Page inventory

- `STATION_ORDER` × 2 langs at `/stations/<slug>/`
- `ROUTE_PAIRS` × 2 langs at `/routes/<from>-to-<to>/`
- 1 ferry connection × 2 langs at `/ferry-connection/`

Route pairs come from `src/seo/routes.ts`. `TOP_ROUTE_PAIRS` holds the
hand-picked trips the homepage footer links to, including San Francisco ferry +
train trips for each station in `SF_ROUTE_STATIONS`. `ROUTE_PAIRS` adds the
reverse of each top pair and every station-to-neighbor pair, because the
station pages link to those.

The prerender fails the build if a page links to a `/stations/`, `/routes/`
or `/ferry-connection/` page that wasn't built. Such a link would fall through
to the SPA homepage with a 200 status, which search engines index as a soft 404.

## Adding pages

- **New station** → automatic. New entries in `STATION_ORDER` (regenerated daily
  from GTFS) flow through with no code changes.
- **New route pair** → add to `TOP_ROUTE_PAIRS` in `src/seo/routes.ts`.
- **New page type** → write a pure component in `src/seo/<NewPage>.tsx`, add a
  builder function in `scripts/seo/prerender.ts`, append a `SitemapEntry`.

## Constraints for templates

- **Pure components only.** No hooks, no Router, no QueryClient, no Context.
- **`import React from "react"` + `void React;`** at the top of every `.tsx`.
  `tsx` (the prerender runtime) uses classic JSX and needs React in scope;
  `tsc` with `react-jsx` doesn't need the import and would otherwise flag
  it as unused. The `void React;` line satisfies both.
- All data flows in via props from the prerender script.
- Visual identity uses local mirrors of the SPA's Card / SectionCard /
  PillBadge (in `src/seo/ui.tsx`). The class strings are copies-of-truth
  from the real components — update both if the design shifts.
- Tailwind picks up class names from `.ts` and `.tsx` files in `src/`, so
  classes in template-literal strings (e.g. inside `cta.ts`) are emitted
  to the compiled CSS bundle.

## Updating production constants

`src/seo/constants.ts`:

- `SITE_URL` — production domain (currently `https://smarttraintrip.com`)
- `APP_STORE_URL` — iOS listing
- `LANGUAGES` — add a new lang here + a matching `LANG_PATH_PREFIX` entry +
  a translation JSON under `src/lib/translations/`

There's no Android Play Store URL by design — the CTA only targets iOS;
Android falls through to the desktop webapp CTA. When the Android app ships,
add `PLAY_STORE_URL` + a third `data-cta="android"` block in `src/seo/cta.ts`
+ extend the UA regex in `ctaScript()`.

## Auto-update cadence

`update-transit.yml` runs daily, regenerates GTFS-derived data, commits,
pushes. Cloudflare Workers Builds auto-deploys → `npm run build` runs → all
pages regenerate from fresh data. No additional cron needed.

## Verification

```bash
npm run build                                       # landing pages + sitemap
curl https://smarttraintrip.com/stations/larkspur/  # full HTML, no JS needed
xmllint --noout dist/sitemap.xml                    # valid XML
```

Rich Results Test (Google): paste any station URL, confirm BreadcrumbList +
TrainStation + FAQPage parse without errors.
