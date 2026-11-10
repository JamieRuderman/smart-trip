import { describe, expect, it } from "vitest";

import { STATION_ORDER } from "@/data/generated/stations.generated";
import { SAN_FRANCISCO } from "@/lib/places";
import { ROUTE_PAIRS, SF_ROUTE_STATIONS, TOP_ROUTE_PAIRS } from "./routes";

const has = (from: string, to: string) =>
  ROUTE_PAIRS.some(([a, b]) => a === from && b === to);

describe("ROUTE_PAIRS", () => {
  it("builds every top trip both ways", () => {
    for (const [from, to] of TOP_ROUTE_PAIRS) {
      expect(has(from, to)).toBe(true);
      expect(has(to, from)).toBe(true);
    }
  });

  it("builds each station to its neighbors, which the station pages link to", () => {
    STATION_ORDER.slice(1).forEach((station, i) => {
      expect(has(STATION_ORDER[i], station)).toBe(true);
      expect(has(station, STATION_ORDER[i])).toBe(true);
    });
  });

  it("builds the San Francisco ferry trips", () => {
    for (const station of SF_ROUTE_STATIONS) {
      expect(has(SAN_FRANCISCO, station)).toBe(true);
      expect(has(station, SAN_FRANCISCO)).toBe(true);
    }
  });

  it("lists each trip once", () => {
    const keys = ROUTE_PAIRS.map((pair) => pair.join("|"));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
