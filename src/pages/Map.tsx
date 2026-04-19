import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { ChevronLeft } from "lucide-react";

import { mapboxToken } from "@/lib/env";
import {
  STATION_ORDER,
  ROUTE_GEOJSON,
  ALL_STATIONS_BOUNDS,
  MAPBOX_STYLE_LIGHT,
  MAPBOX_STYLE_DARK,
  MAP_FIT_PADDING,
} from "@/lib/mapConstants";
import stations, { STATION_COORDINATES } from "@/data/stations";
import { useMapTrains, type MapTrain } from "@/hooks/useMapTrains";
import { useScheduleData } from "@/hooks/useScheduleData";
import { useTheme } from "@/components/theme-context";
import { useGeolocation } from "@/hooks/useGeolocation";
import { TRIP_ICON_PATH } from "@/components/icons/TripIcon";
import { TripDetailSheet } from "@/components/TripDetailSheet";
import { getFilteredTrips } from "@/lib/scheduleUtils";
import { stationIndexMap, getClosestStation } from "@/lib/stationUtils";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { Station } from "@/types/smartSchedule";

// ─── constants ────────────────────────────────────────────────────────────────

/** Hex colors mirroring the smart-train-green / smart-gold Tailwind tokens.
 *  Needed because Mapbox marker elements are built with raw inline styles. */
const MARKER_COLOR = {
  ontime: "#11ab75",
  delayed: "#E48E25",
  canceled: "#888",
  userLocation: "#4285f4",
} as const;

/** Minimum delay (minutes) to flip a marker from ontime → delayed. */
const DELAY_MINUTES_THRESHOLD = 3;

/** Fallback bearings (degrees from north) used when GTFS-RT omits the vehicle
 *  bearing. Chosen to roughly follow the SMART rail corridor. */
const NORTHBOUND_FALLBACK_BEARING = 340;
const SOUTHBOUND_FALLBACK_BEARING = 160;

// ─── helpers ─────────────────────────────────────────────────────────────────

function resolveTheme(theme: "dark" | "light" | "system"): "dark" | "light" {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

// ─── marker element factories ─────────────────────────────────────────────────

function createStationElement(): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.style.cssText = [
    "display:flex",
    "align-items:center",
    "gap:4px",
    "cursor:default",
  ].join(";");

  const dot = document.createElement("div");
  dot.style.cssText = [
    "width:9px",
    "height:9px",
    "border-radius:50%",
    "background:var(--station-dot-bg,white)",
    `border:2px solid ${MARKER_COLOR.ontime}`,
    "flex-shrink:0",
  ].join(";");

  const label = document.createElement("span");
  label.style.cssText = [
    "font-size:10px",
    "font-weight:600",
    "white-space:nowrap",
    "padding:1px 4px",
    "border-radius:4px",
    "color:var(--station-label-color,#1a1a1a)",
    "background:var(--station-label-bg,rgba(255,255,255,0.88))",
    "line-height:1.4",
  ].join(";");

  wrapper.appendChild(dot);
  wrapper.appendChild(label);
  return wrapper;
}

