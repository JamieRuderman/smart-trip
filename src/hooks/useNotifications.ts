import { useState, useCallback, useMemo } from "react";
import { useServiceAlerts } from "./useServiceAlerts";
import type { AppNotification } from "@/types/notifications";

const NOTIF_READ_KEY = "smart-train-notifications-read";

function loadReadIds(): Set<string> {
  try {
    const raw = localStorage.getItem(NOTIF_READ_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveReadIds(ids: Set<string>): void {
  try {
    localStorage.setItem(NOTIF_READ_KEY, JSON.stringify([...ids]));
  } catch {
    // localStorage unavailable — no-op
  }
}

export function useNotifications() {
  const { alerts, isLoading } = useServiceAlerts();
  const [readIds, setReadIds] = useState<Set<string>>(loadReadIds);

  const notifications: AppNotification[] = useMemo(
    () =>
      alerts.map((alert) => ({
        id: alert.id,
        title: alert.title ?? "Service Alert",
        message: alert.message,
        severity: alert.severity ?? "warning",
        sourceType: "service-alert" as const,
      })),
    [alerts]
  );

  const unreadCount = notifications.filter((n) => !readIds.has(n.id)).length;

  const markAllRead = useCallback(() => {
    const newIds = new Set([...readIds, ...notifications.map((n) => n.id)]);
    setReadIds(newIds);
    saveReadIds(newIds);
  }, [readIds, notifications]);

  const markRead = useCallback(
    (id: string) => {
      const newIds = new Set([...readIds, id]);
      setReadIds(newIds);
      saveReadIds(newIds);
    },
    [readIds]
  );

  return {
    notifications,
    unreadCount,
    readIds,
    isLoading,
    markAllRead,
    markRead,
  };
}
