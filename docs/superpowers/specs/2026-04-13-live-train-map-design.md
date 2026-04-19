# Live Train Map — Design Spec

## Overview

Add an interactive full-screen map showing real-time SMART train locations, directions of travel, and station positions. Users access the map via a preview card below the trip list and can tap trains to see details with a link back to the existing trip detail sheet.

## Entry Point — Map Preview Card

A card rendered below the `ScheduleResults` trip list in `TrainScheduleApp.tsx`. It shows:

- Subtle map-style background (CSS gradient, no actual map tiles)
- Map icon + "Live Train Map" label
- Active train count badge (e.g., "3 active") from `useVehiclePositions` data
- Tapping opens the full-screen map view
- When no vehicles are broadcasting, the badge shows "0 active" but the card remains visible (map still shows stations + route)

**Component**: `MapPreviewCard.tsx`
**Placement**: Below `ScheduleResults`, above any footer content

## Full-Screen Map View

### Map Library

**Mapbox GL JS** (`mapbox-gl` npm package)
- Light mode: `mapbox://styles/mapbox/streets-v12` (or `light-v11`)
- Dark mode: `mapbox://styles/mapbox/dark-v11`
- Style switches automatically based on the app's existing `ThemeProvider` context
- Access token stored in `VITE_MAPBOX_TOKEN` env var (added to `.env.local`, Vercel env vars)

### Layout

Full-screen overlay/page with:
- **Back button** (top-left, floating pill over map) — returns to schedule view
- **Train count pill** (top-right, floating) — shows "N trains" with green dot; tapping it calls `map.fitBounds()` to zoom/pan to fit all active vehicle positions
- Map fills the entire viewport beneath the status bar
- On iOS (Capacitor), respects safe area insets

### Navigation

The map is a new route (`/map`) rendered via React Router. The back button navigates back to `/`. State (selected stations, schedule type) is preserved via the existing `useTrainScheduleState` URL/localStorage sync.

### Map Content

#### Route Line
- Dashed polyline connecting all 14 station coordinates in order (Windsor → Larkspur)
- Color: `#11ab75` (SMART green) at ~45% opacity
- Uses the station coordinates from `STATION_COORDINATES` in `src/data/stations.ts`
- Rendered as a GeoJSON `LineString` layer

#### Station Markers
- Small circle markers at each of the 14 station positions
- Light mode: white fill, green border
- Dark mode: dark fill, green border
- Station name label beside each dot (small, semi-transparent background for readability)
- Not interactive (no tap behavior on stations)

#### Train Markers
- Circular marker with SMART green (`#11ab75`) background and the custom `TripIcon` SVG (white stroke) inside
- Light mode: white border on circle; Dark mode: dark border
- **Direction arrow**: triangular arrow indicator
  - Northbound: arrow rendered **above** the marker circle
  - Southbound: arrow rendered **below** the marker circle
  - Arrow color matches marker (green for on-time, gold `#E48E25` for delayed)
- **Delayed trains**: marker background and arrow change to gold
- **No text labels** on markers — details available via tap
- Positions update every 15 seconds (matching existing `useVehiclePositions` poll interval)
- Markers animate smoothly between position updates using Mapbox's `easeTo` or CSS transitions

#### Train Callout (Popup)
Tapping a train marker opens a Mapbox popup (or custom overlay) showing:
- **Train [number]** (bold) + **status pill** (On Time / +Nm delay)
- Direction: "Southbound ↓" or "Northbound ↑"
- Speed: converted from m/s to mph (from `position.speed`)
- Next stop: derived from `currentStopSequence` + `stopId` mapped via `GTFS_STOP_ID_TO_STATION`
- **"View Trip Details →"** link that navigates back to `/` with the trip selected (opens `TripDetailSheet`)
- Styled to match app theme (white card in light mode, dark card in dark mode)
- Only one callout open at a time; tapping another train or the map closes the current one

#### User Location (Blue Dot)
- Blue dot with white border and subtle blue halo
- Uses the existing `useGeolocation` hook (Capacitor + browser geolocation)
- Always requested when the map opens; if permission denied, simply not shown (no error)
- Updates as the user moves (watch mode from existing hook)

