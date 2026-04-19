# Live Train Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interactive full-screen Mapbox map showing real-time SMART train locations, station markers, and the rail corridor, accessible via a preview card below the trip list.

**Architecture:** New `/map` route with a Mapbox GL JS map. A `useMapTrains` hook combines vehicle positions + trip updates into map-ready data. Custom HTML markers render the SMART TripIcon with directional arrows. Train callout popups link back to the trip detail sheet. A `MapPreviewCard` in the main view provides the entry point.

**Tech Stack:** Mapbox GL JS, React, TypeScript, Tailwind CSS, existing GTFS-RT hooks

---

### Task 1: Install Mapbox GL JS and add environment config

**Files:**
- Modify: `package.json`
- Modify: `src/lib/env.ts`

- [ ] **Step 1: Install mapbox-gl**

```bash
npm install mapbox-gl
```

Note: `@types/mapbox-gl` is not needed — `mapbox-gl` ships its own TypeScript declarations.

- [ ] **Step 2: Add mapboxToken to env.ts**

In `src/lib/env.ts`, add after the `scheduleUrl` export:

```typescript
export const mapboxToken =
  readOptionalEnvString(import.meta.env.VITE_MAPBOX_TOKEN) ?? "";
```

- [ ] **Step 3: Add the token to .env.local**

Create or append to `.env.local`:

```
VITE_MAPBOX_TOKEN=<your-mapbox-public-token>
```

The user must create a free Mapbox account at https://account.mapbox.com/ and paste their default public token here.

- [ ] **Step 4: Add Mapbox CSS import**

In `src/main.tsx`, add at the top with the other imports:

```typescript
import "mapbox-gl/dist/mapbox-gl.css";
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/env.ts src/main.tsx
git commit -m "feat(map): install mapbox-gl and add token env config"
```

---

### Task 2: Create map constants and route GeoJSON

**Files:**
- Create: `src/lib/mapConstants.ts`

- [ ] **Step 1: Create src/lib/mapConstants.ts**

```typescript
import { STATION_COORDINATES } from "@/data/stations";
import type { Station } from "@/types/smartSchedule";
import stations from "@/data/stations";

/** Station order from north (Windsor) to south (Larkspur) */
export const STATION_ORDER: Station[] = stations;

/** Route line as GeoJSON connecting all stations north→south */
export const ROUTE_GEOJSON: GeoJSON.Feature<GeoJSON.LineString> = {
  type: "Feature",
  properties: {},
  geometry: {
    type: "LineString",
    coordinates: STATION_ORDER.map((s) => [
      STATION_COORDINATES[s].lng,
      STATION_COORDINATES[s].lat,
    ]),
  },
};

/** Default bounds: fit all stations with padding */
export const ALL_STATIONS_BOUNDS: [number, number, number, number] = (() => {
  let minLng = Infinity, maxLng = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;
  for (const s of STATION_ORDER) {
    const { lat, lng } = STATION_COORDINATES[s];
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLng, minLat, maxLng, maxLat];
})();

/** Mapbox style URLs */
export const MAPBOX_STYLE_LIGHT = "mapbox://styles/mapbox/light-v11";
export const MAPBOX_STYLE_DARK = "mapbox://styles/mapbox/dark-v11";

/** Map padding for fitBounds (pixels) */
export const MAP_FIT_PADDING = { top: 80, bottom: 40, left: 40, right: 40 };
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/mapConstants.ts
git commit -m "feat(map): add map constants and route GeoJSON"
```

---

### Task 3: Create the useMapTrains hook

**Files:**
- Create: `src/hooks/useMapTrains.ts`

This hook combines vehicle positions and trip updates into a flat array of map-ready train objects.

- [ ] **Step 1: Create src/hooks/useMapTrains.ts**

