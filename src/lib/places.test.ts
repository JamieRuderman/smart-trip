import { describe, expect, it } from "vitest";
import {
  SAN_FRANCISCO,
  isFerryLeg,
  legPlaces,
  placeStation,
  validPlace,
  type Place,
} from "./places";

describe("places", () => {
  it("reaches San Francisco from Larkspur", () => {
    expect(placeStation(SAN_FRANCISCO)).toBe("Larkspur");
    expect(placeStation("Petaluma Downtown")).toBe("Petaluma Downtown");
  });

  it("keeps San Francisco and line stations, dropping anything else", () => {
    expect(validPlace(SAN_FRANCISCO)).toBe(SAN_FRANCISCO);
    expect(validPlace("Larkspur")).toBe("Larkspur");
    expect(validPlace("Oakland" as Place)).toBeNull();
    expect(validPlace("")).toBeNull();
  });

  it("rides the ferry only when an end is San Francisco", () => {
    expect(isFerryLeg(SAN_FRANCISCO, "Petaluma Downtown")).toBe(true);
    expect(isFerryLeg("Petaluma Downtown", SAN_FRANCISCO)).toBe(true);
    expect(isFerryLeg("Larkspur", "Petaluma Downtown")).toBe(false);
    expect(isFerryLeg("", "")).toBe(false);
  });

  it("names the Larkspur end San Francisco on a ferry leg", () => {
    expect(legPlaces("Larkspur", "Petaluma Downtown", true)).toEqual({
      from: SAN_FRANCISCO,
      to: "Petaluma Downtown",
    });
    expect(legPlaces("Petaluma Downtown", "Larkspur", true)).toEqual({
      from: "Petaluma Downtown",
      to: SAN_FRANCISCO,
    });
    expect(legPlaces("Larkspur", "Petaluma Downtown", false)).toEqual({
      from: "Larkspur",
      to: "Petaluma Downtown",
    });
  });
});
