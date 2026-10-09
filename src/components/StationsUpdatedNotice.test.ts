// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { StationsUpdatedNotice } from "./StationsUpdatedNotice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("StationsUpdatedNotice", () => {
  let root: Root;
  const render = (onClose: () => void) =>
    act(() =>
      root.render(
        createElement(StationsUpdatedNotice, {
          fromStation: "Santa Rosa North",
          toStation: "Larkspur",
          onClose,
        }),
      ),
    );

  beforeEach(() => {
    vi.useFakeTimers();
    root = createRoot(document.createElement("div"));
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("closes itself after a few seconds", () => {
    const onClose = vi.fn();
    render(onClose);
    act(() => vi.advanceTimersByTime(2999));
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("doesn't restart its timer when the parent re-renders", () => {
    const first = vi.fn();
    const latest = vi.fn();
    render(first);
    act(() => vi.advanceTimersByTime(2000));
    render(latest);
    act(() => vi.advanceTimersByTime(1000));
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });
});
