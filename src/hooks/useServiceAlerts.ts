import { useQuery } from "@tanstack/react-query";
import { apiBaseUrl } from "@/lib/env";
import { GTFS_STOP_ID_TO_STATION } from "@/lib/stationUtils";
import type { GtfsRtAlertsResponse, GtfsRtAlert, GtfsRtInformedEntity } from "@/types/gtfsRt";
import type { ServiceAlertData, Station } from "@/types/smartSchedule";

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

/**
 * Keep alert copy predictable/safe:
 * - remove non-letter characters except periods and whitespace
 * - collapse repeated whitespace
 * - trim outer whitespace
 */
function sanitizeAlertText(text?: string): string | undefined {
  if (!text) return undefined;
  const sanitized = text
    .replace(/[^a-zA-Z.\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized || undefined;
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

/**
 * Returns true if a single informed entity matches the user's context.
 * Per GTFS-RT spec, fields within one entity act as AND; multiple entities act as OR.
 */
function entityMatchesContext(
  entity: GtfsRtInformedEntity,
  fromStation: Station | "",
  toStation: Station | ""
): boolean {
  // Stop-specific: only show if the user has that stop's station selected
  if (entity.stopId) {
    // No stations selected → show all stop-targeted alerts (avoid hiding important info)
    if (!fromStation && !toStation) return true;
    const station = GTFS_STOP_ID_TO_STATION[entity.stopId];
    // Unknown stop ID → show conservatively rather than silently suppress
    if (!station) return true;
    return station === fromStation || station === toStation;
  }

  // Trip-specific: trip IDs are per-service-date and can't be correlated to the user's
  // selected route client-side, so show conservatively to avoid missing critical alerts
  if (entity.tripId) return true;

  // Route-only or agency-only → systemwide, always show
  return true;
}

/** Returns true if the alert is relevant for the user's currently selected stations. */
function isAlertRelevant(
  alert: GtfsRtAlert,
  fromStation: Station | "",
  toStation: Station | ""
): boolean {
  // No informed entities = broadcast to all riders
  if (alert.informedEntities.length === 0) return true;
  // Alert is relevant if ANY entity matches (OR across entities)
  return alert.informedEntities.some((entity) =>
    entityMatchesContext(entity, fromStation, toStation)
  );
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

  const sanitizedTitle = sanitizeAlertText(alert.headerText);
  const sanitizedMessage = sanitizeAlertText(alert.descriptionText);
  const title = humanize(sanitizedTitle ?? "Service Alert");
  const rawMessage = sanitizedMessage ? humanize(sanitizedMessage) : undefined;
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

export function useServiceAlerts(
  fromStation: Station | "" = "",
  toStation: Station | "" = ""
) {
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
      .filter((alert) => isAlertRelevant(alert, fromStation, toStation))
      .map((alert) => mapAlertToServiceAlertData(alert, nowSec)) ?? [];

  return {
    alerts,
    rawAlerts: query.data?.alerts ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    lastUpdated: query.data?.timestamp,
  };
}
