import type { transit_realtime as GtfsRealtime } from "gtfs-realtime-bindings";
import { createGtfsRtHandler, warnIfStaleTimestamp, warnIfUnknownStopId, warnIfUnknownEnum } from "../_handler.js";
import { VEHICLE_STOP_STATUS, KNOWN_VEHICLE_STOP_STATUS_VALUES } from "../_gtfsrt.js";
import { GTFS_STOP_ID_TO_STATION } from "../../src/data/generated/stationPlatforms.generated.js";

type FeedEntity = GtfsRealtime.IFeedEntity;
type VehicleData = GtfsRealtime.IVehiclePosition;

const KNOWN_STOP_IDS = new Set(Object.keys(GTFS_STOP_ID_TO_STATION));

export default createGtfsRtHandler({
  feed: "vehiclepositions",
  sampleFile: "sample/vehiclepositions.json",
  cacheControl: "s-maxage=15, stale-while-revalidate=10",
  supportRaw: true,
  transform(feed) {
    const feedTimestamp = Number(feed.header?.timestamp ?? 0);
    const warnings: string[] = [];

    const vehicles = (feed.entity ?? [])
      .filter((entity): entity is FeedEntity & { vehicle: VehicleData } =>
        entity.vehicle != null
      )
      .map((entity) => {
        const v = entity.vehicle;
        const vehicleId = v.vehicle?.id ?? entity.id ?? "";
        const vehicleLabel = v.vehicle?.label ?? vehicleId;
        const vehicleTimestamp = v.timestamp != null ? Number(v.timestamp) : undefined;
        const stopId = v.stopId ?? undefined;
        const currentStatusNum = v.currentStatus ?? undefined;

        // ── Validation warnings ─────────────────────────────────────────────
        const staleWarn = warnIfStaleTimestamp(vehicleId, vehicleTimestamp, feedTimestamp);
        if (staleWarn) warnings.push(staleWarn);

        if (stopId) {
          const stopWarn = warnIfUnknownStopId(stopId, KNOWN_STOP_IDS);
          if (stopWarn) warnings.push(`${vehicleId}: ${stopWarn}`);
        }

        if (currentStatusNum != null) {
          const enumWarn = warnIfUnknownEnum("VehicleStopStatus", currentStatusNum, KNOWN_VEHICLE_STOP_STATUS_VALUES);
          if (enumWarn) warnings.push(`${vehicleId}: ${enumWarn}`);
        }

        // Vehicles with a trip object but missing stop context are expected during
        // startup / handoff moments — warn so we can track frequency.
        if (v.trip != null && (!stopId || v.currentStopSequence == null)) {
          warnings.push(`${vehicleId}: has trip data but missing stopId or currentStopSequence`);
        }

        // ── Trip descriptor (only for active revenue trips) ─────────────────
        const trip = v.trip
          ? {
              tripId: v.trip.tripId ?? "",
              startTime: v.trip.startTime ?? "",
              startDate: v.trip.startDate ?? "",
              routeId: v.trip.routeId ?? "",
              directionId: v.trip.directionId ?? 0,
            }
          : undefined;

        // ── Position ────────────────────────────────────────────────────────
        const position = {
          latitude: v.position?.latitude ?? 0,
          longitude: v.position?.longitude ?? 0,
          bearing: v.position?.bearing != null ? v.position.bearing : undefined,
          speed: v.position?.speed != null ? v.position.speed : undefined,
        };

        return {
          vehicleId,
          vehicleLabel,
          trip,
          position,
          currentStopSequence: v.currentStopSequence ?? undefined,
          currentStatus: currentStatusNum != null
            ? (VEHICLE_STOP_STATUS[currentStatusNum] ?? "IN_TRANSIT_TO")
            : undefined,
          stopId,
          timestamp: vehicleTimestamp,
        };
      });

    return {
      timestamp: feedTimestamp,
      vehicles,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  },
});
