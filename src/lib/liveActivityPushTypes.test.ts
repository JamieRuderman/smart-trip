import { describe, it, expect } from "vitest";
import {
  isLiveActivityRegistration,
  isLiveActivityTokenPayload,
  isRegistrationWithinHorizon,
  MAX_REGISTRATION_DURATION_MS,
  MAX_REGISTRATION_FUTURE_MS,
  MAX_REGISTRATION_PAST_MS,
  type LiveActivityRegistration,
} from "./liveActivityPushTypes";

const VALID_REG = {
  id: "trip-7-2026-06-09",
  tripNumber: 7,
  serviceDate: "2026-06-09",
  fromStation: "Larkspur",
  toStation: "Santa Rosa Downtown",
  direction: "northbound",
  scheduledDeparture: "08:30",
  scheduledArrival: "09:45",
  departureEpochMs: 1_780_000_000_000,
  arrivalEpochMs: 1_780_004_500_000,
};

describe("isLiveActivityRegistration", () => {
  it("accepts a well-formed registration", () => {
    expect(isLiveActivityRegistration(VALID_REG)).toBe(true);
  });

  it("rejects a bad direction", () => {
    expect(isLiveActivityRegistration({ ...VALID_REG, direction: "east" })).toBe(false);
  });

  it("rejects a malformed serviceDate", () => {
    expect(isLiveActivityRegistration({ ...VALID_REG, serviceDate: "2026/06/09" })).toBe(false);
  });

  it.each(["id", "tripNumber", "departureEpochMs", "arrivalEpochMs"])(
    "rejects when %s is missing",
    (key) => {
      const bad = { ...VALID_REG } as Record<string, unknown>;
      delete bad[key];
      expect(isLiveActivityRegistration(bad)).toBe(false);
    },
  );

  it("rejects non-objects", () => {
    expect(isLiveActivityRegistration(null)).toBe(false);
    expect(isLiveActivityRegistration("x")).toBe(false);
  });

  it("accepts an optional originStartTime and rejects a non-string one", () => {
    expect(
      isLiveActivityRegistration({ ...VALID_REG, originStartTime: "07:55" }),
    ).toBe(true);
    expect(
      isLiveActivityRegistration({ ...VALID_REG, originStartTime: 755 }),
    ).toBe(false);
  });

  it("accepts an optional reminderLeadMinutes and rejects bad ones", () => {
    expect(
      isLiveActivityRegistration({ ...VALID_REG, reminderLeadMinutes: 15 }),
    ).toBe(true);
    expect(
      isLiveActivityRegistration({ ...VALID_REG, reminderLeadMinutes: 0 }),
    ).toBe(true);
    expect(
      isLiveActivityRegistration({ ...VALID_REG, reminderLeadMinutes: -5 }),
    ).toBe(false);
    expect(
      isLiveActivityRegistration({ ...VALID_REG, reminderLeadMinutes: "15" }),
    ).toBe(false);
  });

  it("rejects oversized strings (public endpoint, bounded junk)", () => {
    expect(
      isLiveActivityRegistration({ ...VALID_REG, id: "x".repeat(200) }),
    ).toBe(false);
    expect(
      isLiveActivityRegistration({ ...VALID_REG, fromStation: "x".repeat(100) }),
    ).toBe(false);
    expect(
      isLiveActivityRegistration({ ...VALID_REG, scheduledDeparture: "x".repeat(20) }),
    ).toBe(false);
  });

  it("rejects arrival at or before departure", () => {
    expect(
      isLiveActivityRegistration({
        ...VALID_REG,
        arrivalEpochMs: VALID_REG.departureEpochMs,
      }),
    ).toBe(false);
    expect(
      isLiveActivityRegistration({
        ...VALID_REG,
        arrivalEpochMs: VALID_REG.departureEpochMs - 1,
      }),
    ).toBe(false);
  });
});

describe("isRegistrationWithinHorizon", () => {
  const now = 1_780_000_000_000;
  const reg = (
    departureEpochMs: number,
    arrivalEpochMs: number,
  ): LiveActivityRegistration => ({
    ...VALID_REG,
    direction: "northbound",
    departureEpochMs,
    arrivalEpochMs,
  });

  it("accepts a normal same-day trip", () => {
    expect(
      isRegistrationWithinHorizon(reg(now + 30 * 60_000, now + 120 * 60_000), now),
    ).toBe(true);
  });

  it("accepts a trip that just started (within the past grace)", () => {
    expect(
      isRegistrationWithinHorizon(reg(now - 60 * 60_000, now + 30 * 60_000), now),
    ).toBe(true);
  });

  it("rejects a departure too far in the future (DoS lifetime cap)", () => {
    expect(
      isRegistrationWithinHorizon(
        reg(now + MAX_REGISTRATION_FUTURE_MS + 60_000, now + MAX_REGISTRATION_FUTURE_MS + 120_000),
        now,
      ),
    ).toBe(false);
  });

  it("rejects a departure too far in the past", () => {
    expect(
      isRegistrationWithinHorizon(
        reg(now - MAX_REGISTRATION_PAST_MS - 60_000, now + 30 * 60_000),
        now,
      ),
    ).toBe(false);
  });

  it("rejects an absurd trip duration", () => {
    expect(
      isRegistrationWithinHorizon(
        reg(now, now + MAX_REGISTRATION_DURATION_MS + 60_000),
        now,
      ),
    ).toBe(false);
  });
});

describe("isLiveActivityTokenPayload", () => {
  it("accepts a well-formed token payload", () => {
    expect(
      isLiveActivityTokenPayload({ id: "trip-7", activityId: "sys-1", token: "abc" }),
    ).toBe(true);
  });

  it("rejects an empty token", () => {
    expect(
      isLiveActivityTokenPayload({ id: "trip-7", activityId: "sys-1", token: "" }),
    ).toBe(false);
  });

  it("rejects a missing id", () => {
    expect(isLiveActivityTokenPayload({ activityId: "sys-1", token: "abc" })).toBe(false);
  });

  it("rejects an oversized token", () => {
    expect(
      isLiveActivityTokenPayload({
        id: "trip-7",
        activityId: "sys-1",
        token: "a".repeat(600),
      }),
    ).toBe(false);
  });
});
