// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A location fix the test settles by hand. */
const geo = vi.hoisted(() => {
  let settle: (fix: unknown) => void = () => {};
  let pending: Promise<unknown> = Promise.resolve(null);
  return {
    get: () => pending,
    settle: (fix: unknown) => settle(fix),
    reset() {
      pending = new Promise((resolve) => (settle = resolve));
    },
  };
});

vi.mock("@/hooks/useGeolocation", () => ({
  getRecentLocationFix: () => geo.get(),
}));
const selection = vi.hoisted(() => ({
  setFromStation: vi.fn(),
  setToStation: vi.fn(),
}));
vi.mock("@/contexts/stationSelection", () => ({
  useStationSelection: () => selection,
}));

import { useBoardingLocationCheck } from "./useBoardingLocationCheck";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date(2026, 9, 6, 17, 0).getTime();
const AT_SAN_RAFAEL = { lat: 37.972, lng: -122.5227, accuracy: 15 };

let check: ReturnType<typeof useBoardingLocationCheck>;
function Harness({ active }: { active: boolean }) {
  check = useBoardingLocationCheck({
    from: "Petaluma Downtown",
    to: "San Rafael",
    departureAt: NOW + 20 * 60_000,
    now: NOW,
    active,
  });
  return null;
}

describe("useBoardingLocationCheck", () => {
  let root: Root;

  beforeEach(() => {
    geo.reset();
    root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Harness, { active: true })));
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  /** Tap Go, then settle the fix (after `beforeSettle`, if given). */
  async function tap(fix: unknown, beforeSettle?: () => void) {
    const proceed = vi.fn();
    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = check.guard(proceed);
    });
    beforeSettle?.();
    await act(async () => {
      geo.settle(fix);
      await done;
    });
    return proceed;
  }

  it("takes the train when there's nothing to warn about", async () => {
    expect(await tap(null)).toHaveBeenCalledTimes(1);
    expect(check.warning).toBeNull();
  });

  it("warns instead of taking the train when closest to the destination", async () => {
    expect(await tap(AT_SAN_RAFAEL)).not.toHaveBeenCalled();
    expect(check.warning).toEqual({ kind: "nearDestination" });
  });

  it("switches the selected stations to the corrected leg on fix", async () => {
    await tap(AT_SAN_RAFAEL);
    let leg: ReturnType<typeof check.fixTrip> = null;
    act(() => {
      leg = check.fixTrip();
    });
    expect(leg).toEqual({ from: "San Rafael", to: "Petaluma Downtown" });
    expect(selection.setFromStation).toHaveBeenCalledWith("San Rafael");
    expect(selection.setToStation).toHaveBeenCalledWith("Petaluma Downtown");
    expect(check.warning).toBeNull();
  });

  it("does nothing if the sheet starts closing while the check waits", async () => {
    // The sheet stays mounted while it animates closed, so unmounting alone
    // can't be what stops the check.
    const proceed = await tap(null, () =>
      act(() => root.render(createElement(Harness, { active: false }))),
    );
    expect(proceed).not.toHaveBeenCalled();
    expect(check.warning).toBeNull();
  });
});
