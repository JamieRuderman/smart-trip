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
- a local API target is running at `http://localhost:3000`

Default local URL:

- `http://localhost:3210`

## Environment Variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `TRANSIT_511_API_KEY` | `.env.local` or Vercel env | 511.org API key for static and realtime feeds |
| `USE_SAMPLE_DATA` | `.env.local` | Serve fixtures from `sample/` instead of the live API |
| `VITE_API_BASE_URL` | `.env.native` | Absolute API base URL for native builds |

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

Realtime data flows through Vercel serverless routes:

```text
511.org GTFS-Realtime
  -> /api/gtfsrt/alerts
  -> /api/gtfsrt/tripupdates
  -> React Query hooks
  -> trip cards, trip detail sheets, and service alerts UI
```

Trip updates are matched against static schedule entries by scheduled origin departure time because SMART trip IDs are regenerated per service date.

## Mobile Development

Native builds use Capacitor and read `VITE_API_BASE_URL` from `.env.native` so app requests go to a deployed API base instead of relative web paths.

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
