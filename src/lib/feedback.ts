import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Device } from "@capacitor/device";

export const FEEDBACK_EMAIL = "smart-train@proton.me";

export interface FeedbackContext {
  platform: string;
  appVersion?: string;
  appBuild?: string;
  osVersion?: string;
  model?: string;
  language?: string;
}

export function buildFeedbackMailto(ctx: FeedbackContext): string {
  const version = ctx.appVersion
    ? `${ctx.appVersion}${ctx.appBuild ? ` (${ctx.appBuild})` : ""}`
    : undefined;
  const subject = `SMART trip feedback (${[ctx.platform, version].filter(Boolean).join(" ")})`;
  const details = [
    `Platform: ${ctx.platform}`,
    version && `App version: ${version}`,
    ctx.osVersion && `OS version: ${ctx.osVersion}`,
    ctx.model && `Device: ${ctx.model}`,
    ctx.language && `Language: ${ctx.language}`,
  ].filter(Boolean);
  const body = `\n\n\n---\n${details.join("\n")}\n`;
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

const PLATFORM_LABELS: Record<string, string> = {
  android: "Android",
  ios: "iOS",
  web: "Web",
};

export async function getFeedbackContext(language?: string): Promise<FeedbackContext> {
  const platform = PLATFORM_LABELS[Capacitor.getPlatform()] ?? Capacitor.getPlatform();
  if (!Capacitor.isNativePlatform()) {
    return { platform, language };
  }
  const [app, device] = await Promise.allSettled([App.getInfo(), Device.getInfo()]);
  const appInfo = app.status === "fulfilled" ? app.value : undefined;
  const deviceInfo = device.status === "fulfilled" ? device.value : undefined;
  return {
    platform,
    appVersion: appInfo?.version,
    appBuild: appInfo?.build,
    osVersion: deviceInfo?.osVersion,
    model: deviceInfo
      ? [deviceInfo.manufacturer, deviceInfo.model].filter(Boolean).join(" ")
      : undefined,
    language,
  };
}

export async function openFeedbackEmail(language?: string): Promise<void> {
  const ctx = await getFeedbackContext(language);
  window.location.href = buildFeedbackMailto(ctx);
}
