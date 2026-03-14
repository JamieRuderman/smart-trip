import type { transit_realtime as GtfsRealtime } from "gtfs-realtime-bindings";
import { createGtfsRtHandler } from "../_handler.js";
import { getTranslation, transit_realtime } from "../_gtfsrt.js";

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

export default createGtfsRtHandler({
  feed: "servicealerts",
  sampleFile: "sample/alert.json",
  cacheControl: "s-maxage=60, stale-while-revalidate=30",
  transform(feed) {
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

    return { timestamp, alerts };
  },
});
