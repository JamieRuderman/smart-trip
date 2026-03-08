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
