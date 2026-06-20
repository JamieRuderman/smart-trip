import { describe, it, expect } from "vitest";
import {
  computeLiveTripStatus,
  decidePushAction,
  type FeedTripUpdate,
} from "./_liveActivityStatus.js";
import type { LiveActivityRegistration } from "../src/lib/liveActivityPushTypes.js";

// Real SMART platform stop_ids from the generated map: Larkspur northbound =
// "71011", San Rafael northbound = "71021". Using northbound platforms so they
// resolve against a northbound registration.
const FROM_STOP = "71011"; // Larkspur / northbound
const TO_STOP = "71021"; // San Rafael / northbound

const SCHED_DEP_MS = Date.parse("2026-06-09T08:30:00-07:00");
const SCHED_ARR_MS = Date.parse("2026-06-09T08:50:00-07:00");

const REG: LiveActivityRegistration = {
  id: "trip-7-2026-06-09",
  tripNumber: 7,
  serviceDate: "2026-06-09",
  fromStation: "Larkspur",
  toStation: "San Rafael",
  direction: "northbound",
  scheduledDeparture: "08:30",
  scheduledArrival: "08:50",
  departureEpochMs: SCHED_DEP_MS,
  arrivalEpochMs: SCHED_ARR_MS,
};

function feed(opts: {
  depUnix: number;
  arrUnix?: number;
  canceled?: boolean;
}): FeedTripUpdate[] {
  return [
    {
      scheduleRelationship: opts.canceled ? "CANCELED" : "SCHEDULED",
      stopTimeUpdates: [
        { stopId: FROM_STOP, departureTime: opts.depUnix },
        ...(opts.arrUnix != null
          ? [{ stopId: TO_STOP, arrivalTime: opts.arrUnix }]
          : []),
      ],
    },
  ];
}

