# SMART trip

SMART trip is a community-built schedule app for Sonoma-Marin Area Rail Transit (SMART). It runs on the web and ships as Capacitor-based iOS and Android apps.

This project is not affiliated with Sonoma-Marin Area Rail Transit.

## Features

- Static SMART train schedules with weekday and weekend service views
- Live trip updates from SMART GTFS-Realtime data, including delays, cancellations, and skipped stops when available
- Live SMART service alerts with unread state stored locally on-device
- Ferry connections for Larkspur trips
- Closest-station selection using device location
- Trip detail sheets with GPS-assisted distance-to-stop messaging and better in-motion progress inference
- English and Spanish UI
- Light, dark, and system theme support
- Fare lookup for supported rider categories
- Shared web, iOS, and Android codebase

## Stack

- React 18 + TypeScript
- Vite
- Tailwind CSS + Radix UI primitives
- TanStack Query
- React Router
- Capacitor for iOS and Android
- Vercel serverless functions for GTFS-Realtime proxying

## Quick Start

### Prerequisites

- Node.js 18+
- npm
- A 511.org API key for live GTFS data

### Install

```bash
git clone <repository-url>
cd smart-trip
npm install
```

Create `.env.local` with:

```bash
TRANSIT_511_API_KEY=your_key_here
```

### Run locally

For the full app, including local serverless API routes:

```bash
npm run dev-vercel
```

For frontend-only development:

```bash
npm run dev
```

If you use `npm run dev`, real-time endpoints only work when either:

- `USE_SAMPLE_DATA=true` is set in `.env.local`, or
- a local API target is running at `http://localhost:3000`, or
- `DEV_API_PROXY_TARGET` in `.env.local` points `/api` at another backend such as a feature-branch deployment

Default local URL:

- `http://localhost:3210`

## Environment Variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `TRANSIT_511_API_KEY` | `.env.local` or Vercel env | 511.org API key for static and realtime feeds |
| `USE_SAMPLE_DATA` | `.env.local` | Serve fixtures from `sample/` instead of the live API |
| `DEV_API_PROXY_TARGET` | `.env.local` | Dev-only `/api` proxy target for `npm run dev`; defaults to `http://localhost:3000` |
| `VITE_API_BASE_URL` | `.env.native` or `.env.native.local` | Absolute API base URL for native builds |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Vercel env (auto-injected) | Upstash Redis credentials for the shared GTFS-RT cache. Created by the Vercel ↔ Upstash integration; if absent, the cache falls back to direct 511 fetches |

For production on Vercel, keep `TRANSIT_511_API_KEY` server-side only.

## Scripts

- `npm run dev` - Start the Vite dev server
- `npm run dev-vercel` - Start Vercel dev on port 3210
- `npm run build` - Type-check and build the web app
- `npm run build-native` - Type-check and build the native web bundle
- `npm run preview` - Preview the production build
- `npm run lint` - Run ESLint
- `npm run typecheck` - Run TypeScript in build mode without emitting files
- `npm run test:unit` - Run unit tests with Vitest
- `npm run update-transit` - Refresh GTFS schedule source data from 511.org
- `npm run update-build` - Refresh transit data, then build
- `npm run sync` - Build native bundle and sync Capacitor projects
- `npm run sync-live` - Sync Capacitor projects for live reload development
- `npm run assets` - Generate app icons and splash screens
- `npm run open-ios` - Open the iOS project in Xcode
- `npm run open-android` - Open the Android project in Android Studio

## Data Flow

Static schedule data is generated into `src/data/generated/` and published to `public/data/schedules.json` during `prebuild`.

Realtime data flows through Vercel serverless routes, fronted by a shared
Redis cache so 511 is polled once per window globally (see below):

```text
511.org GTFS-Realtime
  -> Upstash Redis cache (poll-on-read + lock, api/_feedCache.ts)
  -> /api/gtfsrt/{alerts,tripupdates,vehiclepositions}
  -> React Query hooks
  -> trip cards, trip detail sheets, map, and service alerts UI
```

Trip updates are matched against static schedule entries by scheduled origin departure time because SMART trip IDs are regenerated per service date.

### Realtime cache (511 rate limit)

511's Open Data API allows ~370 requests/hour for our token, and explicitly
expects a single central backend to fetch once and fan out to all clients —
the upstream rate must not scale with users. `api/_feedCache.ts` implements
that: each feed is fetched from 511 at most once per freshness window
(vehicles 15s, trip updates 40s, alerts 5min ≈ 342 calls/hr total), cached in
Upstash Redis, and served to every region/user from that one snapshot. A short
lock prevents concurrent refreshes, and the last-known-good snapshot is served
if 511 is down.

