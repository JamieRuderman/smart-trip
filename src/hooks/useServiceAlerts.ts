import { useQuery } from "@tanstack/react-query";
import { apiBaseUrl } from "@/lib/env";
import type { GtfsRtAlertsResponse, GtfsRtAlert } from "@/types/gtfsRt";
import type { ServiceAlertData } from "@/types/smartSchedule";

const ALERTS_POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes

async function fetchAlerts(): Promise<GtfsRtAlertsResponse> {
  const res = await fetch(`${apiBaseUrl}/api/gtfsrt/alerts`);
  if (!res.ok) throw new Error(`Alerts fetch failed: ${res.status}`);
  return res.json() as Promise<GtfsRtAlertsResponse>;
}

/** Convert ALL-CAPS agency text to sentence case for readability. */
function humanize(text: string): string {
  if (!text) return text;
  if (text !== text.toUpperCase()) return text; // already mixed case
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

function mapEffectToSeverity(
  effect?: string
): "info" | "warning" | "critical" {
  if (!effect) return "warning";
  if (effect === "NO_SERVICE" || effect === "STOP_MOVED") return "critical";
  if (
    effect === "REDUCED_SERVICE" ||
    effect === "DETOUR" ||
    effect === "SIGNIFICANT_DELAYS"
  )
    return "warning";
  return "info";
}

function mapAlertToServiceAlertData(
  alert: GtfsRtAlert,
  nowSec: number
): ServiceAlertData {
  const activePeriod =
    alert.activePeriods.find(
      (p) =>
        (!p.start || p.start <= nowSec) &&
        (!p.end || p.end >= nowSec)
    ) ?? alert.activePeriods[0];

  const title = humanize(alert.headerText || "Service Alert");
  const rawMessage = alert.descriptionText
    ? humanize(alert.descriptionText)
    : undefined;
  // Suppress message when it's identical to the title (SMART often duplicates them)
  const message = rawMessage && rawMessage !== title ? rawMessage : undefined;

  return {
    id: alert.id,
    title,
    message,
    severity: mapEffectToSeverity(alert.effect),
    startsAt: activePeriod?.start
      ? new Date(activePeriod.start * 1000).toISOString()
      : undefined,
    endsAt: activePeriod?.end
      ? new Date(activePeriod.end * 1000).toISOString() // 0 is falsy, won't produce a bogus 1970 date
      : undefined,
    active: true,
  };
}

export function useServiceAlerts() {
  const query = useQuery({
    queryKey: ["gtfsrt", "alerts"],
    queryFn: fetchAlerts,
    refetchInterval: ALERTS_POLL_INTERVAL,
    staleTime: 4 * 60 * 1000,
    retry: 2,
  });

  const nowSec = Date.now() / 1000;

  const alerts: ServiceAlertData[] =
    query.data?.alerts
      .filter((alert) => {
        // No active periods = always active (system-wide standing notice)
        if (alert.activePeriods.length === 0) return true;
        return alert.activePeriods.some(
          (p) =>
            (!p.start || p.start <= nowSec) &&
            (!p.end || p.end >= nowSec)
        );
      })
      .map((alert) => mapAlertToServiceAlertData(alert, nowSec)) ?? [];

  return {
    alerts,
    rawAlerts: query.data?.alerts ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    lastUpdated: query.data?.timestamp,
  };
}