### Empty State (No Active Trains)
- Map shows the route line and all 14 station markers
- Train count pill shows "0 trains"
- No callouts available
- The map is still useful as a reference for station locations

## Data Flow

```
useVehiclePositions (15s poll)
  → vehicles[] with lat/lng, bearing, speed, tripId, stopId, currentStatus
  → filtered to vehicles with valid position data

useTripUpdates (30s poll)
  → delay/cancellation status per trip
  → matched to vehicles by tripId for marker color (on-time vs delayed)

useGeolocation (watch mode)
  → user lat/lng for blue dot

ThemeProvider context
  → dark/light → selects Mapbox style URL
```

### Vehicle-to-Trip Matching
Reuse the existing matching logic from `useVehiclePositions.ts` — vehicles include `trip.tripId` and `trip.startTime` which map to the app's trip numbers. The `useTripUpdates` hook provides delay status. Combine both to determine marker color and callout content.

## New Files

| File | Purpose |
|------|---------|
| `src/pages/Map.tsx` | Map page with route, Mapbox initialization, overlay UI |
| `src/components/MapPreviewCard.tsx` | Entry point card below trip list |
| `src/components/map/TrainMarker.tsx` | Custom marker component (train icon + direction arrow) |
| `src/components/map/TrainCallout.tsx` | Popup content when tapping a train |
| `src/components/map/StationMarker.tsx` | Station dot + label |
| `src/components/map/MapOverlays.tsx` | Back button + train count pill |
| `src/hooks/useMapTrains.ts` | Combines vehicle positions + trip updates for map consumption |
| `src/lib/mapConstants.ts` | Mapbox style URLs, default bounds, zoom levels, route GeoJSON |

## Modified Files

| File | Change |
|------|--------|
| `src/components/TrainScheduleApp.tsx` | Add `MapPreviewCard` below `ScheduleResults` |
| `src/App.tsx` | Add `/map` route |
| `src/lib/env.ts` | Add `mapboxToken` from `VITE_MAPBOX_TOKEN` |

## Existing Code to Reuse

| What | Where |
|------|-------|
| Station coordinates | `src/data/stations.ts` → `STATION_COORDINATES` |
| GTFS stop ID → station mapping | `src/lib/stationUtils.ts` → `GTFS_STOP_ID_TO_STATION` |
| Vehicle position fetching | `src/hooks/useVehiclePositions.ts` |
| Trip delay status | `src/hooks/useTripUpdates.ts` → `useTripRealtimeStatusMap` |
| Geolocation | `src/hooks/useGeolocation.ts` |
| Theme detection | `src/components/ThemeProvider.tsx` → `useTheme()` |
| Trip state colors | `src/lib/tripTheme.ts` |
| TripIcon SVG | `src/components/icons/TripIcon.tsx` |
| Direction logic | `src/hooks/useStationDirection.ts` (directionId: 0=south, 1=north) |

## Dependencies

| Package | Purpose |
|---------|---------|
| `mapbox-gl` | Map rendering |
| `@types/mapbox-gl` | TypeScript types |

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `VITE_MAPBOX_TOKEN` | Mapbox GL JS access token (public, safe for client) |

## Verification Plan

1. **Unit**: `useMapTrains` hook returns correct marker data (position, direction, delay status) from mock vehicle/trip data
2. **Visual**: Open map in dev, verify light/dark mode style switching, station placement matches real SMART corridor
3. **Interactive**: Tap train markers, verify callout shows correct trip info; tap "View Trip Details" navigates to trip detail
4. **Live data**: With real 511.org feed, confirm trains appear at plausible positions and update every 15s
5. **Empty state**: Test outside service hours — map shows route + stations, "0 trains" pill
6. **Train count pill**: Tap to verify map zooms to fit all active trains
7. **Geolocation**: Verify blue dot appears and updates on iOS Capacitor build
8. **Performance**: Smooth marker position transitions, no jank on 15s updates
9. **Capacitor iOS**: Full-screen map respects safe area, back button works, geolocation permission prompt appears
