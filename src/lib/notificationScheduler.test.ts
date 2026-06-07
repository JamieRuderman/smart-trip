import { describe, it, expect, vi } from "vitest";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false },
}));
vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: {
    schedule: vi.fn(),
    cancel: vi.fn(),
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
  },
}));

import { isReminderSupported, isIOSWebBrowser } from "./notificationScheduler";

describe("isReminderSupported (web)", () => {
  it("is true when the Notification API exists", () => {
    vi.stubGlobal("window", { Notification: function () {} });
    expect(isReminderSupported()).toBe(true);
  });
  it("is false when the Notification API is absent", () => {
    vi.stubGlobal("window", {});
    expect(isReminderSupported()).toBe(false);
  });
});

describe("isIOSWebBrowser", () => {
  it("detects iPhone UA", () => {
    vi.stubGlobal("navigator", { userAgent: "iPhone Safari" });
    expect(isIOSWebBrowser()).toBe(true);
  });
  it("is false for desktop UA", () => {
    vi.stubGlobal("navigator", { userAgent: "Macintosh Chrome" });
    expect(isIOSWebBrowser()).toBe(false);
  });
});
