import { describe, expect, it } from "vitest";
import {
  legFraction,
  resolveLegPosition,
  scheduleStationIndex,
  stopsUntilOrigin,
  vehicleDistanceToStationMi,
  vehicleStationIndex,
} from "./legProgress";
import stations, { STATION_COORDINATES } from "@/data/stations";
import type { Station } from "@/types/smartSchedule";

const idx = (s: Station) => stations.indexOf(s);

/** Point `t` of the way from station a to station b (straight-line lerp). */
function between(a: Station, b: Station, t: number) {
  const A = STATION_COORDINATES[a];
  const B = STATION_COORDINATES[b];
  return {
    latitude: A.lat + (B.lat - A.lat) * t,
    longitude: A.lng + (B.lng - A.lng) * t,
  };
}

describe("vehicleStationIndex", () => {
  it("pins a stopped train exactly on its stop", () => {
    const at = STATION_COORDINATES["Cotati"];
    expect(
      vehicleStationIndex(
        {
          currentStation: "Cotati",
          currentStatus: "STOPPED_AT",
          position: { latitude: at.lat + 0.01, longitude: at.lng },
        },
        true,
      ),
    ).toBe(idx("Cotati"));
  });

  it("places an in-transit southbound train between the previous and next stop", () => {
    const i = vehicleStationIndex(
      {
        currentStation: "Petaluma North",
        currentStatus: "IN_TRANSIT_TO",
        position: between("Cotati", "Petaluma North", 0.5),
      },
      true,
    )!;
    expect(i).toBeGreaterThan(idx("Cotati"));
    expect(i).toBeLessThan(idx("Petaluma North"));
  });

  it("clamps a GPS fix that disagrees with the feed into the reported segment", () => {
    // Fix sits at Novato San Marin, but the feed says the train is still
    // heading to Petaluma Downtown (northbound from Novato San Marin's side
    // would be wrong) — the feed's segment wins.
    const at = STATION_COORDINATES["Novato Downtown"];
    const i = vehicleStationIndex(
      {
        currentStation: "Petaluma Downtown",
        currentStatus: "IN_TRANSIT_TO",
        position: { latitude: at.lat, longitude: at.lng },
      },
      true,
    )!;
    expect(i).toBeGreaterThanOrEqual(idx("Petaluma North"));
    expect(i).toBeLessThanOrEqual(idx("Petaluma Downtown"));
  });

  it("falls back to mid-segment when the fix is off the rail", () => {
    expect(
      vehicleStationIndex(
        {
          currentStation: "San Rafael",
          currentStatus: "IN_TRANSIT_TO",
          position: { latitude: 0, longitude: 0 },
        },
        false,
      ),
    ).toBe((idx("San Rafael") + idx("Larkspur")) / 2);
  });

  it("returns null when the feed names no stop", () => {
    expect(
      vehicleStationIndex(
        {
          currentStation: null,
          currentStatus: "IN_TRANSIT_TO",
          position: { latitude: 38.3, longitude: -122.6 },
        },
        true,
      ),
    ).toBeNull();
  });
});

describe("scheduleStationIndex", () => {
  // Windsor 08:00, then a stop every 5 minutes; Larkspur doesn't stop ("~~").
  const times = [...stations.keys()].map((i) =>
    i === stations.length - 1
      ? "~~"
      : `08:${String(i * 5).padStart(2, "0")}`,
  );

  it("interpolates southbound by clock time", () => {
    // 08:07:30 is halfway between stop 1 (08:05) and stop 2 (08:10).
    expect(scheduleStationIndex(times, true, 8 * 60 + 7.5, 0)).toBeCloseTo(1.5);
  });

  it("shifts by the live delay", () => {
    expect(scheduleStationIndex(times, true, 8 * 60 + 10, 5)).toBeCloseTo(1);
  });

  it("walks northbound in reverse station order", () => {
    // Northbound timetable: the southern terminus (last index) departs first,
    // then a stop every 4 minutes heading north.
    const nbTimes = [...stations.keys()].map((i) =>
      `09:${String((stations.length - 1 - i) * 4).padStart(2, "0")}`,
    );
    // 09:02 is halfway between the southern terminus (09:00) and the next
    // stop north (09:04).
    expect(scheduleStationIndex(nbTimes, false, 9 * 60 + 2, 0)).toBeCloseTo(
      stations.length - 1.5,
    );
  });
});

