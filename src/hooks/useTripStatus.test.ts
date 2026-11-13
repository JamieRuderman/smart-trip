import { describe, expect, it, vi } from "vitest";
import { useTripStatus } from "./useTripStatus";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("useTripStatus", () => {
  it("reads a skipped boarding or destination stop as skipped on the rider's leg", () => {
    expect(useTripStatus({ isCanceled: false, isStopSkipped: true })).toMatchObject({
      isCanceled: false,
      isStopSkipped: true,
      isCanceledOrSkipped: true,
      isDelayed: false,
      statusLabel: "tripCard.stopSkipped",
      statusColor: "canceled",
    });
  });
});
