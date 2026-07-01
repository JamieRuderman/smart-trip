import { useCallback, useMemo, useState } from "react";
import {
  getAlertDismissalKey,
  getAlertFingerprint,
} from "@/lib/alertFingerprint";
import type { ServiceAlertData } from "@/types/smartSchedule";

const DISMISSED_ALERTS_KEY = "smart-train-service-alerts-dismissed-v1";
export const ALERT_DISMISSAL_TTL_MS = 24 * 60 * 60 * 1000;

interface DismissedAlertRecord {
  dismissedAtMs: number;
  expiresAtMs: number;
}

type DismissedAlertMap = Record<string, DismissedAlertRecord>;

function hasWindow(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function loadDismissedMap(): DismissedAlertMap {
  if (!hasWindow()) return {};
  try {
    const raw = window.localStorage.getItem(DISMISSED_ALERTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const now = Date.now();
    const validEntries = Object.entries(parsed).filter(([key, value]) => {
      if (!key || !value || typeof value !== "object") return false;
      const record = value as Partial<DismissedAlertRecord>;
      return (
        typeof record.dismissedAtMs === "number" &&
        Number.isFinite(record.dismissedAtMs) &&
        typeof record.expiresAtMs === "number" &&
        Number.isFinite(record.expiresAtMs) &&
        record.expiresAtMs > now
      );
    });
    return Object.fromEntries(validEntries);
  } catch {
    return {};
  }
}

function saveDismissedMap(map: DismissedAlertMap): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(DISMISSED_ALERTS_KEY, JSON.stringify(map));
  } catch {
    // localStorage unavailable — no-op
  }
}

export function getAlertDismissalExpiryMs(
  alert: ServiceAlertData,
  dismissedAtMs: number
): number {
  const minimumExpiryMs = dismissedAtMs + ALERT_DISMISSAL_TTL_MS;
  if (alert.endsAt) {
    const parsed = Date.parse(alert.endsAt);
    if (Number.isFinite(parsed)) return Math.max(parsed, minimumExpiryMs);
  }
  return minimumExpiryMs;
}

export function useDismissedAlerts() {
  const [dismissedMap, setDismissedMap] = useState<DismissedAlertMap>(loadDismissedMap);

  const pruneExpired = useCallback((now = Date.now()) => {
    setDismissedMap((prev) => {
      const nextEntries = Object.entries(prev).filter((entry) => entry[1].expiresAtMs > now);
      const next = Object.fromEntries(nextEntries);
      if (nextEntries.length !== Object.keys(prev).length) {
        saveDismissedMap(next);
      }
      return next;
    });
  }, []);

  const isDismissed = useCallback(
    (alert: ServiceAlertData): boolean => {
      const dismissalKey = getAlertDismissalKey(alert);
      // Check the old content fingerprint too, so dismissals made before the
      // stable-ID change continue to work until their original expiry.
      const record =
        dismissedMap[dismissalKey] ?? dismissedMap[getAlertFingerprint(alert)];
      return !!record && record.expiresAtMs > Date.now();
    },
    [dismissedMap]
  );

  const dismissAlert = useCallback((alert: ServiceAlertData) => {
    const dismissedAtMs = Date.now();
    const dismissalKey = getAlertDismissalKey(alert);
    const expiresAtMs = getAlertDismissalExpiryMs(alert, dismissedAtMs);
    const record: DismissedAlertRecord = { dismissedAtMs, expiresAtMs };
    setDismissedMap((prev) => {
      const next = { ...prev, [dismissalKey]: record };
      saveDismissedMap(next);
      return next;
    });
  }, []);

  const restoreAlert = useCallback((alert: ServiceAlertData) => {
    const dismissalKey = getAlertDismissalKey(alert);
    const legacyFingerprint = getAlertFingerprint(alert);
    setDismissedMap((prev) => {
      if (!(dismissalKey in prev) && !(legacyFingerprint in prev)) return prev;
      const next = { ...prev };
      delete next[dismissalKey];
      delete next[legacyFingerprint];
      saveDismissedMap(next);
      return next;
    });
  }, []);

  const restoreAll = useCallback(() => {
    setDismissedMap(() => {
      saveDismissedMap({});
      return {};
    });
  }, []);

  const dismissedCountForActive = useCallback(
    (alerts: ServiceAlertData[]): number =>
      alerts.reduce((count, alert) => (isDismissed(alert) ? count + 1 : count), 0),
    [isDismissed]
  );

  return useMemo(
    () => ({
      isDismissed,
      dismissAlert,
      restoreAlert,
      restoreAll,
      dismissedCountForActive,
      pruneExpired,
    }),
    [
      isDismissed,
      dismissAlert,
      restoreAlert,
      restoreAll,
      dismissedCountForActive,
      pruneExpired,
    ]
  );
}
