import { describe, expect, it } from "vitest";
import { selectAlarmStatus } from "@/lib/alarmStatus";

describe("selectAlarmStatus", () => {
  it("shows departure countdown well before departure", () => {
    const status = selectAlarmStatus({
      minutesUntilDeparture: 12,
      minutesUntilArrival: 83,
      minutesAfterArrival: -83,
      hasStarted: false,
      isCanceled: false,
      isCanceledOrSkipped: false,
      isEnded: false,
      hasFreshRealtime: false,
    });

    expect(status.phase).toBe("PRE_DEPARTURE");
    expect(status.kind).toBe("departure-countdown");
    expect(status.minutesUntilDeparture).toBe(12);
  });

  it("shows leaving soon inside the boarding window before departure", () => {
    const status = selectAlarmStatus({
      minutesUntilDeparture: 1,
      minutesUntilArrival: 72,
      minutesAfterArrival: -72,
      hasStarted: false,
      isCanceled: false,
      isCanceledOrSkipped: false,
      isEnded: false,
      hasFreshRealtime: false,
    });

    expect(status.phase).toBe("BOARDING_WINDOW");
    expect(status.translationKey).toBe("tracker.leavingSoon");
  });

  it("keeps leaving soon one minute after departure", () => {
    const status = selectAlarmStatus({
      minutesUntilDeparture: -1,
      minutesUntilArrival: 70,
      minutesAfterArrival: -70,
      hasStarted: false,
      isCanceled: false,
      isCanceledOrSkipped: false,
      isEnded: false,
      hasFreshRealtime: true,
    });

    expect(status.phase).toBe("BOARDING_WINDOW");
    expect(status.translationKey).toBe("tracker.leavingSoon");
  });

  it("shows on the way when en route without fresh realtime", () => {
    const status = selectAlarmStatus({
      minutesUntilDeparture: -5,
      minutesUntilArrival: 61,
      minutesAfterArrival: -61,
      hasStarted: true,
      isCanceled: false,
      isCanceledOrSkipped: false,
      isEnded: false,
      hasFreshRealtime: false,
    });

    expect(status.phase).toBe("EN_ROUTE_STALE");
    expect(status.translationKey).toBe("tracker.onTheWay");
  });


  it("uses arrival countdown when GPS is reliable even if realtime is stale", () => {
    const status = selectAlarmStatus({
      minutesUntilDeparture: -5,
      minutesUntilArrival: 18,
      minutesAfterArrival: -18,
      hasStarted: true,
      isCanceled: false,
      isCanceledOrSkipped: false,
      isEnded: false,
      hasFreshRealtime: false,
      hasReliableGps: true,
    });

    expect(status.phase).toBe("EN_ROUTE_FRESH");
    expect(status.kind).toBe("arrival-countdown");
    expect(status.minutesUntilArrival).toBe(18);
  });

  it("treats rider as post-departure when on-train GPS is detected", () => {
    const status = selectAlarmStatus({
      minutesUntilDeparture: 1,
      minutesUntilArrival: 46,
      minutesAfterArrival: -46,
      hasStarted: false,
      isCanceled: false,
      isCanceledOrSkipped: false,
      isEnded: false,
      hasFreshRealtime: false,
      hasReliableGps: true,
      isOnTrain: true,
    });

    expect(status.phase).toBe("EN_ROUTE_FRESH");
    expect(status.kind).toBe("arrival-countdown");
  });
  it("keeps exact departure countdown for delayed trips before live departure", () => {
    const status = selectAlarmStatus({
      minutesUntilDeparture: 6,
      minutesUntilArrival: 77,
      minutesAfterArrival: -77,
      hasStarted: false,
      isCanceled: false,
      isCanceledOrSkipped: false,
      isEnded: false,
      hasFreshRealtime: true,
    });

    expect(status.phase).toBe("PRE_DEPARTURE");
    expect(status.kind).toBe("departure-countdown");
  });

  it("shows exact arrival countdown when en route with fresh realtime", () => {
    const status = selectAlarmStatus({
      minutesUntilDeparture: -20,
      minutesUntilArrival: 20,
      minutesAfterArrival: -20,
      hasStarted: true,
      isCanceled: false,
      isCanceledOrSkipped: false,
      isEnded: false,
      hasFreshRealtime: true,
    });

    expect(status.phase).toBe("EN_ROUTE_FRESH");
    expect(status.kind).toBe("arrival-countdown");
    expect(status.minutesUntilArrival).toBe(20);
  });

  it("shows arriving soon near the destination with fresh realtime", () => {
    const status = selectAlarmStatus({
      minutesUntilDeparture: -68,
      minutesUntilArrival: 2,
      minutesAfterArrival: -2,
      hasStarted: true,
      isCanceled: false,
      isCanceledOrSkipped: false,
      isEnded: false,
      hasFreshRealtime: true,
    });

    expect(status.phase).toBe("APPROACHING_DESTINATION");
    expect(status.translationKey).toBe("tracker.arrivingSoon");
  });

  it("shows at destination before the ended threshold", () => {
    const status = selectAlarmStatus({
      minutesUntilDeparture: -72,
      minutesUntilArrival: 0,
      minutesAfterArrival: 0,
      hasStarted: true,
      isCanceled: false,
      isCanceledOrSkipped: false,
      isEnded: false,
      hasFreshRealtime: true,
    });

    expect(status.phase).toBe("AT_DESTINATION");
    expect(status.translationKey).toBe("tracker.atDestination");
  });

  it("preserves canceled and skipped overrides", () => {
    const canceled = selectAlarmStatus({
      minutesUntilDeparture: 10,
      minutesUntilArrival: 81,
      minutesAfterArrival: -81,
      hasStarted: false,
      isCanceled: true,
      isCanceledOrSkipped: true,
      isEnded: false,
      hasFreshRealtime: false,
    });
    const skipped = selectAlarmStatus({
      minutesUntilDeparture: 10,
      minutesUntilArrival: 81,
      minutesAfterArrival: -81,
      hasStarted: false,
      isCanceled: false,
      isCanceledOrSkipped: true,
      isEnded: false,
      hasFreshRealtime: false,
    });

    expect(canceled.translationKey).toBe("tracker.tripCanceled");
    expect(skipped.translationKey).toBe("tripCard.stopSkipped");
  });

  it("can force post-departure behavior to support sticky transitions", () => {
    const status = selectAlarmStatus({
      minutesUntilDeparture: 1,
      minutesUntilArrival: 45,
      minutesAfterArrival: -45,
      hasStarted: false,
      isCanceled: false,
      isCanceledOrSkipped: false,
      isEnded: false,
      hasFreshRealtime: false,
      forcePostDeparture: true,
    });

    expect(status.phase).toBe("EN_ROUTE_STALE");
    expect(status.translationKey).toBe("tracker.onTheWay");
  });
});
