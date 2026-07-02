import { describe, expect, it } from "vitest";
import {
  ALERT_DISMISSAL_TTL_MS,
  getAlertDismissalExpiryMs,
} from "@/hooks/useDismissedAlerts";
import type { ServiceAlertData } from "@/types/smartSchedule";

const DISMISSED_AT_MS = Date.parse("2026-07-01T12:00:00.000Z");

function alert(endsAt?: string): ServiceAlertData {
  return {
    id: "SMART:42",
    fingerprint: "fingerprint",
    endsAt,
  };
}

describe("getAlertDismissalExpiryMs", () => {
  it("dismisses alerts without an end time for 24 hours", () => {
    expect(getAlertDismissalExpiryMs(alert(), DISMISSED_AT_MS)).toBe(
      DISMISSED_AT_MS + ALERT_DISMISSAL_TTL_MS
    );
  });

  it("keeps the dismissal for at least 24 hours when the alert ends sooner", () => {
    expect(
      getAlertDismissalExpiryMs(
        alert("2026-07-01T13:00:00.000Z"),
        DISMISSED_AT_MS
      )
    ).toBe(DISMISSED_AT_MS + ALERT_DISMISSAL_TTL_MS);
  });

  it("keeps the dismissal through a later alert end time", () => {
    const endsAt = "2026-07-03T12:00:00.000Z";
    expect(getAlertDismissalExpiryMs(alert(endsAt), DISMISSED_AT_MS)).toBe(
      Date.parse(endsAt)
    );
  });
});
