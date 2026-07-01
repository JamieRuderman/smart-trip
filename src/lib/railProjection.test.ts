import { describe, expect, it } from "vitest";
import {
  corridorDistanceKm,
  railArcToStationIndex,
  snapToRail,
  STATION_RAIL_ARC_KM,
} from "./railProjection";
import stations, { STATION_COORDINATES } from "@/data/stations";
import { haversineKm } from "@/lib/stationUtils";

const lastIdx = STATION_RAIL_ARC_KM.length - 1;

describe("snapToRail", () => {
  it("returns null for non-finite input", () => {
    expect(snapToRail(NaN, -122.7)).toBeNull();
    expect(snapToRail(38.4, Infinity)).toBeNull();
  });

  it("snaps a real station coordinate onto the rail with a small residual", () => {
    const mid = stations[Math.floor(stations.length / 2)];
    const c = STATION_COORDINATES[mid];
    const snap = snapToRail(c.lat, c.lng);
    expect(snap).not.toBeNull();
    // Stations sit essentially on the line — well within the along-track band.
    expect(snap!.residualKm).toBeLessThan(0.5);
    // And its arc matches the precomputed per-station arc.
    expect(snap!.arcKm).toBeCloseTo(STATION_RAIL_ARC_KM[stations.indexOf(mid)], 1);
  });
});

describe("railArcToStationIndex", () => {
  it("clamps north of the first station to index 0", () => {
    expect(railArcToStationIndex(STATION_RAIL_ARC_KM[0] + 10)).toBe(0);
  });

  it("clamps south of the last station to the last index", () => {
    expect(railArcToStationIndex(STATION_RAIL_ARC_KM[lastIdx] - 10)).toBe(lastIdx);
  });

  it("maps a station's own arc back to (approximately) its index", () => {
    expect(railArcToStationIndex(STATION_RAIL_ARC_KM[2])).toBeCloseTo(2, 5);
  });

  it("returns a fractional index between two stations", () => {
    const mid = (STATION_RAIL_ARC_KM[1] + STATION_RAIL_ARC_KM[2]) / 2;
    const idx = railArcToStationIndex(mid);
    expect(idx).toBeGreaterThan(1);
    expect(idx).toBeLessThan(2);
    expect(idx).toBeCloseTo(1.5, 5);
  });
});

describe("corridorDistanceKm", () => {
  it("uses along-track distance for two on-corridor stations", () => {
    const a = STATION_COORDINATES[stations[0]];
    const b = STATION_COORDINATES[stations[3]];
    const expectedArc = Math.abs(
      STATION_RAIL_ARC_KM[0] - STATION_RAIL_ARC_KM[3],
    );
    expect(corridorDistanceKm(a.lat, a.lng, b.lat, b.lng)).toBeCloseTo(
      expectedArc,
      1,
    );
  });

  it("falls back to haversine when a point is far off the corridor", () => {
    const a = STATION_COORDINATES[stations[0]];
    // ~111 km due east — nowhere near the rail.
    const offLat = a.lat;
    const offLng = a.lng + 1;
    const d = corridorDistanceKm(a.lat, a.lng, offLat, offLng);
    expect(d).toBeCloseTo(haversineKm(a.lat, a.lng, offLat, offLng), 5);
  });
});
