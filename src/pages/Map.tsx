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
import { STATION_COORDINATES } from "@/data/stations";
import { useMapTrains, type MapTrain } from "@/hooks/useMapTrains";
import { useTheme } from "@/components/theme-context";
import { useGeolocation } from "@/hooks/useGeolocation";
import { TRIP_ICON_PATH } from "@/components/icons/TripIcon";

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
 *  bearing. Chosen to roughly follow the SMART rail corridor so the arrow
 *  points along the tracks even without real-time heading data. */
const NORTHBOUND_FALLBACK_BEARING = 340;
const SOUTHBOUND_FALLBACK_BEARING = 160;

// ─── helpers ─────────────────────────────────────────────────────────────────

function mpsToMph(mps: number): number {
  return Math.round(mps * 2.237);
}

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

function createTrainElement(train: MapTrain): HTMLElement {
  const isDelayed =
    !train.isCanceled &&
    train.delayMinutes !== null &&
    train.delayMinutes >= DELAY_MINUTES_THRESHOLD;
  const bgColor = train.isCanceled
    ? MARKER_COLOR.canceled
    : isDelayed
      ? MARKER_COLOR.delayed
      : MARKER_COLOR.ontime;

  // Prefer the GTFS-RT bearing (degrees clockwise from north) when available;
  // fall back to a corridor-aligned angle so the arrow points along the tracks.
  const bearing =
    train.bearing != null
      ? train.bearing
      : train.directionId === 1
        ? NORTHBOUND_FALLBACK_BEARING
        : SOUTHBOUND_FALLBACK_BEARING;

  // Flex column with invisible spacers top and bottom keeps the element's
  // layout size at 30×44 so Mapbox anchor:center lands exactly on the circle
  // center (15, 22). This matches the original working layout. The rotating
  // arrow is an absolute overlay that doesn't affect layout dimensions.
  const wrapper = document.createElement("div");
  wrapper.style.cssText = [
    "display:flex",
    "flex-direction:column",
    "align-items:center",
    "gap:0",
    "cursor:pointer",
    "position:relative",
  ].join(";");

  const spacerTop = document.createElement("div");
  spacerTop.style.cssText = "width:10px;height:7px;";

  const circle = document.createElement("div");
  circle.style.cssText = [
    "width:30px",
    "height:30px",
    "border-radius:50%",
    `background:${bgColor}`,
    "border:2px solid var(--marker-border,white)",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "box-shadow:0 2px 6px rgba(0,0,0,0.3)",
    "box-sizing:border-box",
  ].join(";");
  circle.innerHTML = `<svg viewBox="0 0 512 512" fill="none" stroke="white" stroke-width="40" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="${TRIP_ICON_PATH}"/></svg>`;

  const spacerBottom = document.createElement("div");
  spacerBottom.style.cssText = "width:10px;height:7px;";

  // Rotating arrow overlay. Absolute-positioned so it doesn't contribute to
  // the wrapper's layout box. transform-origin defaults to the center of the
  // overlay (= wrapper center), so the arrow orbits the circle.
  const arrowLayer = document.createElement("div");
  arrowLayer.style.cssText = [
    "position:absolute",
    "top:0",
    "left:0",
    "width:100%",
    "height:100%",
    `transform:rotate(${bearing}deg)`,
    "pointer-events:none",
  ].join(";");

  const arrow = document.createElement("div");
  arrow.style.cssText = [
    "position:absolute",
    "top:0",
    "left:50%",
    "margin-left:-5px",
    "width:0",
    "height:0",
    "border-left:5px solid transparent",
    "border-right:5px solid transparent",
    `border-bottom:7px solid ${bgColor}`,
  ].join(";");
  arrowLayer.appendChild(arrow);

  wrapper.appendChild(spacerTop);
  wrapper.appendChild(circle);
  wrapper.appendChild(spacerBottom);
  wrapper.appendChild(arrowLayer);
  return wrapper;
}

function buildPopupHtml(train: MapTrain): string {
  const isDelayed =
    !train.isCanceled &&
    train.delayMinutes !== null &&
    train.delayMinutes >= DELAY_MINUTES_THRESHOLD;

  const pill = (bg: string, text: string) =>
    `<span style="background:${bg};color:white;padding:1px 7px;border-radius:9999px;font-size:11px;font-weight:600">${text}</span>`;

  const statusHtml = train.isCanceled
    ? pill(MARKER_COLOR.canceled, "Canceled")
    : isDelayed
      ? pill(MARKER_COLOR.delayed, `${train.delayMinutes}m late`)
      : pill(MARKER_COLOR.ontime, "On time");

  const directionLabel =
    train.directionId === 1
      ? "Northbound"
      : train.directionId === 0
        ? "Southbound"
        : "";

  const speedHtml =
    train.speed !== null && train.speed > 0
      ? `<div style="font-size:12px;color:#666;margin-top:3px">${mpsToMph(train.speed)} mph</div>`
      : "";

  const nextStopHtml = train.nextStation
    ? `<div style="font-size:12px;color:#444;margin-top:3px">Next: <strong>${train.nextStation}</strong></div>`
    : "";

  return `
    <div style="min-width:160px;padding:4px 2px">
      <div style="font-weight:700;font-size:13px;margin-bottom:5px">Train ${train.tripLabel ?? train.vehicleId}</div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        ${statusHtml}
        ${directionLabel ? `<span style="font-size:11px;color:#555">${directionLabel}</span>` : ""}
      </div>
      ${speedHtml}
      ${nextStopHtml}
      <div style="margin-top:8px">
        <a href="/" style="font-size:12px;color:${MARKER_COLOR.ontime};font-weight:600;text-decoration:none">View Schedule →</a>
      </div>
    </div>
  `;
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
  // Singleton — only one popup open at a time.
  const popupRef = useRef<mapboxgl.Popup | null>(null);
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
      popupRef.current?.remove();
      popupRef.current = null;
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

      const el = createTrainElement(train);
      const popup = new mapboxgl.Popup({ offset: 16, closeButton: true, maxWidth: "240px" })
        .setHTML(buildPopupHtml(train));

      // Close any other open popup when this one opens
      popup.on("open", () => {
        if (popupRef.current && popupRef.current !== popup) {
          popupRef.current.remove();
        }
        popupRef.current = popup;
      });

      const marker = new mapboxgl.Marker({ element: el, anchor: "center" })
        .setLngLat([train.longitude, train.latitude])
        .setPopup(popup)
        .addTo(map);

      trainMarkersRef.current.set(train.key, marker);
    }
  }, [trains, mapLoaded]);

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

  // ── intercept callout <a href="/?trip=..."> clicks ──────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;

      const href = anchor.getAttribute("href") ?? "";
      if (href.startsWith("/?trip=") || href.startsWith("?trip=")) {
        e.preventDefault();
        navigate(href);
      }
    };

    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [navigate]);

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
    </div>
  );
}
