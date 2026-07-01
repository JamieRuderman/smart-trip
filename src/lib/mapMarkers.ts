import type { MapTrain } from "@/hooks/useMapTrains";
import { FONT_FAMILY } from "@/components/SmartLineDiagram/tokens";
import { TRIP_ICON_PATH } from "@/components/icons/TripIcon";
import { isTrainDelayed } from "@/lib/realtimeConstants";

/** Hex colors mirroring the smart-train-green / smart-gold Tailwind tokens.
 *  Needed because Mapbox marker elements are built with raw inline styles. */
export const MARKER_COLOR = {
  ontime: "#11ab75",
  delayed: "#E48E25",
  canceled: "#888",
  userLocation: "#4285f4",
} as const;

/** Soft halo around the user-location dot. Keep in sync with userLocation. */
export const USER_LOCATION_HALO = "rgba(66,133,244,0.25)";

/** Fallback bearings (degrees from north) used when GTFS-RT omits the vehicle
 *  bearing. Chosen to roughly follow the SMART rail corridor. */
const NORTHBOUND_FALLBACK_BEARING = 340;
const SOUTHBOUND_FALLBACK_BEARING = 160;

export function createStationElement(): HTMLElement {
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

export function createTrainElement(train: MapTrain, selected: boolean): HTMLElement {
  const isDelayed = isTrainDelayed(train);
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
  // Show the human trip number (matches the line-diagram marker) so riders
  // can correlate at a glance. Falls back to the generic train glyph when
  // the vehicle hasn't been matched to a scheduled trip.
  if (train.tripNumber != null) {
    const number = document.createElement("span");
    number.textContent = String(train.tripNumber);
    number.style.cssText = [
      "color:white",
      `font-family:${FONT_FAMILY}`,
      "font-weight:900",
      "font-size:14px",
      "line-height:1",
      "letter-spacing:0.01em",
      "user-select:none",
    ].join(";");
    disc.appendChild(number);
  } else {
    const SVG_NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 512 512");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "white");
    svg.setAttribute("stroke-width", "40");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", TRIP_ICON_PATH);
    svg.appendChild(path);
    disc.appendChild(svg);
  }

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

/**
 * Signature of everything {@link createTrainElement} renders EXCEPT position.
 * Lets the map reuse a marker's DOM across polls and rebuild its inner content
 * only when appearance actually changes (color, heading, number, selection) —
 * a position-only move just calls `marker.setLngLat`, no DOM churn.
 */
export function trainMarkerSignature(
  train: MapTrain,
  selected: boolean,
): string {
  return [
    train.isCanceled,
    isTrainDelayed(train),
    train.bearing ?? "",
    train.directionId ?? "",
    train.tripNumber ?? "",
    selected,
  ].join("|");
}

export function createUserLocationElement(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = [
    "width:14px",
    "height:14px",
    "border-radius:50%",
    `background:${MARKER_COLOR.userLocation}`,
    "border:2px solid white",
    `box-shadow:0 0 0 4px ${USER_LOCATION_HALO}`,
  ].join(";");
  return el;
}