describe("legFraction", () => {
  it("is 0 at the origin and 1 at the destination, either direction", () => {
    expect(legFraction(idx("Cotati"), "Cotati", "San Rafael")).toBe(0);
    expect(legFraction(idx("San Rafael"), "Cotati", "San Rafael")).toBe(1);
    expect(legFraction(idx("San Rafael"), "San Rafael", "Cotati")).toBe(0);
    expect(legFraction(idx("Cotati"), "San Rafael", "Cotati")).toBe(1);
  });

  it("goes negative upstream of the origin", () => {
    expect(legFraction(idx("Rohnert Park"), "Cotati", "San Rafael")).toBeLessThan(0);
    expect(legFraction(idx("Larkspur"), "San Rafael", "Cotati")).toBeLessThan(0);
  });
});

describe("stopsUntilOrigin", () => {
  it("counts the stop the train is heading to", () => {
    expect(stopsUntilOrigin(idx("Cotati") - 0.5, "Petaluma North", true)).toBe(2);
    expect(stopsUntilOrigin(idx("Cotati"), "Petaluma North", true)).toBe(1);
  });

  it("is 0 at or past the origin", () => {
    expect(stopsUntilOrigin(idx("Petaluma North"), "Petaluma North", true)).toBe(0);
    expect(stopsUntilOrigin(idx("Larkspur"), "Petaluma North", true)).toBe(0);
  });

  it("counts northbound toward lower indices", () => {
    expect(stopsUntilOrigin(idx("Larkspur"), "Novato Hamilton", false)).toBe(3);
  });
});

describe("vehicleDistanceToStationMi", () => {
  it("is ~0 at the station and grows along the line", () => {
    const at = STATION_COORDINATES["Novato Downtown"];
    expect(
      vehicleDistanceToStationMi(
        { position: { latitude: at.lat, longitude: at.lng } },
        "Novato Downtown",
      ),
    ).toBeLessThan(0.1);
    const far = STATION_COORDINATES["Windsor"];
    expect(
      vehicleDistanceToStationMi(
        { position: { latitude: far.lat, longitude: far.lng } },
        "Novato Downtown",
      ),
    ).toBeGreaterThan(20);
  });
});

describe("resolveLegPosition", () => {
  const leg = { fromStation: "Petaluma North", toStation: "San Rafael" } as const;
  const fix = (
    currentStation: Station,
    currentStatus: "STOPPED_AT" | "IN_TRANSIT_TO",
  ) => ({
    currentStation,
    currentStatus,
    // Off-rail fix: forces the feed's stop + status to place the train.
    position: { latitude: 0, longitude: 0 },
  });

  it("is arrived once the rider reached the destination", () => {
    expect(
      resolveLegPosition({
        ...leg,
        vehicle: fix("Cotati", "STOPPED_AT"),
        scheduleIndex: null,
        departed: true,
        arrived: true,
      }),
    ).toEqual({ phase: "arrived" });
  });

  it("counts stops while a live train is upstream of the origin", () => {
    expect(
      resolveLegPosition({
        ...leg,
        vehicle: fix("Rohnert Park", "STOPPED_AT"),
        scheduleIndex: null,
        departed: false,
        arrived: false,
      }),
    ).toEqual({ phase: "approaching", stopsAway: 2 });
  });

  it("is atOrigin when the live train is stopped at the rider's station", () => {
    expect(
      resolveLegPosition({
        ...leg,
        vehicle: fix("Petaluma North", "STOPPED_AT"),
        scheduleIndex: null,
        departed: false,
        arrived: false,
      }),
    ).toEqual({ phase: "atOrigin" });
  });

  it("places a live train on the leg", () => {
    const pos = resolveLegPosition({
      ...leg,
      vehicle: fix("Novato Downtown", "STOPPED_AT"),
      scheduleIndex: null,
      departed: true,
      arrived: false,
    });
    expect(pos).toEqual({
      phase: "enRoute",
      source: "live",
      fraction:
        (idx("Novato Downtown") - idx("Petaluma North")) /
        (idx("San Rafael") - idx("Petaluma North")),
    });
  });

  it("waits for a live fix before the train has departed", () => {
    expect(
      resolveLegPosition({
        ...leg,
        vehicle: null,
        scheduleIndex: idx("Cotati"),
        departed: false,
        arrived: false,
      }),
    ).toEqual({ phase: "waiting" });
  });

  it("falls back to the timetable estimate once departed", () => {
    expect(
      resolveLegPosition({
        ...leg,
        vehicle: null,
        scheduleIndex: idx("Novato San Marin"),
        departed: true,
        arrived: false,
      }),
    ).toMatchObject({ phase: "enRoute", source: "schedule" });
  });
});