describe("computeLiveTripStatus", () => {
  it("returns on-time status (delay 0) when live matches scheduled", () => {
    const status = computeLiveTripStatus({
      reg: REG,
      updates: feed({ depUnix: SCHED_DEP_MS / 1000, arrUnix: SCHED_ARR_MS / 1000 }),
      now: SCHED_DEP_MS - 60_000,
    });
    expect(status).not.toBeNull();
    expect(status!.delayMinutes).toBe(0);
    expect(status!.departureEpochMs).toBe(SCHED_DEP_MS);
    expect(status!.isEnded).toBe(false);
  });

  it("computes a delay and shifts both targets when the live departure is late", () => {
    const lateDep = SCHED_DEP_MS / 1000 + 5 * 60; // +5 min
    const lateArr = SCHED_ARR_MS / 1000 + 5 * 60;
    const status = computeLiveTripStatus({
      reg: REG,
      updates: feed({ depUnix: lateDep, arrUnix: lateArr }),
      now: SCHED_DEP_MS,
    });
    expect(status!.delayMinutes).toBe(5);
    expect(status!.departureEpochMs).toBe(SCHED_DEP_MS + 5 * 60_000);
    expect(status!.arrivalEpochMs).toBe(lateArr * 1000);
  });

  it("falls back to scheduled-arrival + delay when the feed omits arrival", () => {
    const lateDep = SCHED_DEP_MS / 1000 + 3 * 60;
    const status = computeLiveTripStatus({
      reg: REG,
      updates: feed({ depUnix: lateDep }),
      now: SCHED_DEP_MS,
    });
    expect(status!.arrivalEpochMs).toBe(SCHED_ARR_MS + 3 * 60_000);
  });

  it("does not count an early live departure as negative delay", () => {
    const earlyDep = SCHED_DEP_MS / 1000 - 2 * 60;
    const status = computeLiveTripStatus({
      reg: REG,
      updates: feed({ depUnix: earlyDep }),
      now: SCHED_DEP_MS - 5 * 60_000,
    });
    expect(status!.delayMinutes).toBe(0);
    expect(status!.departureEpochMs).toBe(SCHED_DEP_MS);
  });

  it("flags cancellation", () => {
    const status = computeLiveTripStatus({
      reg: REG,
      updates: feed({ depUnix: SCHED_DEP_MS / 1000, canceled: true }),
      now: SCHED_DEP_MS,
    });
    expect(status!.isCanceled).toBe(true);
  });

  it("marks ended once now is past live arrival", () => {
    const status = computeLiveTripStatus({
      reg: REG,
      updates: feed({ depUnix: SCHED_DEP_MS / 1000, arrUnix: SCHED_ARR_MS / 1000 }),
      now: SCHED_ARR_MS + 1000,
    });
    expect(status!.isEnded).toBe(true);
  });

  it("returns null when no update resolves to the boarding station/direction", () => {
    const wrongDirection: FeedTripUpdate[] = [
      { stopTimeUpdates: [{ stopId: "71012", departureTime: SCHED_DEP_MS / 1000 }] }, // Larkspur SOUTHbound
    ];
    expect(
      computeLiveTripStatus({ reg: REG, updates: wrongDirection, now: SCHED_DEP_MS }),
    ).toBeNull();
  });

  it("ignores a departure far outside the match window", () => {
    const farOff = SCHED_DEP_MS / 1000 + 4 * 60 * 60; // +4h
    expect(
      computeLiveTripStatus({ reg: REG, updates: feed({ depUnix: farOff }), now: SCHED_DEP_MS }),
    ).toBeNull();
  });

  describe("en-route after the boarding stop is pruned", () => {
    // 511 drops a stop from the feed once the train departs it, so an en-route
    // trip has no boarding stop_time_update — only its remaining (destination)
    // stops and the trip-level startTime. Identify by originStartTime + derive
    // from the destination so the locked-screen countdown still corrects.
    const regWithOrigin = { ...REG, originStartTime: "08:10" };
    const destinationOnly = (arrUnix: number): FeedTripUpdate[] => [
      {
        scheduleRelationship: "SCHEDULED",
        startTime: "08:10:00",
        stopTimeUpdates: [{ stopId: TO_STOP, arrivalTime: arrUnix }],
      },
    ];

    it("corrects from the destination arrival (on time) when boarding is gone", () => {
      const status = computeLiveTripStatus({
        reg: regWithOrigin,
        updates: destinationOnly(SCHED_ARR_MS / 1000),
        now: SCHED_DEP_MS + 5 * 60_000, // departed, en route
      });
      expect(status).not.toBeNull();
      expect(status!.delayMinutes).toBe(0);
      expect(status!.arrivalEpochMs).toBe(SCHED_ARR_MS);
      expect(status!.departureEpochMs).toBe(SCHED_DEP_MS);
      expect(status!.isEnded).toBe(false);
    });

    it("derives the delay from a late destination arrival", () => {
      const lateArr = SCHED_ARR_MS / 1000 + 6 * 60; // +6 min
      const status = computeLiveTripStatus({
        reg: regWithOrigin,
        updates: destinationOnly(lateArr),
        now: SCHED_DEP_MS + 5 * 60_000,
      });
      expect(status!.delayMinutes).toBe(6);
      expect(status!.arrivalEpochMs).toBe(lateArr * 1000);
      expect(status!.departureEpochMs).toBe(SCHED_DEP_MS + 6 * 60_000);
    });

    it("marks ended from the destination arrival", () => {
      const status = computeLiveTripStatus({
        reg: regWithOrigin,
        updates: destinationOnly(SCHED_ARR_MS / 1000),
        now: SCHED_ARR_MS + 1000,
      });
      expect(status!.isEnded).toBe(true);
    });

    it("still null when neither boarding nor destination stop is present (scheduled)", () => {
      expect(
        computeLiveTripStatus({
          reg: regWithOrigin,
          updates: [
            { scheduleRelationship: "SCHEDULED", startTime: "08:10:00", stopTimeUpdates: [] },
          ],
          now: SCHED_DEP_MS + 5 * 60_000,
        }),
      ).toBeNull();
    });

    it("prefers the precise boarding match when that stop is still present", () => {
      // +5 min boarding delay present → path 1 wins; arrival follows boarding.
      const lateDep = SCHED_DEP_MS / 1000 + 5 * 60;
      const status = computeLiveTripStatus({
        reg: regWithOrigin,
        updates: feed({ depUnix: lateDep }),
        now: SCHED_DEP_MS,
      });
      expect(status!.delayMinutes).toBe(5);
      expect(status!.arrivalEpochMs).toBe(SCHED_ARR_MS + 5 * 60_000);
    });
  });

  describe("cancelled-without-stop-updates fallback", () => {
    const CANCELED_NO_STOPS: FeedTripUpdate[] = [
      { scheduleRelationship: "CANCELED", startTime: "08:10:00", stopTimeUpdates: [] },
    ];
    const regWithOrigin = { ...REG, originStartTime: "08:10" };

    it("flags cancellation by origin start time when stop updates are gone", () => {
      const status = computeLiveTripStatus({
        reg: regWithOrigin,
        updates: CANCELED_NO_STOPS,
        now: SCHED_DEP_MS - 60_000,
      });
      expect(status).not.toBeNull();
      expect(status!.isCanceled).toBe(true);
      // No stop data → no delay to derive; scheduled targets stand.
      expect(status!.delayMinutes).toBe(0);
      expect(status!.departureEpochMs).toBe(SCHED_DEP_MS);
      expect(status!.arrivalEpochMs).toBe(SCHED_ARR_MS);
    });

    it("does not fire without originStartTime on the registration", () => {
      expect(
        computeLiveTripStatus({
          reg: REG,
          updates: CANCELED_NO_STOPS,
          now: SCHED_DEP_MS,
        }),
      ).toBeNull();
    });

    it("does not match a non-cancelled update or a different start time", () => {
      expect(
        computeLiveTripStatus({
          reg: regWithOrigin,
          updates: [{ scheduleRelationship: "SCHEDULED", startTime: "08:10:00", stopTimeUpdates: [] }],
          now: SCHED_DEP_MS,
        }),
      ).toBeNull();
      expect(
        computeLiveTripStatus({
          reg: regWithOrigin,
          updates: [{ scheduleRelationship: "CANCELED", startTime: "09:10:00", stopTimeUpdates: [] }],
          now: SCHED_DEP_MS,
        }),
      ).toBeNull();
    });
  });
});

