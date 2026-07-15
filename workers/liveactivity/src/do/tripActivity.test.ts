// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  ENDGAME_POLL_MS,
  nextWake,
  planTick,
  POLL_MS,
  type LastSent,
} from "./tripActivity.js";
import type { FeedTripUpdate } from "../../../../api/_liveActivityStatus.js";
import type { LiveActivityRegistration } from "../../../../src/lib/liveActivityPushTypes.js";

// Real SMART northbound platform stop_ids (see _liveActivityStatus.test.ts).
const FROM_STOP = "71011"; // Larkspur / northbound
const TO_STOP = "71021"; // San Rafael / northbound
const SCHED_DEP_MS = Date.parse("2026-06-22T08:30:00-07:00");
const SCHED_ARR_MS = Date.parse("2026-06-22T08:50:00-07:00");

const REG: LiveActivityRegistration = {
  id: "trip-7-2026-06-22-x",
  tripNumber: 7,
  serviceDate: "2026-06-22",
  fromStation: "Larkspur",
  toStation: "San Rafael",
  direction: "northbound",
  scheduledDeparture: "08:30",
  scheduledArrival: "08:50",
  departureEpochMs: SCHED_DEP_MS,
  arrivalEpochMs: SCHED_ARR_MS,
  originStartTime: "08:10",
};

/** Pre-/at-departure: boarding stop present at `liveDep` (unix seconds). */
const boardingFeed = (liveDepUnix: number): FeedTripUpdate[] => [
  {
    scheduleRelationship: "SCHEDULED",
    startTime: "08:10:00",
    stopTimeUpdates: [{ stopId: FROM_STOP, departureTime: liveDepUnix }],
  },
];

/** En route: boarding pruned, destination present at `liveArr` (unix seconds). */
const enRouteFeed = (liveArrUnix: number): FeedTripUpdate[] => [
  {
    scheduleRelationship: "SCHEDULED",
    startTime: "08:10:00",
    stopTimeUpdates: [{ stopId: TO_STOP, arrivalTime: liveArrUnix }],
  },
];

const PRE_DEPARTURE_SENT: LastSent = {
  delayMinutes: 0,
  phase: "pre-departure",
  isEnded: false,
  isCanceled: false,
  arrivalEpochMs: SCHED_ARR_MS,
};

/** Same run with a 15-min leave alarm armed (departure − 15 min == 08:15). */
const REMINDER_LEAD_MIN = 15;
const REG_WITH_REMINDER: LiveActivityRegistration = {
  ...REG,
  reminderLeadMinutes: REMINDER_LEAD_MIN,
};
const LEAVE_MS = SCHED_DEP_MS - REMINDER_LEAD_MIN * 60_000;

/** The encoded content-state dict carried by a push payload. */
const contentValues = (plan: ReturnType<typeof planTick>): Record<string, string> =>
  (plan.push!.payload as { aps: { "content-state": { values: Record<string, string> } } })
    .aps["content-state"].values;

describe("nextWake", () => {
  const now = SCHED_DEP_MS - 5 * 60_000;

  it("targets the departure boundary when within a poll of it", () => {
    expect(nextWake(now + 30_000, SCHED_ARR_MS, now)).toBe(now + 30_000);
  });
  it("polls when the next boundary is further than a poll away", () => {
    expect(nextWake(SCHED_DEP_MS, SCHED_ARR_MS, now)).toBe(now + POLL_MS);
  });
  it("polls at the normal cadence en route, outside the end-game window", () => {
    const t = SCHED_ARR_MS - 10 * 60_000; // departed, >3min from arrival
    expect(nextWake(SCHED_DEP_MS, SCHED_ARR_MS, t)).toBe(t + POLL_MS);
  });
  it("tightens to the end-game cadence in the final approach", () => {
    const t = SCHED_ARR_MS - 2 * 60_000; // within the 3-min end-game window
    expect(nextWake(SCHED_DEP_MS, SCHED_ARR_MS, t)).toBe(t + ENDGAME_POLL_MS);
  });
  it("wakes at the leave-alarm instant when it falls within the next poll", () => {
    const t = LEAVE_MS - 30_000; // 30s before the leave instant, departure far off
    expect(nextWake(SCHED_DEP_MS, SCHED_ARR_MS, t, LEAVE_MS)).toBe(LEAVE_MS);
  });
  it("ignores a leave-alarm instant that has already fired", () => {
    const t = LEAVE_MS + 60_000; // past the leave instant, still pre-departure
    expect(nextWake(SCHED_DEP_MS, SCHED_ARR_MS, t, LEAVE_MS)).toBe(t + POLL_MS);
  });
  it("targets the arrival boundary within an end-game poll of it", () => {
    const t = SCHED_ARR_MS - 20_000; // < ENDGAME_POLL_MS from arrival
    expect(nextWake(SCHED_DEP_MS, SCHED_ARR_MS, t)).toBe(SCHED_ARR_MS);
  });
  it("keeps polling past arrival (no hot loop)", () => {
    const t = SCHED_ARR_MS + 60_000;
    expect(nextWake(SCHED_DEP_MS, SCHED_ARR_MS, t)).toBe(t + POLL_MS);
  });
});

