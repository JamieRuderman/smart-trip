import { useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
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

// ─── SVG path for TripIcon ────────────────────────────────────────────────────

const TRIP_ICON_PATH =
  "M185.985 327.015H162.647M326.015 327.015H349.353M162.647 420.368L115.97 490.383M349.353 420.368L396.03 490.383M69.2939 239.496V303.677C69.2939 369.024 120.638 420.368 185.985 420.368H326.015C391.362 420.368 442.706 369.024 442.706 303.677V239.496M69.2939 239.496V210.324C69.2939 160.806 88.9647 113.317 123.979 78.3024C135.618 66.6635 148.635 56.72 162.647 48.6308M69.2939 239.496H162.647M442.706 239.496V210.324C442.706 160.806 423.035 113.317 388.021 78.3024C376.382 66.6635 363.365 56.72 349.353 48.6308M442.706 239.496H349.353M162.647 239.496V48.6308M162.647 239.496H349.353M162.647 48.6308C190.789 32.3844 222.942 23.6174 256 23.6174C289.058 23.6174 321.212 32.3844 349.353 48.6308M349.353 239.496V48.6308";

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
    "border:2px solid #11ab75",
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
    train.delayMinutes >= 3;
  const isCanceled = train.isCanceled;
  const bgColor = isCanceled ? "#888" : isDelayed ? "#E48E25" : "#11ab75";

  const wrapper = document.createElement("div");
  wrapper.style.cssText = [
    "display:flex",
    "flex-direction:column",
    "align-items:center",
    "gap:0",
    "cursor:pointer",
  ].join(";");

  // direction indicator above
  const arrowAbove = document.createElement("div");
  arrowAbove.style.cssText = [
    "width:0",
    "height:0",
    "border-left:5px solid transparent",
    "border-right:5px solid transparent",
    `border-bottom:7px solid ${bgColor}`,
    "visibility:" +
      (train.directionId === 1 ? "visible" : "hidden"),
  ].join(";");

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
  ].join(";");

  circle.innerHTML = `<svg viewBox="0 0 512 512" fill="none" stroke="white" stroke-width="40" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="${TRIP_ICON_PATH}"/></svg>`;

  // direction indicator below
  const arrowBelow = document.createElement("div");
  arrowBelow.style.cssText = [
    "width:0",
    "height:0",
    "border-left:5px solid transparent",
    "border-right:5px solid transparent",
    `border-top:7px solid ${bgColor}`,
    "visibility:" +
      (train.directionId === 0 ? "visible" : "hidden"),
  ].join(";");

  wrapper.appendChild(arrowAbove);
  wrapper.appendChild(circle);
  wrapper.appendChild(arrowBelow);

  return wrapper;
}

function buildPopupHtml(train: MapTrain): string {
  const isDelayed =
    !train.isCanceled &&
    train.delayMinutes !== null &&
    train.delayMinutes >= 3;
  const isCanceled = train.isCanceled;

  let statusHtml: string;
  if (isCanceled) {
    statusHtml = `<span style="background:#888;color:white;padding:1px 7px;border-radius:9999px;font-size:11px;font-weight:600">Canceled</span>`;
  } else if (isDelayed) {
    statusHtml = `<span style="background:#E48E25;color:white;padding:1px 7px;border-radius:9999px;font-size:11px;font-weight:600">${train.delayMinutes}m late</span>`;
  } else {
    statusHtml = `<span style="background:#11ab75;color:white;padding:1px 7px;border-radius:9999px;font-size:11px;font-weight:600">On time</span>`;
  }

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

  // Build the trip query param for the link
  const tripParam = encodeURIComponent(
    JSON.stringify({ tripId: train.tripLabel, startTime: train.startTime })
  );
  const href = `/?trip=${tripParam}`;

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
        <a href="${href}" style="font-size:12px;color:#11ab75;font-weight:600;text-decoration:none">View Trip Details →</a>
      </div>
    </div>
  `;
}

// ─── Map page component ───────────────────────────────────────────────────────

export default function Map() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { trains, lastUpdated: _lastUpdated } = useMapTrains();
  const { lat: userLat, lng: userLng } = useGeolocation({
    watch: true,
    autoRequestOnNative: true,
    autoRequestOnWeb: true,
  });

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  // Station markers (created once)
  const stationMarkersRef = useRef<mapboxgl.Marker[]>([]);

  // Train markers keyed by train.key
  const trainMarkersRef = useRef<globalThis.Map<string, mapboxgl.Marker>>(
    new globalThis.Map()
  );

  // Popup singleton
  const popupRef = useRef<mapboxgl.Popup | null>(null);

  // User-location dot marker
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
          "line-color": "#11ab75",
          "line-width": 3.5,
          "line-opacity": 0.45,
          "line-dasharray": [2, 1],
        },
      });
    }
  }, []);

  // ── helper: add station markers ─────────────────────────────────────────────
  const addStationMarkers = useCallback((map: mapboxgl.Map) => {
    // Remove existing
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
      attributionControl: false,
    });

    map.addControl(
      new mapboxgl.AttributionControl({ compact: true }),
      "bottom-left"
    );

    map.on("load", () => {
      map.fitBounds(ALL_STATIONS_BOUNDS, { padding: MAP_FIT_PADDING, animate: false });
      addRouteLayer(map);
      addStationMarkers(map);
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
  useEffect(() => {
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
    if (!map || !map.isStyleLoaded()) return;

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
      const popup = new mapboxgl.Popup({ offset: 16, closeButton: true, maxWidth: "240px" }).setHTML(
        buildPopupHtml(train)
      );

      el.addEventListener("click", () => {
        popupRef.current?.remove();
        popupRef.current = popup;
        popup.addTo(map);
      });

      const marker = new mapboxgl.Marker({ element: el, anchor: "center" })
        .setLngLat([train.longitude, train.latitude])
        .addTo(map);

      trainMarkersRef.current.set(train.key, marker);
    }
  }, [trains]);

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
        "background:#4285f4",
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
        onClick={() => navigate("/")}
        className="absolute left-3 flex items-center gap-1 px-3 py-2 rounded-xl bg-background/95 backdrop-blur-sm shadow-md border border-border text-sm font-medium"
        style={{ top: "calc(12px + var(--safe-area-top))" }}
        aria-label="Back"
      >
        <ChevronLeft className="w-4 h-4" />
        Back
      </button>

      {/* Train count pill – top-right */}
      <button
        onClick={handleFitTrains}
        className="absolute right-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-background/95 backdrop-blur-sm shadow-md border border-border text-sm font-medium"
        style={{ top: "calc(12px + var(--safe-area-top))" }}
        aria-label="Fit trains"
      >
        <span
          className="inline-block w-2 h-2 rounded-full bg-[#11ab75]"
          aria-hidden="true"
        />
        {trains.length} {trains.length === 1 ? "train" : "trains"}
      </button>
    </div>
  );
}