function createTrainElement(train: MapTrain, selected: boolean): HTMLElement {
  const isDelayed =
    !train.isCanceled &&
    train.delayMinutes !== null &&
    train.delayMinutes >= DELAY_MINUTES_THRESHOLD;
  const bgColor = train.isCanceled
    ? MARKER_COLOR.canceled
    : isDelayed
      ? MARKER_COLOR.delayed
      : MARKER_COLOR.ontime;

  // Some feeds send bearing:0 as "unknown" rather than omitting the field;
  // treat an exact 0 as unset and fall back to a corridor-aligned angle.
  const hasValidBearing = train.bearing != null && train.bearing !== 0;
  const bearing = hasValidBearing
    ? train.bearing!
    : train.directionId === 1
      ? NORTHBOUND_FALLBACK_BEARING
      : SOUTHBOUND_FALLBACK_BEARING;

  // Outer wrapper preserves the working pattern: flex column with two
  // invisible border-triangle siblings above/below a square middle. The
  // structure (not the exact pixel count) is what keeps Mapbox anchor:center
  // aligned with the disc's center.
  const wrapper = document.createElement("div");
  wrapper.style.cssText = [
    "display:flex",
    "flex-direction:column",
    "align-items:center",
    "gap:0",
    "cursor:pointer",
  ].join(";");

  const spacerAbove = document.createElement("div");
  spacerAbove.style.cssText = [
    "width:0",
    "height:0",
    "border-left:8px solid transparent",
    "border-right:8px solid transparent",
    `border-bottom:10px solid ${bgColor}`,
    "visibility:hidden",
  ].join(";");

  // 46×46 transparent host — defines the layout box Mapbox anchors against.
  // The disc (30×30 inset) leaves an 8px ring for the direction indicator.
  const host = document.createElement("div");
  host.style.cssText = [
    "width:46px",
    "height:46px",
    "position:relative",
  ].join(";");

  // Layer 1 (bottom): shadow backdrop. Same size/position as the disc — only
  // its box-shadow shows, extending outward. Gives the composite its depth.
  // When selected, a second spread-only shadow creates a highlight ring.
  const shadowBackdrop = document.createElement("div");
  const shadow = selected
    ? `0 3px 8px rgba(0,0,0,0.5), 0 0 0 4px rgba(255,255,255,0.9), 0 0 0 6px ${bgColor}`
    : "0 3px 8px rgba(0,0,0,0.5)";
  shadowBackdrop.style.cssText = [
    "position:absolute",
    "top:8px",
    "left:8px",
    "width:30px",
    "height:30px",
    "border-radius:50%",
    `background:${bgColor}`,
    `box-shadow:${shadow}`,
  ].join(";");

  // Layer 2 (middle): rotating indicator. Its drop-shadow follows the
  // triangle outline so the tick reads as part of the same 3D object.
  const rotator = document.createElement("div");
  rotator.style.cssText = [
    "position:absolute",
    "inset:0",
    `transform:rotate(${bearing}deg)`,
    "pointer-events:none",
    "filter:drop-shadow(0 2px 3px rgba(0,0,0,0.4))",
  ].join(";");
  const tick = document.createElement("div");
  tick.style.cssText = [
    "position:absolute",
    "top:0",
    "left:50%",
    "margin-left:-8px",
    "width:0",
    "height:0",
    "border-left:8px solid transparent",
    "border-right:8px solid transparent",
    `border-bottom:10px solid ${bgColor}`,
  ].join(";");
  rotator.appendChild(tick);

  // Layer 3 (top): the visible disc. No shadow — it covers the shadow
  // backdrop and the tick's base, leaving only clean edges for the eye.
  const disc = document.createElement("div");
  disc.style.cssText = [
    "position:absolute",
    "top:8px",
    "left:8px",
    "width:30px",
    "height:30px",
    "border-radius:50%",
    `background:${bgColor}`,
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "box-sizing:border-box",
  ].join(";");
  disc.innerHTML = `<svg viewBox="0 0 512 512" fill="none" stroke="white" stroke-width="40" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="${TRIP_ICON_PATH}"/></svg>`;

  host.appendChild(shadowBackdrop);
  host.appendChild(rotator);
  host.appendChild(disc);

  const spacerBelow = document.createElement("div");
  spacerBelow.style.cssText = [
    "width:0",
    "height:0",
    "border-left:8px solid transparent",
    "border-right:8px solid transparent",
    `border-top:10px solid ${bgColor}`,
    "visibility:hidden",
  ].join(";");

  wrapper.appendChild(spacerAbove);
  wrapper.appendChild(host);
  wrapper.appendChild(spacerBelow);
  return wrapper;
}

// ─── Map page component ───────────────────────────────────────────────────────