```typescript
import { useMemo } from "react";
import { useVehiclePositions } from "@/hooks/useVehiclePositions";
import { useTripUpdates } from "@/hooks/useTripUpdates";
import { GTFS_STOP_ID_TO_STATION } from "@/lib/stationUtils";
import type { Station } from "@/types/smartSchedule";

export interface MapTrain {
  /** Unique key for React rendering */
  key: string;
  vehicleId: string;
  latitude: number;
  longitude: number;
  /** Degrees from north, if available */
  bearing: number | null;
  /** Meters per second, if available */
  speed: number | null;
  /** 0 = southbound, 1 = northbound */
  directionId: number | null;
  /** Trip number derived from tripId (e.g. "312") */
  tripLabel: string | null;
  /** Resolved station name from current stopId */
  nextStation: Station | null;
  /** Delay in minutes (null = on-time or unknown) */
  delayMinutes: number | null;
  /** Whether the trip is canceled */
  isCanceled: boolean;
  /** Trip origin departure "HH:MM" for linking to trip detail */
  startTime: string | null;
}

/**
 * Combines vehicle positions + trip updates into map-ready train data.
 * Only includes vehicles that have a valid trip assignment and position.
 */
export function useMapTrains(): { trains: MapTrain[]; lastUpdated: Date | null } {
  const { data: vehicleData } = useVehiclePositions();
  const { data: tripData } = useTripUpdates();

  return useMemo(() => {
    const lastUpdated =
      vehicleData?.timestamp != null
        ? new Date(vehicleData.timestamp * 1000)
        : null;

    if (!vehicleData?.vehicles) return { trains: [], lastUpdated };

    // Build a map of tripId → delay info from trip updates
    const tripDelays = new Map<
      string,
      { delayMinutes: number | null; isCanceled: boolean }
    >();
    if (tripData?.updates) {
      for (const update of tripData.updates) {
        const isCanceled = update.scheduleRelationship === "CANCELED";
        // Find the max delay across all stops for this trip
        let maxDelay: number | null = null;
        if (!isCanceled) {
          for (const stu of update.stopTimeUpdates) {
            if (stu.departureTime && update.startTime && update.startDate) {
              // We can't easily compute delay without the static schedule here,
              // but we can use departureDelay as a rough indicator for the map.
              // The per-stop delay from departureDelay is often 0 on 511.org,
              // so we fall back to checking if any stop has a non-zero delay.
              if (stu.departureDelay != null && stu.departureDelay >= 180) {
                const mins = Math.round(stu.departureDelay / 60);
                if (maxDelay === null || mins > maxDelay) maxDelay = mins;
              }
            }
          }
        }
        tripDelays.set(update.tripId, { delayMinutes: maxDelay, isCanceled });
      }
    }

    const trains: MapTrain[] = [];

    for (const vehicle of vehicleData.vehicles) {
      // Only include vehicles on active revenue trips with valid positions
      if (!vehicle.trip) continue;
      if (vehicle.position.latitude === 0 && vehicle.position.longitude === 0) continue;

      const tripInfo = tripDelays.get(vehicle.trip.tripId);
      const nextStation = vehicle.stopId
        ? (GTFS_STOP_ID_TO_STATION[vehicle.stopId] ?? null)
        : null;

      trains.push({
        key: vehicle.vehicleId,
        vehicleId: vehicle.vehicleId,
        latitude: vehicle.position.latitude,
        longitude: vehicle.position.longitude,
        bearing: vehicle.position.bearing ?? null,
        speed: vehicle.position.speed ?? null,
        directionId: vehicle.trip.directionId ?? null,
        tripLabel: vehicle.trip.tripId ?? null,
        nextStation,
        delayMinutes: tripInfo?.delayMinutes ?? null,
        isCanceled: tripInfo?.isCanceled ?? false,
        startTime: vehicle.trip.startTime?.slice(0, 5) ?? null,
      });
    }

    return { trains, lastUpdated };
  }, [vehicleData, tripData]);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useMapTrains.ts
git commit -m "feat(map): add useMapTrains hook combining vehicle + trip data"
```

---

### Task 4: Create the Map page with Mapbox initialization

