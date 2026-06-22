// @vitest-environment node
import { describe, it, expect } from "vitest";
import { nextWake, planTick, POLL_MS, type LastSent } from "./tripActivity.js";
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
};

describe("nextWake", () => {
  const now = SCHED_DEP_MS - 5 * 60_000;

  it("targets the departure boundary when within a poll of it", () => {
    expect(nextWake(now + 30_000, SCHED_ARR_MS, now)).toBe(now + 30_000);
  });
  it("polls when the next boundary is further than a poll away", () => {
    expect(nextWake(SCHED_DEP_MS, SCHED_ARR_MS, now)).toBe(now + POLL_MS);
  });
  it("targets the arrival boundary once departed", () => {
    const t = SCHED_ARR_MS - 30_000;
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
    });
    expect(plan.stop).toBe(false);
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
});
