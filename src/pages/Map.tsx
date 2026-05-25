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
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { OfflineBanner } from "@/components/OfflineBanner";
import { MapLiveDataChip } from "@/components/MapLiveDataChip";
import { useTheme } from "@/components/theme-context";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useAllRealtimeStatusMaps } from "@/hooks/useAllRealtimeStatusMaps";
import { TripDetailSheet } from "@/components/TripDetailSheet";
import { findFullCorridorTrip } from "@/lib/scheduleUtils";
import { stationIndexMap } from "@/lib/stationUtils";
import { pickDisplayFromStation } from "@/lib/pickDisplayFromStation";
import { useStationSelection } from "@/contexts/stationSelection";
import { SHEET_ENTER_DELAY_MS, SHEET_TRANSITION_MS } from "@/lib/animationConstants";
import {
  MARKER_COLOR,
  createStationElement,
  createTrainElement,
  createUserLocationElement,
} from "@/lib/mapMarkers";
import type { ProcessedTrip } from "@/lib/scheduleUtils";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import type { Station } from "@/types/smartSchedule";

const WINDSOR = stations[0];
const LARKSPUR = stations[stations.length - 1];

// ─── helpers ─────────────────────────────────────────────────────────────────

function resolveTheme(theme: "dark" | "light" | "system"): "dark" | "light" {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

// ─── Map page component ───────────────────────────────────────────────────────

/** Navigate back to the schedule, preferring history-back so query params
 *  and scroll position are preserved. Falls back to a direct navigate when
 *  the user landed on /map via a direct link. */
function useBackToSchedule(): () => void {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate({ pathname: "/", search: location.search });
    }
  }, [navigate, location.search]);
}

/** Thin wrapper that swaps in a configuration-help screen when the Mapbox
 *  token is missing. Keeps MapContents' hooks out of a conditional branch. */
export default function Map() {
  const backToSchedule = useBackToSchedule();
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
  return <MapContents />;
}

function MapContents() {
  const backToSchedule = useBackToSchedule();
  const { theme } = useTheme();
  const { trains, lastUpdated } = useMapTrains();
  const isOnline = useOnlineStatus();
  // The user's currently-selected schedule leg comes from the shared
  // StationSelectionContext. Used only to mark matching rows in the trip
  // detail sheet — does not affect what's drawn on the map itself.
  const { fromStation: userFromSelection, toStation: userToSelection } =
    useStationSelection();
  const userFromStation =
    userFromSelection && stationIndexMap[userFromSelection] != null
      ? userFromSelection
      : null;
  const userToStation =
    userToSelection && stationIndexMap[userToSelection] != null
      ? userToSelection
      : null;
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
    realtimeStatus: TripRealtimeStatus | null;
  } | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const { sb: sbStatusMaps, nb: nbStatusMaps } = useAllRealtimeStatusMaps();

  const handleTrainClick = useCallback((train: MapTrain) => {
    setSelectedTrainKey(train.key);

    if (
      train.tripNumber == null ||
      train.directionId == null ||
      train.startTime == null
    ) {
      return;
    }

    const isSouthbound = train.directionId === 0;
    const terminus = isSouthbound ? LARKSPUR : WINDSOR;
    const match = findFullCorridorTrip(
      train.directionId,
      train.startTime,
      train.tripNumber,
    );
    if (!match) return;

    const displayFrom = pickDisplayFromStation(train, isSouthbound);
    // Override from/to so StopTimeline slices `times` to only upcoming stops;
    // keep match's full-corridor departure/arrival times so the header still
    // reads as the trip's origin → terminus (e.g. "11:31 AM → 12:55 PM"
    // rather than a narrowed leg's times).
    const displayTrip: ProcessedTrip = {
      ...match,
      fromStation: displayFrom,
      toStation: terminus,
    };
    // Pull live delay/cancellation state for this specific run. The status
    // map is keyed by scheduled departure at the full-corridor origin, which
    // is exactly match.departureTime here.
    const statusMaps = isSouthbound ? sbStatusMaps : nbStatusMaps;
    const realtimeStatus =
      statusMaps.statusMap.get(match.departureTime) ?? null;
    setDetailTrip({
      trip: displayTrip,
      fromStation: displayFrom,
      toStation: terminus,
      realtimeStatus,
    });
  }, [sbStatusMaps, nbStatusMaps]);

  useEffect(() => {
    if (detailTrip) {
      const id = window.setTimeout(
        () => setDetailOpen(true),
        SHEET_ENTER_DELAY_MS,
      );
      return () => window.clearTimeout(id);
    } else {
      setDetailOpen(false);
    }
  }, [detailTrip]);

  // Tracked so we can cancel the deferred unmount if the sheet re-opens
  // mid-transition or the page unmounts.
  const closeTimerRef = useRef<number | null>(null);
  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      setDetailTrip(null);
      setSelectedTrainKey(null);
      closeTimerRef.current = null;
    }, SHEET_TRANSITION_MS);
  }, []);
  useEffect(
    () => () => {
      if (closeTimerRef.current != null) {
        window.clearTimeout(closeTimerRef.current);
      }
    },
    [],
  );

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

    // Capture the train-marker Map object so cleanup uses the same reference
    // React hooks saw at effect time (the ref is populated by other effects).
    const trainMarkers = trainMarkersRef.current;

    return () => {
      // clean up markers
      stationMarkersRef.current.forEach((m) => m.remove());
      stationMarkersRef.current = [];
      trainMarkers.forEach((m) => m.remove());
      trainMarkers.clear();
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
      const el = createUserLocationElement();
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
      {/* Map container — leave room for the Android nav bar so the map and
          Mapbox attribution don't render behind it. --safe-area-bottom is 0
          on iOS so the map still reaches the screen edge there. */}
      <div
        ref={mapContainerRef}
        className="absolute inset-x-0 top-0"
        style={{
          ...(cssVars as React.CSSProperties),
          bottom: "var(--safe-area-bottom)",
        }}
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

      {/* Live-data freshness chip — beneath the train-count pill. Color and
          copy mirror ScheduleHeader so the same "stale" mental model carries
          over to the map. Only renders when we have a feed timestamp. */}
      <MapLiveDataChip lastUpdated={lastUpdated} />

      {/* Offline banner overlay — only renders when offline */}
      {!isOnline && (
        <div
          className="absolute left-1/2 -translate-x-1/2 max-w-md w-[calc(100%-1.5rem)] px-3"
          style={{ top: "calc(60px + var(--safe-area-top))" }}
        >
          <OfflineBanner />
        </div>
      )}

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
          lastUpdated={sbStatusMaps.lastUpdated ?? nbStatusMaps.lastUpdated}
          realtimeStatus={detailTrip.realtimeStatus}
          timeFormat="12h"
          isNextTrip={true}
          showFerry={false}
          userFromStation={userFromStation}
          userToStation={userToStation}
        />
      )}
    </div>
  );
}