**Files:**
- Create: `src/pages/Map.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create src/pages/Map.tsx**

This is the core map page. It initializes Mapbox, renders the route line, station markers, and train markers.

```typescript
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import mapboxgl from "mapbox-gl";
import { mapboxToken } from "@/lib/env";
import { useTheme } from "@/components/theme-context";
import { useMapTrains } from "@/hooks/useMapTrains";
import { useGeolocation } from "@/hooks/useGeolocation";
import { STATION_COORDINATES } from "@/data/stations";
import { GTFS_STOP_ID_TO_STATION } from "@/lib/stationUtils";
import type { Station } from "@/types/smartSchedule";
import {
  ROUTE_GEOJSON,
  ALL_STATIONS_BOUNDS,
  MAPBOX_STYLE_LIGHT,
  MAPBOX_STYLE_DARK,
  MAP_FIT_PADDING,
  STATION_ORDER,
} from "@/lib/mapConstants";
import type { MapTrain } from "@/hooks/useMapTrains";
import { ChevronLeft } from "lucide-react";

/** Convert m/s to mph */
function mpsToMph(mps: number): number {
  return Math.round(mps * 2.237);
}

/** SVG path for the TripIcon (SMART train front view) */
const TRIP_ICON_PATH =
  "M185.985 327.015H162.647M326.015 327.015H349.353M162.647 420.368L115.97 490.383M349.353 420.368L396.03 490.383M69.2939 239.496V303.677C69.2939 369.024 120.638 420.368 185.985 420.368H326.015C391.362 420.368 442.706 369.024 442.706 303.677V239.496M69.2939 239.496V210.324C69.2939 160.806 88.9647 113.317 123.979 78.3024C135.618 66.6635 148.635 56.72 162.647 48.6308M69.2939 239.496H162.647M442.706 239.496V210.324C442.706 160.806 423.035 113.317 388.021 78.3024C376.382 66.6635 363.365 56.72 349.353 48.6308M442.706 239.496H349.353M162.647 239.496V48.6308M162.647 239.496H349.353M162.647 48.6308C190.789 32.3844 222.942 23.6174 256 23.6174C289.058 23.6174 321.212 32.3844 349.353 48.6308M349.353 239.496V48.6308";

function createTrainMarkerElement(train: MapTrain): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "train-marker";

  const isDelayed = train.delayMinutes != null && train.delayMinutes > 0;
  const color = isDelayed ? "#E48E25" : "#11ab75";
  const isNorthbound = train.directionId === 1;

  // Arrow + circle container
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;cursor:pointer;">
      ${isNorthbound ? `<div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:7px solid ${color};margin-bottom:2px;"></div>` : ""}
      <div style="width:30px;height:30px;border-radius:50%;background:${color};border:2.5px solid var(--marker-border, white);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.25);">
        <svg width="16" height="16" viewBox="0 0 512 512" fill="none" stroke="white" stroke-width="40" stroke-linecap="round" stroke-linejoin="round">
          <path d="${TRIP_ICON_PATH}"/>
        </svg>
      </div>
      ${!isNorthbound ? `<div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:7px solid ${color};margin-top:2px;"></div>` : ""}
    </div>
  `;

  return el;
}

function createStationMarkerElement(station: Station): HTMLDivElement {
  const el = document.createElement("div");
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:3px;">
      <div style="width:9px;height:9px;border-radius:50%;background:var(--station-dot-bg, white);border:2.5px solid #11ab75;flex-shrink:0;"></div>
      <div style="font-size:10px;font-weight:600;color:var(--station-label-color, #1a1a1a);background:var(--station-label-bg, rgba(255,255,255,0.88));padding:1px 5px;border-radius:3px;white-space:nowrap;backdrop-filter:blur(4px);">${station}</div>
    </div>
  `;
  return el;
}