> **Realtime cache region (TODO: consider moving west).** The Redis primary
> region and the Vercel serverless functions both run in `iad1` (Washington,
> D.C.) — co-located so cache reads/writes stay in-region. Riders and the 511
> upstream are in the SF Bay Area, so relocating **both** the functions
> (`regions: ["sfo1"]`) **and** the Redis primary region to SF would cut
> latency. Move them together — splitting across coasts adds a cross-country
> hop to every cache op. Deferred for now; revisit if realtime latency matters.

## Mobile Development

Native builds use Capacitor and read `VITE_API_BASE_URL` from `.env.native` so app requests go to a deployed API base instead of relative web paths.

Use `.env.native.local` for developer- or branch-specific overrides such as a PR deployment URL. That file is already ignored by Git.

Typical flow:

```bash
npm run sync
npm run open-ios
# or
npm run open-android
```

For live reload on device or simulator:

```bash
npm run dev-vercel
npm run sync-live
```

`sync-live` uses your Mac's Wi-Fi IP address. The device and development machine need to be on the same network.

## Releases

Releases are tagged `vX.Y.Z` and shipped to the App Store and Google Play. The web app deploys continuously from `main` via Vercel and is not gated by this process.

### When to bump which number

| Bump | When |
| --- | --- |
| `major` | Breaking changes to persisted state, removed features, or otherwise-incompatible behavior. |
| `minor` | New user-visible features (e.g. departure reminders, station-sheet redesign). |
| `patch` | Bug fixes, schedule data refreshes, and behind-the-scenes improvements only. |

### Pre-flight

From a clean checkout of `main`:

```bash
git checkout main
git pull --tags
npm install
npm run test:unit
npm run typecheck
npm run prebuild        # should produce zero diff against committed generated files
```

If `prebuild` leaves a diff, land a `chore: refresh transit feeds` commit before tagging.

### Bump the version

`npm version` runs `scripts/version.sh`, which updates the native version metadata in lockstep so the three platforms can't drift:

- `package.json` / `package-lock.json` — semver string
- `android/app/build.gradle` — `versionName` and `versionCode` (incremented by 1)
- `ios/App/App.xcodeproj/project.pbxproj` — `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` (build number, incremented by 1)

```bash
npm version minor       # or `patch` / `major`
git push --follow-tags
```

That creates a commit titled e.g. `1.5.0` and pushes the matching `v1.5.0` tag.

### Build the native bundle

```bash
npm run build-native    # prebuild + tsc --noEmit + vite build --mode native
npm run sync            # npx cap sync — copies the web bundle into ios/ and android/
```

### Ship iOS

```bash
npm run open-ios
```

In Xcode:

1. Select **Any iOS Device (arm64)** as the run destination.
2. **Product → Archive**.
3. When Organizer opens, **Distribute App → App Store Connect → Upload**.
4. In App Store Connect, create a new version, paste the iOS release notes (see below), and submit for review.

### Ship Android

```bash
npm run open-android
```

In Android Studio:

1. **Build → Generate Signed App Bundle / APK → Android App Bundle**.
2. Choose the upload keystore.
3. Upload the resulting `.aab` in **Google Play Console → Production → Create new release**, paste the Android release notes, and roll out.

### Writing release notes

Keep store notes short and user-visible. Skip refactors, build-only changes, web-only SEO work, and platform-specific fixes that don't apply to the store you're publishing to (e.g. don't list an Android-only fix in the App Store notes).

To gather candidates:

```bash
git log v<previous>..HEAD --oneline --no-merges
```

Group `feat(*)` first, then user-visible `fix(*)`. Trim anything users won't notice.

## Privacy Notes

- The app can request location permission for closest-station selection and GPS-assisted trip detail messaging.
- Location stays on-device and is not sent as part of schedule or realtime API requests.
- The app stores a small amount of local state such as theme, language, fare preference, and dismissed/read alert state.
- The web app includes Vercel Analytics; native builds do not mount that analytics client.

## Project Structure

```text
api/                  Vercel serverless realtime proxy routes
public/               Static assets and hosted support/privacy pages
sample/               Local GTFS-Realtime fixtures
scripts/              Feed update and build helper scripts
src/components/       UI components
src/data/             Static and generated schedule data
src/hooks/            App hooks
src/lib/              Utilities and app logic
src/pages/            Route-level pages
src/types/            Shared TypeScript types
ios/                  Capacitor iOS project
android/              Capacitor Android project
```

## Verification

- `npm run test:unit`
- `npm run build`

`npm run lint` currently fails in this repo because of pre-existing issues in generated Android build output and unrelated source files.

## License

The code in this repository is available under the MIT License. See [LICENSE](/Users/jamie/Code/smart-trip/LICENSE).

The `SMART trip` name, logo, and other project branding are not granted under the code license.

Built with ❤️ for the SMART Train community
