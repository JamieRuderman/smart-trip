import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Device } from "@capacitor/device";

export const FEEDBACK_EMAIL = "smart-train@proton.me";

export interface FeedbackContext {
  platform: string;
  appVersion?: string;
  osVersion?: string;
  model?: string;
  language?: string;
}

export function buildFeedbackMailto(ctx: FeedbackContext): string {
  const subject = `SMART trip feedback (${[ctx.platform, ctx.appVersion].filter(Boolean).join(" ")})`;
  const details = [
    `Platform: ${ctx.platform}`,
    ctx.appVersion && `App version: ${ctx.appVersion}`,
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

let appVersionLabel: Promise<string | undefined> | undefined;

export function getAppVersionLabel(): Promise<string | undefined> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve(undefined);
  appVersionLabel ??= App.getInfo()
    .then((info) => `${info.version} (${info.build})`)
    .catch(() => undefined);
  return appVersionLabel;
}

async function getFeedbackContext(language?: string): Promise<FeedbackContext> {
  const platform = PLATFORM_LABELS[Capacitor.getPlatform()];
  if (!Capacitor.isNativePlatform()) return { platform, language };
  const [appVersion, device] = await Promise.all([
    getAppVersionLabel(),
    Device.getInfo().catch(() => undefined),
  ]);
  return {
    platform,
    appVersion,
    osVersion: device?.osVersion,
    model: device ? [device.manufacturer, device.model].filter(Boolean).join(" ") : undefined,
    language,
  };
}

export async function openFeedbackEmail(language?: string): Promise<void> {
  window.location.href = buildFeedbackMailto(await getFeedbackContext(language));
}
