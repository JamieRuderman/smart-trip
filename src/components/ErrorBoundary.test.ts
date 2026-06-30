import { describe, expect, it } from "vitest";
import { resetKeysChanged } from "./ErrorBoundary";

describe("resetKeysChanged", () => {
  it("is false for equal keys (no reset)", () => {
    expect(resetKeysChanged(["/"], ["/"])).toBe(false);
    expect(resetKeysChanged([], [])).toBe(false);
  });

  it("is true when a key value changes (e.g. route navigation)", () => {
    expect(resetKeysChanged(["/"], ["/map"])).toBe(true);
  });

  it("is true when the key count changes", () => {
    expect(resetKeysChanged(["/"], ["/", "x"])).toBe(true);
  });

  it("treats missing arrays as empty", () => {
    expect(resetKeysChanged(undefined, [])).toBe(false);
    expect(resetKeysChanged(undefined, ["/map"])).toBe(true);
  });

  it("compares by identity (Object.is)", () => {
    const obj = {};
    expect(resetKeysChanged([obj], [obj])).toBe(false);
    expect(resetKeysChanged([{}], [{}])).toBe(true);
  });
});