describe("decidePushAction", () => {
  const base = {
    departureEpochMs: SCHED_DEP_MS,
    arrivalEpochMs: SCHED_ARR_MS,
    delayMinutes: 0,
    isCanceled: false,
    isEnded: false,
  };

  it("pushes update when there is no prior send", () => {
    const { action, phase } = decidePushAction({
      status: base,
      lastSent: null,
      now: SCHED_DEP_MS - 60_000,
    });
    expect(action).toBe("update");
    expect(phase).toBe("pre-departure");
  });

  it("skips when delay + phase are unchanged", () => {
    const { action } = decidePushAction({
      status: base,
      lastSent: { delayMinutes: 0, phase: "pre-departure", isEnded: false },
      now: SCHED_DEP_MS - 60_000,
    });
    expect(action).toBe("none");
  });

  it("pushes update when the delay changed", () => {
    const { action } = decidePushAction({
      status: { ...base, delayMinutes: 4 },
      lastSent: { delayMinutes: 0, phase: "pre-departure", isEnded: false },
      now: SCHED_DEP_MS - 60_000,
    });
    expect(action).toBe("update");
  });

  it("pushes update on the departure→arrival phase flip even at the same delay", () => {
    const { action, phase } = decidePushAction({
      status: base,
      lastSent: { delayMinutes: 0, phase: "pre-departure", isEnded: false },
      now: SCHED_DEP_MS + 1000,
    });
    expect(phase).toBe("en-route");
    expect(action).toBe("update");
  });

  it("pushes update when cancellation flips even at the same delay + phase", () => {
    const lastSent = {
      delayMinutes: 0,
      phase: "pre-departure" as const,
      isEnded: false,
      isCanceled: false,
    };
    expect(
      decidePushAction({
        status: { ...base, isCanceled: true },
        lastSent,
        now: SCHED_DEP_MS - 60_000,
      }).action,
    ).toBe("update");
    // …and once the cancelled state was sent, it goes quiet again.
    expect(
      decidePushAction({
        status: { ...base, isCanceled: true },
        lastSent: { ...lastSent, isCanceled: true },
        now: SCHED_DEP_MS - 60_000,
      }).action,
    ).toBe("none");
  });

  it("treats a legacy lastSent without isCanceled as not-cancelled", () => {
    expect(
      decidePushAction({
        status: { ...base, isCanceled: true },
        lastSent: { delayMinutes: 0, phase: "pre-departure", isEnded: false },
        now: SCHED_DEP_MS - 60_000,
      }).action,
    ).toBe("update");
  });

  it("ends once when arrived, then goes quiet", () => {
    const ended = { ...base, isEnded: true };
    expect(
      decidePushAction({ status: ended, lastSent: null, now: SCHED_ARR_MS + 1000 }).action,
    ).toBe("end");
    expect(
      decidePushAction({
        status: ended,
        lastSent: { delayMinutes: 0, phase: "en-route", isEnded: true },
        now: SCHED_ARR_MS + 1000,
      }).action,
    ).toBe("none");
  });
});
