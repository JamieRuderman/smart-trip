export type ScheduleRelationship =
  | "SCHEDULED"
  | "CANCELED"
  | "ADDED"
  | "DUPLICATED"
  | "UNSCHEDULED";

export type StopScheduleRelationship = "SCHEDULED" | "SKIPPED" | "NO_DATA";

export interface GtfsRtInformedEntity {
  agencyId?: string;
  routeId?: string;
  tripId?: string;
  stopId?: string;
}

export interface GtfsRtActivePeriod {
  start?: number; // Unix seconds
  end?: number; // Unix seconds
}

export interface GtfsRtAlert {
  id: string;
  activePeriods: GtfsRtActivePeriod[];
  informedEntities: GtfsRtInformedEntity[];
  cause?: string;
  effect?: string;
  headerText: string;
  descriptionText: string;
  url?: string;
}

export interface GtfsRtAlertsResponse {
  timestamp: number;
  alerts: GtfsRtAlert[];
}

export interface GtfsRtStopTimeUpdate {
  stopSequence?: number;
  stopId?: string;
  arrivalTime?: number; // Unix timestamp
  departureTime?: number; // Unix timestamp — use this per SMART spec
  scheduleRelationship: StopScheduleRelationship;
  arrivalDelay?: number; // seconds
  departureDelay?: number; // seconds
}

export interface GtfsRtTripUpdate {
  tripId: string;
  routeId?: string;
  startDate?: string;
  startTime?: string;
  scheduleRelationship: ScheduleRelationship;
  duplicatedTripRef?: string;
  stopTimeUpdates: GtfsRtStopTimeUpdate[];
}

export interface GtfsRtTripUpdatesResponse {
  timestamp: number;
  updates: GtfsRtTripUpdate[];
}

// ── Vehicle Positions ─────────────────────────────────────────────────────────

export type VehicleStopStatus = "STOPPED_AT" | "IN_TRANSIT_TO" | "INCOMING_AT";

export interface GtfsRtVehicleTrip {
  tripId: string;
  startTime: string;  // "HH:MM:SS" — the trip's scheduled origin departure
  startDate: string;  // "YYYYMMDD"
  routeId: string;
  directionId: number; // 0 = southbound (Windsor→Larkspur), 1 = northbound
}

export interface GtfsRtVehiclePosition {
  vehicleId: string;
  vehicleLabel: string;
  /** Only present for active revenue trips; absent for parked/deadheading vehicles. */
  trip?: GtfsRtVehicleTrip;
  position: {
    latitude: number;
    longitude: number;
    bearing?: number;  // degrees from north
    speed?: number;    // meters/second
  };
  currentStopSequence?: number;
  currentStatus?: VehicleStopStatus;
  /** GTFS platform stop ID, e.g. "71092" for Cotati southbound */
  stopId?: string;
  /** Unix seconds when this vehicle report was generated */
  timestamp?: number;
}

export interface GtfsRtVehiclePositionsResponse {
  /** Feed header timestamp in Unix seconds */
  timestamp: number;
  vehicles: GtfsRtVehiclePosition[];
  /** Validation warnings from the server-side parsing pipeline */
  warnings?: string[];
}

/**
 * Derived match between a vehicle and the trip the user is viewing.
 * Returned by useVehiclePositionForTrip when a fresh, valid match exists.
 */
export interface VehiclePositionMatch {
  vehicleId: string;
  /** Resolved station name from stopId via GTFS_STOP_ID_TO_STATION; null if stopId unknown */
  currentStation: import("./smartSchedule").Station | null;
  currentStatus: VehicleStopStatus;
  currentStopSequence: number;
  position: {
    latitude: number;
    longitude: number;
    bearing?: number;
    speed?: number;
  };
  /** Unix seconds of the vehicle report */
  timestamp: number;
}

/**
 * Derived real-time status for a specific trip leg (fromStation → toStation).
 * Used by TripCard to overlay live data on the static schedule.
 */
export interface TripRealtimeStatus {
  isCanceled: boolean;
  /** Live departure time as "HH:MM" string, derived from departure.time Unix timestamp */
  liveDepartureTime?: string;
  /** Live arrival time as "HH:MM" string at the destination station */
  liveArrivalTime?: string;
  /** How many minutes late at departure (positive = late) — only set when > 0 */
  delayMinutes?: number;
  /** How many minutes late at arrival (positive = late) — only set when > 0 and differs from delayMinutes */
  arrivalDelayMinutes?: number;
  isOriginSkipped: boolean;
  isDestinationSkipped: boolean;
  /**
   * Live departure times for all known stops on this trip, keyed by station name.
   * Populated from the full stop_time_updates array. A stop present here with a
   * past departure time means the train has already left that station. A stop
   * absent from the feed has likely already been served (or has no RT data).
   */
  allStopLiveDepartures?: Partial<Record<string, string>>; // station name → "HH:MM"
  /**
   * Per-stop delay in minutes, keyed by station name. Computed by diffing the
   * GTFS-RT absolute departure timestamp against the app's own static schedule
   * (same method as trip-level delayMinutes). Only entries with delay ≥ 1 min
   * are stored. Use this instead of deriving delay from HH:MM string comparison,
   * which is susceptible to rounding noise from schedule data mismatches.
   */
  allStopDelayMinutes?: Partial<Record<string, number>>;
  /**
   * Whether the GTFS-RT feed has stop_time_updates for this trip (true = we have
   * real-time position data, false = position is estimated from static schedule).
   */
  hasRealtimeStopData?: boolean;
}
