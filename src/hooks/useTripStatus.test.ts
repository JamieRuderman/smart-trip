import { describe, expect, it, vi } from "vitest";
import type { TripRealtimeStatus } from "@/types/gtfsRt";
import { useTripStatus } from "./useTripStatus";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const live = (flags: Partial<TripRealtimeStatus>): TripRealtimeStatus => ({
  isCanceled: false,
  isOriginSkipped: false,
  isDestinationSkipped: false,
  ...flags,
});

describe("useTripStatus", () => {
  it("reads a skipped destination as a skipped stop on the rider's leg", () => {
    const status = useTripStatus(live({ isDestinationSkipped: true }));
    expect(status).toMatchObject({
      isCanceled: false,
      isStopSkipped: true,
      isCanceledOrSkipped: true,
      isDelayed: false,
      statusLabel: "tripCard.stopSkipped",
      statusColor: "canceled",
    });
  });

  it("reads a skipped boarding stop the same way", () => {
    expect(useTripStatus(live({ isOriginSkipped: true }))).toMatchObject({
      isStopSkipped: true,
      statusLabel: "tripCard.stopSkipped",
    });
  });

  it("calls a cancelled run cancelled even when its stops are skipped", () => {
    expect(
      useTripStatus(live({ isCanceled: true, isDestinationSkipped: true })),
    ).toMatchObject({
      isStopSkipped: false,
      isCanceledOrSkipped: true,
      statusLabel: "tripCard.canceled",
    });
  });
});
