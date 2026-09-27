import { describe, expect, it } from "vitest";
import { findRun, type FeedRun, type RunKey } from "@/lib/runMatch";

const RUN: RunKey = {
  tripId: "t_A",
  originStartTime: "08:30",
  serviceDay: "20260609",
  directionId: 1,
};

const find = (entries: FeedRun[], run: RunKey = RUN) => findRun(entries, run, (e) => e);

describe("findRun", () => {
  it("matches by trip id even when the origin time drifted", () => {
    const own = { tripId: "t_A", startTime: "08:31:15", startDate: "20260609", directionId: 1 };
    expect(find([own])).toBe(own);
  });

  it("prefers the trip id over an earlier entry that only shares the origin time", () => {
    const other = { tripId: "t_B", startTime: "08:30:15", startDate: "20260609", directionId: 1 };
    const own = { tripId: "t_A", startTime: "08:31:15", startDate: "20260609", directionId: 1 };
    expect(find([other, own])).toBe(own);
  });

  it("ignores a trip id from another service day", () => {
    const yesterday = { tripId: "t_A", startTime: "09:00:00", startDate: "20260608" };
    expect(find([yesterday])).toBeUndefined();
  });

  it("accepts a trip id when the feed omits the service day", () => {
    expect(find([{ tripId: "t_A", startDate: "" }])).toBeDefined();
    expect(find([{ tripId: "t_A" }])).toBeDefined();
  });

  it("falls back to the origin time when the id is stale or missing", () => {
    const republished = { tripId: "t_Z", startTime: "08:30:15", startDate: "20260609", directionId: 1 };
    expect(find([republished])).toBe(republished);
    expect(find([republished], { ...RUN, tripId: undefined })).toBe(republished);
  });

  it("requires the service day and direction to agree on the origin-time fallback", () => {
    expect(find([{ startTime: "08:30:00", startDate: "20260610", directionId: 1 }])).toBeUndefined();
    expect(find([{ startTime: "08:30:00", startDate: "20260609", directionId: 0 }])).toBeUndefined();
    expect(find([{ startTime: "08:30:00" }])).toBeDefined();
  });

  it("finds nothing for a run with neither an id nor an origin time", () => {
    expect(find([{ tripId: "", startTime: "" }], { serviceDay: "20260609" })).toBeUndefined();
  });

  it("skips entries without a run", () => {
    const own = { trip: { tripId: "t_A" } };
    expect(findRun([{ trip: undefined }, own], RUN, (e) => e.trip)).toBe(own);
  });
});