describe("planTick", () => {
  it("pushes the initial pre-departure update and seeds lastSent", () => {
    const now = SCHED_DEP_MS - 20 * 60_000;
    const plan = planTick({
      reg: REG,
      token: "tok",
      lastSent: null,
      updates: boardingFeed(SCHED_DEP_MS / 1000),
      now,
    });
    expect(plan.push?.event).toBe("update");
    expect(plan.lastSent).toEqual({
      delayMinutes: 0,
      phase: "pre-departure",
      isEnded: false,
      isCanceled: false,
      arrivalEpochMs: SCHED_ARR_MS,
      alarmPending: false,
    });
    expect(plan.stop).toBe(false);
  });

  it("waits for the DISPLAYED arrival when the live arrival jitters earlier", () => {
    // Widget is counting down to SCHED_ARR; the feed now reports arrival 7s
    // earlier. We're past the live arrival but before the displayed one.
    const displayedArr = SCHED_ARR_MS;
    const liveArr = SCHED_ARR_MS - 7_000;
    const plan = planTick({
      reg: REG,
      token: "tok",
      lastSent: {
        delayMinutes: 0,
        phase: "en-route",
        isEnded: false,
        isCanceled: false,
        arrivalEpochMs: displayedArr,
      },
      updates: enRouteFeed(liveArr / 1000),
      now: SCHED_ARR_MS - 5_000,
    });
    expect(plan.push).toBeNull();
    expect(plan.stop).toBe(false);
    expect(plan.nextAlarm).toBe(displayedArr);
  });

  it("schedules to the displayed arrival when the feed read is unavailable", () => {
    const displayedArr = SCHED_ARR_MS + 4 * 60_000;
    const plan = planTick({
      reg: REG,
      token: "tok",
      lastSent: {
        delayMinutes: 4,
        phase: "en-route",
        isEnded: false,
        isCanceled: false,
        arrivalEpochMs: displayedArr,
      },
      updates: null,
      now: displayedArr - 20_000, // within an end-game poll → targets the boundary
    });
    expect(plan.push).toBeNull();
    expect(plan.stop).toBe(false);
    expect(plan.nextAlarm).toBe(displayedArr);
  });

  it("ends at the displayed arrival even when the feed read is unavailable", () => {
    const displayedArr = SCHED_ARR_MS + 4 * 60_000;
    const plan = planTick({
      reg: REG,
      token: "tok",
      lastSent: {
        delayMinutes: 4,
        phase: "en-route",
        isEnded: false,
        isCanceled: false,
        arrivalEpochMs: displayedArr,
      },
      updates: null,
      now: displayedArr,
    });
    expect(plan.push?.event).toBe("end");
    expect(plan.stop).toBe(true);
    const aps = (plan.push!.payload as { aps: Record<string, unknown> }).aps;
    expect(aps["dismissal-date"]).toBe(Math.floor(displayedArr / 1000));
  });

  it("defers the terminal fallbacks while the vehicle is still short of the destination", () => {
    const displayedArr = SCHED_ARR_MS + 4 * 60_000;
    const lastSent = {
      delayMinutes: 4,
      phase: "en-route" as const,
      isEnded: false,
      isCanceled: false,
      arrivalEpochMs: displayedArr,
    };
    // Feed read failed AND the positions feed shows the train en route:
    // no synthesized end — keep polling instead of dismissing mid-ride.
    const noFeed = planTick({
      reg: REG,
      token: "tok",
      lastSent,
      updates: null,
      now: displayedArr + 60_000,
      vehicleShortOfDestination: true,
    });
    expect(noFeed.push).toBeNull();
    expect(noFeed.stop).toBe(false);
    // Feed present but the run is unlocatable (pruned): same veto applies
    // through computeLiveTripStatus.
    const unlocatable = planTick({
      reg: REG,
      token: "tok",
      lastSent,
      updates: [],
      now: displayedArr + 60_000,
      vehicleShortOfDestination: true,
    });
    expect(unlocatable.push).toBeNull();
    expect(unlocatable.stop).toBe(false);
  });

  it("is silent when nothing changed since the last send", () => {
    const now = SCHED_DEP_MS - 20 * 60_000;
    const plan = planTick({
      reg: REG,
      token: "tok",
      lastSent: PRE_DEPARTURE_SENT,
      updates: boardingFeed(SCHED_DEP_MS / 1000),
      now,
    });
    expect(plan.push).toBeNull();
    expect(plan.stop).toBe(false);
  });

  it("schedules to the LIVE (delayed) departure, not the scheduled one", () => {
    // Departure slipped +10 min; we're 1 min before the live departure.
    const liveDep = SCHED_DEP_MS + 10 * 60_000;
    const now = liveDep - 60_000;
    const plan = planTick({
      reg: REG,
      token: "tok",
      lastSent: PRE_DEPARTURE_SENT,
      updates: boardingFeed(liveDep / 1000),
      now,
    });
    // Exact wake on the live departure instant (within a poll), so the flip
    // fires on time — NOT min(scheduledArrival, now+POLL) as the static times
    // would give.
    expect(plan.nextAlarm).toBe(liveDep);
  });

  it("pushes the departing→arriving flip once en route", () => {
    const now = SCHED_DEP_MS + 5 * 60_000; // departed, on time
    const plan = planTick({
      reg: REG,
      token: "tok",
      lastSent: PRE_DEPARTURE_SENT,
      updates: enRouteFeed(SCHED_ARR_MS / 1000),
      now,
    });
    expect(plan.push?.event).toBe("update");
    expect(plan.lastSent?.phase).toBe("en-route");
    expect(plan.stop).toBe(false);
  });

  it("ends + stops once arrived", () => {
    const now = SCHED_ARR_MS + 60_000;
    const plan = planTick({
      reg: REG,
      token: "tok",
      lastSent: { ...PRE_DEPARTURE_SENT, phase: "en-route" },
      updates: enRouteFeed(SCHED_ARR_MS / 1000),
      now,
    });
    expect(plan.push?.event).toBe("end");
    expect(plan.stop).toBe(true);
  });

  it("stops without a push when arrived but no token ever arrived", () => {
    const now = SCHED_ARR_MS + 60_000;
    const plan = planTick({
      reg: REG,
      token: null,
      lastSent: { ...PRE_DEPARTURE_SENT, phase: "en-route" },
      updates: enRouteFeed(SCHED_ARR_MS / 1000),
      now,
    });
    expect(plan.push).toBeNull();
    expect(plan.stop).toBe(true);
  });

  it("waits (no push, no stop) when an update is due but the token hasn't arrived", () => {
    const now = SCHED_DEP_MS - 20 * 60_000;
    const plan = planTick({
      reg: REG,
      token: null,
      lastSent: null,
      updates: boardingFeed(SCHED_DEP_MS / 1000),
      now,
    });
    expect(plan.push).toBeNull();
    expect(plan.stop).toBe(false);
  });

  it("does nothing but reschedule when the feed is unavailable", () => {
    const now = SCHED_DEP_MS - 20 * 60_000;
    const plan = planTick({ reg: REG, token: "tok", lastSent: null, updates: null, now });
    expect(plan.push).toBeNull();
    expect(plan.stop).toBe(false);
    expect(plan.nextAlarm).toBe(now + POLL_MS); // min(SCHED_DEP, now+POLL)
  });

  it("bakes the armed leave-alarm countdown into the pushed content", () => {
    const now = SCHED_DEP_MS - 20 * 60_000; // 08:10, before the 08:15 leave instant
    const plan = planTick({
      reg: REG_WITH_REMINDER,
      token: "tok",
      lastSent: null,
      updates: boardingFeed(SCHED_DEP_MS / 1000),
      now,
    });
    expect(plan.push?.event).toBe("update");
    const values = contentValues(plan);
    expect(values.reminderSet).toBe("true");
    expect(values.reminderEpochMs).toBe(String(LEAVE_MS));
    expect(values.alarmPending).toBe("true");
    expect(plan.lastSent?.alarmPending).toBe(true);
  });

  it("derives the leave-alarm instant from the LIVE (delayed) departure", () => {
    const liveDep = SCHED_DEP_MS + 10 * 60_000; // +10 min delay
    const now = SCHED_DEP_MS - 20 * 60_000;
    const plan = planTick({
      reg: REG_WITH_REMINDER,
      token: "tok",
      lastSent: null,
      updates: boardingFeed(liveDep / 1000),
      now,
    });
    // Leave alarm tracks the live departure − lead, matching the in-app "Leave in".
    expect(contentValues(plan).reminderEpochMs).toBe(
      String(liveDep - REMINDER_LEAD_MIN * 60_000),
    );
  });

  it("keeps and shifts the leave-in countdown when a delay update is pushed", () => {
    // A delay surfaces while the leave alarm is still pending: the push must say
    // "Delayed" AND keep the "Leave in" stage, with the leave instant shifted by
    // the delay — never drop back to "Departs in" (the reported regression).
    const liveDep = SCHED_DEP_MS + 5 * 60_000; // +5 min delay
    const now = SCHED_DEP_MS - 20 * 60_000; // 08:10, before the (shifted) leave instant
    const plan = planTick({
      reg: REG_WITH_REMINDER,
      token: "tok",
      // Last push was on-time with the alarm still pending — so the delay is the
      // change that earns this push.
      lastSent: { ...PRE_DEPARTURE_SENT, alarmPending: true },
      updates: boardingFeed(liveDep / 1000),
      now,
    });
    expect(plan.push?.event).toBe("update");
    const values = contentValues(plan);
    expect(values.statusText).toBe("Delayed");
    expect(values.reminderSet).toBe("true");
    expect(values.alarmPending).toBe("true");
    // Leave instant rides the live departure − lead, so "Leave in" stays accurate.
    expect(values.reminderEpochMs).toBe(String(liveDep - REMINDER_LEAD_MIN * 60_000));
  });

  it("forces a Leave→Departs update when the alarm fires, delay unchanged", () => {
    const now = LEAVE_MS + 30_000; // just past the leave instant, still pre-departure
    const plan = planTick({
      reg: REG_WITH_REMINDER,
      token: "tok",
      // Last push was on-time pre-departure with the alarm still pending.
      lastSent: { ...PRE_DEPARTURE_SENT, alarmPending: true },
      updates: boardingFeed(SCHED_DEP_MS / 1000),
      now,
    });
    // decidePushAction alone sees no delay/phase change — the alarm transition is
    // what earns the push, flipping the surface off its spent "Leave in" stage.
    expect(plan.push?.event).toBe("update");
    expect(contentValues(plan).alarmPending).toBe("false");
    expect(plan.lastSent?.alarmPending).toBe(false);
  });

  it("stays silent once the alarm has already fired and nothing else changed", () => {
    const now = LEAVE_MS + 30_000;
    const plan = planTick({
      reg: REG_WITH_REMINDER,
      token: "tok",
      lastSent: { ...PRE_DEPARTURE_SENT, alarmPending: false },
      updates: boardingFeed(SCHED_DEP_MS / 1000),
      now,
    });
    expect(plan.push).toBeNull();
  });
});