export default function Map() {
  const navigate = useNavigate();
  const location = useLocation();
  const backToSchedule = () => {
    // Prefer history back so we return to the exact URL we came from
    // (preserving query params and scroll). Fall back to a direct navigate
    // when the map was opened via a direct link (no prior history entry).
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate({ pathname: "/", search: location.search });
    }
  };
  const { theme } = useTheme();
  const { trains } = useMapTrains();
  const { lat: userLat, lng: userLng } = useGeolocation({
    watch: true,
    autoRequestOnNative: true,
    autoRequestOnWeb: true,
  });
  const [selectedTrainKey, setSelectedTrainKey] = useState<string | null>(null);
  const [detailTrip, setDetailTrip] = useState<{
    trip: ProcessedTrip;
    fromStation: Station;
    toStation: Station;
  } | null>(null);
  // Toggled one frame after detailTrip mounts so the sheet animates in.
  const [detailOpen, setDetailOpen] = useState(false);
  // Pull schedule version so the detail lookup re-runs when schedule data
  // swaps in.
  useScheduleData();

  const handleTrainClick = useCallback((train: MapTrain) => {
    // Always highlight the tapped marker.
    setSelectedTrainKey(train.key);

    if (train.tripNumber == null || train.directionId == null) return;

    const isSouthbound = train.directionId === 0;
    const WINDSOR = stations[0];
    const LARKSPUR = stations[stations.length - 1];
    const terminus = isSouthbound ? LARKSPUR : WINDSOR;
    const origin = isSouthbound ? WINDSOR : LARKSPUR;
    const originIndex = isSouthbound ? 0 : stations.length - 1;

    // Look up the full-corridor trip (always a valid station pair).
    // Try progressively looser matches so we get *some* trip rather than
    // failing silently.
    const candidates = [
      ...getFilteredTrips(origin, terminus, "weekday"),
      ...getFilteredTrips(origin, terminus, "weekend"),
    ];
    const match =
      candidates.find(
        (t) =>
          t.trip === train.tripNumber &&
          train.startTime != null &&
          t.times[originIndex] === train.startTime,
      ) ?? candidates.find((t) => t.trip === train.tripNumber);
    if (!match) return;

    // Pick the display "from" station. We start ONE STOP BEFORE the next
    // upcoming stop so that the previous stop appears in the timeline as
    // "past", which triggers the green "current" highlight on the next
    // upcoming stop.
    //
    //   - STOPPED_AT X: X has been served. Upcoming = stop after X.
    //     Display from = X (so X appears as past, next stop as current).
    //   - IN_TRANSIT_TO X / INCOMING_AT X: X is the next upcoming stop.
    //     Display from = stop before X.
    //   - No status + no stopId: fall back to the nearest station by GPS
    //     (likely just passed) and treat as served.
    const pickDisplayFrom = (): Station => {
      let anchorStation: Station | null = train.nextStation;
      let treatAsServed = train.currentStatus === "STOPPED_AT";
      if (anchorStation == null) {
        anchorStation = getClosestStation(train.latitude, train.longitude);
        treatAsServed = true;
      }
      const anchorIdx = stations.indexOf(anchorStation);
      if (anchorIdx === -1) return origin;
      // Index of the first upcoming stop.
      const upcomingIdx = treatAsServed
        ? (isSouthbound ? anchorIdx + 1 : anchorIdx - 1)
        : anchorIdx;
      // One stop before that (shown as "past" to give context).
      const displayFromIdx = isSouthbound ? upcomingIdx - 1 : upcomingIdx + 1;
      if (displayFromIdx >= 0 && displayFromIdx < stations.length) {
        return stations[displayFromIdx];
      }
      // Can't back up further (train is still at/near the origin); just
      // use the upcoming stop as-is.
      if (upcomingIdx >= 0 && upcomingIdx < stations.length) {
        return stations[upcomingIdx];
      }
      return anchorStation;
    };

    const displayFrom = pickDisplayFrom();
    // Build an overridden trip that pretends the journey starts at the
    // next-upcoming stop. times stays full so all station indices remain
    // valid; StopTimeline slices by station index so only upcoming stops
    // appear.
    const displayTrip: ProcessedTrip = {
      ...match,
      fromStation: displayFrom,
      toStation: terminus,
      departureTime: match.times[stationIndexMap[displayFrom]] ?? match.departureTime,
      arrivalTime: match.times[stationIndexMap[terminus]] ?? match.arrivalTime,
    };
    setDetailTrip({
      trip: displayTrip,
      fromStation: displayFrom,
      toStation: terminus,
    });
  }, []);

  // Drive the animate-in: mount with detailOpen=false, flip to true AFTER
  // a short delay so the browser paints the initial off-screen state before
  // the CSS transition runs. Same pattern used by TripCard for its sheet.
  useEffect(() => {
    if (detailTrip) {
      const id = window.setTimeout(() => setDetailOpen(true), 24);
      return () => window.clearTimeout(id);
    } else {
      setDetailOpen(false);
    }
  }, [detailTrip]);

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    // Keep the trip mounted until the exit transition finishes so the sheet
    // animates out instead of snapping away.
    setTimeout(() => {
      setDetailTrip(null);
      setSelectedTrainKey(null);
    }, 520);
  }, []);

  // Guard: if no Mapbox token, show a helpful message instead of crashing
  if (!mapboxToken) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex items-center justify-center p-6">
        <div className="text-center max-w-sm space-y-4">
          <h2 className="text-lg font-semibold">Mapbox Token Required</h2>
          <p className="text-sm text-muted-foreground">
            Add your Mapbox public token to <code className="text-xs bg-muted px-1 py-0.5 rounded">.env.local</code> as <code className="text-xs bg-muted px-1 py-0.5 rounded">VITE_MAPBOX_TOKEN</code> and restart the dev server.
          </p>
          <button
            type="button"
            onClick={backToSchedule}
            className="text-sm font-medium text-smart-train-green"
          >
            ← Back to schedule
          </button>
        </div>
      </div>
    );
  }

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  const stationMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const trainMarkersRef = useRef<globalThis.Map<string, mapboxgl.Marker>>(
    new globalThis.Map()
  );
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);

  // ── helper: add route source/layer ─────────────────────────────────────────
  const addRouteLayer = useCallback((map: mapboxgl.Map) => {
    if (map.getSource("route")) {
      (map.getSource("route") as mapboxgl.GeoJSONSource).setData(ROUTE_GEOJSON);
    } else {
      map.addSource("route", { type: "geojson", data: ROUTE_GEOJSON });
    }

    if (!map.getLayer("route-line")) {
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": MARKER_COLOR.ontime,
          "line-width": 3.5,
          "line-opacity": 0.45,
          "line-dasharray": [2, 1],
        },
      });
    }
  }, []);

  // ── helper: add station markers ─────────────────────────────────────────────
  const addStationMarkers = useCallback((map: mapboxgl.Map) => {
    stationMarkersRef.current.forEach((m) => m.remove());
    stationMarkersRef.current = [];

    for (const station of STATION_ORDER) {
      const { lat, lng } = STATION_COORDINATES[station];
      const el = createStationElement();
      const label = el.querySelector("span");
      if (label) label.textContent = station;

      const marker = new mapboxgl.Marker({ element: el, anchor: "left" })
        .setLngLat([lng, lat])
        .addTo(map);

      stationMarkersRef.current.push(marker);
    }
  }, []);

  // ── init map (once) ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const resolved = resolveTheme(theme);
    mapboxgl.accessToken = mapboxToken;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: resolved === "dark" ? MAPBOX_STYLE_DARK : MAPBOX_STYLE_LIGHT,
      bounds: ALL_STATIONS_BOUNDS,
      fitBoundsOptions: { padding: MAP_FIT_PADDING, animate: false },
      attributionControl: false,
    });

    map.addControl(
      new mapboxgl.AttributionControl({ compact: true }),
      "bottom-left"
    );

    map.on("load", () => {
      addRouteLayer(map);
      addStationMarkers(map);
      setMapLoaded(true);
    });

    mapRef.current = map;

    return () => {
      // clean up markers
      stationMarkersRef.current.forEach((m) => m.remove());
      stationMarkersRef.current = [];
      trainMarkersRef.current.forEach((m) => m.remove());
      trainMarkersRef.current.clear();
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // intentionally run only once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── theme changes → swap style ──────────────────────────────────────────────
  // Skip first run: the map is already initialized with the correct style.
  // Only re-run when theme changes after mount.
  const isFirstThemeRun = useRef(true);
  useEffect(() => {
    if (isFirstThemeRun.current) {
      isFirstThemeRun.current = false;
      return;
    }
    const map = mapRef.current;
    if (!map) return;

    const resolved = resolveTheme(theme);
    const newStyle = resolved === "dark" ? MAPBOX_STYLE_DARK : MAPBOX_STYLE_LIGHT;

    // Mapbox fires 'style.load' after setStyle finishes
    map.once("style.load", () => {
      addRouteLayer(map);
      addStationMarkers(map);
    });

    map.setStyle(newStyle);
  }, [theme, addRouteLayer, addStationMarkers]);

  // ── update train markers when trains data changes ───────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const existingKeys = new Set(trainMarkersRef.current.keys());
    const newKeys = new Set(trains.map((t) => t.key));

    // Remove stale markers
    for (const key of existingKeys) {
      if (!newKeys.has(key)) {
        trainMarkersRef.current.get(key)?.remove();
        trainMarkersRef.current.delete(key);
      }
    }

    // Add or update
    for (const train of trains) {
      if (trainMarkersRef.current.has(train.key)) {
        // Mapbox Marker doesn't support setElement – remove and recreate
        trainMarkersRef.current.get(train.key)!.remove();
        trainMarkersRef.current.delete(train.key);
      }

      const el = createTrainElement(train, train.key === selectedTrainKey);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        handleTrainClick(train);
      });

      const marker = new mapboxgl.Marker({ element: el, anchor: "center" })
        .setLngLat([train.longitude, train.latitude])
        .addTo(map);

      trainMarkersRef.current.set(train.key, marker);
    }
  }, [trains, mapLoaded, selectedTrainKey, handleTrainClick]);

  // ── user location dot ───────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || userLat == null || userLng == null) return;

    if (!userMarkerRef.current) {
      const el = document.createElement("div");
      el.style.cssText = [
        "width:14px",
        "height:14px",
        "border-radius:50%",
        `background:${MARKER_COLOR.userLocation}`,
        "border:2px solid white",
        "box-shadow:0 0 0 4px rgba(66,133,244,0.25)",
      ].join(";");

      userMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: "center" })
        .setLngLat([userLng, userLat])
        .addTo(map);
    } else {
      userMarkerRef.current.setLngLat([userLng, userLat]);
    }
  }, [userLat, userLng]);

  // ── fit-to-trains handler ───────────────────────────────────────────────────
  const handleFitTrains = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    if (trains.length > 0) {
      const lngs = trains.map((t) => t.longitude);
      const lats = trains.map((t) => t.latitude);
      const bounds: [number, number, number, number] = [
        Math.min(...lngs),
        Math.min(...lats),
        Math.max(...lngs),
        Math.max(...lats),
      ];
      map.fitBounds(bounds, { padding: MAP_FIT_PADDING });
    } else {
      map.fitBounds(ALL_STATIONS_BOUNDS, { padding: MAP_FIT_PADDING });
    }
  }, [trains]);

  // ── CSS custom properties for marker theming ────────────────────────────────
  const resolved = resolveTheme(theme);
  const cssVars =
    resolved === "dark"
      ? {
          "--marker-border": "#2a3048",
          "--station-dot-bg": "#2a3048",
          "--station-label-color": "#e0e0e0",
          "--station-label-bg": "rgba(30,35,51,0.88)",
        }
      : {
          "--marker-border": "white",
          "--station-dot-bg": "white",
          "--station-label-color": "#1a1a1a",
          "--station-label-bg": "rgba(255,255,255,0.88)",
        };

  return (
    <div className="relative w-full h-screen overflow-hidden">
      {/* Map container */}
      <div
        ref={mapContainerRef}
        className="absolute inset-0"
        style={cssVars as React.CSSProperties}
      />

      {/* Back button – top-left */}
      <button
        type="button"
        onClick={backToSchedule}
        className="absolute left-3 flex items-center gap-1 px-3 py-2 rounded-xl bg-background/95 backdrop-blur-sm shadow-md border border-border text-sm font-medium"
        style={{ top: "calc(12px + var(--safe-area-top))" }}
        aria-label="Back"
      >
        <ChevronLeft className="w-4 h-4" />
        Back
      </button>

      {/* Train count pill – top-right */}
      <button
        type="button"
        onClick={handleFitTrains}
        className="absolute right-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-background/95 backdrop-blur-sm shadow-md border border-border text-sm font-medium"
        style={{ top: "calc(12px + var(--safe-area-top))" }}
        aria-label="Fit trains"
      >
        <span
          className="inline-block w-2 h-2 rounded-full bg-smart-train-green"
          aria-hidden="true"
        />
        {trains.length} {trains.length === 1 ? "train" : "trains"}
      </button>

      {/* Full trip detail sheet — opens over the map when a marker is tapped.
          Renders nothing until a trip has been resolved. isNextTrip=true so
          the header reads as an active, on-time trip when all displayed
          stops are still in the future (the narrowed view hides past stops,
          which would otherwise flip the header into the neutral "future"
          state). */}
      {detailTrip && (
        <TripDetailSheet
          isOpen={detailOpen}
          onClose={closeDetail}
          trip={detailTrip.trip}
          fromStation={detailTrip.fromStation}
          toStation={detailTrip.toStation}
          currentTime={new Date()}
          lastUpdated={null}
          realtimeStatus={null}
          timeFormat="12h"
          isNextTrip={true}
          showFerry={false}
        />
      )}
    </div>
  );
}
