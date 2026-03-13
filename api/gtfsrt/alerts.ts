import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { transit_realtime as GtfsRealtime } from "gtfs-realtime-bindings";
import { applyCors } from "../_cors.js";
import { fetchGtfsRt, getTranslation, transit_realtime } from "../_gtfsrt.js";

const { Alert } = transit_realtime;
type FeedEntity = GtfsRealtime.IFeedEntity;
type AlertData = GtfsRealtime.IAlert;
type TimeRange = GtfsRealtime.ITimeRange;
type EntitySelector = GtfsRealtime.IEntitySelector;

function mapEffect(effect: number | null | undefined): string {
  if (effect == null) return "UNKNOWN_EFFECT";
  return Alert.Effect[effect] ?? "UNKNOWN_EFFECT";
}

function mapCause(cause: number | null | undefined): string {
  if (cause == null) return "UNKNOWN_CAUSE";
  return Alert.Cause[cause] ?? "UNKNOWN_CAUSE";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;

  try {
    if (process.env.USE_SAMPLE_DATA === "true") {
      const samplePath = resolve(process.cwd(), "sample/alert.json");
      const sample = JSON.parse(readFileSync(samplePath, "utf-8"));
      res.setHeader("Cache-Control", "no-store");
      return res.json(sample);
    }

    const feed = await fetchGtfsRt("servicealerts");

    const timestamp = Number(feed.header?.timestamp ?? 0);

    const alerts = (feed.entity ?? [])
      .filter((entity): entity is FeedEntity & { alert: AlertData } => entity.alert != null)
      .map((entity) => {
        const alert = entity.alert;
        return {
          id: entity.id,
          activePeriods: (alert.activePeriod ?? []).map((period: TimeRange) => ({
            start: period.start ? Number(period.start) : undefined,
            end: period.end ? Number(period.end) : undefined,
          })),
          informedEntities: (alert.informedEntity ?? []).map((informed: EntitySelector) => ({
            agencyId: informed.agencyId ?? undefined,
            routeId: informed.routeId ?? undefined,
            tripId: informed.trip?.tripId ?? undefined,
            stopId: informed.stopId ?? undefined,
          })),
          cause: mapCause(alert.cause),
          effect: mapEffect(alert.effect),
          headerText: getTranslation(alert.headerText),
          descriptionText: getTranslation(alert.descriptionText),
          url: getTranslation(alert.url) || undefined,
        };
      });

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=30");
    res.json({ timestamp, alerts });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}
