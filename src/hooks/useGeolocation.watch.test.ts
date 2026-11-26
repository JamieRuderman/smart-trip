// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type WatchCallback = (position: unknown, err?: unknown) => void;

const geo = vi.hoisted(() => ({
  callbacks: [] as WatchCallback[],
  requestPermissions: vi.fn(),
  watchPosition: vi.fn(),
  clearWatch: vi.fn(),
  getCurrentPosition: vi.fn(),
  checkPermissions: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
}));
vi.mock("@capacitor/geolocation", () => ({ Geolocation: geo }));

import { useGeolocation } from "./useGeolocation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let state: ReturnType<typeof useGeolocation>;
function Harness() {
  state = useGeolocation({ watch: true, autoRequestOnNative: false });
  return null;
}

const flush = () => act(async () => {});

describe("useGeolocation watch (native)", () => {
  let root: Root;

  beforeEach(async () => {
    geo.callbacks = [];
    geo.requestPermissions.mockResolvedValue({});
    geo.clearWatch.mockResolvedValue(undefined);
    geo.watchPosition.mockImplementation(async (...args: [unknown, WatchCallback]) => {
      geo.callbacks.push(args[1]);
      return `watch-${geo.callbacks.length}`;
    });
    root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Harness)));
    await flush();
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.clearAllMocks();
  });

  it("restarts at low accuracy after a high-accuracy watch times out", async () => {
    expect(geo.watchPosition).toHaveBeenLastCalledWith(
      expect.objectContaining({ enableHighAccuracy: true }),
      expect.any(Function),
    );

    await act(async () => geo.callbacks[0](null, { code: "OS-PLUG-GLOC-0010" }));
    await flush();

    expect(geo.clearWatch).toHaveBeenCalledWith({ id: "watch-1" });
    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
    expect(geo.watchPosition).toHaveBeenLastCalledWith(
      expect.objectContaining({ enableHighAccuracy: false }),
      expect.any(Function),
    );

    await act(async () =>
      geo.callbacks[1]({ coords: { latitude: 38.45, longitude: -122.75, accuracy: 100 }, timestamp: Date.now() }),
    );
    expect(state.lat).toBe(38.45);
    expect(state.error).toBeNull();
  });
});
