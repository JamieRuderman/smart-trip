import { describe, expect, it } from "vitest";
import {
  getAlertDismissalKey,
  getAlertFingerprint,
} from "@/lib/alertFingerprint";
import type { ServiceAlertData } from "@/types/smartSchedule";

function alert(overrides: Partial<ServiceAlertData> = {}): ServiceAlertData {
  return {
    id: "SMART:42",
    fingerprint: "current-fingerprint",
    title: "Delay near Petaluma",
    message: "Expect a ten-minute delay",
    startsAt: "2026-07-01T12:00:00.000Z",
    endsAt: "2026-07-01T14:00:00.000Z",
    ...overrides,
  };
}

describe("getAlertDismissalKey", () => {
  it("stays stable when an agency edits alert copy or timing", () => {
    const original = alert();
    const edited = alert({
      fingerprint: "updated-fingerprint",
      title: "Updated delay near Petaluma",
      message: "Expect a fifteen-minute delay",
      startsAt: "2026-07-01T12:05:00.000Z",
      endsAt: "2026-07-01T15:00:00.000Z",
    });

    expect(getAlertFingerprint(edited)).not.toBe(getAlertFingerprint(original));
    expect(getAlertDismissalKey(edited)).toBe(getAlertDismissalKey(original));
  });

  it("distinguishes different agency alert IDs", () => {
    expect(getAlertDismissalKey(alert({ id: "SMART:43" }))).not.toBe(
      getAlertDismissalKey(alert())
    );
  });
});
