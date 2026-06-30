import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPlatform = vi.fn(() => "ios");
vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => getPlatform() },
}));

const readOptionalEnvString = vi.fn((v: unknown) =>
  typeof v === "string" && v.length > 0 ? v : undefined,
);
vi.mock("@/lib/env", () => ({
  apiBaseUrl: "https://smart.example",
  readOptionalEnvString: (v: unknown) => readOptionalEnvString(v),
}));

const setLiveActivityTokenEndpoint = vi.fn(async (url: string) => {
  void url;
});
const startTripActivityWithPush = vi.fn(
  async (): Promise<{ started: boolean; activityId?: string }> => ({
    started: true,
    activityId: "sys-1",
  }),
);
vi.mock("@/lib/native/liveActivity", () => ({
  setLiveActivityTokenEndpoint: (url: string) => setLiveActivityTokenEndpoint(url),
  startTripActivityWithPush: () => startTripActivityWithPush(),
}));

import {
  deregisterPushActivity,
  isLiveActivityPushEnabled,
  registerPushActivity,
  startAndRegisterPushActivity,
} from "./liveActivityPush";
import type { LiveActivityRegistration } from "@/lib/liveActivityPushTypes";
import type {
  TripActivityAttributes,
  TripActivityContentState,
} from "@/lib/liveActivityContent";

const REG: LiveActivityRegistration = {
  id: "trip-7-2026-06-09",
  tripNumber: 7,
  serviceDate: "2026-06-09",
  fromStation: "Larkspur",
  toStation: "San Rafael",
  direction: "northbound",
  scheduledDeparture: "08:30",
  scheduledArrival: "08:50",
  departureEpochMs: 1_780_000_000_000,
  arrivalEpochMs: 1_780_001_200_000,
};
const ATTRS = {} as TripActivityAttributes;
const CONTENT = {} as TripActivityContentState;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getPlatform.mockReturnValue("ios");
  readOptionalEnvString.mockImplementation((v: unknown) =>
    typeof v === "string" && v.length > 0 ? v : undefined,
  );
  startTripActivityWithPush.mockResolvedValue({ started: true, activityId: "sys-1" });
  fetchMock = vi.fn(async () => ({ ok: true }) as Response);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("isLiveActivityPushEnabled", () => {
  it("is true on iOS when the env flag is set", () => {
    // import.meta.env.VITE_LIVE_ACTIVITY_PUSH is undefined in tests, but the
    // mocked readOptionalEnvString returns undefined for that → false. Simulate
    // the flag being present by returning a value for any input.
    readOptionalEnvString.mockReturnValue("1");
    expect(isLiveActivityPushEnabled()).toBe(true);
  });

  it("is false off-iOS regardless of the flag", () => {
    readOptionalEnvString.mockReturnValue("1");
    getPlatform.mockReturnValue("android");
    expect(isLiveActivityPushEnabled()).toBe(false);
  });

  it("is false on iOS when the flag is unset", () => {
    readOptionalEnvString.mockReturnValue(undefined);
    expect(isLiveActivityPushEnabled()).toBe(false);
  });
});

describe("startAndRegisterPushActivity", () => {
  it("configures the token endpoint, starts with push, and POSTs the registration", async () => {
    const result = await startAndRegisterPushActivity(REG, ATTRS, CONTENT);
    expect(result).toEqual({ started: true });
    expect(setLiveActivityTokenEndpoint).toHaveBeenCalledWith(
      "https://smart.example/api/liveactivity/token",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://smart.example/api/liveactivity/register",
      expect.objectContaining({ method: "POST", body: JSON.stringify(REG) }),
    );
  });

  it("does not register when the activity didn't start", async () => {
    startTripActivityWithPush.mockResolvedValue({ started: false });
    const result = await startAndRegisterPushActivity(REG, ATTRS, CONTENT);
    expect(result).toEqual({ started: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still reports started when registration POST fails", async () => {
    fetchMock.mockRejectedValue(new Error("network"));
    const result = await startAndRegisterPushActivity(REG, ATTRS, CONTENT);
    expect(result).toEqual({ started: true });
  });
});

describe("registerPushActivity", () => {
  it("POSTs the registration (boot-time heal path)", async () => {
    await registerPushActivity(REG);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://smart.example/api/liveactivity/register",
      expect.objectContaining({ method: "POST", body: JSON.stringify(REG) }),
    );
  });

  it("reports success when the POST reaches the server", async () => {
    await expect(registerPushActivity(REG)).resolves.toBe(true);
  });

  it("never throws on a network failure (reports failure)", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    await expect(registerPushActivity(REG)).resolves.toBe(false);
  });
});

describe("deregisterPushActivity", () => {
  it("DELETEs the registration by id on iOS", async () => {
    await deregisterPushActivity("trip-7-2026-06-09");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://smart.example/api/liveactivity/register?id=trip-7-2026-06-09",
      { method: "DELETE" },
    );
  });

  it("no-ops off-iOS", async () => {
    getPlatform.mockReturnValue("web");
    await deregisterPushActivity("x");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
