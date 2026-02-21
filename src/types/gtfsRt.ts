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
  /** How many minutes late (positive = late) — only set when > 0 */
  delayMinutes?: number;
  isOriginSkipped: boolean;
  isDestinationSkipped: boolean;
}
