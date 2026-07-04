import { describe, expect, it } from "vitest";

import {
  DIAGRAM_STATIONS,
  DOUBLE_TRACK_SEGMENTS,
} from "@/data/smartLineLayout";
import { STATION_ORDER } from "@/data/generated/stations.generated";

describe("smartLineLayout drift guard", () => {
  // The SVG diagram is hand-drawn — its X/Y coordinates are visual layout, not
  // transit data. But the station list it enumerates must match the GTFS-
  // derived `STATION_ORDER` so the diagram doesn't quietly drift if 511 ever
  // adds, removes, or renames a SMART station. If this test fails, refresh
  // the SVG layout in `smartLineLayout.ts` instead of editing this assertion.
  it("DIAGRAM_STATIONS matches GTFS-derived STATION_ORDER", () => {
    expect(DIAGRAM_STATIONS.map((s) => s.station)).toEqual([...STATION_ORDER]);
  });

  it("keeps double-track segments ordered and within the corridor", () => {
    expect(DOUBLE_TRACK_SEGMENTS).toHaveLength(7);
    for (const [index, segment] of DOUBLE_TRACK_SEGMENTS.entries()) {
      expect(segment.northProgress).toBeGreaterThanOrEqual(0);
      expect(segment.southProgress).toBeLessThanOrEqual(
        DIAGRAM_STATIONS.length - 1,
      );
      expect(segment.southProgress).toBeGreaterThan(segment.northProgress);
      if (index > 0) {
        expect(segment.northProgress).toBeGreaterThan(
          DOUBLE_TRACK_SEGMENTS[index - 1].southProgress,
        );
      }
    }
  });
});
