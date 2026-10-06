import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const geo = vi.hoisted(() => ({
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  getCurrentPosition: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
}));
vi.mock("@capacitor/geolocation", () => ({ Geolocation: geo }));

/** A fresh module per test — the latest-fix cache is module state. */
async function load() {
  vi.resetModules();
  return (await import("./useGeolocation")).getRecentLocationFix;
}

function position(timestamp = Date.now()) {
  return {
    coords: { latitude: 38.2, longitude: -122.6, accuracy: 20 },
    timestamp,
  };
}

describe("getRecentLocationFix (native)", () => {
  beforeEach(() => {
    geo.getCurrentPosition.mockResolvedValue(position());
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns null without a fix or a prompt when access isn't granted", async () => {
    geo.checkPermissions.mockResolvedValue({ location: "prompt", coarseLocation: "prompt" });
    const getRecentLocationFix = await load();
    expect(await getRecentLocationFix()).toBeNull();
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(geo.requestPermissions).not.toHaveBeenCalled();
  });

  it("asks only for a low-accuracy fix under an approximate-only grant", async () => {
    // A high-accuracy request here would prompt Android 12+ to upgrade to precise.
    geo.checkPermissions.mockResolvedValue({ location: "prompt", coarseLocation: "granted" });
    const getRecentLocationFix = await load();
    expect(await getRecentLocationFix()).not.toBeNull();
    expect(geo.getCurrentPosition).toHaveBeenCalledWith(
      expect.objectContaining({ enableHighAccuracy: false }),
    );
    expect(geo.requestPermissions).not.toHaveBeenCalled();
  });

  it("asks for a high-accuracy fix under a precise grant", async () => {
    geo.checkPermissions.mockResolvedValue({ location: "granted", coarseLocation: "granted" });
    const getRecentLocationFix = await load();
    await getRecentLocationFix();
    expect(geo.getCurrentPosition).toHaveBeenCalledWith(
      expect.objectContaining({ enableHighAccuracy: true }),
    );
  });

  it("shares one request between concurrent callers and reuses a recent fix", async () => {
    geo.checkPermissions.mockResolvedValue({ location: "granted", coarseLocation: "granted" });
    const getRecentLocationFix = await load();
    const [a, b] = await Promise.all([getRecentLocationFix(), getRecentLocationFix()]);
    expect(a).toEqual(b);
    expect(await getRecentLocationFix()).toEqual(a);
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it("doesn't reuse a position that was already over a minute old when it arrived", async () => {
    geo.checkPermissions.mockResolvedValue({ location: "granted", coarseLocation: "granted" });
    geo.getCurrentPosition.mockResolvedValue(position(Date.now() - 90_000));
    const getRecentLocationFix = await load();
    await getRecentLocationFix();
    await getRecentLocationFix();
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(2);
  });
});
