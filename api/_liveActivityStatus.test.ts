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

  it("reports the arrival delay when the departure is on time but the trip slips en route", () => {
    // Boarding still present and on time; the destination's live arrival is
    // 8 min late. The pill must read "Delayed" in step with the in-app card
    // (client effectiveDelayMinutes: departure delay, else arrival delay).
    const status = computeLiveTripStatus({
      reg: REG,
      updates: feed({
        depUnix: SCHED_DEP_MS / 1000,
        arrUnix: SCHED_ARR_MS / 1000 + 8 * 60,
      }),
      now: SCHED_DEP_MS,
    });
    expect(status!.delayMinutes).toBe(8);
    expect(status!.departureEpochMs).toBe(SCHED_DEP_MS);
    expect(status!.arrivalEpochMs).toBe(SCHED_ARR_MS + 8 * 60_000);
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

  it("treats a sub-minute live slip as on-time (matches the client threshold)", () => {
    // 40 s late: the client floors anything under a minute to on-time, so the
    // push backend must too — otherwise Math.round(40s) => 1 and the Live
    // Activity shows "Delayed" while the in-app card reads "On time".
    const slip = SCHED_DEP_MS / 1000 + 40;
    const status = computeLiveTripStatus({
      reg: REG,
      updates: feed({ depUnix: slip, arrUnix: SCHED_ARR_MS / 1000 + 40 }),
      now: SCHED_DEP_MS - 30 * 60_000,
    });
    expect(status!.delayMinutes).toBe(0);
    // Countdown target stays on the scheduled departure, not the +40 s jitter.
    expect(status!.departureEpochMs).toBe(SCHED_DEP_MS);
  });

  it("reports a delay once the slip reaches the one-minute threshold", () => {
    const lateDep = SCHED_DEP_MS / 1000 + 65; // 1:05 late
    const status = computeLiveTripStatus({
      reg: REG,
      updates: feed({ depUnix: lateDep }),
      now: SCHED_DEP_MS - 5 * 60_000,
    });
    expect(status!.delayMinutes).toBe(1);
    expect(status!.departureEpochMs).toBe(SCHED_DEP_MS + 65_000);
  });

  it("treats a sub-minute en-route arrival slip as on-time after boarding is pruned", () => {
    // Boarding stop gone (en route); destination arrival is 45 s past schedule.
    const status = computeLiveTripStatus({
      reg: { ...REG, originStartTime: "08:10" },
      updates: [
        {
          scheduleRelationship: "SCHEDULED",
          startTime: "08:10:00",
          stopTimeUpdates: [{ stopId: TO_STOP, arrivalTime: SCHED_ARR_MS / 1000 + 45 }],
        },
      ],
      now: SCHED_DEP_MS + 60_000,
    });
    expect(status!.delayMinutes).toBe(0);
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

    it("uses the boarding delay within the identified run when that stop is present", () => {
      // Boarding still present (pre-/at-departure): the live departure gives the
      // precise +5 delay, and arrival follows it.
      const lateDep = SCHED_DEP_MS / 1000 + 5 * 60;
      const status = computeLiveTripStatus({
        reg: regWithOrigin,
        updates: [
          {
            scheduleRelationship: "SCHEDULED",
            startTime: "08:10:00",
            stopTimeUpdates: [{ stopId: FROM_STOP, departureTime: lateDep }],
          },
        ],
        now: SCHED_DEP_MS,
      });
      expect(status!.delayMinutes).toBe(5);
      expect(status!.arrivalEpochMs).toBe(SCHED_ARR_MS + 5 * 60_000);
    });

    it("identifies by origin time, not a different run sharing the boarding station", () => {
      // The correct run (08:10) has only its destination left; a LATER run still
      // lists the boarding station within the 2h window. Identity must win — the
      // delay comes from the correct run's destination (+2), not the wrong run's
      // boarding (+60). This is the bug that produced a bogus 65-min delay.
      const updates: FeedTripUpdate[] = [
        {
          scheduleRelationship: "SCHEDULED",
          startTime: "08:10:00",
          stopTimeUpdates: [{ stopId: TO_STOP, arrivalTime: SCHED_ARR_MS / 1000 + 2 * 60 }],
        },
        {
          scheduleRelationship: "SCHEDULED",
          startTime: "09:40:00",
          stopTimeUpdates: [{ stopId: FROM_STOP, departureTime: SCHED_DEP_MS / 1000 + 60 * 60 }],
        },
      ];
      const status = computeLiveTripStatus({
        reg: regWithOrigin,
        updates,
        now: SCHED_DEP_MS + 5 * 60_000,
      });
      expect(status!.delayMinutes).toBe(2);
      expect(status!.arrivalEpochMs).toBe(SCHED_ARR_MS + 2 * 60_000);
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

  describe("finished-run fallback (pruned from the feed after arrival)", () => {
    // 511 drops a run from the feed once it completes — exactly when an `end`
    // could no longer be matched — so a past-arrival run that's gone is treated
    // as finished and ended, instead of leaving the countdown stuck at 0:00.
    const regWithOrigin = { ...REG, originStartTime: "08:10" };
    // The run's startTime no longer appears (only an unrelated later run does).
    const otherRun: FeedTripUpdate[] = [
      { scheduleRelationship: "SCHEDULED", startTime: "09:40:00", stopTimeUpdates: [] },
    ];

    it("ends as soon as arrival is reached and the run is gone", () => {
      const status = computeLiveTripStatus({
        reg: regWithOrigin,
        updates: otherRun,
        now: SCHED_ARR_MS,
      });
      expect(status).not.toBeNull();
      expect(status!.isEnded).toBe(true);
      expect(status!.arrivalEpochMs).toBe(SCHED_ARR_MS);
    });

    it("does not end before arrival when the run is gone", () => {
      expect(
        computeLiveTripStatus({
          reg: regWithOrigin,
          updates: otherRun,
          now: SCHED_ARR_MS - 1,
        }),
      ).toBeNull();
    });

    it("ends a no-origin registration too once arrival is past and unmatched", () => {
      expect(
        computeLiveTripStatus({
          reg: REG, // no originStartTime → boarding-stop matching finds nothing
          updates: [],
          now: SCHED_ARR_MS,
        })!.isEnded,
      ).toBe(true);
    });

    it("does NOT end a late train still present in the feed past scheduled arrival", () => {
      // Past the SCHEDULED arrival, but the run still carries a live (later)
      // destination arrival, so it's matched and stays en route — never ended
      // early by the fallback.
      const lateArr = SCHED_ARR_MS / 1000 + 8 * 60;
      const status = computeLiveTripStatus({
        reg: regWithOrigin,
        updates: [
          {
            scheduleRelationship: "SCHEDULED",
            startTime: "08:10:00",
            stopTimeUpdates: [{ stopId: TO_STOP, arrivalTime: lateArr }],
          },
        ],
        now: SCHED_ARR_MS + 3 * 60_000, // past scheduled, before live arrival
      });
      expect(status!.isEnded).toBe(false);
      expect(status!.arrivalEpochMs).toBe(lateArr * 1000);
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
