import { describe, expect, it } from "vitest";
import {
  MAX_LEAD_MINUTES,
  MIN_LEAD_MINUTES,
  reminderLeadRange,
} from "./reminderLead";

const NOW = new Date(2026, 5, 17, 8, 0, 0, 0).getTime();
const min = (n: number) => NOW + n * 60_000;
const sec = (n: number) => NOW + n * 1000;

describe("reminderLeadRange", () => {
  it("reports whole minutes until departure", () => {
    expect(reminderLeadRange(min(15), NOW).minutesUntilDeparture).toBe(15);
    // Floors sub-minute remainders (never rounds up into the past).
    expect(reminderLeadRange(sec(150), NOW).minutesUntilDeparture).toBe(2);
  });

  it("offers leads up to a fire buffer short of departure", () => {
    // 5 min out → largest lead fires 1 min from now (4 min before departure).
    expect(reminderLeadRange(min(5), NOW).maxLeadMinutes).toBe(4);
  });

  it("caps the lead at MAX_LEAD_MINUTES for far-off trips", () => {
    expect(reminderLeadRange(min(60 * 25), NOW).maxLeadMinutes).toBe(
      MAX_LEAD_MINUTES,
    );
  });

  it("allows a reminder once departure is at least 2 minutes out", () => {
    // 1-min lead floor + 1-min fire buffer = 2 min minimum.
    const atBoundary = reminderLeadRange(min(2), NOW);
    expect(atBoundary.tooLate).toBe(false);
    expect(atBoundary.maxLeadMinutes).toBe(MIN_LEAD_MINUTES); // single-point slider
  });

  it("is too late under 2 minutes to departure", () => {
    expect(reminderLeadRange(sec(119), NOW).tooLate).toBe(true);
    expect(reminderLeadRange(min(1), NOW).tooLate).toBe(true);
    expect(reminderLeadRange(NOW, NOW).tooLate).toBe(true);
  });
});