function buildCalloutHTML(train: MapTrain): string {
  const isDelayed = train.delayMinutes != null && train.delayMinutes > 0;
  const statusText = train.isCanceled
    ? "Canceled"
    : isDelayed
      ? `+${train.delayMinutes} min`
      : "On Time";
  const statusClass = train.isCanceled
    ? "background:#fee2e2;color:#991b1b;"
    : isDelayed
      ? "background:#fef3c7;color:#92400e;"
      : "background:#dcfce7;color:#166534;";
  const direction =
    train.directionId === 1 ? "Northbound ↑" : "Southbound ↓";
  const speedMph =
    train.speed != null && train.speed > 0 ? `${mpsToMph(train.speed)} mph` : "—";
  const nextStop = train.nextStation ?? "—";
  const tripLabel = train.tripLabel ?? "—";

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-width:190px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <span style="font-size:14px;font-weight:700;">Train ${tripLabel}</span>
        <span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:7px;${statusClass}">${statusText}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
        <span style="color:#888;">Direction</span>
        <strong>${direction}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
        <span style="color:#888;">Speed</span>
        <strong>${speedMph}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
        <span style="color:#888;">Next stop</span>
        <strong>${nextStop}</strong>
      </div>
      ${
        train.startTime
          ? `<a href="/?trip=${train.startTime}" style="display:block;text-align:center;margin-top:8px;font-size:12px;font-weight:600;color:#11ab75;padding:5px;background:rgba(17,171,117,0.1);border-radius:7px;text-decoration:none;">View Trip Details →</a>`
          : ""
      }
    </div>
  `;
}

export default function MapPage() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { trains, lastUpdated } = useMapTrains();
  const { lat, lng } = useGeolocation({ watch: true, autoRequestOnNative: true, autoRequestOnWeb: true });

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  const resolvedTheme =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    mapboxgl.accessToken = mapboxToken;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: resolvedTheme === "dark" ? MAPBOX_STYLE_DARK : MAPBOX_STYLE_LIGHT,
      bounds: ALL_STATIONS_BOUNDS as [number, number, number, number],
      fitBoundsOptions: { padding: MAP_FIT_PADDING },
      attributionControl: false,
    });

    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-left");

    map.on("load", () => {
      // Add route line
      map.addSource("route", { type: "geojson", data: ROUTE_GEOJSON });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        paint: {
          "line-color": "#11ab75",
          "line-width": 3.5,
          "line-opacity": 0.45,
          "line-dasharray": [2, 1],
        },
      });

      // Add station markers
      for (const station of STATION_ORDER) {
        const coords = STATION_COORDINATES[station];
        const el = createStationMarkerElement(station);
        new mapboxgl.Marker({ element: el, anchor: "left" })
          .setLngLat([coords.lng, coords.lat])
          .addTo(map);
      }

      setMapLoaded(true);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
      setMapLoaded(false);
    };
    // Only run on mount — theme changes handled separately
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update map style when theme changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const newStyle =
      resolvedTheme === "dark" ? MAPBOX_STYLE_DARK : MAPBOX_STYLE_LIGHT;
    map.setStyle(newStyle);

    // Re-add route source/layer after style loads
    map.once("style.load", () => {
      if (!map.getSource("route")) {
        map.addSource("route", { type: "geojson", data: ROUTE_GEOJSON });
        map.addLayer({
          id: "route-line",
          type: "line",
          source: "route",
          paint: {
            "line-color": "#11ab75",
            "line-width": 3.5,
            "line-opacity": 0.45,
            "line-dasharray": [2, 1],
          },
        });
      }
    });
  }, [resolvedTheme]);

  // Update train markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const currentKeys = new Set<string>();

    for (const train of trains) {
      currentKeys.add(train.key);

      const existing = markersRef.current.get(train.key);
      if (existing) {
        // Update position smoothly
        existing.setLngLat([train.longitude, train.latitude]);
        // Replace element for color/direction changes
        const el = createTrainMarkerElement(train);
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          popupRef.current?.remove();
          const popup = new mapboxgl.Popup({
            offset: 25,
            closeButton: true,
            maxWidth: "260px",
          })
            .setLngLat([train.longitude, train.latitude])
            .setHTML(buildCalloutHTML(train))
            .addTo(map);
          popupRef.current = popup;
        });
        existing.getElement().replaceWith(el);
        // Mapbox markers don't have a setElement, so we need to remove and re-add
        existing.remove();
        const marker = new mapboxgl.Marker({ element: el, anchor: "center" })
          .setLngLat([train.longitude, train.latitude])
          .addTo(map);
        markersRef.current.set(train.key, marker);
      } else {
        // Create new marker
        const el = createTrainMarkerElement(train);
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          popupRef.current?.remove();
          const popup = new mapboxgl.Popup({
            offset: 25,
            closeButton: true,
            maxWidth: "260px",
          })
            .setLngLat([train.longitude, train.latitude])
            .setHTML(buildCalloutHTML(train))
            .addTo(map);
          popupRef.current = popup;
        });
        const marker = new mapboxgl.Marker({ element: el, anchor: "center" })
          .setLngLat([train.longitude, train.latitude])
          .addTo(map);
        markersRef.current.set(train.key, marker);
      }
    }

    // Remove stale markers
    for (const [key, marker] of markersRef.current) {
      if (!currentKeys.has(key)) {
        marker.remove();
        markersRef.current.delete(key);
      }
    }
  }, [trains, mapLoaded]);

  // Update user location marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    if (lat != null && lng != null) {
      if (userMarkerRef.current) {
        userMarkerRef.current.setLngLat([lng, lat]);
      } else {
        const el = document.createElement("div");
        el.innerHTML = `
          <div style="width:14px;height:14px;border-radius:50%;background:#4285f4;border:2.5px solid white;box-shadow:0 0 0 4px rgba(66,133,244,0.2),0 2px 4px rgba(0,0,0,0.2);"></div>
        `;
        userMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: "center" })
          .setLngLat([lng, lat])
          .addTo(map);
      }
    }
  }, [lat, lng, mapLoaded]);

  // Fit all trains
  const handleFitAllTrains = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    if (trains.length === 0) {
      map.fitBounds(ALL_STATIONS_BOUNDS as [number, number, number, number], {
        padding: MAP_FIT_PADDING,
        duration: 500,
      });
      return;
    }

    const bounds = new mapboxgl.LngLatBounds();
    for (const train of trains) {
      bounds.extend([train.longitude, train.latitude]);
    }
    map.fitBounds(bounds, { padding: MAP_FIT_PADDING, duration: 500 });
  }, [trains]);

  return (
    <div className="fixed inset-0 z-50 bg-background">
      <div ref={mapContainerRef} className="absolute inset-0" />

      {/* Back button */}
      <button
        onClick={() => navigate("/")}
        className="absolute top-[calc(12px+var(--safe-area-top))] left-3 z-10 flex items-center gap-1.5 rounded-xl bg-background/95 backdrop-blur-sm px-3 py-2 text-sm font-semibold text-foreground shadow-md border border-border"
      >
        <ChevronLeft className="h-4 w-4" />
        Back
      </button>

      {/* Train count pill */}
      <button
        onClick={handleFitAllTrains}
        className="absolute top-[calc(12px+var(--safe-area-top))] right-3 z-10 flex items-center gap-1.5 rounded-xl bg-background/95 backdrop-blur-sm px-3 py-2 text-sm font-semibold text-foreground shadow-md border border-border"
      >
        <div className="w-2 h-2 rounded-full bg-smart-train-green" />
        {trains.length} {trains.length === 1 ? "train" : "trains"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Add the /map route to App.tsx**

In `src/App.tsx`, add the import at the top with the other page imports:

```typescript
import Map from "./pages/Map";
```

Then add the route before the catch-all:

```tsx
<Route path="/map" element={<Map />} />
```

The Routes block should look like:

```tsx
<Routes>
  <Route path="/" element={<Index />} />
  <Route path="/map" element={<Map />} />
  {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
  <Route path="*" element={<NotFound />} />
</Routes>
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/Map.tsx src/App.tsx
git commit -m "feat(map): add full-screen map page with Mapbox, trains, and stations"
```

---

### Task 5: Create the MapPreviewCard entry point

**Files:**
- Create: `src/components/MapPreviewCard.tsx`
- Modify: `src/components/TrainScheduleApp.tsx`

- [ ] **Step 1: Create src/components/MapPreviewCard.tsx**

```typescript
import { useNavigate } from "react-router-dom";
import { Map as MapIcon } from "lucide-react";
import { useVehiclePositions } from "@/hooks/useVehiclePositions";

export function MapPreviewCard() {
  const navigate = useNavigate();
  const { data } = useVehiclePositions();

  const activeCount =
    data?.vehicles?.filter((v) => v.trip != null).length ?? 0;

  return (
    <button
      onClick={() => navigate("/map")}
      className="w-full rounded-xl border border-smart-train-green/30 bg-smart-train-green/5 hover:bg-smart-train-green/10 transition-colors p-4 flex items-center justify-between gap-3 text-left"
    >
      <div className="flex items-center gap-2.5">
        <MapIcon className="h-5 w-5 text-smart-train-green flex-shrink-0" />
        <div>
          <div className="font-semibold text-sm text-smart-train-green">
            Live Train Map
          </div>
          <div className="text-xs text-smart-train-green/70">
            See all trains in real time
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold bg-smart-train-green text-white rounded-full px-2.5 py-0.5">
          {activeCount} active
        </span>
        <span className="text-smart-train-green text-lg">→</span>
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Add MapPreviewCard to TrainScheduleApp.tsx**

In `src/components/TrainScheduleApp.tsx`, add the import:

```typescript
import { MapPreviewCard } from "./MapPreviewCard";
```

Then add the card below the `ScheduleResults` / `NoTripsFound` section and above the `FareSection`. Find this section in the JSX:

```tsx
{fromStation && toStation && filteredTrips.length === 0 && (
  <NoTripsFound />
)}

{/* Fare Section */}
```

Insert the `MapPreviewCard` between them:

```tsx
{fromStation && toStation && filteredTrips.length === 0 && (
  <NoTripsFound />
)}

{/* Live Train Map */}
<MapPreviewCard />

{/* Fare Section */}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/MapPreviewCard.tsx src/components/TrainScheduleApp.tsx
git commit -m "feat(map): add MapPreviewCard entry point below trip list"
```

---

### Task 6: Dark mode CSS variables for map markers

**Files:**
- Modify: `src/pages/Map.tsx`

The Mapbox markers use inline styles with CSS custom properties for theme-aware colors. We need to set those variables on the map container.

- [ ] **Step 1: Add CSS variable class to the map container div**

In `src/pages/Map.tsx`, update the map container div to include theme-aware CSS variables. Change:

```tsx
<div ref={mapContainerRef} className="absolute inset-0" />
```

To:

```tsx
<div
  ref={mapContainerRef}
  className="absolute inset-0"
  style={{
    "--marker-border": resolvedTheme === "dark" ? "#2a3048" : "white",
    "--station-dot-bg": resolvedTheme === "dark" ? "#2a3048" : "white",
    "--station-label-color": resolvedTheme === "dark" ? "#e0e0e0" : "#1a1a1a",
    "--station-label-bg":
      resolvedTheme === "dark"
        ? "rgba(30,35,51,0.88)"
        : "rgba(255,255,255,0.88)",
  } as React.CSSProperties}
/>
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/Map.tsx
git commit -m "feat(map): add dark mode CSS variables for map markers"
```

---

### Task 7: Handle "View Trip Details" link navigation

**Files:**
- Modify: `src/pages/Map.tsx`

The callout "View Trip Details →" link uses `<a href="/?trip=HH:MM">`. We need to intercept this to use React Router navigation instead of a full page reload.

- [ ] **Step 1: Add click handler for callout links**

In `src/pages/Map.tsx`, add a `useEffect` that listens for clicks on the callout links and uses `navigate` instead. Add this after the other `useEffect` hooks:

```typescript
// Intercept callout "View Trip Details" link clicks to use React Router
useEffect(() => {
  const handler = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest("a[href^='/?trip=']");
    if (anchor) {
      e.preventDefault();
      const href = anchor.getAttribute("href");
      if (href) navigate(href);
    }
  };
  document.addEventListener("click", handler);
  return () => document.removeEventListener("click", handler);
}, [navigate]);
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/Map.tsx
git commit -m "feat(map): intercept callout links for React Router navigation"
```

---

### Task 8: Handle the trip query parameter on the main page

**Files:**
- Modify: `src/hooks/useTrainScheduleState.ts`

When the user taps "View Trip Details" from the map callout, they navigate to `/?trip=HH:MM`. The main page needs to pick up this parameter and open the trip detail sheet.

- [ ] **Step 1: Read useTrainScheduleState.ts to understand current URL param handling**

Read `src/hooks/useTrainScheduleState.ts` to see how URL params are currently used. The hook already reads `from`, `to`, `type`, and `trip` from the URL search params. Check if `trip` is already handled.

- [ ] **Step 2: Verify the trip param is already handled**

The hook at `src/hooks/useTrainScheduleState.ts` already reads the `trip` search param and uses it to set `selectedTripNumber`. If it matches a trip's departure time, it opens the detail sheet. No changes should be needed here — verify by reading the file and confirming the logic exists.

If the `trip` param is NOT already handled, add logic to match the `trip=HH:MM` param to a `ProcessedTrip.departureTime` and call `setSelectedTrip` with the matching trip number.

- [ ] **Step 3: Commit (only if changes were made)**

```bash
git add src/hooks/useTrainScheduleState.ts
git commit -m "feat(map): handle trip query param for map callout deep links"
```

---

### Task 9: Capacitor safe area handling

**Files:**
- Modify: `src/pages/Map.tsx`

The map page uses `var(--safe-area-top)` for the overlay buttons. Verify this CSS variable is set globally (it should be, since the main app uses it in `StickyHeader`). If not, add it.

- [ ] **Step 1: Check that --safe-area-top is defined globally**

Search for `--safe-area-top` in `src/index.css` or the global CSS. The app should already set:

```css
:root {
  --safe-area-top: env(safe-area-inset-top, 0px);
}
```

If it's not there, add it to `src/index.css`.

- [ ] **Step 2: Commit (only if changes were made)**

```bash
git add src/index.css
git commit -m "fix(map): ensure --safe-area-top CSS variable is defined"
```

---

### Task 10: Manual end-to-end verification

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify the MapPreviewCard appears**

Open http://localhost:3210 in a browser. Select a from/to station pair. Below the trip list, the "Live Train Map" card should appear with an active train count badge.

- [ ] **Step 3: Verify the full-screen map**

Tap the MapPreviewCard. The map should open full-screen at `/map` showing:
- The SMART rail corridor as a dashed green line
- Station markers with labels along the route
- Train markers (if any active trains) with green circles and the SMART train icon
- Direction arrows above for northbound, below for southbound
- Delayed trains shown in gold

- [ ] **Step 4: Verify train callout**

Tap a train marker. A popup should appear showing trip number, status, direction, speed, and next stop. The "View Trip Details →" link should navigate back to `/` and open the trip detail sheet.

- [ ] **Step 5: Verify dark mode**

Toggle the app theme to dark mode. The map should switch to the dark Mapbox style. Station labels and marker borders should use dark theme colors.

- [ ] **Step 6: Verify "N trains" button**

Tap the train count pill (top-right). The map should zoom to fit all active train positions. If no trains are active, it should zoom to show the full corridor.

- [ ] **Step 7: Verify back button**

Tap the back button. Should navigate to `/` preserving the previously selected stations.

- [ ] **Step 8: Verify user location**

If geolocation permission is granted, a blue dot should appear at the user's position.

- [ ] **Step 9: Commit final state**

```bash
git add -A
git commit -m "feat(map): live train map with Mapbox, callouts, and dark mode"
```
