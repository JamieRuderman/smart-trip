import type { VercelRequest, VercelResponse } from "@vercel/node";
import { transit_realtime } from "gtfs-realtime-bindings";
import { fetchGtfsRt, getTranslation } from "../_gtfsrt";

const { Alert } = transit_realtime;

function mapEffect(effect: transit_realtime.Alert.Effect | null | undefined): string {
  if (effect == null) return "UNKNOWN_EFFECT";
  return Alert.Effect[effect] ?? "UNKNOWN_EFFECT";
}

function mapCause(cause: transit_realtime.Alert.Cause | null | undefined): string {
  if (cause == null) return "UNKNOWN_CAUSE";
  return Alert.Cause[cause] ?? "UNKNOWN_CAUSE";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const feed = await fetchGtfsRt("servicealerts");

    const timestamp = Number(feed.header?.timestamp ?? 0);

    const alerts = (feed.entity ?? [])
      .filter((e) => e.alert)
      .map((e) => {
        const a = e.alert!;
        return {
          id: e.id,
          activePeriods: (a.activePeriod ?? []).map((p) => ({
            start: p.start ? Number(p.start) : undefined,
            end: p.end ? Number(p.end) : undefined,
          })),
          informedEntities: (a.informedEntity ?? []).map((ie) => ({
            agencyId: ie.agencyId ?? undefined,
            routeId: ie.routeId ?? undefined,
            tripId: ie.trip?.tripId ?? undefined,
            stopId: ie.stopId ?? undefined,
          })),
          cause: mapCause(a.cause),
          effect: mapEffect(a.effect),
          headerText: getTranslation(a.headerText),
          descriptionText: getTranslation(a.descriptionText),
          url: getTranslation(a.url) || undefined,
        };
      });

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=30");
    res.json({ timestamp, alerts });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}
