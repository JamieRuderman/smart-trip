import { describe, expect, it, vi } from "vitest";
import { useTripStatus } from "./useTripStatus";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("useTripStatus", () => {
  it("reads a skipped boarding or destination stop as skipped on the shown leg", () => {
    const live = { isCanceled: false, skippedStations: ["Larkspur"] };
    expect(useTripStatus(live, "Santa Rosa North", "Larkspur")).toMatchObject({
      isCanceled: false,
      isStopSkipped: true,
      isCanceledOrSkipped: true,
      isDelayed: false,
      statusLabel: "tripCard.stopSkipped",
      statusColor: "canceled",
    });
    expect(useTripStatus(live, "Santa Rosa North", "San Rafael").isStopSkipped).toBe(false);
  });
});
